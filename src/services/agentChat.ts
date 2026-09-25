import { streamAgentSession, type ResumeAgentRun } from './agentSessionChat';
import type { AgentEngineId } from './agentEngines';
import { buildUrl, ensureRefreshed, getRefreshGeneration } from './api';
import { ApiError, problemRetryAfter } from './contracts';
import { abortableSleep, isRetryableProblem, retryDelayMs } from './retry';
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

/**
 * Where the author is working, sent next to the message rather than pasted
 * into it. The server keeps only blocks the model can see.
 */
export type AgentChatContext = {
  /** The block the caret was in. */
  block_id?: string;
  /** Text the author had selected (at most 4,000 characters). */
  selection?: { block_id: string; text: string };
  /** Blocks referenced in the message as `#this/<id>` (at most 20). */
  block_ids?: string[];
};

export type AgentChatParams = {
  message: string;
  document_id: string;
  chat_id?: string | null;
  thread_id?: number | null;
  model?: string | null;
  /**
   * Which backend runs the turn. Omitted means the server default
   * (`legacy`). `claude` / `codex` exist only on a local API reached from
   * the same machine; the server rejects them otherwise with an `ENGINE_*`
   * error and never falls back to another engine.
   */
  engine?: AgentEngineId | null;
  mode?: AgentChatMode;
  /**
   * One-shot run with no chat behind it (rewrite mode only). The editor's
   * inline AI uses this: each rewrite used to become a single-message chat
   * cluttering the document's chat list.
   */
  ephemeral?: boolean;
  context?: AgentChatContext;
};

export type AgentChatResult = {
  chatId: string | null;
  threadId: number | null;
  usage: { promptTokens: number; completionTokens: number } | null;
  /**
   * How the stream ended: `done` (completed), `error` (server reported a
   * terminal error), or `null` — the connection closed without either, which
   * means the reply the user is looking at is incomplete.
   */
  terminal: 'done' | 'error' | null;
};

export type AgentChatRetryOptions = {
  /** Total attempts including the first one. Default 8 for WS; 3 for legacy SSE. */
  maxAttempts?: number;
  /** First backoff delay. Default 500 ms; WS doubles it up to 10 seconds. */
  baseDelayMs?: number;
};

export type AgentChatOptions = {
  signal?: AbortSignal;
  /** Detach on navigation; explicit Stop uses signal.reason === 'cancel'. */
  abortBehavior?: 'cancel' | 'detach';
  resume?: ResumeAgentRun;
  onRunStarted?: (run: ResumeAgentRun) => void;
  /**
   * WebSocket reconnect policy. The saved event cursor and idempotent start
   * key prevent duplicate generation. Legacy SSE retries only retryable HTTP
   * failures before its response stream opens. `{maxAttempts: 1}` disables retry.
   */
  retry?: AgentChatRetryOptions;
};

async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => '');
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  const record = data as { detail?: unknown; message?: unknown } | null;
  const message =
    (typeof record?.detail === 'string' && record.detail)
    || (typeof record?.message === 'string' && record.message)
    || text
    || res.statusText;
  return new ApiError(message, res.status, data);
}

/**
 * Send a message to the unified agent chat endpoint (`POST /api/agent/chat`)
 * and stream the typed SSE response via the provided handlers.
 *
 * On HTTP error:
 *   - 401 rotates the session cookie and replays once, then behaves as below
 *   - 401/403 triggers `emitRequireLogin()` then throws
 *   - Other status codes throw an `ApiError` carrying the parsed problem body
 *   - A problem the server flags retryable (`history_not_ready`,
 *     `document_rate_limit_exceeded`) is replayed with backoff per `opts.retry`
 *     before the final error is surfaced
 *
 * A terminal `error` event inside the stream is never retried — it is handed
 * straight to `handlers.onError`, because by then the turn has been accepted
 * and only the caller knows what to say about it.
 *
 * Returns an `AgentChatResult` with the `chatId`, `threadId`, and `usage`
 * captured from the terminal `event: done` SSE payload.
 */
export async function streamAgentChatSSE(
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
  if (params.engine != null) {
    body.engine = params.engine;
  }
  if (params.mode != null) {
    body.mode = params.mode;
  }
  if (params.ephemeral) {
    body.ephemeral = true;
  }
  if (params.context) {
    body.context = params.context;
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

  const maxAttempts = Math.max(1, opts?.retry?.maxAttempts ?? 3);
  const baseDelayMs = opts?.retry?.baseDelayMs ?? 500;

  for (let attempt = 1; ; attempt += 1) {
    const observedGeneration = getRefreshGeneration();
    let res = await send();
    if (res.status === 401 && (await ensureRefreshed(observedGeneration))) {
      res = await send();
    }

    if (!res.ok) {
      const error = await apiErrorFromResponse(res);
      // The shared gate rather than a hardcoded status/code pair, so this
      // endpoint replays exactly the problems everything else does. Nothing
      // has streamed yet at this point, so a replay cannot duplicate output.
      if (isRetryableProblem(error) && attempt < maxAttempts) {
        await abortableSleep(
          retryDelayMs(attempt, baseDelayMs, problemRetryAfter(error)),
          opts?.signal,
        );
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        emitRequireLogin(res.status === 403 ? 'forbidden' : 'expired');
      }
      throw error;
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

    const parsed = await parseSSEStream(res, wrappedHandlers, { signal: opts?.signal });

    return { ...capturedResult, terminal: parsed.terminal };
  }
}

/** The application's default transport is a durable WebSocket session. */
export function streamAgentChat(
  params: AgentChatParams,
  handlers: SSEEventHandlers,
  opts?: AgentChatOptions,
): Promise<AgentChatResult> {
  return streamAgentSession(params, handlers, opts);
}
