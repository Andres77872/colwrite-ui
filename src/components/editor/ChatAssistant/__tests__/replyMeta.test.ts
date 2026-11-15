import { describe, expect, it } from 'vitest';
import { emptyMessage, historyMessages } from '../chatUtils';
import { formatSpan, replyDetails, replyMetaOf, replySummary, replyTimeLabel } from '../replyMeta';
import { messageForClipboard } from '../ChatRefTags';
import type { Block } from '@/editor';

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
      usage: { promptTokens: 5_120, completionTokens: 210 },
    };
    expect(replySummary(replyMetaOf(message), NOW).map(({ spoken, text }) => `${spoken} ${text}`)).toEqual([
      `answered ${clock(at(14, 41))}`,
      'took 14s',
      'used 5.3k tokens',
    ]);
  });

  it('leaves out what is not known, and zero usage', () => {
    const message = { ...emptyMessage('assistant', 'Done.'), usage: { promptTokens: 0, completionTokens: 0 } };
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
      usage: { promptTokens: 5_120, completionTokens: 210 },
      runs: [
        { id: 'a', tool: 'web_search', state: 'done' as const },
        { id: 'b', tool: 'web_fetch', state: 'error' as const },
      ],
      sources: [{ id: 'S1', key: 'k', title: 'Paper', provider: 'crossref' as const }],
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
      Tokens: `${(5_120).toLocaleString()} in · 210 out`,
      Engine: 'Claude Code · sonnet',
    });
    expect(rows.Answered).toMatch(/Nov.*15/);
    expect(rows.Answered).not.toContain('2026');
  });
});

describe('stored messages', () => {
  it('know when they were written, and a reply how long its run took', () => {
    const [question, answer] = historyMessages([
      { role: 'user', content: 'Q', run_id: 'r1', created_at: '2026-09-20T13:04:41Z' },
      { role: 'assistant', content: 'A', run_id: 'r1', created_at: '2026-09-20T13:05:00Z' },
    ]);
    expect(question?.createdAt).toBe(Date.parse('2026-09-20T13:04:41Z'));
    expect(answer?.createdAt).toBe(Date.parse('2026-09-20T13:05:00Z'));
    expect(answer?.durationMs).toBe(19_000);
  });

  it('give no duration to a reply another run wrote (a regenerated answer) or one with no run', () => {
    const regenerated = historyMessages([
      { role: 'user', content: 'Q', run_id: 'r1', created_at: '2026-09-20T13:04:41Z' },
      { role: 'assistant', content: 'A', run_id: 'r2', created_at: '2026-09-20T15:00:00Z' },
    ]);
    const unknown = historyMessages([
      { role: 'user', content: 'Q', run_id: null, created_at: '2026-09-20T13:04:41Z' },
      { role: 'assistant', content: 'A', run_id: null, created_at: '2026-09-20T13:05:00Z' },
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
