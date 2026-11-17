import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { AssistantCatalogContext } from '@/components/preferences/assistantCatalogContextState';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useQueryClient } from '@tanstack/react-query';
import { invalidatePageBranch } from '@/data/documents';
import { chatPlanQuery } from '@/data/chatPlans';
import { useAgentEngine } from '@/components/preferences/agentEngineContextState';
import { engineName } from '@/components/preferences/agentEngineCopy';
import type { AssistantSnapshot } from '@/api/assistant/agentSessionChat';
import type { AgentEventHandlers } from '@/api/assistant/streamParser';
import type { ToolAction } from '@/editor/types';
import type { DocumentActionsValue, DocumentSessionValue } from '@/editor';
import type { ProposalsContextValue } from '@/editor/proposalsContextState';
import type { AgentProgress } from '@/components/editor/AgentProgress';
import { useAgentRun, type AgentRunSpec, type PreparedRun } from '../AgentRun';
import type { ChatRefPickerHandle } from './ChatRefPicker';
import { emptyMessage, type ChatError, type ChatMessage, type ChatTurnOptions, type LastExchange } from './chatUtils';
import {
  endThinking,
  finishReply,
  interruptRuns,
  withChangeSet,
  withReasoning,
  withClaim,
  withEvidence,
  withLedger,
  withPlan,
  withQuestion,
  withArtifact,
  withSkill,
  withInstructions,
  withTodos,
  withToken,
  withToolArgs,
  withToolEnd,
  withToolProgress,
  withToolStart,
  withWorker,
} from './transcript';
import { checkpointTurn, keepsRunLocator, recoversAsNewChat, resumedTurn } from './turnRecovery';
import type { AssistantRunSummary } from '@/api/schema';
import { assistantRunKeys } from '@/data/assistantRuns';
import type { AutoMode } from './useAutoMode';

type AgentTurnOptions = {
  documentId: DocumentSessionValue['documentId'];
  loadingDocumentId: DocumentSessionValue['loadingDocumentId'];
  restoreEpoch: DocumentSessionValue['restoreEpoch'];
  ensureRemoteDocument: DocumentActionsValue['ensureRemoteDocument'];
  hasPendingEdits: DocumentActionsValue['hasPendingEdits'];
  saveRemote: DocumentActionsValue['saveRemote'];
  selectedChatId: string | null;
  selectedLeafId: number | null;
  setSelectedChatId: (id: string | null) => void;
  setSelectedLeafId: (id: number | null) => void;
  proposals: ProposalsContextValue;
  setInput: Dispatch<SetStateAction<string>>;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  pinnedToBottomRef: MutableRefObject<boolean>;
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
  /**
   * The chat's Auto switch (D18). While it is on, a turn asks for
   * `apply_mode: "auto"`, and the change sets the server stores as `auto`
   * are applied by the editor as they arrive.
   */
  autoMode?: Pick<AutoMode, 'on' | 'startTurn' | 'notePolicy'>;
};

export type AgentTurn = {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: ChatError | null;
  /** What the running turn is doing now, and since when; null when idle. */
  agentStatus: AgentProgress | null;
  activeMessageId: string | null;
  lastExchange: LastExchange | null;
  send: (text: string, options?: ChatTurnOptions) => Promise<void>;
  resumeRun: (snapshot: AssistantSnapshot) => void;
  resumeCheckpoint: (run: AssistantRunSummary, requestId: string) => Promise<void>;
  onStop: () => void;
  onRetry: () => void;
  resetChatUI: (clearMessages?: boolean) => void;
  /**
   * Stop following the running turn without cancelling it: the conversation
   * loader calls it when it takes over the transcript.
   */
  detach: () => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
};

/**
 * useAgentTurn — one turn of the chat: the transcript it writes, on the
 * shared run driver (`useAgentRun`), with the chat's own recovery
 * (`turnRecovery`). Its updates of the reply are `transcript`'s.
 */
