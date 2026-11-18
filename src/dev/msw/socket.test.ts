import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSocket, agentWebSocketUrl, type AgentSessionEvent } from '@/api/assistant/agentSocket';
import type { AssistantEvent, DoneData, EvidenceData } from '@/api/schema';
import { server } from '@/__tests__/server';
import { FIXTURE_DOCUMENT_ID, LAB_DOCUMENT_ID, LAB_WORKSPACE_ID, PERSONAL_WORKSPACE_ID, VIEWER_DOCUMENT_ID, VIEWER_WORKSPACE_ID, chatsOf, fixtures, messageChain, newestMessage } from './fixtures';
import { assistantSocket, proposedAction, type AssistantTurnContext } from './socket';
import { FEDUS, asFound } from '../fixtureReferences';

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
const request = { document_id: DOC, message: 'Review fixture evidence' };
const USAGE = { prompt_tokens: 10, completion_tokens: 3, cached_tokens: 0 };
const done = (messageId: number | null = 2): AssistantEvent => (
  { event: 'done', data: { chat_id: 'preview-chat', message_id: messageId, usage: USAGE, models: [], cost: null, budget: null, persistence: null } }
);
async function* completeRun(): AsyncGenerator<AssistantEvent> {
  yield { event: 'token', data: { content: 'Fixture summary' } };
  yield done();
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
  const explicitFalse = await client.request('runs.start', { workspace_id: WS, request: { ...request, web: false }, request_id: 'run', session_id: session.id });
  expect(explicitFalse.id).toBe(run.id);
  expect(explicitFalse.request.web).toBe(false);
  await expect(client.request('runs.start', { workspace_id: WS, request: { ...request, web: true }, request_id: 'run', session_id: session.id })).rejects.toMatchObject({ code: 'conflict' });
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

it.each([false, true])('narrows the mock run’s tools by Web %s without narrowing its capability catalog', async (web) => {
  fixtures.assistant = { switches: { web: true, workers: true }, sources: {} };
  const stream = vi.fn((_request, _context: AssistantTurnContext) => completeRun());
  server.use(assistantSocket({ stream }));
  const client = await connect();
  const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
  await client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'web-choice', request: { ...request, web } });
  await vi.waitFor(() => expect(stream).toHaveBeenCalledOnce());
  const tools = stream.mock.calls[0]?.[1].tools;
  expect(tools?.has('web_search')).toBe(web);
  expect(tools?.has('web_read')).toBe(web);
  expect(tools?.has('paper_search')).toBe(true);
  expect(tools?.has('delegate')).toBe(true);
});

it.each([null, 'true', 1])('refuses non-boolean mock Web input %j', async (web) => {
  const client = await connect();
  const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
  // Deliberately off-contract input, as a raw socket could send it.
  const invalid = JSON.parse(JSON.stringify({ ...request, web }));
  await expect(client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'invalid-web', request: invalid }))
    .rejects.toMatchObject({ code: 'invalid_request' });
});

it.each([
  { attachments: [{ kind: 'image', image_id: '00000000-0000-4000-8000-000000000001' }] },
  { attachments: [{ kind: 'image', asset_id: '../../image' }] },
  { attachments: [{ kind: 'image', asset_id: 'ast-00000000-0000-4000-8000-000000000001', filename: 'spoof.png' }] },
  { attachments: [{ kind: 'resource', resource_id: true }] },
  { attachments: [{ kind: 'resource', resource_id: 42 }, { kind: 'resource', resource_id: 42 }] },
  { attachments: Array.from({ length: 9 }, (_, i) => ({ kind: 'resource', resource_id: i + 1 })) },
])('refuses off-contract attachment references before admitting a run: $attachments', async ({ attachments }) => {
  const client = await connect();
  const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
  const invalid = JSON.parse(JSON.stringify({ ...request, attachments }));
  await expect(client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'invalid-attachment', request: invalid }))
    .rejects.toMatchObject({ code: 'invalid_request' });
  const snapshot = await client.request('sessions.get', { workspace_id: WS, session_id: session.id });
  expect(snapshot.run).toBeNull();
  expect(snapshot.session.active_run_id).toBeNull();
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
  source.push(done(null));
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

