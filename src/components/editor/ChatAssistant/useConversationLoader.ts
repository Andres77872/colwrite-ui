import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { findActiveAgentRun, type AssistantSnapshot } from '@/api/assistant/agentSessionChat';
import { listMessages } from '@/data/chats';
import { isRetryableProblem } from '@/api/retry';
import { ApiError, describeApiError } from '@/api/errors';
import type { DocumentSessionValue } from '@/editor';
import { historyMessages, type ChatMessage } from './chatUtils';

/**
 * Why a conversation is not on screen. Kept apart from {@link ChatError}: this
 * one is about opening the transcript, and its action is to try that again.
 */
export type ConversationNotice = { message: string; preparing: boolean };

type ConversationLoaderOptions = {
  onResumeRun?: (snapshot: AssistantSnapshot) => void;
  /** Return true when an explicit checkpoint action takes over the loaded
   * transcript, rather than observational active-run reattachment. */
  onLoaded?: () => boolean;
  /**
   * The selected chat does not exist on this page (the server answered 404):
   * it was deleted, here or on another device. The caller drops the selection.
   */
  onChatGone?: () => void;
  workspaceId: string;
  documentId: DocumentSessionValue['documentId'];
  selectedChatId: string | null;
  selectedLeafId: number | null;
  setSelectedLeafId: (id: number | null) => void;
  /** Stop following the running turn, without cancelling it: a load takes over the transcript. */
  detachRun: () => void;
  /** The claim key below, shared with the turn so a finished stream can pre-claim it. */
  loadedConversationRef: MutableRefObject<string | null>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
};

export type ConversationLoader = {
  conversationNotice: ConversationNotice | null;
  reloadConversation: () => void;
};

/**
 * useConversationLoader — fetch the transcript of the conversation the author
 * switched to: the branch that ends at the selected leaf message, or the
 * chat's newest branch.
 */
export function useConversationLoader({
  onResumeRun,
  onLoaded,
  onChatGone,
  workspaceId,
  documentId,
  selectedChatId,
  selectedLeafId,
  setSelectedLeafId,
  detachRun,
  loadedConversationRef,
  setMessages,
}: ConversationLoaderOptions): ConversationLoader {
  const resumeRun = useEffectEvent((snapshot: AssistantSnapshot) => onResumeRun?.(snapshot));
  const loaded = useEffectEvent(() => onLoaded?.() ?? false);
  const chatGone = useEffectEvent(() => onChatGone?.());

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

    const key = `${documentId}:${selectedChatId}:${selectedLeafId ?? 'latest'}`;
    if (loadedConversationRef.current === key) return;
    loadedConversationRef.current = key;

    const controller = new AbortController();
    /**
     * The key above is a claim on loading this conversation. A run torn down
     * before it delivers has to hand the claim back, or the next run sees the
     * key already taken and returns — which under StrictMode's
     * setup/cleanup/setup left the transcript permanently empty. An explicit
     * flag rather than comparing keys: when `selectedLeafId` is already a
     * number the key written on success is byte-identical to this one, so it
     * cannot tell "loaded" from "claimed and abandoned".
     */
    let settled = false;

    (async () => {
      detachRun();

      try {
        const transport = { signal: controller.signal };
        // The branch that ends at the selected leaf; without one, the server
        // answers the chat's newest message and says which it is. A queued run
        // can exist before its first message, so even an empty chat continues
        // to the durable-run lookup below.
        const res = await listMessages(workspaceId, documentId, selectedChatId, selectedLeafId, transport);
        if (controller.signal.aborted) return;

        const resolvedLeaf = res.leaf_id;
        loadedConversationRef.current = `${documentId}:${selectedChatId}:${resolvedLeaf ?? 'latest'}`;
        settled = true;
        setConversationNotice(null);

        const history = historyMessages(res.items);
        // A conversation the server has nothing for does not overwrite one the
        // author can see: that reads as the transcript being thrown away.
        setMessages((prev) => (history.length === 0 && prev.length > 0 ? prev : history));
        if (typeof resolvedLeaf === 'number') setSelectedLeafId(resolvedLeaf);
        if (loaded()) return;
        // Restoring is observational: never creates another model turn.
        let active: AssistantSnapshot | null = null;
        try { active = await findActiveAgentRun(workspaceId, documentId, selectedChatId, controller.signal); }
        catch { /* Stored chat remains useful while the socket is unavailable. */ }
        if (controller.signal.aborted) return;
        if (active?.run) resumeRun(active);
      } catch (e) {
        if (controller.signal.aborted) return;
        settled = true;
        if (e instanceof ApiError && e.status === 404) {
          setConversationNotice(null);
          chatGone();
          return;
        }
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
    workspaceId,
    documentId,
    selectedChatId,
    selectedLeafId,
    setSelectedLeafId,
    conversationReloadTick,
    detachRun,
    loadedConversationRef,
    setMessages,
  ]);

  return { conversationNotice, reloadConversation };
}
