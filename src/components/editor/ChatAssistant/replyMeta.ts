import { formatElapsed } from '@/components/editor/AgentProgress';
import { shortDateTime } from '@/components/layout/editedLabel';
import type { AgentBudget, AgentBudgetUpdate, AgentInstruction, AgentPersistence, AgentServedModel, AgentSkill, AgentUsage } from '@/api/assistant/streamParser';
import type { ChatMessage } from './chatUtils';
import { formatTokens } from './AgentActivity/toolMeta';
import { formatCost } from '@/lib/text';

/** What is known about how a reply was made: shown under it, in detail on request. */
export type ReplyMeta = {
  /** When the reply ended, in ms since the epoch. */
  finishedAt?: number;
  durationMs?: number;
  firstTokenMs?: number;
  thinkingMs?: number;
  usage?: AgentUsage;
  /** The models that served it, each with its tier and whether a fallback reached it. */
  models?: AgentServedModel[];
  /** In USD; `null` when no provider reported one. */
  cost?: number | null;
  /** How a reply that did not complete ended. */
  ended?: 'stopped' | 'failed';
  /** The run's cost ceiling and the limit it reached, live or from its record. */
  budget?: AgentBudget | null;
  /** Writes of the run's own records that failed; known live only. */
  persistence?: AgentPersistence | null;
  toolCalls: number;
  toolFailures: number;
  sources: number;
  engine?: { name: string; model?: string };
  skills?: AgentSkill[];
  instructions?: AgentInstruction[];
};

