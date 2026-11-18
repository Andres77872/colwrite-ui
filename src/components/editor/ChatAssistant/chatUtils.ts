import type { ChatAttachment } from '@/api/assistant/chatAttachments';
import type { ChatMessage as WireChatMessage, RecordToolCall, ReplyRecord } from '@/api/schema';
import { uid } from '@/lib/uid';
import type { ToolRun } from './AgentActivity';
import {
  decodeClaims,
  decodePassages,
  decodePlan,
  decodeQuestion,
  decodeArtifact,
  decodeSources,
  decodeSkill,
  decodeInstructions,
  type AgentBudget, type AgentBudgetUpdate, type AgentClaim, type AgentPassage, type AgentPersistence, type AgentPlan, type AgentQuestion,
  type AgentInstruction, type AgentServedModel, type AgentSkill, type AgentSource, type AgentTodo, type AgentUsage, type AgentWorker,
} from '@/api/assistant/streamParser';
import type { AgentChatContext, AgentChatParams } from '@/api/assistant/agentChat';
import type { CheckpointResume, ResumeAgentRun } from '@/api/assistant/agentSessionChat';
import type { AutoBlockedReason } from '@/editor/types';
import type { EditorFocus } from '@/components/editor/References';
import { extractRefSpans } from './ChatRefTags/refTags';

export type ChatMessage = {
  id: string;
  role: string;
  content: string;
  attachments?: ChatAttachment[];
  /** Server-owned identity of the run that stored this user message. */
  runId?: string;
  /** A question that ran a server chat preset: its id. Its text is the preset's label. */
  preset?: string;
  /** A question's requested effort, also Deep for a planning turn budgeted within Standard. */
  effort?: 'quick' | 'standard' | 'deep';
  /** The Web setting recorded for this request. */
  web?: boolean;
  /** A question that ran from a plan: the plan's id. Kept; P3 shows it. */
  planId?: string;
  /** Tools the agent ran while producing this reply, in order. */
  runs: ToolRun[];
  /**
   * The stored change sets this reply's edits went into, by id. The button
   * under the reply jumps to their changes still open, and an Auto turn's
   * line ("Applied 3 changes · Undo · Review") is found by them.
   */
  changeSetIds: string[];
  /** Tokens the reply used, as its `done` (or its stored record) reported them. */
  usage?: AgentUsage;
  /** The models that served the reply, in the order they first did; a fallback is marked. */
  models?: AgentServedModel[];
  /** What the reply cost, in USD; `null` when no provider reported one (a CLI engine). */
  cost?: number | null;
  /**
   * The run's cost ceiling and the limit that made it answer early, if one
   * did: as its `done` reported them, or its stored record kept them.
   */
  budget?: AgentBudget | null;
  /**
   * Writes of the run's own records that failed, as its `done` reported
   * them. A turn sent from this browser only: the record does not keep them.
   */
  persistence?: AgentPersistence | null;
  /**
   * How a reply that did not complete ended: `stopped` (a Stop, a lost
   * connection to its run, a shutdown) or `failed`. Unset for a completed
   * reply, and while one runs.
   */
  ended?: 'stopped' | 'failed';
  /** A stored failed reply's error, as its record kept it. Live, the alert above the composer says it. */
  failure?: { code: string; message: string };
  /**
   * The sources this reply's tools found or found again, the latest entry
   * of each handle. A handle lasts for the conversation, so the reply's
   * `[S3]` markers are read against every reply's sources
   * (`conversationSources`), not only these; the list under the reply
   * offers to cite or save each.
   */
  sources?: AgentSource[];
  skills?: AgentSkill[];
  instructions?: AgentInstruction[];
  /** The passages this reply's tools stored, by id and level; their text is the assistant's alone. Shown nowhere yet. */
  passages?: AgentPassage[];
  /** The reply's claim checks (`claim`), each shown as a claim card with its passages' sources. */
  claims?: AgentClaim[];
  /** The conversation's plan as this turn left it (the newest revision). Kept; P3's plan card shows it. */
  plan?: AgentPlan;
  /** The questions this turn put to the author. Kept; P3's question card shows them. */
  question?: AgentQuestion;
  artifacts?: import('@/api/assistant/streamParser').AgentArtifact[];
  /** The run's ledger, from its latest `budget` event, while it runs: the quiet line under the progress. */
  ledger?: AgentBudgetUpdate;
  todos?: AgentTodo[];
  workers?: AgentWorker[];
  /**
   * What the model reasoned while it worked, as the engine streamed it (a
   * gateway model's thinking, Claude Code's thinking blocks, Codex's
   * summaries). Shown folded above the answer; never part of it, and not
   * saved with the conversation.
   */
  reasoning?: string;
  /** Time spent reasoning in finished stretches, measured in this browser. */
  thinkingMs?: number;
  /** When the stretch of reasoning under way began; unset between them. */
  thinkingSince?: number;
  /**
   * When the question was sent, or the reply ended, in ms since the epoch:
   * the server's `created_at` for a stored message, this browser's clock for
   * one sent here.
   */
  createdAt?: number;
  /**
   * How long the reply took, from the question to its end. Measured here for
   * a turn sent from this browser; for a stored reply, the gap between its
   * `created_at` and its question's, when the same run wrote both.
   */
  durationMs?: number;
  /** A turn sent from this browser: how long until the answer's first word. */
  firstTokenMs?: number;
  /**
   * A turn sent from this browser with a chosen engine or model: which one
   * it asked for. Absent for the server's default.
   */
  engine?: { name: string; model?: string };
  /**
   * Auto was on for this reply's turn and the server gave its run `review`,
   * from the start or partway through (`untrusted_content`): why, so the
   * reply can say it once the strip above the composer has moved on.
   */
  autoPaused?: AutoBlockedReason;
};

