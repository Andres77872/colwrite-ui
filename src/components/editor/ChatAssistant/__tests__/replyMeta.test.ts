import { agentSource } from '@/__tests__/agentSource';
import { agentWorker } from '@/__tests__/agentWorker';
import { describe, expect, it } from 'vitest';
import { emptyMessage, historyMessages } from '../chatUtils';
import { formatSpan, replyDetails, replyMetaOf, replyNotes, replySummary, replyTimeLabel } from '../replyMeta';
import type { AgentBudget } from '@/api/assistant/streamParser';
import { messageForClipboard } from '../ChatRefTags';
import type { Block } from '@/editor';
import type { ReplyRecord } from '@/api/schema';

const NOW = new Date(2026, 10, 15, 14, 45).getTime();
const at = (hour: number, minute: number, second = 0, day = 15, month = 10, year = 2026) =>
  new Date(year, month, day, hour, minute, second).getTime();
const clock = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

describe('reply metadata', () => {
  it('formats spans with tenths only while they matter', () => {
    expect(formatSpan(400)).toBe('0.4s');
    expect(formatSpan(3_000)).toBe('3s');
    expect(formatSpan(3_240)).toBe('3.2s');
    expect(formatSpan(14_400)).toBe('14s');
    expect(formatSpan(65_000)).toBe('1m 05s');
  });

  it('says the time alone for today and adds the date before', () => {
    expect(replyTimeLabel(at(14, 41), NOW)).toBe(clock(at(14, 41)));
    expect(replyTimeLabel(at(13, 5, 0, 20, 8), NOW)).toContain('Sep');
    expect(replyTimeLabel(at(13, 5, 0, 20, 8, 2025), NOW)).toContain('2025');
  });

  it('sums up when, how long and how much, each part named for a screen reader', () => {
    const message = {
      ...emptyMessage('assistant', 'Done.'),
      createdAt: at(14, 41),
      durationMs: 14_000,
      usage: { promptTokens: 5_120, completionTokens: 210, cachedTokens: 0 },
    };
    expect(replySummary(replyMetaOf(message), NOW).map(({ spoken, text }) => `${spoken} ${text}`)).toEqual([
      `answered ${clock(at(14, 41))}`,
      'took 14s',
      'used 5.3k tokens',
    ]);
  });

  it('leaves out what is not known, and zero usage', () => {
    const message = { ...emptyMessage('assistant', 'Done.'), usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0 } };
    expect(replySummary(replyMetaOf(message), NOW)).toEqual([]);
    expect(replyDetails(replyMetaOf(message), NOW)).toEqual([]);
  });

  it('details every known fact', () => {
    const message = {
      ...emptyMessage('assistant', 'Done.'),
      createdAt: at(14, 41, 17),
      durationMs: 14_000,
      firstTokenMs: 3_200,
      thinkingMs: 6_400,
      usage: { promptTokens: 5_120, completionTokens: 210, cachedTokens: 4_096 },
      models: [
        { model: 'anthropic/claude-sonnet-5.5', tier: 'main', calls: 3, fallback: true, prompt_tokens: 4_820, completion_tokens: 190, cost: 0.0168 },
        { model: 'openai/gpt-6-luna', tier: 'lite', calls: 1, fallback: false, prompt_tokens: 300, completion_tokens: 20, cost: null },
      ],
      cost: 0.0168,
      runs: [
        { id: 'a', tool: 'web_search', state: 'done' as const },
        { id: 'b', tool: 'web_fetch', state: 'error' as const },
      ],
      sources: [agentSource('S1', { key: 'k', title: 'Paper' })],
      engine: { name: 'Claude Code', model: 'sonnet' },
    };
    const rows = Object.fromEntries(replyDetails(replyMetaOf(message), NOW).map((row) => [row.label, row.value]));
    expect(rows).toMatchObject({
      Took: '14s',
      'First words': 'after 3.2s',
      // Whole seconds, as "Thought for 6s" says above the answer.
      Thinking: '6s',
      Tools: '2 calls · 1 failed',
      Sources: '1',
      Tokens: `${(5_120).toLocaleString()} in · 210 out · ${(4_096).toLocaleString()} cached`,
      // The model that answered, the helper, the fallback and the cost, as `done` reported them.
      Model: 'claude-sonnet-5.5',
      Helpers: 'gpt-6-luna',
      Fallback: 'Yes: claude-sonnet-5.5 took over',
      Cost: '$0.0168',
      Engine: 'Claude Code · sonnet',
    });
    expect(rows.Answered).toMatch(/Nov.*15/);
    expect(rows.Answered).not.toContain('2026');
  });
});

