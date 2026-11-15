import { itemAt } from '@/lib/itemAt';
import { describe, it, expect, vi } from 'vitest';
import {
  decodeAgentEvent,
  dispatchAgentEvent,
  type AgentEventHandlers,
  type AgentEventName,
  type AgentEventOutcome,
} from '../streamParser';

// ── Helpers ──

type AgentEvent = readonly [event: string, payload: unknown];

const NO_OUTCOME: AgentEventOutcome = { chatId: null, messageId: null, terminal: null };

/**
 * Dispatch a run's events in order, the way the WebSocket client does, and
 * return the outcome of the last event that ended the turn (or an empty
 * outcome when none did).
 */
function dispatchAll(events: AgentEvent[], handlers: AgentEventHandlers): AgentEventOutcome {
  let outcome = NO_OUTCOME;
  for (const [event, payload] of events) {
    const next = dispatchAgentEvent(event, payload, handlers);
    if (next.terminal) outcome = next;
  }
  return outcome;
}

// ── Tests ──

describe('dispatchAgentEvent', () => {
  // ── Tokens and status ──

  it('calls onToken for a token event', () => {
    const onToken = vi.fn();
    const result = dispatchAgentEvent('token', { content: 'Hello' }, { onToken });
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('Hello');
    expect(result).toEqual(NO_OUTCOME);
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
    dispatchAgentEvent('status', { status: 'thinking', detail: 'Analyzing...' }, { onStatus });
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

  it('calls onToolCallStart with tool, call ID, and arguments', () => {
    const onToolCallStart = vi.fn();
    dispatchAgentEvent(
      'tool_call_start',
      { tool: 'add_details', tool_call_id: 'call_abc', arguments: { text: 'more' } },
      { onToolCallStart },
    );
    expect(onToolCallStart).toHaveBeenCalledTimes(1);
    expect(onToolCallStart).toHaveBeenCalledWith('add_details', 'call_abc', { text: 'more' });
  });

  it('calls onToolCallArgs with the complete parsed arguments', () => {
    const onToolCallArgs = vi.fn();
    dispatchAgentEvent(
      'tool_call_args',
      {
        tool: 'doc_edit',
        tool_call_id: 'call_1',
        arguments: { ops: [{ op: 'replace_block' }] },
        arguments_preview: '{"ops": []}',
      },
      { onToolCallArgs },
    );
    expect(onToolCallArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'doc_edit',
        toolCallId: 'call_1',
        arguments: { ops: [{ op: 'replace_block' }] },
        argumentsPreview: '{"ops": []}',
        argumentsTruncated: false,
      }),
    );
  });

  it('calls onToolCallEnd with the full outcome payload', () => {
    const onToolCallEnd = vi.fn();
    dispatchAgentEvent(
      'tool_call_end',
      { tool: 'add_details', tool_call_id: 'call_abc', duration_ms: 1500 },
      { onToolCallEnd },
    );
    expect(onToolCallEnd).toHaveBeenCalledTimes(1);
    expect(onToolCallEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'add_details',
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
    dispatchAgentEvent(
      'tool_call_end',
      {
        tool: 'semantic_scholar_search',
        tool_call_id: 'call_s2',
        duration_ms: 75,
        is_error: true,
        error: "Tool 'semantic_scholar_search' timed out after 90.0s",
        error_type: 'TimeoutError',
        output_preview: null,
        output_chars: 0,
        output_truncated: false,
        arguments: { query: 'transformers' },
        arguments_preview: '{"query": "transformers"}',
      },
      { onToolCallEnd },
    );
    expect(onToolCallEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'semantic_scholar_search',
        toolCallId: 'call_s2',
        durationMs: 75,
        isError: true,
        error: "Tool 'semantic_scholar_search' timed out after 90.0s",
        errorType: 'TimeoutError',
        outputPreview: null,
        arguments: { query: 'transformers' },
        argumentsPreview: '{"query": "transformers"}',
      }),
    );
  });

  it('treats an empty error string as absent rather than a blank cause', () => {
    const onToolCallEnd = vi.fn();
    dispatchAgentEvent(
      'tool_call_end',
      { tool: 'aibeat', tool_call_id: 'c', duration_ms: 10, is_error: true, error: '', error_type: '' },
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
    const result = dispatchAll(
      [
        ['token', { content: 'partial' }],
        ['error', { error_code: 'STREAM_ERROR', message: 'boom' }],
      ],
      { onError },
    );
    expect(onError).toHaveBeenCalledWith('STREAM_ERROR', 'boom');
    expect(result).toEqual({ chatId: null, messageId: null, terminal: 'error' });
  });

  it('passes the code and message of an error event straight through', () => {
    // Extra fields on the payload are the server's business, not ours: the
    // handler gets the two arguments it is declared with and nothing else.
    const onError = vi.fn();
    dispatchAgentEvent(
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
    const result = dispatchAll(
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
    expect(result).toEqual({ chatId: 'x', messageId: null, terminal: 'done' });
  });

  it('calls onDone with chat_id, message_id, usage and returns them', () => {
    const onDone = vi.fn();
    const result = dispatchAgentEvent(
      'done',
      { chat_id: 'abc-123', message_id: 42, usage: { prompt_tokens: 250, completion_tokens: 500 } },
      { onDone },
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('abc-123', 42, { promptTokens: 250, completionTokens: 500 });
    expect(result).toEqual({ chatId: 'abc-123', messageId: 42, terminal: 'done' });
  });

  it('returns null messageId when done event has null message_id', () => {
    const result = dispatchAgentEvent(
      'done',
      { chat_id: 'c', message_id: null, usage: { prompt_tokens: 0, completion_tokens: 0 } },
      {},
    );
    expect(result).toEqual({ chatId: 'c', messageId: null, terminal: 'done' });
  });

  it('returns null chatId when done event has no chat_id', () => {
    const result = dispatchAgentEvent(
      'done',
      { chat_id: null, message_id: 5, usage: { prompt_tokens: 0, completion_tokens: 0 } },
      {},
    );
    expect(result).toEqual({ chatId: null, messageId: 5, terminal: 'done' });
  });

  it('reports zero usage when a done event carries none', () => {
    const onDone = vi.fn();
    dispatchAgentEvent('done', { chat_id: 'u', message_id: 2 }, { onDone });
    expect(onDone).toHaveBeenCalledWith('u', 2, { promptTokens: 0, completionTokens: 0 });
  });

  it('returns no terminal outcome for events that do not end the turn', () => {
    const events: AgentEvent[] = [
      ['token', { content: 'cut off mid-' }],
      ['status', { status: 'thinking', detail: '' }],
      ['reasoning', { content: 'hmm' }],
      ['tool_call_start', { tool: 'web_search', tool_call_id: 'c1', arguments: {} }],
      ['tool_call_end', { tool: 'web_search', tool_call_id: 'c1', duration_ms: 3 }],
      ['session.chat', { chat_id: 'chat-1' }],
    ];
    for (const [event, payload] of events) {
      expect(dispatchAgentEvent(event, payload, {})).toEqual(NO_OUTCOME);
    }
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

    const result = dispatchAll(
      [
        ['status', { status: 'thinking', detail: 'Analyzing...' }],
        ['token', { content: 'Hello' }],
        ['tool_call_start', { tool: 'add_details', tool_call_id: 'call_1', arguments: { text: 'more' } }],
        ['tool_call_end', { tool: 'add_details', tool_call_id: 'call_1', duration_ms: 500 }],
        ['token', { content: ' World' }],
        ['done', { chat_id: 'abc', message_id: 1, usage: { prompt_tokens: 10, completion_tokens: 20 } }],
      ],
      { onStatus, onToken, onToolCallStart, onToolCallEnd, onDone },
    );

    expect(callOrder).toEqual(['status', 'token', 'tool_start', 'tool_end', 'token', 'done']);
    expect(onStatus).toHaveBeenCalledWith('thinking', 'Analyzing...');
    expect(onToken.mock.calls[0]?.[0]).toBe('Hello');
    expect(onToken.mock.calls[1]?.[0]).toBe(' World');
    expect(onToolCallStart).toHaveBeenCalledWith('add_details', 'call_1', { text: 'more' });
    expect(onToolCallEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'add_details',
        toolCallId: 'call_1',
        durationMs: 500,
        isError: false,
      }),
    );
    expect(onDone).toHaveBeenCalledWith('abc', 1, { promptTokens: 10, completionTokens: 20 });
    expect(result).toEqual({ chatId: 'abc', messageId: 1, terminal: 'done' });
  });

  it('returns the outcome of a run even with no handlers', () => {
    const result = dispatchAll(
      [
        ['token', { content: 'Hello' }],
        ['status', { status: 'thinking', detail: '...' }],
        ['done', { chat_id: 'z', message_id: 3, usage: { prompt_tokens: 1, completion_tokens: 1 } }],
      ],
      {} as AgentEventHandlers,
    );
    // Must return captured values even without onDone handler
    expect(result).toEqual({ chatId: 'z', messageId: 3, terminal: 'done' });
  });

  // ── Payloads and event names it does not know ──

  it('ignores unknown event types', () => {
    const onToken = vi.fn();
    const first = dispatchAgentEvent('unknown_type', { some: 'data' }, { onToken });
    dispatchAgentEvent('token', { content: 'After unknown' }, { onToken });
    expect(first).toEqual(NO_OUTCOME);
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('After unknown');
  });

  it('ignores a payload that is not an object, even on a terminal event', () => {
    const onToken = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    for (const payload of [null, undefined, 'Hello', 42, ['Hello']]) {
      expect(dispatchAgentEvent('token', payload, { onToken })).toEqual(NO_OUTCOME);
      expect(dispatchAgentEvent('done', payload, { onDone })).toEqual(NO_OUTCOME);
      expect(dispatchAgentEvent('error', payload, { onError })).toEqual(NO_OUTCOME);
    }
    expect(onToken).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores a token event whose content is not a string', () => {
    const onToken = vi.fn();
    dispatchAgentEvent('token', { content: 7 }, { onToken });
    dispatchAgentEvent('token', {}, { onToken });
    expect(onToken).not.toHaveBeenCalled();
  });

  // ── Tool action ──

  it('maps snake_case tool_action payload to camelCase ToolAction', () => {
    const onToolAction = vi.fn();
    dispatchAgentEvent(
      'tool_action',
      {
        tool: 'doc_edit',
        tool_call_id: 'call_abc',
        actions: [{ op: 'replace_block', blockId: 'b1', block: { html: '<p>hi</p>' } }],
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
    expect(action.tool).toBe('doc_edit');
    expect(action.actions).toHaveLength(1);
    expect(action.actions[0]).toEqual({ op: 'replace_block', blockId: 'b1', block: { html: '<p>hi</p>' } });
  });

  it('provides safe defaults for missing fields in tool_action', () => {
    const onToolAction = vi.fn();
    dispatchAgentEvent('tool_action', {}, { onToolAction });
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
    dispatchAgentEvent('tool_action', { status: 'committed', document_id: 'doc-1' }, { onToolAction });
    expect(onToolAction.mock.calls[0]?.[0].status).toBe('proposed');
  });

  it('does not turn a missing document id into the string "undefined"', () => {
    const onToolAction = vi.fn();
    dispatchAgentEvent('tool_action', { document_id: null, tool_call_id: null }, { onToolAction });
    const action = itemAt(onToolAction.mock.calls, 0)[0];
    expect(action.documentId).toBe('');
    expect(action.toolCallId).toBe('');
  });

  it('reads the call and document ids only from their snake_case keys', () => {
    const onToolAction = vi.fn();
    dispatchAgentEvent(
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
    dispatchAgentEvent(
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
    dispatchAgentEvent(
      'tool_action',
      {
        tool: 'doc_edit',
        tool_call_id: 'call_abc',
        actions: [],
        document_id: 'doc-123',
        version: 2,
        status: 'proposed',
        operationResults: [
          { op: 'replace_block', status: 'applied' },
          { op: 'delete_block', status: 'error', message: 'block not found' },
        ],
      },
      { onToolAction },
    );
    const action = itemAt(onToolAction.mock.calls, 0)[0];
    expect(action.operationResults).toEqual([
      { op: 'replace_block', status: 'applied', message: undefined },
      { op: 'delete_block', status: 'error', message: 'block not found' },
    ]);
  });

  it('reads per-operation outcomes only from operationResults', () => {
    const onToolAction = vi.fn();
    dispatchAgentEvent(
      'tool_action',
      {
        tool: 'doc_edit',
        tool_call_id: 'call_abc',
        document_id: 'doc-123',
        status: 'proposed',
        ops: [{ op: 'replace_block', status: 'applied' }],
      },
      { onToolAction },
    );
    expect(itemAt(onToolAction.mock.calls, 0)[0].operationResults).toBeUndefined();
  });

  it('carries the change set id and proposed operation count of a durable proposal', () => {
    const onToolAction = vi.fn();
    dispatchAgentEvent(
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
    dispatchAgentEvent(
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

  // ── Sources ──

  it('delivers well-formed sources and drops malformed ones', () => {
    const onSources = vi.fn();
    dispatchAgentEvent(
      'sources',
      {
        sources: [
          { id: 'S1', key: '10.1234/a', title: 'A', provider: 'crossref', externalIds: { DOI: '10.1234/a', bad: 3 } },
          { id: 'not-a-handle', key: 'x', title: 'Dropped' },
          { id: 'S2', title: 'No key' },
          { id: 'S3', key: 'https://example.org', provider: 'evil', title: 'Web' },
        ],
      },
      { onSources },
    );

    expect(onSources).toHaveBeenCalledTimes(1);
    const [sources] = itemAt(onSources.mock.calls, 0);
    expect(sources).toEqual([
      { id: 'S1', key: '10.1234/a', title: 'A', provider: 'crossref', externalIds: { DOI: '10.1234/a' } },
      { id: 'S3', key: 'https://example.org', title: 'Web' },
    ]);
  });

  it('does not call onSources when no source is well formed', () => {
    const onSources = vi.fn();
    dispatchAgentEvent('sources', { sources: [{ id: 'bad', key: 'x' }] }, { onSources });
    dispatchAgentEvent('sources', { sources: 'S1' }, { onSources });
    expect(onSources).not.toHaveBeenCalled();
  });

  // ── Session, tasks and workers ──

  it('calls onSessionChat with the chat id of a session.chat event', () => {
    const onSessionChat = vi.fn();
    dispatchAgentEvent('session.chat', { chat_id: 'chat-1' }, { onSessionChat });
    dispatchAgentEvent('session.chat', { chat_id: 7 }, { onSessionChat });
    expect(onSessionChat.mock.calls).toEqual([['chat-1']]);
  });

  it('delivers well-formed todo items and drops malformed ones', () => {
    const onTodo = vi.fn();
    dispatchAgentEvent(
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
    dispatchAgentEvent('todo', { items }, { onTodo });
    expect(onTodo.mock.calls[0]?.[0]).toHaveLength(30);
    expect(onTodo.mock.calls[0]?.[0][29].id).toBe('t29');
  });

  it('ignores a todo event without an items list', () => {
    const onTodo = vi.fn();
    dispatchAgentEvent('todo', { items: 'Read the draft' }, { onTodo });
    expect(onTodo).not.toHaveBeenCalled();
  });

  it('calls onSubagent with the worker id, status and engine', () => {
    const onSubagent = vi.fn();
    dispatchAll(
      [
        ['subagent', { id: 'w1', status: 'running', engine: 'gateway' }],
        ['subagent', { id: 'w2', status: 'done' }],
        ['subagent', { id: 'w3' }],
        ['subagent', { status: 'running' }],
      ],
      { onSubagent },
    );
    expect(onSubagent.mock.calls).toEqual([
      [{ id: 'w1', status: 'running', engine: 'gateway' }],
      [{ id: 'w2', status: 'done', engine: '' }],
    ]);
  });
});

describe('the generated AssistantEvent union', () => {
  it('reports a run’s effective apply policy from its status events', () => {
    const onApplyPolicy = vi.fn();
    const onStatus = vi.fn();
    dispatchAll(
      [
        ['status', { status: 'starting', detail: 'Starting…', apply_policy: 'review', auto_blocked_reason: 'web_research' }],
        ['status', { status: 'thinking', detail: '', apply_policy: 'auto', auto_blocked_reason: null }],
        // No policy (an older status), and a reason this client does not know.
        ['status', { status: 'thinking', detail: '' }],
        ['status', { status: 'thinking', detail: '', apply_policy: 'review', auto_blocked_reason: 'moon_phase' }],
      ],
      { onApplyPolicy, onStatus },
    );
    expect(onApplyPolicy.mock.calls).toEqual([['review', 'web_research'], ['auto', null], ['review', null]]);
    expect(onStatus).toHaveBeenCalledTimes(4);
  });

  it('keeps an unknown status open, so it can be shown like `thinking`', () => {
    const onStatus = vi.fn();
    dispatchAgentEvent('status', { status: 'summoning', detail: 'Working…' }, { onStatus });
    expect(onStatus).toHaveBeenCalledWith('summoning', 'Working…');
  });

  it('carries a stored set’s apply policy on its tool_action', () => {
    const onToolAction = vi.fn();
    dispatchAgentEvent(
      'tool_action',
      {
        tool: 'doc_edit', tool_call_id: 'call_1', actions: [], operationResults: [], document_id: 'doc-1',
        version: 3, status: 'proposed', change_set_id: 'cs-1', apply_policy: 'auto', auto_blocked_reason: null,
      },
      { onToolAction },
    );
    expect(itemAt(onToolAction.mock.calls, 0)[0]).toMatchObject({ changeSetId: 'cs-1', applyPolicy: 'auto', autoBlockedReason: null });

    dispatchAgentEvent('tool_action', { status: 'proposed', change_set_id: 'cs-2', apply_policy: 'sometimes' }, { onToolAction });
    // An unknown policy is no policy: nothing is applied without the server's `auto`.
    expect(itemAt(onToolAction.mock.calls, 1)[0].applyPolicy).toBeNull();
  });

  it('leaves run.status to the session client', () => {
    const handlers = { onStatus: vi.fn(), onError: vi.fn(), onDone: vi.fn() };
    expect(dispatchAgentEvent('run.status', { run_id: 'r1', status: 'completed' }, handlers)).toEqual(NO_OUTCOME);
    expect(handlers.onStatus).not.toHaveBeenCalled();
  });

  it('reads every event of the contract', () => {
    const names: AgentEventName[] = [
      'status', 'reasoning', 'token', 'tool_call_start', 'tool_call_progress', 'tool_call_args', 'tool_call_end',
      'tool_action', 'sources', 'error', 'done', 'todo', 'subagent', 'session.chat', 'run.status',
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
      sources: { sources: [] },
      error: { error_code: 'X', message: 'x' },
      done: { chat_id: null, message_id: null, usage: {} },
      todo: { items: [] },
      subagent: { id: 'w', status: 'running', engine: 'gateway' },
      'session.chat': { chat_id: 'c' },
      'run.status': { run_id: 'r', status: 'running' },
    };
    for (const name of names) expect(decodeAgentEvent(name, minimal[name])?.event).toBe(name);
    expect(decodeAgentEvent('mystery', {})).toBeNull();
  });
});
