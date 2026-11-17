import { itemAt } from '@/lib/itemAt';
import { agentWorker } from '@/__tests__/agentWorker';
import { describe, it, expect, vi } from 'vitest';
import {
  decodeAgentEvent,
  decodeSources,
  handleAgentEvent,
  mergePassages,
  mergeSources,
  type AgentEventHandlers,
  type AgentEventName,
  type AgentSource,
} from '../streamParser';

// ── Helpers ──

type AgentEvent = readonly [event: string, payload: unknown];

/** Decode one event of the socket and hand it to its handler, as the session client does. */
function dispatch(event: string, payload: unknown, handlers: AgentEventHandlers): void {
  const decoded = decodeAgentEvent(event, payload);
  if (decoded) handleAgentEvent(decoded, handlers);
}

/** A run's events in order. */
function dispatchAll(events: AgentEvent[], handlers: AgentEventHandlers): void {
  for (const [event, payload] of events) dispatch(event, payload, handlers);
}

// ── Tests ──

describe('decoding and handling events', () => {
  // ── Tokens and status ──

  it('calls onToken for a token event', () => {
    const onToken = vi.fn();
    dispatch('token', { content: 'Hello' }, { onToken });
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('Hello');
  });

  it('calls onToken for consecutive tokens in order', () => {
    const onToken = vi.fn();
    dispatchAll(
      [
        ['token', { content: 'Hello' }],
        ['token', { content: ' World' }],
      ],
      { onToken },
    );
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(onToken.mock.calls[0]?.[0]).toBe('Hello');
    expect(onToken.mock.calls[1]?.[0]).toBe(' World');
  });

  it('calls onStatus with the status and detail', () => {
    const onStatus = vi.fn();
    dispatch('status', { status: 'thinking', detail: 'Analyzing...' }, { onStatus });
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith('thinking', 'Analyzing...');
  });

  it('streams reasoning apart from the answer', () => {
    const onReasoning = vi.fn();
    const onToken = vi.fn();
    dispatchAll(
      [
        ['reasoning', { content: 'Checking the loss ' }],
        ['reasoning', { content: '' }],
        ['reasoning', { content: 'definition.' }],
        ['token', { content: 'It is in section 2.' }],
      ],
      { onReasoning, onToken },
    );
    // An empty fragment carries nothing to show.
    expect(onReasoning.mock.calls).toEqual([['Checking the loss '], ['definition.']]);
    expect(onToken.mock.calls).toEqual([['It is in section 2.']]);
  });

  // ── Tool calls ──

  it('calls onToolCallStart with the tool, the call ID and its display', () => {
    const onToolCallStart = vi.fn();
    const display = { label: 'Read a web page', running_label: 'Reading a web page', icon: 'globe', detail_templates: ['On {url_host}'], value_labels: {} };
    dispatch('tool_call_start', { tool: 'web_read', tool_call_id: 'call_abc', arguments: {}, display }, { onToolCallStart });
    expect(onToolCallStart).toHaveBeenCalledTimes(1);
    expect(onToolCallStart).toHaveBeenCalledWith('web_read', 'call_abc', display);
  });

  it('keeps a display’s words for enum values, and only words', () => {
    const onToolCallStart = vi.fn();
    const display = {
      label: 'Explored the citation graph', running_label: 'Exploring', icon: 'network', detail_templates: ['Following {relation}'],
      value_labels: { relation: { citations: 'the papers citing it', bad: 3 }, broken: 'x' },
    };
    dispatch('tool_call_start', { tool: 'paper_graph', tool_call_id: 'c', display }, { onToolCallStart });
    expect(onToolCallStart.mock.calls[0]?.[2]).toEqual({
      label: 'Explored the citation graph', running_label: 'Exploring', icon: 'network', detail_templates: ['Following {relation}'],
      value_labels: { relation: { citations: 'the papers citing it' } },
    });
  });

  it('reads a start without a display, or with a malformed one, as having none', () => {
    const onToolCallStart = vi.fn();
    dispatch('tool_call_start', { tool: 'unknown_tool', tool_call_id: 'a', display: null }, { onToolCallStart });
    dispatch('tool_call_start', { tool: 'x', tool_call_id: 'b', display: { icon: 'globe' } }, { onToolCallStart });
    expect(onToolCallStart.mock.calls.map((call) => call[2])).toEqual([null, null]);
  });

  it('calls onToolCallArgs with the complete parsed arguments', () => {
    const onToolCallArgs = vi.fn();
    dispatch(
      'tool_call_args',
      {
        tool: 'doc_edit',
        tool_call_id: 'call_1',
        arguments: { ops: [{ op: 'write_blocks' }] },
        arguments_preview: '{"ops": []}',
      },
      { onToolCallArgs },
    );
    expect(onToolCallArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'doc_edit',
        toolCallId: 'call_1',
        arguments: { ops: [{ op: 'write_blocks' }] },
        argumentsPreview: '{"ops": []}',
        argumentsTruncated: false,
      }),
    );
  });

  it('calls onToolCallEnd with the full outcome payload', () => {
    const onToolCallEnd = vi.fn();
    dispatch(
      'tool_call_end',
      { tool: 'web_read', tool_call_id: 'call_abc', duration_ms: 1500 },
      { onToolCallEnd },
    );
    expect(onToolCallEnd).toHaveBeenCalledTimes(1);
    expect(onToolCallEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'web_read',
        toolCallId: 'call_abc',
        durationMs: 1500,
        isError: false,
        error: null,
        errorType: null,
      }),
    );
  });

  it('forwards the failure cause and bounded previews of a failed call', () => {
    const onToolCallEnd = vi.fn();
    dispatch(
      'tool_call_end',
      {
        tool: 'semantic_scholar_search',
        tool_call_id: 'call_s2',
        duration_ms: 75,
        is_error: true,
        error: 'External research tool failed; content-bearing details redacted.',
        error_type: 'timeout',
        output_preview: '{"content_redacted": true, "status": "error", "code": "timeout"}',
        output_chars: 96,
        output_truncated: false,
        arguments: { content_redacted: true, query_redacted: true, query_length: 12, year_from: 2020 },
        arguments_preview: '{"content_redacted": true, "query_redacted": true, "query_length": 12, "year_from": 2020}',
      },
      { onToolCallEnd },
    );
    expect(onToolCallEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'semantic_scholar_search',
        toolCallId: 'call_s2',
        durationMs: 75,
        isError: true,
        error: 'External research tool failed; content-bearing details redacted.',
        errorType: 'timeout',
        outputPreview: '{"content_redacted": true, "status": "error", "code": "timeout"}',
        arguments: { content_redacted: true, query_redacted: true, query_length: 12, year_from: 2020 },
        argumentsPreview: '{"content_redacted": true, "query_redacted": true, "query_length": 12, "year_from": 2020}',
      }),
    );
  });

  it('treats an empty error string as absent rather than a blank cause', () => {
    const onToolCallEnd = vi.fn();
    dispatch(
      'tool_call_end',
      { tool: 'web_search', tool_call_id: 'c', duration_ms: 10, is_error: true, error: '', error_type: '' },
      { onToolCallEnd },
    );
    expect(onToolCallEnd).toHaveBeenCalledWith(
      expect.objectContaining({ isError: true, error: null, errorType: null }),
    );
  });

  it('reports how much of a tool call has been drafted, and nothing else', () => {
    const onToolCallProgress = vi.fn();
    dispatchAll(
      [
        ['tool_call_progress', { tool: 'doc_edit', tool_call_id: 'call_1', arguments_chars: 2410.7 }],
        ['tool_call_progress', { tool: 'doc_edit', tool_call_id: 'call_1', arguments_chars: '12' }],
        ['tool_call_progress', { tool: 'doc_edit', tool_call_id: 'call_1', arguments_chars: -1 }],
      ],
      { onToolCallProgress },
    );
    expect(onToolCallProgress.mock.calls).toEqual([
      [{ tool: 'doc_edit', toolCallId: 'call_1', argumentsChars: 2410 }],
    ]);
  });

  // ── Error and done ──

  it('reports an error event as terminal', () => {
    const onError = vi.fn();
    dispatchAll(
      [
        ['token', { content: 'partial' }],
        ['error', { error_code: 'STREAM_ERROR', message: 'boom' }],
      ],
      { onError },
    );
    expect(onError).toHaveBeenCalledWith('STREAM_ERROR', 'boom');
  });

  it('passes the code and message of an error event straight through', () => {
    // Extra fields on the payload are the server's business, not ours: the
    // handler gets the two arguments it is declared with and nothing else.
    const onError = vi.fn();
    dispatch(
      'error',
      { error_code: 'DOCUMENT_NOT_FOUND', message: 'No such document', instance: '/api/agent/chat' },
      { onError },
    );
    expect(onError).toHaveBeenCalledWith('DOCUMENT_NOT_FOUND', 'No such document');
  });

  it('dispatches events that follow an error event', () => {
    const onError = vi.fn();
    const onToken = vi.fn();
    const onDone = vi.fn();
    dispatchAll(
      [
        ['status', { status: 'executing_tool', detail: 'Running search...' }],
        ['error', { error_code: 'TOOL_TIMEOUT', message: 'Tool timed out' }],
        ['token', { content: 'I encountered an error' }],
        ['done', { chat_id: 'x', message_id: null, usage: { prompt_tokens: 5, completion_tokens: 3 } }],
      ],
      { onError, onToken, onDone },
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('TOOL_TIMEOUT', 'Tool timed out');
    expect(onToken).toHaveBeenCalledWith('I encountered an error');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'x', messageId: null, usage: { promptTokens: 5, completionTokens: 3, cachedTokens: 0 } }));
  });

  it('calls onDone with the stored ids, the usage, the models that served the turn and its cost', () => {
    const onDone = vi.fn();
    dispatch(
      'done',
      {
        chat_id: 'abc-123', message_id: 42, usage: { prompt_tokens: 250, completion_tokens: 500, cached_tokens: 180 },
        models: [
          { model: 'anthropic/claude-sonnet-5.5', tier: 'main', calls: 3, fallback: true, prompt_tokens: 230, completion_tokens: 480, cost: 0.0121 },
          { model: 'openai/gpt-6-luna', tier: 'lite', calls: 1, fallback: false, prompt_tokens: 20, completion_tokens: 20, cost: null },
          { tier: 'main' },
        ],
        cost: 0.0121,
      },
      { onDone },
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({
      chatId: 'abc-123',
      messageId: 42,
      usage: { promptTokens: 250, completionTokens: 500, cachedTokens: 180 },
      models: [
        { model: 'anthropic/claude-sonnet-5.5', tier: 'main', calls: 3, fallback: true, prompt_tokens: 230, completion_tokens: 480, cost: 0.0121 },
        { model: 'openai/gpt-6-luna', tier: 'lite', calls: 1, fallback: false, prompt_tokens: 20, completion_tokens: 20, cost: null },
      ],
      cost: 0.0121,
      budget: null,
      persistence: null,
    });
  });

  it('passes null ids as null, and a done with no usage, models, cost, ledger or writes as zero, none and null', () => {
    const onDone = vi.fn();
    dispatch('done', { chat_id: null, message_id: null }, { onDone });
    expect(onDone).toHaveBeenCalledWith({
      chatId: null, messageId: null, usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }, models: [], cost: null,
      budget: null, persistence: null,
    });
  });

  it('hands on the run’s cost ceiling, the limit it reached and its failed writes, and decodes only well-formed counters', () => {
    const onDone = vi.fn();
    const data = {
      chat_id: 'c', message_id: 1, usage: {}, models: [], cost: 0.0121,
      budget: {
        effort: 'standard',
        counters: { model_calls: { used: 60, limit: 60 }, web_calls: { used: 2, limit: null }, broken: { limit: 3 } },
        cost: 0.0121, cost_limit: 5, limit_reached: 'model_calls',
      },
      labels: ['untrusted', 'secret'],
      persistence: { failed_writes: 1, kinds: ['llm_call'] },
    };
    dispatch('done', data, { onDone });
    // What a reply says of the ledger, the two its record keeps too.
    expect(onDone.mock.calls[0]?.[0]).toMatchObject({
      budget: { costLimit: 5, limitReached: 'model_calls' },
      persistence: { failedWrites: 1, kinds: ['llm_call'] },
    });
    expect(onDone.mock.calls[0]?.[0].budget).toEqual({ costLimit: 5, limitReached: 'model_calls' });
    const decoded = decodeAgentEvent('done', data);
    if (decoded?.event !== 'done') throw new Error('not a done');
    expect(decoded.data.budget?.counters).toEqual({ model_calls: { used: 60, limit: 60 }, web_calls: { used: 2, limit: null } });
    expect(decoded.data.labels).toEqual(['untrusted']);
  });

  it('ends nothing on events that do not end the turn', () => {
    const events: AgentEvent[] = [
      ['token', { content: 'cut off mid-' }],
      ['status', { status: 'thinking', detail: '' }],
      ['reasoning', { content: 'hmm' }],
      ['tool_call_start', { tool: 'web_search', tool_call_id: 'c1', arguments: {} }],
      ['tool_call_end', { tool: 'web_search', tool_call_id: 'c1', duration_ms: 3 }],
      ['session.chat', { chat_id: 'chat-1' }],
    ];
    const onDone = vi.fn();
    const onError = vi.fn();
    dispatchAll(events, { onDone, onError });
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  // ── Whole runs ──

  it('dispatches all callbacks in order for a full run', () => {
    const callOrder: string[] = [];
    // Typed so `mock.calls[i][0]` is indexable; a bare `vi.fn(() => …)`
    // infers an empty argument tuple.
    const onStatus = vi.fn((..._args: unknown[]) => callOrder.push('status'));
    const onToken = vi.fn((..._args: unknown[]) => callOrder.push('token'));
    const onToolCallStart = vi.fn((..._args: unknown[]) => callOrder.push('tool_start'));
    const onToolCallEnd = vi.fn((..._args: unknown[]) => callOrder.push('tool_end'));
    const onDone = vi.fn((..._args: unknown[]) => callOrder.push('done'));

    dispatchAll(
      [
        ['status', { status: 'thinking', detail: 'Analyzing...' }],
        ['token', { content: 'Hello' }],
        ['tool_call_start', { tool: 'web_read', tool_call_id: 'call_1', arguments: { text: 'more' } }],
        ['tool_call_end', { tool: 'web_read', tool_call_id: 'call_1', duration_ms: 500 }],
        ['token', { content: ' World' }],
        ['done', { chat_id: 'abc', message_id: 1, usage: { prompt_tokens: 10, completion_tokens: 20 } }],
      ],
      { onStatus, onToken, onToolCallStart, onToolCallEnd, onDone },
    );

    expect(callOrder).toEqual(['status', 'token', 'tool_start', 'tool_end', 'token', 'done']);
    expect(onStatus).toHaveBeenCalledWith('thinking', 'Analyzing...');
    expect(onToken.mock.calls[0]?.[0]).toBe('Hello');
    expect(onToken.mock.calls[1]?.[0]).toBe(' World');
    expect(onToolCallStart).toHaveBeenCalledWith('web_read', 'call_1', null);
    expect(onToolCallEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'web_read',
        toolCallId: 'call_1',
        durationMs: 500,
        isError: false,
      }),
    );
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'abc', messageId: 1, usage: { promptTokens: 10, completionTokens: 20, cachedTokens: 0 } }));
  });

  it('runs a whole run with no handlers at all', () => {
    expect(() => dispatchAll(
      [
        ['token', { content: 'Hello' }],
        ['status', { status: 'thinking', detail: '...' }],
        ['done', { chat_id: 'z', message_id: 3, usage: { prompt_tokens: 1, completion_tokens: 1 } }],
      ],
      {},
    )).not.toThrow();
  });

  // ── Payloads and event names it does not know ──

  it('ignores unknown event types', () => {
    const onToken = vi.fn();
    dispatch('unknown_type', { some: 'data' }, { onToken });
    dispatch('token', { content: 'After unknown' }, { onToken });
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('After unknown');
  });

  it('ignores a payload that is not an object, even on a terminal event', () => {
    const onToken = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    for (const payload of [null, undefined, 'Hello', 42, ['Hello']]) {
      dispatch('token', payload, { onToken });
      dispatch('done', payload, { onDone });
      dispatch('error', payload, { onError });
    }
    expect(onToken).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores a token event whose content is not a string', () => {
    const onToken = vi.fn();
    dispatch('token', { content: 7 }, { onToken });
    dispatch('token', {}, { onToken });
    expect(onToken).not.toHaveBeenCalled();
  });

  // ── Tool action ──

  it('maps snake_case tool_action payload to camelCase ToolAction', () => {
    const onToolAction = vi.fn();
    dispatch(
      'tool_action',
      {
        tool: 'doc_create',
        tool_call_id: 'call_abc',
        actions: [{ op: 'create_document', documentId: 'doc-new' }],
        document_id: 'doc-123',
        version: 5,
        status: 'applied',
      },
      { onToolAction },
    );
    expect(onToolAction).toHaveBeenCalledTimes(1);
    const action = itemAt(onToolAction.mock.calls, 0)[0];
    expect(action.toolCallId).toBe('call_abc');
    expect(action.documentId).toBe('doc-123');
    expect(action).not.toHaveProperty('version');
    expect(action.status).toBe('applied');
    expect(action.tool).toBe('doc_create');
    expect(action.actions).toHaveLength(1);
    expect(action.actions[0]).toEqual({ op: 'create_document', documentId: 'doc-new' });
  });

  it('provides safe defaults for missing fields in tool_action', () => {
    const onToolAction = vi.fn();
    dispatch('tool_action', {}, { onToolAction });
    expect(onToolAction).toHaveBeenCalledTimes(1);
    const action = itemAt(onToolAction.mock.calls, 0)[0];
    expect(action.tool).toBe('');
    expect(action.toolCallId).toBe('');
    expect(action.actions).toEqual([]);
    expect(action.documentId).toBe('');
    expect(action).not.toHaveProperty('version');
    // The safe default is the one that cannot edit the document unseen: a
    // payload that omits `status` must go to review, not straight into the
    // author's document with no way back.
    expect(action.status).toBe('proposed');
    expect(action.message).toBeUndefined();
    expect(action.operationResults).toBeUndefined();
    expect(action.changeSetId).toBeNull();
    expect(action.proposalOperationCount).toBeUndefined();
  });

  it('treats an unrecognised status as needing review', () => {
    const onToolAction = vi.fn();
    dispatch('tool_action', { status: 'committed', document_id: 'doc-1' }, { onToolAction });
    expect(onToolAction.mock.calls[0]?.[0].status).toBe('proposed');
  });

  it('does not turn a missing document id into the string "undefined"', () => {
    const onToolAction = vi.fn();
    dispatch('tool_action', { document_id: null, tool_call_id: null }, { onToolAction });
    const action = itemAt(onToolAction.mock.calls, 0)[0];
    expect(action.documentId).toBe('');
    expect(action.toolCallId).toBe('');
  });

  it('reads the call and document ids only from their snake_case keys', () => {
    const onToolAction = vi.fn();
    dispatch(
      'tool_action',
      { tool: 'doc_edit', toolCallId: 'call_abc', actions: [], documentId: 'doc-123', status: 'applied' },
      { onToolAction },
    );
    expect(onToolAction).toHaveBeenCalledTimes(1);
    const action = itemAt(onToolAction.mock.calls, 0)[0];
    expect(action.toolCallId).toBe('');
    expect(action.documentId).toBe('');
    expect(action).not.toHaveProperty('version');
  });

  it('drops unknown extra fields from tool_action payload', () => {
    const onToolAction = vi.fn();
    dispatch(
      'tool_action',
      {
        tool: 'doc_edit',
        tool_call_id: 'call_abc',
        actions: [],
        document_id: 'doc-123',
        version: 2,
        status: 'applied',
        operationResults: [{ ok: 1 }],
        extra: 'should_not_leak',
      },
      { onToolAction },
    );
    expect(onToolAction).toHaveBeenCalledTimes(1);
    const action = itemAt(onToolAction.mock.calls, 0)[0];
    expect(action).not.toHaveProperty('extra');
    // An entry without a valid per-operation status is not a result, so this
    // malformed one maps to nothing.
    expect(action.operationResults).toBeUndefined();
    // Known fields must be correct
    expect(action.toolCallId).toBe('call_abc');
    expect(action.documentId).toBe('doc-123');
    expect(action).not.toHaveProperty('version');
  });

  it('maps operationResults entries with valid statuses', () => {
    const onToolAction = vi.fn();
    dispatch(
      'tool_action',
      {
        tool: 'doc_edit',
        tool_call_id: 'call_abc',
        actions: [],
        document_id: 'doc-123',
        version: 2,
        status: 'proposed',
        operationResults: [
          { op: 'write_blocks', status: 'applied' },
          { op: 'delete_blocks', status: 'error', message: 'block not found' },
        ],
      },
      { onToolAction },
    );
    const action = itemAt(onToolAction.mock.calls, 0)[0];
    expect(action.operationResults).toEqual([
      { op: 'write_blocks', status: 'applied', message: undefined },
      { op: 'delete_blocks', status: 'error', message: 'block not found' },
    ]);
  });

  it('reads per-operation outcomes only from operationResults', () => {
    const onToolAction = vi.fn();
    dispatch(
      'tool_action',
      {
        tool: 'doc_edit',
        tool_call_id: 'call_abc',
        document_id: 'doc-123',
        status: 'proposed',
        ops: [{ op: 'write_blocks', status: 'applied' }],
      },
      { onToolAction },
    );
    expect(itemAt(onToolAction.mock.calls, 0)[0].operationResults).toBeUndefined();
  });

  it('carries the change set id and proposed operation count of a durable proposal', () => {
    const onToolAction = vi.fn();
    dispatch(
      'tool_action',
      {
        tool: 'doc_edit',
        tool_call_id: 'call_abc',
        document_id: 'doc-123',
        status: 'proposed',
        change_set_id: 'cs-1',
        proposal: { operation_count: 4 },
      },
      { onToolAction },
    );
    const action = itemAt(onToolAction.mock.calls, 0)[0];
    expect(action.changeSetId).toBe('cs-1');
    expect(action.proposalOperationCount).toBe(4);
  });

  it('converts null message to undefined in tool_action', () => {
    const onToolAction = vi.fn();
    dispatch(
      'tool_action',
      {
        tool: 'doc_edit',
        tool_call_id: 'call_abc',
        actions: [],
        document_id: 'doc-123',
        version: 2,
        status: 'error',
        message: null,
      },
      { onToolAction },
    );
    expect(onToolAction).toHaveBeenCalledTimes(1);
    const action = itemAt(onToolAction.mock.calls, 0)[0];
    expect(action.message).toBeUndefined();
    expect(action.status).toBe('error');
  });

  it('dispatches multiple tool_action events with distinct toolCallIds', () => {
    const onToolAction = vi.fn();
    dispatchAll(
      [
        ['tool_action', { tool: 'doc_edit', tool_call_id: 'call_1', actions: [], document_id: 'doc-123', version: 1, status: 'applied' }],
        ['tool_action', { tool: 'doc_edit', tool_call_id: 'call_2', actions: [], document_id: 'doc-123', version: 2, status: 'applied' }],
      ],
      { onToolAction },
    );
    expect(onToolAction).toHaveBeenCalledTimes(2);
    expect(onToolAction.mock.calls[0]?.[0].toolCallId).toBe('call_1');
    expect(onToolAction.mock.calls[1]?.[0].toolCallId).toBe('call_2');
    expect(onToolAction.mock.calls[0]?.[0].documentId).toBe('doc-123');
    expect(onToolAction.mock.calls[1]?.[0].documentId).toBe('doc-123');
  });

  it('tool_action mapping does not affect token or status events', () => {
    const onToolAction = vi.fn();
    const onToken = vi.fn();
    const onStatus = vi.fn();
    dispatchAll(
      [
        ['token', { content: 'Hello' }],
        ['status', { status: 'thinking', detail: 'Processing' }],
        ['tool_action', { tool: 'doc_edit', tool_call_id: 'call_1', actions: [], document_id: 'doc-123', version: 1, status: 'applied' }],
      ],
      { onToolAction, onToken, onStatus },
    );
    expect(onToken).toHaveBeenCalledWith('Hello');
    expect(onStatus).toHaveBeenCalledWith('thinking', 'Processing');
    expect(onToolAction).toHaveBeenCalledTimes(1);
    expect(onToolAction.mock.calls[0]?.[0].toolCallId).toBe('call_1');
  });

  // ── Evidence ──

  /** A reference record as the wire sends it: `csl.id` its key. */
  const wireRecord = (key: string, title: string, extra: Record<string, unknown> = {}, csl: Record<string, unknown> = {}) => ({
    key, kind: 'paper', provider: 'openalex', state: 'unchecked', flags: [], ...extra,
    csl: { id: key, type: 'article-journal', title, ...csl },
  });
  /** A source as the `evidence` event sends it, with its record. */
  const wireSource = (handle: string, record: Record<string, unknown> & { key: unknown; csl?: unknown }, extra: Record<string, unknown> = {}) => ({
    handle, key: record.key, kind: 'paper', title: (record.csl as { title?: string } | undefined)?.title, state: 'unchecked', flags: [],
    provider: 'openalex', record, ...extra,
  });

  it('delivers well-formed sources with their reference record, and drops malformed ones', () => {
    const onEvidence = vi.fn();
    dispatch(
      'evidence',
      {
        sources: [
          wireSource(
            'S1',
            wireRecord('doi:10.1234/a', 'A', { state: 'verified', flags: ['preprint', 'from_the_future'], checked: '2026-11-16', differs: [], secret: 'dropped' }, {
              author: [{ family: 'Lovelace', given: 'Ada' }, { given: 'Nobody' }], issued: { 'date-parts': [[2021]] }, DOI: '10.1234/a',
              abstract: 'not a variable the contract keeps', volume: 3,
            }),
            { state: 'verified', flags: ['preprint'] },
          ),
          wireSource('not-a-handle', wireRecord('x', 'Dropped')),
          { handle: 'S2', key: 'k2', kind: 'paper', title: 'No record' },
          // A record whose CSL id is not its key, or with no title, is no reference.
          wireSource('S3', { ...wireRecord('url:https://example.org', 'Page'), csl: { id: 'other', type: 'webpage', title: 'Page' } }),
          wireSource('S4', wireRecord('url:https://example.org/b', '')),
          // A provider the contract does not name: no reference either.
          wireSource('S5', wireRecord('url:https://example.org/c', 'C', { provider: 'evil' })),
          // A kind and a state this client does not know, on the source itself.
          wireSource('S6', wireRecord('resource:12', 'PDF', { kind: 'pdf', provider: 'resource' }, { type: 'document' }), { kind: 'scroll', state: 'glowing', provider: '' }),
        ],
        passages: [{ id: 'S1.1', level: 'abstract' }, { id: 'S1', level: 'abstract' }, { id: 'S1.2', level: 'everything' }, { id: 'S6.1', level: 'full_text' }],
      },
      { onEvidence },
    );

    expect(onEvidence).toHaveBeenCalledTimes(1);
    const [evidence] = itemAt(onEvidence.mock.calls, 0);
    expect(evidence).toEqual({
      sources: [
        {
          handle: 'S1', key: 'doi:10.1234/a', kind: 'paper', title: 'A', state: 'verified', flags: ['preprint'], provider: 'openalex',
          record: {
            key: 'doi:10.1234/a', kind: 'paper', provider: 'openalex', state: 'verified', flags: ['preprint'], checked: '2026-11-16',
            csl: { id: 'doi:10.1234/a', type: 'article-journal', title: 'A', author: [{ family: 'Lovelace', given: 'Ada' }], issued: { 'date-parts': [[2021]] }, DOI: '10.1234/a' },
          },
        },
        {
          handle: 'S6', key: 'resource:12', kind: 'other', title: 'PDF', state: 'unchecked', flags: [], provider: 'resource',
          record: { key: 'resource:12', kind: 'pdf', provider: 'resource', state: 'unchecked', flags: [], csl: { id: 'resource:12', type: 'document', title: 'PDF' } },
        },
      ],
      passages: [{ id: 'S1.1', level: 'abstract' }, { id: 'S6.1', level: 'full_text' }],
    });
  });

  it('calls onEvidence with passages alone, and not at all when nothing is well formed', () => {
    const onEvidence = vi.fn();
    dispatch('evidence', { sources: [{ handle: 'bad', key: 'x' }], passages: [] }, { onEvidence });
    dispatch('evidence', { sources: 'S1' }, { onEvidence });
    expect(onEvidence).not.toHaveBeenCalled();
    dispatch('evidence', { sources: [], passages: [{ id: 'S3.2', level: 'snippet' }] }, { onEvidence });
    expect(onEvidence).toHaveBeenCalledWith({ sources: [], passages: [{ id: 'S3.2', level: 'snippet' }] });
  });

  it('merges sources by handle: a later entry replaces the earlier one where it stands, an equal one changes nothing', () => {
    const [s1, s2] = decodeSources([
      wireSource('S1', wireRecord('s2:abc', 'A')),
      wireSource('S2', wireRecord('k2', 'B')),
    ]) as [AgentSource, AgentSource];
    const better: AgentSource = {
      ...s1, key: 'doi:10.1234/a',
      record: { ...s1.record, key: 'doi:10.1234/a', csl: { ...s1.record.csl, id: 'doi:10.1234/a', DOI: '10.1234/a' } },
    };

    expect(mergeSources([s1, s2], [structuredClone(s1), s2])).toEqual({ sources: [s1, s2], changed: [] });
    expect(mergeSources([s1, s2], [better])).toEqual({ sources: [better, s2], changed: [better] });
    // A state or a flag set later is a change too.
    const flagged: AgentSource = { ...s2, flags: ['retracted'] };
    expect(mergeSources([s1, s2], [flagged]).changed).toEqual([flagged]);
    // Within one event too, the last entry of a handle is the one kept.
    const s3 = decodeSources([wireSource('S3', wireRecord('k3', 'k3'))])[0] as AgentSource;
    const s3Titled: AgentSource = { ...s3, title: 'C', record: { ...s3.record, csl: { ...s3.record.csl, title: 'C' } } };
    expect(mergeSources([], [s3, s3Titled])).toEqual({ sources: [s3Titled], changed: [s3Titled] });
  });

  it('merges passages by id: the same excerpt read again is the same passage', () => {
    const held = [{ id: 'S1.1', level: 'abstract' as const }];
    expect(mergePassages(held, [{ id: 'S1.1', level: 'abstract' }])).toEqual({ passages: held, changed: [] });
    expect(mergePassages(held, [{ id: 'S1.2', level: 'full_text' }, { id: 'S1.1', level: 'abstract' }])).toEqual({
      passages: [...held, { id: 'S1.2', level: 'full_text' }],
      changed: [{ id: 'S1.2', level: 'full_text' }],
    });
  });

  // ── Session, tasks and workers ──

  it('calls onSessionChat with the chat id of a session.chat event', () => {
    const onSessionChat = vi.fn();
    dispatch('session.chat', { chat_id: 'chat-1' }, { onSessionChat });
    dispatch('session.chat', { chat_id: 7 }, { onSessionChat });
    expect(onSessionChat.mock.calls).toEqual([['chat-1']]);
  });

  it('delivers well-formed todo items and drops malformed ones', () => {
    const onTodo = vi.fn();
    dispatch(
      'todo',
      {
        items: [
          { id: 't1', content: 'Read the draft', status: 'completed' },
          { id: 't2', content: 'Find sources', status: 'in_progress' },
          { id: 't3', content: 'Unknown status', status: 'blocked' },
          { content: 'No id', status: 'pending' },
          null,
          { id: 't4', content: 'Write the summary', status: 'pending' },
        ],
      },
      { onTodo },
    );
    expect(onTodo).toHaveBeenCalledTimes(1);
    expect(onTodo.mock.calls[0]?.[0]).toEqual([
      { id: 't1', content: 'Read the draft', status: 'completed' },
      { id: 't2', content: 'Find sources', status: 'in_progress' },
      { id: 't4', content: 'Write the summary', status: 'pending' },
    ]);
  });

  it('keeps at most 30 todo items', () => {
    const onTodo = vi.fn();
    const items = Array.from({ length: 40 }, (_, index) => ({
      id: `t${index}`,
      content: `Task ${index}`,
      status: 'pending',
    }));
    dispatch('todo', { items }, { onTodo });
    expect(onTodo.mock.calls[0]?.[0]).toHaveLength(30);
    expect(onTodo.mock.calls[0]?.[0][29].id).toBe('t29');
  });

  it('ignores a todo event without an items list', () => {
    const onTodo = vi.fn();
    dispatch('todo', { items: 'Read the draft' }, { onTodo });
    expect(onTodo).not.toHaveBeenCalled();
  });

  it('keeps each worker’s profile, title and objective, including a successful partial report', () => {
    const onSubagent = vi.fn();
    dispatchAll(
      [
        ['subagent', agentWorker({ status: 'running' })],
        ['subagent', agentWorker({ id: 'w2', status: 'partial', profile: 'library_reader' })],
        ['subagent', { ...agentWorker({ id: 'w3' }), status: 'new_status' }],
        // An id-only payload is not the current contract.
        ['subagent', { id: 'old', status: 'running', engine: 'gateway' }],
        ['subagent', { id: 'w3' }],
        ['subagent', { status: 'running' }],
      ],
      { onSubagent },
    );
    expect(onSubagent.mock.calls).toEqual([
      [agentWorker({ status: 'running' })],
      [agentWorker({ id: 'w2', status: 'partial', profile: 'library_reader' })],
      [{ ...agentWorker({ id: 'w3' }), status: 'new_status' }],
    ]);
  });

  it.each(['id', 'status', 'engine', 'profile', 'title', 'objective'])('refuses a worker without its required %s', (field) => {
    const payload: Record<string, unknown> = { ...agentWorker() };
    delete payload[field];
    expect(decodeAgentEvent('subagent', payload)).toBeNull();
  });

  it('does not reinterpret an unknown worker profile as a research worker', () => {
    expect(decodeAgentEvent('subagent', { ...agentWorker(), profile: 'unknown' })).toBeNull();
  });
});

