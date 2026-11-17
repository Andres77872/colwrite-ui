import type {
  AssistantEvent,
  ArtifactData,
  BudgetData,
  ClaimData,
  CommentData,
  DoneData,
  ErrorCode,
  ErrorData,
  EvidenceData,
  EvidencePassage,
  EvidenceSource,
  PlanData,
  QuestionData,
  ServedModel,
  SkillData,
  InstructionSource,
  StatusData,
  SubagentData,
  TodoItem,
  ToolActionData,
  ToolCallArgsData,
  ToolCallEndData,
  ToolCallStartData,
  ToolDisplay,
} from '@/api/schema';
import type {
  ApplyPolicy,
  AutoBlockedReason,
  ReferenceRecord,
  ToolAction,
  ToolOperation,
  ToolOperationResult,
} from '@/editor/types';
import { referenceRecordOf } from '@/api/content';
import { isUnknownRecord } from '@/lib/json';
import { itemAt } from '@/lib/itemAt';
import { SOURCE_HANDLE } from '@/lib/sourceHandles';
import { noteUnknownInput } from './protocolLog';

// ── Event handler types ──
export type AgentSkill = SkillData;
export type AgentInstruction = InstructionSource;

export function decodeInstructions(value: unknown): AgentInstruction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (!isUnknownRecord(item) || !['page', 'section'].includes(String(item.scope))
      || typeof item.label !== 'string' || (item.scope === 'section' && typeof item.block_id !== 'string')) return [];
    return [{ scope: item.scope as AgentInstruction['scope'], label: item.label,
      block_id: typeof item.block_id === 'string' ? item.block_id : null }];
  });
}

export function decodeSkill(value: unknown): AgentSkill | null {
  if (!isUnknownRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.label !== 'string'
    || typeof value.version !== 'string' || !['tools', 'preset', 'document_type', 'review', 'read'].includes(String(value.by))) return null;
  return { id: value.id, label: value.label, version: value.version,
    resource: typeof value.resource === 'string' ? value.resource : null, by: value.by as AgentSkill['by'] };
}

/**
 * Everything the server knows about a finished tool call.
 *
 * `error`/`errorType` are set when the call failed; `outputPreview` is a
 * bounded slice of what the tool returned; `arguments` is the complete parsed
 * input when it fits the wire budget, with `argumentsPreview` always present
 * as a capped JSON string.
 */
export type ToolCallEndEvent = {
  tool: string;
  toolCallId: string;
  durationMs: number;
  isError: boolean;
  error: string | null;
  errorType: string | null;
  outputPreview: string | null;
  outputChars: number;
  outputTruncated: boolean;
  arguments?: Record<string, unknown>;
  argumentsPreview: string;
  argumentsTruncated: boolean;
};

/**
 * The complete parsed arguments for a running tool call.
 *
 * `tool_call_start` fires from the first streamed token of the call, before
 * the model has finished writing its arguments — this event follows once the
 * server actually starts executing, carrying what the tool really received.
 */
export type ToolCallArgsEvent = {
  tool: string;
  toolCallId: string;
  arguments?: Record<string, unknown>;
  argumentsPreview: string;
  argumentsTruncated: boolean;
};

/**
 * A work the conversation may cite, as the `evidence` event and a reply's
 * record carry it (`ColWrite-api/docs/assistant-events.md#evidence`): its
 * `handle` (`S3`), which lasts for the conversation, the canonical `key`, its
 * evidence `kind`, `title`, reference `state` and `flags`, the `provider` its
 * record came from, and `record`, the reference as the page's library holds
 * it (`ReferenceRecord`), which is what Cite, Add to sources and an inserted
 * citation are built from.
 */
export type AgentSource = Omit<EvidenceSource, 'record'> & { record: ReferenceRecord };
/** An excerpt a call stored (`S3.2`), with how much of the work the server holds; its text never crosses the wire. */
export type AgentPassage = EvidencePassage;
/** What one `evidence` event registered: the sources the call touched and the passages it stored. */
export type AgentEvidence = { sources: AgentSource[]; passages: AgentPassage[] };

/**
 * Sources merged as the protocol has them: each handle once, where it first
 * arrived, and a later entry with the same handle replaces the earlier one
 * (a better key, a fuller record of the same work). An entry equal to the
 * one held, as a replayed stream sends it, changes nothing. `changed` is
 * what the merge added or replaced, the last of each handle.
 */
export function mergeSources(
  held: readonly AgentSource[],
  incoming: readonly AgentSource[],
): { sources: AgentSource[]; changed: AgentSource[] } {
  const sources = [...held];
  const at = new Map(sources.map((source, index) => [source.handle, index]));
  const changed = new Map<string, AgentSource>();
  for (const source of incoming) {
    const index = at.get(source.handle);
    if (index === undefined) {
      at.set(source.handle, sources.length);
      sources.push(source);
    } else if (sameJson(itemAt(sources, index), source)) {
      continue;
    } else {
      sources[index] = source;
    }
    changed.set(source.handle, source);
  }
  return { sources, changed: [...changed.values()] };
}

