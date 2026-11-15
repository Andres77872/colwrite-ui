import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSocket, agentWebSocketUrl, type AgentSessionEvent } from '@/api/assistant/agentSocket';
import type { AssistantEvent } from '@/api/schema';
import { server } from '@/__tests__/server';
import { FIXTURE_DOCUMENT_ID, LAB_DOCUMENT_ID, LAB_WORKSPACE_ID, PERSONAL_WORKSPACE_ID, fixtures } from './fixtures';
import { assistantSocket } from './socket';

/**
 * The assistant socket as the preview and the tests serve it: the API's
 * session log, replay after a cursor, idempotent commands and cancel
 * (`ColWrite-api/docs/assistant-websocket.md`), on MSW's `ws.link`.
 */

const clients: AgentSocket[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});
async function connect(events: AgentSessionEvent[] = []) {
  const client = new AgentSocket((event) => events.push(event));
  clients.push(client);
  await client.connect();
  return client;
}
const DOC = FIXTURE_DOCUMENT_ID;
const WS = PERSONAL_WORKSPACE_ID;
const request = { document_id: DOC, message: 'Review fixture evidence', ephemeral: false };
async function* completeRun(): AsyncGenerator<AssistantEvent> {
  yield { event: 'token', data: { content: 'Fixture summary' } };
  yield { event: 'done', data: { chat_id: 'preview-chat', message_id: 2, usage: { prompt_tokens: 10, completion_tokens: 3 } } };
}

/** A run whose events the test hands out one at a time; `return()` is a cancel. */
function eventSource() {
  const queue: AssistantEvent[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const source = {
    cancelled: false,
    push(event: AssistantEvent) { queue.push(event); wake?.(); },
    close() { closed = true; wake?.(); },
    run(): AsyncIterable<AssistantEvent> {
      return {
        [Symbol.asyncIterator]: () => ({
          async next(): Promise<IteratorResult<AssistantEvent>> {
            while (!queue.length && !closed) await new Promise<void>((resolve) => { wake = resolve; });
            const next = queue.shift();
            return next ? { value: next, done: false } : { value: undefined, done: true };
          },
          async return(): Promise<IteratorResult<AssistantEvent>> {
            source.cancelled = true;
            source.close();
            return { value: undefined, done: true };
          },
        }),
      };
    },
  };
  return source;
}

it('deduplicates session and run commands and rejects conflicting payloads', async () => {
  const stream = vi.fn(completeRun);
  server.use(assistantSocket({ stream }));
  const client = await connect();
  const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC, request_id: 'create' });
  const again = await client.request('sessions.create', { workspace_id: WS, request_id: 'create', document_id: DOC });
  expect(again.id).toBe(session.id);
  await expect(client.request('sessions.create', { workspace_id: WS, request_id: 'create', document_id: '66f0c0ffee0000000000d0c2' })).rejects.toMatchObject({ code: 'conflict' });
  const run = await client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'run', request });
  const retry = await client.request('runs.start', { workspace_id: WS, request: { ...request }, request_id: 'run', session_id: session.id });
  expect(retry.id).toBe(run.id);
  await expect(client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'run', request: { ...request, message: 'different' } })).rejects.toMatchObject({ code: 'conflict' });
  await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
  await vi.waitFor(async () => expect((await client.request('sessions.get', { workspace_id: WS, session_id: session.id })).run?.status).toBe('completed'));
  const snapshot = await client.request('sessions.get', { workspace_id: WS, session_id: session.id });
  expect(snapshot.session.chat_id).toBe('preview-chat');
  expect(snapshot.session.active_run_id).toBeNull();
  expect(await client.request('sessions.list', { workspace_id: WS, document_id: DOC, chat_id: 'preview-chat' })).toHaveLength(1);
});

it('refuses a session on a page that does not exist', async () => {
  const client = await connect();
  await expect(client.request('sessions.create', { workspace_id: WS, document_id: 'missing' })).rejects.toMatchObject({ code: 'document_not_found' });
});

it('keeps sessions and pages to their workspace', async () => {
  const client = await connect();
  // The lab's page is not found through the personal workspace.
  await expect(client.request('sessions.create', { workspace_id: WS, document_id: LAB_DOCUMENT_ID }))
    .rejects.toMatchObject({ code: 'document_not_found' });
  const lab = await client.request('sessions.create', { workspace_id: LAB_WORKSPACE_ID, document_id: LAB_DOCUMENT_ID });
  expect(lab.workspace_id).toBe(LAB_WORKSPACE_ID);
  // A session is not found through another workspace either.
  await expect(client.request('sessions.get', { workspace_id: WS, session_id: lab.id }))
    .rejects.toMatchObject({ code: 'session_not_found' });
  await expect(client.request('sessions.create', { workspace_id: 'wsp-missing', document_id: DOC }))
    .rejects.toMatchObject({ code: 'workspace_not_found' });
});

