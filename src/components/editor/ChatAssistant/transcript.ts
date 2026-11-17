import {
  mergePassages,
  mergeSources,
  type AgentArtifact, type AgentBudgetUpdate, type AgentClaim, type AgentEvidence, type AgentInstruction, type AgentPlan, type AgentQuestion, type AgentSkill, type AgentSource, type AgentTodo, type AgentWorker,
  type ToolCallArgsEvent, type ToolCallEndEvent, type ToolCallProgressEvent,
} from '@/api/assistant/streamParser';
import type { ToolRun } from './AgentActivity';
import type { ChatMessage } from './chatUtils';

/**
 * The chat's transcript, as pure updates of the reply a turn writes into:
 * each event of the run, and its end. `useAgentTurn` applies them to the
 * active message; nothing here talks to the network or to React. The tool
 * call updates take anything with `runs`, so Ask AI keeps its activity list
 * with them too.
 */

/** A record of tool calls: a chat reply, or Ask AI's activity. */
export type ToolRecord = { runs: ToolRun[] };

export function withArtifact(message: ChatMessage, artifact: AgentArtifact): ChatMessage {
  const held = message.artifacts ?? [];
  const index = held.findIndex((item) => item.generation_id === artifact.generation_id);
  return { ...message, artifacts: index < 0 ? [...held, artifact] : held.map((item, at) => at === index ? artifact : item) };
}

export function withSkill(message: ChatMessage, skill: AgentSkill): ChatMessage {
  const held = message.skills ?? [];
  return held.some((item) => item.id === skill.id && item.resource === skill.resource)
    ? message : { ...message, skills: [...held, skill] };
}

export function withInstructions(message: ChatMessage, instructions: AgentInstruction[]): ChatMessage {
  return { ...message, instructions };
}

/** Close the stretch of reasoning under way, adding it to the time spent. */
export function endThinking(message: ChatMessage, now: number): ChatMessage {
  if (message.thinkingSince === undefined) return message;
  return {
    ...message,
    thinkingMs: (message.thinkingMs ?? 0) + Math.max(0, now - message.thinkingSince),
    thinkingSince: undefined,
  };
}

/** Answer text. `firstTokenMs` is set once, for a turn this browser timed. */
export function withToken(message: ChatMessage, content: string, now: number, sinceSent: number | null): ChatMessage {
  return {
    ...endThinking(message, now),
    content: message.content + content,
    ...(sinceSent !== null && message.firstTokenMs === undefined ? { firstTokenMs: sinceSent } : {}),
  };
}

export function withReasoning(message: ChatMessage, content: string, now: number): ChatMessage {
  return {
    ...message,
    reasoning: (message.reasoning ?? '') + content,
    thinkingSince: message.thinkingSince ?? now,
  };
}

/** A call began: its arguments are not known yet (the start defers them), its display is. */
export function withToolStart<T extends ToolRecord>(record: T, run: Pick<ToolRun, 'id' | 'tool' | 'display'>, now: number): T {
  return {
    ...record,
    runs: [...record.runs, { ...run, state: 'running', startedAt: now }],
  };
}

/** The running call `event` names: by id when the provider sends one, else the oldest of that tool. */
function runningIndex(record: ToolRecord, event: { toolCallId: string; tool: string }, extra: (run: ToolRun) => boolean = () => true): number {
  return record.runs.findIndex((run) =>
    run.state === 'running'
    && (event.toolCallId ? run.id === event.toolCallId : run.tool === event.tool)
    && extra(run),
  );
}

function replaceRun<T extends ToolRecord>(record: T, index: number, run: ToolRun): T {
  const runs = record.runs.slice();
  runs[index] = run;
  return { ...record, runs };
}

/**
 * How much of a call's input the model has written. Only while the input is
 * still being written: once its arguments are known it is running, and a
 * late count is noise.
 */
export function withToolProgress<T extends ToolRecord>(record: T, event: ToolCallProgressEvent): T {
  const index = runningIndex(record, event, (run) => run.args === undefined && run.argsPreview === undefined);
  const existing = record.runs[index];
  if (!existing || existing.argumentsChars === event.argumentsChars) return record;
  return replaceRun(record, index, { ...existing, argumentsChars: event.argumentsChars });
}

/** The start fires before the model has finished its arguments: this is usually the first time they are known. */
export function withToolArgs<T extends ToolRecord>(record: T, event: ToolCallArgsEvent): T {
  const index = runningIndex(record, event);
  const existing = record.runs[index];
  if (!existing) return record;
  return replaceRun(record, index, {
    ...existing,
    args: event.arguments ?? existing.args,
    argsPreview: event.argumentsPreview || existing.argsPreview,
    // Written in full: the call is running now, not being drafted.
    argumentsChars: undefined,
  });
}

/**
 * A call's outcome: its one end, which the tool runtime sends (the API sends
 * at most one per call). Matched on the call id whenever the provider sends
 * one; without it there is nothing to pair on but the name, so two
 * concurrent calls of the same tool resolve oldest-first. An end with no
 * running call to match is left alone rather than applied to some other run.
 */