describe('the generated AssistantEvent union', () => {
  it('reports a run’s effective apply policy from its status events', () => {
    const onApplyPolicy = vi.fn();
    const onStatus = vi.fn();
    dispatchAll(
      [
        ['status', { status: 'starting', detail: 'Starting…', apply_policy: 'review', auto_blocked_reason: 'policy' }],
        ['status', { status: 'thinking', detail: '', apply_policy: 'auto', auto_blocked_reason: null }],
        // No policy (an older status), and a reason this client does not know.
        ['status', { status: 'thinking', detail: '' }],
        ['status', { status: 'thinking', detail: '', apply_policy: 'review', auto_blocked_reason: 'moon_phase' }],
        // Auto ended partway through: the run read untrusted content.
        ['status', { status: 'executing_tool', detail: 'Running doc_edit...', apply_policy: 'review', auto_blocked_reason: 'untrusted_content' }],
      ],
      { onApplyPolicy, onStatus },
    );
    expect(onApplyPolicy.mock.calls).toEqual([['review', 'policy'], ['auto', null], ['review', null], ['review', 'untrusted_content']]);
    expect(onStatus).toHaveBeenCalledTimes(5);
  });

  it('keeps an unknown status open, so it can be shown like `thinking`', () => {
    const onStatus = vi.fn();
    dispatch('status', { status: 'summoning', detail: 'Working…' }, { onStatus });
    expect(onStatus).toHaveBeenCalledWith('summoning', 'Working…');
  });

  it('carries a stored set’s apply policy on its tool_action', () => {
    const onToolAction = vi.fn();
    dispatch(
      'tool_action',
      {
        tool: 'doc_edit', tool_call_id: 'call_1', actions: [], operationResults: [], document_id: 'doc-1',
        version: 3, status: 'proposed', change_set_id: 'cs-1', apply_policy: 'auto', auto_blocked_reason: null,
      },
      { onToolAction },
    );
    expect(itemAt(onToolAction.mock.calls, 0)[0]).toMatchObject({ changeSetId: 'cs-1', applyPolicy: 'auto', autoBlockedReason: null });

    dispatch('tool_action', { status: 'proposed', change_set_id: 'cs-2', apply_policy: 'sometimes' }, { onToolAction });
    // An unknown policy is no policy: nothing is applied without the server's `auto`.
    expect(itemAt(onToolAction.mock.calls, 1)[0].applyPolicy).toBeNull();
  });

  it('leaves run.status to the session client', () => {
    const handlers = { onStatus: vi.fn(), onError: vi.fn(), onDone: vi.fn() };
    dispatch('run.status', { run_id: 'r1', status: 'completed' }, handlers);
    expect(handlers.onStatus).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it('reads every event of the contract', () => {
    const names: AgentEventName[] = [
      'status', 'reasoning', 'token', 'tool_call_start', 'tool_call_progress', 'tool_call_args', 'tool_call_end',
      'tool_action', 'evidence', 'claim', 'error', 'done', 'todo', 'subagent', 'session.chat', 'run.status',
      'plan', 'question', 'budget',
      // Images have author-confirmed request cards; comments invalidate shared review records.
      'artifact', 'comment', 'skill', 'instructions',
    ];
    const minimal: Record<AgentEventName, Record<string, unknown>> = {
      status: { status: 'thinking', detail: '' },
      reasoning: { content: 'hmm' },
      token: { content: 'a' },
      tool_call_start: { tool: 't', tool_call_id: 'c' },
      tool_call_progress: { tool: 't', tool_call_id: 'c', arguments_chars: 1 },
      tool_call_args: { tool: 't', tool_call_id: 'c' },
      tool_call_end: { tool: 't', tool_call_id: 'c', duration_ms: 1 },
      tool_action: { status: 'proposed' },
      evidence: { sources: [], passages: [{ id: 'S1.1', level: 'snippet' }] },
      claim: { tool_call_id: 'c', verdict: 'insufficient', evidence_level: 'abstract', cannot_assess: true, passages: [] },
      error: { error_code: 'X', message: 'x' },
      done: { chat_id: null, message_id: null, usage: {} },
      todo: { items: [] },
      subagent: agentWorker({ id: 'w', status: 'running' }),
      'session.chat': { chat_id: 'c' },
      'run.status': { run_id: 'r', status: 'running' },
      plan: { plan_id: 'p', kind: 'outline', brief: '', sections: [], open_questions: [], effort: 'deep', revision: 1, state: 'proposed' },
      question: { question_id: 'q', questions: [{ id: 'q1', text: 'Which venue?', options: ['ICLR'], allow_free_text: true }] },
      budget: { effort: 'standard', counters: { model_calls: { used: 27, limit: 40 } } },
      artifact: { kind: 'image', generation_id: 'gen-00000000-0000-4000-8000-000000000003', status: 'running' },
      comment: { comments: [] },
      skill: { id: 'editor', label: 'Editor', version: '1', resource: null, by: 'tools' },
      instructions: { items: [{ scope: 'page', block_id: null, label: 'Page' }] },
    };
    for (const name of names) expect(decodeAgentEvent(name, minimal[name])?.event).toBe(name);
    expect(decodeAgentEvent('mystery', {})).toBeNull();
    // A reserved event reaches no handler and ends nothing.
    const handlers = { onToken: vi.fn(), onError: vi.fn(), onDone: vi.fn(), onStatus: vi.fn() };
    for (const name of ['artifact', 'comment'] as const) dispatch(name, minimal[name], handlers);
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('dispatches comment identities and exact quotes separately from tool-call telemetry', () => {
    const comment = { comment_id: 'c1', block_id: 'p1', quote: 'The exact claim.', kind: 'claim', severity: 'must_fix' };
    const onComments = vi.fn();
    dispatch('comment', { comments: [comment, { malformed: true }] }, { onComments });
    expect(onComments).toHaveBeenCalledExactlyOnceWith([comment]);
    expect(decodeAgentEvent('comment', { comments: 'invalid' })).toBeNull();
  });

  it('hands on a claim check, a plan, a question and the ledger, and drops what is not one', () => {
    const handlers = { onClaim: vi.fn(), onPlan: vi.fn(), onQuestion: vi.fn(), onBudget: vi.fn() };
    dispatch('claim', {
      tool_call_id: 'call_4', verdict: 'partly', evidence_level: 'full_text', cannot_assess: false,
      passages: [{ id: 'S2.1', level: 'full_text', stance: 'limits' }, { id: 'nope', level: 'abstract', stance: 'supports' }, { id: 'S3.1', level: 'abstract', stance: 'odd' }],
    }, handlers);
    expect(handlers.onClaim).toHaveBeenCalledWith({
      toolCallId: 'call_4', verdict: 'partly', evidenceLevel: 'full_text', cannotAssess: false,
      passages: [{ id: 'S2.1', level: 'full_text', stance: 'limits' }],
    });
    expect(decodeAgentEvent('claim', { tool_call_id: 'c', verdict: 'maybe', passages: [] })).toBeNull();

    dispatch('plan', {
      plan_id: 'p1', kind: 'research', brief: 'Survey routing', effort: 'deep', revision: 2, state: 'running', open_questions: ['Venue?'],
      sections: [{ id: 's1', title: 'Background', goal: 'Set the scene', sources: ['S1'], state: 'working' }, { title: 'no id' }],
    }, handlers);
    expect(handlers.onPlan).toHaveBeenCalledWith({
      plan_id: 'p1', kind: 'research', brief: 'Survey routing', effort: 'deep', revision: 2, state: 'running', open_questions: ['Venue?'],
      sections: [{ id: 's1', title: 'Background', goal: 'Set the scene', sources: ['S1'], state: 'working' }],
    });

    dispatch('question', {
      question_id: 'q1',
      questions: [1, 2, 3, 4].map((n) => ({ id: `q${n}`, text: `Question ${n}?`, options: ['a', 'b', 'c', 'd', 'e'], allow_free_text: false })),
    }, handlers);
    const asked = handlers.onQuestion.mock.calls[0]?.[0] as { questions: Array<{ options: string[] }> };
    expect(asked.questions).toHaveLength(3);
    expect(asked.questions[0]?.options).toEqual(['a', 'b', 'c', 'd']);

    dispatch('budget', { effort: 'standard', counters: { model_calls: { used: 27, limit: 40 } }, cost: 0.5, cost_limit: 5, limit_reached: null }, handlers);
    expect(handlers.onBudget).toHaveBeenCalledWith({
      effort: 'standard', counters: { model_calls: { used: 27, limit: 40 } }, cost: 0.5, cost_limit: 5, limit_reached: null,
    });
  });

  it('decodes a loaded skill without retaining any instruction body or unknown load reason', () => {
    const onSkill = vi.fn();
    dispatch('skill', { id: 'editor', label: 'Editor', version: '1', resource: 'references/figures.md', by: 'read', body: 'Private instructions' }, { onSkill });
    expect(onSkill).toHaveBeenCalledExactlyOnceWith({
      id: 'editor', label: 'Editor', version: '1', resource: 'references/figures.md', by: 'read',
    });
    expect(decodeAgentEvent('skill', { id: 'editor', label: 'Editor', version: '1', by: 'model_requested' })).toBeNull();
  });
});
