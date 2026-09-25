import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { streamAgentChat, type AgentChatContext, type AgentChatResult } from '@/services/agentChat';
import { useAgentEngine } from '@/components/preferences/agentEngineContextState';
import { AgentSocketError } from '@/services/agentSocket';
import type { AssistantSnapshot, ResumeAgentRun } from '@/services/agentSessionChat';
import type { SSEEventHandlers } from '@/services/streamParser';
import type { ToolAction } from '@/editor/types';
import type { EditorContextValue } from '@/editor/editorContextState';
import type { ProposalsContextValue } from '@/editor/proposalsContextState';
import {
  advanceProgress,
  progressForStatus,
  type AgentProgress,
} from '@/components/editor/AgentProgress';
import { toolRunningLabel } from './AgentActivity';
import type { ChatRefPickerHandle } from './ChatRefPicker';
import {
  emptyMessage,
  friendlyStreamError,
  toolRunDetail,
  type ChatError,
  type ChatMessage,
  type LastExchange,
} from './chatUtils';

type AgentTurnOptions = {
  documentId: EditorContextValue['documentId'];
  loadingDocumentId: EditorContextValue['loadingDocumentId'];
  restoreEpoch: EditorContextValue['restoreEpoch'];
  ensureRemoteDocument: EditorContextValue['ensureRemoteDocument'];
  hasPendingEdits: EditorContextValue['hasPendingEdits'];
  saveRemote: EditorContextValue['saveRemote'];
  selectedChatId: string | null;
  selectedThreadId: number | null;
  setSelectedChatId: (id: string | null) => void;
  setSelectedThreadId: (id: number | null) => void;
  proposals: ProposalsContextValue;
  setInput: Dispatch<SetStateAction<string>>;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  pinnedToBottom: MutableRefObject<boolean>;
  refPickerRef: RefObject<ChatRefPickerHandle | null>;
  /**
   * The loader's claim on the conversation on screen (see
   * useConversationLoader). A turn writes it too: the stream's `done` ids name
   * the transcript it has just produced, so it marks that conversation loaded
   * before the ids land and the loader chases them.
   */
  loadedConversationRef: MutableRefObject<string | null>;
  /** The server started a conversation for this turn's message. */
  onChatCreated?: (chatId: string, prompt: string) => void;
};

export type AgentTurn = {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: ChatError | null;
  /** What the running turn is doing now, and since when; null when idle. */
  agentStatus: AgentProgress | null;
  activeMessageId: string | null;
  lastExchange: LastExchange | null;
  send: (text: string, context?: AgentChatContext) => Promise<void>;
  resumeRun: (snapshot: AssistantSnapshot) => void;
  onStop: () => void;
  onRetry: () => void;
  resetChatUI: (clearMessages?: boolean) => void;
  /**
   * Shared with the conversation loader, which stops the stream when it takes
   * over the transcript.
   */
  abortRef: MutableRefObject<AbortController | null>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setAgentStatus: Dispatch<SetStateAction<AgentProgress | null>>;
};

/** Close the stretch of reasoning under way, adding it to the time spent. */
function endThinking(message: ChatMessage, now: number): ChatMessage {
  if (message.thinkingSince === undefined) return message;
  return {
    ...message,
    thinkingMs: (message.thinkingMs ?? 0) + Math.max(0, now - message.thinkingSince),
    thinkingSince: undefined,
  };
}

const THINKING = { phase: 'thinking', label: 'Thinking…' } as const;

/**
 * useAgentTurn — one streaming turn of the assistant: send, stream handlers,
 * stop, retry, and the abort lifecycle that keeps a turn scoped to the
 * document it started on.
 */
