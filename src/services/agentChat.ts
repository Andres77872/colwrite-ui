import { API_BASE } from './api';
import { emitRequireLogin } from './session';
import { parseSSEStream, type SSEEventHandlers } from './streamParser';

// ── Types ──

export type AgentChatParams = {
  message: string;
  document_id: string;
  chat_id?: string | null;
  thread_id?: number | null;
  model?: string | null;
};

export type AgentChatResult = {
  chatId: string | null;
  threadId: number | null;
  usage: { promptTokens: number; completionTokens: number } | null;
};

export type AgentChatOptions = {
  signal?: AbortSignal;
};

function buildUrl(path: string): string {
  const base = API_BASE.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * Send a message to the unified agent chat endpoint (`POST /api/agent/chat`)
 * and stream the typed SSE response via the provided handlers.
 *
 * On HTTP error:
 *   - 401/403 triggers `emitRequireLogin()` then throws
 *   - Other status codes throw with the response body text
 *
 * Returns an `AgentChatResult` with the `chatId`, `threadId`, and `usage`
 * captured from the terminal `event: done` SSE payload.
 */
export async function streamAgentChat(
  params: AgentChatParams,
  handlers: SSEEventHandlers,
  opts?: AgentChatOptions,
): Promise<AgentChatResult> {
  const body: Record<string, unknown> = {
    message: params.message,
    document_id: params.document_id,
  };
  if (params.chat_id != null) {
    body.chat_id = params.chat_id;
  }
  if (params.thread_id != null) {
    body.thread_id = params.thread_id;
  }
  if (params.model != null) {
    body.model = params.model;
  }

  const res = await fetch(buildUrl('/agent/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
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

  // ── Intercept onDone to capture chatId/threadId/usage ──
  let capturedResult: Pick<AgentChatResult, 'chatId' | 'threadId' | 'usage'> = {
    chatId: null,
    threadId: null,
    usage: null,
  };

  const wrappedHandlers: SSEEventHandlers = {
    ...handlers,
    onDone: (chatId, threadId, usage) => {
      capturedResult = {
        chatId,
        threadId,
        usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens },
      };
      // Also call the original onDone if provided
      handlers.onDone?.(chatId, threadId, usage);
    },
  };

  await parseSSEStream(res, wrappedHandlers, { signal: opts?.signal });

  return capturedResult;
}