/**
 * What the author reads when something breaks, split from what a bug report
 * needs. `message` is always writeable prose; `detail` carries the technical
 * cause (code, raw body) in a quieter voice; `retryable` gates the
 * "Try again" button to failures where resending the same message can help.
 */
export type ChatError = {
  message: string;
  detail?: string;
  retryable?: boolean;
};

export type ChatTurnOptions = Pick<AgentChatParams, 'context' | 'attachments' | 'preset' | 'effort' | 'plan_id' | 'plan' | 'answers'> & {
  /** Original Web choice when following an admitted run or continuing its checkpoint. */
  web?: boolean;
  /** Readable local text for an answers-only or plan-start request. Never serialized. */
  displayText?: string;
  /** Observe an admitted run, or replay an uncertain start with its original key. */
  resume?: ResumeAgentRun;
  checkpoint?: CheckpointResume;
};

/** The transcript rows and captured request a failed turn owns. */
export type LastExchange = Omit<ChatTurnOptions, 'resume'> & {
  text: string;
  /** Sent again as it was: a retry is about the same place in the text. */
  context?: AgentChatContext;
  attachments?: ChatAttachment[];
  /** A server chat preset the turn ran, sent again with it. */
  preset?: string;
  userMessageId: string;
  assistantMessageId: string;
  run?: ResumeAgentRun;
};

/** The server keeps at most this many referenced blocks. */
const MAX_CONTEXT_BLOCK_IDS = 20;

/**
 * What the assistant should know about where the author is working: the
 * caret's block, the selection, and the blocks the message references as
 * `#this/<id>`. Undefined when there is nothing to say.
 */
export function agentContext(text: string, focus: EditorFocus | null): AgentChatContext | undefined {
  const referenced = [
    ...new Set(
      extractRefSpans(text)
        .filter((ref) => ref.kind === 'block' && ref.source === 'this' && ref.blockId)
        .map((ref) => ref.blockId as string),
    ),
  ].slice(0, MAX_CONTEXT_BLOCK_IDS);
  const context: AgentChatContext = {};
  if (focus) {
    context.block_id = focus.blockId;
    if (focus.selection) context.selection = { block_id: focus.blockId, text: focus.selection };
  }
  if (referenced.length) context.block_ids = referenced;
  return Object.keys(context).length ? context : undefined;
}