/** Passages merged by id: the same excerpt read again names the same passage. `changed` is what was new. */
export function mergePassages(
  held: readonly AgentPassage[],
  incoming: readonly AgentPassage[],
): { passages: AgentPassage[]; changed: AgentPassage[] } {
  const known = new Map(held.map((item) => [item.id, item]));
  const changed: AgentPassage[] = [];
  for (const item of incoming) {
    if (known.get(item.id)?.level === item.level) continue;
    known.set(item.id, item);
    changed.push(item);
  }
  return changed.length ? { passages: [...known.values()], changed } : { passages: [...held], changed };
}

/** Two decoded JSON values, compared by value. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  }
  if (!isUnknownRecord(a) || !isUnknownRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}

const EVIDENCE_KINDS = new Set<AgentSource['kind']>(['paper', 'preprint', 'book', 'web', 'pdf', 'page', 'dataset', 'other']);
const SOURCE_STATES = new Set<AgentSource['state']>(['verified', 'needs_review', 'not_found', 'unchecked']);
const PASSAGE_LEVELS = new Set<AgentPassage['level']>(['full_text', 'abstract', 'snippet', 'metadata']);
/** `S3.2`: the second passage of `S3`. */
const PASSAGE_ID = /^S[1-9]\d{0,4}\.[1-9]\d{0,4}$/;
/**
 * Keep only well-formed sources; the event is untrusted like any other, and
 * so is a reply record's copy of what it sent. A source is kept when its
 * record is a reference (`referenceRecordOf`); a kind this client does not
 * know is `other`, a state it does not know `unchecked`, and a flag it does
 * not know is dropped.
 */
export function decodeSources(raw: readonly unknown[]): AgentSource[] {
  const out: AgentSource[] = [];
  for (const entry of raw) {
    if (!isUnknownRecord(entry)) continue;
    if (typeof entry.handle !== 'string' || !SOURCE_HANDLE.test(entry.handle)) continue;
    if (typeof entry.key !== 'string' || !entry.key) continue;
    const record = referenceRecordOf(entry.record);
    if (!record) continue;
    out.push({
      handle: entry.handle,
      key: entry.key,
      kind: EVIDENCE_KINDS.has(entry.kind as AgentSource['kind']) ? (entry.kind as AgentSource['kind']) : 'other',
      title: typeof entry.title === 'string' && entry.title ? entry.title : record.csl.title,
      state: SOURCE_STATES.has(entry.state as AgentSource['state']) ? (entry.state as AgentSource['state']) : 'unchecked',
      flags: strings(entry.flags),
      provider: typeof entry.provider === 'string' && entry.provider ? entry.provider : record.provider,
      record,
    });
  }
  return out;
}

/** Keep only well-formed passages: an id under a handle, and a level this client knows. */
export function decodePassages(raw: readonly unknown[]): AgentPassage[] {
  return raw.flatMap((entry): AgentPassage[] => (
    isUnknownRecord(entry) && typeof entry.id === 'string' && PASSAGE_ID.test(entry.id)
      && PASSAGE_LEVELS.has(entry.level as AgentPassage['level'])
      ? [{ id: entry.id, level: entry.level as AgentPassage['level'] }]
      : []
  ));
}

/* ----------------------------------------
   Claims, plans, questions and the ledger (P2.API-5, P3)
   ---------------------------------------- */

export type EvidenceLevel = AgentPassage['level'];
export type ClaimVerdict = ClaimData['verdict'];
export type ClaimStance = ClaimData['passages'][number]['stance'];

/**
 * A claim check's verdict (`claim`): what the judge made of the passages it
 * read, each a passage of the conversation's evidence store (`S3.2`) whose
 * source the reply holds. The claim's words and the passages' text are not
 * sent (TD34); the card shows the verdict with the sources.
 */
export type AgentClaim = {
  toolCallId: string;
  verdict: ClaimVerdict;
  /** The level of the best passage the verdict rests on; `null` with no passage. */
  evidenceLevel: EvidenceLevel | null;
  /** `insufficient` with no full-text passage: "Cannot assess without the full text". */
  cannotAssess: boolean;
  passages: Array<{ id: string; level: EvidenceLevel; stance: ClaimStance }>;
};

const VERDICTS = new Set<ClaimVerdict>(['supported', 'partly', 'contradicted', 'insufficient']);
const STANCES = new Set<ClaimStance>(['supports', 'limits', 'contradicts', 'unrelated']);