it('includes the task list in a chat run, and a worker only where the account switched Workers on', async () => {
  fixtures.assistant = { ...fixtures.assistant, switches: { workers: true } };
  server.use(assistantSocket({ stream: completeRun }));
  const events: AgentSessionEvent[] = [];
  const client = await connect(events);
  const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
  await client.request('sessions.subscribe', { workspace_id: WS, session_id: session.id });
  await client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'run', request });
  await vi.waitFor(() => expect(events.at(-1)?.data.status).toBe('completed'));
  expect(events.filter((event) => event.event === 'todo')).toHaveLength(2);
  // A worker waits for a slot (`queued`), runs, and always ends.
  expect(events.filter((event) => event.event === 'subagent').map((event) => event.data.status)).toEqual(['queued', 'running', 'completed']);
  const worker = events.filter((event) => event.event === 'subagent' || String(event.data.tool_call_id ?? '').includes(':'));
  expect(worker.map((event) => `${event.event}:${String(event.data.status ?? '')}`)).toEqual([
    'subagent:queued', 'subagent:running', 'tool_call_start:', 'tool_call_args:', 'tool_call_end:', 'subagent:completed',
  ]);
});

/** A tool call as the stream sends it: its start, its arguments and its outcome. */
function toolCall(tool: string, id: string): AssistantEvent[] {
  return [
    { event: 'tool_call_start', data: { tool, tool_call_id: id, arguments: {}, arguments_preview: '{}', arguments_deferred: true, display: null } },
    { event: 'tool_call_args', data: { tool, tool_call_id: id, arguments: {}, arguments_preview: '{}', arguments_truncated: null } },
    { event: 'tool_call_end', data: { tool, tool_call_id: id, duration_ms: 10, is_error: false, error: null, error_type: null, output_preview: '{"content_redacted": true}', output_chars: 2, output_truncated: false, arguments: {}, arguments_preview: '{}', arguments_truncated: null } },
  ];
}

it('keeps Auto after the run reads outside material: every status says so and later sets are stored as auto', async () => {
  // An edit, a paper search (third-party text), then another edit. Each set
  // is stored with the run's policy of when it was made, which a read does
  // not change.
  async function* editSearchEdit(_request: unknown, { policy }: AssistantTurnContext): AsyncGenerator<AssistantEvent> {
    yield* toolCall('doc_edit', 'call_a');
    yield { event: 'tool_action', data: proposedAction(DOC, policy()) };
    yield* toolCall('paper_search', 'call_s');
    yield* toolCall('doc_edit', 'call_b');
    yield { event: 'tool_action', data: proposedAction(DOC, policy()) };
    yield done();
  }
  server.use(assistantSocket({ stream: editSearchEdit }));
  const before = fixtures.changeSets.get(DOC)?.length ?? 0;
  const events: AgentSessionEvent[] = [];
  const client = await connect(events);
  const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
  await client.request('sessions.subscribe', { workspace_id: WS, session_id: session.id });
  await client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'run', request: { ...request, apply_mode: 'auto' } });
  await vi.waitFor(() => expect(events.at(-1)?.data.status).toBe('completed'));

  const policies = events
    .filter((event) => event.event === 'status')
    .map((event) => [event.data.status, event.data.apply_policy, event.data.auto_blocked_reason]);
  expect(policies).toEqual([
    ['starting', 'auto', null],
    ['executing_tool', 'auto', null],
    ['executing_tool', 'auto', null],
    ['executing_tool', 'auto', null],
  ]);
  const actions = events.filter((event) => event.event === 'tool_action').map((event) => [event.data.apply_policy, event.data.auto_blocked_reason]);
  expect(actions).toEqual([['auto', null], ['auto', null]]);
  const storedSets = (fixtures.changeSets.get(DOC) ?? []).slice(before);
  expect(storedSets.map((set) => [set.apply_policy, set.auto_blocked_reason])).toEqual([['auto', null], ['auto', null]]);
});

it('ends Auto when the workspace switches it off during the run, at its next tool call (M5 policy)', async () => {
  const personal = fixtures.workspaces.get(WS);
  if (!personal) throw new Error('No personal workspace');
  const switchedOff = async function* (_request: unknown, { policy }: AssistantTurnContext): AsyncGenerator<AssistantEvent> {
    personal.policy = { ...personal.policy, auto: false };
    yield* toolCall('doc_edit', 'call_a');
    yield { event: 'tool_action', data: proposedAction(DOC, policy()) };
    // A later untrusted read keeps the reason the run already has.
    yield* toolCall('web_read', 'call_w');
    yield { event: 'status', data: { status: 'finishing', detail: 'Finishing up…', apply_policy: null, auto_blocked_reason: null } };
    yield done();
  };
  server.use(assistantSocket({ stream: switchedOff }));
  const events: AgentSessionEvent[] = [];
  const client = await connect(events);
  const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
  await client.request('sessions.subscribe', { workspace_id: WS, session_id: session.id });
  await client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'run', request: { ...request, apply_mode: 'auto' } });
  await vi.waitFor(() => expect(events.at(-1)?.data.status).toBe('completed'));
  expect(events.find((event) => event.event === 'tool_action')?.data).toMatchObject({ apply_policy: 'review', auto_blocked_reason: 'policy' });
  expect(events.filter((event) => event.event === 'status').at(-1)?.data).toMatchObject({ status: 'finishing', apply_policy: 'review', auto_blocked_reason: 'policy' });
});

