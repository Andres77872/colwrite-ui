// ── Event handler types ──

import type { ToolAction, ToolOperation, ToolOperationResult } from '../editor/types';

/**
 * Everything the server knows about a finished tool call.
 *
 * `error`/`errorType` are set when the call failed; `outputPreview` is a
 * bounded slice of what the tool returned; `arguments` is the complete parsed
 * input when it fits the wire budget, with `argumentsPreview` always present
 * as a capped JSON string.
 */
export type ToolCallEndEvent = {
  tool: string;
  toolCallId: string;
  durationMs: number;
  isError: boolean;
  error: string | null;
  errorType: string | null;
  outputPreview: string | null;
  outputChars: number;
  outputTruncated: boolean;
  arguments?: Record<string, unknown>;
  argumentsPreview: string;
  argumentsTruncated: boolean;
};

/**
 * The complete parsed arguments for a running tool call.
 *
 * `tool_call_start` fires from the first streamed token of the call, before
 * the model has finished writing its arguments — this event follows once the
 * server actually starts executing, carrying what the tool really received.
 */
export type ToolCallArgsEvent = {
  tool: string;
  toolCallId: string;
  arguments?: Record<string, unknown>;
  argumentsPreview: string;
  argumentsTruncated: boolean;
};

export type SSEEventHandlers = {
  onToken?: (content: string) => void;
  onStatus?: (status: string, detail: string) => void;
  onToolCallStart?: (tool: string, toolCallId: string, args: Record<string, unknown>) => void;
  onToolCallArgs?: (event: ToolCallArgsEvent) => void;
  onToolCallEnd?: (event: ToolCallEndEvent) => void;
  onToolAction?: (action: ToolAction) => void;
  onError?: (errorCode: string, message: string) => void;
  onDone?: (
    chatId: string | null,
    threadId: number | null,
    usage: { promptTokens: number; completionTokens: number },
  ) => void;
};

export type ParseSSEOptions = {
  signal?: AbortSignal;
};

export type ParseSSEResult = {
  chatId: string | null;
  threadId: number | null;
  /**
   * How the stream ended. `null` means the connection closed without a
   * terminal `done` or `error` event — a dropped connection, not a completed
   * turn — and callers must not present it as success.
   */
  terminal: 'done' | 'error' | null;
};

/**
 * Transform a raw SSE `tool_action` payload (snake_case keys from the Python backend)
 * into the frontend `ToolAction` shape (camelCase keys).
 *
 * Uses **whitelist semantics** — only known fields are mapped; unknown extra fields
 * are silently dropped.  Every field has an explicit type
 * coercion with a safe default so that consumer code never sees `undefined` for
 * required fields.
 */
const TOOL_ACTION_STATUSES = new Set<ToolAction['status']>([
  'proposed',
  'applied',
  'skipped',
  'error',
]);

const OPERATION_RESULT_STATUSES = new Set<ToolOperationResult['status']>([
  'applied',
  'skipped',
  'error',
]);

/** `String(undefined)` is `"undefined"`, which reads as a real id downstream. */
function optionalString(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return candidate;
    if (typeof candidate === 'number') return String(candidate);
  }
  return '';
}

function mapOperationResults(raw: unknown): ToolOperationResult[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const results: ToolOperationResult[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const op = entry as Record<string, unknown>;
    const status = op.status;
    if (!OPERATION_RESULT_STATUSES.has(status as ToolOperationResult['status'])) continue;
    results.push({
      op: optionalString(op.op) || 'operation',
      status: status as ToolOperationResult['status'],
      message: op.message != null ? String(op.message) : undefined,
    });
  }
  return results.length > 0 ? results : undefined;
}