/** One claim check, or `null` for a payload that is not one. */
export function decodeClaim(raw: unknown): AgentClaim | null {
  if (!isUnknownRecord(raw) || typeof raw.tool_call_id !== 'string' || !VERDICTS.has(raw.verdict as ClaimVerdict)) return null;
  const passages = Array.isArray(raw.passages)
    ? raw.passages.flatMap((entry): AgentClaim['passages'] => (
        isUnknownRecord(entry) && typeof entry.id === 'string' && PASSAGE_ID.test(entry.id)
          && PASSAGE_LEVELS.has(entry.level as EvidenceLevel) && STANCES.has(entry.stance as ClaimStance)
          ? [{ id: entry.id, level: entry.level as EvidenceLevel, stance: entry.stance as ClaimStance }]
          : []
      ))
    : [];
  return {
    toolCallId: raw.tool_call_id,
    verdict: raw.verdict as ClaimVerdict,
    evidenceLevel: PASSAGE_LEVELS.has(raw.evidence_level as EvidenceLevel) ? (raw.evidence_level as EvidenceLevel) : null,
    cannotAssess: raw.cannot_assess === true,
    passages,
  };
}

/** The claim checks a reply record kept (`claims`, at most 50), well-formed ones only. */
export function decodeClaims(raw: unknown): AgentClaim[] {
  return Array.isArray(raw) ? raw.slice(0, 50).flatMap((entry) => decodeClaim(entry) ?? []) : [];
}

/** The conversation's plan as a `plan` event sends it (TD5). Kept on the turn; its card is P3's. */
export type AgentPlan = PlanData;
/** The questions `author_ask` put to the author (`question`). Kept on the turn; its card is P3's. */
export type AgentQuestion = QuestionData;
export type AgentArtifact = ArtifactData;

const GENERATION_STATES = new Set<AgentArtifact['status']>(['proposed', 'confirmed', 'running', 'succeeded', 'failed', 'refused', 'unknown', 'discarded']);
export function decodeArtifact(raw: unknown): AgentArtifact | null {
  if (!isUnknownRecord(raw) || !['image_request', 'image'].includes(String(raw.kind))
      || typeof raw.generation_id !== 'string' || !/^gen-[0-9a-f-]{36}$/.test(raw.generation_id)
      || !GENERATION_STATES.has(raw.status as AgentArtifact['status'])) return null;
  return {
    kind: raw.kind as AgentArtifact['kind'], generation_id: raw.generation_id, status: raw.status as AgentArtifact['status'],
    asset_id: nonEmpty(raw.asset_id), prompt: nonEmpty(raw.prompt), aspect_ratio: nonEmpty(raw.aspect_ratio),
    estimated_cost: costOf(raw.estimated_cost), generator: nonEmpty(raw.generator),
  };
}
/** The run's ledger when a counter crossed two thirds of its limit, or reached it (`budget`). */
export type AgentBudgetUpdate = BudgetData;

const PLAN_KINDS = new Set<PlanData['kind']>(['outline', 'research', 'review']);
const PLAN_STATES = new Set<PlanData['state']>(['proposed', 'running', 'stopped', 'done', 'discarded', 'superseded']);
const SECTION_STATES = new Set<PlanData['sections'][number]['state']>(['pending', 'working', 'proposed', 'needs_attention']);

/** A plan, or `null` for a payload that is not one; a state this client does not know is the plan's first. */
export function decodePlan(raw: unknown): AgentPlan | null {
  if (!isUnknownRecord(raw) || typeof raw.plan_id !== 'string' || !raw.plan_id) return null;
  const sections = Array.isArray(raw.sections)
    ? raw.sections.flatMap((entry): PlanData['sections'] => (
        isUnknownRecord(entry) && typeof entry.id === 'string' && typeof entry.title === 'string'
          ? [{
              id: entry.id,
              title: entry.title,
              goal: typeof entry.goal === 'string' ? entry.goal : '',
              sources: strings(entry.sources),
              state: SECTION_STATES.has(entry.state as PlanData['sections'][number]['state'])
                ? (entry.state as PlanData['sections'][number]['state'])
                : 'pending',
            }]
          : []
      ))
    : [];
  return {
    plan_id: raw.plan_id,
    kind: PLAN_KINDS.has(raw.kind as PlanData['kind']) ? (raw.kind as PlanData['kind']) : 'outline',
    brief: typeof raw.brief === 'string' ? raw.brief : '',
    sections,
    open_questions: strings(raw.open_questions),
    effort: (EFFORTS.has(raw.effort as string) ? raw.effort : 'deep') as PlanData['effort'],
    revision: typeof raw.revision === 'number' && Number.isFinite(raw.revision) ? raw.revision : 0,
    state: PLAN_STATES.has(raw.state as PlanData['state']) ? (raw.state as PlanData['state']) : 'proposed',
  };
}