describe('a reply that did not complete', () => {
  it('says "Stopped" first in its summary and its details', () => {
    const message = { ...emptyMessage('assistant', 'Half an answer'), ended: 'stopped' as const };
    expect(replySummary(replyMetaOf(message), NOW).map((part) => part.text)).toEqual(['Stopped']);
    expect(replyDetails(replyMetaOf(message), NOW)).toContainEqual({ label: 'Ended', value: 'Stopped before it finished' });
  });

  it('says a CLI engine reported no cost, rather than nothing', () => {
    const message = {
      ...emptyMessage('assistant', 'Done.'),
      models: [{ model: 'claude-sonnet-5-5', tier: 'main', calls: 2, fallback: false, prompt_tokens: 10, completion_tokens: 2, cost: null }],
      cost: null,
    };
    expect(replyDetails(replyMetaOf(message), NOW)).toContainEqual({ label: 'Cost', value: 'Not reported' });
  });
});

describe('a reply’s ledger, as its done reported it', () => {
  const budget = (fields: Partial<AgentBudget> = {}): AgentBudget => ({ costLimit: 5, limitReached: null, ...fields });
  const reply = (fields: Partial<ReturnType<typeof emptyMessage>>) => ({ ...emptyMessage('assistant', 'Done.'), cost: 0.0121, ...fields });

  it('says the cost against the run’s limit, or alone when the run has none', () => {
    const rows = replyDetails(replyMetaOf(reply({ budget: budget() })), NOW);
    expect(rows).toContainEqual({ label: 'Cost', value: '$0.0121 of $5.00' });
    expect(replySummary(replyMetaOf(reply({ budget: budget() })), NOW)).toEqual([]);
    expect(replyDetails(replyMetaOf(reply({ budget: budget({ costLimit: null }) })), NOW)).toContainEqual({ label: 'Cost', value: '$0.0121' });
  });

  it('says when a limit made the run answer with what it had, in words for each limit', () => {
    const ended = (limitReached: string) => {
      const meta = replyMetaOf(reply({ budget: budget({ limitReached }) }));
      expect(replySummary(meta, NOW).map((part) => part.text)).toEqual(['Stopped at its limit']);
      return replyDetails(meta, NOW).find((row) => row.label === 'Ended')?.value;
    };
    // The record keeps no counters, so a step or tool-call limit has no
    // number: the same words live and after a reload.
    expect(ended('model_calls')).toBe('Stopped at its step limit and answered with what it had');
    expect(ended('tool_calls')).toBe('Stopped at its tool-call limit and answered with what it had');
    expect(ended('cost')).toBe('Stopped at its cost limit of $5.00 and answered with what it had');
    expect(ended('events')).toBe('Stopped at the most one reply can record, and answered with what it had');
    expect(ended('wall_clock')).toBe('Stopped at its time limit and answered with what it had');
    expect(ended('something_new')).toBe('Stopped at a limit and answered with what it had');
  });

  it('notes quietly when part of the reply’s record was not saved, and when the reply itself may not be', () => {
    expect(replyNotes(replyMetaOf(reply({ persistence: { failedWrites: 0, kinds: [] } })))).toEqual([]);
    expect(replyNotes(replyMetaOf(reply({ persistence: { failedWrites: 2, kinds: ['llm_call', 'tool_call'] } }))))
      .toEqual(['Part of this reply’s record may not have been saved, so a reload may show less.']);
    expect(replyNotes(replyMetaOf(reply({ persistence: { failedWrites: 1, kinds: ['message'] } }))))
      .toEqual(['This reply may not have been saved, so a reload may not show it.']);
  });
});

const record = (fields: Partial<ReplyRecord>): ReplyRecord => ({
  kind: 'reply', status: 'completed', tool_calls: [], sources: [], passages: [], tasks: [], workers: [], skills: [], instructions: [], change_sets: [], created_pages: [],
  claims: [], plan: null, question: null, artifacts: [],
  models: [], usage: { prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 }, cost: null,
  cost_limit: null, limit_reached: null, error: null, ...fields,
});
const call = (tool: string, id: string, extra: Partial<ReplyRecord['tool_calls'][number]> = {}): ReplyRecord['tool_calls'][number] => ({
  tool_call_id: id, tool, worker_id: null, arguments: { limit: 6 }, duration_ms: 900, is_error: false, error: null, error_type: null,
  output_chars: 40, output_truncated: false, finished: true, ...extra,
});

