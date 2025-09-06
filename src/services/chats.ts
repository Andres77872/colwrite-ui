import { get, post, put, del } from './api';

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
  extras: any | null;
  metadata: any | null;
  created_at: string | null;
};

export async function createChat(documentId: string): Promise<{ chat_id: string; status: string; message: string }> {
  return post(`/document/${encodeURIComponent(documentId)}/chats`);
}

export async function listChats(
  documentId: string,
  limit = 10,
  offset = 0,
): Promise<{ chats: ChatItem[]; count: number; status: string; message: string }> {
  return get(`/document/${encodeURIComponent(documentId)}/chats?limit=${limit}&offset=${offset}`);
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
): Promise<{ threads: ThreadItem[]; count: number; status: string; message: string }> {
  return get(`/document/${encodeURIComponent(documentId)}/chats/${encodeURIComponent(chatId)}/threads?limit=${limit}&offset=${offset}`);
}

export async function appendThread(
  documentId: string,
  chatId: string,
  body: { role: 'user' | 'assistant'; parentThreadId?: number | null; content?: string | null; extras?: any | null; metadata?: any | null },
): Promise<{ thread_id: number; message_uuid: string; status: string; message: string }> {
  return post(`/document/${encodeURIComponent(documentId)}/chats/${encodeURIComponent(chatId)}/threads`, body);
}

export async function listMessages(
  documentId: string,
  chatId: string,
  threadId: number,
): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: string }>; pivotThreadId: number; status: string; message: string }> {
  return get(`/document/${encodeURIComponent(documentId)}/chats/${encodeURIComponent(chatId)}/messages?threadId=${threadId}`);
}