/** A question card, or `null`: at most three questions, each with at most four options. */
export function decodeQuestion(raw: unknown): AgentQuestion | null {
  if (!isUnknownRecord(raw) || typeof raw.question_id !== 'string' || !raw.question_id || !Array.isArray(raw.questions)) return null;
  const questions = raw.questions.flatMap((entry): QuestionData['questions'] => (
    isUnknownRecord(entry) && typeof entry.id === 'string' && typeof entry.text === 'string' && entry.text
      ? [{ id: entry.id, text: entry.text, options: strings(entry.options).slice(0, 4), allow_free_text: entry.allow_free_text === true }]
      : []
  )).slice(0, 3);
  return questions.length > 0 ? { question_id: raw.question_id, questions } : null;
}

export type AgentTodo = TodoItem;
export type AgentWorker = OpenStatus<SubagentData>;

const WORKER_PROFILES = new Set<SubagentData['profile']>(['web_researcher', 'library_reader', 'reviewer']);

/** The complete typed brief carried by every worker status, never an old id-only record. */
function workerOf(data: Record<string, unknown>): AgentWorker | null {
  if (
    typeof data.id !== 'string' || !data.id || typeof data.status !== 'string'
    || typeof data.engine !== 'string' || typeof data.title !== 'string'
    || typeof data.objective !== 'string' || !WORKER_PROFILES.has(data.profile as SubagentData['profile'])
  ) return null;
  return {
    id: data.id, status: data.status, engine: data.engine,
    profile: data.profile as SubagentData['profile'], title: data.title, objective: data.objective,
  };
}

/** Tokens a turn used, summed over every model call it made (its workers' and tools' included). */
export type AgentUsage = { promptTokens: number; completionTokens: number; cachedTokens: number };
/** One model that served a turn: its gateway tier, whether a fallback reached it, its calls, tokens and cost. */
export type AgentServedModel = ServedModel;

/**
 * What a reply says of its run's ledger (`done.budget`), the two its stored
 * record keeps too (`cost_limit`, `limit_reached`): the run's cost ceiling
 * (`null` for none), and the first limit it reached (`model_calls`,
 * `tool_calls`, `cost`, `events`, `wall_clock`), after which its next model
 * call was its answer. The counters, which nothing shows, stay in `done`.
 */
export type AgentBudget = {
  costLimit: number | null;
  limitReached: string | null;
};
/** Writes of the run's own records that failed and were dropped (`message`, `llm_call`, …). */
export type AgentPersistence = { failedWrites: number; kinds: string[] };

/** How a turn ended well (`done`): where it was stored, what served it, what it used and cost, and its ledger. */
export type AgentDone = {
  chatId: string | null;
  messageId: number | null;
  usage: AgentUsage;
  models: AgentServedModel[];
  /** In USD, over the calls whose provider reported one; `null` when none did (a CLI engine). */
  cost: number | null;
  budget: AgentBudget | null;
  persistence: AgentPersistence | null;
};

/**
 * The model is still writing a tool call's arguments (a long `doc_edit` can
 * take a minute). Only their running length crosses the wire.
 */
export type ToolCallProgressEvent = {
  tool: string;
  toolCallId: string;
  argumentsChars: number;
};

export type AgentEventHandlers = {
  /** Shared review notes were stored; reread the page's comments and summary. */
  onComments?: (comments: CommentData['comments']) => void;
  onSkill?: (skill: AgentSkill) => void;
  onInstructions?: (instructions: AgentInstruction[]) => void;
  onSessionChat?: (chatId: string) => void;
  onTodo?: (items: AgentTodo[]) => void;
  onSubagent?: (worker: AgentWorker) => void;
  onToken?: (content: string) => void;
  /**
   * A fragment of the model's reasoning, streamed while it thinks. Not part
   * of the answer: it is never in `onToken` and never saved with the chat.
   */
  onReasoning?: (content: string) => void;
  onToolCallProgress?: (event: ToolCallProgressEvent) => void;
  /**
   * What a call registered in the conversation's evidence store, after it
   * ends (and once at a chat run's start for its attached PDFs): the
   * sources it touched and the passages it stored.
   */
  onEvidence?: (evidence: AgentEvidence) => void;
  onStatus?: (status: string, detail: string) => void;
  /**
   * The run's effective apply policy, from its `status` events (D18): `auto`
   * when the server granted Auto for it, otherwise `review` with the reason
   * when the request asked for Auto.
   */
  onApplyPolicy?: (policy: ApplyPolicy, blockedReason: AutoBlockedReason | null) => void;
  /** A call began. Its arguments come later (`onToolCallArgs`); `display` names it for a client whose catalog lacks the tool. */
  onToolCallStart?: (tool: string, toolCallId: string, display: ToolDisplay | null) => void;
  onToolCallArgs?: (event: ToolCallArgsEvent) => void;
  onToolCallEnd?: (event: ToolCallEndEvent) => void;
  onToolAction?: (action: ToolAction) => void;
  /** A claim check's verdict, while its `claim_check` call runs. */
  onClaim?: (claim: AgentClaim) => void;
  /** The conversation's plan, proposed, revised or advanced (kept; P3 shows it). */
  onPlan?: (plan: AgentPlan) => void;
  /** The author is asked; the turn ends there (kept; P3 shows the card). */
  onQuestion?: (question: AgentQuestion) => void;
  onArtifact?: (artifact: AgentArtifact) => void;
  /** A counter crossed two thirds of its limit, or reached it. */
  onBudget?: (budget: AgentBudgetUpdate) => void;
  onError?: (errorCode: string, message: string) => void;
  onDone?: (done: AgentDone) => void;
};

