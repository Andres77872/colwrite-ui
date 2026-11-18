import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSocket, type AgentRunRequest, type AgentSessionEvent } from '@/api/assistant/agentSocket';
import type { AssistantSession, ChatPlan, PlanData, QuestionData } from '@/api/schema';
import { getChatPlan, updateChatPlan } from '@/data/chatPlans';
import { listMessages } from '@/data/chats';
import { historyMessages } from '@/components/editor/ChatAssistant/chatUtils';
import { FIXTURE_DOCUMENT_ID, PERSONAL_WORKSPACE_ID, chatsOf, fixtures } from './fixtures';
import { planEvent, proposePlan, savePlan } from './plans';

const WS = PERSONAL_WORKSPACE_ID;
const DOC = FIXTURE_DOCUMENT_ID;
const clients: AgentSocket[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });

async function conversation(chatId?: string) {
  const events: AgentSessionEvent[] = [];
  const client = new AgentSocket((event) => events.push(event));
  clients.push(client);
  await client.connect();
  const session = await client.request('sessions.create', { workspace_id: WS, document_id: DOC, ...(chatId ? { chat_id: chatId } : {}) });
  await client.request('sessions.subscribe', { workspace_id: WS, session_id: session.id });
  let count = 0;
  const start = (request: Omit<AgentRunRequest, 'document_id'>) => client.request('runs.start', {
    workspace_id: WS, session_id: session.id, request_id: `turn-${++count}`,
    request: { document_id: DOC, ...(chatId ? { chat_id: chatId } : {}), ...request },
  });
  return { client, session, events, start };
}

type Conversation = Awaited<ReturnType<typeof conversation>>;
async function settled(context: Conversation, runId: string, status = 'completed') {
  await vi.waitFor(() => expect(context.events.some((event) =>
    event.run_id === runId && event.event === 'run.status' && event.data.status === status)).toBe(true), { timeout: 10_000 });
  return context.events.filter((event) => event.run_id === runId);
}
const location = (plan: ChatPlan, chatId = 'chat-method') =>
  ({ workspaceId: WS, documentId: DOC, chatId, planId: plan.plan_id });
const planEvents = (events: AgentSessionEvent[]) => events.filter((event) => event.event === 'plan').map((event) => event.data as PlanData);
function currentChat(session: AssistantSession, events: AgentSessionEvent[]): string {
  const chatId = events.find((event) => event.event === 'done')?.data.chat_id ?? session.chat_id;
  if (typeof chatId !== 'string') throw new Error('No chat recorded');
  return chatId;
}

