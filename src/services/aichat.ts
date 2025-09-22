import { API_BASE } from './api';
import { emitRequireLogin } from './session';

export type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  content: string;
  name?: string;
};

export type AiChatChunk = {
  content?: string;
  done?: boolean;
  extras?: any;
  [key: string]: unknown;
};

function buildUrl(path: string): string {
  const base = API_BASE.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export async function streamDocumentAiChat(
  documentId: string,
  messages: OpenAIChatMessage[],
  opts?: {
    signal?: AbortSignal;
    onChunk?: (delta: string, chunk: AiChatChunk) => void;
    // Optional chat session headers per API docs
    chatId?: string | null;
    threadId?: number | null;
    // Observe response headers (e.g., to retrieve x-chat-id created by server)
    onHeaders?: (headers: Headers) => void;
  }
): Promise<void> {
  if (!documentId) throw new Error('Missing document id');
  const res = await fetch(buildUrl(`/document/aichat/${encodeURIComponent(documentId)}`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(opts?.chatId ? { 'x-chat-id': String(opts.chatId) } : {}),
      ...(typeof opts?.threadId === 'number' ? { 'x-thread-id': String(opts.threadId) } : {}),
    },
    body: JSON.stringify({ messages }),
    signal: opts?.signal,
    credentials: 'include',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      emitRequireLogin();
    }
    throw new Error(text || res.statusText);
  }

  // Allow caller to read headers (e.g., x-chat-id for a newly created chat)
  try {
    opts?.onHeaders?.(res.headers);
  } catch {}

  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Prefer SSE double-newline blocks; fallback to line-by-line
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      processLines(chunk.split(/\n/), opts?.onChunk);
    }
    const lastNl = buffer.lastIndexOf('\n');
    if (lastNl !== -1) {
      const lines = buffer.slice(0, lastNl).split(/\n/);
      buffer = buffer.slice(lastNl + 1);
      processLines(lines, opts?.onChunk);
    }
  }

  if (buffer.trim()) {
    processLines(buffer.split(/\n/), opts?.onChunk);
  }
}

function processLines(lines: string[], onChunk?: (delta: string, chunk: AiChatChunk) => void) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('data:')) {
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;
      try {
        const obj = JSON.parse(dataStr) as AiChatChunk;
        const delta = typeof obj.content === 'string' ? obj.content : '';
        if (onChunk) onChunk(delta, obj);
      } catch {
        // ignore parse errors
      }
      continue;
    }

    // Fallback: try entire line as JSON
    try {
      const obj = JSON.parse(trimmed) as AiChatChunk;
      const delta = typeof obj.content === 'string' ? obj.content : '';
      if (onChunk) onChunk(delta, obj);
    } catch {
      // ignore
    }
  }
}


