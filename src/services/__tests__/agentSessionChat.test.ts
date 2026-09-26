import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findActiveAgentRun, streamAgentSession } from '../agentSessionChat';
import * as api from '../api';
import { agentWebSocketUrl } from '../agentSocket';

const params = { document_id: 'doc-1', message: 'Review my evidence', mode: 'assistant' as const };
type Command = { id: string; method: string; params: Record<string, unknown> };
let commands: Command[];
let runStarts: number;
let onStart: (socket: MockSocket, command: Command) => void;
let onSubscribe: (socket: MockSocket, command: Command) => void;

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
  reply(command: Command, result: unknown) { this.message({ id: command.id, result }); }
  message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  event(seq: number, event: string, data: unknown) {
    this.message({ type: 'event', session_id: 's1', run_id: 'r1', seq, event, data });
  }
  finish(seq = 3) {
    this.event(seq, 'done', { chat_id: 'c1', thread_id: 2, usage: { prompt_tokens: 10, completion_tokens: 5 } });
    this.event(seq + 1, 'run.status', { status: 'completed' });
  }
  send(raw: string) {
    const command = JSON.parse(raw) as Command;
    commands.push(command);
    queueMicrotask(() => {
      if (this.readyState !== 1) return;
      switch (command.method) {
        case 'sessions.list': this.reply(command, []); break;
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
    expect(result).toEqual({ chatId: 'c1', threadId: 2, usage: { promptTokens: 10, completionTokens: 5 }, terminal: 'done' });
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
    expect(starts[0].params.request_id).toBe(starts[1].params.request_id);
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
    expect(commands.filter((command) => command.method === 'sessions.subscribe')[1].params.after_seq).toBe(1);
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
    expect(commands.filter((command) => command.method === 'sessions.subscribe')[1].params.after_seq).toBe(1);
    expect(onToken.mock.calls.flat()).toEqual(['first', 'second', 'third']);
  });
  it('refreshes an expired subscription without restarting generation', async () => {
    const refresh = vi.spyOn(api, 'ensureRefreshed').mockResolvedValue(true);
    vi.spyOn(api, 'getRefreshGeneration').mockReturnValue('before-connect');
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
    const refresh = vi.spyOn(api, 'ensureRefreshed').mockResolvedValue(true);
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
    const refresh = vi.spyOn(api, 'ensureRefreshed').mockResolvedValue(true);
    const original = MockSocket.prototype.send;
    vi.spyOn(MockSocket.prototype, 'send').mockImplementation(function (this: MockSocket, raw) {
      if (MockSocket.instances.length === 1) { this.close(4401); return; }
      original.call(this, raw);
    });
    await expect(findActiveAgentRun('doc-1', 'c1')).resolves.toBeNull();
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
    const locator = onRunStarted.mock.calls[0][0];
    expect(locator).toMatchObject({ sessionId: 's1', requestId: expect.any(String) });
    onStart = (socket, command) => { socket.reply(command, { id: 'r1' }); socket.finish(1); };
    await streamAgentSession(params, {}, { resume: locator });
    const starts = commands.filter((command) => command.method === 'runs.start');
    expect(starts[1].params.request_id).toBe(starts[0].params.request_id);
  });
  it('preserves engine/model overrides while omitting null optional fields', async () => {
    await streamAgentSession({ ...params, engine: 'claude', model: 'sonnet', chat_id: null }, {});
    expect(commands.find((command) => command.method === 'runs.start')?.params.request).toEqual({ ...params, engine: 'claude', model: 'sonnet' });
  });
  it('surfaces subscription failures instead of waiting forever', async () => {
    onStart = (socket, command) => {
      socket.reply(command, { id: 'r1' });
      socket.message({ type: 'subscription.error', session_id: 's1', error: { code: 'not_found', message: 'Session removed' } });
    };
    await expect(streamAgentSession(params, {})).rejects.toThrow('Session removed');
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
  expect(starts[0].params.request).toEqual({ ...params, message: '', attachments: [
    { kind: 'image', image_id: 'image-1' }, { kind: 'resource', resource_id: 42 },
  ] });
  expect(starts[1].params.request).toEqual(starts[0].params.request);
  expect(starts[1].params.request_id).toBe(starts[0].params.request_id);
});