/* ----------------------------------------
   Decoding: untrusted frames into the generated `AssistantEvent`
   ---------------------------------------- */

/**
 * A status the client treats as open: a newer server may add one, and the
 * client shows an unknown run status like `thinking` and an unknown worker
 * status as sent (`ColWrite-api/docs/assistant-events.md`).
 */
type OpenStatus<T extends { status: string }> = Omit<T, 'status'> & { status: T['status'] | (string & {}) };

/** `AssistantEvent`, with the statuses a newer server may extend kept open. */
export type DecodedAgentEvent =
  | Exclude<AssistantEvent, { event: 'status' } | { event: 'subagent' }>
  | { event: 'status'; data: OpenStatus<StatusData> }
  | { event: 'subagent'; data: OpenStatus<SubagentData> };

export type AgentEventName = AssistantEvent['event'];
type DataOf<E extends AgentEventName> = Extract<DecodedAgentEvent, { event: E }>['data'];

/** `String(undefined)` is `"undefined"`, which reads as a real id downstream. */
function optionalString(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return candidate;
    if (typeof candidate === 'number') return String(candidate);
  }
  return '';
}

/** A field the handlers read as text, whatever the payload put there. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

const APPLY_POLICIES = new Set<ApplyPolicy>(['review', 'auto']);
/** Every reason the contract has: a new one fails the build until it is listed here. */
const AUTO_BLOCKED_REASONS: Record<AutoBlockedReason, true> = {
  role: true,
  policy: true,
  untrusted_content: true,
};

function applyPolicyOf(value: unknown): ApplyPolicy | null {
  return APPLY_POLICIES.has(value as ApplyPolicy) ? (value as ApplyPolicy) : null;
}

function blockedReasonOf(value: unknown): AutoBlockedReason | null {
  return typeof value === 'string' && Object.hasOwn(AUTO_BLOCKED_REASONS, value) ? (value as AutoBlockedReason) : null;
}

/**
 * Only a `proposed` batch is something to decide on, and unknown or missing
 * means `proposed`: the safe guess asks the author to confirm something;
 * guessing `applied` would let a payload edit their work unseen.
 */
const TOOL_ACTION_STATUSES = new Set<ToolActionData['status']>(['proposed', 'applied', 'error']);
const RUN_STATUSES = new Set(['queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled', 'interrupted']);
const TODO_STATUSES = new Set<TodoItem['status']>(['pending', 'in_progress', 'completed']);

