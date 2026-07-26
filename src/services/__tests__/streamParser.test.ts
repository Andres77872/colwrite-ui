import { describe, it, expect, vi } from 'vitest';
import { parseSSEStream, type SSEEventHandlers } from '../streamParser';

// ── Helpers ──

/**
 * Create a `Response` whose body is a `ReadableStream` that delivers the given
 * SSE text as a single chunk.
 */
function createMockResponse(sseText: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseText));
      controller.close();
    },
  });
  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/**
 * Create a `Response` whose body delivers the given chunks sequentially across
 * multiple `reader.read()` calls — useful for chunk-boundary tests.
 */
function createChunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}


// ── Tests ──

describe('parseSSEStream', () => {
  // ── 1. Single token event ──
  it('1. calls onToken for a single event: token', async () => {
    const onToken = vi.fn();
    const response = createMockResponse(
      'event: token\ndata: {"content":"Hello"}\n\n',
    );
    const result = await parseSSEStream(response, { onToken });
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('Hello');
    expect(result).toEqual({ chatId: null, threadId: null });
  });

  // ── 2. Multiple consecutive token events ──
  it('2. calls onToken for multiple consecutive tokens in order', async () => {
    const onToken = vi.fn();
    const response = createMockResponse(
      'event: token\ndata: {"content":"Hello"}\n\nevent: token\ndata: {"content":" World"}\n\n',
    );
    await parseSSEStream(response, { onToken });
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(onToken.mock.calls[0][0]).toBe('Hello');
    expect(onToken.mock.calls[1][0]).toBe(' World');
  });

  // ── 3. Status event ──
  it('3. calls onStatus with correct status and detail', async () => {
    const onStatus = vi.fn();
    const response = createMockResponse(
      'event: status\ndata: {"status":"thinking","detail":"Analyzing..."}\n\n',
    );
    await parseSSEStream(response, { onStatus });
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith('thinking', 'Analyzing...');
  });

  // ── 4. Tool call start event ──
  it('4. calls onToolCallStart with tool, call ID, and arguments', async () => {
    const onToolCallStart = vi.fn();
    const response = createMockResponse(
      'event: tool_call_start\ndata: {"tool":"add_details","tool_call_id":"call_abc","arguments":{"text":"more"}}\n\n',
    );
    await parseSSEStream(response, { onToolCallStart });
    expect(onToolCallStart).toHaveBeenCalledTimes(1);
    expect(onToolCallStart).toHaveBeenCalledWith(
      'add_details',
      'call_abc',
      { text: 'more' },
    );
  });

  // ── 5. Tool call end event ──
  it('5. calls onToolCallEnd with tool, call ID, and duration_ms', async () => {
    const onToolCallEnd = vi.fn();
    const response = createMockResponse(
      'event: tool_call_end\ndata: {"tool":"add_details","tool_call_id":"call_abc","duration_ms":1500}\n\n',
    );
    await parseSSEStream(response, { onToolCallEnd });
    expect(onToolCallEnd).toHaveBeenCalledTimes(1);
    expect(onToolCallEnd).toHaveBeenCalledWith('add_details', 'call_abc', 1500);
  });

  // ── 6. Error event (stream continues after) ──
  it('6. calls onError then continues processing subsequent events', async () => {
    const onError = vi.fn();
    const onToken = vi.fn();
    const onDone = vi.fn();
    const response = createMockResponse(
      'event: status\ndata: {"status":"executing_tool","detail":"Running search..."}\n\n'
      + 'event: error\ndata: {"error_code":"TOOL_TIMEOUT","message":"Tool timed out"}\n\n'
      + 'event: token\ndata: {"content":"I encountered an error"}\n\n'
      + 'event: done\ndata: {"chat_id":"x","thread_id":null,"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n',
    );
    const result = await parseSSEStream(response, {
      onError,
      onToken,
      onDone,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('TOOL_TIMEOUT', 'Tool timed out');
    expect(onToken).toHaveBeenCalledWith('I encountered an error');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ chatId: 'x', threadId: null });
  });

  // ── 7. Done event terminates stream ──
  it('7. calls onDone with chat_id, thread_id, usage and returns them', async () => {
    const onDone = vi.fn();
    const response = createMockResponse(
      'event: done\ndata: {"chat_id":"abc-123","thread_id":42,"usage":{"prompt_tokens":250,"completion_tokens":500}}\n\n',
    );
    const result = await parseSSEStream(response, { onDone });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(
      'abc-123',
      42,
      { promptTokens: 250, completionTokens: 500 },
    );
    expect(result).toEqual({ chatId: 'abc-123', threadId: 42 });
  });

  // ── 8. Bare data: line after event: inherits last event type ──
  it('8. bare data: line inherits the last event: type', async () => {
    const onToken = vi.fn();
    const response = createMockResponse(
      'event: token\ndata: {"content":"First"}\n\ndata: {"content":"Second"}\n\n',
    );
    await parseSSEStream(response, { onToken });
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(onToken.mock.calls[0][0]).toBe('First');
    expect(onToken.mock.calls[1][0]).toBe('Second');
  });

  // ── 9. Malformed JSON silently skipped, stream continues ──
  it('9. malformed JSON data is silently skipped, stream continues', async () => {
    const onToken = vi.fn();
    const onDone = vi.fn();
    const response = createMockResponse(
      'event: token\ndata: not-json\n\n'
      + 'event: token\ndata: {"content":"After bad JSON"}\n\n'
      + 'event: done\ndata: {"chat_id":"y","thread_id":1,"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
    );
    const result = await parseSSEStream(response, { onToken, onDone });
    // onToken should only be called for the valid JSON event
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('After bad JSON');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ chatId: 'y', threadId: 1 });
  });

  // ── 10. Empty data: line skipped ──
  it('10. empty data: line is skipped, no callback', async () => {
    const onToken = vi.fn();
    const response = createMockResponse(
      'event: token\ndata:\n\n'
      + 'event: token\ndata: {"content":"After empty"}\n\n',
    );
    await parseSSEStream(response, { onToken });
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('After empty');
  });

  // ── 11. AbortSignal aborted mid-stream ──
  it('11. abort signal stops reading mid-stream without throwing', async () => {
    const ac = new AbortController();
    const onToken = vi.fn();

    // Create a stream that delivers data across multiple ticks
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamController<Uint8Array>;
    const body = new ReadableStream({
      start(controller) {
        streamController = controller;
        // Enqueue first chunk immediately
        controller.enqueue(
          encoder.encode(
            'event: token\ndata: {"content":"Before abort"}\n\n',
          ),
        );
      },
    });
    const response = new Response(body);

    setTimeout(() => {
      ac.abort();
      try {
        streamController.enqueue(
          encoder.encode(
            'event: token\ndata: {"content":"After abort"}\n\n',
          ),
        );
      } catch {
        // stream may already be cancelled
      }
    }, 20);

    const result = await parseSSEStream(response, { onToken }, { signal: ac.signal });

    // At minimum, "Before abort" must have been processed
    // "After abort" may or may not have been processed depending on timing
    expect(onToken.mock.calls.length).toBeGreaterThanOrEqual(1);
    // No exception should have been thrown
    expect(result).toEqual({ chatId: null, threadId: null });
  });

  // ── 12. \n\n split across chunk boundaries ──
  it('12. handles \\n\\n delimiter split across chunk boundaries', async () => {
    const onToken = vi.fn();
    const response = createChunkedResponse([
      'event: token\ndata: {"content":"Hel',
      'lo"}\n\n',
    ]);
    await parseSSEStream(response, { onToken });
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('Hello');
  });

  // ── 13. Partial event: + data: across chunk reads ──
  it('13. reassembles event and data lines split across chunk boundaries', async () => {
    const onToken = vi.fn();
    const response = createChunkedResponse([
      'eve',
      'nt: token\ndata: {"content":"Hi"}\n\n',
    ]);
    await parseSSEStream(response, { onToken });
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('Hi');
  });

  // ── 14. Full integration sequence ──
  it('14. dispatches all callbacks in correct order for full integration sequence', async () => {
    const callOrder: string[] = [];
    // Typed so `mock.calls[i][0]` is indexable; a bare `vi.fn(() => …)`
    // infers an empty argument tuple.
    const onStatus = vi.fn((..._args: unknown[]) => callOrder.push('status'));
    const onToken = vi.fn((..._args: unknown[]) => callOrder.push('token'));
    const onToolCallStart = vi.fn((..._args: unknown[]) => callOrder.push('tool_start'));
    const onToolCallEnd = vi.fn((..._args: unknown[]) => callOrder.push('tool_end'));
    const onDone = vi.fn((..._args: unknown[]) => callOrder.push('done'));

    const response = createMockResponse(
      'event: status\ndata: {"status":"thinking","detail":"Analyzing..."}\n\n'
      + 'event: token\ndata: {"content":"Hello"}\n\n'
      + 'event: tool_call_start\ndata: {"tool":"add_details","tool_call_id":"call_1","arguments":{"text":"more"}}\n\n'
      + 'event: tool_call_end\ndata: {"tool":"add_details","tool_call_id":"call_1","duration_ms":500}\n\n'
      + 'event: token\ndata: {"content":" World"}\n\n'
      + 'event: done\ndata: {"chat_id":"abc","thread_id":1,"usage":{"prompt_tokens":10,"completion_tokens":20}}\n\n',
    );

    const result = await parseSSEStream(response, {
      onStatus, onToken, onToolCallStart, onToolCallEnd, onDone,
    });

    expect(callOrder).toEqual([
      'status', 'token', 'tool_start', 'tool_end', 'token', 'done',
    ]);
    expect(onStatus).toHaveBeenCalledWith('thinking', 'Analyzing...');
    expect(onToken.mock.calls[0][0]).toBe('Hello');
    expect(onToken.mock.calls[1][0]).toBe(' World');
    expect(onToolCallStart).toHaveBeenCalledWith(
      'add_details', 'call_1', { text: 'more' },
    );
    expect(onToolCallEnd).toHaveBeenCalledWith('add_details', 'call_1', 500);
    expect(onDone).toHaveBeenCalledWith(
      'abc', 1, { promptTokens: 10, completionTokens: 20 },
    );
    expect(result).toEqual({ chatId: 'abc', threadId: 1 });
  });

  // ── 15. Bare data line without event: → emitted as onToken ──
  it('15. bare data: line without preceding event: is emitted as onToken', async () => {
    const onToken = vi.fn();
    const response = createMockResponse(
      'data: {"content":"Bare data line"}\n\n',
    );
    await parseSSEStream(response, { onToken });
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('Bare data line');
  });

  // ── 16. Empty handlers object ──
  it('16. empty handlers object reads to completion without error', async () => {
    const response = createMockResponse(
      'event: token\ndata: {"content":"Hello"}\n\n'
      + 'event: status\ndata: {"status":"thinking","detail":"..."}\n\n'
      + 'event: done\ndata: {"chat_id":"z","thread_id":3,"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
    );
    const result = await parseSSEStream(response, {} as SSEEventHandlers);
    // Must return captured values even without onDone handler
    expect(result).toEqual({ chatId: 'z', threadId: 3 });
  });

  // ── Extra: null body response ──
  it('handles response with null body', async () => {
    const response = new Response(null);
    const onToken = vi.fn();
    const result = await parseSSEStream(response, { onToken });
    expect(onToken).not.toHaveBeenCalled();
    expect(result).toEqual({ chatId: null, threadId: null });
  });

  // ── Extra: unknown event type is silently skipped ──
  it('silently skips unknown event types', async () => {
    const onToken = vi.fn();
    const response = createMockResponse(
      'event: unknown_type\ndata: {"some":"data"}\n\n'
      + 'event: token\ndata: {"content":"After unknown"}\n\n',
    );
    await parseSSEStream(response, { onToken });
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('After unknown');
  });

  // ── Extra: no event line, just data line with inheriting ──
  it('handles multiple consecutive bare data lines as tokens', async () => {
    const onToken = vi.fn();
    const response = createMockResponse(
      'data: {"content":"First"}\n\ndata: {"content":"Second"}\n\n',
    );
    await parseSSEStream(response, { onToken });
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(onToken.mock.calls[0][0]).toBe('First');
    expect(onToken.mock.calls[1][0]).toBe('Second');
  });

  // ── Extra: done event with null thread_id ──
  it('returns null threadId when done event has null thread_id', async () => {
    const onDone = vi.fn();
    const response = createMockResponse(
      'event: done\ndata: {"chat_id":"c","thread_id":null,"usage":{"prompt_tokens":0,"completion_tokens":0}}\n\n',
    );
    const result = await parseSSEStream(response, { onDone });
    expect(result).toEqual({ chatId: 'c', threadId: null });
  });

  // ── Extra: done event with no chat_id ──
  it('returns null chatId when done event has no chat_id', async () => {
    const onDone = vi.fn();
    const response = createMockResponse(
      'event: done\ndata: {"chat_id":null,"thread_id":5,"usage":{"prompt_tokens":0,"completion_tokens":0}}\n\n',
    );
    const result = await parseSSEStream(response, { onDone });
    expect(result).toEqual({ chatId: null, threadId: 5 });
  });

  // ── Tool Action: snake_case → camelCase mapping ──
  it('maps snake_case tool_action payload to camelCase ToolAction', async () => {
    const onToolAction = vi.fn();
    const response = createMockResponse(
      'event: tool_action\ndata: {"tool":"doc_edit","tool_call_id":"call_abc","actions":[{"op":"replace_block","blockId":"b1","block":{"html":"<p>hi</p>"}}],"document_id":"doc-123","version":5,"status":"applied"}\n\n',
    );
    await parseSSEStream(response, { onToolAction });
    expect(onToolAction).toHaveBeenCalledTimes(1);
    const action = onToolAction.mock.calls[0][0];
    expect(action.toolCallId).toBe('call_abc');
    expect(action.documentId).toBe('doc-123');
    expect(action.version).toBe(5);
    expect(action.status).toBe('applied');
    expect(action.tool).toBe('doc_edit');
    expect(action.actions).toHaveLength(1);
    expect(action.actions[0]).toEqual({ op: 'replace_block', blockId: 'b1', block: { html: '<p>hi</p>' } });
  });

  // ── Tool Action: missing fields → safe defaults ──
  it('provides safe defaults for missing fields in tool_action', async () => {
    const onToolAction = vi.fn();
    const response = createMockResponse(
      'event: tool_action\ndata: {}\n\n',
    );
    await parseSSEStream(response, { onToolAction });
    expect(onToolAction).toHaveBeenCalledTimes(1);
    const action = onToolAction.mock.calls[0][0];
    expect(action.tool).toBe('');
    expect(action.toolCallId).toBe('');
    expect(action.actions).toEqual([]);
    expect(action.documentId).toBe('');
    expect(action.version).toBe(0);
    expect(action.status).toBe('applied');
    expect(action.message).toBeUndefined();
  });

  // ── Tool Action: extra fields are dropped (whitelist semantics) ──
  it('drops unknown extra fields from tool_action payload', async () => {
    const onToolAction = vi.fn();
    const response = createMockResponse(
      'event: tool_action\ndata: {"tool":"doc_edit","tool_call_id":"call_abc","actions":[],"document_id":"doc-123","version":2,"status":"applied","operationResults":[{"ok":1}],"extra":"should_not_leak"}\n\n',
    );
    await parseSSEStream(response, { onToolAction });
    expect(onToolAction).toHaveBeenCalledTimes(1);
    const action = onToolAction.mock.calls[0][0];
    // operationResults and extra must not appear
    expect(action).not.toHaveProperty('operationResults');
    expect(action).not.toHaveProperty('extra');
    // Known fields must be correct
    expect(action.toolCallId).toBe('call_abc');
    expect(action.documentId).toBe('doc-123');
    expect(action.version).toBe(2);
  });

  // ── Tool Action: null message → undefined ──
  it('converts null message to undefined in tool_action', async () => {
    const onToolAction = vi.fn();
    const response = createMockResponse(
      'event: tool_action\ndata: {"tool":"doc_edit","tool_call_id":"call_abc","actions":[],"document_id":"doc-123","version":2,"status":"error","message":null}\n\n',
    );
    await parseSSEStream(response, { onToolAction });
    expect(onToolAction).toHaveBeenCalledTimes(1);
    const action = onToolAction.mock.calls[0][0];
    expect(action.message).toBeUndefined();
    expect(action.status).toBe('error');
  });

  // ── Tool Action: multiple events with different tool_call_id ──
  it('dispatches multiple tool_action events with distinct toolCallIds', async () => {
    const onToolAction = vi.fn();
    const response = createMockResponse(
      'event: tool_action\ndata: {"tool":"doc_edit","tool_call_id":"call_1","actions":[],"document_id":"doc-123","version":1,"status":"applied"}\n\n'
      + 'event: tool_action\ndata: {"tool":"doc_edit","tool_call_id":"call_2","actions":[],"document_id":"doc-123","version":2,"status":"applied"}\n\n',
    );
    await parseSSEStream(response, { onToolAction });
    expect(onToolAction).toHaveBeenCalledTimes(2);
    expect(onToolAction.mock.calls[0][0].toolCallId).toBe('call_1');
    expect(onToolAction.mock.calls[1][0].toolCallId).toBe('call_2');
    // Verify camelCase keys on both calls
    expect(onToolAction.mock.calls[0][0].documentId).toBe('doc-123');
    expect(onToolAction.mock.calls[1][0].documentId).toBe('doc-123');
  });

  // ── Tool Action: existing camelCase payload is also handled ──
  it('passes through existing camelCase fields unscathed', async () => {
    const onToolAction = vi.fn();
    // If the backend ever switches to camelCase or a mixed format, the mapping
    // should still produce correct output (explicit mapping favors correct types).
    const response = createMockResponse(
      'event: tool_action\ndata: {"tool":"doc_edit","toolCallId":"call_abc","actions":[],"documentId":"doc-123","version":3,"status":"applied"}\n\n',
    );
    await parseSSEStream(response, { onToolAction });
    expect(onToolAction).toHaveBeenCalledTimes(1);
    const action = onToolAction.mock.calls[0][0];
    // camelCase keys map to themselves via String(data.toolCallId ?? '')
    expect(action.toolCallId).toBe('call_abc');
    expect(action.documentId).toBe('doc-123');
    expect(action.version).toBe(3);
  });

  // ── Tool Action: non-tool-action events still dispatch correctly ──
  it('tool_action mapping does not affect token or status events', async () => {
    const onToolAction = vi.fn();
    const onToken = vi.fn();
    const onStatus = vi.fn();
    const response = createMockResponse(
      'event: token\ndata: {"content":"Hello"}\n\n'
      + 'event: status\ndata: {"status":"thinking","detail":"Processing"}\n\n'
      + 'event: tool_action\ndata: {"tool":"doc_edit","tool_call_id":"call_1","actions":[],"document_id":"doc-123","version":1,"status":"applied"}\n\n',
    );
    await parseSSEStream(response, { onToolAction, onToken, onStatus });
    expect(onToken).toHaveBeenCalledWith('Hello');
    expect(onStatus).toHaveBeenCalledWith('thinking', 'Processing');
    expect(onToolAction).toHaveBeenCalledTimes(1);
    expect(onToolAction.mock.calls[0][0].toolCallId).toBe('call_1');
  });
});
