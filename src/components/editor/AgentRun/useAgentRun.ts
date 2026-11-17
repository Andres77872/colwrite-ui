import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  runAgentTurn,
  type AgentChatParams,
  type AgentChatResult,
  type AgentChatRetryOptions,
} from '@/api/assistant/agentChat';
import { AgentAdmissionRefused, type CheckpointResume, type ResumeAgentRun } from '@/api/assistant/agentSessionChat';
import { AgentSocketError } from '@/api/assistant/agentSocket';
import { mergeSources, type AgentEventHandlers, type AgentSource } from '@/api/assistant/streamParser';
import type { DocumentActionsValue, DocumentSessionValue } from '@/editor';
import { useAgentEngine, type AgentEngineRequest } from '@/components/preferences/agentEngineContextState';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { advanceProgress, progressForStatus, type AgentProgress } from '../AgentProgress';
import { useToolNamer } from '../ChatAssistant/AgentActivity/useToolNamer';
import { friendlyStreamError, type ChatError } from '../ChatAssistant/chatUtils';
import { INCOMPLETE_RUN, thrownRunError } from './runErrors';

/**
 * Where a run comes from, which is also its profile. `chat` is the
 * conversation in the sidebar, which navigation detaches from and Stop
 * cancels. `inline` is Ask AI and AI beats: a one-shot run (`profile:
 * "inline"`) that stores no chat and is cancelled whenever it stops, its
 * surface going away included.
 */
export type AgentRunSurface = 'chat' | 'inline' | 'review';

/** The page a run is about, as the editor's document session holds it. */
export type AgentRunDocument = {
  documentId: DocumentSessionValue['documentId'];
  ensureRemoteDocument: DocumentActionsValue['ensureRemoteDocument'];
  hasPendingEdits: DocumentActionsValue['hasPendingEdits'];
  saveRemote: DocumentActionsValue['saveRemote'];
  /** Kept edits after a demotion must not trigger a viewer's write. */
  readOnly?: boolean;
};

/** What the driver settled before the request left: the page and the engine. */
export type PreparedRun = { documentId: string; engine: AgentEngineRequest };

/** The run's own fields; the driver adds the workspace, the page and the engine. */
type AgentRunRequest = Omit<AgentChatParams, 'workspace_id' | 'document_id' | 'engine' | 'model' | 'gateway_models' | 'profile'>;

export type AgentRunSpec = {
  request: AgentRunRequest;
  /**
   * The surface's own handlers, called only while this run is the live one.
   * A function is called once the page is known, for handlers that need it.
   */
  handlers?: AgentEventHandlers | ((prepared: PreparedRun) => AgentEventHandlers);
  /** Observe a run that already exists: nothing is saved and nothing new starts. */
  resume?: ResumeAgentRun;
  checkpoint?: CheckpointResume;
  onRunStarted?: (run: ResumeAgentRun) => void;
  /** Definitive rejection may settle after detach. Only clear matching scoped
   * recovery metadata here, never mutate the page or unmounted UI state. */
  onAdmissionRefused?: (run: ResumeAgentRun) => void;
  /** Called once the page is saved and before the request leaves. */
  onPrepared?: (prepared: PreparedRun) => void;
  retry?: AgentChatRetryOptions;
};

export type AgentRunOutcome =
  | { status: 'done'; documentId: string; result: AgentChatResult }
  /** `code` is the server's error code, when the run reported one. */
  | { status: 'failed'; error: ChatError; code: string | null; documentId: string | null }
  /** Stopped, detached, replaced by a newer run, or its surface went away. */
  | { status: 'stopped' };

type AgentRun = {
  /** Start a run; one at a time, so a newer start stops the one before it. */
  start: (spec: AgentRunSpec) => Promise<AgentRunOutcome>;
  /** The author's Stop: the run is cancelled on the server. */
  stop: () => void;
  /**
   * Stop following the run without cancelling it (the chat leaving a
   * conversation). An inline run has nothing to come back to: it is
   * cancelled either way.
   */
  detach: () => void;
  /** Whether a run is live now, read synchronously (event handlers, guards). */
  isRunning: () => boolean;
  running: boolean;
  /** What the run is doing, and since when; `null` when idle. */
  progress: AgentProgress | null;
  /**
   * The sources the run's tools touched, once each by handle, the latest
   * entry of each. An inline run has no conversation: these are all the
   * sources its markers can name.
   */
  sources: AgentSource[];
};