function argumentsOf(value: unknown): Record<string, unknown> | null {
  return isUnknownRecord(value) ? value : null;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/** A tool's display, as its start carries it; anything short of one is none. */
function displayOf(value: unknown): ToolDisplay | null {
  if (!isUnknownRecord(value) || typeof value.label !== 'string' || typeof value.running_label !== 'string') return null;
  return {
    label: value.label,
    running_label: value.running_label,
    icon: typeof value.icon === 'string' ? value.icon : '',
    detail_templates: strings(value.detail_templates),
    value_labels: valueLabels(value.value_labels),
  };
}

/** A display's words for the values of its enum placeholders: `{placeholder: {value: words}}`. */
function valueLabels(value: unknown): ToolDisplay['value_labels'] {
  if (!isUnknownRecord(value)) return {};
  const out: ToolDisplay['value_labels'] = {};
  for (const [placeholder, words] of Object.entries(value)) {
    if (!isUnknownRecord(words)) continue;
    out[placeholder] = Object.fromEntries(Object.entries(words).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  }
  return out;
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
const costOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

function servedModels(value: unknown): ServedModel[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isUnknownRecord).flatMap((model): ServedModel[] => (
    typeof model.model === 'string' && model.model
      ? [{
          model: model.model,
          tier: typeof model.tier === 'string' ? model.tier : 'main',
          calls: count(model.calls),
          fallback: model.fallback === true,
          prompt_tokens: count(model.prompt_tokens),
          completion_tokens: count(model.completion_tokens),
          cost: costOf(model.cost),
        }]
      : []
  ));
}

const EFFORTS = new Set(['quick', 'standard', 'deep']);
const TRUST_LABELS = new Set(['untrusted', 'private']);

/** A `done`'s ledger; anything short of one is none. */
function budgetOf(value: unknown): DoneData['budget'] {
  if (!isUnknownRecord(value) || !isUnknownRecord(value.counters)) return null;
  const counters = Object.fromEntries(
    Object.entries(value.counters).flatMap(([name, counter]) => (
      isUnknownRecord(counter) && typeof counter.used === 'number'
        ? [[name, { used: count(counter.used), limit: typeof counter.limit === 'number' ? counter.limit : null }]]
        : []
    )),
  );
  return {
    // A tier this client does not know is one it shows nothing of.
    effort: (EFFORTS.has(value.effort as string) ? value.effort : 'standard') as NonNullable<DoneData['budget']>['effort'],
    counters,
    cost: costOf(value.cost),
    cost_limit: costOf(value.cost_limit),
    limit_reached: nonEmpty(value.limit_reached),
  };
}

function persistenceOf(value: unknown): DoneData['persistence'] {
  if (!isUnknownRecord(value) || typeof value.failed_writes !== 'number') return null;
  return { failed_writes: count(value.failed_writes), kinds: strings(value.kinds) };
}

/** A `budget` event's ledger, or `null` for one with no counters. */
function budgetEventOf(data: Record<string, unknown>): BudgetData | null {
  return budgetOf(data);
}

/**
 * One reader per event of the contract. Each returns the generated data
 * shape, coercing a field to its declared type where the handlers have always
 * tolerated a sloppy one, or `null` for a payload that carries nothing to act
 * on. Unknown extra fields are dropped.
 */
const DECODERS: { [E in AgentEventName]: (data: Record<string, unknown>) => DataOf<E> | null } = {
  status: (data) => ({
    status: text(data.status),
    detail: text(data.detail),
    apply_policy: applyPolicyOf(data.apply_policy),
    auto_blocked_reason: blockedReasonOf(data.auto_blocked_reason),
  }),
  reasoning: (data) => (typeof data.content === 'string' && data.content ? { content: data.content } : null),
  token: (data) => (typeof data.content === 'string' ? { content: data.content } : null),
  tool_call_start: (data): ToolCallStartData => ({
    tool: text(data.tool),
    tool_call_id: text(data.tool_call_id),
    arguments: argumentsOf(data.arguments) ?? {},
    arguments_preview: typeof data.arguments_preview === 'string' ? data.arguments_preview : '',
    arguments_deferred: data.arguments_deferred === true,
    display: displayOf(data.display),
  }),
  tool_call_progress: (data) => {
    const chars = data.arguments_chars;
    if (typeof chars !== 'number' || !Number.isFinite(chars) || chars < 0) return null;
    return { tool: text(data.tool), tool_call_id: text(data.tool_call_id), arguments_chars: Math.floor(chars) };
  },
  tool_call_args: (data): ToolCallArgsData => ({
    tool: text(data.tool),
    tool_call_id: text(data.tool_call_id),
    arguments: argumentsOf(data.arguments),
    arguments_preview: typeof data.arguments_preview === 'string' ? data.arguments_preview : '',
    arguments_truncated: data.arguments_truncated === true,
  }),
  tool_call_end: (data): ToolCallEndData => ({
    tool: text(data.tool),
    tool_call_id: text(data.tool_call_id),
    duration_ms: typeof data.duration_ms === 'number' ? data.duration_ms : Number(data.duration_ms ?? 0),
    is_error: data.is_error === true,
    error: nonEmpty(data.error),
    // Always a registry code; one a newer registry added reads as "Failed" (`failureLead`).
    error_type: nonEmpty(data.error_type) as ErrorCode | null,
    output_preview: typeof data.output_preview === 'string' ? data.output_preview : null,
    output_chars: typeof data.output_chars === 'number' ? data.output_chars : 0,
    output_truncated: data.output_truncated === true,
    arguments: argumentsOf(data.arguments),
    arguments_preview: typeof data.arguments_preview === 'string' ? data.arguments_preview : '',
    arguments_truncated: data.arguments_truncated === true,
  }),
  tool_action: (data): ToolActionData => ({
    tool: optionalString(data.tool),
    tool_call_id: optionalString(data.tool_call_id),
    actions: Array.isArray(data.actions) ? data.actions.filter(isUnknownRecord) : [],
    operationResults: Array.isArray(data.operationResults) ? data.operationResults.filter(isUnknownRecord) : [],
    // Empty rather than the string "undefined": the review layer compares
    // this against the open page's id, and `"undefined"` matched nothing.
    document_id: optionalString(data.document_id),
    version: Number(data.version ?? 0),
    status: TOOL_ACTION_STATUSES.has(data.status as ToolActionData['status'])
      ? (data.status as ToolActionData['status'])
      : 'proposed',
    message: data.message != null ? String(data.message) : null,
    change_set_id: nonEmpty(data.change_set_id),
    proposal: argumentsOf(data.proposal),
    apply_policy: applyPolicyOf(data.apply_policy),
    auto_blocked_reason: blockedReasonOf(data.auto_blocked_reason),
    // `doc_create` says where its new page landed: beside its source page.
    workspace_id: nonEmpty(data.workspace_id),
    collection_id: typeof data.collection_id === 'number' && Number.isSafeInteger(data.collection_id) ? data.collection_id : null,
  }),
  error: (data): ErrorData => ({
    error_code: text(data.error_code),
    message: text(data.message),
    engine: nonEmpty(data.engine),
    engine_state: nonEmpty(data.engine_state),
    login_command: nonEmpty(data.login_command),
  }),
  done: (data): DoneData => {
    const usage = isUnknownRecord(data.usage) ? data.usage : {};
    return {
      chat_id: data.chat_id !== null && data.chat_id !== undefined ? String(data.chat_id) : null,
      message_id: typeof data.message_id === 'number'
        ? data.message_id
        : data.message_id !== null && data.message_id !== undefined ? Number(data.message_id) : null,
      usage: {
        prompt_tokens: count(usage.prompt_tokens),
        completion_tokens: count(usage.completion_tokens),
        cached_tokens: count(usage.cached_tokens),
      },
      models: servedModels(data.models),
      cost: costOf(data.cost),
      budget: budgetOf(data.budget),
      labels: strings(data.labels).filter((label): label is NonNullable<DoneData['labels']>[number] => TRUST_LABELS.has(label)),
      persistence: persistenceOf(data.persistence),
    };
  },
  todo: (data) => {
    if (!Array.isArray(data.items)) return null;
    const items = data.items.filter((item): item is TodoItem =>
      isUnknownRecord(item) && typeof item.id === 'string' && typeof item.content === 'string'
        && TODO_STATUSES.has(item.status as TodoItem['status']),
    );
    return { items: items.slice(0, 30).map(({ id, content, status }) => ({ id, content, status })) };
  },
  subagent: workerOf,
  'session.chat': (data) => (typeof data.chat_id === 'string' ? { chat_id: data.chat_id } : null),
  'run.status': (data) => (
    RUN_STATUSES.has(data.status as string)
      ? {
          run_id: text(data.run_id),
          status: data.status as DataOf<'run.status'>['status'],
          message: typeof data.message === 'string' ? data.message : null,
        }
      : null
  ),
  claim: (data): ClaimData | null => {
    const claim = decodeClaim(data);
    return claim && {
      tool_call_id: claim.toolCallId,
      verdict: claim.verdict,
      evidence_level: claim.evidenceLevel,
      cannot_assess: claim.cannotAssess,
      passages: claim.passages,
    };
  },
  plan: decodePlan,
  question: decodeQuestion,
  skill: decodeSkill,
  instructions: (data) => Array.isArray(data.items) ? { items: decodeInstructions(data.items) } : null,
  budget: budgetEventOf,
  artifact: decodeArtifact,
  comment: (data) => {
    if (!Array.isArray(data.comments)) return null;
    const comments = data.comments.flatMap((item: unknown) =>
      isUnknownRecord(item) && ['comment_id', 'block_id', 'quote', 'kind', 'severity'].every((key) => typeof item[key] === 'string')
        ? [{ comment_id: String(item.comment_id), block_id: String(item.block_id), quote: String(item.quote), kind: String(item.kind), severity: String(item.severity) }] : []);
    return { comments };
  },
  evidence: (data): EvidenceData | null => {
    const sources = Array.isArray(data.sources) ? decodeSources(data.sources) : [];
    const passages = Array.isArray(data.passages) ? decodePassages(data.passages) : [];
    return sources.length || passages.length ? { sources, passages } : null;
  },
};

/**
 * Read one event of the assistant WebSocket into the generated union, or
 * `null` for an unknown event or a payload that carries nothing to act on.
 */
export function decodeAgentEvent(event: string, payload: unknown): DecodedAgentEvent | null {
  if (!Object.hasOwn(DECODERS, event)) {
    // A newer server's event: skipped, and the run goes on.
    noteUnknownInput('event', event);
    return null;
  }
  if (!isUnknownRecord(payload)) return null;
  const name = event as AgentEventName;
  const data = (DECODERS[name] as (data: Record<string, unknown>) => DataOf<AgentEventName> | null)(payload);
  return data === null ? null : ({ event: name, data } as DecodedAgentEvent);
}

/* ----------------------------------------
   Dispatch
   ---------------------------------------- */

const OPERATION_RESULT_STATUSES = new Set<ToolOperationResult['status']>([
  'applied',
  'skipped',
  'error',
]);

function operationResults(raw: ToolActionData['operationResults']): ToolOperationResult[] | undefined {
  const results: ToolOperationResult[] = [];
  for (const op of raw) {
    const status = op.status;
    if (!OPERATION_RESULT_STATUSES.has(status as ToolOperationResult['status'])) continue;
    results.push({
      op: optionalString(op.op) || 'operation',
      status: status as ToolOperationResult['status'],
      message: op.message != null ? String(op.message) : undefined,
    });
  }
  return results.length > 0 ? results : undefined;
}

/** A `tool_action` in the editor's camelCase `ToolAction` shape. */
function toolAction(data: ToolActionData): ToolAction {
  const count = data.proposal?.operation_count;
  return {
    tool: data.tool,
    toolCallId: data.tool_call_id,
    // Operations stay in the editor's shape; a stored change set's are
    // fetched by id and normalized there (`documentHistory`).
    actions: data.actions as ToolOperation[],
    documentId: data.document_id,
    status: data.status,
    // JSON null becomes undefined: absent, not a message.
    message: data.message ?? undefined,
    operationResults: operationResults(data.operationResults),
    // Durable review workflow: operations are redacted out of the stream and
    // must be fetched from the server by this id.
    changeSetId: data.change_set_id ?? null,
    proposalOperationCount: typeof count === 'number' && Number.isFinite(count) ? count : undefined,
    applyPolicy: data.apply_policy ?? null,
    autoBlockedReason: data.auto_blocked_reason ?? null,
    collectionId: data.collection_id,
  };
}

function argumentFields(data: ToolCallArgsData | ToolCallEndData) {
  return {
    arguments: data.arguments ?? undefined,
    argumentsPreview: data.arguments_preview ?? '',
    argumentsTruncated: data.arguments_truncated === true,
  };
}

/** Hand one decoded event to its handler; the compiler checks every case. */
export function handleAgentEvent(event: DecodedAgentEvent, handlers: AgentEventHandlers): void {
  switch (event.event) {
    case 'token':
      handlers.onToken?.(event.data.content);
      return;
    case 'reasoning':
      handlers.onReasoning?.(event.data.content);
      return;
    case 'tool_call_progress':
      handlers.onToolCallProgress?.({
        tool: event.data.tool,
        toolCallId: event.data.tool_call_id,
        argumentsChars: event.data.arguments_chars,
      });
      return;
    case 'status': {
      const { status, detail, apply_policy: policy, auto_blocked_reason: reason } = event.data;
      if (policy) handlers.onApplyPolicy?.(policy, reason ?? null);
      handlers.onStatus?.(status, detail);
      return;
    }
    case 'tool_call_start':
      handlers.onToolCallStart?.(event.data.tool, event.data.tool_call_id, event.data.display);
      return;
    case 'tool_call_args':
      handlers.onToolCallArgs?.({
        tool: event.data.tool,
        toolCallId: event.data.tool_call_id,
        ...argumentFields(event.data),
      });
      return;
    case 'tool_call_end': {
      const data = event.data;
      handlers.onToolCallEnd?.({
        tool: data.tool,
        toolCallId: data.tool_call_id,
        durationMs: data.duration_ms,
        isError: data.is_error,
        error: data.error,
        errorType: data.error_type,
        outputPreview: data.output_preview,
        outputChars: data.output_chars,
        outputTruncated: data.output_truncated,
        ...argumentFields(data),
      });
      return;
    }
    case 'tool_action':
      handlers.onToolAction?.(toolAction(event.data));
      return;
    case 'evidence':
      // Read again from the generated shape, which keeps a record's fields
      // untyped: what the handlers get is the page's `ReferenceRecord`.
      handlers.onEvidence?.({ sources: decodeSources(event.data.sources), passages: event.data.passages });
      return;
    case 'error':
      handlers.onError?.(event.data.error_code, event.data.message);
      return;
    case 'done': {
      const { chat_id: chatId, message_id: messageId, usage, models, cost, budget, persistence } = event.data;
      handlers.onDone?.({
        chatId,
        messageId,
        usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, cachedTokens: usage.cached_tokens },
        models,
        cost,
        budget: budget && { costLimit: budget.cost_limit, limitReached: budget.limit_reached },
        persistence: persistence && { failedWrites: persistence.failed_writes, kinds: persistence.kinds },
      });
      return;
    }
    case 'todo':
      handlers.onTodo?.(event.data.items);
      return;
    case 'subagent':
      handlers.onSubagent?.({ ...event.data });
      return;
    case 'session.chat':
      handlers.onSessionChat?.(event.data.chat_id);
      return;
    case 'run.status':
      // The session client reads the run's lifecycle itself (`agentSessionChat`).
      return;
    case 'claim': {
      const claim = decodeClaim(event.data);
      if (claim) handlers.onClaim?.(claim);
      return;
    }
    case 'plan':
      handlers.onPlan?.(event.data);
      return;
    case 'question':
      handlers.onQuestion?.(event.data);
      return;
    case 'skill':
      handlers.onSkill?.(event.data);
      return;
    case 'instructions':
      handlers.onInstructions?.(event.data.items);
      return;
    case 'budget':
      handlers.onBudget?.(event.data);
      return;
    case 'comment':
      handlers.onComments?.(event.data.comments);
      return;
    case 'artifact':
      handlers.onArtifact?.(event.data);
      return;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}