export function useAgentTurn({
  documentId,
  loadingDocumentId,
  restoreEpoch,
  ensureRemoteDocument,
  hasPendingEdits,
  saveRemote,
  selectedChatId,
  selectedThreadId,
  setSelectedChatId,
  setSelectedThreadId,
  proposals,
  setInput,
  setAtBottom,
  pinnedToBottom,
  refPickerRef,
  loadedConversationRef,
  onChatCreated,
}: AgentTurnOptions): AgentTurn {
  const engines = useAgentEngine();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentProgress | null>(null);
  const moveTo = useCallback((next: Pick<AgentProgress, 'phase' | 'label'>) => {
    setAgentStatus((current) => advanceProgress(current, next));
  }, []);
  /**
   * Tool calls announced and not yet ended in this turn, by call id, so an
   * end can tell whether the model has gone back to thinking. Kept outside
   * the transcript because a state updater has to stay pure.
   */
  const runningToolsRef = useRef<Map<string, string>>(new Map());
  const anonymousCallsRef = useRef(0);

  /**
   * The document this session is attached to, and the chat and thread it is
   * on, as of the last commit.
   *
   * A turn outlives several renders, and the first message on an unsaved draft
   * changes both mid-flight. The session setters in particular are rebuilt
   * whenever the owning document id changes and refuse writes from a callback
   * bound to the previous one — a turn that attached the document while it ran
   * would otherwise finish holding the setters from before the attach, drop the
   * chat id the server had just created, and start a new conversation with
   * every following message.
   *
   * Synced in a layout effect rather than during render: a render React
   * discards must not be the one that decides which document a reply belongs
   * to. Everything that reads these is a network callback or an event handler,
   * so committed values are current by the time they run.
   */
  const documentIdRef = useRef(documentId);
  const sessionRef = useRef({
    selectedChatId,
    selectedThreadId,
    setSelectedChatId,
    setSelectedThreadId,
  });
  useLayoutEffect(() => {
    documentIdRef.current = documentId;
    sessionRef.current = {
      selectedChatId,
      selectedThreadId,
      setSelectedChatId,
      setSelectedThreadId,
    };
  }, [documentId, selectedChatId, selectedThreadId, setSelectedChatId, setSelectedThreadId]);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  // tool_call_ids already handled, so a redelivered event cannot double-queue.
  const processedToolCallIds = useRef<Set<string>>(new Set());
  // The message currently being written into, so stream callbacks can find it
  // without scanning for "the last assistant message" on every token.
  const activeMessageIdRef = useRef<string | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  // The last exchange sent, so a failed turn can be retried without retyping —
  // and so retry removes that turn's rows, not whatever happens to be last.
  const [lastExchange, setLastExchange] = useState<LastExchange | null>(null);

  useEffect(() => {
    if (!loadingDocumentId) return;
    // A stream is scoped to the committed document. Stop it before a different
    // body can commit so late tool events cannot mutate or stage work against
    // the wrong document.
    abortRef.current?.abort();
    abortRef.current = null;
    refPickerRef.current?.close();
  }, [loadingDocumentId, refPickerRef]);

  // A restore keeps the document id but moves it onto another version of its
  // tree. A turn that started against the pre-restore version is answering
  // about content that is no longer on screen, and its late tool events would
  // pass the document-id gate — stop the stream at the version boundary. The
  // transcript itself survives: the next turn simply runs against the
  // document's current version.
  const restoreEpochRef = useRef(restoreEpoch);
  useEffect(() => {
    if (restoreEpochRef.current === restoreEpoch) return;
    restoreEpochRef.current = restoreEpoch;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [restoreEpoch]);

  // The document-keyed assistant intentionally remounts on navigation so its
  // transcript is scoped to one document. Stop the old network stream as part
  // of that boundary; mocks and transports may still invoke retained
  // callbacks, so every callback below also checks that its controller is live.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const patchActive = useCallback((update: (message: ChatMessage) => ChatMessage) => {
    const id = activeMessageIdRef.current;
    if (!id) return;
    setMessages((prev) => prev.map((m) => (m.id === id ? update(m) : m)));
  }, []);

  const resetChatUI = useCallback((clearMessages = true) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setAgentStatus(null);
    setError(null);
    setInput('');
    activeMessageIdRef.current = null;
    setActiveMessageId(null);
    if (clearMessages) setMessages([]);
  }, [setInput]);

  /**
   * Hand a streamed document mutation to the review layer.
   *
   * Nothing is applied here. The agent's operations are staged server-side and
   * the author accepts or rejects each one on the block it affects — a rewrite
   * cannot be judged from a chat bubble, only against the paragraph it
   * replaces.
   */
  const onToolAction = useCallback(
    (action: ToolAction) => {
      if (!mountedRef.current) return;

      // Tool events name the document they were produced against. Never stage
      // one in a different active document, even if a transport delivers it
      // after the stream was aborted.
      //
      // Creating a document is the exception, and the reason this used to look
      // like the assistant doing nothing at all: `doc_create` names the
      // document it has just made, which is never the one on screen. Matching
      // ids here dropped the event before anything could offer it to the
      // author. The review layer scopes the two halves properly — operations
      // to this document, invitations to the one that was created.
      const announcesNewDocument = action.actions.some(
        (op) => op.op === 'create_document',
      );
      if (action.documentId !== documentIdRef.current && !announcesNewDocument) return;

      // Only a genuine redelivery is a duplicate. The id alone is not enough:
      // providers that number tool calls per request reuse `call_0`, and some
      // send none at all. The previous fallback keyed on the document version,
      // which a proposal deliberately leaves unchanged — so two staged batches
      // in one run collapsed into one and the second edit vanished.
      const dedupKey = `${action.toolCallId}:${action.status}:${JSON.stringify(action.actions)}`;
      if (processedToolCallIds.current.has(dedupKey)) return;
      processedToolCallIds.current.add(dedupKey);

      const { changeIds, applied } = proposals.receive(action);

      if (action.status === 'error') {
        setError({
          message: action.message || 'The assistant could not complete that edit.',
          retryable: false,
        });
      }

      if (changeIds.length > 0 || applied > 0) {
        patchActive((message) => ({
          ...message,
          proposedIds: [...message.proposedIds, ...changeIds],
          applied: message.applied + applied,
        }));
      }
    },
    [patchActive, proposals],
  );

  const send = async (text: string, context?: AgentChatContext, resume?: ResumeAgentRun) => {
    if (!text || abortRef.current || loadingDocumentId) return;

    setError(null);
    setInput('');
    // Something is on screen from the moment the message is sent.
    setAgentStatus({ ...THINKING, since: Date.now() });
    pinnedToBottom.current = true;
    setAtBottom(true);
    // Tool-call ids are only unique within a run for some providers.
    processedToolCallIds.current = new Set();
    runningToolsRef.current = new Map();

    const userMessage = emptyMessage('user', text);
    const assistantMessage = emptyMessage('assistant');
    setLastExchange({
      text,
      context,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      run: resume,
    });
    activeMessageIdRef.current = assistantMessage.id;
    setActiveMessageId(assistantMessage.id);
    setMessages((prev) => {
      if (resume) {
        const last = prev.at(-1);
        if (last?.role === 'user' && last.content === text) return [...prev, assistantMessage];
        if (last?.role === 'assistant' && prev.at(-2)?.role === 'user' && prev.at(-2)?.content === text) {
          return [...prev.slice(0, -1), assistantMessage];
        }
      }
      return [...prev, userMessage, assistantMessage];
    });

    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);
    const streamIsLive = () => (
      mountedRef.current
      && abortRef.current === controller
      && !controller.signal.aborted
    );

    try {
      /**
       * Attach before anything else.
       *
       * Everything in a turn is addressed by document id — the agent reads and
       * edits `document_id`, and the chat session is stored against it — so a
       * draft that lives only in this browser has nothing for the assistant to
       * act on. Saving it here is the whole point: the author asked about *this*
       * document, and from this moment the session belongs to it.
       */
      let turnDocumentId = documentIdRef.current;
      if (!turnDocumentId) {
        moveTo({
          phase: 'preparing',
          label: 'Saving this document so the assistant can work on it…',
        });
        turnDocumentId = await ensureRemoteDocument();
        if (!streamIsLive()) return;
        if (!turnDocumentId) {
          setError({
            message:
              'This document could not be saved, so there is nothing for the assistant to work on yet.',
            retryable: true,
          });
          return;
        }
        moveTo(THINKING);
      } else if (!resume && hasPendingEdits()) {
        // The agent reads the *stored* document. Edits sit in this browser for
        // five seconds before autosave takes them, which is long enough to ask
        // a question about a paragraph the server has never seen — and to get
        // back a rewrite of the version the author had already replaced.
        moveTo({ phase: 'preparing', label: 'Saving your latest edits…' });
        try {
          await saveRemote();
        } catch {
          if (!streamIsLive()) return;
          setError({
            message:
              'Your latest edits could not be saved, so the assistant would answer about an older version of this document.',
            retryable: true,
          });
          return;
        }
        if (!streamIsLive()) return;
        moveTo(THINKING);
      }

      // Captured for the whole turn. A conversation belongs to the document it
      // was started on; nothing below may silently move it to another one.
      let turnChatId = sessionRef.current.selectedChatId;
      let turnThreadId = sessionRef.current.selectedThreadId;

      // A chat id can outlive the chat it names — deleted from the chats panel
      // in another tab, or left behind in this browser after the document it
      // belonged to was removed. The server answers `CHAT_NOT_FOUND` and the
      // session used to stay wedged on that dead id for good. Recover once, as
      // a new conversation on the document that is actually open.
      let recover: 'chat' | 'thread' | null = null;
      let alreadyRecovered = false;

      const handlers: SSEEventHandlers = {
        onSessionChat: (chatId) => {
          if (!streamIsLive()) return;
          loadedConversationRef.current = `${turnDocumentId}:${chatId}:${turnThreadId ?? 'latest'}`;
          if (chatId !== turnChatId) {
            if (!turnChatId) onChatCreated?.(chatId, text);
            turnChatId = chatId;
            sessionRef.current.setSelectedChatId(chatId);
          }
        },
        onTodo: (todos) => {
          if (streamIsLive()) patchActive((message) => ({ ...message, todos }));
        },
        onSubagent: (worker) => {
          if (streamIsLive()) patchActive((message) => ({ ...message,
            workers: [...(message.workers ?? []).filter((item) => item.id !== worker.id), worker],
          }));
        },
        onToken: (content) => {
          if (!streamIsLive()) return;
          const now = Date.now();
          // `since` follows the latest token, so a reply that stops mid-way
          // can be told apart from one that is still being written.
          setAgentStatus({ phase: 'writing', label: 'Writing…', since: now });
          patchActive((message) => ({
            ...endThinking(message, now),
            content: message.content + content,
          }));
        },
        onReasoning: (content) => {
          if (!streamIsLive()) return;
          const now = Date.now();
          // While a tool runs (a research worker's, say) its label stays up.
          if (runningToolsRef.current.size === 0) moveTo(THINKING);
          patchActive((message) => ({
            ...message,
            reasoning: (message.reasoning ?? '') + content,
            thinkingSince: message.thinkingSince ?? now,
          }));
        },
        onStatus: (status, detail) => {
          if (!streamIsLive()) return;
          const next = progressForStatus(status, detail);
          // A running tool is the more specific news; only a retry or a
          // reconnect is worth saying over it.
          if (!next || (next.phase === 'thinking' && runningToolsRef.current.size > 0)) return;
          moveTo(next);
        },
        onToolCallStart: (tool, toolCallId, args) => {
          if (!streamIsLive()) return;
          const now = Date.now();
          // Providers that send no call id still need a distinct row key.
          const id = toolCallId || `${tool}:anonymous-${(anonymousCallsRef.current += 1)}`;
          runningToolsRef.current.set(id, tool);
          moveTo({ phase: 'tool', label: `${toolRunningLabel(tool)}…` });
          patchActive((message) => ({
            ...endThinking(message, now),
            runs: [
              ...message.runs,
              {
                id,
                tool,
                state: 'running',
                detail: toolRunDetail(tool, args),
                startedAt: now,
              },
            ],
          }));
        },
        onToolCallProgress: (event) => {
          if (!streamIsLive()) return;
          patchActive((message) => {
            // Only while the input is still being written: once the call's
            // arguments are known it is running, and a late count is noise.
            // (The preview always comes with them; the full object is left
            // out when it is large, which is exactly a long edit.)
            const index = message.runs.findIndex((run) =>
              run.state === 'running'
              && run.args === undefined
              && run.argsPreview === undefined
              && (event.toolCallId ? run.id === event.toolCallId : run.tool === event.tool),
            );
            if (index === -1 || message.runs[index].argumentsChars === event.argumentsChars) {
              return message;
            }
            const runs = message.runs.slice();
            runs[index] = { ...runs[index], argumentsChars: event.argumentsChars };
            return { ...message, runs };
          });
        },
        onToolCallArgs: (event) => {
          if (!streamIsLive()) return;
          // The start event fires before the model has finished writing its
          // arguments, so this is usually the first time the input is known.
          patchActive((message) => {
            const index = message.runs.findIndex((run) =>
              run.state === 'running'
              && (event.toolCallId ? run.id === event.toolCallId : run.tool === event.tool),
            );
            if (index === -1) return message;
            const runs = message.runs.slice();
            const existing = runs[index];
            runs[index] = {
              ...existing,
              args: event.arguments ?? existing.args,
              argsPreview: event.argumentsPreview || existing.argsPreview,
              // Written in full: the call is running now, not being drafted.
              argumentsChars: undefined,
              detail:
                existing.detail
                ?? (event.arguments ? toolRunDetail(event.tool, event.arguments) : undefined),
            };
            return { ...message, runs };
          });
        },
        onToolCallEnd: (event) => {
          if (!streamIsLive()) return;
          // What the turn is doing next. Only an end that closes a call this
          // turn still had open counts: a duplicate end (a provisional one,
          // then the tool runtime's) can arrive after the answer has resumed,
          // and must not put "Thinking…" back over text that is streaming.
          const running = runningToolsRef.current;
          let closed = event.toolCallId && running.delete(event.toolCallId);
          if (!closed && !event.toolCallId) {
            const match = [...running].find(([, tool]) => tool === event.tool);
            closed = match ? running.delete(match[0]) : false;
          }
          if (closed) {
            const still = [...running.values()].at(-1);
            moveTo(still ? { phase: 'tool', label: `${toolRunningLabel(still)}…` } : THINKING);
          }
          patchActive((message) => {
            // Matched on the call id whenever the provider sends one. Without
            // it there is nothing to pair on but the name, so two concurrent
            // calls of the same tool are resolved oldest-first and their
            // durations can cross. That is a limit of the payload, not a
            // choice — which is why an unmatched end is left alone below
            // rather than applied to some other run.
            let index = message.runs.findIndex((run) =>
              run.state === 'running'
              && (event.toolCallId ? run.id === event.toolCallId : run.tool === event.tool),
            );
            // The stream can end a call twice: a synthetic zero-duration end
            // when content resumes, then the authoritative one from the tool
            // runtime. The correction used to be dropped here, leaving a
            // failed call rendered as a success — take it when it carries an
            // outcome the provisional end did not.
            if (index === -1 && event.toolCallId && (event.isError || event.outputPreview !== null)) {
              index = message.runs.findIndex((run) => run.id === event.toolCallId);
            }
            if (index === -1) return message;
            const runs = message.runs.slice();
            const existing = runs[index];
            runs[index] = {
              ...existing,
              state: event.isError ? 'error' : 'done',
              durationMs: event.durationMs || existing.durationMs,
              error: event.error ?? existing.error,
              errorType: event.errorType ?? existing.errorType,
              args: event.arguments ?? existing.args,
              argsPreview: event.argumentsPreview || existing.argsPreview,
              outputPreview: event.outputPreview ?? existing.outputPreview,
              outputChars: event.outputChars || existing.outputChars,
              outputTruncated: event.outputTruncated || existing.outputTruncated,
              detail:
                existing.detail
                ?? (event.arguments ? toolRunDetail(event.tool, event.arguments) : undefined),
            };
            return { ...message, runs };
          });
        },
        onToolAction: (action) => {
          if (!streamIsLive()) return;
          onToolAction(action);
        },
        onSources: (sources) => {
          if (!streamIsLive()) return;
          // Merged by id: the registry sends each source once, but a retried
          // stream must not list one twice.
          patchActive((message) => {
            const known = new Set((message.sources ?? []).map((source) => source.id));
            const fresh = sources.filter((source) => !known.has(source.id));
            return fresh.length ? { ...message, sources: [...(message.sources ?? []), ...fresh] } : message;
          });
        },
        onError: (code, message) => {
          if (!streamIsLive()) return;
          // A CLI that lost its login (or was never ready) re-reads its state,
          // so the composer's engine menu shows why straight away.
          engines.noteRunError(code);
          // Reattaching observes an existing run; its failure must not reset
          // selection or enter the recovery path that starts a new turn.
          if (!resume && !alreadyRecovered && (code === 'CHAT_NOT_FOUND' || code === 'THREAD_NOT_FOUND')) {
            // Reported by the retry below if that fails too, so the author is
            // never shown an error the app is about to resolve by itself.
            recover = code === 'CHAT_NOT_FOUND' ? 'chat' : 'thread';
            return;
          }
          // The stream died around these calls; the tools themselves did not
          // report failure. 'interrupted', because painting them as errors
          // sent authors chasing the wrong culprit.
          patchActive((active) => ({
            ...active,
            runs: active.runs.map((run) =>
              run.state === 'running' ? { ...run, state: 'interrupted' as const } : run,
            ),
          }));
          setError(friendlyStreamError(code, message));
        },
        onDone: (chatId, threadId) => {
          if (!streamIsLive()) return;
          const id = chatId || turnChatId;
          // This transcript *is* the conversation these ids name, so mark it
          // loaded before the ids land and the loader chases them.
          if (id) {
            loadedConversationRef.current = `${turnDocumentId}:${id}:${
              typeof threadId === 'number' ? threadId : turnThreadId ?? 'latest'
            }`;
          }
          // Through the ref, because attaching the document mid-turn rebuilt
          // these setters around the id the session now has, and the ones this
          // closure captured refuse to write for a document that has moved on.
          if (chatId && chatId !== turnChatId) {
            if (!turnChatId) onChatCreated?.(chatId, text);
            turnChatId = chatId;
            sessionRef.current.setSelectedChatId(chatId);
          }
          if (typeof threadId === 'number' && threadId !== turnThreadId) {
            turnThreadId = threadId;
            sessionRef.current.setSelectedThreadId(threadId);
          }
        },
      };

      // Chosen once per turn: switching engines mid-reply applies to the next.
      const engineRequest = engines.requestFor('chat');
      let result: AgentChatResult | null = null;
      for (;;) {
        recover = null;
        result = await streamAgentChat(
          {
            message: text,
            document_id: turnDocumentId,
            chat_id: turnChatId,
            thread_id: turnThreadId,
            mode: 'assistant',
            context,
            ...engineRequest,
          },
          handlers,
          {
            signal: controller.signal,
            abortBehavior: 'detach',
            resume,
            onRunStarted: (run) => {
              if (streamIsLive()) setLastExchange((exchange) => exchange ? { ...exchange, run } : exchange);
            },
            // The recovered pass already carries its own 401 replay; stacking
            // a fresh pending backoff on top would multiply requests again.
            retry: alreadyRecovered ? { maxAttempts: 1 } : undefined,
          },
        );

        if (!recover || !streamIsLive()) break;

        alreadyRecovered = true;
        if (recover === 'chat') {
          turnChatId = null;
          sessionRef.current.setSelectedChatId(null);
        }
        turnThreadId = null;
        sessionRef.current.setSelectedThreadId(null);
        loadedConversationRef.current = null;
        // The failed attempt reached no tools, but a redelivered id from it
        // must not block the retry's own staging.
        processedToolCallIds.current = new Set();
      }

      if (result && streamIsLive()) {
        if (result.terminal === 'done' && result.usage) {
          const usage = result.usage;
          patchActive((message) => ({ ...message, usage }));
        } else if (result.terminal === null) {
          // The connection closed without `done` or `error`. This used to
          // render as a finished reply — with every pending tool stamped as
          // a success — when the truth is the server was cut off mid-turn.
          setError({
            message:
              'The connection dropped before the assistant finished. The reply above may be incomplete.',
            retryable: true,
          });
        }
      }
    } catch (e) {
      // An aborted stream is a deliberate stop, not a failure to report.
      if (streamIsLive()) {
        const raw = e instanceof Error ? e.message : '';
        const socketActions: Record<string, string> = {
          unauthorized: 'Sign in again to resume this conversation.',
          forbidden: 'The assistant cannot access this conversation. Check your access before reconnecting.',
          not_found: 'This saved conversation or run is no longer available. Open another conversation or start a new one.',
          conflict: 'This conversation changed or already has an active run. Reopen it to check the saved run.',
        };
        const action = e instanceof AgentSocketError && Object.hasOwn(socketActions, e.code)
          ? socketActions[e.code] : undefined;
        setError({
          message: action || 'The assistant connection was interrupted. Reconnect to check the saved run.',
          detail: raw || undefined,
          retryable: !action,
        });
      }
    } finally {
      // A newer send owns the UI now, or this document's assistant has
      // unmounted. The older completion must not clean up the new stream.
      if (
        mountedRef.current
        && (abortRef.current === null || abortRef.current === controller)
      ) {
        setIsStreaming(false);
        if (abortRef.current === controller) abortRef.current = null;
        setAgentStatus(null);
        // A call that never reported completion is unresolved, not done —
        // stamping it 'done' here painted stopped and dropped turns as
        // successes.
        const endedAt = Date.now();
        patchActive((message) => ({
          ...endThinking(message, endedAt),
          runs: message.runs.map((run) =>
            run.state === 'running'
              ? { ...run, state: 'interrupted' as const, argumentsChars: undefined }
              : run,
          ),
        }));
        runningToolsRef.current = new Map();
        activeMessageIdRef.current = null;
        setActiveMessageId(null);
      }
    }
  };

  const onRetry = () => {
    const exchange = lastExchange;
    if (!exchange) return;
    // Drop exactly the failed exchange's rows. Slicing the last two removed
    // whatever happened to be at the end — including replies from turns that
    // had nothing to do with the error.
    setMessages((prev) =>
      prev.filter(
        (m) => m.id !== exchange.userMessageId && m.id !== exchange.assistantMessageId,
      ),
    );
    setError(null);
    void send(exchange.text, exchange.context, exchange.run);
  };

  const onStop = () => {
    abortRef.current?.abort('cancel');
    abortRef.current = null;
    setIsStreaming(false);
    setAgentStatus(null);
  };

  return {
    messages,
    isStreaming,
    error,
    agentStatus,
    activeMessageId,
    lastExchange,
    send,
    resumeRun: (snapshot) => {
      if (snapshot.run) void send(snapshot.run.request.message, snapshot.run.request.context,
        { sessionId: snapshot.session.id, runId: snapshot.run.id });
    },
    onStop,
    onRetry,
    resetChatUI,
    abortRef,
    setMessages,
    setIsStreaming,
    setAgentStatus,
  };
}