describe('the mock’s revision-bound Deep plan', () => {
  it('proposes a plan and ends without writing the page, with Deep requested and Standard planning limits', async () => {
    const context = await conversation();
    const run = await context.start({ message: 'Plan a related-work section', effort: 'deep' });
    const events = await settled(context, run.id);
    const [plan] = planEvents(events);
    expect(plan).toMatchObject({ revision: 1, state: 'proposed', effort: 'deep' });
    expect(plan?.sections.map((section) => section.state)).toEqual(['pending', 'pending', 'pending']);
    expect(events.filter((event) => event.event === 'tool_call_start').map((event) => event.data.tool)).toEqual(['plan_propose']);
    expect(fixtures.changeSets.get(DOC) ?? []).toEqual([]);
    expect(events.find((event) => event.event === 'done')?.data.budget).toMatchObject({
      effort: 'deep', counters: { model_calls: { limit: 40 } }, cost_limit: 5,
    });
    const chatId = currentChat(context.session, events);
    const branch = await listMessages(WS, DOC, chatId, null);
    expect(branch.items[0]?.record).toMatchObject({ kind: 'request', effort: 'deep', web: false });
    expect(branch.items.at(-1)?.record).toMatchObject({ kind: 'reply', plan });
    expect((await getChatPlan({ workspaceId: WS, documentId: DOC, chatId, planId: plan!.plan_id })).etag).toBe('"cwplan:1"');
  });

  it('rereads pending edits and proposes exactly one reviewable change set for each section in its new order', async () => {
    const plan = proposePlan(WS, DOC, 'chat-method');
    const before = structuredClone(fixtures.documents.get(DOC)?.blocks);
    const context = await conversation('chat-method');
    const run = await context.start({
      message: '', effort: 'deep', plan_id: plan.plan_id,
      plan: { revision: 1, brief: 'A narrow review.', open_questions: null, sections: [
        { id: 'mechanism', title: 'Routing mechanisms', goal: plan.sections[0]!.goal, sources: [] },
        { id: 'questions', title: 'Open questions', goal: 'Keep uncertainties explicit.', sources: [] },
        { id: null, title: 'Author-added scope', goal: 'Use the supplied terminology.', sources: [] },
      ] },
    });
    await vi.waitFor(() => expect(planEvents(context.events).at(-1)?.state).toBe('running'));
    const version = await getChatPlan(location(plan));
    expect(version.plan.sections.map((section) => section.state)).toEqual(['working', 'pending', 'pending']);
    const [first, second, third] = version.plan.sections;
    await updateChatPlan(location(plan), version.etag, { sections: [
      first!, { ...third!, title: '<img src=x onerror=alert(1)>', goal: 'Revised while the first section is working.' }, second!,
    ] });
    const events = await settled(context, run.id);
    const written = await getChatPlan(location(plan));
    expect(written.plan.state).toBe('done');
    expect(written.plan.sections.map((section) => [section.id, section.state, section.change_set_ids.length])).toEqual([
      ['mechanism', 'proposed', 1], ['author-added-scope', 'proposed', 1], ['questions', 'proposed', 1],
    ]);
    const sets = (fixtures.changeSets.get(DOC) ?? []).filter((set) => set.run_uuid === run.id);
    expect(sets).toHaveLength(3);
    expect(sets.map((set) => set.change_set_id)).toEqual(written.plan.sections.flatMap((section) => section.change_set_ids));
    expect(sets.every((set) => set.status === 'pending' && set.decisions.length === 0 && set.operations.length === 1 && set.apply_policy === 'review')).toBe(true);
    expect(JSON.stringify(sets[1]?.operations)).toContain('&lt;img');
    expect(JSON.stringify(sets[1]?.operations)).toContain('Revised while the first section is working.');
    expect(fixtures.documents.get(DOC)?.blocks).toEqual(before);
    expect(events.filter((event) => event.event === 'tool_action')).toHaveLength(3);
    expect(planEvents(events).at(-1)).toEqual(planEvent(written.plan));
    const branch = await listMessages(WS, DOC, 'chat-method', null);
    expect(branch.items.at(-2)?.content).toBe('Write the approved plan, section by section.');
    expect(branch.items.at(-1)?.record).toMatchObject({
      kind: 'reply', plan: planEvent(written.plan), change_sets: sets.map((set) => ({ change_set_id: set.change_set_id })),
    });
  }, 15_000);

  it('keeps a stopped plan’s proposed section and continues only what remains', async () => {
    const plan = proposePlan(WS, DOC, 'chat-method');
    const context = await conversation('chat-method');
    const run = await context.start({ message: '', effort: 'deep', plan_id: plan.plan_id });
    await vi.waitFor(() => expect(planEvents(context.events).some((event) => event.sections[0]?.state === 'proposed')).toBe(true), { timeout: 5_000 });
    await context.client.request('runs.cancel', { workspace_id: WS, session_id: context.session.id, run_id: run.id });
    const stoppedEvents = await settled(context, run.id, 'cancelled');
    const stopped = await getChatPlan(location(plan));
    expect(stopped.plan.state).toBe('stopped');
    expect(stopped.plan.sections.map((section) => section.state)).toEqual(['proposed', 'needs_attention', 'pending']);
    const held = stopped.plan.sections[0]!.change_set_ids[0];
    expect(planEvents(stoppedEvents).at(-1)).toEqual(planEvent(stopped.plan));
    expect((await listMessages(WS, DOC, 'chat-method', null)).items.at(-1)?.record).toMatchObject({ status: 'stopped', plan: planEvent(stopped.plan) });
    const again = await context.start({ message: '', effort: 'deep', plan_id: plan.plan_id, plan: { revision: stopped.plan.revision, brief: null, sections: null, open_questions: null } });
    await settled(context, again.id);
    const completed = await getChatPlan(location(plan));
    expect(completed.plan.state).toBe('done');
    expect(completed.plan.sections[0]?.change_set_ids).toEqual([held]);
    expect(fixtures.changeSets.get(DOC)).toHaveLength(3);
  }, 15_000);

  it('refuses a stale approval without recording another question or writing a section', async () => {
    const plan = proposePlan(WS, DOC, 'chat-method');
    savePlan({ ...plan, brief: 'A newer brief.' });
    const count = chatsOf(DOC).find((chat) => chat.id === 'chat-method')!.messages.length;
    const context = await conversation('chat-method');
    const run = await context.start({ message: '', effort: 'deep', plan_id: plan.plan_id, plan: { revision: 1, brief: null, sections: null, open_questions: null } });
    const events = await settled(context, run.id, 'failed');
    expect(events.find((event) => event.event === 'error')?.data.error_code).toBe('STALE_PLAN');
    expect(chatsOf(DOC).find((chat) => chat.id === 'chat-method')?.messages).toHaveLength(count);
    expect(fixtures.changeSets.get(DOC) ?? []).toHaveLength(0);
  });
});