export function withToolEnd<T extends ToolRecord>(record: T, event: ToolCallEndEvent): T {
  const index = runningIndex(record, event);
  const existing = record.runs[index];
  if (!existing) return record;
  return replaceRun(record, index, {
    ...existing,
    state: event.isError ? 'error' : 'done',
    durationMs: event.durationMs,
    error: event.error ?? undefined,
    errorType: event.errorType ?? undefined,
    // The end repeats the arguments unless they were over the wire budget;
    // those `tool_call_args` delivered stay.
    args: event.arguments ?? existing.args,
    argsPreview: event.argumentsPreview || existing.argsPreview,
    outputPreview: event.outputPreview ?? undefined,
    outputChars: event.outputChars,
    outputTruncated: event.outputTruncated,
  });
}

/**
 * What a call registered, folded into the reply: sources by handle (a
 * retried stream must not list one twice, and a later entry of a handle
 * replaces the earlier one where it stands), passages by id.
 */
export function withEvidence(message: ChatMessage, evidence: AgentEvidence): ChatMessage {
  const sources = mergeSources(message.sources ?? [], evidence.sources);
  const passages = mergePassages(message.passages ?? [], evidence.passages);
  if (!sources.changed.length && !passages.changed.length) return message;
  return {
    ...message,
    ...(sources.changed.length ? { sources: sources.sources } : {}),
    ...(passages.changed.length ? { passages: passages.passages } : {}),
  };
}

/**
 * The conversation's sources, as the branch shown holds them: every reply's,
 * in the order they first arrived, the latest entry of each handle. A handle
 * names one work for the whole conversation, so a reply's `[S3]` is read
 * against these, and a later turn can cite what an earlier one found.
 */
export function conversationSources(messages: readonly Pick<ChatMessage, 'sources'>[]): AgentSource[] {
  let known: AgentSource[] = [];
  for (const message of messages) {
    if (message.sources?.length) known = mergeSources(known, message.sources).sources;
  }
  return known;
}

/** A claim check's verdict joins the reply's; one sent again for the same call replaces it where it stands. */
export function withClaim(message: ChatMessage, claim: AgentClaim): ChatMessage {
  const claims = message.claims ?? [];
  const at = claims.findIndex((item) => item.toolCallId === claim.toolCallId);
  return { ...message, claims: at === -1 ? [...claims, claim] : claims.map((item, index) => (index === at ? claim : item)) };
}

/** The plan as the turn leaves it: the newest revision of each plan, a replayed older one changes nothing. */
export function withPlan(message: ChatMessage, plan: AgentPlan): ChatMessage {
  const held = message.plan;
  if (held && held.plan_id === plan.plan_id && held.revision > plan.revision) return message;
  return { ...message, plan };
}

/** Keep a plan at its first card, with the newest revision from the whole
 * branch. Later progress replies must not leave an older card actionable
 * or unmount a card that still holds the author's unsaved edits. */
export function conversationPlans(messages: readonly ChatMessage[]): Map<string, AgentPlan> {
  const rows = new Map<string, { messageId: string; plan: AgentPlan }>();
  for (const message of messages) {
    const plan = message.plan;
    if (!plan) continue;
    const held = rows.get(plan.plan_id);
    if (!held) rows.set(plan.plan_id, { messageId: message.id, plan });
    else if (plan.revision > held.plan.revision) held.plan = plan;
  }
  return new Map([...rows.values()].map(({ messageId, plan }) => [messageId, plan]));
}

export function withQuestion(message: ChatMessage, question: AgentQuestion): ChatMessage {
  return { ...message, question };
}

/** The run's ledger as its latest `budget` event left it. */
export function withLedger(message: ChatMessage, ledger: AgentBudgetUpdate): ChatMessage {
  return { ...message, ledger };
}

export function withTodos(message: ChatMessage, todos: AgentTodo[]): ChatMessage {
  return { ...message, todos };
}

/** Updated in place: a worker keeps its position, and so its number, from "working" to "reported back". */
export function withWorker(message: ChatMessage, worker: AgentWorker): ChatMessage {
  const workers = message.workers ?? [];
  return {
    ...message,
    workers: workers.some((item) => item.id === worker.id)
      ? workers.map((item) => (item.id === worker.id ? worker : item))
      : [...workers, worker],
  };
}

export function withChangeSet(message: ChatMessage, changeSetId: string): ChatMessage {
  return message.changeSetIds.includes(changeSetId)
    ? message
    : { ...message, changeSetIds: [...message.changeSetIds, changeSetId] };
}

/**
 * Calls the stream died around. The tools themselves did not report
 * failure: `interrupted`, because painting them as errors sent authors
 * chasing the wrong culprit.
 */
export function interruptRuns<T extends ToolRecord>(record: T): T {
  return {
    ...record,
    runs: record.runs.map((run) =>
      run.state === 'running' ? { ...run, state: 'interrupted' as const, argumentsChars: undefined } : run,
    ),
  };
}

/**
 * The reply as the turn left it: when it ended, how long it took (for a turn
 * this browser timed), and any call that never reported back marked
 * interrupted rather than done.
 */
export function finishReply(message: ChatMessage, endedAt: number, durationMs: number | null): ChatMessage {
  return {
    ...interruptRuns(endThinking(message, endedAt)),
    createdAt: endedAt,
    ...(durationMs !== null ? { durationMs } : {}),
  };
}