it('keeps a run alive after disconnect and replays strictly after the supplied cursor', async () => {
  const source = eventSource();
  const stream = vi.fn(() => source.run());
  server.use(assistantSocket({ stream }));
  const before: AgentSessionEvent[] = [];
  const first = await connect(before);
  const session = await first.request('sessions.create', { workspace_id: WS, document_id: DOC });
  await first.request('sessions.subscribe', { workspace_id: WS, session_id: session.id, after_seq: 0 });
  const run = await first.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'run', request });
  await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
  source.push({ event: 'session.chat', data: { chat_id: 'preview-chat' } });
  source.push({ event: 'token', data: { content: 'before' } });
  await vi.waitFor(() => expect(before.some((event) => event.data.content === 'before')).toBe(true));
  const cursor = before.at(-1)!.seq;
  first.close();
  expect(source.cancelled).toBe(false);
  const runningSession = await (await connect()).request('sessions.list', { workspace_id: WS, document_id: DOC, chat_id: 'preview-chat' });
  expect(runningSession[0]?.active_run_id).toBe(run.id);
  source.push({ event: 'token', data: { content: 'after' } });
  const after: AgentSessionEvent[] = [];
  const second = await connect(after);
  await second.request('sessions.subscribe', { workspace_id: WS, session_id: session.id, after_seq: cursor });
  source.push({ event: 'done', data: { chat_id: 'preview-chat', message_id: null, usage: {} } });
  source.close();
  await vi.waitFor(() => expect(after.at(-1)?.data.status).toBe('completed'));
  expect(after.every((event) => event.run_id === run.id && event.seq > cursor)).toBe(true);
  expect(after.filter((event) => event.data.content === 'after')).toHaveLength(1);
  expect(after.some((event) => event.data.content === 'before')).toBe(false);
  expect(after.map((event) => event.seq)).toEqual([...new Set(after.map((event) => event.seq))].sort((a, b) => a - b));
  expect(stream).toHaveBeenCalledTimes(1);
  await expect(second.request('sessions.subscribe', { workspace_id: WS, session_id: session.id, after_seq: 999 })).rejects.toMatchObject({ code: 'invalid_cursor' });
});

it('cancels the producer and preserves a single terminal run on idempotent retry', async () => {
  const source = eventSource();
  const stream = vi.fn(() => source.run());
  server.use(assistantSocket({ stream }));
  const events: AgentSessionEvent[] = [];
  const client = await connect(events);
  const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
  await client.request('sessions.subscribe', { workspace_id: WS, session_id: session.id });
  const run = await client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'run', request });
  await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
  expect((await client.request('runs.cancel', { workspace_id: WS, session_id: session.id, run_id: run.id })).status).toBe('cancelled');
  await vi.waitFor(() => expect(source.cancelled).toBe(true));
  expect((await client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'run', request })).status).toBe('cancelled');
  await vi.waitFor(() => expect(events.filter((event) => event.data.status === 'cancelled')).toHaveLength(1));
  expect(events.some((event) => event.event === 'done')).toBe(false);
  expect(stream).toHaveBeenCalledTimes(1);
});

it('includes preview planning and worker progress only for enabled features', async () => {
  server.use(assistantSocket({ stream: completeRun, enabledFeatures: () => ['todos', 'subagents'] }));
  const events: AgentSessionEvent[] = [];
  const client = await connect(events);
  const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
  await client.request('sessions.subscribe', { workspace_id: WS, session_id: session.id });
  await client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'run', request });
  await vi.waitFor(() => expect(events.at(-1)?.data.status).toBe('completed'));
  expect(events.filter((event) => event.event === 'todo')).toHaveLength(2);
  expect(events.filter((event) => event.event === 'subagent').map((event) => event.data.status)).toEqual(['running', 'completed']);
});

it('gives an Auto turn review, saying why, where the workspace switched Auto off (M5 policy)', async () => {
  server.use(assistantSocket({ stream: completeRun }));
  const personal = fixtures.workspaces.get(WS);
  if (!personal) throw new Error('No personal workspace');
  personal.policy = { ...personal.policy, auto: false };
  const events: AgentSessionEvent[] = [];
  const client = await connect(events);
  const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
  await client.request('sessions.subscribe', { workspace_id: WS, session_id: session.id });
  await client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'run', request: { ...request, apply_mode: 'auto' } });
  await vi.waitFor(() => expect(events.at(-1)?.data.status).toBe('completed'));
  const statuses = events.filter((event) => event.event === 'status');
  expect(statuses[0]?.data).toMatchObject({ apply_policy: 'review', auto_blocked_reason: 'policy' });
});

describe('other sockets', () => {
  it('match only the assistant socket on this host, so Vite HMR and external sockets pass through', () => {
    const handler = assistantSocket();
    expect(handler.test(agentWebSocketUrl())).toBe(true);
    expect(handler.test(`ws://${window.location.host}/?token=hmr`)).toBe(false);
    expect(handler.test('wss://example.org/api/agent/ws')).toBe(false);
  });
});
