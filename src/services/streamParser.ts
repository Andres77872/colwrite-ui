// ── Event handler types ──

import type { ToolAction, ToolOperation } from '../editor/types';

export type SSEEventHandlers = {
  onToken?: (content: string) => void;
  onStatus?: (status: string, detail: string) => void;
  onToolCallStart?: (tool: string, toolCallId: string, args: Record<string, unknown>) => void;
  onToolCallEnd?: (tool: string, toolCallId: string, durationMs: number) => void;
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
};

/**
 * Transform a raw SSE `tool_action` payload (snake_case keys from the Python backend)
 * into the frontend `ToolAction` shape (camelCase keys).
 *
 * Uses **whitelist semantics** — only known fields are mapped; unknown extra fields
 * (e.g. `operationResults`) are silently dropped.  Every field has an explicit type
 * coercion with a safe default so that consumer code never sees `undefined` for
 * required fields.
 */
function mapSseToolAction(data: Record<string, unknown>): ToolAction {
  const actions = (data.actions ?? []) as ToolOperation[];
  return {
    tool: String(data.tool ?? ''),
    // Prefer snake_case (backend wire format), fall back to camelCase (for
    // backward compat if the backend switches format).
    toolCallId: String(data.tool_call_id ?? data.toolCallId ?? ''),
    actions,
    documentId: String(data.document_id ?? data.documentId ?? ''),
    version: Number(data.version ?? 0),
    status: (data.status ?? 'applied') as ToolAction['status'],
    // JSON null survives the `as` cast — coerce to undefined explicitly
    message: data.message != null ? String(data.message) : undefined,
  };
}

/**
 * Parse a `text/event-stream` `Response` body into typed SSE event callbacks.
 *
 * Handles all 7 backend event types (`token`, `status`, `tool_call_start`,
 * `tool_call_end`, `tool_action`, `error`, `done`).  Bare `data:` lines without a preceding
 * `event:` are emitted as `onToken`.  Malformed JSON payloads are silently
 * skipped.  AbortSignal stops reading without throwing.
 *
 * Returns `{ chatId, threadId }` captured from the `event: done` payload.
 */
export async function parseSSEStream(
  response: Response,
  handlers: SSEEventHandlers,
  opts?: ParseSSEOptions,
): Promise<ParseSSEResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { chatId: null, threadId: null };
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let lastEventType: string | null = null;

  // Accumulators for the return value — captured from onDone
  let capturedChatId: string | null = null;
  let capturedThreadId: number | null = null;

  function processBuffer(): void {
    // SSE blocks are delimited by \n\n
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
    } else if (effectiveEvent === 'tool_call_end') {
      handlers.onToolCallEnd?.(
        typeof data.tool === 'string' ? data.tool : String(data.tool ?? ''),
        typeof data.tool_call_id === 'string' ? data.tool_call_id : String(data.tool_call_id ?? ''),
        typeof data.duration_ms === 'number' ? data.duration_ms : Number(data.duration_ms ?? 0),
      );
    } else if (effectiveEvent === 'error') {
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
      // Flush remaining buffer content
      processBuffer();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    processBuffer();
  }

  return { chatId: capturedChatId, threadId: capturedThreadId };
}
