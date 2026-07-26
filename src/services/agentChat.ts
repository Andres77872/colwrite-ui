import { buildUrl, ensureRefreshed } from './api';
import { emitRequireLogin } from './session';
import { parseSSEStream, type SSEEventHandlers } from './streamParser';

// ── Types ──

/**
 * Which tools the server-side agent gets.
 *
 * - `assistant` — the chat panel; the agent may read, edit and create
 *   documents. Its edits do **not** reach storage: the server stages them and
 *   sends them down as `tool_action` events with status `proposed`, which the
 *   editor shows on the affected blocks for the author to accept or reject.
 * - `rewrite` — the selection toolbar and the inline AI passage; the agent
 *   returns text only, because the caller applies the result itself behind its
 *   own accept/reject affordance. Handing that agent the document tools let it
 *   rewrite the paper while the user was still deciding.
 *
 * Both modes therefore end at the same place: the person editing the document
 * decides what lands in it.
 */
export type AgentChatMode = 'assistant' | 'rewrite';

export type AgentChatParams = {
  message: string;
  document_id: string;
  chat_id?: string | null;
  thread_id?: number | null;
  model?: string | null;
  mode?: AgentChatMode;
};

export type AgentChatResult = {
  chatId: string | null;
  threadId: number | null;
  usage: { promptTokens: number; completionTokens: number } | null;
};

export type AgentChatOptions = {
  signal?: AbortSignal;
};

/**
 * Send a message to the unified agent chat endpoint (`POST /api/agent/chat`)
 * and stream the typed SSE response via the provided handlers.
 *
 * On HTTP error:
 *   - 401 rotates the session cookie and replays once, then behaves as below
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
  if (params.mode != null) {
    body.mode = params.mode;
  }

  // This endpoint streams, so it cannot go through `request()` in api.ts —
  // that reads the whole body. It still needs the same session handling.
  const send = () =>
    fetch(buildUrl('/agent/chat'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
      credentials: 'include',
    });

  let res = await send();
  if (res.status === 401 && (await ensureRefreshed())) {
    res = await send();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      emitRequireLogin(res.status === 403 ? 'forbidden' : 'expired');
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
