/**
 * The assistant WebSocket (`/api/agent/ws`) for the dev preview and the
 * tests, on MSW's `ws.link`. It keeps the API's session and run semantics
 * (`ColWrite-api/docs/assistant-websocket.md`): a session holds a log of
 * numbered events, a subscriber gets every event after its cursor, a run
 * outlives the connection that started it, a repeated `request_id` returns
 * what the first one made, and a cancel ends the run's producer.
 *
 * Every command but `ping` names its workspace, and a session belongs to the
 * workspace it was created in: through another, it is `session_not_found`.
 * Only this one URL is matched, so Vite's HMR socket and any other socket
 * pass through. Messages are the contract's `AssistantClientMessage` and
 * `AssistantServerMessage` (a reply repeats its command's `method`); a run's
 * events are its `AssistantEvent` union.
 */
import { ws, type WebSocketData } from 'msw';
import { resolveApiPath } from '@/api/url';
import { uid } from '@/lib/uid';
import { questionAnswerText } from '@/lib/questionAnswers';
import { MockAssetError, linkChatAssets, readableAsset, validAssetId } from './assets';
import type {
  AgentChatRequestInput,
  ChatPlan,
  AssistantEvent,
  AssistantRun,
  AssistantRunSummary,
  AssistantServerMessage,
  AssistantSession,
  DoneData,
  ErrorCode,
  ToolDisplay,
  MessageImage,
  MessagePdf,
  RunStatusData,
  StatusData,
  ToolActionData,
} from '@/api/schema';
import {
  FIXTURE_DOCUMENT_ID, PERSONAL_WORKSPACE_ID, PREVIEW_PAPERS, PREVIEW_WEB_PAGES, chatEvidence, chatsOf, contentOf, fixtures, liveWorkspace, recordAnswer, recordQuestion, roleOf,
  messageChain, newestMessage, storeCitations, storePlanSection, storeProposedEdits, workspaceDocument, workspacePolicyOf, type StoredChangeSet,
  type RunPolicy,
} from './fixtures';
import { REGISTRY, permitted, registryTool, resolveRunToolset, skillsForRun } from './assistantCatalog';
import { standingInstructions, type StandingInstruction } from './instructions';
import { beginReview, finishReview, scriptedReviewFindings } from './reviews';
import { proposeGeneration } from './imageGenerations';
import { RunLedger, type LimitReached } from './runLedger';
import { RunEvidence, emptyEvidence, type Work } from './evidence';
import { beginPlan, editPlan, endPlan, MockPlanRefusal, planEvent, planOf, proposePlan, writtenSection } from './plans';
import { FEDUS, LEPIKHIN, VASWANI } from '../fixtureReferences';

/** The works whose checked record the mock's registries hold. */
const CHECKED_WORKS = [FEDUS, LEPIKHIN, VASWANI];
import { TurnRecord, type ReplyStatus } from './turnRecord';

type Json = Record<string, unknown>;
type AgentChatRequest = AgentChatRequestInput;
/** One numbered event of a session's log, as the socket sends it. */
type EventMessage = Extract<AssistantServerMessage, { type: 'event' }>;
/** A command's reply: its method and its result. */
type Reply = Extract<AssistantServerMessage, { method: string; result: unknown }>;
type RunStatus = RunStatusData['status'];
type StoredRun = Omit<AssistantRun, 'status'> & {
  status: RunStatus;
  fingerprint: string;
  events?: AsyncIterator<AssistantEvent>;
  /** Set when the mock is reset: the run stops at its next step and writes nothing more. */
  abandoned?: boolean;
  /** What the run did, kept from its events as they are appended (one sink). */
  record: TurnRecord;
  /** The run's counters, labels and failed writes, which its `done` reports. */
  ledger: RunLedger;
  /** Called once when the run ends, with how it ended. */
  settled: Array<(end: RunEnd) => void | AssistantEvent[]>;
  checkpoint?: boolean;
  startedAt?: string;
  endedAt?: string;
};
/** How a run ended, and what its reply's record holds. */
export type RunEnd = { status: ReplyStatus; record: TurnRecord; ledger: RunLedger };
type StoredSession = { session: AssistantSession; events: EventMessage[]; runs: StoredRun[]; fingerprint: string };

/**
 * What a run's turn is told besides its request: where it runs, and the
 * run's review policy at this moment, which can move from `auto` to
 * `review` partway through. A change set is stored with the policy of when
 * it was made.
 */
export type AssistantTurnContext = {
  workspaceId: string;
  runId: string;
  sessionId?: string;
  afterSeq?: number;
  policy: () => RunPolicy;
  /** The run's tools: those the catalog has on here for the run's profile and engine. */
  tools: ReadonlySet<string>;
  /** Called once the run ends (done, failed or stopped), as the API's hooks store the reply. */
  onSettled: (callback: (end: RunEnd) => void | AssistantEvent[]) => void;
  /** The run reached a limit (its next model call is its answer), as `done.budget.limit_reached` says. */
  reach: (counter: LimitReached) => void;
  /** A write of the run's own records failed and was dropped, as `done.persistence` counts. */
  failWrite: (kind: string) => void;
  resumedFrom?: string;
  instructions: readonly StandingInstruction[];
};
type Connection = {
  send: (data: WebSocketData) => void;
  open: boolean;
  /** The cursor of each session this connection is subscribed to. */
  subscriptions: Map<string, number>;
};

export type AssistantSocketOptions = {
  /** A run's events, after the transport's `run.status` and `starting` status. */
  stream?: (request: AgentChatRequest, context: AssistantTurnContext) => AsyncIterable<AssistantEvent>;
  /** Whether `sessions.create` may open a session on this page of this workspace. */
  documentExists?: (workspaceId: string, id: string) => boolean;
  /** Owns the optional `?fixture=runs` seed; test-specific sockets do not. */
  previewFixtures?: boolean;
};

const terminal = new Set<RunStatus>(['completed', 'failed', 'cancelled', 'interrupted']);

/**
 * The review policy the API gives a run's change sets at its start (D18,
 * `effective_apply_policy`): `auto` when a chat run asked for it with
 * `apply_mode: "auto"`, the account's role allows it (an editor or above)
 * and the workspace's policy allows Auto; `review` otherwise. The tools a run
 * has are no reason to refuse it, and what it reads is no reason to end it:
 * a turn that searches papers or the web, or has a PDF attached, keeps Auto.
 */
export function applyPolicyFor(request: Pick<AgentChatRequest, 'apply_mode' | 'profile' | 'attachments'>, workspaceId: string): 'auto' | 'review' {
  return autoRequested(request) && autoBlockedFor(request, workspaceId) === null ? 'auto' : 'review';
}

/** Why a turn that asked for Auto got `review` at its start: the role first, then the workspace. */
export function autoBlockedFor(request: Pick<AgentChatRequest, 'apply_mode' | 'profile' | 'attachments'>, workspaceId: string): RunPolicy['auto_blocked_reason'] {
  if (!autoRequested(request)) return null;
  if (roleOf(workspaceId) === 'viewer') return 'role';
  return workspacePolicyOf(workspaceId).auto ? null : 'policy';
}

const autoRequested = (request: Pick<AgentChatRequest, 'apply_mode' | 'profile'>) =>
  request.apply_mode === 'auto' && (request.profile ?? 'chat') === 'chat';

/**
 * The server's presets and the profile each runs in, from the registry
 * (`ColWrite-api/src/agent/profiles/presets.py`). The server supplies their
 * instructions; a request names one by id.
 */
const PRESET_PROFILES: ReadonlyMap<string, NonNullable<AgentChatRequest['profile']>> = new Map(REGISTRY.presets.map((preset) => [preset.id, preset.profile]));

/**
 * Why the API's request model refuses a run (`AgentChatRequest`), or `null`:
 * nothing to run, an unknown preset or one of another profile, and an inline
 * run that resumes a chat or asks for Auto.
 */
