import { buildUrl, ensureRefreshed } from './api';
import { ApiError, problemCode } from './contracts';
import { emitRequireLogin } from './session';
import { parseSSEStream, type SSEErrorDetails, type SSEEventHandlers } from './streamParser';

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
  /**
   * How the stream ended: `done` (completed), `error` (server reported a
   * terminal error), or `null` — the connection closed without either, which
   * means the reply the user is looking at is incomplete.
   */
  terminal: 'done' | 'error' | null;
};

export type AgentChatRetryOptions = {
  /** Total attempts including the first one. Default 3. */
  maxAttempts?: number;
  /** First backoff delay; later attempts triple it. Default 500 ms. */
  baseDelayMs?: number;
};

export type AgentChatOptions = {
  signal?: AbortSignal;
  /**
   * Backoff policy for server "not ready yet" rejections
   * (`PROJECTION_PENDING` / `DOCUMENT_REFERENCE_NOT_READY`). Applied by
   * default; pass `{maxAttempts: 1}` to disable. A turn that already produced
   * output is never replayed regardless of this setting.
   */
  retry?: AgentChatRetryOptions;
};

/** SSE error codes that mean "the save is still propagating — ask again". */
const RETRYABLE_STREAM_CODES = new Set([
  'PROJECTION_PENDING',
  'DOCUMENT_REFERENCE_NOT_READY',
]);

const MIN_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 5000;

function retryDelayMs(
  attempt: number,
  baseDelayMs: number,
  retryAfterSeconds: number | null,
): number {
  if (retryAfterSeconds !== null) {
    return Math.min(
      MAX_RETRY_DELAY_MS,
      Math.max(MIN_RETRY_DELAY_MS, retryAfterSeconds * 1000),
    );
  }
  const backoff = baseDelayMs * 3 ** (attempt - 1);
  const jitter = 1 + (Math.random() - 0.5) * 0.5;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(MIN_RETRY_DELAY_MS, backoff * jitter));
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

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
 *   - A 503 `projection_pending` problem, or a streamed `PROJECTION_PENDING` /
 *     `DOCUMENT_REFERENCE_NOT_READY` error event, is retried with backoff per
 *     `opts.retry` before the final error is surfaced
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

  const maxAttempts = Math.max(1, opts?.retry?.maxAttempts ?? 3);
  const baseDelayMs = opts?.retry?.baseDelayMs ?? 500;

  // A replayed request would duplicate anything the model already streamed,
  // so the first delivered token/tool event permanently disables retries.
  let producedOutput = false;

  for (let attempt = 1; ; attempt += 1) {
    let res = await send();
    if (res.status === 401 && (await ensureRefreshed())) {
      res = await send();
    }

    if (!res.ok) {
      const error = await apiErrorFromResponse(res);
      if (
        res.status === 503
        && problemCode(error) === 'projection_pending'
        && attempt < maxAttempts
        && !producedOutput
      ) {
        const retryAfter = (error.data as { retry_after?: unknown } | null)?.retry_after;
        await abortableSleep(
          retryDelayMs(
            attempt,
            baseDelayMs,
            typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter : null,
          ),
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
    let pendingRetryDelayMs: number | null = null;

    const markOutput = () => {
      producedOutput = true;
    };

    const wrappedHandlers: SSEEventHandlers = {
      ...handlers,
      onToken: (content) => {
        markOutput();
        handlers.onToken?.(content);
      },
      onToolCallStart: (tool, toolCallId, args) => {
        markOutput();
        handlers.onToolCallStart?.(tool, toolCallId, args);
      },
      onToolAction: (action) => {
        markOutput();
        handlers.onToolAction?.(action);
      },
      onError: (errorCode: string, message: string, details?: SSEErrorDetails) => {
        if (
          RETRYABLE_STREAM_CODES.has(errorCode)
          && attempt < maxAttempts
          && !producedOutput
        ) {
          // Swallow this attempt's error — the caller sees one final error,
          // not one per retried attempt.
          pendingRetryDelayMs = retryDelayMs(
            attempt,
            baseDelayMs,
            details?.retryAfterSeconds ?? null,
          );
          return;
        }
        handlers.onError?.(errorCode, message, details);
      },
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

    if (pendingRetryDelayMs !== null) {
      await abortableSleep(pendingRetryDelayMs, opts?.signal);
      continue;
    }

    return { ...capturedResult, terminal: parsed.terminal };
  }
}