describe('the mock’s questions, answers and explicit skip', () => {
  it('keeps an attached PDF’s evidence even when asking a question, and Auto stays on', async () => {
    const pdf = fixtures.pdfs.find((item) => item.workspace_id === WS)!;
    const context = await conversation();
    const run = await context.start({ message: 'Ask me about the scope', apply_mode: 'auto', attachments: [{ kind: 'resource', resource_id: pdf.id }] });
    const events = await settled(context, run.id);
    expect(events.find((event) => event.event === 'status')?.data).toMatchObject({ apply_policy: 'auto', auto_blocked_reason: null });
    expect(events.findIndex((event) => event.event === 'evidence')).toBeLessThan(events.findIndex((event) => event.event === 'tool_call_start'));
    const evidence = events.find((event) => event.event === 'evidence')?.data.sources;
    expect(evidence).toMatchObject([{ handle: 'S1', key: `resource:${pdf.id}` }]);
    const question = events.find((event) => event.event === 'question')?.data as QuestionData;
    expect(question.questions).toHaveLength(2);
    const branch = await listMessages(WS, DOC, currentChat(context.session, events), null);
    expect(branch.items.at(-1)?.record).toMatchObject({ kind: 'reply', question, sources: evidence });
    expect(historyMessages(branch.items).at(-1)?.question).toEqual(question);
    expect(fixtures.changeSets.get(DOC) ?? []).toHaveLength(0);
  });

  it.each([false, true])('accepts an answers-only turn (skip %s), persists readable words and leaves the old card historical', async (skip) => {
    const context = await conversation();
    const asked = await context.start({ message: 'Ask me what matters' });
    const questionEvents = await settled(context, asked.id);
    const question = questionEvents.find((event) => event.event === 'question')?.data as QuestionData;
    const answers = { question_id: question.question_id, items: skip ? [] : [{ id: 'audience', answer: 'Researchers' }] };
    const run = await context.start({ message: '', answers });
    const events = await settled(context, run.id);
    expect(events.some((event) => event.event === 'question')).toBe(false);
    const branch = await listMessages(WS, DOC, currentChat(context.session, events), null);
    expect(branch.items.at(-2)?.content).toBe(skip
      ? 'I skip your questions: go with your best judgement, and say what you assumed.'
      : 'My answers to your questions:\n- Who is the audience? Researchers');
    const transcript = historyMessages(branch.items);
    expect(transcript.at(-1)?.question).toBeUndefined();
    expect(transcript.find((message) => message.question)?.question).toEqual(question);
  });

  it('renders an unmatched answer id as such, rather than pretending it matched an old question', async () => {
    const context = await conversation('chat-method');
    const run = await context.start({ message: '', answers: { question_id: 'unknown', items: [{ id: 'gone', answer: 'A free answer' }] } });
    await settled(context, run.id);
    const branch = await listMessages(WS, DOC, 'chat-method', null);
    expect(branch.items.at(-2)?.content).toBe('My answers to your questions:\n- (gone) A free answer');
  });
});
