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
import { streamAgentChat, type AgentChatResult } from '@/services/agentChat';
import type { SSEEventHandlers } from '@/services/streamParser';
import type { ToolAction } from '@/editor/types';
import type { EditorContextValue } from '@/editor/editorContextState';
import type { ProposalsContextValue } from '@/editor/proposalsContextState';
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
};

export type AgentTurn = {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: ChatError | null;
  agentStatus: { status: string; detail: string } | null;
  activeMessageId: string | null;
  lastExchange: LastExchange | null;
  send: (text: string) => Promise<void>;
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
  setAgentStatus: Dispatch<SetStateAction<{ status: string; detail: string } | null>>;
};

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
}: AgentTurnOptions): AgentTurn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [agentStatus, setAgentStatus] = useState<{ status: string; detail: string } | null>(null);

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

  const send = async (text: string) => {
    if (!text || isStreaming || loadingDocumentId) return;

    setError(null);
    setInput('');
    setAgentStatus(null);
    pinnedToBottom.current = true;
    setAtBottom(true);
    // Tool-call ids are only unique within a run for some providers.
    processedToolCallIds.current = new Set();

    const userMessage = emptyMessage('user', text);
    const assistantMessage = emptyMessage('assistant');
    setLastExchange({
      text,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
    });
    activeMessageIdRef.current = assistantMessage.id;
    setActiveMessageId(assistantMessage.id);
    setMessages((prev) => [...prev, userMessage, assistantMessage]);

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
        setAgentStatus({
          status: 'attaching',
          detail: 'Saving this document so the assistant can work on it…',
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
        setAgentStatus(null);
      } else if (hasPendingEdits()) {
        // The agent reads the *stored* document. Edits sit in this browser for
        // five seconds before autosave takes them, which is long enough to ask
        // a question about a paragraph the server has never seen — and to get
        // back a rewrite of the version the author had already replaced.
        setAgentStatus({ status: 'saving', detail: 'Saving your latest edits…' });
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
        setAgentStatus(null);
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
        onToken: (content) => {
          if (!streamIsLive()) return;
          setAgentStatus(null);
          patchActive((message) => ({ ...message, content: message.content + content }));
        },
        onStatus: (status, detail) => {
          if (!streamIsLive()) return;
          setAgentStatus({ status, detail });
        },
        onToolCallStart: (tool, toolCallId, args) => {
          if (!streamIsLive()) return;
          // The activity list below spells this out step by step; the status
          // line is only there so something moves before the first token.
          setAgentStatus({ status: 'executing_tool', detail: `${toolRunningLabel(tool)}…` });
          patchActive((message) => ({
            ...message,
            runs: [
              ...message.runs,
              {
                id: toolCallId || `${tool}:${message.runs.length}`,
                tool,
                state: 'running',
                detail: toolRunDetail(tool, args),
              },
            ],
          }));
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
              detail:
                existing.detail
                ?? (event.arguments ? toolRunDetail(event.tool, event.arguments) : undefined),
            };
            return { ...message, runs };
          });
        },
        onToolCallEnd: (event) => {
          if (!streamIsLive()) return;
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
        onError: (code, message) => {
          if (!streamIsLive()) return;
          if (!alreadyRecovered && (code === 'CHAT_NOT_FOUND' || code === 'THREAD_NOT_FOUND')) {
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
            turnChatId = chatId;
            sessionRef.current.setSelectedChatId(chatId);
          }
          if (typeof threadId === 'number' && threadId !== turnThreadId) {
            turnThreadId = threadId;
            sessionRef.current.setSelectedThreadId(threadId);
          }
        },
      };

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
          },
          handlers,
          {
            signal: controller.signal,
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
        setError({
          message: 'The assistant request failed before a reply could start.',
          detail: raw || undefined,
          retryable: true,
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
        patchActive((message) => ({
          ...message,
          runs: message.runs.map((run) =>
            run.state === 'running' ? { ...run, state: 'interrupted' as const } : run,
          ),
        }));
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
    send(exchange.text);
  };

  const onStop = () => {
    abortRef.current?.abort();
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
    onStop,
    onRetry,
    resetChatUI,
    abortRef,
    setMessages,
    setIsStreaming,
    setAgentStatus,
  };
}
