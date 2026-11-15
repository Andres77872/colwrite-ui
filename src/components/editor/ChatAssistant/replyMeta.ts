import { formatElapsed } from '@/components/editor/AgentProgress';
import { shortDateTime } from '@/components/layout/editedLabel';
import type { ChatMessage } from './chatUtils';
import { formatTokens } from './AgentActivity/toolMeta';

/** What is known about how a reply was made: shown under it, in detail on request. */
export type ReplyMeta = {
  /** When the reply ended, in ms since the epoch. */
  finishedAt?: number;
  durationMs?: number;
  firstTokenMs?: number;
  thinkingMs?: number;
  usage?: { promptTokens: number; completionTokens: number };
  toolCalls: number;
  toolFailures: number;
  sources: number;
  engine?: { name: string; model?: string };
};

export function replyMetaOf(message: ChatMessage): ReplyMeta {
  return {
    finishedAt: message.createdAt,
    durationMs: message.durationMs,
    firstTokenMs: message.firstTokenMs,
    thinkingMs: message.thinkingMs,
    usage: message.usage,
    toolCalls: message.runs.length,
    toolFailures: message.runs.filter((run) => run.state === 'error').length,
    sources: message.sources?.length ?? 0,
    engine: message.engine,
  };
}

/** "0.4s", "3.2s", "14s", "1m 05s": tenths only while they still matter. */
export function formatSpan(ms: number): string {
  if (ms >= 10_000) return formatElapsed(ms);
  return `${(Math.max(0, ms) / 1000).toFixed(1).replace(/\.0$/, '')}s`;
}

const isToday = (at: number, now: number) => new Date(at).toDateString() === new Date(now).toDateString();

/** "2:41 PM" today; "Sep 20, 1:05 PM" (with the year when it is not this one) before. */
export function replyTimeLabel(at: number, now = Date.now()): string {
  if (isToday(at, now)) return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return shortDateTime(at, now);
}

const usageTotal = (usage: ReplyMeta['usage']) => (usage ? usage.promptTokens + usage.completionTokens : 0);

/**
 * The short line under a reply: when, how long and how much. `spoken` leads
 * each part for a screen reader, which would otherwise hear "14s" with no
 * idea what took it.
 */
export function replySummary(
  meta: ReplyMeta,
  now = Date.now(),
): Array<{ key: string; text: string; spoken: string; dateTime?: string }> {
  const parts: Array<{ key: string; text: string; spoken: string; dateTime?: string }> = [];
  if (meta.finishedAt !== undefined) {
    parts.push({
      key: 'time',
      text: replyTimeLabel(meta.finishedAt, now),
      spoken: 'answered',
      dateTime: new Date(meta.finishedAt).toISOString(),
    });
  }
  if (meta.durationMs !== undefined) parts.push({ key: 'took', text: formatSpan(meta.durationMs), spoken: 'took' });
  const total = usageTotal(meta.usage);
  if (total > 0) parts.push({ key: 'tokens', text: `${formatTokens(total)} tokens`, spoken: 'used' });
  return parts;
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** "Nov 15, 2:41:17 PM", with the year when it is not this one: to the second, on one line. */
export function exactTime(at: number, now = Date.now()): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Every known fact about the reply, for its details popover. */
export function replyDetails(meta: ReplyMeta, now = Date.now()): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (meta.finishedAt !== undefined) rows.push({ label: 'Answered', value: exactTime(meta.finishedAt, now) });
  if (meta.durationMs !== undefined) rows.push({ label: 'Took', value: formatSpan(meta.durationMs) });
  if (meta.firstTokenMs !== undefined) rows.push({ label: 'First words', value: `after ${formatSpan(meta.firstTokenMs)}` });
  // Whole seconds, as "Thought for 12s" above the answer says it.
  if (meta.thinkingMs) rows.push({ label: 'Thinking', value: formatElapsed(meta.thinkingMs) });
  if (meta.toolCalls > 0) {
    rows.push({
      label: 'Tools',
      value: plural(meta.toolCalls, 'call', 'calls') + (meta.toolFailures > 0 ? ` · ${meta.toolFailures.toLocaleString()} failed` : ''),
    });
  }
  if (meta.sources > 0) rows.push({ label: 'Sources', value: meta.sources.toLocaleString() });
  if (meta.usage && usageTotal(meta.usage) > 0) {
    rows.push({
      label: 'Tokens',
      value: `${meta.usage.promptTokens.toLocaleString()} in · ${meta.usage.completionTokens.toLocaleString()} out`,
    });
  }
  if (meta.engine) {
    rows.push({ label: 'Engine', value: [meta.engine.name, meta.engine.model].filter(Boolean).join(' · ') });
  }
  return rows;
}