describe('a stored reply, rebuilt from its record (P1.UI-4)', () => {
  it('has the activity, sources, passages, tasks, workers, change sets, models, usage and cost it was shown with', () => {
    const [, reply] = historyMessages([
      { role: 'user', content: 'Q', run_id: 'r1', created_at: '2026-09-20T13:04:41Z', record: { kind: 'request', preset: null, effort: 'standard', web: false, plan_id: null } },
      {
        role: 'assistant', content: 'A [S1]', run_id: 'r1', created_at: '2026-09-20T13:05:00Z',
        record: record({
          tool_calls: [
            call('web_search', 'w1:call_1', { worker_id: 'w1' }),
            call('semantic_scholar_search', 'call_1', { arguments: { year_from: 2020 } }),
            call('semantic_scholar_paper', 'call_2', { is_error: true, error: 'Took too long.', error_type: 'timeout' }),
            call('doc_edit', 'call_3', { finished: false, duration_ms: null, arguments: null }),
          ],
          sources: [
            agentSource('S1', { key: '2101.03961', title: 'Switch Transformers', provider: 'semantic_scholar' }, { kind: 'preprint' }),
            // Not a source: a record without a title.
            { ...agentSource('S2', { key: 'k2' }), record: { key: 'k2' } as never },
          ],
          passages: [{ id: 'S1.1', level: 'abstract' }, { id: 'nope', level: 'abstract' }],
          tasks: [{ id: 't1', content: 'Find papers', status: 'completed' }],
          workers: [agentWorker()],
          change_sets: [{ tool_call_id: 'call_3', tool: 'doc_edit', change_set_id: 'cs-1', document_id: 'd', apply_policy: 'review', auto_blocked_reason: 'untrusted_content' }],
          models: [{ model: 'openai/gpt-6.1-sol', tier: 'main', calls: 2, fallback: false, prompt_tokens: 100, completion_tokens: 20, cost: 0.01 }],
          usage: { prompt_tokens: 100, completion_tokens: 20, cached_tokens: 64 },
          cost: 0.01,
        }),
      },
    ]);
    expect(reply?.runs.map((run) => [run.id, run.tool, run.state])).toEqual([
      ['w1:call_1', 'web_search', 'done'],
      ['call_1', 'semantic_scholar_search', 'done'],
      ['call_2', 'semantic_scholar_paper', 'error'],
      // Stopped while it ran: interrupted, never painted as done.
      ['call_3', 'doc_edit', 'interrupted'],
    ]);
    expect(reply?.runs[1]).toMatchObject({ args: { year_from: 2020 }, durationMs: 900, outputChars: 40 });
    expect(reply?.runs[2]).toMatchObject({ error: 'Took too long.', errorType: 'timeout' });
    expect(reply?.sources).toEqual([
      agentSource('S1', { key: '2101.03961', title: 'Switch Transformers', provider: 'semantic_scholar' }, { kind: 'preprint' }),
    ]);
    expect(reply?.passages).toEqual([{ id: 'S1.1', level: 'abstract' }]);
    expect(reply?.todos).toEqual([{ id: 't1', content: 'Find papers', status: 'completed' }]);
    expect(reply?.workers).toEqual([agentWorker()]);
    expect(reply?.changeSetIds).toEqual(['cs-1']);
    expect(reply?.autoPaused).toBe('untrusted_content');
    expect(reply).toMatchObject({ usage: { promptTokens: 100, completionTokens: 20, cachedTokens: 64 }, cost: 0.01 });
    expect(reply?.ended).toBeUndefined();
    expect(replyDetails(replyMetaOf(reply!), NOW)).toContainEqual({ label: 'Model', value: 'gpt-6.1-sol' });
  });

  it('keeps the run’s cost ceiling and the limit it answered at, so it says the same as it did live', () => {
    const [, reply] = historyMessages([
      { role: 'user', content: 'Q', run_id: 'r1', created_at: '2026-09-20T13:04:41Z', record: { kind: 'request', preset: null, effort: 'standard', web: false, plan_id: null } },
      {
        role: 'assistant', content: 'What I had.', run_id: 'r1', created_at: '2026-09-20T13:05:00Z',
        record: record({ cost: 0.0168, cost_limit: 5, limit_reached: 'model_calls' }),
      },
    ]);
    if (!reply) throw new Error('no reply');
    expect(reply.budget).toEqual({ costLimit: 5, limitReached: 'model_calls' });
    const meta = replyMetaOf(reply);
    expect(replySummary(meta, NOW).map((part) => part.text)[0]).toBe('Stopped at its limit');
    expect(replyDetails(meta, NOW)).toContainEqual({ label: 'Ended', value: 'Stopped at its step limit and answered with what it had' });
    expect(replyDetails(meta, NOW)).toContainEqual({ label: 'Cost', value: '$0.0168 of $5.00' });
    // The failed writes are said live only: the record does not keep them.
    expect(reply.persistence).toBeUndefined();
  });

  it('says how a stopped or failed reply ended, with the failure’s words', () => {
    const [stopped, failed] = historyMessages([
      { role: 'assistant', content: '', run_id: null, created_at: '2026-09-20T13:05:00Z', record: record({ status: 'stopped', tool_calls: [call('doc_read', 'c')] }) },
      { role: 'assistant', content: '', run_id: null, created_at: '2026-09-20T13:05:00Z', record: record({ status: 'failed', error: { code: 'MODEL_GATEWAY_TRANSIENT', message: 'The model did not respond.' } }) },
    ]);
    expect(stopped).toMatchObject({ ended: 'stopped', runs: [{ tool: 'doc_read', state: 'done' }] });
    expect(failed).toMatchObject({ ended: 'failed', failure: { code: 'MODEL_GATEWAY_TRANSIENT', message: 'The model did not respond.' } });
  });

  it('keeps the preset a question ran, so Retry runs it again', () => {
    const [question] = historyMessages([
      { role: 'user', content: 'Review this page', run_id: 'r', created_at: '2026-09-20T13:05:00Z', record: { kind: 'request', preset: 'review-page', effort: 'standard', web: false, plan_id: null } },
    ]);
    expect(question).toMatchObject({ content: 'Review this page', preset: 'review-page' });
  });
});

