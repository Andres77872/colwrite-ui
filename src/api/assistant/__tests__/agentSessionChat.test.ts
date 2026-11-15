import { itemAt } from '@/lib/itemAt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findActiveAgentRun, streamAgentSession } from '../agentSessionChat';
import * as session from '@/api/session';
import { agentWebSocketUrl } from '../agentSocket';

const WORKSPACE_ID = 'wsp-6f1c0f5e-8a8b-4c4d-9e2f-1a2b3c4d5e6f';
/** The run's request: every command names the workspace, the request does not. */
const request = { document_id: 'doc-1', message: 'Review my evidence', mode: 'assistant' as const };
const params = { workspace_id: WORKSPACE_ID, ...request };
type Command = { id: string; method: string; params: Record<string, unknown> };
let commands: Command[];
let runStarts: number;
let onStart: (socket: MockSocket, command: Command) => void;
let onSubscribe: (socket: MockSocket, command: Command) => void;
let onList: (socket: MockSocket, command: Command) => void;

class MockSocket {
  static OPEN = 1;
  static instances: MockSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  reply(command: Command, result: unknown) { this.message({ id: command.id, method: command.method, result }); }
  message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  event(seq: number, event: string, data: unknown) {
    this.message({ type: 'event', session_id: 's1', run_id: 'r1', seq, event, data });
  }
  finish(seq = 3) {
    this.event(seq, 'done', { chat_id: 'c1', message_id: 2, usage: { prompt_tokens: 10, completion_tokens: 5 } });
    this.event(seq + 1, 'run.status', { status: 'completed' });
  }
  send(raw: string) {
    const command = JSON.parse(raw) as Command;
    commands.push(command);
    queueMicrotask(() => {
      if (this.readyState !== 1) return;
      switch (command.method) {
        case 'sessions.list': onList(this, command); break;
        case 'sessions.delete': this.reply(command, { deleted: true }); break;
        case 'sessions.create': this.reply(command, { id: 's1', last_seq: 0 }); break;
        case 'sessions.get': this.reply(command, { session: { id: 's1', last_seq: 0 }, run: null }); break;
        case 'sessions.subscribe': this.reply(command, { subscribed: true }); onSubscribe(this, command); break;
        case 'runs.start': runStarts += 1; onStart(this, command); break;
        case 'runs.cancel': this.reply(command, { id: 'r1', status: 'cancelling' }); break;
        case 'ping': this.reply(command, {}); break;
      }
    });
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

beforeEach(() => {
  commands = []; runStarts = 0; MockSocket.instances = [];
  onSubscribe = () => {};
  onList = (socket, command) => socket.reply(command, []);
  onStart = (socket, command) => {
    socket.reply(command, { id: 'r1', status: 'running' });
    socket.event(1, 'token', { content: 'Evidence' });
    socket.finish(2);
  };
  vi.stubGlobal('WebSocket', MockSocket);
});
afterEach(() => { MockSocket.instances.forEach((socket) => socket.close()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('durable agent sessions', () => {
  it('uses cookie-authenticated websocket URL without credentials in query parameters', () => {
    expect(agentWebSocketUrl()).toMatch(/^ws:\/\/.*\/api\/agent\/ws$/);
  });
  it('delivers token, usage and terminal state from the persisted event stream', async () => {
    const onToken = vi.fn();
    const result = await streamAgentSession(params, { onToken });
    expect(onToken).toHaveBeenCalledWith('Evidence');
    expect(result).toEqual({ chatId: 'c1', messageId: 2, usage: { promptTokens: 10, completionTokens: 5 }, terminal: 'done' });
    expect(runStarts).toBe(1);
  });
  it('replays an uncertain start with the same idempotency key and deduplicates events', async () => {
    onStart = (socket, command) => {
      if (runStarts === 1) {
        socket.event(1, 'token', { content: 'first ' });
        socket.close(1006); // server accepted, acknowledgement lost
      } else {
        socket.reply(command, { id: 'r1', status: 'running' });
        socket.event(1, 'token', { content: 'first ' });
        socket.event(1, 'token', { content: 'first ' });
        socket.event(2, 'token', { content: 'second' });
        socket.finish();
      }
    };
    const onToken = vi.fn();
    await streamAgentSession(params, { onToken }, { retry: { baseDelayMs: 0 } });
    const starts = commands.filter((command) => command.method === 'runs.start');
    expect(starts).toHaveLength(2);
    expect(starts[0]?.params.request_id).toBe(itemAt(starts, 1).params.request_id);
    expect(onToken.mock.calls.flat()).toEqual(['first ', 'second']);
    expect(commands.filter((command) => command.method === 'sessions.create')).toHaveLength(1);
  });
  it('reconnects after a delivered token using its cursor without another start', async () => {
    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1', status: 'running' });
      queueMicrotask(() => { socket.event(1, 'token', { content: 'first' }); socket.close(1006); });
    };
    onSubscribe = (socket) => {
      if (MockSocket.instances.length === 2) {
        socket.event(1, 'token', { content: 'duplicate' });
        socket.event(2, 'token', { content: 'next' });
        socket.finish();
      }
    };
    const onToken = vi.fn();
    await streamAgentSession(params, { onToken }, { retry: { baseDelayMs: 0 } });
    expect(runStarts).toBe(1);
    expect(commands.filter((command) => command.method === 'sessions.subscribe')[1]?.params.after_seq).toBe(1);
    expect(onToken.mock.calls.flat()).toEqual(['first', 'next']);
  });
  it('replays a sequence gap received before the start acknowledgement', async () => {
    onStart = (socket, command) => {
      socket.event(1, 'token', { content: 'first' });
      socket.event(3, 'token', { content: 'third' });
      socket.reply(command, { id: 'r1', status: 'running' });
    };
    onSubscribe = (socket) => {
      if (MockSocket.instances.length === 2) {
        socket.event(2, 'token', { content: 'second' });
        socket.event(3, 'token', { content: 'third' });
        socket.finish(4);
      }
    };
    const onToken = vi.fn();
    await streamAgentSession(params, { onToken }, { retry: { baseDelayMs: 0 } });
    expect(runStarts).toBe(1);
    expect(commands.filter((command) => command.method === 'sessions.subscribe')[1]?.params.after_seq).toBe(1);
    expect(onToken.mock.calls.flat()).toEqual(['first', 'second', 'third']);
  });
  it('refreshes an expired subscription without restarting generation', async () => {
    const refresh = vi.spyOn(session, 'ensureRefreshed').mockResolvedValue(true);
    vi.spyOn(session, 'getRefreshGeneration').mockReturnValue('before-connect');
    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1', status: 'running' });
      socket.close(4401);
    };
    onSubscribe = (socket) => {
      if (MockSocket.instances.length === 2) socket.finish(1);
    };
    await streamAgentSession(params, {});
    expect(refresh).toHaveBeenCalledWith('before-connect');
    expect(runStarts).toBe(1);
  });
  it('refreshes again when a long run outlives the refreshed token too', async () => {
    const refresh = vi.spyOn(session, 'ensureRefreshed').mockResolvedValue(true);
    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1', status: 'running' });
      socket.close(4401);
    };
    onSubscribe = (socket) => {
      if (MockSocket.instances.length === 2) setTimeout(() => socket.close(4401), 0);
      if (MockSocket.instances.length === 3) socket.finish(1);
    };
    const result = await streamAgentSession(params, {});
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(runStarts).toBe(1);
    expect(result.terminal).toBe('done');
  });
  it('refreshes expired authentication when discovering active work', async () => {
    const refresh = vi.spyOn(session, 'ensureRefreshed').mockResolvedValue(true);
    const original = MockSocket.prototype.send;
    vi.spyOn(MockSocket.prototype, 'send').mockImplementation(function (this: MockSocket, raw) {
      if (MockSocket.instances.length === 1) { this.close(4401); return; }
      original.call(this, raw);
    });
    await expect(findActiveAgentRun(WORKSPACE_ID, 'doc-1', 'c1')).resolves.toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
    expect(MockSocket.instances).toHaveLength(2);
  });
  it('explicit stop cancels a run even when the start acknowledgement is in flight', async () => {
    const controller = new AbortController();
    onStart = (socket, command) => {
      controller.abort('cancel');
      socket.reply(command, { id: 'r1', status: 'running' });
    };
    await streamAgentSession(params, {}, { signal: controller.signal, abortBehavior: 'detach' });
    expect(commands.find((command) => command.method === 'runs.cancel')?.params.run_id).toBe('r1');
  });
  it('navigation detaches without cancelling backend work', async () => {
    const controller = new AbortController();
    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1', status: 'running' });
      controller.abort();
    };
    await streamAgentSession(params, {}, { signal: controller.signal, abortBehavior: 'detach' });
    expect(commands.some((command) => command.method === 'runs.cancel')).toBe(false);
  });
  it('restores an existing run by replay without generating another reply', async () => {
    onSubscribe = (socket) => { socket.event(1, 'token', { content: 'restored' }); socket.finish(2); };
    const onToken = vi.fn();
    await streamAgentSession(params, { onToken }, { resume: { sessionId: 's1', runId: 'r1' } });
    expect(runStarts).toBe(0);
    expect(onToken).toHaveBeenCalledWith('restored');
  });
  it('does not turn a terminal error into success when a later done arrives', async () => {
    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1' });
      socket.event(1, 'error', { error_code: 'ENGINE_FAILED', message: 'failed' });
      socket.finish(2);
    };
    const result = await streamAgentSession(params, {});
    expect(result.terminal).toBe('error');
  });
  it('keeps the idempotent locator when every start acknowledgement is lost', async () => {
    onStart = (socket) => socket.close(1006);
    const onRunStarted = vi.fn();
    await expect(streamAgentSession(params, {}, { onRunStarted, retry: { maxAttempts: 1 } })).rejects.toThrow();
    const locator = itemAt(onRunStarted.mock.calls, 0)[0];
    expect(locator).toMatchObject({ sessionId: 's1', requestId: expect.any(String) });
    onStart = (socket, command) => { socket.reply(command, { id: 'r1' }); socket.finish(1); };
    await streamAgentSession(params, {}, { resume: locator });
    const starts = commands.filter((command) => command.method === 'runs.start');
    expect(starts[1]?.params.request_id).toBe(itemAt(starts, 0).params.request_id);
  });
  it('preserves engine/model overrides while omitting null optional fields', async () => {
    await streamAgentSession({ ...params, engine: 'claude', model: 'sonnet', chat_id: null }, {});
    expect(commands.find((command) => command.method === 'runs.start')?.params.request).toEqual({ ...request, engine: 'claude', model: 'sonnet' });
  });
  it('sends general/lite gateway selections without confusing them with a CLI model', async () => {
    const gateway_models = { main: 'anthropic/claude-sonnet-5.5', lite: 'google/gemini-4-hydrogen' };
    await streamAgentSession({ ...params, engine: 'claude', model: 'sonnet', gateway_models }, {});
    expect(commands.find((command) => command.method === 'runs.start')?.params.request)
      .toEqual({ ...request, engine: 'claude', model: 'sonnet', gateway_models });
  });
  it('surfaces subscription failures instead of waiting forever', async () => {
    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1' });
      socket.message({ type: 'subscription.error', session_id: 's1', error: { code: 'session_not_found', message: 'Session removed', retryable: false } });
    };
    await expect(streamAgentSession(params, {})).rejects.toThrow('Session removed');
  });