describe('a run’s profile and preset, as the API’s request model has them', () => {
  it('refuses an unknown preset, one of the other profile, and an inline run that resumes a chat or asks for Auto', async () => {
    server.use(assistantSocket({ stream: completeRun }));
    const client = await connect();
    const chat = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
    const inline = await client.request('sessions.create', { workspace_id: WS, document_id: DOC, profile: 'inline' });
    expect([chat.profile, inline.profile]).toEqual(['chat', 'inline']);
    let n = 0;
    const start = (session: { id: string }, run: Record<string, unknown>) => client.request('runs.start', {
      workspace_id: WS, session_id: session.id, request_id: `run-${(n += 1)}`, request: { document_id: DOC, ...run },
    });
    for (const refused of [
      { message: '', profile: 'inline', preset: 'no-such-preset' },
      { message: '', profile: 'inline', preset: 'review-page' },
      { message: 'x', profile: 'inline', apply_mode: 'auto' },
      { message: 'x', profile: 'inline', leaf_id: 3 },
      { message: '', profile: 'inline' },
    ]) {
      await expect(start(inline, refused), JSON.stringify(refused)).rejects.toMatchObject({ code: 'invalid_request' });
    }
    // A run's profile is its session's.
    await expect(start(chat, { message: '', profile: 'inline', preset: 'shorter' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(start(inline, { message: 'x' })).rejects.toMatchObject({ code: 'invalid_request' });
    // A preset needs no words, in either profile.
    expect((await start(inline, { message: '', profile: 'inline', preset: 'shorter' })).status).toBe('queued');
    const other = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
    expect((await start(other, { message: '', preset: 'review-page' })).status).toBe('queued');
  });

  it('keeps an inline session one-shot: it resumes no chat and is listed nowhere', async () => {
    server.use(assistantSocket({ stream: completeRun }));
    const client = await connect();
    const chatId = chatsOf(DOC)[0]?.id;
    if (!chatId) throw new Error('No chat on the fixture page');
    await expect(client.request('sessions.create', { workspace_id: WS, document_id: DOC, profile: 'inline', chat_id: chatId }))
      .rejects.toMatchObject({ code: 'invalid_request' });
    await client.request('sessions.create', { workspace_id: WS, document_id: DOC, profile: 'inline' });
    const listed = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
    expect((await client.request('sessions.list', { workspace_id: WS, document_id: DOC })).map((session) => session.id)).toEqual([listed.id]);
  });
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

describe('the preview’s scripted turns', () => {
  /** Run one request on the scripted turn and collect what it sent. */
  async function runScripted(
    runRequest: Record<string, unknown>,
    profile: 'chat' | 'inline' = 'chat',
    where: { workspace: string; document: string } = { workspace: WS, document: DOC },
  ) {
    server.use(assistantSocket());
    const events: AgentSessionEvent[] = [];
    const client = await connect(events);
    // A run in a stored chat runs in a session opened on it.
    const chat = typeof runRequest.chat_id === 'string' ? { chat_id: runRequest.chat_id } : {};
    const session = await client.request('sessions.create', { workspace_id: where.workspace, document_id: where.document, profile, ...chat });
    await client.request('sessions.subscribe', { workspace_id: where.workspace, session_id: session.id });
    const run = await client.request('runs.start', {
      workspace_id: where.workspace, session_id: session.id, request_id: 'run', request: { document_id: where.document, profile, ...runRequest },
    });
    await vi.waitFor(() => expect(events.at(-1)?.data.status).toMatch(/completed|failed/), { timeout: 15_000 });
    return Object.assign(events, { run });
  }
  const answer = (events: AgentSessionEvent[]) =>
    events.filter((event) => event.event === 'token').map((event) => String(event.data.content)).join('');

  it('preloads the actual figure reference and document-type skill, recording instruction identities only', async () => {
    const page = fixtures.documents.get(DOC)!;
    const heading = page.blocks.find((block) => block.type === 'heading')!;
    const paragraph = page.blocks.find((block) => block.type === 'paragraph')!;
    if (heading.type !== 'heading') throw new Error('Missing heading');
    page.instructions = 'Private British spelling instruction.';
    page.documentType = 'technical-report';
    heading.instructions = 'Private section length instruction.';
    const events = await runScripted({ message: '', preset: 'figure-print',
      context: { block_id: paragraph.id, block_ids: [paragraph.id] } }, 'inline');
    const skills = events.filter((event) => event.event === 'skill');
    expect(skills.map((event) => event.data)).toEqual([
      expect.objectContaining({ id: 'editor', resource: 'references/figures.md', by: 'preset' }),
      expect.objectContaining({ id: 'technical-report', resource: null, by: 'document_type' }),
    ]);
    expect(events.findIndex((event) => event.event === 'skill')).toBeLessThan(events.findIndex((event) => event.event === 'token'));
    const instructions = events.find((event) => event.event === 'instructions');
    expect(instructions?.data).toMatchObject({ items: [{ scope: 'page' }, { scope: 'section', block_id: heading.id }] });
    expect(JSON.stringify(instructions)).not.toContain('Private');
    const spec = JSON.parse(answer(events).replace(/^```figure\s*|\s*```$/g, ''));
    expect(spec.palette).toBe('mono');
  });

  it('accepts a message that is only an attachment, as the API does (U-06)', async () => {
    const pdf = fixtures.pdfs.find((item) => item.workspace_id === WS);
    if (!pdf) throw new Error('No PDF in the personal workspace');
    const events = await runScripted({ message: '', attachments: [{ kind: 'resource', resource_id: pdf.id }] });
    expect(events.at(-1)?.data.status).toBe('completed');
  }, 20_000);

  it('still refuses a run with neither a message nor an attachment', async () => {
    server.use(assistantSocket({ stream: completeRun }));
    const client = await connect();
    const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
    await expect(client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'run', request: { document_id: DOC, message: ' ' } }))
      .rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('sends tool calls as the API projects them, and a failed call as its registry code', async () => {
    const events = await runScripted({ message: 'Why did the paper lookup fail?' });
    const ends = events.filter((event) => event.event === 'tool_call_end').map((event) => event.data);
    expect(ends.map((end) => [end.tool, end.is_error, end.error_type])).toEqual([
      ['paper_search', false, null],
      ['paper_get', true, 'timeout'],
    ]);
    // A result's preview is its projection; a failure's names only its code.
    expect(JSON.parse(String(ends[0]?.output_preview))).toMatchObject({ content_redacted: true, papers_count: 2 });
    expect(JSON.parse(String(ends[1]?.output_preview))).toEqual({ content_redacted: true, status: 'error', code: 'timeout' });
    expect(ends[1]?.error).toBe('External research tool failed; content-bearing details redacted.');
    // Text arguments travel only as their length, under the tools' parameter names.
    const args = events.filter((event) => event.event === 'tool_call_args').map((event) => event.data.arguments);
    expect(args).toEqual([
      { content_redacted: true, query_redacted: true, query_length: 38, limit: 10, year_from: 2020 },
      { content_redacted: true, paper_redacted: true, paper_length: 2 },
    ]);
    expect(JSON.stringify(events)).not.toContain('sparse mixture of experts');
  }, 20_000);

  /** The sources and passages a run's `evidence` events sent, in order. */
  const evidenceOf = (events: AgentSessionEvent[]) => {
    const sent = events.filter((event) => event.event === 'evidence').map((event) => event.data as EvidenceData);
    return { events: sent, sources: sent.flatMap((data) => data.sources), passages: sent.flatMap((data) => data.passages) };
  };

  it('sends the source an empty-line draft cites (U-07), from the run’s own store', async () => {
    const events = await runScripted({ message: '', preset: 'continue', context: { block_id: 'p-1' } }, 'inline');
    expect(answer(events)).toContain('[S1]');
    // The work as a paper source found it: its reference record, unchecked, the one the paper routes return.
    expect(evidenceOf(events).sources).toEqual([{
      handle: 'S1', key: FEDUS.key, kind: 'paper', title: FEDUS.csl.title, state: 'unchecked', flags: [],
      provider: 'openalex', record: asFound(FEDUS),
    }]);
  }, 20_000);

  it('keeps each handle for the conversation: a later turn names the works it finds again by their handles, and new ones by the next', async () => {
    fixtures.assistant = { switches: { web: true }, sources: {} };
    // The seeded chat found S1 and S2 (two papers) and S3 (a page).
    const request = { message: 'Search the public web for expert routing', chat_id: 'chat-related' };
    const papers = await runScripted({ ...request, web: false });
    expect(papers.some((event) => event.event === 'tool_call_start' && event.data.tool === 'web_search')).toBe(false);
    // Found again in this run: sent again, under the same handles, with no passages (a paper search stores none yet).
    expect(evidenceOf(papers).sources.map((source) => [source.handle, source.key])).toEqual([['S1', 'arxiv:2101.03961'], ['S2', 'arxiv:2202.08906']]);
    expect(evidenceOf(papers).passages).toEqual([]);
    expect(answer(papers)).toContain('grows [S1]. Router z-loss stabilises training at scale [S2].');

    // The same request with Web on finds pages in the public web search.
    const pages = await runScripted({ ...request, web: true });
    expect(pages.some((event) => event.event === 'tool_call_start' && event.data.tool === 'web_search')).toBe(true);
    const sent = evidenceOf(pages);
    // The page an earlier turn found keeps S3; the new one is S4. Each search result stores its snippet.
    expect(sent.sources.map((source) => [source.handle, source.kind, source.provider])).toEqual([['S3', 'web', 'web'], ['S4', 'web', 'web']]);
    expect(sent.passages).toEqual([{ id: 'S3.2', level: 'snippet' }, { id: 'S4.1', level: 'snippet' }]);
    expect(answer(pages)).toContain('grows [S3]. Router z-loss stabilises training at scale [S4].');
    expect(chatsOf(DOC).find((chat) => chat.id === 'chat-related')?.evidence.sources.map((source) => source.handle)).toEqual(['S1', 'S2', 'S3', 'S4']);
  }, 30_000);

  it('cites what an earlier turn found without touching it again: no call, and no evidence', async () => {
    const events = await runScripted({ message: 'What did you find earlier?', chat_id: 'chat-related' });
    expect(events.some((event) => event.event === 'evidence' || event.event === 'tool_call_start')).toBe(false);
    expect(answer(events)).toContain('top-1 routing keeps per-token compute constant [S1].');
  }, 20_000);

  it('gives the attached PDFs their handles before the first model call, then reads one with library_read', async () => {
    const pdf = fixtures.pdfs.find((item) => item.workspace_id === WS);
    if (!pdf) throw new Error('No PDF in the personal workspace');
    const events = await runScripted({ message: 'What does my PDF say about routing?', attachments: [{ kind: 'resource', resource_id: pdf.id }] });
    const order = events.map((event) => event.event);
    // The PDF's handle comes before any reasoning or call.
    expect(order.indexOf('evidence')).toBeGreaterThan(-1);
    expect(order.indexOf('evidence')).toBeLessThan(order.indexOf('reasoning'));
    expect(order.indexOf('evidence')).toBeLessThan(order.indexOf('tool_call_start'));
    const sent = evidenceOf(events);
    expect(sent.events[0]).toEqual({
      sources: [{
        handle: 'S1', key: `resource:${pdf.id}`, kind: 'pdf', title: pdf.title || pdf.filename, state: 'unchecked', flags: [], provider: 'resource',
        record: {
          key: `resource:${pdf.id}`, kind: 'pdf', provider: 'resource', state: 'unchecked', flags: [],
          csl: { id: `resource:${pdf.id}`, type: 'document', title: pdf.title || pdf.filename },
        },
      }],
      passages: [],
    });
    // The read stores its window as passages; the PDF, sent already in this run and unchanged, is not sent again.
    const reads = events.filter((event) => event.event === 'tool_call_args' && event.data.tool === 'library_read');
    expect(reads.map((event) => event.data.arguments)).toEqual([{ content_redacted: true, resource_id: pdf.id, offset: 0, max_chars: 20_000 }]);
    expect(sent.events[1]).toEqual({ sources: [], passages: Array.from({ length: 10 }, (_, index) => ({ id: `S1.${index + 1}`, level: 'full_text' })) });
    // What the paper search found comes after it, under the next handles.
    expect(sent.events[2]?.sources.map((source) => source.handle)).toEqual(['S2', 'S3']);
    expect(answer(events)).toContain('[S2]');
  }, 20_000);

  it('has a research worker search the page’s PDFs by their words when the run has no outside source', async () => {
    fixtures.assistant = { switches: { papers: false, workers: true }, sources: { semantic_scholar: false } };
    const events = await runScripted({ message: 'Hello' });
    const worker = events.filter((event) => event.event === 'tool_call_args' && String(event.data.tool_call_id).includes(':'));
    expect(worker.map((event) => [event.data.tool, (event.data.arguments as { mode?: string }).mode])).toEqual([['library_search', 'exact']]);
    // An exact search reaches no embedding provider.
    const done = events.find((event) => event.event === 'done')?.data as DoneData;
    expect(Object.keys(done.budget?.counters ?? {})).not.toContain('embeddings_calls');
  }, 20_000);

  it('cites what it found with one cite_sources call: the works checked, sent again, and stored for review', async () => {
    const events = await runScripted({ message: 'Find the routing papers and cite them' });
    expect(events.filter((event) => event.event === 'tool_call_start').map((event) => event.data.tool)).toEqual(['paper_search', 'cite_sources']);
    const sent = evidenceOf(events);
    // Found unchecked, then sent again as the pipeline checked them.
    expect(sent.events.map((data) => data.sources.map((source) => [source.handle, source.state]))).toEqual([
      [['S1', 'unchecked'], ['S2', 'unchecked']],
      [['S1', 'needs_review'], ['S2', 'verified']],
    ]);
    const action = events.find((event) => event.event === 'tool_action')?.data as { tool: string; change_set_id: string; proposal: { operation_names: string[] } };
    expect(action).toMatchObject({ tool: 'cite_sources', proposal: { operation_names: ['write_blocks', 'add_sources'] } });
    const stored = fixtures.changeSets.get(DOC)?.find((set) => set.change_set_id === action.change_set_id);
    const [write, add] = stored?.operations ?? [];
    const block = (write as { blocks?: Array<{ html: string; children: Array<Record<string, unknown>> }> }).blocks?.[0];
    expect(block?.html).toMatch(/in compute<span data-child-id="cite-[^"]+" contenteditable="false"><\/span>\./);
    expect(block?.children.at(-1)).toMatchObject({
      type: 'citation', keys: ['arxiv:2101.03961', 'arxiv:2202.08906'], style: 'nlm-citation-sequence-brackets',
      sources: [{ key: 'arxiv:2101.03961', state: 'needs_review', differs: ['issued'] }, { key: 'arxiv:2202.08906', state: 'verified' }],
    });
    // Only the work new to the page joins its library.
    expect(add).toMatchObject({ op: 'add_sources', sources: [{ key: 'arxiv:2202.08906', state: 'verified' }] });
  }, 20_000);

  it('checks a claim with one claim_check call: its verdict before its end, the passages it read after', async () => {
    const events = await runScripted({ message: 'Check the claim that routing keeps compute constant' });
    const order = events
      .filter((event) => ['claim', 'evidence'].includes(event.event) || (String(event.data.tool ?? '') === 'claim_check' && event.event === 'tool_call_end'))
      .map((event) => event.event);
    expect(order).toEqual(['evidence', 'claim', 'tool_call_end', 'evidence']);
    expect(events.find((event) => event.event === 'claim')?.data).toEqual({
      tool_call_id: 'call_claim', verdict: 'partly', evidence_level: 'full_text', cannot_assess: false,
      passages: [{ id: 'S1.1', level: 'full_text', stance: 'supports' }, { id: 'S2.1', level: 'abstract', stance: 'limits' }],
    });
    expect(evidenceOf(events).events.at(-1)?.passages).toEqual([{ id: 'S1.1', level: 'full_text' }, { id: 'S2.1', level: 'abstract' }]);
    // The reply's record keeps it, for the card after a reload.
    const chatId = events.find((event) => event.event === 'session.chat')?.data.chat_id;
    const chat = chatsOf(DOC).find((item) => item.id === chatId)!;
    const reply = messageChain(chat, newestMessage(chat)!.id).at(-1);
    expect(reply?.record).toMatchObject({ kind: 'reply', claims: [{ tool_call_id: 'call_claim', verdict: 'partly' }], plan: null, question: null });
  }, 20_000);

  it('names each tool with its catalog display, and a tool the catalog lacks with its own', async () => {
    const events = await runScripted({ message: 'Read the outline, then check the literature' });
    const starts = events.filter((event) => event.event === 'tool_call_start').map((event) => event.data as { tool: string; display: unknown });
    expect(starts.map((start) => start.tool)).toEqual(['page_outline', 'paper_search']);
    expect(starts[0]?.display).toEqual({
      label: 'Read the page outline', running_label: 'Reading the page outline', icon: 'file-search', detail_templates: ['{sections_count} sections'],
      value_labels: {},
    });
    expect(starts[1]?.display).toEqual({
      label: 'Searched for papers', running_label: 'Searching for papers', icon: 'book-open',
      detail_templates: ['Published {year_from}–{year_to}', 'Published from {year_from}', 'Published up to {year_to}'],
      value_labels: {},
    });
  }, 20_000);

  it('ends with the models that served the turn, its usage and its cost', async () => {
    const events = await runScripted({ message: 'What does the literature say?' });
    expect(events.find((event) => event.event === 'done')?.data).toMatchObject({
      usage: { prompt_tokens: 5120, completion_tokens: 210, cached_tokens: 4096 },
      models: [
        { model: 'anthropic/claude-sonnet-5.5', tier: 'main', fallback: true },
        { model: 'openai/gpt-6-luna', tier: 'lite', fallback: false },
      ],
      cost: 0.0168,
    });
  }, 20_000);

  it('names only the run’s tools: no paper search where the workspace turned outside research off, no edit for a viewer', async () => {
    const lab = await runScripted({ message: 'Improve this from the literature', document_id: LAB_DOCUMENT_ID }, 'chat', { workspace: LAB_WORKSPACE_ID, document: LAB_DOCUMENT_ID });
    // It reads the section it edits first (`doc_read` with its view).
    expect(lab.filter((event) => event.event === 'tool_call_start').map((event) => event.data.tool)).toEqual(['doc_read', 'doc_edit']);
    const viewer = await runScripted({ message: 'Improve this', document_id: VIEWER_DOCUMENT_ID }, 'chat', { workspace: VIEWER_WORKSPACE_ID, document: VIEWER_DOCUMENT_ID });
    expect(viewer.filter((event) => event.event === 'tool_call_start').map((event) => event.data.tool)).toEqual(['paper_search']);
  }, 30_000);

  it('stores the answer with the record of what its turn did, as `…/messages` returns it', async () => {
    fixtures.assistant = { ...fixtures.assistant, switches: { workers: true } };
    const events = await runScripted({ message: 'Improve this from the literature', preset: undefined });
    const doneData = events.find((event) => event.event === 'done')?.data as { chat_id: string; message_id: number };
    const chat = chatsOf(DOC).find((item) => item.id === doneData.chat_id)!;
    const [question, reply] = messageChain(chat, doneData.message_id);
    expect(question?.record).toEqual({ kind: 'request', preset: null, effort: 'standard', web: false, plan_id: null });
    expect(question?.run_id).toBe(events.run.id);
    expect(reply).toMatchObject({ id: doneData.message_id, role: 'assistant', run_id: events.run.id });
    expect(reply?.content).toContain('Top-1 routing');
    const record = reply?.record;
    if (record?.kind !== 'reply') throw new Error('The reply has no record');
    expect(record.status).toBe('completed');
    expect(record.tool_calls.map((call) => [call.tool, call.worker_id, call.finished])).toEqual([
      ['paper_search', `preview-worker-${events.run.id}`, true],
      ['paper_search', null, true],
      ['doc_read', null, true],
      ['doc_edit', null, true],
    ]);
    // `doc_read`'s projection names only its view.
    expect(record.tool_calls[2]?.arguments).toEqual({ view: 'section' });
    expect(record.tool_calls[1]?.arguments).toEqual({ content_redacted: true, query_redacted: true, query_length: 38, limit: 10, year_from: 2020 });
    // A new chat's store: its first works are S1 and S2.
    expect(record.sources.map((source) => source.handle)).toEqual(['S1', 'S2']);
    expect(record.passages).toEqual([]);
    expect(record.tasks.map((task) => task.status)).toEqual(['completed', 'completed']);
    expect(record.workers).toEqual([{
      id: `preview-worker-${events.run.id}`, status: 'completed', engine: 'gateway', profile: 'web_researcher',
      title: 'Routing evidence', objective: 'Find evidence about router stability in the available sources.',
    }]);
    expect(record.change_sets).toHaveLength(1);
    expect(record.models.map((model) => model.model)).toEqual(['anthropic/claude-sonnet-5.5', 'openai/gpt-6-luna']);
    expect(record).toMatchObject({ usage: { prompt_tokens: 5120 }, cost: 0.0168, cost_limit: 5, limit_reached: null, error: null });
  }, 20_000);

  it('stores a word-less chat preset with its label, and a stopped turn that did something even with no text', async () => {
    server.use(assistantSocket());
    const events: AgentSessionEvent[] = [];
    const client = await connect(events);
    const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
    await client.request('sessions.subscribe', { workspace_id: WS, session_id: session.id });
    const run = await client.request('runs.start', {
      workspace_id: WS, session_id: session.id, request_id: 'run', request: { document_id: DOC, message: '', preset: 'review-page' },
    });
    await vi.waitFor(() => expect(events.some((event) => event.event === 'tool_call_end')).toBe(true), { timeout: 10_000 });
    await client.request('runs.cancel', { workspace_id: WS, session_id: session.id, run_id: run.id });
    const chat = chatsOf(DOC).find((item) => item.id === events.find((event) => event.event === 'session.chat')?.data.chat_id)!;
    const [question, reply] = messageChain(chat, newestMessage(chat)!.id);
    expect(question).toMatchObject({ content: 'Review this page', record: { kind: 'request', preset: 'review-page' } });
    // The cost ceiling is the run's ledger's, whether or not it reached `done`.
    expect(reply).toMatchObject({
      role: 'assistant', content: '', record: { kind: 'reply', status: 'stopped', cost_limit: 5, limit_reached: null, error: null },
    });
  }, 20_000);

  it('ends with the run’s ledger: its counters and its tier’s limits, the cost against its ceiling, its labels and its writes', async () => {
    fixtures.assistant = { switches: { workers: true }, sources: {} };
    const events = await runScripted({ message: 'Improve this from the literature' });
    const done = events.find((event) => event.event === 'done')?.data;
    // A chat message that names no tier runs as `standard` (the catalog's `efforts`).
    expect(done).toMatchObject({
      budget: {
        effort: 'standard',
        counters: {
          model_calls: { used: 3, limit: 40 },
          tool_calls: { used: 3, limit: 60 },
          workers: { used: 1, limit: 3 },
          scholarly_calls: { used: 1, limit: 30 },
          web_calls: { used: 0, limit: 12 },
        },
        cost: 0.0168,
        cost_limit: 5,
        limit_reached: null,
      },
      // A paper's record is outside material; the edit read the page.
      labels: ['private', 'untrusted'],
      persistence: { failed_writes: 0, kinds: [] },
    });
  }, 20_000);

  it('says when a run answered at its limit, and when a write of its record failed', async () => {
    const events = await runScripted({ message: 'Keep going until your limit; some of it may be unsaved' });
    expect(events.find((event) => event.event === 'done')?.data).toMatchObject({
      budget: { counters: { model_calls: { used: 40, limit: 40 } }, limit_reached: 'model_calls' },
      persistence: { failed_writes: 1, kinds: ['llm_call'] },
    });
    // The limit it reached was said once, before its end (`budget`).
    const budgets = events.filter((event) => event.event === 'budget');
    expect(budgets).toHaveLength(1);
    expect(budgets[0]?.data).toMatchObject({ effort: 'standard', limit_reached: 'model_calls', counters: { model_calls: { used: 40, limit: 40 } } });
    expect(events.findIndex((event) => event.event === 'budget')).toBeLessThan(events.findIndex((event) => event.event === 'done'));
    // The stored reply keeps the limit and the ceiling; the failed writes are in `done` only.
    const chat = chatsOf(DOC).find((item) => item.id === events.find((event) => event.event === 'session.chat')?.data.chat_id)!;
    const reply = messageChain(chat, newestMessage(chat)!.id).at(-1);
    expect(reply?.record).toMatchObject({ kind: 'reply', status: 'completed', cost_limit: 5, limit_reached: 'model_calls' });
    expect(reply?.record).not.toHaveProperty('persistence');
  }, 20_000);

  it('grants Auto at the start whatever the run’s tools, but not to a viewer', async () => {
    fixtures.assistant = { switches: { web: true }, sources: {} };
    const events = await runScripted({ message: 'Hello', apply_mode: 'auto' });
    expect(events.find((event) => event.event === 'status')?.data).toMatchObject({ status: 'starting', apply_policy: 'auto', auto_blocked_reason: null });
    const viewer = await runScripted(
      { message: 'Hello', apply_mode: 'auto', document_id: VIEWER_DOCUMENT_ID }, 'chat', { workspace: VIEWER_WORKSPACE_ID, document: VIEWER_DOCUMENT_ID },
    );
    expect(viewer.find((event) => event.event === 'status')?.data).toMatchObject({ apply_policy: 'review', auto_blocked_reason: 'role' });
  }, 30_000);

  it('names the session sequence a run starts after, to reattach from', async () => {
    server.use(assistantSocket({ stream: completeRun }));
    const client = await connect();
    const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC });
    const first = await client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'one', request });
    expect(first.after_seq).toBe(0);
    await vi.waitFor(async () => expect((await client.request('sessions.get', { workspace_id: WS, session_id: session.id })).run?.status).toBe('completed'));
    const { session: after } = await client.request('sessions.get', { workspace_id: WS, session_id: session.id });
    const second = await client.request('runs.start', { workspace_id: WS, session_id: session.id, request_id: 'two', request });
    expect(second.after_seq).toBe(after.last_seq);
  });

  it('keeps a denied Web choice in the question and explains it while continuing without Web', async () => {
    const events = await runScripted({ message: 'What does the literature say?', web: true });
    expect(events.find((event) => event.event === 'status')?.data).toMatchObject({
      status: 'starting', detail: 'Web is switched off in your settings. Continuing without Web…',
    });
    expect(events.some((event) => event.event === 'tool_call_start' && event.data.tool === 'web_search')).toBe(false);
    const data = events.find((event) => event.event === 'done')?.data as DoneData;
    const chat = chatsOf(DOC).find((item) => item.id === data.chat_id)!;
    expect(messageChain(chat, data.message_id!).find((item) => item.role === 'user')?.record).toMatchObject({ web: true });
  }, 20_000);

  it('rewrites the block the request names in `context`, read from the page (P0.UI-1)', async () => {
    const events = await runScripted({ message: '', preset: 'improve', context: { block_id: 'li-1', block_ids: ['li-1'] } }, 'inline');
    expect(answer(events)).toContain('A load-balanced router that keeps expert utilisation within 5% of uniform.');
  }, 20_000);
});

describe('other sockets', () => {
  it('match only the assistant socket on this host, so Vite HMR and external sockets pass through', () => {
    const handler = assistantSocket();
    expect(handler.test(agentWebSocketUrl())).toBe(true);
    expect(handler.test(`ws://${window.location.host}/?token=hmr`)).toBe(false);
    expect(handler.test('wss://example.org/api/agent/ws')).toBe(false);
  });
});