describe('stored messages', () => {
  it('know when they were written, and a reply how long its run took', () => {
    const [question, answer] = historyMessages([
      { role: 'user', content: 'Q', run_id: 'r1', created_at: '2026-09-20T13:04:41Z', record: null },
      { role: 'assistant', content: 'A', run_id: 'r1', created_at: '2026-09-20T13:05:00Z', record: null },
    ]);
    expect(question?.createdAt).toBe(Date.parse('2026-09-20T13:04:41Z'));
    expect(answer?.createdAt).toBe(Date.parse('2026-09-20T13:05:00Z'));
    expect(answer?.durationMs).toBe(19_000);
  });

  it('give no duration to a reply another run wrote (a regenerated answer) or one with no run', () => {
    const regenerated = historyMessages([
      { role: 'user', content: 'Q', run_id: 'r1', created_at: '2026-09-20T13:04:41Z', record: null },
      { role: 'assistant', content: 'A', run_id: 'r2', created_at: '2026-09-20T15:00:00Z', record: null },
    ]);
    const unknown = historyMessages([
      { role: 'user', content: 'Q', run_id: null, created_at: '2026-09-20T13:04:41Z', record: null },
      { role: 'assistant', content: 'A', run_id: null, created_at: '2026-09-20T13:05:00Z', record: null },
    ]);
    expect(regenerated[1]?.durationMs).toBeUndefined();
    expect(unknown[1]?.durationMs).toBeUndefined();
    expect(unknown[1]?.createdAt).toBe(Date.parse('2026-09-20T13:05:00Z'));
  });
});

describe('a question on the clipboard', () => {
  const blocks: Block[] = [{ id: 'intro', type: 'heading', level: 2, html: 'Introduction' }];

  it('is the message as written in plain text, so the composer turns its references back into chips', () => {
    expect(messageForClipboard('Tighten #this/intro please', blocks).plain).toBe('Tighten #this/intro please');
  });

  it('names each reference by its label in rich text, escaped, with its line breaks', () => {
    expect(messageForClipboard('Tighten #this/intro <now>\nthanks', blocks).html).toBe(
      'Tighten “Introduction” &lt;now&gt;<br>thanks',
    );
  });
});
