import { describe, expect, it } from 'vitest';
import type { ReplyRecord } from '@/api/schema';
import type { AgentClaim, AgentPlan } from '@/api/assistant/streamParser';
import { emptyMessage, historyMessages } from '../chatUtils';
import { conversationPlans, withClaim, withLedger, withPlan, withQuestion } from '../transcript';
import { budgetNote } from '../replyMeta';

/**
 * What a turn keeps of P3's events this round (the cards come next): the
 * newest revision of its plan, the question it asked, its ledger; and a
 * stored reply's claims, plan and question, and a question's effort and
 * plan, as its record keeps them.
 */

const plan = (revision: number, state: AgentPlan['state'] = 'proposed'): AgentPlan => ({
  plan_id: 'p1', kind: 'outline', brief: 'Survey routing', sections: [], open_questions: [], effort: 'deep', revision, state,
});
const claim = (verdict: AgentClaim['verdict']): AgentClaim => ({ toolCallId: 'c1', verdict, evidenceLevel: 'abstract', cannotAssess: false, passages: [] });

describe('a live turn', () => {
  it('keeps the newest revision of its plan, whatever order they arrive in', () => {
    let message = emptyMessage('assistant');
    message = withPlan(message, plan(2, 'running'));
    message = withPlan(message, plan(1));
    expect(message.plan).toMatchObject({ revision: 2, state: 'running' });
    expect(withPlan(message, plan(3, 'done')).plan?.state).toBe('done');
  });

  it('keeps each plan at its first card while its highest branch revision replaces historical snapshots', () => {
    const first = { ...emptyMessage('assistant'), plan: plan(1) };
    const next = { ...emptyMessage('assistant'), plan: plan(4, 'done') };
    const replay = { ...emptyMessage('assistant'), plan: plan(2, 'running') };
    const another = { ...emptyMessage('assistant'), plan: { ...plan(1), plan_id: 'p2' } };
    const current = conversationPlans([first, next, replay, another]);
    expect([...current.keys()]).toEqual([first.id, another.id]);
    expect(current.get(first.id)).toMatchObject({ plan_id: 'p1', revision: 4, state: 'done' });
  });

  it('keeps each claim check once, a later one for the same call in its place', () => {
    let message = withClaim(emptyMessage('assistant'), claim('insufficient'));
    message = withClaim(message, { ...claim('supported'), toolCallId: 'c2' });
    message = withClaim(message, claim('partly'));
    expect(message.claims?.map((item) => [item.toolCallId, item.verdict])).toEqual([['c1', 'partly'], ['c2', 'supported']]);
  });

  it('keeps the question asked and the latest ledger', () => {
    const asked = withQuestion(emptyMessage('assistant'), { question_id: 'q', questions: [{ id: 'a', text: 'Venue?', options: [], allow_free_text: true }] });
    expect(asked.question?.question_id).toBe('q');
    const ledger = { effort: 'standard' as const, counters: { tool_calls: { used: 41, limit: 60 } }, cost: null, cost_limit: 5, limit_reached: null };
    expect(withLedger(asked, ledger).ledger).toEqual(ledger);
  });
});

describe('the budget line', () => {
  const ledger = (counters: Record<string, { used: number; limit: number | null }>, cost: number | null = null) => (
    { effort: 'standard' as const, counters, cost, cost_limit: 5, limit_reached: null }
  );
  it('says nothing below two thirds, then the counter nearest its limit', () => {
    expect(budgetNote(ledger({ model_calls: { used: 20, limit: 40 } }))).toBeNull();
    expect(budgetNote(ledger({ model_calls: { used: 27, limit: 40 }, tool_calls: { used: 10, limit: 60 } }))).toBe('Two thirds of its steps used');
    expect(budgetNote(ledger({ web_calls: { used: 12, limit: 12 }, model_calls: { used: 30, limit: 40 } }))).toBe('Used all its web searches');
    expect(budgetNote(ledger({ model_calls: { used: 3, limit: 40 } }, 4))).toBe('Two thirds of its cost limit used');
    expect(budgetNote(ledger({ scholarly_calls: { used: 9, limit: null } }))).toBeNull();
  });
});

describe('a stored turn, from its record', () => {
  it('has the reply’s claims, plan and question, and the question’s effort and plan', () => {
    const record: ReplyRecord = {
      kind: 'reply', status: 'completed', tool_calls: [], sources: [], passages: [], tasks: [], workers: [], skills: [], instructions: [], artifacts: [], change_sets: [], created_pages: [],
      claims: [{ tool_call_id: 'c1', verdict: 'contradicted', evidence_level: 'full_text', cannot_assess: false, passages: [{ id: 'S1.1', level: 'full_text', stance: 'contradicts' }] }],
      plan: plan(4, 'stopped'), question: { question_id: 'q', questions: [{ id: 'a', text: 'Which venue?', options: ['ICLR'], allow_free_text: false }] },
      models: [], usage: { prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 }, cost: null, cost_limit: null, limit_reached: null, error: null,
    };
    const [question, reply] = historyMessages([
      { role: 'user', content: 'Plan a review', run_id: 'r', created_at: '2026-11-16T10:00:00Z', record: { kind: 'request', preset: null, effort: 'deep', web: true, plan_id: 'p1' } },
      { role: 'assistant', content: 'Here is a plan.', run_id: 'r', created_at: '2026-11-16T10:01:00Z', record },
    ]);
    expect(question).toMatchObject({ effort: 'deep', web: true, planId: 'p1' });
    expect(reply?.claims).toEqual([{ toolCallId: 'c1', verdict: 'contradicted', evidenceLevel: 'full_text', cannotAssess: false, passages: [{ id: 'S1.1', level: 'full_text', stance: 'contradicts' }] }]);
    expect(reply?.plan).toMatchObject({ plan_id: 'p1', revision: 4, state: 'stopped' });
    expect(reply?.question?.questions[0]?.text).toBe('Which venue?');
  });
});