export function friendlyStreamError(code: string, message: string): ChatError {
  switch (code) {
    case 'AGENT_BUDGET_EXCEEDED':
      return {
        message:
          'The assistant hit its work limit for this reply and stopped early. What it produced so far is above — ask again to continue.',
        detail: message || code,
        retryable: true,
      };
    case 'ATTACHMENT_MODEL_UNSUPPORTED':
    case 'ATTACHMENT_UNAVAILABLE':
    case 'ATTACHMENT_INVALID':
    case 'ATTACHMENT_LIMIT':
      return { message: message || 'Update the attachments before sending again.', detail: code, retryable: false };
    case 'DOCUMENT_NOT_FOUND':
      return {
        message: 'The assistant could not find this page on the server.',
        detail: message || code,
        retryable: false,
      };
    // The account left the workspace during the run (removed, or the
    // workspace deleted): the run stopped at its next step (M6). Asking
    // again cannot help; the app moves on once it reads the workspace.
    case 'no_workspace_context':
    case 'workspace_not_found':
      return {
        message: 'This workspace is no longer available to you, so the assistant stopped. You may have been removed from it, or it was deleted.',
        detail: message || code,
        retryable: false,
      };
    case 'no_document_context':
      return {
        message: 'This page is no longer available, so the assistant stopped. It may have been moved to the Trash.',
        detail: message || code,
        retryable: false,
      };
    // A page created after the run read outside material (a PDF, a paper, a
    // web page, a worker's report) would be saved without review: refused.
    case 'untrusted_content':
      return {
        message: 'The assistant read outside material in this run, so it can propose changes but not create pages. Start a new message to create one.',
        detail: message || code,
        retryable: false,
      };
    // A demotion to viewer during the run: what needed the editor role was refused.
    case 'workspace_role_required':
      return {
        message: 'Your role in this workspace changed: you can ask the assistant about this page, but it can’t edit it for you.',
        detail: message || code,
        retryable: false,
      };
    // The page was stored in a format this server cannot read, so no run on
    // it can start until the page is converted.
    case 'DOCUMENT_SCHEMA_UNSUPPORTED':
      return {
        message: 'This page was saved by a newer version of ColWrite, so the assistant cannot read it.',
        detail: message || code,
        retryable: false,
      };
    // The local Claude Code / Codex engines. The server's message says what
    // to do (which login command to run, for instance); repeating the same
    // request cannot help until the author has done it.
    case 'ENGINE_AUTH_REQUIRED':
    case 'ENGINE_LOCAL_ONLY':
    case 'ENGINE_NOT_INSTALLED':
    case 'ENGINE_INVALID_MODEL':
    case 'ENGINE_UNSAFE_TOOLS':
      return {
        message: `${message || 'The selected agent engine cannot run.'} You can switch engines from the menu next to the # button, or in Settings → AI & tools.`,
        detail: code,
        retryable: false,
      };
    case 'ENGINE_RATE_LIMITED':
      return {
        message: message || 'The selected engine reached its plan’s usage limit.',
        detail: code,
        retryable: true,
      };
    // Any other failure of a local CLI: the CLI's own words ("Claude Code
    // failed: …"), which can quote a tool's error or a provider's body, so
    // they are the detail, not the sentence. A status code inside them is
    // not a sign-in or a plan limit; those come as their own codes.
    case 'ENGINE_FAILED':
      return {
        message:
          'The selected engine stopped with an error. Try again; if it keeps failing, switch engines from the menu next to the # button, or in Settings → AI & tools.',
        detail: message || code,
        retryable: true,
      };
    // The hosted model service. Its credentials and credit are the site's,
    // not the author's, so there is nothing to retry until an administrator
    // has acted; a refused request needs a different request.
    case 'MODEL_GATEWAY_AUTH':
    case 'MODEL_GATEWAY_BILLING':
      return {
        message: message || 'The assistant’s model service is unavailable. This needs the site administrator.',
        detail: code,
        retryable: false,
      };
    case 'MODEL_GATEWAY_REJECTED':
      return {
        message:
          message || 'The model refused this request. Try a shorter message, fewer attachments or a new conversation.',
        detail: code,
        retryable: false,
      };
    case 'MODEL_NOT_CONFIGURED':
      return {
        message: message || 'The selected model is no longer configured. Choose a model again in Settings → AI & tools.',
        detail: code,
        retryable: false,
      };
    // The conversation, the document and the attachments together are more
    // than the assistant can read, even after it condensed what it could.
    // Sending the same thing again ends the same way.
    case 'MODEL_GATEWAY_CONTEXT':
    case 'MODEL_CONTEXT_TOO_LARGE':
      return {
        message:
          message ||
          'This conversation is too large for the assistant. Start a new conversation or remove large attachments, then ask again.',
        detail: code,
        retryable: false,
      };
    case 'MODEL_GATEWAY_RATE_LIMITED':
    case 'MODEL_GATEWAY_TRANSIENT':
    case 'MODEL_GATEWAY_INTERRUPTED':
      return {
        message: message || 'The assistant’s model is not responding right now. Try again shortly.',
        detail: code,
        retryable: true,
      };
    // A deep run from a plan (TD5): the plan is finished, discarded or
    // superseded, or it was edited from an older revision. Sending the same
    // request again ends the same way; the plan as it stands is the one to run.
    case 'PLAN_NOT_FOUND':
      return {
        message: 'That plan is no longer open: it was finished, discarded or replaced by a newer one. Ask for a new plan, or run the newest one.',
        detail: message || code,
        retryable: false,
      };
    case 'STALE_PLAN':
      return {
        message: 'The plan changed since this run started from it. Open the plan again and run its newest version.',
        detail: message || code,
        retryable: false,
      };
    // `runs.resume`: no checkpoint, or the run's tools changed since (a
    // switch, the policy, the role).
    case 'RUN_NOT_RESUMABLE':
    case 'run_not_resumable':
      return {
        message: 'This run can’t be resumed from where it stopped. Ask again to start it afresh.',
        detail: message || code,
        retryable: true,
      };
    // The run's own endings, reported by the durable session.
    case 'AGENT_CANCELLED':
      return { message: message || 'The assistant was stopped.', detail: code, retryable: true };
    case 'AGENT_INTERRUPTED':
    case 'AGENT_FAILED':
      return {
        message: 'The assistant stopped before it finished. What it wrote so far is above; try again to continue.',
        detail: message || code,
        retryable: true,
      };
    default:
      return {
        // The server writes these messages for people now; an empty one is a
        // dropped payload, not a sentence to show.
        message: message || 'The assistant hit an unexpected error while replying.',
        detail: code || undefined,
        retryable: true,
      };
  }
}

