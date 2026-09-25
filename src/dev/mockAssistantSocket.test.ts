import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSocket, type AgentSessionEvent } from '../services/agentSocket';
import { installMockAssistantSocket } from './mockAssistantSocket';

type Session = { id: string; chat_id: string | null; active_run_id: string | null; last_seq: number };
type Run = { id: string; status: string };
let restore: (() => void) | undefined;
const clients: AgentSocket[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  restore?.();
  restore = undefined;
  vi.unstubAllGlobals();
});
async function connect(events: AgentSessionEvent[] = []) {
  const client = new AgentSocket((event) => events.push(event));
  clients.push(client);
  await client.connect();
  return client;
}
const request = { document_id: 'doc', message: 'Review fixture evidence', ephemeral: false };
const encode = (event: string, data: Record<string, unknown>) => new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
function completeResponse() {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encode('token', { content: 'Fixture summary' }));
    controller.enqueue(encode('done', { chat_id: 'preview-chat', thread_id: 2, usage: { prompt_tokens: 10, completion_tokens: 3 } }));
    controller.close();
  } }));
}

it('deduplicates session and run commands and rejects conflicting payloads', async () => {
  const stream = vi.fn(completeResponse);
  restore = installMockAssistantSocket({ stream });
  const client = await connect();
  const session = await client.request<Session>('sessions.create', { document_id: 'doc', request_id: 'create' });
  const again = await client.request<Session>('sessions.create', { request_id: 'create', document_id: 'doc' });
  expect(again.id).toBe(session.id);
  await expect(client.request('sessions.create', { request_id: 'create', document_id: 'different' })).rejects.toMatchObject({ code: 'conflict' });
  const run = await client.request<Run>('runs.start', { session_id: session.id, request_id: 'run', request });
  const retry = await client.request<Run>('runs.start', { request: { ...request }, request_id: 'run', session_id: session.id });
  expect(retry.id).toBe(run.id);
  await expect(client.request('runs.start', { session_id: session.id, request_id: 'run', request: { ...request, message: 'different' } })).rejects.toMatchObject({ code: 'conflict' });
  await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
  const snapshot = await client.request<{ session: Session; run: Run }>('sessions.get', { session_id: session.id });
  expect(snapshot.run.status).toBe('completed');
  expect(snapshot.session.chat_id).toBe('preview-chat');
  expect(snapshot.session.active_run_id).toBeNull();
  expect(await client.request<Session[]>('sessions.list', { document_id: 'doc', chat_id: 'preview-chat' })).toHaveLength(1);
});

it('keeps a run alive after disconnect and replays strictly after the supplied cursor', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const stream = vi.fn(() => new Response(new ReadableStream<Uint8Array>({
    start(value) { controller = value; }, cancel() { cancelled = true; },
  })));
  restore = installMockAssistantSocket({ stream });
  const before: AgentSessionEvent[] = [];
  const first = await connect(before);
  const session = await first.request<Session>('sessions.create', { document_id: 'doc' });
  await first.request('sessions.subscribe', { session_id: session.id, after_seq: 0 });
  const run = await first.request<Run>('runs.start', { session_id: session.id, request_id: 'run', request });
  await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
  controller.enqueue(encode('session.chat', { chat_id: 'preview-chat' }));
  controller.enqueue(encode('token', { content: 'before' }));
  await vi.waitFor(() => expect(before.some((event) => event.data.content === 'before')).toBe(true));
  const cursor = before.at(-1)!.seq;
  first.close();
  expect(cancelled).toBe(false);
  const runningSession = await (await connect()).request<Session[]>('sessions.list', { document_id: 'doc', chat_id: 'preview-chat' });
  expect(runningSession[0].active_run_id).toBe(run.id);
  controller.enqueue(encode('token', { content: 'after' }));
  const after: AgentSessionEvent[] = [];
  const second = await connect(after);
  await second.request('sessions.subscribe', { session_id: session.id, after_seq: cursor });
  controller.enqueue(encode('done', { chat_id: 'preview-chat', usage: {} }));
  controller.close();
  await vi.waitFor(() => expect(after.at(-1)?.data.status).toBe('completed'));
  expect(after.every((event) => event.run_id === run.id && event.seq > cursor)).toBe(true);
  expect(after.filter((event) => event.data.content === 'after')).toHaveLength(1);
  expect(after.some((event) => event.data.content === 'before')).toBe(false);
  expect(after.map((event) => event.seq)).toEqual([...new Set(after.map((event) => event.seq))].sort((a, b) => a - b));
  expect(stream).toHaveBeenCalledTimes(1);
  await expect(second.request('sessions.subscribe', { session_id: session.id, after_seq: 999 })).rejects.toMatchObject({ code: 'invalid_cursor' });
});

it('cancels the producer and preserves a single terminal run on idempotent retry', async () => {
  let cancelled = false;
  const stream = vi.fn(() => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } })));
  restore = installMockAssistantSocket({ stream });
  const events: AgentSessionEvent[] = [];
  const client = await connect(events);
  const session = await client.request<Session>('sessions.create', { document_id: 'doc' });
  await client.request('sessions.subscribe', { session_id: session.id });
  const run = await client.request<Run>('runs.start', { session_id: session.id, request_id: 'run', request });
  await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
  expect((await client.request<Run>('runs.cancel', { session_id: session.id, run_id: run.id })).status).toBe('cancelled');
  await vi.waitFor(() => expect(cancelled).toBe(true));
  expect((await client.request<Run>('runs.start', { session_id: session.id, request_id: 'run', request })).status).toBe('cancelled');
  expect(events.filter((event) => event.data.status === 'cancelled')).toHaveLength(1);
  expect(events.some((event) => event.event === 'done')).toBe(false);
  expect(stream).toHaveBeenCalledTimes(1);
});

it('includes preview planning and worker progress only for enabled features', async () => {
  restore = installMockAssistantSocket({ stream: completeResponse, enabledFeatures: async () => ['todos', 'subagents'] });
  const events: AgentSessionEvent[] = [];
  const client = await connect(events);
  const session = await client.request<Session>('sessions.create', { document_id: 'doc' });
  await client.request('sessions.subscribe', { session_id: session.id });
  await client.request('runs.start', { session_id: session.id, request_id: 'run', request });
  await vi.waitFor(() => expect(events.at(-1)?.data.status).toBe('completed'));
  expect(events.filter((event) => event.event === 'todo')).toHaveLength(2);
  expect(events.filter((event) => event.event === 'subagent').map((event) => event.data.status)).toEqual(['running', 'completed']);
});

describe('native socket passthrough', () => {
  it('preserves Vite HMR and external sockets', () => {
    const constructed: unknown[][] = [];
    class Native {
      static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
      constructor(...args: unknown[]) { constructed.push(args); }
    }
    vi.stubGlobal('WebSocket', Native);
    restore = installMockAssistantSocket({ stream: completeResponse });
    const hmr = new WebSocket(`ws://${window.location.host}/?token=hmr`, 'vite-hmr');
    const external = new WebSocket('wss://example.org/api/agent/ws');
    expect(hmr).toBeInstanceOf(Native);
    expect(external).toBeInstanceOf(Native);
    expect(constructed).toHaveLength(2);
    expect(constructed[0][1]).toBe('vite-hmr');
  });
});