function requestRefusal(request: AgentChatRequest): string | null {
  if (request.attachments !== undefined) {
    if (!Array.isArray(request.attachments) || request.attachments.length > 8) return 'attachments must contain at most eight references';
    const seen = new Set<string>();
    for (const item of request.attachments) {
      if (!record(item) || !['image', 'resource'].includes(String(item.kind))) return 'unknown attachment kind';
      const field = item.kind === 'image' ? 'asset_id' : 'resource_id';
      if (Object.keys(item).some((key) => key !== 'kind' && key !== field)) return 'attachments contain references only';
      const id = item.kind === 'image' ? item.asset_id : item.resource_id;
      if (field === 'asset_id'
        ? typeof id !== 'string' || !validAssetId(id)
        : typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return 'invalid attachment reference';
      const key = `${item.kind}:${id}`;
      if (seen.has(key)) return 'duplicate attachments are not allowed';
      seen.add(key);
    }
  }
  if (request.profile !== undefined && !['chat', 'inline', 'review'].includes(request.profile)) return 'profile must be chat, inline or review';
  const profile = request.profile ?? 'chat';
  if (profile === 'review') {
    if (!request.review || !['proofread', 'claims', 'sources', 'structure', 'peer_review'].includes(request.review)) return 'a review run needs its review workflow';
    if (request.message?.trim() || request.attachments?.length || request.preset != null || request.context != null) return 'a named review has no message, attachments, preset or inline context';
    if (request.effort != null && request.effort !== 'standard') return 'a review run uses standard effort';
  } else if (request.review != null) return 'review applies only to the review profile';
  if (request.web !== undefined && typeof request.web !== 'boolean') return 'web must be a boolean';
  if (request.message !== undefined && typeof request.message !== 'string') return 'message must be a string';
  if (!request.message?.trim() && !request.attachments?.length && request.preset == null && !request.plan_id && !request.answers && !request.review) {
    return 'a message, an attachment, a preset, a plan or answers are required';
  }
  if (request.preset != null) {
    const presetProfile = PRESET_PROFILES.get(request.preset);
    if (presetProfile === undefined) return `unknown preset '${request.preset}'`;
    if (presetProfile !== profile) return `preset '${request.preset}' runs in the ${presetProfile} profile`;
  }
  if (profile === 'inline' && request.apply_mode === 'auto') return "apply_mode 'auto' is not available to an inline run";
  if (profile === 'inline' && (request.chat_id || request.leaf_id != null)) return 'an inline run cannot resume a chat';
  if (profile === 'inline' && (request.plan_id || request.plan || request.answers)) return 'an inline run has no plan or question card';
  if (profile === 'review' && (request.chat_id || request.leaf_id != null || request.plan_id || request.plan || request.answers || request.apply_mode === 'auto')) return 'a review has no chat, plan, questions or Auto';
  if (request.plan && !request.plan_id) return 'an edited plan needs its plan_id';
  if (request.plan_id && (request.effort !== 'deep' || !request.chat_id)) return 'a plan needs a deep run in its chat';
  return null;
}

const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${fingerprint(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const publicRun = (run: StoredRun): AssistantRun => {
  const { events: _events, fingerprint: _fingerprint, abandoned: _abandoned, record: _record, ledger: _ledger, settled: _settled, ...row } = run;
  return copy(row);
};

/**
 * The tools a run has: the catalog's tools that are on here, for the run's
 * profile, on its engine (`resolve_toolset` reported through the catalog).
 */
function runToolset(workspaceId: string, request: AgentChatRequest) {
  const profile = request.profile ?? 'chat';
  const effort = profile === 'inline' ? 'quick' : request.effort ?? 'standard';
  const tier = effort === 'deep' && !request.plan_id ? 'standard' : effort;
  return resolveRunToolset(profile, {
    account: fixtures.assistant, policy: workspacePolicyOf(workspaceId),
    canEdit: roleOf(workspaceId) !== 'viewer', engine: request.engine ?? 'gateway',
  }, tier, request.web ?? false);
}

/** The research call a scripted turn makes: a paper search where the run has it, else the web, else none. */
function researchTool(tools: ReadonlySet<string>): string | null {
  return ['paper_search', 'web_search'].find((tool) => tools.has(tool)) ?? null;
}

/** The codes this mock answers with; none of them is retryable (`docs/errors.md`). */
type RpcCode = Extract<
  ErrorCode,
  | 'invalid_request'
  | 'workspace_not_found'
  | 'document_not_found'
  | 'chat_not_found'
  | 'session_not_found'
  | 'run_not_resumable'
  | 'run_not_found'
  | 'conflict'
  | 'invalid_cursor'
  | 'method_not_found'
>;
class RpcError extends Error {
  readonly code: RpcCode;
  constructor(code: RpcCode, message: string) { super(message); this.code = code; }
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new RpcError('invalid_request', `${label} is required`);
  return value;
}

/** Every socket mock made, so a reset reaches the ones a test added too. */
const instances = new Set<{ reset: () => void; runs: (workspaceId: string) => AssistantRunSummary[]; seed: () => void }>();

export function previewRuns(workspaceId: string): AssistantRunSummary[] {
  return [...instances].flatMap((instance) => instance.runs(workspaceId))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

/** A dedicated fixture with an interrupted Deep run and one completed section. */
export function seedPreviewRuns(): void {
  for (const instance of instances) instance.seed();
}

/** End every run and forget every session, as a restarted server would. */
export function resetAssistantSockets(): void {
  for (const instance of instances) instance.reset();
}

/**
 * The assistant socket as one server: its own sessions and runs. By default
 * a run is the preview's scripted turn over the fixture state; a test passes
 * its own `stream` (and `server.use`s the handler) to script one.
 */
export function assistantSocket(options: AssistantSocketOptions = {}) {
  const stream = options.stream ?? assistantTurn;
  const documentExists = options.documentExists
    ?? ((workspaceId: string, id: string) => workspaceDocument(workspaceId, id) !== undefined);
  const sessions = new Map<string, StoredSession>();
  const runs = new Map<string, StoredRun>();
  const connections = new Set<Connection>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  instances.add({
    reset() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const stored of sessions.values()) {
        for (const run of stored.runs) {
          run.abandoned = true;
          void run.events?.return?.().catch(() => {});
        }
      }
      sessions.clear();
      runs.clear();
      for (const connection of connections) connection.subscriptions.clear();
    },
    runs(workspaceId) {
      return [...runs.values()].filter((run) => run.workspace_id === workspaceId).map((run) => {
        const session = sessions.get(run.session_id)?.session;
        const chatId = session?.chat_id ?? run.request.chat_id ?? null;
        const messages = chatId ? chatsOf(run.request.document_id).find((chat) => chat.id === chatId)?.messages ?? [] : [];
        const record = run.record.snapshot(run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'failed' : 'stopped', run.ledger.recorded());
        return {
          id: run.id, session_id: session?.id ?? null, chat_id: chatId, document_id: run.request.document_id,
          request: session ? copy(run.request) : null, leaf_id: [...messages].reverse().find((message) => message.run_id === run.id)?.id ?? null,
          status: run.status, profile: run.request.profile ?? 'chat', effort: run.request.effort ?? (run.request.profile === 'inline' ? 'quick' : 'standard'),
          engine: run.request.engine ?? 'gateway', preset: run.request.preset ?? null, cost: record.cost,
          limit_reached: record.limit_reached, error_code: record.error?.code ?? null,
          duration_ms: run.endedAt ? Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt ?? run.created_at)) : null,
          resumed_from: run.resumed_from, resumable: run.status === 'interrupted' && run.checkpoint === true,
          created_at: run.created_at, started_at: run.startedAt ?? null, ended_at: run.endedAt ?? null,
        };
      });
    },
    seed() {
      if (!options.previewFixtures || sessions.has('session-preview-checkpoint')) return;
      const now = new Date().toISOString();
      const session: AssistantSession = {
        id: 'session-preview-checkpoint', workspace_id: PERSONAL_WORKSPACE_ID, document_id: FIXTURE_DOCUMENT_ID,
        chat_id: null, title: 'Research run (checkpoint)', profile: 'chat', request_id: null,
        last_seq: 0, active_run_id: null, created_at: now, updated_at: now,
      };
      const stored: StoredSession = { session, events: [], runs: [], fingerprint: 'runs-fixture' };
      sessions.set(session.id, stored);
      const planning = { document_id: FIXTURE_DOCUMENT_ID, message: 'Plan a related-work section', profile: 'chat', effort: 'deep', web: false } as AgentChatRequest;
      const question = recordQuestion(FIXTURE_DOCUMENT_ID, {
        chatId: null, leafId: null, text: planning.message, preset: null, runId: 'run-preview-plan', effort: 'deep', web: false,
      });
      session.chat_id = question.chatId;
      const chat = chatsOf(FIXTURE_DOCUMENT_ID).find((item) => item.id === question.chatId);
      if (chat) chat.title = session.title;
      let plan = proposePlan(PERSONAL_WORKSPACE_ID, FIXTURE_DOCUMENT_ID, question.chatId);
      const make = (id: string, request: AgentChatRequest, status: RunStatus): StoredRun => ({
        id, session_id: session.id, workspace_id: PERSONAL_WORKSPACE_ID, request_id: id, request,
        fingerprint: fingerprint(request), status, event_count: 0, event_bytes: 0,
        created_at: now, updated_at: now, after_seq: 0, resumed_from: null,
        startedAt: now, endedAt: now, record: new TurnRecord(), ledger: new RunLedger('chat', request.effort ?? null, Boolean(request.plan_id)), settled: [],
      });
      const proposed = make('run-preview-plan', { ...planning, chat_id: question.chatId }, 'completed');
      proposed.record.observe({ event: 'plan', data: planEvent(plan) });
      proposed.record.observe({ event: 'token', data: { content: 'Here is the related-work plan.' } });
      recordAnswer(FIXTURE_DOCUMENT_ID, { ...question, runId: proposed.id }, proposed.record.text, proposed.record.snapshot('completed', proposed.ledger.recorded()), true);
      stored.runs.push(proposed);
      runs.set(proposed.id, proposed);
      const request = { ...planning, message: '', chat_id: question.chatId, leaf_id: question.answerId, plan_id: plan.plan_id };
      const interrupted = make('run-preview-checkpoint', request, 'interrupted');
      const turn = recordQuestion(FIXTURE_DOCUMENT_ID, {
        chatId: question.chatId, leafId: question.answerId, text: 'Write the approved plan, section by section.',
        preset: null, runId: interrupted.id, effort: 'deep', planId: plan.plan_id, web: false,
      });
      plan = beginPlan(plan, interrupted.id);
      const section = plan.sections[0];
      if (section) {
        const set = storePlanSection(FIXTURE_DOCUMENT_ID, section, { apply_policy: 'review', auto_blocked_reason: null }, interrupted.id, 'write-first-section');
        plan = writtenSection(plan, section.id, set.change_set_id);
      }
      plan = endPlan(plan);
      interrupted.checkpoint = true;
      interrupted.record.observe({ event: 'plan', data: planEvent(plan) });
      interrupted.record.observe({ event: 'token', data: { content: 'The first section is proposed. The server restarted before the remaining two sections.' } });
      recordAnswer(FIXTURE_DOCUMENT_ID, { ...turn, runId: interrupted.id }, interrupted.record.text, interrupted.record.snapshot('stopped', interrupted.ledger.recorded()), true);
      stored.runs.push(interrupted);
      runs.set(interrupted.id, interrupted);
    },
  });

  const deliver = (connection: Connection, message: AssistantServerMessage) => {
    if (connection.open) connection.send(JSON.stringify(message));
  };
  const replay = (connection: Connection, stored: StoredSession) => {
    let cursor = connection.subscriptions.get(stored.session.id);
    if (cursor === undefined || !connection.open) return;
    for (const event of stored.events) {
      if (cursor === undefined || event.seq <= cursor) continue;
      connection.subscriptions.set(stored.session.id, event.seq);
      cursor = event.seq;
      deliver(connection, event);
    }
  };
  /** The command's workspace; an id the account is not a member of is not found. */
  const workspaceOf = (params: Json): string => {
    const workspaceId = text(params.workspace_id, 'workspace_id');
    if (!liveWorkspace(workspaceId)) throw new RpcError('workspace_not_found', 'Workspace not found');
    return workspaceId;
  };
  const sessionFor = (workspaceId: string, id: unknown): StoredSession => {
    const value = sessions.get(text(id, 'session_id'));
    if (!value || value.session.workspace_id !== workspaceId) throw new RpcError('session_not_found', 'Assistant session not found');
    return value;
  };
  const append = (stored: StoredSession, run: StoredRun, item: AssistantEvent) => {
    if (run.abandoned) return;
    // A limit reached as the run ends is said before its end.
    if (item.event === 'done' || item.event === 'error') {
      const budget = run.ledger.takeBudget();
      if (budget) append(stored, run, { event: 'budget', data: budget });
    }
    const envelope = {
      type: 'event', session_id: stored.session.id, run_id: run.id, seq: ++stored.session.last_seq, event: item.event, data: copy(item.data),
    } as EventMessage;
    const now = new Date().toISOString();
    stored.session.updated_at = now;
    run.updated_at = now;
    stored.events.push(envelope);
    run.record.observe(item);
    run.ledger.observe(item);
    run.event_count += 1;
    run.event_bytes += JSON.stringify(item.data).length;
    for (const connection of connections) replay(connection, stored);
    // A counter crossed two thirds of its limit, or reached it: the ledger says so once.
    if (item.event !== 'budget' && item.event !== 'done' && item.event !== 'error' && item.event !== 'run.status') {
      const budget = run.ledger.takeBudget();
      if (budget) append(stored, run, { event: 'budget', data: budget });
    }
  };
  const finish = (stored: StoredSession, run: StoredRun, status: RunStatus) => {
    if (terminal.has(run.status)) return;
    run.status = status;
    run.endedAt = new Date().toISOString();
    stored.session.active_run_id = null;
    // A Stop, a lost lease and a shutdown keep what was shown, as `stopped`.
    const end: RunEnd = {
      status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'stopped', record: run.record, ledger: run.ledger,
    };
    for (const settled of run.settled.splice(0)) {
      for (const item of settled(end) ?? []) append(stored, run, item);
    }
    append(stored, run, { event: 'run.status', data: { run_id: run.id, status, message: null } });
  };

  async function execute(stored: StoredSession, run: StoredRun): Promise<void> {
    if (run.abandoned || run.status !== 'queued') return;
    run.status = 'running';
    run.startedAt = new Date().toISOString();
    append(stored, run, { event: 'run.status', data: { run_id: run.id, status: 'running', message: null } });
    // The run's review policy, as the server keeps it (D18): Auto when it was
    // asked for and allowed, until the workspace switches Auto off (checked
    // before every tool call). What the run reads does not end it. A run
    // already under review keeps the reason it has. Every status carries
    // the policy of when it is sent; a run opens with `starting`, so the
    // composer knows the policy first.
    const workspaceId = stored.session.workspace_id;
    const policy: RunPolicy = {
      apply_policy: applyPolicyFor(run.request, workspaceId),
      auto_blocked_reason: autoBlockedFor(run.request, workspaceId),
    };
    const downgrade = (reason: NonNullable<RunPolicy['auto_blocked_reason']>) => {
      if (policy.apply_policy === 'review') return;
      policy.apply_policy = 'review';
      policy.auto_blocked_reason = reason;
    };
    const status = (data: Pick<StatusData, 'status' | 'detail'>): AssistantEvent =>
      ({ event: 'status', data: { ...data, apply_policy: policy.apply_policy, auto_blocked_reason: policy.auto_blocked_reason } });
    const toolset = runToolset(workspaceId, run.request);
    const tools = toolset.has;
    const preloads = new Map<string, { id: string; resource: string | null; by: 'tools' | 'preset' | 'document_type' | 'review' }>();
    const addPreload = (id: string, resource: string | null, by: 'tools' | 'preset' | 'document_type' | 'review') => {
      const key = `${id}:${resource ?? ''}`;
      if (!preloads.has(key)) preloads.set(key, { id, resource, by });
    };
    const profile = run.request.profile ?? 'chat';
    const eligible = skillsForRun(profile, tools, fixtures.assistant);
    for (const tool of REGISTRY.tools) if (tools.has(tool.id) && tool.skill) addPreload(tool.skill, null, 'tools');
    const preset = REGISTRY.presets.find((item) => item.id === run.request.preset);
    if (preset?.skill && permitted(fixtures.assistant, 'skills', preset.skill) && (preset.skill_reference || eligible.has(preset.skill))) {
      addPreload(preset.skill, preset.skill_reference ?? null, 'preset');
    }
    const page = fixtures.documents.get(run.request.document_id);
    if (page?.documentType && eligible.has(page.documentType)) addPreload(page.documentType, null, 'document_type');
    if (profile === 'review') {
      const skill = run.request.review === 'peer_review' ? 'peer-review'
        : run.request.review === 'structure' ? 'reporting-guidelines' : run.request.review === 'claims' || run.request.review === 'sources' ? 'evidence-review' : null;
      if (skill && eligible.has(skill)) {
        addPreload(skill, null, 'review');
        if (skill === 'peer-review') addPreload(skill, 'references/filtering.md', 'review');
      }
    }
    for (const { id, resource, by } of preloads.values()) {
      const skill = REGISTRY.skills.find((entry) => entry.id === id);
      if (skill) append(stored, run, { event: 'skill', data: { id, label: skill.label, version: skill.version, resource, by } });
    }
    const instructions = page && profile !== 'review' ? standingInstructions(contentOf(page), run.request.context ?? null, profile === 'inline') : [];
    if (instructions.length) append(stored, run, { event: 'instructions', data: {
      items: instructions.map(({ scope, block_id, label }) => ({ scope, block_id, label })),
    } });
    let startingDetail = 'Starting…';
    if (run.request.web && ![...tools].some((id) => registryTool(id)?.toolset === 'web')) {
      const cut = REGISTRY.tools.filter((tool) => tool.toolset === 'web')
        .map((tool) => toolset.cuts.get(tool.id)).find((item) => item !== undefined);
      if (cut) startingDetail = `${cut.detail} Continuing without Web…`;
    }
    append(stored, run, status({ status: 'starting', detail: startingDetail }));
    let sawTerminal = false;
    const live = () => !run.abandoned && run.status === 'running';
    try {
      const engine = run.request.engine ?? 'gateway';
      // The task list is part of every chat run; a worker needs the account's Workers switch.
      const plan = tools.has('todo_write');
      const research = researchTool(tools);
      const workerResearch = permitted(fixtures.assistant, 'workers', 'web_researcher') ? research : null;
      const workerLibrary = tools.has('library_search') && permitted(fixtures.assistant, 'workers', 'library_reader');
      const worker = profile !== 'review' && tools.has('delegate') && (workerResearch !== null || workerLibrary);
      const workerId = `preview-worker-${run.id}`;
      const workerBrief = {
        id: workerId, engine,
        profile: workerResearch ? 'web_researcher' as const : 'library_reader' as const,
        title: 'Routing evidence',
        objective: 'Find evidence about router stability in the available sources.',
      };
      const items = [
        { id: 'preview-review', content: 'Review the fixture evidence (preview)', status: 'in_progress' },
        { id: 'preview-synthesis', content: 'Summarize the fixture findings', status: 'pending' },
      ] as const;
      if (plan) append(stored, run, { event: 'todo', data: { items: [...items] } });
      // A worker's tool calls reach the client namespaced by its id, as the
      // API sends them (`<worker id>:<call id>`), in between the lead's own.
      // It is `queued` until it has a slot, here when the lead starts its
      // first step, and reports back when that step ends; a queued worker
      // always ends, here `completed`.
      const workerCall = `${workerId}:call_1`;
      // Without an outside source the worker searches the page's PDFs, by their words.
      const workerTool = workerResearch ?? 'library_search';
      const workerArgs = { ...searchArguments('router z-loss stability', 6), ...(workerResearch ? {} : { mode: 'exact' }) };
      let workerState: 'queued' | 'running' | 'done' = 'queued';
      const startWorker = () => {
        if (!worker || workerState !== 'queued') return;
        workerState = 'running';
        append(stored, run, { event: 'subagent', data: { ...workerBrief, status: 'running' } });
        append(stored, run, callStart(workerTool, workerCall));
        append(stored, run, callArgs(workerTool, workerCall, workerArgs));
      };
      const finishWorker = () => {
        if (!worker || workerState === 'done') return;
        startWorker();
        workerState = 'done';
        const end = callEnd(workerTool, workerCall, workerArgs, {
          ms: 1840, chars: 2100, result: { result_count: 6 },
        });
        append(stored, run, end);
        append(stored, run, { event: 'subagent', data: { ...workerBrief, status: 'completed' } });
      };
      if (worker) append(stored, run, { event: 'subagent', data: { ...workerBrief, status: 'queued' } });
      let moved = false;
      const events = stream(run.request, {
        workspaceId, runId: run.id, sessionId: stored.session.id, afterSeq: run.after_seq,
        policy: () => ({ ...policy }), tools,
        onSettled: (callback) => { run.settled.push(callback); },
        reach: (counter) => run.ledger.reach(counter),
        failWrite: (kind) => run.ledger.failWrite(kind),
        resumedFrom: run.resumed_from ?? undefined,
        instructions,
      })[Symbol.asyncIterator]();
      run.events = events;
      while (live()) {
        const next = await events.next();
        if (!live() || next.done) break;
        let item = next.value;
        if (!record(item) || !record(item.data)) throw new Error('Invalid preview event');
        if (item.event === 'session.chat') {
          stored.session.chat_id = item.data.chat_id;
          run.request.chat_id = item.data.chat_id;
        }
        // Every status of a run carries its review policy as the server has it.
        if (item.event === 'status') item = status(item.data);
        if (item.event === 'tool_call_start') {
          // A tool call began streaming (`executing_tool`, with the policy of
          // now); the waiting worker gets its slot at the lead's first one.
          append(stored, run, status({ status: 'executing_tool', detail: `Running ${item.data.tool}...` }));
          startWorker();
        }
        // The tool is about to run: the workspace's policy is read again.
        if (item.event === 'tool_call_args' && !workspacePolicyOf(workspaceId).auto) downgrade('policy');
        if (item.event === 'tool_call_end' && !moved) {
          // The lead finished its first step: the worker reports back and
          // the plan moves on, so the pinned task list is seen changing.
          moved = true;
          finishWorker();
          if (plan) append(stored, run, { event: 'todo', data: { items: [{ ...items[0], status: 'completed' }, { ...items[1], status: 'in_progress' }] } });
        }
        if (item.event === 'done') {
          if (typeof item.data.chat_id === 'string') {
            stored.session.chat_id = item.data.chat_id;
            append(stored, run, { event: 'session.chat', data: { chat_id: item.data.chat_id } });
          }
          if (plan) append(stored, run, { event: 'todo', data: { items: items.map((entry) => ({ ...entry, status: 'completed' as const })) } });
          finishWorker();
          // The run's ledger at its end, as the API's `done` reports it; a
          // stream that scripts its own keeps it.
          const ledger = run.ledger.report(item.data);
          item = {
            event: 'done',
            data: {
              ...item.data,
              budget: item.data.budget ?? ledger.budget,
              labels: item.data.labels ?? ledger.labels,
              persistence: item.data.persistence ?? ledger.persistence,
            },
          };
        }
        append(stored, run, item);
        if (item.event === 'done' || item.event === 'error') {
          sawTerminal = true;
          finish(stored, run, item.event === 'done' ? 'completed' : 'failed');
        }
      }
      if (live() && !sawTerminal) throw new Error('Preview stream stopped before completion');
    } catch (error) {
      if (live()) {
        append(stored, run, { event: 'error', data: {
          error_code: error instanceof MockAssetError ? 'ATTACHMENT_UNAVAILABLE'
            : error instanceof MockPlanRefusal ? error.code === 'stale_plan' ? 'STALE_PLAN' : 'PLAN_NOT_FOUND' : 'PREVIEW_STREAM_ERROR',
          message: error instanceof MockPlanRefusal || error instanceof MockAssetError ? error.message : 'The fixture assistant stream could not finish.',
          engine: null, engine_state: null, login_command: null,
        } });
        finish(stored, run, 'failed');
      }
    } finally {
      const events = run.events;
      run.events = undefined;
      await events?.return?.().catch(() => {});
    }
  }

  function dispatch(connection: Connection, method: string, params: Json): Reply['result'] {
    if (method === 'ping') return { time: Date.now() / 1000 };
    const workspaceId = workspaceOf(params);
    if (method === 'sessions.create') {
      const documentId = text(params.document_id, 'document_id');
      if (!documentExists(workspaceId, documentId)) throw new RpcError('document_not_found', 'Document not found');
      if (typeof params.chat_id === 'string' && !chatsOf(documentId).some((chat) => chat.id === params.chat_id)) {
        throw new RpcError('chat_not_found', 'Chat not found for this document');
      }
      const normalized = {
        workspace_id: workspaceId,
        document_id: documentId,
        chat_id: typeof params.chat_id === 'string' ? params.chat_id : null,
        title: typeof params.title === 'string' && params.title ? params.title : 'New conversation',
        profile: params.profile === 'inline' ? 'inline' as const : params.profile === 'review' ? 'review' as const : 'chat' as const,
      };
      if (params.profile !== undefined && !['chat', 'inline', 'review'].includes(String(params.profile))) {
        throw new RpcError('invalid_request', 'profile must be chat, inline or review');
      }
      if (normalized.profile !== 'chat' && normalized.chat_id) throw new RpcError('invalid_request', 'Only a chat session can resume a chat');
      const requestId = typeof params.request_id === 'string' ? params.request_id : null;
      const hash = fingerprint(normalized);
      const existing = requestId ? [...sessions.values()].find((row) => row.session.request_id === requestId) : undefined;
      if (existing) {
        if (existing.fingerprint !== hash) throw new RpcError('conflict', 'Session request_id already used for different parameters');
        return copy(existing.session);
      }
      const now = new Date().toISOString();
      const session: AssistantSession = {
        id: uid(), ...normalized, request_id: requestId, last_seq: 0, active_run_id: null, created_at: now, updated_at: now,
      };
      sessions.set(session.id, { session, events: [], runs: [], fingerprint: hash });
      return copy(session);
    }
    if (method === 'sessions.list') {
      const documentId = text(params.document_id, 'document_id');
      return [...sessions.values()].map((row) => row.session)
        .filter((row) => row.workspace_id === workspaceId && row.document_id === documentId && row.profile === 'chat'
          && (!params.chat_id || row.chat_id === params.chat_id))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id))
        .slice(0, typeof params.limit === 'number' ? Math.max(1, Math.min(100, params.limit)) : 50)
        .map(copy);
    }
    const stored = sessionFor(workspaceId, params.session_id);
    const lastRun = stored.runs.at(-1);
    if (method === 'sessions.get') return { session: copy(stored.session), run: lastRun ? publicRun(lastRun) : null };
    if (method === 'sessions.delete') {
      if (stored.session.active_run_id) throw new RpcError('conflict', 'Stop the active run before deleting its session');
      sessions.delete(stored.session.id);
      return { deleted: true };
    }
    if (method === 'sessions.subscribe' || method === 'sessions.unsubscribe') {
      const after = params.after_seq ?? 0;
      if (typeof after !== 'number' || !Number.isSafeInteger(after) || after < 0 || after > stored.session.last_seq) {
        throw new RpcError('invalid_cursor', 'Replay cursor is outside this session');
      }
      if (method === 'sessions.unsubscribe') connection.subscriptions.delete(stored.session.id);
      else {
        connection.subscriptions.set(stored.session.id, after);
        // The reply goes first; the replay follows it.
        queueMicrotask(() => replay(connection, stored));
      }
      return { subscribed: method === 'sessions.subscribe' };
    }
    if (method === 'runs.start') {
      const requestId = text(params.request_id, 'request_id');
      if (!record(params.request)) throw new RpcError('invalid_request', 'request must be an object');
      const request = { web: false, ...params.request } as AgentChatRequest;
      const refusal = requestRefusal(request);
      if (refusal) throw new RpcError('invalid_request', refusal);
      const hash = fingerprint(request);
      const previous = stored.runs.find((run) => run.request_id === requestId);
      if (previous) {
        if (previous.fingerprint !== hash) throw new RpcError('conflict', 'Run request_id already used for a different request');
        return publicRun(previous);
      }
      if (
        request.document_id !== stored.session.document_id
        || (request.profile ?? 'chat') !== stored.session.profile
        || (request.chat_id != null && request.chat_id !== stored.session.chat_id)
      ) {
        throw new RpcError('invalid_request', 'Run context does not match the assistant session');
      }
      const chatBusy = stored.session.chat_id
        && [...sessions.values()].some((row) => row.session.chat_id === stored.session.chat_id && row.session.active_run_id);
      if (stored.session.active_run_id || chatBusy) throw new RpcError('conflict', 'A run is already active in this conversation');
      const now = new Date().toISOString();
      const run: StoredRun = {
        id: uid(), session_id: stored.session.id, workspace_id: workspaceId, request_id: requestId,
        request: { ...copy(request), chat_id: stored.session.chat_id },
        fingerprint: hash, status: 'queued', event_count: 0, event_bytes: 0, created_at: now, updated_at: now, resumed_from: null,
        // The session's sequence when the run was admitted: its events come after it.
        after_seq: stored.session.last_seq, record: new TurnRecord(), ledger: new RunLedger(request.profile ?? 'chat', request.effort ?? null, Boolean(request.plan_id)), settled: [],
      };
      stored.runs.push(run);
      runs.set(run.id, run);
      stored.session.active_run_id = run.id;
      append(stored, run, { event: 'run.status', data: { run_id: run.id, status: 'queued', message: null } });
      const timer = setTimeout(() => { timers.delete(timer); void execute(stored, run); }, 0);
      timers.add(timer);
      return publicRun(run);
    }
    if (method === 'runs.resume') {
      const source = stored.runs.find((entry) => entry.id === params.run_id);
      if (!source) throw new RpcError('run_not_found', 'Assistant run not found');
      const requestId = text(params.request_id, 'request_id');
      const hash = `resume:${source.id}`;
      const previous = stored.runs.find((run) => run.request_id === requestId);
      if (previous) {
        if (previous.fingerprint !== hash) throw new RpcError('conflict', 'Run request_id already used for a different request');
        return publicRun(previous);
      }
      if (source.status !== 'interrupted' || !source.checkpoint) throw new RpcError('run_not_resumable', 'This run has no saved checkpoint available.');
      if (stored.session.active_run_id) throw new RpcError('conflict', 'A run is already active in this conversation');
      const now = new Date().toISOString();
      const run: StoredRun = {
        id: uid(), session_id: stored.session.id, workspace_id: workspaceId, request_id: requestId, request: copy(source.request),
        fingerprint: hash, status: 'queued', event_count: 0, event_bytes: 0, created_at: now, updated_at: now,
        resumed_from: source.id, after_seq: stored.session.last_seq, record: new TurnRecord(), ledger: source.ledger, settled: [],
      };
      source.checkpoint = false;
      stored.runs.push(run);
      runs.set(run.id, run);
      stored.session.active_run_id = run.id;
      append(stored, run, { event: 'run.status', data: { run_id: run.id, status: 'queued', message: null } });
      const timer = setTimeout(() => { timers.delete(timer); void execute(stored, run); }, 0);
      timers.add(timer);
      return publicRun(run);
    }
    if (method === 'runs.cancel') {
      const run = stored.runs.find((entry) => entry.id === params.run_id);
      if (!run) throw new RpcError('run_not_found', 'Assistant run not found');
      if (!terminal.has(run.status)) {
        if (run.status === 'running') {
          run.status = 'cancelling';
          append(stored, run, { event: 'run.status', data: { run_id: run.id, status: 'cancelling', message: null } });
        }
        finish(stored, run, 'cancelled');
        void run.events?.return?.().catch(() => {});
      }
      return publicRun(run);
    }
    throw new RpcError('method_not_found', 'Unknown assistant command');
  }

  // Relative to the page, so only this host's socket matches.
  return ws.link(resolveApiPath('/api/agent/ws')).addEventListener('connection', ({ client }) => {
    const connection: Connection = { send: (data) => client.send(data), open: true, subscriptions: new Map() };
    connections.add(connection);
    client.addEventListener('message', (event) => {
      // This server answers; a socket mock listed after it does not.
      event.stopPropagation();
      let id: string | null = null;
      try {
        if (typeof event.data !== 'string') throw new RpcError('invalid_request', 'JSON text commands are required');
        const command: unknown = JSON.parse(event.data);
        if (!record(command)) throw new RpcError('invalid_request', 'Invalid assistant command');
        id = typeof command.id === 'string' ? command.id : null;
        const method = text(command.method, 'method');
        if (!record(command.params)) throw new RpcError('invalid_request', 'params must be an object');
        const result = dispatch(connection, method, command.params);
        deliver(connection, { id: id ?? '', method, result } as Reply);
      } catch (error) {
        const code = error instanceof RpcError ? error.code : 'invalid_request';
        deliver(connection, { id, error: { code, message: error instanceof Error ? error.message : 'Invalid assistant command', retryable: false } });
      }
    });
    // Closing an observer never cancels a run it started.
    client.addEventListener('close', () => {
      connection.open = false;
      connection.subscriptions.clear();
      connections.delete(connection);
    });
  });
}