export function emptyMessage(role: string, content = '', attachments?: ChatAttachment[], runId?: string | null): ChatMessage {
  return { id: uid(), role, content, ...(attachments?.length ? { attachments } : {}), ...(runId ? { runId } : {}), runs: [], changeSetIds: [] };
}

/** A stored message as `GET …/messages` answers it, as far as the transcript reads it. */
export type StoredChatMessage = Pick<WireChatMessage, 'role' | 'content' | 'run_id' | 'created_at' | 'record'> & {
  attachments?: ChatAttachment[];
};

/** One call of a stored reply, as the activity list shows it: a call the turn stopped while it ran is interrupted. */
function recordedRun(call: RecordToolCall, index: number): ToolRun {
  return {
    id: call.tool_call_id || `${call.tool}:recorded-${index}`,
    tool: call.tool,
    state: !call.finished ? 'interrupted' : call.is_error ? 'error' : 'done',
    ...(call.duration_ms !== null ? { durationMs: call.duration_ms } : {}),
    ...(call.error ? { error: call.error } : {}),
    ...(call.error_type ? { errorType: call.error_type } : {}),
    ...(call.arguments ? { args: call.arguments } : {}),
    outputChars: call.output_chars,
    outputTruncated: call.output_truncated,
  };
}

/**
 * A stored reply as it was shown: its activity, sources, tasks, workers and
 * change sets, the models that served it, its usage and cost against its
 * ceiling, and how it ended (a limit it answered at included), from the
 * record the server kept with it.
 */
