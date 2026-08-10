import { get, post, put, del } from './api';
import type { JsonValue } from './contracts';

export type ChatItem = {
  chat_id: string;
  document_id: string;
  user_id: string | null;
  title: string | null;
  last_thread_id: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ThreadItem = {
  id: number;
  message_uuid: string;
  role: 'user' | 'assistant';
  parent_thread_id: number | null;
  content: string | null;
  extras: JsonValue | null;
  metadata: JsonValue | null;
  created_at: string | null;
};

/**
 * Per-call transport controls.
 *
 * Chat reads fire from mount effects, so they outlive the component that
 * wanted them: without a signal, a document switch left the previous
 * document's request running — and the api layer's backoff sleep waiting —
 * with nothing to receive it.
 */
export type ChatsRequestOptions = {
  signal?: AbortSignal;
};

export async function createChat(
  documentId: string,
  options?: ChatsRequestOptions,
): Promise<{ chat_id: string; status: string; message: string }> {
  return post(`/document/${encodeURIComponent(documentId)}/chats`, undefined, options);
}

export async function listChats(
  documentId: string,
  limit = 10,
  offset = 0,
  options?: ChatsRequestOptions,
): Promise<{ chats: ChatItem[]; count: number; status: string; message: string }> {
  return get(
    `/document/${encodeURIComponent(documentId)}/chats?limit=${limit}&offset=${offset}`,
    options,
  );
}

export async function deleteChat(documentId: string, chatId: string): Promise<{ status: string; message: string }> {
  return del(`/document/${encodeURIComponent(documentId)}/chats/${encodeURIComponent(chatId)}`);
}

export async function updateChatTitle(
  documentId: string,
  chatId: string,
  title: string,
): Promise<{ status: string; message: string }> {
  return put(`/document/${encodeURIComponent(documentId)}/chats/${encodeURIComponent(chatId)}`, { title });
}

export async function listThreads(
  documentId: string,
  chatId: string,
  limit = 100,
  offset = 0,
  options?: ChatsRequestOptions,
): Promise<{ threads: ThreadItem[]; count: number; status: string; message: string }> {
  return get(
    `/document/${encodeURIComponent(documentId)}/chats/${encodeURIComponent(chatId)}/threads?limit=${limit}&offset=${offset}`,
    options,
  );
}

export async function appendThread(
  documentId: string,
  chatId: string,
  body: {
    role: 'user' | 'assistant';
    parentThreadId?: number | null;
    content?: string | null;
    extras?: JsonValue | null;
    metadata?: JsonValue | null;
  },
): Promise<{ thread_id: number; message_uuid: string; status: string; message: string }> {
  return post(`/document/${encodeURIComponent(documentId)}/chats/${encodeURIComponent(chatId)}/threads`, body);
}

export async function listMessages(
  documentId: string,
  chatId: string,
  threadId: number,
  options?: ChatsRequestOptions,
): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: string }>; pivotThreadId: number; status: string; message: string }> {
  return get(
    `/document/${encodeURIComponent(documentId)}/chats/${encodeURIComponent(chatId)}/messages?threadId=${threadId}`,
    options,
  );
}
