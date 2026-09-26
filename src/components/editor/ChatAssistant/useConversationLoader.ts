import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { findActiveAgentRun, type AssistantSnapshot } from '@/services/agentSessionChat';
import { listMessages, listThreads } from '@/services/chats';
import { isRetryableProblem } from '@/services/retry';
import { describeApiError } from '@/services/contracts';
import type { EditorContextValue } from '@/editor/editorContextState';
import type { AgentProgress } from '@/components/editor/AgentProgress';
import { emptyMessage, type ChatMessage } from './chatUtils';

/**
 * Why a conversation is not on screen. Kept apart from {@link ChatError}: this
 * one is about opening the transcript, and its action is to try that again.
 */
export type ConversationNotice = { message: string; preparing: boolean };

type ConversationLoaderOptions = {
  onResumeRun?: (snapshot: AssistantSnapshot) => void;
  documentId: EditorContextValue['documentId'];
  selectedChatId: string | null;
  selectedThreadId: number | null;
  setSelectedThreadId: (id: number | null) => void;
  /** The turn's stream controller, aborted when a load takes over the transcript. */
  abortRef: MutableRefObject<AbortController | null>;
  /** The claim key below, shared with the turn so a finished stream can pre-claim it. */
  loadedConversationRef: MutableRefObject<string | null>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setAgentStatus: Dispatch<SetStateAction<AgentProgress | null>>;
};

export type ConversationLoader = {
  conversationNotice: ConversationNotice | null;
  reloadConversation: () => void;
};

/**
 * useConversationLoader — fetch the transcript of the conversation the author
 * switched to, pivoting onto the latest thread.
 */
export function useConversationLoader({
  onResumeRun,
  documentId,
  selectedChatId,
  selectedThreadId,
  setSelectedThreadId,
  abortRef,
  loadedConversationRef,
  setMessages,
  setIsStreaming,
  setAgentStatus,
}: ConversationLoaderOptions): ConversationLoader {
  const resumeRun = useEffectEvent((snapshot: AssistantSnapshot) => onResumeRun?.(snapshot));

  /** Bumped by the notice's Retry button. There is no automatic ladder. */
  const [conversationReloadTick, setConversationReloadTick] = useState(0);
  const [conversationNotice, setConversationNotice] = useState<ConversationNotice | null>(null);

  const reloadConversation = useCallback(() => {
    loadedConversationRef.current = null;
    setConversationReloadTick((tick) => tick + 1);
  }, [loadedConversationRef]);

  /**
   * Load a conversation the author switched to.
   *
   * Keyed, because the ids this effect watches are also the ids the panel sets
   * itself at the end of every turn. Without the key it refetched the
   * conversation it had just streamed and replaced it with the server's plain
   * transcript — which carries no tool activity and no record of what was
   * proposed, so both vanished from the reply a second after arriving.
   */
  useEffect(() => {
    if (!documentId || !selectedChatId) return;

    const key = `${documentId}:${selectedChatId}:${selectedThreadId ?? 'latest'}`;
    if (loadedConversationRef.current === key) return;
    loadedConversationRef.current = key;

    const controller = new AbortController();
    /**
     * The key above is a claim on loading this conversation. A run torn down
     * before it delivers has to hand the claim back, or the next run sees the
     * key already taken and returns — which under StrictMode's
     * setup/cleanup/setup left the transcript permanently empty. An explicit
     * flag rather than comparing keys: when `selectedThreadId` is already a
     * number the key written on success is byte-identical to this one, so it
     * cannot tell "loaded" from "claimed and abandoned".
     */
    let settled = false;

    (async () => {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsStreaming(false);
      setAgentStatus(null);

      try {
        const transport = { signal: controller.signal };

        let pivot = typeof selectedThreadId === 'number' ? selectedThreadId : undefined;
        if (pivot === undefined) {
          const threads = await listThreads(documentId, selectedChatId, 100, 0, transport);
          const ids = (threads.threads ?? [])
            .map((t) => t.id)
            .filter((n): n is number => typeof n === 'number');
          if (ids.length) pivot = Math.max(...ids);
        }
        if (controller.signal.aborted) return;
        // A queued run can exist before its first transcript row. Even an
        // empty chat must continue to the durable-run lookup below.
        const res = pivot === undefined
          ? null
          : await listMessages(documentId, selectedChatId, pivot, transport);
        if (controller.signal.aborted) return;

        const resolvedPivot = typeof res?.pivotThreadId === 'number' ? res.pivotThreadId : pivot;
        loadedConversationRef.current = `${documentId}:${selectedChatId}:${resolvedPivot ?? 'latest'}`;
        settled = true;
        setConversationNotice(null);

        const history = (res?.messages ?? []).map((m) =>
          emptyMessage(
            m.role,
            // Legacy rows can still carry EXTRAS_JSON envelopes.
            m.content?.replace(/<EXTRAS_JSON>[\s\S]*?<\/EXTRAS_JSON>/g, '') ?? '',
            m.attachments,
            m.run_id,
          ),
        );
        // A conversation the server has nothing for does not overwrite one the
        // author can see: that reads as the transcript being thrown away.
        setMessages((prev) => (history.length === 0 && prev.length > 0 ? prev : history));
        // Restoring is observational: never creates another model turn.
        let active: AssistantSnapshot | null = null;
        try { active = await findActiveAgentRun(documentId, selectedChatId, controller.signal); }
        catch { /* Stored chat remains useful while the socket is unavailable. */ }
        if (controller.signal.aborted) return;
        if (typeof resolvedPivot === 'number') setSelectedThreadId(resolvedPivot);
        if (active?.run) resumeRun(active);
      } catch (e) {
        if (controller.signal.aborted) return;
        settled = true;
        // Its own notice rather than `setError`: that alert's button resends
        // the last message, which is not what failed here.
        setConversationNotice({
          message: describeApiError(e, 'Could not load this conversation.'),
          preparing: isRetryableProblem(e),
        });
      }
    })();

    return () => {
      controller.abort();
      if (!settled && loadedConversationRef.current === key) loadedConversationRef.current = null;
    };
  }, [
    documentId,
    selectedChatId,
    selectedThreadId,
    setSelectedThreadId,
    conversationReloadTick,
    abortRef,
    loadedConversationRef,
    setMessages,
    setIsStreaming,
    setAgentStatus,
  ]);

  return { conversationNotice, reloadConversation };
}