function withRecord(message: ChatMessage, record: ReplyRecord): ChatMessage {
  const paused = record.change_sets.find((set) => set.apply_policy === 'review' && set.auto_blocked_reason)?.auto_blocked_reason;
  const sources = decodeSources(record.sources);
  const passages = decodePassages(record.passages);
  const claims = decodeClaims(record.claims);
  const plan = decodePlan(record.plan);
  const question = decodeQuestion(record.question);
  return {
    ...message,
    ...(claims.length ? { claims } : {}),
    ...(plan ? { plan } : {}),
    ...(question ? { question } : {}),
    artifacts: record.artifacts.flatMap((value) => decodeArtifact(value) ?? []),
    runs: record.tool_calls.map(recordedRun),
    changeSetIds: [...new Set(record.change_sets.map((set) => set.change_set_id))],
    ...(sources.length ? { sources } : {}),
    ...(passages.length ? { passages } : {}),
    ...(record.tasks.length ? { todos: record.tasks } : {}),
    ...(record.workers.length ? { workers: record.workers.map((worker) => ({ ...worker })) } : {}),
    skills: record.skills.flatMap((value) => {
      const skill = decodeSkill(value);
      return skill ? [skill] : [];
    }),
    instructions: decodeInstructions(record.instructions),
    usage: {
      promptTokens: record.usage.prompt_tokens,
      completionTokens: record.usage.completion_tokens,
      cachedTokens: record.usage.cached_tokens,
    },
    ...(record.models.length ? { models: record.models } : {}),
    cost: record.cost,
    budget: { costLimit: record.cost_limit, limitReached: record.limit_reached },
    ...(paused ? { autoPaused: paused } : {}),
    ...(record.status === 'completed' ? {} : { ended: record.status }),
    ...(record.status === 'failed' && record.error ? { failure: record.error } : {}),
  };
}

/**
 * A stored branch as transcript rows, with when each was written, each
 * reply rebuilt from its record so a reload shows the reply the author saw.
 *
 * A reply's duration is the gap to its question only when one run wrote
 * both: a regenerated answer hangs under the original question, so its gap
 * would count the time between the two runs.
 */
export function historyMessages(items: readonly StoredChatMessage[]): ChatMessage[] {
  return items.map((item, index) => {
    let message = emptyMessage(item.role, item.content, item.attachments, item.run_id);
    if (item.role === 'assistant' && item.record?.kind === 'reply') message = withRecord(message, item.record);
    if (item.role === 'user' && item.record?.kind === 'request') {
      if (item.record.preset) message.preset = item.record.preset;
      if (item.record.effort) message.effort = item.record.effort;
      message.web = item.record.web;
      if (item.record.plan_id) message.planId = item.record.plan_id;
    }
    const createdAt = item.created_at ? Date.parse(item.created_at) : Number.NaN;
    if (Number.isNaN(createdAt)) return message;
    message.createdAt = createdAt;
    const question = items[index - 1];
    if (item.role === 'assistant' && question?.role === 'user' && item.run_id && question.run_id === item.run_id) {
      const askedAt = question.created_at ? Date.parse(question.created_at) : Number.NaN;
      if (!Number.isNaN(askedAt) && createdAt >= askedAt) message.durationMs = createdAt - askedAt;
    }
    return message;
  });
}