export function replyMetaOf(message: ChatMessage): ReplyMeta {
  return {
    finishedAt: message.createdAt,
    durationMs: message.durationMs,
    firstTokenMs: message.firstTokenMs,
    thinkingMs: message.thinkingMs,
    usage: message.usage,
    models: message.models,
    cost: message.cost,
    ended: message.ended,
    budget: message.budget,
    persistence: message.persistence,
    skills: message.skills,
    instructions: message.instructions,
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
  // A stopped reply looked finished; it says so first, and so does one a
  // limit made answer with what it had.
  if (meta.ended) parts.push({ key: 'ended', text: meta.ended === 'stopped' ? 'Stopped' : 'Did not finish', spoken: 'reply' });
  else if (meta.budget?.limitReached) parts.push({ key: 'ended', text: 'Stopped at its limit', spoken: 'reply' });
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

/**
 * Which limit made the run answer early, in words: after it, the run's next
 * model call was its answer, with no more tools (`done.budget.limit_reached`,
 * `ColWrite-api/docs/assistant-events.md#done`, kept in the reply's record as
 * `limit_reached`). The record keeps no counters, so a step or tool-call
 * limit is named without its number, the same live and reloaded; the cost
 * ceiling is kept, so that one is.
 */
export function limitReachedText(budget: AgentBudget): string | null {
  switch (budget.limitReached) {
    case null:
      return null;
    case 'model_calls':
      return 'Stopped at its step limit and answered with what it had';
    case 'tool_calls':
      return 'Stopped at its tool-call limit and answered with what it had';
    case 'cost':
      return budget.costLimit !== null ? `Stopped at its cost limit of ${formatCost(budget.costLimit)} and answered with what it had` : 'Stopped at its cost limit and answered with what it had';
    case 'events':
      return 'Stopped at the most one reply can record, and answered with what it had';
    case 'wall_clock':
      return 'Stopped at its time limit and answered with what it had';
    default:
      return 'Stopped at a limit and answered with what it had';
  }
}

const COUNTER_WORDS: Record<string, string> = {
  model_calls: 'steps',
  tool_calls: 'tool calls',
  web_calls: 'web searches',
  scholarly_calls: 'paper lookups',
  workers: 'research workers',
};

/**
 * The quiet line under a running reply's progress from its latest `budget`
 * event: the counter nearest its limit, once it crossed two thirds ("Two
 * thirds of its steps used"), or reached it. `null` while every counter is
 * below two thirds.
 */
export function budgetNote(ledger: AgentBudgetUpdate): string | null {
  let nearest: { words: string; share: number } | null = null;
  for (const [name, counter] of Object.entries(ledger.counters)) {
    const words = COUNTER_WORDS[name];
    if (!words || !counter.limit || counter.limit <= 0) continue;
    const share = counter.used / counter.limit;
    if (!nearest || share > nearest.share) nearest = { words, share };
  }
  if (ledger.cost !== null && ledger.cost_limit) {
    const share = ledger.cost / ledger.cost_limit;
    if (!nearest || share > nearest.share) nearest = { words: 'cost limit', share };
  }
  if (!nearest || nearest.share < 2 / 3) return null;
  if (nearest.share >= 1) return nearest.words === 'cost limit' ? 'Reached its cost limit' : `Used all its ${nearest.words}`;
  return `Two thirds of its ${nearest.words} used`;
}

/**
 * A quiet note under the details when some of the run's own records could
 * not be saved: the reply itself (`message`), or the rest of its account.
 */
export function replyNotes(meta: ReplyMeta): string[] {
  const persistence = meta.persistence;
  if (!persistence || persistence.failedWrites === 0) return [];
  return [
    persistence.kinds.includes('message')
      ? 'This reply may not have been saved, so a reload may not show it.'
      : 'Part of this reply’s record may not have been saved, so a reload may show less.',
  ];
}

/** "anthropic/claude-sonnet-5.5" as its last part, which is how a model is known. */
const modelName = (model: string) => model.split('/').at(-1) ?? model;

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
  if (meta.ended) rows.push({ label: 'Ended', value: meta.ended === 'stopped' ? 'Stopped before it finished' : 'Failed' });
  else if (meta.budget) {
    const reached = limitReachedText(meta.budget);
    if (reached) rows.push({ label: 'Ended', value: reached });
  }
  if (meta.sources > 0) rows.push({ label: 'Sources', value: meta.sources.toLocaleString() });
  if (meta.skills?.length) rows.push({ label: 'Skills', value: meta.skills
    .map((skill) => `${skill.label} (${skill.version})${skill.resource ? ` · ${skill.resource}` : ''}`).join('; ') });
  if (meta.instructions?.length) rows.push({ label: 'Instructions', value: meta.instructions
    .map((item) => item.scope === 'page' ? 'Page' : `Section: ${item.label}`).join('; ') });
  // The models the server says served it: the main tier answered, the lite
  // tier ran helpers and workers. A fallback means the chain's first model
  // failed and the next one took over.
  const served = meta.models ?? [];
  const main = served.filter((model) => model.tier === 'main');
  const helpers = served.filter((model) => model.tier !== 'main');
  if (main.length) rows.push({ label: main.length === 1 ? 'Model' : 'Models', value: main.map((model) => modelName(model.model)).join(', ') });
  if (helpers.length) rows.push({ label: 'Helpers', value: helpers.map((model) => modelName(model.model)).join(', ') });
  if (served.some((model) => model.fallback)) {
    rows.push({ label: 'Fallback', value: `Yes: ${served.filter((model) => model.fallback).map((model) => modelName(model.model)).join(', ')} took over` });
  }
  if (meta.usage && usageTotal(meta.usage) > 0) {
    rows.push({
      label: 'Tokens',
      value: `${meta.usage.promptTokens.toLocaleString()} in · ${meta.usage.completionTokens.toLocaleString()} out`
        + (meta.usage.cachedTokens > 0 ? ` · ${meta.usage.cachedTokens.toLocaleString()} cached` : ''),
    });
  }
  // Against the run's ceiling where it has one, which is what the limit was.
  const costLimit = meta.budget?.costLimit ?? null;
  if (typeof meta.cost === 'number') {
    rows.push({ label: 'Cost', value: costLimit !== null ? `${formatCost(meta.cost)} of ${formatCost(costLimit)}` : formatCost(meta.cost) });
  } else if (served.length && meta.cost === null) rows.push({ label: 'Cost', value: 'Not reported' });
  if (meta.engine) {
    rows.push({ label: 'Engine', value: [meta.engine.name, meta.engine.model].filter(Boolean).join(' · ') });
  }
  return rows;
}