/* ----------------------------------------
   The preview's scripted turn
   ---------------------------------------- */

/**
 * What an inline run is about, as the API reads it: the selected text, or
 * the referenced blocks of the stored page, leaving out what is hidden from
 * the assistant. `null` for an empty line.
 */
function inlinePassage(request: AgentChatRequest, workspaceId: string): string | null {
  const page = workspaceDocument(workspaceId, request.document_id);
  const visible = new Map((page?.blocks ?? []).filter((block) => !block.aiHidden).map((block) => [block.id, block]));
  const context = request.context;
  if (context?.selection && visible.has(context.selection.block_id)) return context.selection.text;
  const ids = (context?.block_ids ?? []).filter((id) => visible.has(id));
  if (!context?.block_id || !ids.includes(context.block_id)) return null;
  const passage = ids
    .map((id) => {
      const block = visible.get(id);
      if (!block) return '';
      return 'text' in block && typeof block.text === 'string'
        ? block.text
        : 'html' in block && typeof block.html === 'string' ? block.html.replace(/<[^>]*>/g, '') : '';
    })
    .filter(Boolean)
    .join('\n\n');
  return passage || null;
}

/**
 * A canned answer to an inline run (`profile: "inline"`): the passage back
 * with a few words changed, so the prompt's diff view has something to show;
 * as a list or a table for those presets; on an empty line, a short drafted
 * paragraph. The server, not the request, holds a preset's instruction.
 */
