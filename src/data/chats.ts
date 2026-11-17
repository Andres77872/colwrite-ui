import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type {
  ChatListResponse,
  ChatMessageChain,
  ChatSourceResponse,
  ChatSummary,
  ChatMessage as WireChatMessage,
} from '@/api/schema';
import { workspaceScope } from './workspaces';

/**
 * A page's chats (`/workspaces/{w}/documents/{d}/chats…`). A chat and its
 * messages are created by the assistant's run, never here. The messages form
 * a tree; a *leaf* message picks one branch of it.
 */
export type ChatItem = ChatSummary;
export type ChatMessage = WireChatMessage;

/**
 * Per-call transport controls.
 *
 * Chat reads fire from mount effects, so they outlive the component that
 * wanted them: without a signal, a document switch left the previous
 * document's request running — and the client's backoff sleep waiting —
 * with nothing to receive it.
 */
export type ChatsRequestOptions = {
  signal?: AbortSignal;
};

export async function listChats(
  workspaceId: string,
  documentId: string,
  options: { limit?: number; cursor?: string | null } & ChatsRequestOptions = {},
): Promise<ChatListResponse> {
  const { limit = 10, cursor, signal } = options;
  return unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/chats', {
    params: {
      path: { workspace_id: workspaceId, document_id: documentId },
      query: { limit, ...(cursor ? { cursor } : {}) },
    },
    signal,
  }));
}

export async function deleteChat(workspaceId: string, documentId: string, chatId: string): Promise<void> {
  await api.DELETE('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}', {
    params: { path: { workspace_id: workspaceId, document_id: documentId, chat_id: chatId } },
  });
}

export async function renameChat(
  workspaceId: string,
  documentId: string,
  chatId: string,
  title: string,
): Promise<ChatItem> {
  return unwrap(api.PATCH('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}', {
    params: { path: { workspace_id: workspaceId, document_id: documentId, chat_id: chatId } },
    body: { title },
  }));
}

/**
 * The messages of one branch of a chat, from its first message to `leaf`
 * (the chat's newest message when omitted). Not cached: the assistant panel
 * owns the transcript on screen once it is read.
 */
export async function listMessages(
  workspaceId: string,
  documentId: string,
  chatId: string,
  leaf: number | null,
  options?: ChatsRequestOptions,
): Promise<ChatMessageChain> {
  return unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}/messages', {
    params: {
      path: { workspace_id: workspaceId, document_id: documentId, chat_id: chatId },
      query: leaf === null ? {} : { leaf },
    },
    signal: options?.signal,
  }));
}

/** A page's chats. They are stored against the page, so every key names it. */
export const chatKeys = {
  all: (workspaceId: string) => [...workspaceScope(workspaceId), 'chats'] as const,
  ofDocument: (workspaceId: string, documentId: string) => [...workspaceScope(workspaceId), 'chats', documentId] as const,
  list: (workspaceId: string, documentId: string, pageSize: number) =>
    [...workspaceScope(workspaceId), 'chats', documentId, 'list', { pageSize }] as const,
};

/** Excerpts are fetched only when the author opens a recorded passage. */
export async function getChatSource(
  workspaceId: string, documentId: string, chatId: string, handle: string,
  options: ChatsRequestOptions & { passage?: string; limit?: number; cursor?: string } = {},
): Promise<ChatSourceResponse> {
  const { signal, ...query } = options;
  return unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}/sources/{handle}', {
    params: { path: { workspace_id: workspaceId, document_id: documentId, chat_id: chatId, handle }, query }, signal,
  }));
}

export function chatPassageQuery(workspaceId: string, documentId: string, chatId: string, passage: string) {
  const handle = passage.split('.')[0] ?? '';
  return queryOptions({
    queryKey: [...chatKeys.ofDocument(workspaceId, documentId), chatId, 'source', handle, passage],
    queryFn: ({ signal }) => getChatSource(workspaceId, documentId, chatId, handle, { passage, signal }),
  });
}

/** The newest `pageSize` chats of a page, and whether there are more. */
export function chatListQuery(workspaceId: string, documentId: string, pageSize: number) {
  return queryOptions({
    queryKey: chatKeys.list(workspaceId, documentId, pageSize),
    queryFn: ({ signal }) => listChats(workspaceId, documentId, { limit: pageSize, signal }),
  });
}

/** Rename a chat; its page's chat list reads again. */
export function useRenameChat(workspaceId: string, documentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, title }: { chatId: string; title: string }) => {
      if (!documentId) throw new Error('This page has no chats yet.');
      return renameChat(workspaceId, documentId, chatId, title);
    },
    onSettled: () => (documentId
      ? queryClient.invalidateQueries({ queryKey: chatKeys.ofDocument(workspaceId, documentId) })
      : undefined),
  });
}

/** Delete a chat; its page's chat list reads again. */
export function useDeleteChat(workspaceId: string, documentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => {
      if (!documentId) throw new Error('This page has no chats yet.');
      return deleteChat(workspaceId, documentId, chatId);
    },
    onSettled: () => (documentId
      ? queryClient.invalidateQueries({ queryKey: chatKeys.ofDocument(workspaceId, documentId) })
      : undefined),
  });
}