  it('reconnects after a failure the server calls retryable, and only then', async () => {
    const fail = (socket: MockSocket, code: string, message: string, retryable: boolean) =>
      socket.message({ type: 'subscription.error', session_id: 's1', error: { code, message, retryable } });

    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1', status: 'running' });
      fail(socket, 'unavailable', 'Busy', true);
    };
    onSubscribe = (socket) => { if (MockSocket.instances.length === 2) socket.finish(1); };
    const result = await streamAgentSession(params, {}, { retry: { baseDelayMs: 0 } });
    expect(result.terminal).toBe('done');
    expect(MockSocket.instances).toHaveLength(2);

    MockSocket.instances = [];
    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1', status: 'running' });
      fail(socket, 'invalid_cursor', 'Replay cursor is outside this session', false);
    };
    await expect(streamAgentSession(params, {}, { retry: { baseDelayMs: 0 } })).rejects.toThrow('Replay cursor is outside this session');
    expect(MockSocket.instances).toHaveLength(1);
  });

  it('deletes a one-shot session when its run has ended, and never a conversation', async () => {
    await streamAgentSession({ ...params, mode: 'rewrite', ephemeral: true }, {});
    expect(commands.filter((command) => command.method === 'sessions.delete').map((command) => command.params)).toEqual([{ workspace_id: WORKSPACE_ID, session_id: 's1' }]);
    commands = [];
    await streamAgentSession(params, {});
    expect(commands.some((command) => command.method === 'sessions.delete')).toBe(false);
  });
  it('leaves a one-shot session the author stopped to the server', async () => {
    const controller = new AbortController();
    onStart = (socket, command) => {
      controller.abort('cancel');
      socket.reply(command, { id: 'r1', status: 'running' });
    };
    await streamAgentSession({ ...params, mode: 'rewrite', ephemeral: true }, {}, { signal: controller.signal });
    // Its run is still stopping, and a session with an active run cannot be deleted.
    expect(commands.some((command) => command.method === 'sessions.delete')).toBe(false);
    expect(commands.some((command) => command.method === 'runs.cancel')).toBe(true);
  });
  it('counts consecutive failed reconnects, not every drop of a long run', async () => {
    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1', status: 'running' });
      queueMicrotask(() => { socket.event(1, 'token', { content: 'one ' }); socket.close(1006); });
    };
    onSubscribe = (socket) => {
      const connection = MockSocket.instances.length;
      if (connection === 2) { socket.event(2, 'token', { content: 'two ' }); socket.close(1006); }
      if (connection === 3) { socket.event(3, 'token', { content: 'three' }); socket.close(1006); }
      if (connection === 4) socket.finish(4);
    };
    const onToken = vi.fn();
    // Three drops against a limit of two: each reconnect made progress first.
    const result = await streamAgentSession(params, { onToken }, { retry: { baseDelayMs: 0, maxAttempts: 2 } });
    expect(result.terminal).toBe('done');
    expect(onToken.mock.calls.flat()).toEqual(['one ', 'two ', 'three']);
    expect(runStarts).toBe(1);
  });
  it('still gives up when reconnecting gets nowhere', async () => {
    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1', status: 'running' });
      queueMicrotask(() => socket.close(1006));
    };
    onSubscribe = (socket) => { if (MockSocket.instances.length > 1) socket.close(1006); };
    await expect(streamAgentSession(params, {}, { retry: { baseDelayMs: 0, maxAttempts: 3 } })).rejects.toThrow();
    expect(MockSocket.instances).toHaveLength(3);
  });
  it('says when it is back on the run after a reconnect', async () => {
    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1', status: 'running' });
      queueMicrotask(() => { socket.event(1, 'tool_call_start', { tool: 'web_read', tool_call_id: 'c1' }); socket.close(1006); });
    };
    onSubscribe = (socket) => { if (MockSocket.instances.length === 2) setTimeout(() => socket.finish(2), 0); };
    const onStatus = vi.fn();
    await streamAgentSession(params, { onStatus }, { retry: { baseDelayMs: 0 } });
    const states = onStatus.mock.calls.map(([state]) => state);
    // Without the second one the label stayed on "Reconnecting…" for as long
    // as the tool call was quiet.
    expect(states.slice(states.indexOf('reconnecting'))).toEqual(['reconnecting', 'reconnected']);
  });
  it('reports a deleted chat with the code the caller recovers from', async () => {
    onList = (socket, command) => socket.message({ id: command.id, error: { code: 'chat_not_found', message: 'Chat not found for this document', retryable: false } });
    const onError = vi.fn();
    const result = await streamAgentSession({ ...params, chat_id: 'gone' }, { onError });
    expect(onError).toHaveBeenCalledWith('CHAT_NOT_FOUND', 'Chat not found for this document');
    expect(result.terminal).toBe('error');
    expect(runStarts).toBe(0);
  });
  it('does not mistake a missing document for a deleted chat', async () => {
    onList = (socket, command) => socket.message({ id: command.id, error: { code: 'document_not_found', message: 'Document not found', retryable: false } });
    await expect(streamAgentSession({ ...params, chat_id: 'c1' }, {})).rejects.toThrow('Document not found');
  });

});