function inlineReply(passage: string | null, preset: string | null, cited: string | undefined, previous?: string | null): string {
  if (preset?.startsWith('figure')) {
    let spec: Record<string, unknown> = {
      caption: 'A conceptual workflow from the selected passage.',
      nodes: [{ id: 'input', label: 'Input', role: 'input' }, { id: 'step', label: 'Process', role: 'process' },
        { id: 'output', label: 'Output', role: 'output' }],
      edges: ['input -> step -> output'],
    };
    try {
      const candidate: unknown = JSON.parse((previous ?? passage ?? '').replace(/^```figure\s*|\s*```$/g, '').trim());
      if (record(candidate) && Array.isArray(candidate.nodes)) spec = candidate;
    } catch { /* The scripted fallback is a valid conceptual figure, not a model evaluation. */ }
    if (preset === 'figure-explain') return typeof spec.caption === 'string' ? spec.caption : 'The figure follows the workflow from input to output.';
    if (preset === 'figure-print') spec = { ...spec, palette: 'mono' };
    return `\`\`\`figure\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
  }
  passage = previous ?? passage;
  if (!passage) {
    return `Sparse expert models decouple capacity from compute: each token visits one expert, so parameters grow while the cost per token stays flat${cited ? ` [${cited}]` : ''}.`;
  }
  const sentences = passage.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  if (preset === 'bullets') return sentences.map((sentence) => `- ${sentence}`).join('\n');
  if (preset === 'table') {
    return ['| Point | Detail |', '| --- | --- |', ...sentences.map((sentence, index) => `| ${index + 1} | ${sentence.replace(/\|/g, '\\|')} |`)].join('\n');
  }
  return passage
    .replace(/\bwe show\b/i, 'we demonstrate')
    .replace(/\bThe router\b/, 'A learned router')
    .replace(/\bwith a learned gate\b/, 'through a gating network')
    .replace(/\bmost promising\b/, 'most credible');
}

/**
 * The `tool_action` of a stored `doc_edit` proposal: it names the set and
 * carries none of its operations. The set is stored with the run's policy
 * as it is now (`AssistantTurnContext.policy`), and the action says it.
 */
export function proposedAction(documentId: string, policy: RunPolicy): ToolActionData {
  const changeSet = storeProposedEdits(documentId, policy);
  return changeSetAction(documentId, changeSet);
}

function changeSetAction(documentId: string, changeSet: StoredChangeSet): ToolActionData {
  return {
    tool: 'doc_edit',
    tool_call_id: changeSet.tool_call_id ?? 'call_edit',
    document_id: documentId,
    workspace_id: null,
    collection_id: null,
    version: 1,
    status: 'proposed',
    actions: [],
    operationResults: [],
    message: null,
    change_set_id: changeSet.change_set_id,
    apply_policy: changeSet.apply_policy,
    auto_blocked_reason: changeSet.auto_blocked_reason,
    // As the API summarises a stored set (`proposal_summary`): ids, counts
    // and operation names, an id left out when there is none.
    proposal: {
      content_redacted: true,
      operation_count: changeSet.operations.length,
      operation_names: changeSet.operations.map((operation) => operation.op),
      change_set_id: changeSet.change_set_id,
      ...(changeSet.base_revision_id ? { base_revision_id: changeSet.base_revision_id } : {}),
      ...(changeSet.depends_on_change_set_id ? { depends_on_change_set_id: changeSet.depends_on_change_set_id } : {}),
      base_head_seq: changeSet.base_head_seq,
    },
  };
}

/** `cite_sources`'s action: the change set it stored, summarised as the API summarises one. */
function citeAction(documentId: string, changeSet: StoredChangeSet): ToolActionData {
  return {
    tool: 'cite_sources',
    tool_call_id: 'call_cite',
    document_id: documentId,
    workspace_id: null,
    collection_id: null,
    version: 1,
    status: 'proposed',
    actions: [],
    operationResults: [],
    message: null,
    change_set_id: changeSet.change_set_id,
    apply_policy: changeSet.apply_policy,
    auto_blocked_reason: changeSet.auto_blocked_reason,
    proposal: {
      content_redacted: true,
      operation_count: changeSet.operations.length,
      operation_names: changeSet.operations.map((operation) => operation.op),
      change_set_id: changeSet.change_set_id,
      base_head_seq: changeSet.base_head_seq,
    },
  };
}

/**
 * A work as the citation pipeline leaves it once checked: the registries'
 * record where the mock knows one (Switch Transformers' sources disagree on
 * its year), else resolved and corroborated.
 */
function checkedRecord(record: Work['record']): Work['record'] {
  const known = CHECKED_WORKS.find((work) => work.key === record.key);
  if (known) return structuredClone(known);
  return { ...structuredClone(record), state: record.state === 'unchecked' ? 'verified' : record.state, checked: '2026-09-20' };
}

/** Local engine names, as the server's `status: starting` names them. */
const ENGINE_NAMES: Partial<Record<NonNullable<AgentChatRequest['engine']>, string>> = { claude: 'Claude Code', codex: 'Codex' };

/**
 * One event and how long the preview waits after sending it. An event given
 * as a function is made when it is sent, and one that makes nothing (an
 * `evidence` event with nothing new) is not sent.
 */
type TimedEvent = [event: AssistantEvent | (() => AssistantEvent | null), pauseMs?: number];

/*
 * A tool call's events in the shape the API sends them
 * (`ColWrite-api/src/agent/events/adapter.py`): `tool_call_start` with its
 * arguments deferred, then `tool_call_args` and `tool_call_end` with the
 * arguments as the API projects them for the author
 * (`sanitize_agent_tool_arguments`: a research, library or web tool's text
 * only as `<name>_redacted` and its length; numbers, flags and counts kept).
 * The end's preview is the result as the tool's class projects it, or a
 * failure's `{"content_redacted": true, "status": "error", "code": …}`, with
 * the registry code in `error_type`.
 */
type CallOutcome =
  | { ms: number; chars: number; result: Json; truncated?: boolean }
  | { ms: number; code: ErrorCode; error: string };

/** A tool's catalog row's display fields, which its `tool_call_start` carries. */
function displayOf(tool: string): ToolDisplay {
  const { label, running_label, icon, detail_templates, value_labels } = registryTool(tool);
  return { label, running_label, icon, detail_templates, value_labels };
}

function callStart(tool: string, id: string, display: ToolDisplay = displayOf(tool)): Extract<AssistantEvent, { event: 'tool_call_start' }> {
  return { event: 'tool_call_start', data: { tool, tool_call_id: id, arguments: {}, arguments_preview: '{}', arguments_deferred: true, display } };
}

/**
 * A tool this client's catalog does not list, as a newer server would run
 * it: its start event carries its display, which is all the feed needs.
 */
const UNLISTED_TOOL = 'page_outline';
const UNLISTED_DISPLAY: ToolDisplay = {
  label: 'Read the page outline', running_label: 'Reading the page outline', icon: 'file-search',
  detail_templates: ['{sections_count} sections'],
  value_labels: {},
};

function callArgs(tool: string, id: string, args: Json): Extract<AssistantEvent, { event: 'tool_call_args' }> {
  return { event: 'tool_call_args', data: { tool, tool_call_id: id, arguments: args, arguments_preview: JSON.stringify(args), arguments_truncated: null } };
}

function callEnd(tool: string, id: string, args: Json, outcome: CallOutcome): Extract<AssistantEvent, { event: 'tool_call_end' }> {
  const failed = 'code' in outcome;
  return {
    event: 'tool_call_end',
    data: {
      tool,
      tool_call_id: id,
      duration_ms: outcome.ms,
      is_error: failed,
      error: failed ? outcome.error : null,
      error_type: failed ? outcome.code : null,
      output_preview: JSON.stringify(
        failed ? { content_redacted: true, status: 'error', code: outcome.code } : { content_redacted: true, ...outcome.result },
      ),
      output_chars: failed
        ? JSON.stringify({ ok: false, error: { code: outcome.code, message: outcome.error } }).length
        : outcome.chars,
      // A result over its limit is fitted, not failed.
      output_truncated: !failed && outcome.truncated === true,
      arguments: args,
      arguments_preview: JSON.stringify(args),
      arguments_truncated: null,
    },
  };
}

/** A search's arguments as the API projects them: the query only by its length. */
function searchArguments(query: string, limit: number): Json {
  return { content_redacted: true, query_redacted: true, query_length: query.length, limit };
}

/** What a turn's evidence holds and what it attached: the conversation's store as this run sees it, and the PDFs as works. */
type TurnEvidence = { store: RunEvidence; pdfs: readonly Work[] };

/** The `evidence` event of what the run registered since the last one, or none. */
function evidenceEvent(store: RunEvidence): AssistantEvent | null {
  const data = store.drain();
  return data && { event: 'evidence', data };
}

/** One of the author's PDFs as the API's `resource_source` states it: its reference, until P2.API-7 a document by its title. */
function pdfWork(resource: { id: number; title?: string | null; filename: string }): Work {
  const key = `resource:${resource.id}`;
  return {
    kind: 'pdf',
    record: {
      key, kind: 'pdf', provider: 'resource', state: 'unchecked', flags: [],
      csl: { id: key, type: 'document', title: resource.title || resource.filename },
    },
  };
}

/** The id of the PDF a `resource:<id>` work is. */
const resourceIdOf = (work: Work) => Number(work.record.key.slice('resource:'.length));

/** What a paper search's papers or a web search's pages register: a web result stores its snippet. */
function registerFound(store: RunEvidence, research: string): string[] {
  if (research === 'web_search') {
    return PREVIEW_WEB_PAGES.map((page) => store.register(page, [{ text: `${page.record.csl.title}: a summary of sparse expert routing.`, level: 'snippet' }]).handle);
  }
  return PREVIEW_PAPERS.map((paper) => store.register(paper).handle);
}

/** Reasoning streamed in small fragments, the way a thinking model sends it. */
function reasoningEvents(textValue: string): TimedEvent[] {
  return textValue.split(/(?<= )/).map((piece) => [{ event: 'reasoning', data: { content: piece } }, 35]);
}

/** The models that served a scripted turn, with what their calls used (`done.models`). */
function servedModels(engine: NonNullable<AgentChatRequest['engine']>, inline: boolean): DoneData['models'] {
  if (engine !== 'gateway') return [{ model: engine === 'claude' ? 'claude-sonnet-5-5' : 'gpt-6.1-codex', tier: 'main', calls: 2, fallback: false, prompt_tokens: 5120, completion_tokens: 210, cost: null }];
  // A chat turn's main model failed once, so the chain's next one served it.
  return inline
    ? [{ model: 'openai/gpt-6-luna', tier: 'main', calls: 1, fallback: false, prompt_tokens: 1800, completion_tokens: 90, cost: 0.0004 }]
    : [
        { model: 'anthropic/claude-sonnet-5.5', tier: 'main', calls: 3, fallback: true, prompt_tokens: 4820, completion_tokens: 190, cost: 0.0168 },
        { model: 'openai/gpt-6-luna', tier: 'lite', calls: 1, fallback: false, prompt_tokens: 300, completion_tokens: 20, cost: null },
      ];
}

/** One end shape for every scripted flow; the socket fills its ledger. */
function turnDone(turn: { chatId: string; answerId: number } | null, engine: NonNullable<AgentChatRequest['engine']>, inline = false): Extract<AssistantEvent, { event: 'done' }> {
  const models = servedModels(engine, inline);
  const sum = (field: 'prompt_tokens' | 'completion_tokens') => models.reduce((total, model) => total + model[field], 0);
  const costs = models.flatMap((model) => model.cost === null ? [] : [model.cost]);
  return {
    event: 'done',
    data: {
      chat_id: turn?.chatId ?? null, message_id: turn?.answerId ?? null,
      usage: { prompt_tokens: sum('prompt_tokens'), completion_tokens: sum('completion_tokens'), cached_tokens: engine === 'gateway' ? 4096 : 0 },
      models, cost: costs.length ? Math.round(costs.reduce((total, cost) => total + cost, 0) * 1e6) / 1e6 : null,
      budget: null, persistence: null,
    },
  };
}

/** "Ask me …" exercises a real question/answer branch in the preview. */
async function* questionTurn(turn: ReturnType<typeof recordQuestion>, engine: NonNullable<AgentChatRequest['engine']>, answering = false, skipped = false): AsyncGenerator<AssistantEvent> {
  yield { event: 'session.chat', data: { chat_id: turn.chatId } };
  if (answering) {
    yield { event: 'token', data: { content: skipped
      ? 'I’ll use the page’s audience and state my assumptions.'
      : 'I’ll use your answers for the next draft.' } };
  } else {
    const question = {
      question_id: uid(),
      questions: [
        { id: 'audience', text: 'Who is the audience?', options: ['Researchers', 'General readers'], allow_free_text: true },
        { id: 'scope', text: 'What should the draft cover?', options: ['Methods', 'Results', 'Both'], allow_free_text: true },
      ],
    };
    const args = { content_redacted: true, questions_count: question.questions.length };
    yield callStart('author_ask', 'call_question');
    yield callArgs('author_ask', 'call_question', args);
    yield callEnd('author_ask', 'call_question', args, { ms: 120, chars: 180, result: { question_id: question.question_id } });
    yield { event: 'question', data: question };
    yield { event: 'token', data: { content: 'These choices will help me scope the draft. You can also skip them or write something else.' } };
  }
  yield turnDone(turn, engine);
}

async function* imageRequestTurn(request: AgentChatRequest, context: AssistantTurnContext, turn: ReturnType<typeof recordQuestion>): AsyncGenerator<AssistantEvent> {
  const engine = request.engine === 'codex' ? 'codex' : 'gateway';
  yield callStart('image_generate', 'call_image_request');
  yield callArgs('image_generate', 'call_image_request', { purpose: 'illustration', aspect_ratio: '3:2' });
  const info = proposeGeneration(context.workspaceId, request.document_id, {
    purpose: 'illustration', description: 'A conceptual blue river between geometric mountains',
    style: 'Clean flat illustration', aspect_ratio: '3:2', exact_text: '',
  }, engine, context.runId);
  info.chat_id = turn.chatId;
  info.tool_call_id = 'call_image_request';
  yield callEnd('image_generate', 'call_image_request', {}, { ms: 200, chars: 100, result: { status: 'awaiting_confirmation', generation_id: info.generation_id } });
  yield { event: 'artifact', data: {
    kind: 'image_request', generation_id: info.generation_id, status: 'proposed', asset_id: null,
    prompt: info.prompt, aspect_ratio: info.aspect_ratio, estimated_cost: info.estimated_cost, generator: info.provider,
  } };
  yield { event: 'token', data: { content: 'Review the exact image request and your venue’s rules, then choose Generate. Auto does not confirm an image.' } };
  yield turnDone(turn, engine);
}

/** Deep planning ends before any page write. Following a plan rereads its
 * pending sections between steps, just as the API's notebook does. */
async function* planTurn(
  request: AgentChatRequest,
  context: AssistantTurnContext,
  turn: ReturnType<typeof recordQuestion>,
  approved: ChatPlan | null,
): AsyncGenerator<AssistantEvent> {
  const { workspaceId, runId, tools, policy } = context;
  yield { event: 'session.chat', data: { chat_id: turn.chatId } };
  if (!approved) {
    const args = { content_redacted: true, kind: 'outline', sections_count: 3, effort: 'deep' };
    yield callStart('plan_propose', 'call_plan');
    yield callArgs('plan_propose', 'call_plan', args);
    await pause(500);
    const plan = proposePlan(workspaceId, request.document_id, turn.chatId);
    yield callEnd('plan_propose', 'call_plan', args, { ms: 500, chars: 1_200, result: { plan_id: plan.plan_id, revision: plan.revision, sections_count: plan.sections.length } });
    yield { event: 'plan', data: planEvent(plan) };
    yield { event: 'token', data: { content: 'Here is a plan. Edit its scope and order, then start writing when you are ready. No page changes have been made.' } };
  } else {
    let plan = beginPlan(approved, runId);
    yield { event: 'plan', data: planEvent(plan) };
    while (tools.has('doc_edit')) {
      // The author can have edited, added or removed a pending section.
      plan = planOf(workspaceId, request.document_id, turn.chatId, plan.plan_id) ?? plan;
      const section = plan.sections.find((item) => item.state !== 'proposed');
      if (!section) break;
      const readId = `read-${section.id}`;
      yield callStart('doc_read', readId);
      yield callArgs('doc_read', readId, { view: 'section' });
      yield callEnd('doc_read', readId, { view: 'section' }, { ms: 150, chars: 800, result: { view: 'section', block_count: 2 } });
      const callId = `write-${section.id}`;
      const args = { content_redacted: true, operation_count: 1, operation_names: ['write_blocks'], block_count: 2 };
      yield callStart('doc_edit', callId);
      await pause(1_800);
      yield callArgs('doc_edit', callId, args);
      const stored = storePlanSection(request.document_id, section, policy(), runId, callId);
      yield callEnd('doc_edit', callId, args, { ms: 1_800, chars: 500, result: {
        change_set_id: stored.change_set_id, status: 'proposed', operation_count: 1, operation_names: ['write_blocks'],
      } });
      yield { event: 'tool_action', data: changeSetAction(request.document_id, stored) };
      plan = planOf(workspaceId, request.document_id, turn.chatId, plan.plan_id) ?? plan;
      plan = writtenSection(plan, section.id, stored.change_set_id);
      yield { event: 'plan', data: planEvent(plan) };
      await pause(200);
    }
    plan = endPlan(planOf(workspaceId, request.document_id, turn.chatId, plan.plan_id) ?? plan);
    yield { event: 'plan', data: planEvent(plan) };
    yield { event: 'token', data: { content: plan.state === 'done'
      ? `${plan.sections.length} sections proposed for review. Review the changes in the page; drafting is not acceptance.`
      : 'The remaining sections are still in the plan. No further page changes were proposed.' } };
  }
  yield turnDone(turn, request.engine ?? 'gateway');
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Every chat flow, including questions and plans, registers attachments
 * before its first model/tool call. */
async function* withAttachments(evidence: TurnEvidence, events: AsyncGenerator<AssistantEvent>): AsyncGenerator<AssistantEvent> {
  if (evidence.pdfs.length) {
    for (const pdf of evidence.pdfs) evidence.store.register(pdf);
    const event = evidenceEvent(evidence.store);
    if (event) yield event;
  }
  yield* events;
}

/**
 * A canned assistant turn in the order and shape the API sends it: the
 * attached PDFs' handles before the first model call, an engine start for a
 * local CLI, reasoning, a read of the first attached PDF, a research call
 * (announced with deferred arguments and its display, then its arguments,
 * then its outcome), the `evidence` each finding call registered, a drafted
 * edit whose length is reported while it is written, and prose citing the
 * handles the conversation's store gave what it found (`[S1]`, or `[S3]` in
 * a chat whose earlier turns found S1 and S2). Pauses are long enough to see
 * each progress state in the preview. It names only the run's tools: the
 * research call is Semantic Scholar where the run has it, else the web,
 * else there is none; a run without `doc_edit` (a viewer's) drafts nothing.
 * Asked about what was found earlier, in a chat that holds sources, it
 * searches nothing and cites the conversation's first source, which only
 * an earlier reply's record names.
 *
 * Asked to improve the page, the turn edits it first and then checks the
 * literature; asked to improve it from the literature ("…with sources",
 * "cite", "research"), it searches first. Either way an Auto turn's sets are
 * stored `auto` and applied: what a run reads does not end Auto.
 * Before an edit it reads the section (`doc_read` with its `view`). Asked to
 * check a claim, it runs `claim_check` over what it found and sends its
 * `claim` (abstracts only: "cannot assess"). Asked about the outline, it
 * calls a tool the catalog does not list. Asked
 * to go on until its limit, it reaches its model-call limit and answers (its
 * `done` says `limit_reached`); asked about something unsaved, one of its
 * model-call rows fails to save (`persistence.failed_writes`).
 */
async function* scriptedTurn(
  message: string,
  /** For an inline run, what it is about and its preset; `undefined` for a chat turn. */
  inline: { passage: string | null; preset: string | null; previous?: string | null } | undefined,
  turn: { chatId: string; answerId: number } | null,
  documentId: string,
  engine: NonNullable<AgentChatRequest['engine']>,
  { policy, tools, reach, failWrite }: Pick<AssistantTurnContext, 'policy' | 'tools' | 'reach' | 'failWrite'>,
  { store: evidence, pdfs }: TurnEvidence,
): AsyncGenerator<AssistantEvent> {
  const rewrite = inline !== undefined;
  const events: TimedEvent[] = [];
  const chatId = turn?.chatId ?? null;
  if (chatId) events.push([{ event: 'session.chat', data: { chat_id: chatId } }, 0]);
  /** The handles of what the research call found, which the reply cites. */
  let found: string[] = [];
  // A handle an earlier turn registered, cited with no call that touches it.
  const [earlier] = !inline && /\bearlier\b/i.test(message) ? evidence.handles() : [];
  const engineName = ENGINE_NAMES[engine];
  if (engineName) {
    events.push([{ event: 'status', data: { status: 'starting', detail: `Starting ${engineName}…`, apply_policy: null, auto_blocked_reason: null } }, 1400]);
    events.push([{ event: 'status', data: { status: 'thinking', detail: 'Thinking…', apply_policy: null, auto_blocked_reason: null } }, 300]);
  }
  events.push(...reasoningEvents(
    rewrite
      ? 'The author wants this passage tightened. Keep the claim and the citation, drop the hedging, and keep the terminology the paper already uses.'
      : 'The author is asking about sparse expert routing. I should check what the literature says about long contexts before answering, then ground each claim in a source.',
  ));
  const research = researchTool(tools);
  // A message with a PDF attached: the assistant reads it first.
  const [attached] = pdfs;
  if (!rewrite && attached && tools.has('library_read')) {
    const resourceId = resourceIdOf(attached);
    const readArgs = { content_redacted: true, resource_id: resourceId, offset: 0, max_chars: 20_000 };
    let passages: string[] = [];
    events.push(
      [callStart('library_read', 'call_read'), 150],
      [callArgs('library_read', 'call_read', readArgs), 900],
      [() => {
        // A 20,000-character window, kept as passages of at most 2,000.
        passages = evidence.register(attached, Array.from({ length: 10 }, (_, index) => ({ text: `Window part ${index + 1}`, level: 'full_text' as const }))).passages;
        return callEnd('library_read', 'call_read', readArgs, {
          ms: 840, chars: 20_640,
          result: {
            resource_id: resourceId, title_redacted: true, title_length: attached.record.csl.title.length, pages: 14,
            text_redacted: true, text_length: 20_000, offset: 0, returned_chars: 20_000, total_chars: 48_210, next_offset: 20_000,
            text_truncated_at_source: false, cite_as_redacted: true, cite_as_length: 2, passages_count: passages.length,
          },
        });
      }, 100],
      [() => evidenceEvent(evidence), 200],
    );
  }
  if (!rewrite) {
    const query = 'sparse mixture of experts long context';
    const searchArgs = { ...searchArguments(query, 10), ...(research === 'paper_search' ? { year_from: 2020 } : {}) };
    const search: TimedEvent[] = research === null ? [] : [
      [callStart(research, 'call_1'), 150],
      [callArgs(research, 'call_1', searchArgs), 2600],
      [() => {
        found = registerFound(evidence, research);
        return callEnd(research, 'call_1', searchArgs, {
          ms: 2612, chars: 4200,
          result: research === 'paper_search'
            ? { query_redacted: true, query_length: query.length, papers_count: 2, providers_count: 2, failures_count: 0 }
            : { query_redacted: true, query_length: query.length, results_count: 2 },
        });
      }, 150],
      [() => evidenceEvent(evidence), 200],
      ...reasoningEvents('Two strong sources. Switch Transformers covers top-1 routing; ST-MoE covers stability at scale.'),
    ];
    // Asked about a failure, a paper lookup times out first, as the
    // executor reports it: the registry code, and the tool's fixed line.
    if (research === 'paper_search' && /\b(fail|fails|failed|failure|timeout|timed out)\b/i.test(message)) {
      const lookupArgs = { content_redacted: true, paper_redacted: true, paper_length: 2 };
      search.splice(3, 0,
        [callStart('paper_get', 'call_paper'), 150],
        [callArgs('paper_get', 'call_paper', lookupArgs), 1200],
        [callEnd('paper_get', 'call_paper', lookupArgs, {
          ms: 30_000, code: 'timeout', error: 'External research tool failed; content-bearing details redacted.',
        }), 150],
      );
    }
    if (/\boutline\b/i.test(message)) {
      const outlineArgs = { content_redacted: true, sections_count: 4 };
      search.unshift(
        [callStart(UNLISTED_TOOL, 'call_outline', UNLISTED_DISPLAY), 400],
        [callArgs(UNLISTED_TOOL, 'call_outline', outlineArgs), 600],
        [callEnd(UNLISTED_TOOL, 'call_outline', outlineArgs, { ms: 410, chars: 900, result: { sections_count: 4 } }), 150],
      );
    }
    const editArgs = {
      content_redacted: true,
      operation_count: 9,
      operation_names: ['replace_text', 'write_blocks', 'write_blocks', 'delete_blocks', 'move_block', 'set_meta', 'add_sources', 'remove_sources', 'write_blocks'],
      block_count: 5,
    };
    // Stored when the call ends, as `doc_edit` stores it, with the run's
    // policy of that moment; its action follows.
    let proposed: ToolActionData | undefined;
    const proposedEdit = (): ToolActionData => {
      if (!proposed) throw new Error('doc_edit ended without a change set');
      return proposed;
    };
    // Before it edits, it reads the section it will change: `doc_read`'s
    // view, the one closed-set argument its projection names.
    const readArgs = { view: 'section' };
    const read: TimedEvent[] = !tools.has('doc_read') ? [] : [
      [callStart('doc_read', 'call_doc'), 150],
      [callArgs('doc_read', 'call_doc', readArgs), 500],
      [callEnd('doc_read', 'call_doc', readArgs, {
        ms: 140, chars: 3_400, result: { name_redacted: true, view: 'section', block_count: 6, next_block_id: null },
      }), 150],
    ];
    const edit: TimedEvent[] = !tools.has('doc_edit') ? [] : [
      ...read,
      [callStart('doc_edit', 'call_edit'), 1000],
      [{ event: 'tool_call_progress', data: { tool: 'doc_edit', tool_call_id: 'call_edit', arguments_chars: 640 } }, 1000],
      [{ event: 'tool_call_progress', data: { tool: 'doc_edit', tool_call_id: 'call_edit', arguments_chars: 1480 } }, 1000],
      [{ event: 'tool_call_progress', data: { tool: 'doc_edit', tool_call_id: 'call_edit', arguments_chars: 2410 } }, 600],
      [callArgs('doc_edit', 'call_edit', editArgs), 400],
      [() => {
        proposed = proposedAction(documentId, policy());
        return callEnd('doc_edit', 'call_edit', editArgs, {
          ms: 380, chars: 1180,
          result: {
            change_set_id: proposed.change_set_id, version: 2, status: 'proposed',
            operation_count: proposed.proposal?.operation_count ?? 0, operation_names: proposed.proposal?.operation_names ?? [],
          },
        });
      }, 100],
      [() => ({ event: 'tool_action', data: proposedEdit() }), 300],
    ];
    // Asked to cite, with the papers found: one `cite_sources` call for the
    // point, its works checked, stored for review as `doc_edit` stores a set.
    const cite: TimedEvent[] = !(research === 'paper_search' && tools.has('cite_sources') && /\bcite\b/i.test(message)) ? [] : (() => {
      const citeArgs = { content_redacted: true, citations_count: 1, sources_count: 2, passages_count: 0 };
      let stored: StoredChangeSet | null = null;
      return [
        [callStart('cite_sources', 'call_cite'), 400],
        [callArgs('cite_sources', 'call_cite', citeArgs), 900],
        [() => {
          const records = found.slice(0, 2).map((handle) => evidence.recordOf(handle)).filter((record): record is Work['record'] => Boolean(record)).map(checkedRecord);
          found.slice(0, 2).forEach((handle, index) => {
            const record = records[index];
            if (record) evidence.checked(handle, record);
          });
          stored = storeCitations(documentId, 'p-2', { records, afterText: 'in compute' }, policy());
          if (!stored) return callEnd('cite_sources', 'call_cite', citeArgs, { ms: 120, code: 'invalid_request', error: 'The text to cite after is no longer in the block.' });
          return callEnd('cite_sources', 'call_cite', citeArgs, {
            ms: 870, chars: 640,
            result: {
              change_set_id: stored.change_set_id, status: 'proposed',
              operation_count: stored.operations.length, operation_names: stored.operations.map((operation) => operation.op),
              citations_count: 1,
            },
          });
        }, 100],
        [() => evidenceEvent(evidence), 150],
        [() => (stored ? { event: 'tool_action', data: citeAction(documentId, stored) } : null), 300],
      ] satisfies TimedEvent[];
    })();
    // Asked to check a claim, with the papers found: one `claim_check` over
    // them. It reads a passage of each (an abstract only, when asked about
    // abstracts), its `claim` event comes before its end, and the passages
    // it read arrive in the `evidence` event after it.
    const check: TimedEvent[] = !(research === 'paper_search' && tools.has('claim_check') && /\bclaim\b/i.test(message)) ? [] : (() => {
      const checkArgs = { content_redacted: true, claim_redacted: true, claim_length: 74, sources_count: 2 };
      const abstractOnly = /\babstracts?\b/i.test(message);
      let passages: string[] = [];
      return [
        [callStart('claim_check', 'call_claim'), 300],
        [callArgs('claim_check', 'call_claim', checkArgs), 1200],
        [() => {
          const [fedus, zoph] = PREVIEW_PAPERS as [Work, Work];
          passages = [
            ...evidence.register(fedus, [{ text: 'Switch Transformers route each token to a single expert.', level: abstractOnly ? 'abstract' : 'full_text' }]).passages,
            ...evidence.register(zoph, [{ text: 'Router z-loss improves stability without degrading quality.', level: 'abstract' }]).passages,
          ];
          const [first, second] = passages as [string, string];
          return {
            event: 'claim',
            data: abstractOnly
              ? {
                  tool_call_id: 'call_claim', verdict: 'insufficient', evidence_level: 'abstract', cannot_assess: true,
                  passages: [{ id: first, level: 'abstract', stance: 'unrelated' }, { id: second, level: 'abstract', stance: 'unrelated' }],
                }
              : {
                  tool_call_id: 'call_claim', verdict: 'partly', evidence_level: 'full_text', cannot_assess: false,
                  passages: [{ id: first, level: 'full_text', stance: 'supports' }, { id: second, level: 'abstract', stance: 'limits' }],
                },
          } satisfies AssistantEvent;
        }, 200],
        [() => callEnd('claim_check', 'call_claim', checkArgs, {
          ms: 1830, chars: 1_210, result: { verdict: abstractOnly ? 'insufficient' : 'partly', passages_count: passages.length },
        }), 150],
        [() => evidenceEvent(evidence), 200],
      ] satisfies TimedEvent[];
    })();
    if (earlier) events.push(...reasoningEvents('The source found earlier answers this; there is nothing new to look up.'));
    else if (!/\bimprove\b/i.test(message)) events.push(...search, ...check, ...cite);
    else if (/\b(sources?|cite|citations?|research|literature|papers?)\b/i.test(message)) events.push(...search, ...edit);
    else events.push(...edit, ...search);
  }
  // The drafted paragraph cites a paper: its source is registered and sent
  // with it, or the preview would insert a literal "[S1]".
  if (inline && !inline.passage) {
    events.push([() => {
      found = [evidence.register(PREVIEW_PAPERS[0] as Work).handle];
      return evidenceEvent(evidence);
    }, 100]);
  }
  // The socket stops asking for events when the run is cancelled, which
  // ends this generator at its next pause.
  for (const [event, pauseMs = 250] of events) {
    const item = typeof event === 'function' ? event() : event;
    if (item) yield item;
    await pause(pauseMs);
  }
  const [first, second] = found;
  const reply = inline
    ? inlineReply(inline.passage, inline.preset, first, inline.previous)
    : `Here is what I found about "${message.slice(0, 60)}".\n\n`
      + (earlier
        ? `As the source found earlier showed, top-1 routing keeps per-token compute constant [${earlier}].\n\n`
        : first && second
          ? `Top-1 routing keeps per-token compute constant while the parameter count grows [${first}]. Router z-loss stabilises training at scale [${second}].\n\n`
          : 'Top-1 routing keeps per-token compute constant while the parameter count grows. Router z-loss stabilises training at scale.\n\n')
      + (attached ? `The attached PDF (${attached.record.csl.title}) reports the same trade-off.\n\n` : '')
      + '- **Load balance**: keep the auxiliary coefficient around `1e-2`.\n'
      + '- **Capacity factor**: 1.25 is a good default for training.\n'
      // Asking about maths or a diagram exercises the chat's KaTeX and Mermaid
      // rendering, including a fence that is drawn only once it has closed.
      + (/\b(diagram|mermaid|flowchart|math|maths|equation|latex|formula)\b/i.test(message)
        ? '\nThe balance loss is $\\mathcal{L}_{aux} = \\alpha N \\sum_{i=1}^{N} f_i P_i$, where $f_i$ is the share of tokens sent to expert $i$:\n\n'
          + '$$\nP_i = \\frac{1}{T} \\sum_{x \\in \\mathcal{B}} p_i(x)\n$$\n\n'
          + '```mermaid\nsequenceDiagram\n  participant T as Token\n  participant R as Router\n  participant E as Expert\n  T->>R: hidden state\n  R->>E: top-1 dispatch\n  E-->>T: gated output\n```\n'
        : '');
  for (const word of reply.split(/(?<= )/)) {
    yield { event: 'token', data: { content: word } };
    await pause(18);
  }
  if (/\blimit\b/i.test(message)) reach('model_calls');
  if (/\bunsaved\b/i.test(message)) failWrite('llm_call');
  yield turnDone(turn, engine, rewrite);
}

/**
 * One assistant turn, as the preview runs it: keeps the question in the chat
 * when the run starts (an inline run keeps no chat), yields the canned
 * events, and stores the answer with its record when the run ends.
 */
async function* reviewTurn(request: AgentChatRequest, context: AssistantTurnContext): AsyncGenerator<AssistantEvent> {
  const doc = workspaceDocument(context.workspaceId, request.document_id);
  if (!doc || !request.review) throw new Error('Review page not found');
  const summary = beginReview(doc._id, context.runId, request.review, context.sessionId ?? null, context.afterSeq ?? null);
  context.onSettled(({ status }) => { finishReview(doc._id, context.runId, status); });
  const readArgs = { content_redacted: true, operation_count: 0, operation_names: [], block_count: 0 };
  yield callStart('doc_read', 'review-read');
  yield callArgs('doc_read', 'review-read', readArgs);
  await pause(300);
  yield callEnd('doc_read', 'review-read', readArgs, { ms: 300, chars: 1000, result: { block_count: doc.blocks.length } });
  yield { event: 'status', data: { status: 'thinking', detail: 'Filtering review findings…', apply_policy: 'review', auto_blocked_reason: null } };
  await pause(350);
  yield callStart('doc_comment', 'review-comments');
  yield callArgs('doc_comment', 'review-comments', readArgs);
  const comments = scriptedReviewFindings(doc, summary);
  yield callEnd('doc_comment', 'review-comments', readArgs, { ms: 150, chars: 400, result: { comment_count: comments.length } });
  if (comments.length) yield { event: 'comment', data: {
    comments: comments.map(({ comment_id, block_id, quote, kind, severity }) => ({ comment_id, block_id, quote, kind, severity })),
  } };
  await pause(200);
  yield turnDone(null, request.engine ?? 'gateway');
}

export function assistantTurn(request: AgentChatRequest, context: AssistantTurnContext): AsyncGenerator<AssistantEvent> {
  if (request.profile === 'review') return reviewTurn(request, context);
  const { workspaceId } = context;
  let approved: ChatPlan | null = null;
  if (request.plan_id) {
    approved = planOf(workspaceId, request.document_id, request.chat_id ?? '', request.plan_id);
    if (!approved || !['proposed', 'running', 'stopped'].includes(approved.state)) {
      throw new MockPlanRefusal('plan_not_found', 'That plan is not available in this chat.');
    }
    if (request.plan && !context.resumedFrom) approved = editPlan(approved, request.plan);
  }
  const chat = request.chat_id ? chatsOf(request.document_id).find((item) => item.id === request.chat_id) : undefined;
  const leaf = request.leaf_id ?? (chat && newestMessage(chat)?.id);
  const lastReply = chat && leaf
    ? [...messageChain(chat, leaf)].reverse().find((item) => item.role === 'assistant')
    : undefined;
  const asked = lastReply?.record?.kind === 'reply' ? lastReply.record.question ?? undefined : undefined;
  const message = [
    request.message?.trim(),
    request.answers ? questionAnswerText(asked, request.answers) : undefined,
    !request.message?.trim() && approved ? 'Write the approved plan, section by section.' : undefined,
  ].filter(Boolean).join('\n\n');
  const attachments = (request.attachments ?? []).flatMap<MessageImage | MessagePdf>((ref) => {
    if (ref.kind === 'image') {
      const stored = readableAsset(workspaceId, ref.asset_id);
      if (!stored) throw new MockAssetError('asset_not_found', 'An attached image is unavailable. Remove it or upload it again.');
      return [{ kind: 'image', asset_id: stored.asset.asset_id, filename: stored.asset.filename, media_type: stored.asset.media_type, size_bytes: stored.asset.bytes }];
    }
    const resource = fixtures.pdfs.find((item) => item.id === ref.resource_id && item.workspace_id === workspaceId);
    return resource ? [{ kind: 'resource', resource_id: resource.id, filename: resource.filename, media_type: 'application/pdf', size_bytes: resource.byte_size }] : [];
  });
  const inline = request.profile === 'inline';
  const turn = inline
    ? null
    : recordQuestion(request.document_id, {
      chatId: request.chat_id ?? null, leafId: request.leaf_id ?? null, text: message, preset: request.preset ?? null, runId: context.runId,
      // Requested effort, not the Standard budget of an unapproved Deep plan.
      effort: request.effort ?? 'standard', web: request.web ?? false, planId: request.plan_id ?? null,
    }, attachments);
  // The conversation's store, so a later turn cites what an earlier one
  // found; an inline run keeps its evidence for the run. A chat run's
  // attached PDFs get their handles at its start.
  const evidence: TurnEvidence = {
    store: new RunEvidence((turn && chatEvidence(request.document_id, turn.chatId)) || emptyEvidence()),
    pdfs: inline ? [] : (request.attachments ?? []).flatMap((ref) => {
      if (ref.kind !== 'resource') return [];
      const resource = fixtures.pdfs.find((item) => item.id === ref.resource_id && item.workspace_id === workspaceId);
      return resource ? [pdfWork(resource)] : [];
    }),
  };
  if (turn) {
    linkChatAssets(workspaceId, request.document_id, turn.chatId,
      attachments.flatMap((item) => item.kind === 'image' ? [item.asset_id] : []));
    if (approved) {
      const planId = approved.plan_id;
      context.onSettled(() => {
        const current = planOf(workspaceId, request.document_id, turn.chatId, planId);
        if (!current || current.state !== 'running' || current.run_id !== context.runId) return;
        return [{ event: 'plan', data: planEvent(endPlan(current)) }];
      });
    }
    context.onSettled(({ status, record, ledger }) => {
      recordAnswer(request.document_id, { ...turn, runId: context.runId }, record.text, record.snapshot(status, ledger.recorded()), record.hasActivity);
    });
    if (approved) return withAttachments(evidence, planTurn(request, context, turn, approved));
    if (context.tools.has('image_generate') && /\b(image|illustration|cover picture)\b/i.test(message)) {
      return withAttachments(evidence, imageRequestTurn(request, context, turn));
    }
    if (request.answers || (context.tools.has('author_ask') && /\bask me\b|\bclarif(?:y|ication)\b/i.test(message))) {
      return withAttachments(evidence, questionTurn(turn, request.engine ?? 'gateway', Boolean(request.answers), !request.answers?.items?.length));
    }
    if (approved || (request.effort === 'deep' && context.tools.has('plan_propose'))) {
      return withAttachments(evidence, planTurn(request, context, turn, approved));
    }
  }
  return withAttachments(evidence, scriptedTurn(
    message,
    inline ? { passage: inlinePassage(request, workspaceId), preset: request.preset ?? null,
      previous: (() => {
        const visible = new Set((workspaceDocument(workspaceId, request.document_id)?.blocks ?? [])
          .filter((block) => !block.aiHidden).map((block) => block.id));
        const ids = [request.context?.block_id, request.context?.selection?.block_id, ...(request.context?.block_ids ?? [])].filter(Boolean);
        return ids.length && ids.every((id) => visible.has(id as string)) ? request.context?.previous_result : undefined;
      })() } : undefined,
    turn,
    request.document_id,
    request.engine ?? 'gateway',
    context,
    evidence,
  ));
}