export function useAgentTurn({
  documentId,
  loadingDocumentId,
  restoreEpoch,
  ensureRemoteDocument,
  hasPendingEdits,
  saveRemote,
  selectedChatId,
  selectedLeafId,
  setSelectedChatId,
  setSelectedLeafId,
  proposals,
  setInput,
  setAtBottom,
  pinnedToBottomRef,
  refPickerRef,
  loadedConversationRef,
  onChatCreated,
  autoMode,
}: AgentTurnOptions): AgentTurn {
  const engines = useAgentEngine();
  const catalog = useContext(AssistantCatalogContext);
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const run = useAgentRun({
    surface: 'chat',
    document: { documentId, ensureRemoteDocument, hasPendingEdits, saveRemote },
  });
  const { detach } = run;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<ChatError | null>(null);
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
    selectedLeafId,
    setSelectedChatId,
    setSelectedLeafId,
  });
  useLayoutEffect(() => {
    documentIdRef.current = documentId;
    sessionRef.current = {
      selectedChatId,
      selectedLeafId,
      setSelectedChatId,
      setSelectedLeafId,
    };
  }, [documentId, selectedChatId, selectedLeafId, setSelectedChatId, setSelectedLeafId]);

  /**
   * Auto as it is now. A turn asks for it when it starts a run, and a set
   * that arrives later is applied only if Auto is still on then: turning it
   * off mid-reply leaves the rest of the reply's edits waiting.
   */
  const autoRef = useRef(autoMode);
  useLayoutEffect(() => {
    autoRef.current = autoMode;
  }, [autoMode]);
  const autoApply = useCallback(() => autoRef.current?.on === true, []);

  const mountedRef = useRef(true);
  /** Bumped by every send: an older turn's completion must not clean up a newer one. */
  const turnRef = useRef(0);
  /** The turn the author pressed Stop on, so its reply reads "Stopped" (a detach is not a Stop). */
  const stopRequestedRef = useRef<number | null>(null);
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
    detach();
    refPickerRef.current?.close();
  }, [detach, loadingDocumentId, refPickerRef]);

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
    detach();
  }, [detach, restoreEpoch]);

  // The document-keyed assistant remounts on navigation so its transcript is
  // scoped to one document; the driver stops the stream as it unmounts.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const patchActive = useCallback((update: (message: ChatMessage) => ChatMessage) => {
    const id = activeMessageIdRef.current;
    if (!id) return;
    setMessages((prev) => prev.map((m) => (m.id === id ? update(m) : m)));
  }, []);

  const resetChatUI = useCallback((clearMessages = true) => {
    detach();
    setError(null);
    setInput('');
    activeMessageIdRef.current = null;
    setActiveMessageId(null);
    if (clearMessages) setMessages([]);
  }, [detach, setInput]);

  /**
   * Hand a streamed document mutation to the review layer.
   *
   * Nothing is applied here. The agent's operations are stored server-side
   * and the author accepts or rejects each one on the block it affects — a
   * rewrite cannot be judged from a chat bubble, only against the paragraph
   * it replaces. With Auto on, the review layer accepts a set the server
   * stored as `auto` itself, the same way.
   */
  const onToolAction = useCallback(
    (action: ToolAction) => {
      if (!mountedRef.current) return;

      // Tool events name the document they were produced against. Never stage
      // one in a different active document, even if a transport delivers it
      // after the stream was aborted.
      //
      // Creating a document is the exception: `doc_create` names the document
      // it has just made, which is never the one on screen. The review layer
      // scopes the two halves — operations to this document, invitations to
      // the one that was created.
      const announcesNewDocument = action.actions.some(
        (op) => op.op === 'create_document',
      );
      if (action.documentId !== documentIdRef.current && !announcesNewDocument) return;
      // The new page lives beside its source page: that branch of the tree reads again.
      if (announcesNewDocument && action.status === 'applied') {
        void invalidatePageBranch(queryClient, workspaceId, action.collectionId ?? null);
      }

      // Only a genuine redelivery is a duplicate. The id alone is not enough:
      // providers that number tool calls per request reuse `call_0`, and some
      // send none at all. A stored proposal carries no operations (the review
      // layer fetches them by id), so its change-set id tells two apart.
      const dedupKey = `${action.toolCallId}:${action.status}:${action.changeSetId ?? ''}:${JSON.stringify(action.actions)}`;
      if (processedToolCallIds.current.has(dedupKey)) return;
      processedToolCallIds.current.add(dedupKey);

      proposals.receive(action, { autoApply });

      if (action.status === 'error') {
        setError({
          message: action.message || 'The assistant could not complete that edit.',
          retryable: false,
        });
      }

      const changeSetId = action.status === 'proposed' ? action.changeSetId : null;
      if (changeSetId) patchActive((message) => withChangeSet(message, changeSetId));
    },
    [autoApply, patchActive, proposals, queryClient, workspaceId],
  );

  /**
   * Send a turn. With `preset` (a server chat preset's id), `text` is only
   * what the conversation shows, the preset's label: the server supplies the
   * instruction, and the message carries no words of the author's.
   */
  const send = async (text: string, options: ChatTurnOptions = {}) => {
    const { context, attachments, resume, checkpoint, preset, effort, web = false, plan_id, plan, answers, displayText } = options;
    if ((!text && !attachments?.length && !preset && !plan_id && !answers && !checkpoint) || run.isRunning() || loadingDocumentId) return;

    setError(null);
    setInput('');
    // Why the server paused Auto was about the previous message.
    autoRef.current?.startTurn();
    pinnedToBottomRef.current = true;
    setAtBottom(true);
    // Tool-call ids are only unique within a run for some providers.
    processedToolCallIds.current = new Set();
    const turn = (turnRef.current += 1);
    const current = () => mountedRef.current && turnRef.current === turn;

    // A reattached run started before this browser saw it: its timings are
    // not this turn's to measure.
    const sentAt = Date.now();
    const timed = !resume;
    const promptText = displayText ?? text;
    const userMessage: ChatMessage = {
      ...emptyMessage('user', promptText, attachments, resume?.runId), createdAt: sentAt, ...(preset ? { preset } : {}),
      ...(effort ? { effort } : {}), ...(plan_id ? { planId: plan_id } : {}),
      web,
    };
    const assistantMessage = emptyMessage('assistant');
    setLastExchange({
      text,
      context,
      attachments,
      ...(preset ? { preset } : {}),
      effort, web, plan_id, plan, answers, displayText, checkpoint,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      run: resume,
    });
    activeMessageIdRef.current = assistantMessage.id;
    setActiveMessageId(assistantMessage.id);
    setMessages((prev) => {
      if (resume) {
        // Every message a run wrote carries the run's id.
        const matchesRun = (message: ChatMessage | undefined) =>
          message?.role === 'user' && message.runId === resume.runId;
        const last = prev.at(-1);
        if (last && matchesRun(last)) {
          return [...prev.slice(0, -1), { ...last, id: userMessage.id, runId: resume.runId }, assistantMessage];
        }
        const prompt = prev.at(-2);
        if (last?.role === 'assistant' && prompt && matchesRun(prompt)) {
          return [...prev.slice(0, -2), { ...prompt, id: userMessage.id, runId: resume.runId }, assistantMessage];
        }
      }
      return [...prev, userMessage, assistantMessage];
    });

    // Captured for the whole turn. A conversation belongs to the document it
    // was started on; nothing below may silently move it to another one.
    let turnDocumentId = documentIdRef.current;
    let turnChatId = sessionRef.current.selectedChatId;
    let turnLeafId = sessionRef.current.selectedLeafId;
    let recovered = false;
    const resumed = Boolean(resume || checkpoint);

    const handlers = (prepared: PreparedRun): AgentEventHandlers => {
      turnDocumentId = prepared.documentId;
      return {
        onSessionChat: (chatId) => {
          loadedConversationRef.current = `${turnDocumentId}:${chatId}:${turnLeafId ?? 'latest'}`;
          if (chatId !== turnChatId) {
            if (!turnChatId) onChatCreated?.(chatId, promptText);
            turnChatId = chatId;
            sessionRef.current.setSelectedChatId(chatId);
          }
        },
        onTodo: (todos) => patchActive((message) => withTodos(message, todos)),
        onSkill: (skill) => patchActive((message) => withSkill(message, skill)),
        onInstructions: (items) => patchActive((message) => withInstructions(message, items)),
        onSubagent: (worker) => patchActive((message) => withWorker(message, worker)),
        onToken: (content) => {
          const now = Date.now();
          patchActive((message) => withToken(message, content, now, timed ? now - sentAt : null));
        },
        onReasoning: (content) => {
          const now = Date.now();
          patchActive((message) => withReasoning(message, content, now));
        },
        onApplyPolicy: (policy, reason) => {
          // The strip says at once when the server refused Auto for this run,
          // and the reply keeps why: a run can switch to review partway
          // through, and its later sets then wait (the server stores them
          // as `review`, which the review layer reads).
          autoRef.current?.notePolicy(policy, reason);
          if (policy === 'review' && reason && autoApply()) {
            patchActive((message) => (message.autoPaused === reason ? message : { ...message, autoPaused: reason }));
          }
        },
        onToolCallStart: (tool, toolCallId, display) => {
          const now = Date.now();
          // Providers that send no call id still need a distinct row key.
          const id = toolCallId || `${tool}:anonymous-${(anonymousCallsRef.current += 1)}`;
          patchActive((message) => withToolStart(endThinking(message, now), { id, tool, display }, now));
        },
        onToolCallProgress: (event) => patchActive((message) => withToolProgress(message, event)),
        onToolCallArgs: (event) => patchActive((message) => withToolArgs(message, event)),
        onToolCallEnd: (event) => patchActive((message) => withToolEnd(message, event)),
        onToolAction,
        onEvidence: (evidence) => patchActive((message) => withEvidence(message, evidence)),
        onClaim: (claim) => patchActive((message) => withClaim(message, claim)),
        onPlan: (plan) => patchActive((message) => withPlan(message, plan)),
        onQuestion: (question) => patchActive((message) => withQuestion(message, question)),
        onArtifact: (artifact) => patchActive((message) => withArtifact(message, artifact)),
        onBudget: (ledger) => patchActive((message) => withLedger(message, ledger)),
        onError: (code) => {
          if (plan_id && turnDocumentId && turnChatId && (code === 'STALE_PLAN' || code === 'PLAN_NOT_FOUND')) {
            void queryClient.invalidateQueries({ queryKey: chatPlanQuery({
              workspaceId, documentId: turnDocumentId, chatId: turnChatId, planId: plan_id,
            }).queryKey });
          }
          if (!keepsRunLocator(code)) {
            setLastExchange((exchange) => exchange ? { ...exchange, run: undefined, checkpoint: undefined } : exchange);
          }
        },
        onDone: ({ chatId, messageId, usage, models, cost, budget, persistence }) => {
          // What served the reply, what it used and cost, and its cost
          // ceiling and the limit it reached, as its record keeps them; the
          // failed writes, which it does not.
          patchActive((message) => ({ ...message, usage, models, cost, budget, persistence }));
          const id = chatId || turnChatId;
          // This transcript *is* the conversation these ids name, so mark it
          // loaded before the ids land and the loader chases them.
          if (id) {
            loadedConversationRef.current = `${turnDocumentId}:${id}:${
              typeof messageId === 'number' ? messageId : turnLeafId ?? 'latest'
            }`;
          }
          // Through the ref, because attaching the document mid-turn rebuilt
          // these setters around the id the session now has, and the ones this
          // closure captured refuse to write for a document that has moved on.
          if (chatId && chatId !== turnChatId) {
            if (!turnChatId) onChatCreated?.(chatId, promptText);
            turnChatId = chatId;
            sessionRef.current.setSelectedChatId(chatId);
          }
          // The answer is the chat's new leaf: the next turn continues from it.
          if (typeof messageId === 'number' && messageId !== turnLeafId) {
            turnLeafId = messageId;
            sessionRef.current.setSelectedLeafId(messageId);
          }
        },
      };
    };

    const spec = (): AgentRunSpec => ({
      request: {
        message: preset ? '' : text,
        ...(preset ? { preset } : {}),
        effort, web, plan_id, plan, answers,
        chat_id: turnChatId,
        leaf_id: turnLeafId,
        context,
        ...(attachments?.length ? { attachments } : {}),
        // Asked, not granted: the server decides per run (D18).
        ...(autoApply() ? { apply_mode: 'auto' as const } : {}),
      },
      handlers,
      resume,
      checkpoint,
      onPrepared: ({ engine: engineRequest }) => {
        // Named under the reply only when the author chose it: the server's
        // default needs no label.
        const chosenEngine = engineRequest.engine ?? (engineRequest.gateway_models?.main ? 'gateway' : null);
        if (!timed || checkpoint || !chosenEngine) return;
        const model = engineRequest.engine ? engineRequest.model : engineRequest.gateway_models?.main;
        const engine = { name: engineName(chosenEngine, engines.statusOf(chosenEngine)), ...(model ? { model } : {}) };
        patchActive((message) => ({ ...message, engine }));
      },
      onRunStarted: (started) => {
        setLastExchange((exchange) => exchange ? { ...exchange, run: started } : exchange);
        if (started.runId) setMessages((rows) => rows.map((message) =>
          message.id === userMessage.id || message.id === assistantMessage.id ? { ...message, runId: started.runId } : message));
        void queryClient.invalidateQueries({ queryKey: assistantRunKeys(workspaceId) });
      },
      // The recovered pass already carries its own 401 replay; stacking a
      // fresh pending backoff on top would multiply requests again.
      retry: recovered ? { maxAttempts: 1 } : undefined,
    });

    let outcome = await run.start(spec());
    if (current() && !plan_id && recoversAsNewChat(outcome, { resumed, recovered })) {
      recovered = true;
      turnChatId = null;
      sessionRef.current.setSelectedChatId(null);
      turnLeafId = null;
      sessionRef.current.setSelectedLeafId(null);
      loadedConversationRef.current = null;
      // The failed attempt reached no tools, but a redelivered id from it
      // must not block the retry's own staging.
      processedToolCallIds.current = new Set();
      outcome = await run.start(spec());
    }

    // A newer send owns the UI now, or this document's assistant has
    // unmounted: the older completion must not clean up the new turn.
    if (!current()) return;
    // A reply that did not complete says how it ended, as its record will
    // after a reload: the author's Stop (here or in another tab) is
    // "Stopped"; anything else failed, and the alert says why.
    if (outcome.status === 'stopped' && stopRequestedRef.current === turn) {
      patchActive((message) => ({ ...message, ended: 'stopped' }));
    }
    if (outcome.status === 'failed') {
      patchActive(interruptRuns);
      patchActive((message) => ({ ...message, ended: outcome.code === 'AGENT_CANCELLED' ? 'stopped' : 'failed' }));
      setError(plan_id && outcome.code === 'CHAT_NOT_FOUND'
        ? { message: 'This plan belongs to a conversation that is no longer available. Start a new chat.', retryable: false }
        : outcome.error);
      if (outcome.code === 'RUN_NOT_RESUMABLE') {
        setLastExchange((exchange) => exchange ? { ...exchange, run: undefined, checkpoint: undefined } : exchange);
      }
    }
    void queryClient.invalidateQueries({ queryKey: assistantRunKeys(workspaceId) });
    const endedAt = Date.now();
    patchActive((message) => finishReply(message, endedAt, timed ? endedAt - sentAt : null));
    activeMessageIdRef.current = null;
    setActiveMessageId(null);
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
    // A resumed row can carry richer canonical metadata than the saved run's
    // request references. Keep those filenames through a reconnect retry.
    const attachments = messages.find((message) => message.id === exchange.userMessageId)?.attachments ?? exchange.attachments;
    void send(exchange.text, {
      context: exchange.context, attachments, resume: exchange.run?.runId || !exchange.checkpoint ? exchange.run : undefined,
      checkpoint: exchange.run?.runId ? undefined : exchange.checkpoint, preset: exchange.preset,
      effort: exchange.effort, web: exchange.web, plan_id: exchange.plan_id, plan: exchange.plan, answers: exchange.answers,
      displayText: messages.find((message) => message.id === exchange.userMessageId)?.content ?? exchange.displayText,
    });
  };

  return {
    messages,
    isStreaming: run.running,
    error,
    agentStatus: run.progress,
    activeMessageId,
    lastExchange,
    send,
    resumeRun: (snapshot) => {
      const preset = snapshot.run?.request.preset;
      const resumedRun = resumedTurn(snapshot, preset ? catalog?.preset(preset)?.label : undefined);
      if (resumedRun) {
        const { text, ...options } = resumedRun;
        void send(text, options);
      }
    },
    resumeCheckpoint: async (summary, requestId) => {
      const preset = summary.request?.preset;
      const next = checkpointTurn(summary, requestId, preset ? catalog?.preset(preset)?.label : undefined);
      if (next) {
        const { text, ...options } = next;
        await send(text, options);
      }
    },
    onStop: () => {
      stopRequestedRef.current = turnRef.current;
      run.stop();
    },
    onRetry,
    resetChatUI,
    detach,
    setMessages,
  };
}