it('preserves attachment references across uncertain websocket starts without resending metadata', async () => {
  onStart = (socket, command) => {
    if (runStarts === 1) socket.close(1006);
    else { socket.reply(command, { id: 'r1', status: 'running' }); socket.finish(1); }
  };
  await streamAgentSession({ ...params, message: '', attachments: [
    { kind: 'image', image_id: 'image-1', filename: 'chart.png', media_type: 'image/png', size_bytes: 80 },
    { kind: 'resource', resource_id: 42, filename: 'paper.pdf' },
  ] }, {}, { retry: { baseDelayMs: 0 } });
  const starts = commands.filter((command) => command.method === 'runs.start');
  expect(starts).toHaveLength(2);
  expect(starts[0]?.params.request).toEqual({ ...request, message: '', attachments: [
    { kind: 'image', image_id: 'image-1' }, { kind: 'resource', resource_id: 42 },
  ] });
  expect(starts[1]?.params.request).toEqual(itemAt(starts, 0).params.request);
  expect(starts[1]?.params.request_id).toBe(itemAt(starts, 0).params.request_id);
});

describe('the typed commands and Auto (D18)', () => {
  const startRequest = () => itemAt(commands.filter((command) => command.method === 'runs.start'), 0).params.request;

  it('asks for Auto only on an assistant turn', async () => {
    await streamAgentSession({ ...params, apply_mode: 'auto' }, {});
    expect(startRequest()).toEqual({ ...request, apply_mode: 'auto' });

    commands = [];
    await streamAgentSession({ ...params, mode: 'rewrite', ephemeral: true, apply_mode: 'auto' }, {});
    // A rewrite applies nothing by itself, and the server refuses Auto there.
    expect(startRequest()).not.toHaveProperty('apply_mode');
  });

  it('creates a session with the fields `SessionCreate` has, and nothing else', async () => {
    await streamAgentSession(params, {});
    const create = itemAt(commands.filter((command) => command.method === 'sessions.create'), 0);
    expect(Object.keys(create.params).sort()).toEqual(['chat_id', 'document_id', 'ephemeral', 'request_id', 'title', 'workspace_id']);
  });

  it('reports the run’s effective apply policy from its status events', async () => {
    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1', status: 'running' });
      socket.event(1, 'status', { status: 'starting', detail: 'Starting…', apply_policy: 'review', auto_blocked_reason: 'web_research' });
      socket.finish(2);
    };
    const onApplyPolicy = vi.fn();
    const onStatus = vi.fn();
    await streamAgentSession({ ...params, apply_mode: 'auto' }, { onApplyPolicy, onStatus });
    expect(onApplyPolicy).toHaveBeenCalledWith('review', 'web_research');
    expect(onStatus).toHaveBeenCalledWith('starting', 'Starting…');
  });

  it('rejects a reply that is neither a result nor an error', async () => {
    onStart = (socket, command) => {
      socket.message({ id: command.id });
    };
    await expect(streamAgentSession(params, {}, { retry: { maxAttempts: 1 } })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
