import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor } from '@/editor';
import { deleteChat, listChats, updateChatTitle, type ChatItem } from '@/services/chats';
import { describeApiError } from '@/services/contracts';
import { isRetryableProblem } from '@/services/retry';
import { useChatSessions } from '@/components/chat/chatSessionsState';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';

export const CHATS_PAGE_SIZE = 10;

/**
 * Chats are stored against the document id, so the list can only be read once
 * the document has one. A server that is still catching up says so with a
 * retryable problem — a wait, not a failure, and worth saying so.
 */
export type ChatListError = { message: string; preparing: boolean };

export type ChatHistory = {
  documentId: string | null;
  items: ChatItem[];
  count: number;
  page: number;
  totalPages: number;
  setPage: (page: number) => void;
  loading: boolean;
  listError: ChatListError | null;
  reload: () => void;
  rename: (chatId: string, title: string) => Promise<void>;
  /** Asks first; resolves true once the chat is gone. */
  remove: (chat: ChatItem) => Promise<boolean>;
};

export function chatLabel(chat: ChatItem): string {
  return chat.title?.trim() || 'Untitled chat';
}

/**
 * The chat list for the open document: load, page, rename, delete.
 *
 * Owned by the assistant, which names the conversation on screen from it and
 * hands it to the chat switcher's list. A new conversation needs no call here:
 * the first message of a cleared transcript starts one on the server.
 */
export function useChatHistory(): ChatHistory {
  const { documentId } = useEditor();
  const { selectedChatId, setSelectedChatId, setSelectedThreadId } = useChatSessions();
  const confirm = useConfirm();
  const { toast } = useToast();

  const [items, setItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Background list loads report in place; toasts are reserved for actions the
  // user actually initiated (create, delete, rename).
  const [listError, setListError] = useState<ChatListError | null>(null);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  /** The document whose list has been read at least once. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /** Bumped to re-run the load effect — the single way the list is fetched. */
  const [refreshTick, setRefreshTick] = useState(0);
  const reload = useCallback(() => setRefreshTick((tick) => tick + 1), []);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(count / CHATS_PAGE_SIZE)), [count]);

  // A first message creates its chat on the server, and the assistant selects
  // it when the turn finishes. A selected id the loaded list does not have is
  // read for once more — a dependency of the loader below — so the switcher
  // can name the conversation it is showing. It stays the same id if that read
  // does not find it either, so this never loops.
  const unlistedChatId =
    loadedFor === documentId && selectedChatId && !items.some((chat) => chat.chat_id === selectedChatId)
      ? selectedChatId
      : null;

  // One loader. There used to be a second, callable copy for the action
  // buttons; it shared no cancellation with this one, so the two could race
  // and the earlier `finally` would clear the later request's loading state.
  // Everything now goes through `reload()`.
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      if (!documentId) {
        setItems([]);
        setCount(0);
        return;
      }
      setLoading(true);
      try {
        // Keep the request on the asynchronous side of the effect boundary:
        // StrictMode sets up, tears down and sets up again inside one commit,
        // and a request sent synchronously would go out before its own cleanup
        // could abort it — two real requests, each amplified by the transport's
        // retry ladder.
        await Promise.resolve();
        if (controller.signal.aborted) return;

        const res = await listChats(documentId, CHATS_PAGE_SIZE, (page - 1) * CHATS_PAGE_SIZE, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setItems(res.chats ?? []);
        setCount(res.count ?? 0);
        setListError(null);
        setLoadedFor(documentId);
      } catch (error) {
        if (controller.signal.aborted) return;
        setListError({
          message: describeApiError(error, 'Request failed'),
          preparing: isRetryableProblem(error),
        });
        setItems([]);
        setCount(0);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      // Also aborts the api layer's backoff sleep, which used to run on past
      // a document switch with nothing left to receive it.
      controller.abort();
    };
  }, [documentId, page, refreshTick, unlistedChatId]);

  const remove = useCallback(
    async (chat: ChatItem) => {
      if (!documentId) return false;
      const ok = await confirm({
        title: `Delete “${chatLabel(chat)}”?`,
        description: 'The conversation and its messages are removed permanently.',
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return false;

      setLoading(true);
      try {
        await deleteChat(documentId, chat.chat_id);
        if (selectedChatId === chat.chat_id) {
          setSelectedChatId(null);
          setSelectedThreadId(null);
        }
        const nextPage = Math.min(
          page,
          Math.max(1, Math.ceil(Math.max(0, count - 1) / CHATS_PAGE_SIZE)),
        );
        setPage(nextPage);
        reload();
        return true;
      } catch (error) {
        toast({
          title: 'Could not delete chat',
          description: error instanceof Error ? error.message : undefined,
          variant: 'error',
        });
        return false;
      } finally {
        setLoading(false);
      }
    },
    [confirm, count, documentId, page, reload, selectedChatId, setSelectedChatId, setSelectedThreadId, toast],
  );

  const rename = useCallback(
    async (chatId: string, title: string) => {
      if (!documentId) return;
      try {
        await updateChatTitle(documentId, chatId, title.trim());
        reload();
      } catch (error) {
        toast({
          title: 'Could not rename chat',
          description: error instanceof Error ? error.message : undefined,
          variant: 'error',
        });
      }
    },
    [documentId, reload, toast],
  );

  return {
    documentId,
    items,
    count,
    page,
    totalPages,
    setPage,
    loading,
    listError,
    reload,
    rename,
    remove,
  };
}