function mapSseToolAction(data: Record<string, unknown>): ToolAction {
  const actions = (data.actions ?? []) as ToolOperation[];
  const status = data.status;
  return {
    tool: optionalString(data.tool),
    // Prefer snake_case (backend wire format), fall back to camelCase (for
    // backward compat if the backend switches format).
    toolCallId: optionalString(data.tool_call_id, data.toolCallId),
    actions,
    // Empty rather than the string "undefined": the review layer compares this
    // against the open document's id, and `"undefined"` matched nothing, so a
    // payload missing the field was dropped without a word to anyone.
    documentId: optionalString(data.document_id, data.documentId),
    version: Number(data.version ?? 0),
    /**
     * Unknown or missing means `proposed`, which is the server's own default
     * apply mode and the only value that is safe to guess.
     *
     * This used to default to `applied`, so a payload that omitted the field —
     * or spelled it in a way this client does not know — was replayed straight
     * into the document with no review, no highlight and no undo. Guessing
     * `proposed` at worst asks the author to confirm something that already
     * happened; guessing `applied` silently rewrites their work.
     */
    status: TOOL_ACTION_STATUSES.has(status as ToolAction['status'])
      ? (status as ToolAction['status'])
      : 'proposed',
    // JSON null survives the `as` cast — coerce to undefined explicitly
    message: data.message != null ? String(data.message) : undefined,
    operationResults: mapOperationResults(data.operationResults ?? data.ops),
    // Durable review workflow: operations are redacted out of the stream and
    // must be fetched from the server by this id.
    changeSetId:
      typeof data.change_set_id === 'string' && data.change_set_id
        ? data.change_set_id
        : null,
    proposalOperationCount: (() => {
      const proposal = data.proposal;
      if (typeof proposal !== 'object' || proposal === null) return undefined;
      const count = (proposal as Record<string, unknown>).operation_count;
      return typeof count === 'number' && Number.isFinite(count) ? count : undefined;
    })(),
  };
}

function argumentFields(data: Record<string, unknown>): {
  arguments?: Record<string, unknown>;
  argumentsPreview: string;
  argumentsTruncated: boolean;
} {
  const args =
    typeof data.arguments === 'object' && data.arguments !== null
      ? (data.arguments as Record<string, unknown>)
      : undefined;
  return {
    arguments: args,
    argumentsPreview:
      typeof data.arguments_preview === 'string' ? data.arguments_preview : '',
    argumentsTruncated: data.arguments_truncated === true,
  };
}

function mapToolCallEnd(data: Record<string, unknown>): ToolCallEndEvent {
  return {
    tool: typeof data.tool === 'string' ? data.tool : String(data.tool ?? ''),
    toolCallId:
      typeof data.tool_call_id === 'string' ? data.tool_call_id : String(data.tool_call_id ?? ''),
    durationMs: typeof data.duration_ms === 'number' ? data.duration_ms : Number(data.duration_ms ?? 0),
    isError: data.is_error === true,
    error: typeof data.error === 'string' && data.error !== '' ? data.error : null,
    errorType: typeof data.error_type === 'string' && data.error_type !== '' ? data.error_type : null,
    outputPreview: typeof data.output_preview === 'string' ? data.output_preview : null,
    outputChars: typeof data.output_chars === 'number' ? data.output_chars : 0,
    outputTruncated: data.output_truncated === true,
    ...argumentFields(data),
  };
}

/**
 * Parse a `text/event-stream` `Response` body into typed SSE event callbacks.
 *
 * Handles all backend event types (`token`, `status`, `tool_call_start`,
 * `tool_call_args`, `tool_call_end`, `tool_action`, `error`, `done`).  Bare
 * `data:` lines without a preceding `event:` are emitted as `onToken`.
 * Comment lines (`: keepalive`) are ignored.  Malformed JSON payloads are
 * silently skipped.  AbortSignal stops reading without throwing.
 *
 * Returns `{ chatId, threadId, terminal }` — `terminal` is `null` when the
 * stream ended without a `done` or `error` event (a dropped connection).
 */