const THINKING = { phase: 'thinking', label: 'Thinking…' } as const;
const STOPPED: AgentRunOutcome = { status: 'stopped' };

/**
 * useAgentRun — the one driver behind every assistant run: the chat, Ask AI
 * and AI beats.
 *
 * It saves first (the server reads the stored page, so a page it has not
 * seen, or edits it has not, would be answered as an older version), sends
 * the request with the surface's engine, keeps the shared progress line,
 * merges sources by handle, words errors once, and stops the run when the
 * surface unmounts. The surface passes its own handlers and renders what
 * comes back.
 */
export function useAgentRun({ surface, document }: { surface: AgentRunSurface; document: AgentRunDocument }): AgentRun {
  const workspaceId = useWorkspaceId();
  const engines = useAgentEngine();
  const nameTool = useToolNamer();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [sources, setSources] = useState<AgentSource[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  // Read at the moment a run needs them, from the last commit: a run
  // outlives the render that started it.
  const latest = useRef({ document, engines, workspaceId, nameTool });
  useLayoutEffect(() => {
    latest.current = { document, engines, workspaceId, nameTool };
  });

  useEffect(() => () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.abort('cancel');
    controllerRef.current = null;
    setRunning(false);
    setProgress(null);
  }, []);

  const detach = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRunning(false);
    setProgress(null);
  }, []);

  const isRunning = useCallback(() => controllerRef.current !== null, []);

  const start = useCallback(async (spec: AgentRunSpec): Promise<AgentRunOutcome> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const live = () => controllerRef.current === controller && !controller.signal.aborted;
    const moveTo = (next: Pick<AgentProgress, 'phase' | 'label'>) => {
      if (live()) setProgress((current) => advanceProgress(current, next));
    };
    setRunning(true);
    setSources([]);
    setProgress({ ...THINKING, since: Date.now() });

    /** Calls announced and not yet ended, by id, with their running labels, so an end knows what is still running. */
    const tools = new Map<string, { tool: string; running: string }>();
    let anonymous = 0;
    let heldSources: AgentSource[] = [];
    let failure: { error: ChatError; code: string } | null = null;
    let documentId: string | null = null;
    const failed = (error: ChatError, code: string | null = null): AgentRunOutcome => (
      { status: 'failed', error, code, documentId }
    );

    try {
      const { document: page, engines: engineChoice, workspaceId: workspace } = latest.current;
      documentId = page.documentId;
      if (!documentId && page.readOnly) {
        return failed({ message: 'A review needs a page already saved in this workspace.', retryable: false });
      }
      if (!documentId) {
        moveTo({ phase: 'preparing', label: 'Saving this page so the assistant can work on it…' });
        documentId = await page.ensureRemoteDocument();
        if (!live()) return STOPPED;
        if (!documentId) {
          return failed({
            message: 'This page could not be saved, so there is nothing for the assistant to work on yet.',
            retryable: true,
          });
        }
        moveTo(THINKING);
      } else if (!spec.resume && !page.readOnly && page.hasPendingEdits()) {
        // Edits sit in this browser for a few seconds before autosave takes
        // them: long enough to ask about a paragraph the server has never
        // seen, and get back a rewrite of the version already replaced.
        moveTo({ phase: 'preparing', label: 'Saving your latest edits…' });
        try {
          await page.saveRemote();
        } catch {
          if (!live()) return STOPPED;
          return failed({
            message: 'Your latest edits could not be saved, so the assistant would answer about an older version of this page.',
            retryable: true,
          });
        }
        if (!live()) return STOPPED;
        moveTo(THINKING);
      }

      // Chosen once per run: switching engines mid-reply applies to the next.
      const prepared: PreparedRun = { documentId, engine: engineChoice.requestFor(surface === 'inline' ? 'inline' : 'chat') };
      spec.onPrepared?.(prepared);
      const own = typeof spec.handlers === 'function' ? spec.handlers(prepared) : spec.handlers ?? {};

      const runningLabel = () => {
        const call = [...tools.values()].at(-1);
        return call ? { phase: 'tool' as const, label: `${call.running}…` } : null;
      };
      const handlers: AgentEventHandlers = {
        ...Object.fromEntries(
          Object.entries(own).map(([name, handler]) => [
            name,
            (...args: unknown[]) => {
              if (live()) (handler as (...values: unknown[]) => void)(...args);
            },
          ]),
        ),
        onToken: (content) => {
          if (!live()) return;
          // `since` follows the latest token, so a reply that pauses can be
          // told apart from one still being written.
          setProgress({ phase: 'writing', label: 'Writing…', since: Date.now() });
          own.onToken?.(content);
        },
        onReasoning: (content) => {
          if (!live()) return;
          // While a tool runs (a research worker's, say) its label stays up.
          if (tools.size === 0) moveTo(THINKING);
          own.onReasoning?.(content);
        },
        onStatus: (status, detail) => {
          if (!live()) return;
          own.onStatus?.(status, detail);
          const next = progressForStatus(status, detail);
          if (!next) return;
          // A running tool is the more specific news; only a retry or a
          // reconnect is worth saying over it. Back from a reconnect, the
          // tool's own label returns: nothing else would replace
          // "Reconnecting…" until it finished.
          if (next.phase === 'thinking' && tools.size > 0) {
            const tool = status === 'reconnected' ? runningLabel() : null;
            if (tool) moveTo(tool);
            return;
          }
          moveTo(next);
        },
        onToolCallStart: (tool, toolCallId, display) => {
          if (!live()) return;
          // The catalog's running label, or the start's own for a tool it lacks.
          const running = latest.current.nameTool(tool, display).runningLabel;
          // Providers that send no call id still need a distinct key.
          tools.set(toolCallId || `${tool}:anonymous-${(anonymous += 1)}`, { tool, running });
          moveTo({ phase: 'tool', label: `${running}…` });
          own.onToolCallStart?.(tool, toolCallId, display);
        },
        onToolCallEnd: (event) => {
          if (!live()) return;
          // Only an end that closes a call this run saw open moves the line:
          // a run reattached partway through can hear the end of a call it
          // never saw start, and that must not put "Thinking…" back over
          // text that is streaming.
          let closed = Boolean(event.toolCallId) && tools.delete(event.toolCallId);
          if (!closed && !event.toolCallId) {
            const match = [...tools].find(([, call]) => call.tool === event.tool);
            closed = match ? tools.delete(match[0]) : false;
          }
          if (closed) moveTo(runningLabel() ?? THINKING);
          own.onToolCallEnd?.(event);
        },
        onEvidence: (found) => {
          if (!live()) return;
          // Each source once, by its handle: a replayed or retried stream
          // must not list one twice, and a later entry of the same handle
          // (a better key) replaces the earlier one where it stands. The
          // passages go to the surface as sent; it keeps them by id.
          const merged = mergeSources(heldSources, found.sources);
          if (merged.changed.length) {
            heldSources = merged.sources;
            setSources(merged.sources);
          }
          if (merged.changed.length || found.passages.length) {
            own.onEvidence?.({ sources: merged.changed, passages: found.passages });
          }
        },
        onError: (code, message) => {
          if (!live()) return;
          // A CLI that lost its login (or was never ready) re-reads its state.
          engineChoice.noteRunError(code);
          failure = { error: friendlyStreamError(code, message), code };
          own.onError?.(code, message);
        },
      };

      const result = await runAgentTurn(
        {
          workspace_id: workspace,
          document_id: documentId,
          ...spec.request,
          profile: surface,
          ...prepared.engine,
        },
        handlers,
        {
          signal: controller.signal,
          // The chat's run is durable: leaving it detaches, Stop cancels.
          abortBehavior: surface === 'inline' ? 'cancel' : 'detach',
          resume: spec.resume,
          checkpoint: spec.checkpoint,
          onRunStarted: (run) => {
            if (live()) spec.onRunStarted?.(run);
          },
          retry: spec.retry,
        },
      );
      if (!live()) return STOPPED;
      const reported = failure as { error: ChatError; code: string } | null;
      if (reported) return failed(reported.error, reported.code);
      // The connection closed with neither `done` nor `error`: the server
      // was cut off mid-run, and what is on screen may be too.
      if (result.terminal === null) return failed(INCOMPLETE_RUN, 'INCOMPLETE_STREAM');
      return { status: 'done', documentId, result };
    } catch (caught) {
      if (caught instanceof AgentAdmissionRefused) spec.onAdmissionRefused?.(caught.locator);
      if (!live()) return STOPPED;
      return failed(thrownRunError(caught), caught instanceof AgentSocketError ? caught.code.toUpperCase() : null);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setRunning(false);
        setProgress(null);
      }
    }
  }, [surface]);

  return { start, stop, detach, isRunning, running, progress, sources };
}
