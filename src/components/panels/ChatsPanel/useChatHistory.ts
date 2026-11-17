import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDocumentId } from '@/editor';
import { chatListQuery, useDeleteChat, useRenameChat, type ChatItem } from '@/data/chats';
import { describeApiError } from '@/api/errors';
import { isRetryableProblem } from '@/api/retry';
import { useChatSessions } from '@/components/chat/chatSessionsState';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';

export const CHATS_PAGE_SIZE = 10;
/** The API's largest page; "Show more" stops here. */
const MAX_CHATS = 50;

/**
 * Chats are stored against the document id, so the list can only be read once
 * the document has one. A server that is still catching up says so with a
 * retryable problem — a wait, not a failure, and worth saying so.
 */
export type ChatListError = { message: string; preparing: boolean };

export type ChatHistory = {
  documentId: string | null;
  /** The newest chats first, as many as were asked for so far. */
  items: ChatItem[];
  /** The list holds no total; there are more chats than these. */
  hasMore: boolean;
  /** Read the next chats into the list. */
  showMore: () => void;
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
  const documentId = useDocumentId();
  const workspaceId = useWorkspaceId();
  const { selectedChatId, setSelectedChatId, setSelectedLeafId } = useChatSessions();
  const confirm = useConfirm();
  const { toast } = useToast();

  // "Show more" reads the first rows again with a larger limit, so a list
  // that reads again (after a rename or a delete) keeps what was shown.
  const [limit, setLimit] = useState(CHATS_PAGE_SIZE);
  const list = useQuery({
    ...chatListQuery(workspaceId, documentId ?? '', limit),
    enabled: documentId !== null,
    placeholderData: (previous) => previous,
  });
  const refetchList = list.refetch;
  const reload = useCallback(() => void refetchList(), [refetchList]);
  const renameChat = useRenameChat(workspaceId, documentId).mutateAsync;
  const deletion = useDeleteChat(workspaceId, documentId);
  const deleteChat = deletion.mutateAsync;

  // Background list loads report in place; toasts are reserved for actions the
  // user actually initiated (create, delete, rename).
  const failed = documentId !== null && list.isError;
  const listError = useMemo<ChatListError | null>(
    () => (failed ? { message: describeApiError(list.error, 'Request failed'), preparing: isRetryableProblem(list.error) } : null),
    [failed, list.error],
  );
  const shown = documentId && !failed ? list.data : undefined;
  const items = useMemo(() => shown?.items ?? [], [shown]);
  const hasMore = Boolean(shown?.next_cursor) && limit < MAX_CHATS;
  const showMore = useCallback(() => setLimit((current) => Math.min(MAX_CHATS, current + CHATS_PAGE_SIZE)), []);
  const loading = (documentId !== null && list.isFetching) || deletion.isPending;

  // A first message creates its chat on the server, and the assistant selects
  // it when the turn finishes. A selected id the loaded list does not have is
  // read for once more, so the switcher can name the conversation it is
  // showing. It stays the same id if that read does not find it either, so
  // this never loops.
  const unlistedChatId =
    list.isSuccess && selectedChatId && !items.some((chat) => chat.id === selectedChatId)
      ? selectedChatId
      : null;
  useEffect(() => {
    if (unlistedChatId) void refetchList();
  }, [refetchList, unlistedChatId]);

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

      try {
        await deleteChat(chat.id);
        if (selectedChatId === chat.id) {
          setSelectedChatId(null);
          setSelectedLeafId(null);
        }
        return true;
      } catch (error) {
        toast({
          title: 'Could not delete chat',
          description: error instanceof Error ? error.message : undefined,
          variant: 'error',
        });
        return false;
      }
    },
    [confirm, deleteChat, documentId, selectedChatId, setSelectedChatId, setSelectedLeafId, toast],
  );

  const rename = useCallback(
    async (chatId: string, title: string) => {
      if (!documentId) return;
      try {
        await renameChat({ chatId, title: title.trim() });
      } catch (error) {
        toast({
          title: 'Could not rename chat',
          description: error instanceof Error ? error.message : undefined,
          variant: 'error',
        });
      }
    },
    [documentId, renameChat, toast],
  );

  return {
    documentId,
    items,
    hasMore,
    showMore,
    loading,
    listError,
    reload,
    rename,
    remove,
  };
}