export async function parseSSEStream(
  response: Response,
  handlers: SSEEventHandlers,
  opts?: ParseSSEOptions,
): Promise<ParseSSEResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { chatId: null, threadId: null, terminal: null };
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let lastEventType: string | null = null;

  // Accumulators for the return value — captured from onDone / onError
  let capturedChatId: string | null = null;
  let capturedThreadId: number | null = null;
  let terminal: 'done' | 'error' | null = null;

  function processBuffer(): void {
    // SSE blocks are delimited by \n\n (CR already normalized away)
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      processBlock(block);
    }
  }

  function processBlock(block: string): void {
    const lines = block.split('\n');
    let eventType: string | null = null;
    let dataLine: string | null = null;

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLine = line.slice(5).trim();
      }
      // Lines starting with ':' are SSE comments (keepalives) — ignored.
    }

    // Update the running last event type (SSE spec: consecutive data: lines
    // without event: inherit the previous event type).
    if (eventType !== null) {
      lastEventType = eventType;
    }

    const effectiveEvent = eventType ?? lastEventType;

    // If there is no data line, nothing to dispatch
    if (dataLine === null || dataLine === '') {
      return;
    }

    // Parse JSON — silently skip malformed payloads
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataLine) as Record<string, unknown>;
    } catch {
      return;
    }

    // Dispatch to the right handler based on event type
    if (effectiveEvent === 'token' || effectiveEvent === null) {
      // A bare `data:` line without a preceding `event:` is treated as token
      if (typeof data.content === 'string') {
        handlers.onToken?.(data.content);
      }
    } else if (effectiveEvent === 'status') {
      handlers.onStatus?.(
        typeof data.status === 'string' ? data.status : String(data.status ?? ''),
        typeof data.detail === 'string' ? data.detail : String(data.detail ?? ''),
      );
    } else if (effectiveEvent === 'tool_call_start') {
      handlers.onToolCallStart?.(
        typeof data.tool === 'string' ? data.tool : String(data.tool ?? ''),
        typeof data.tool_call_id === 'string' ? data.tool_call_id : String(data.tool_call_id ?? ''),
        typeof data.arguments === 'object' && data.arguments !== null
          ? (data.arguments as Record<string, unknown>)
          : {},
      );
    } else if (effectiveEvent === 'tool_call_args') {
      handlers.onToolCallArgs?.({
        tool: typeof data.tool === 'string' ? data.tool : String(data.tool ?? ''),
        toolCallId:
          typeof data.tool_call_id === 'string'
            ? data.tool_call_id
            : String(data.tool_call_id ?? ''),
        ...argumentFields(data),
      });
    } else if (effectiveEvent === 'tool_call_end') {
      handlers.onToolCallEnd?.(mapToolCallEnd(data));
    } else if (effectiveEvent === 'error') {
      terminal = 'error';
      handlers.onError?.(
        typeof data.error_code === 'string' ? data.error_code : String(data.error_code ?? ''),
        typeof data.message === 'string' ? data.message : String(data.message ?? ''),
      );
    } else if (effectiveEvent === 'done') {
      const chatId =
        data.chat_id !== null && data.chat_id !== undefined
          ? String(data.chat_id)
          : null;
      const threadId =
        typeof data.thread_id === 'number'
          ? data.thread_id
          : data.thread_id !== null && data.thread_id !== undefined
            ? Number(data.thread_id)
            : null;

      const usage = data.usage as
        | { prompt_tokens?: number; completion_tokens?: number }
        | undefined;

      terminal = 'done';
      handlers.onDone?.(chatId, threadId, {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
      });

      // Capture for return value
      capturedChatId = chatId;
      capturedThreadId = threadId;
    } else if (effectiveEvent === 'tool_action') {
      handlers.onToolAction?.(mapSseToolAction(data));
    }
    // Unknown event types are silently skipped
  }

  // ── Main read loop ──
  while (true) {
    // Check for abort signal at the start of each iteration
    if (opts?.signal?.aborted) {
      break;
    }

    const { value, done } = await reader.read();
    if (done) {
      // Flush remaining buffer content, including a final block the server
      // never terminated with \n\n before the connection closed.
      processBuffer();
      const tail = buffer.trim();
      if (tail) {
        buffer = '';
        processBlock(tail);
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    // Some proxies re-frame SSE with CRLF line endings; the trailing \r kept
    // every block from matching and the whole stream was silently dropped.
    if (buffer.includes('\r')) {
      buffer = buffer.replace(/\r\n/g, '\n');
    }
    processBuffer();
  }

  return { chatId: capturedChatId, threadId: capturedThreadId, terminal };
}
