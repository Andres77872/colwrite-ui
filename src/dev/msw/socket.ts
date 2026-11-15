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
import type {
  AgentChatRequestInput,
  AssistantEvent,
  AssistantRun,
  AssistantServerMessage,
  AssistantSession,
  ErrorCode,
  MessageImage,
  MessagePdf,
  RunStatusData,
  ToolActionData,
} from '@/api/schema';
import { chatsOf, enabledFeatures, fixtures, liveWorkspace, recordTurn, storeProposedEdits, workspaceDocument, workspacePolicyOf } from './fixtures';

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
};
type StoredSession = { session: AssistantSession; events: EventMessage[]; runs: StoredRun[]; fingerprint: string };

/** What a run's turn is told besides its request: where it runs. */
export type AssistantTurnContext = { workspaceId: string };
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
  /** The agent features the run has on (`todos`, `subagents`). */
  enabledFeatures?: () => string[] | Promise<string[]>;
};

const terminal = new Set<RunStatus>(['completed', 'failed', 'cancelled']);

/**
 * The review policy the API gives a run's change sets (D18): `auto` when an
 * assistant-mode turn asked for it with `apply_mode: "auto"` and the
 * workspace's policy allows Auto, `review` otherwise. The preview's runs use
 * no web research, which would refuse it.
 */
export function applyPolicyFor(request: Pick<AgentChatRequest, 'apply_mode' | 'mode'>, workspaceId: string): 'auto' | 'review' {
  return autoRequested(request) && workspacePolicyOf(workspaceId).auto ? 'auto' : 'review';
}

/** Why a turn that asked for Auto got `review`: the workspace switched Auto off. */
export function autoBlockedFor(request: Pick<AgentChatRequest, 'apply_mode' | 'mode'>, workspaceId: string): 'policy' | null {
  return autoRequested(request) && !workspacePolicyOf(workspaceId).auto ? 'policy' : null;
}

const autoRequested = (request: Pick<AgentChatRequest, 'apply_mode' | 'mode'>) =>
  request.apply_mode === 'auto' && request.mode !== 'rewrite';

const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${fingerprint(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const publicRun = (run: StoredRun): AssistantRun => {
  const { events: _events, fingerprint: _fingerprint, abandoned: _abandoned, ...row } = run;
  return copy(row);
};

/** The codes this mock answers with; none of them is retryable (`docs/errors.md`). */
type RpcCode = Extract<
  ErrorCode,
  | 'invalid_request'
  | 'workspace_not_found'
  | 'document_not_found'
  | 'chat_not_found'
  | 'session_not_found'
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
const instances = new Set<{ reset: () => void }>();

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
  const features = options.enabledFeatures ?? enabledFeatures;
  const sessions = new Map<string, StoredSession>();
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
      for (const connection of connections) connection.subscriptions.clear();
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
    const envelope = {
      type: 'event', session_id: stored.session.id, run_id: run.id, seq: ++stored.session.last_seq, event: item.event, data: copy(item.data),
    } as EventMessage;
    const now = new Date().toISOString();
    stored.session.updated_at = now;
    run.updated_at = now;
    stored.events.push(envelope);
    run.event_count += 1;
    run.event_bytes += JSON.stringify(item.data).length;
    for (const connection of connections) replay(connection, stored);
  };
  const finish = (stored: StoredSession, run: StoredRun, status: RunStatus) => {
    if (terminal.has(run.status)) return;
    run.status = status;
    stored.session.active_run_id = null;
    append(stored, run, { event: 'run.status', data: { run_id: run.id, status, message: null } });
  };

  async function execute(stored: StoredSession, run: StoredRun): Promise<void> {
    if (run.abandoned || run.status !== 'queued') return;
    run.status = 'running';
    append(stored, run, { event: 'run.status', data: { run_id: run.id, status: 'running', message: null } });
    // A run opens with `starting`, so the composer knows the policy first.
    const policy = applyPolicyFor(run.request, stored.session.workspace_id);
    const blocked = autoBlockedFor(run.request, stored.session.workspace_id);
    append(stored, run, { event: 'status', data: { status: 'starting', detail: 'Starting…', apply_policy: policy, auto_blocked_reason: blocked } });
    let sawTerminal = false;
    const live = () => !run.abandoned && run.status === 'running';
    try {
      const enabled = await features();
      if (!live()) return;
      const plan = enabled.includes('todos') && !stored.session.ephemeral;
      const worker = enabled.includes('subagents') && !stored.session.ephemeral;
      const engine = run.request.engine ?? 'gateway';
      const workerId = `preview-worker-${run.id}`;
      const items = [
        { id: 'preview-review', content: 'Review the fixture evidence (preview)', status: 'in_progress' },
        { id: 'preview-synthesis', content: 'Summarize the fixture findings', status: 'pending' },
      ] as const;
      if (plan) append(stored, run, { event: 'todo', data: { items: [...items] } });
      // A worker's tool calls reach the client namespaced by its id, as the
      // API sends them (`<worker id>:<call id>`), in between the lead's own.
      const workerCall = `${workerId}:call_1`;
      const workerQuery = { query: 'router z-loss stability' };
      if (worker) {
        append(stored, run, { event: 'subagent', data: { id: workerId, status: 'running', engine } });
        append(stored, run, { event: 'tool_call_start', data: { tool: 'web_search', tool_call_id: workerCall, arguments: {}, arguments_preview: '{}', arguments_deferred: true } });
        append(stored, run, { event: 'tool_call_args', data: { tool: 'web_search', tool_call_id: workerCall, arguments: workerQuery, arguments_preview: JSON.stringify(workerQuery), arguments_truncated: null } });
      }
      let moved = false;
      const events = stream(run.request, { workspaceId: stored.session.workspace_id })[Symbol.asyncIterator]();
      run.events = events;
      while (live()) {
        const next = await events.next();
        if (!live() || next.done) break;
        let item = next.value;
        if (!record(item) || !record(item.data)) throw new Error('Invalid preview event');
        if (item.event === 'session.chat') stored.session.chat_id = item.data.chat_id;
        // Every status of a run carries its effective review policy.
        if (item.event === 'status') item = { event: 'status', data: { ...item.data, apply_policy: item.data.apply_policy ?? policy, auto_blocked_reason: item.data.auto_blocked_reason ?? blocked } };
        if (item.event === 'tool_call_end' && !moved) {
          // The lead finished its first step: the worker reports back and
          // the plan moves on, so the pinned task list is seen changing.
          moved = true;
          if (worker) {
            append(stored, run, { event: 'tool_call_end', data: { tool: 'web_search', tool_call_id: workerCall, duration_ms: 1840, is_error: false, error: null, error_type: null, output_preview: '6 results', output_chars: 2100, output_truncated: false, arguments: null, arguments_preview: null, arguments_truncated: null } });
            append(stored, run, { event: 'subagent', data: { id: workerId, status: 'completed', engine } });
          }
          if (plan) append(stored, run, { event: 'todo', data: { items: [{ ...items[0], status: 'completed' }, { ...items[1], status: 'in_progress' }] } });
        }
        if (item.event === 'done') {
          if (typeof item.data.chat_id === 'string') {
            stored.session.chat_id = item.data.chat_id;
            append(stored, run, { event: 'session.chat', data: { chat_id: item.data.chat_id } });
          }
          if (plan) append(stored, run, { event: 'todo', data: { items: items.map((entry) => ({ ...entry, status: 'completed' as const })) } });
          if (worker && !moved) append(stored, run, { event: 'subagent', data: { id: workerId, status: 'completed', engine } });
        }
        append(stored, run, item);
        if (item.event === 'done' || item.event === 'error') {
          sawTerminal = true;
          finish(stored, run, item.event === 'done' ? 'completed' : 'failed');
        }
      }
      if (live() && !sawTerminal) throw new Error('Preview stream stopped before completion');
    } catch {
      if (live()) {
        append(stored, run, { event: 'error', data: { error_code: 'PREVIEW_STREAM_ERROR', message: 'The fixture assistant stream could not finish.', engine: null, engine_state: null, login_command: null } });
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
        ephemeral: params.ephemeral === true,
      };
      if (normalized.ephemeral && normalized.chat_id) throw new RpcError('invalid_request', 'Ephemeral sessions cannot resume a chat');
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
        .filter((row) => row.workspace_id === workspaceId && row.document_id === documentId && !row.ephemeral
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
      const request = params.request as AgentChatRequest;
      text(request.message, 'message');
      const hash = fingerprint(request);
      const previous = stored.runs.find((run) => run.request_id === requestId);
      if (previous) {
        if (previous.fingerprint !== hash) throw new RpcError('conflict', 'Run request_id already used for a different request');
        return publicRun(previous);
      }
      if (
        request.document_id !== stored.session.document_id
        || (request.ephemeral === true) !== stored.session.ephemeral
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
        fingerprint: hash, status: 'queued', event_count: 0, event_bytes: 0, created_at: now, updated_at: now,
      };
      stored.runs.push(run);
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
 * A canned Ask AI rewrite (`mode: 'rewrite'`, `ephemeral`): the passage back
 * with a few words changed, so the prompt's diff view has something to show;
 * on an empty line, a short drafted paragraph.
 */
function rewriteReply(message: string): string {
  const passage = message.split('\nPassage:\n')[1]?.trim();
  if (!passage) {
    return 'Sparse expert models decouple capacity from compute: each token visits one expert, so parameters grow while the cost per token stays flat [S1].';
  }
  return passage
    .replace(/\bwe show\b/i, 'we demonstrate')
    .replace(/\bThe router\b/, 'A learned router')
    .replace(/\bwith a learned gate\b/, 'through a gating network')
    .replace(/\bmost promising\b/, 'most credible');
}

/** The `tool_action` of a stored `doc_edit` proposal: it names the set and carries none of its operations. */
function proposedAction(documentId: string, applyPolicy: 'auto' | 'review'): ToolActionData {
  const changeSet = storeProposedEdits(documentId, applyPolicy);
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
    apply_policy: applyPolicy,
    auto_blocked_reason: null,
    proposal: {
      content_redacted: true,
      operation_count: changeSet.operations.length,
      operation_names: changeSet.operations.map((operation) => operation.op),
      base_head_seq: 2,
      base_revision_id: 'rev-2',
      depends_on_change_set_id: null,
    },
  };
}

/** Local engine names, as the server's `status: starting` names them. */
const ENGINE_NAMES: Partial<Record<NonNullable<AgentChatRequest['engine']>, string>> = { claude: 'Claude Code', codex: 'Codex' };

/** One event and how long the preview waits after sending it. An event given as a function is made when it is sent. */
type TimedEvent = [event: AssistantEvent | (() => AssistantEvent), pauseMs?: number];

/** Reasoning streamed in small fragments, the way a thinking model sends it. */
function reasoningEvents(textValue: string): TimedEvent[] {
  return textValue.split(/(?<= )/).map((piece) => [{ event: 'reasoning', data: { content: piece } }, 35]);
}

/**
 * A canned assistant turn in the order and shape the API sends it: an engine
 * start for a local CLI, reasoning, a research call (announced with deferred
 * arguments, then its arguments, then its outcome), sources, a drafted edit
 * whose length is reported while it is written, and prose with [S1] markers.
 * Pauses are long enough to see each progress state in the preview.
 */
async function* scriptedTurn(
  message: string,
  rewrite: boolean,
  turn: { chatId: string; messageId: number } | null,
  documentId: string,
  engine: NonNullable<AgentChatRequest['engine']>,
  applyPolicy: 'auto' | 'review',
): AsyncGenerator<AssistantEvent> {
  const events: TimedEvent[] = [];
  const chatId = turn?.chatId ?? null;
  if (chatId) events.push([{ event: 'session.chat', data: { chat_id: chatId } }, 0]);
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
  if (!rewrite) {
    const query = 'sparse mixture of experts long context';
    events.push(
      [{ event: 'tool_call_start', data: { tool: 'semantic_scholar_search', tool_call_id: 'call_1', arguments: {}, arguments_preview: '{}', arguments_deferred: true } }, 150],
      [{ event: 'tool_call_args', data: { tool: 'semantic_scholar_search', tool_call_id: 'call_1', arguments: { query }, arguments_preview: JSON.stringify({ query }), arguments_truncated: null } }, 2600],
      [{ event: 'tool_call_end', data: { tool: 'semantic_scholar_search', tool_call_id: 'call_1', duration_ms: 2612, is_error: false, error: null, error_type: null, output_preview: '5 papers', output_chars: 4200, output_truncated: false, arguments: null, arguments_preview: null, arguments_truncated: null } }, 150],
      [
        {
          event: 'sources',
          data: {
            sources: [
              { id: 'S1', key: '2101.03961', title: 'Switch Transformers', authors: 'William Fedus, Barret Zoph, Noam Shazeer', year: '2021', venue: 'JMLR', url: 'https://arxiv.org/abs/2101.03961', provider: 'semantic_scholar', origin: 'semantic_scholar_search' },
              { id: 'S2', key: '2202.08906', title: 'ST-MoE: Designing Stable and Transferable Sparse Expert Models', authors: 'Barret Zoph, Irwan Bello, Sameer Kumar', year: '2022', venue: 'arXiv', url: 'https://arxiv.org/abs/2202.08906', provider: 'semantic_scholar', origin: 'semantic_scholar_search' },
            ],
          },
        },
        200,
      ],
      ...reasoningEvents('Two strong sources. Switch Transformers covers top-1 routing; ST-MoE covers stability at scale.'),
    );
    if (/\bimprove\b/i.test(message)) {
      events.push(
        [{ event: 'tool_call_start', data: { tool: 'doc_edit', tool_call_id: 'call_edit', arguments: {}, arguments_preview: '{}', arguments_deferred: true } }, 1000],
        [{ event: 'tool_call_progress', data: { tool: 'doc_edit', tool_call_id: 'call_edit', arguments_chars: 640 } }, 1000],
        [{ event: 'tool_call_progress', data: { tool: 'doc_edit', tool_call_id: 'call_edit', arguments_chars: 1480 } }, 1000],
        [{ event: 'tool_call_progress', data: { tool: 'doc_edit', tool_call_id: 'call_edit', arguments_chars: 2410 } }, 600],
        [{ event: 'tool_call_args', data: { tool: 'doc_edit', tool_call_id: 'call_edit', arguments: { content_redacted: true, operation_count: 3, operation_names: ['replace_block', 'insert_block_after', 'delete_block'], block_count: 2 }, arguments_preview: '{"content_redacted": true, "operation_count": 3}', arguments_truncated: null } }, 400],
        [{ event: 'tool_call_end', data: { tool: 'doc_edit', tool_call_id: 'call_edit', duration_ms: 380, is_error: false, error: null, error_type: null, output_preview: '{"status": "proposed"}', output_chars: 120, output_truncated: false, arguments: null, arguments_preview: null, arguments_truncated: null } }, 100],
        // Stored when the call ends, as `doc_edit` stores it.
        [() => ({ event: 'tool_action', data: proposedAction(documentId, applyPolicy) }), 300],
      );
    }
  }
  const reply = rewrite
    ? rewriteReply(message)
    : `Here is what I found about "${message.slice(0, 60)}".\n\n`
      + 'Top-1 routing keeps per-token compute constant while the parameter count grows [S1]. '
      + 'Router z-loss stabilises training at scale [S2].\n\n'
      + '- **Load balance**: keep the auxiliary coefficient around `1e-2`.\n'
      + '- **Capacity factor**: 1.25 is a good default for training.\n'
      // Asking about maths or a diagram exercises the chat's KaTeX and Mermaid
      // rendering, including a fence that is drawn only once it has closed.
      + (/\b(diagram|mermaid|flowchart|math|maths|equation|latex|formula)\b/i.test(message)
        ? '\nThe balance loss is $\\mathcal{L}_{aux} = \\alpha N \\sum_{i=1}^{N} f_i P_i$, where $f_i$ is the share of tokens sent to expert $i$:\n\n'
          + '$$\nP_i = \\frac{1}{T} \\sum_{x \\in \\mathcal{B}} p_i(x)\n$$\n\n'
          + '```mermaid\nsequenceDiagram\n  participant T as Token\n  participant R as Router\n  participant E as Expert\n  T->>R: hidden state\n  R->>E: top-1 dispatch\n  E-->>T: gated output\n```\n'
        : '');
  // The socket stops asking for events when the run is cancelled, which
  // ends this generator at its next pause.
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  for (const [event, pauseMs = 250] of events) {
    yield typeof event === 'function' ? event() : event;
    await pause(pauseMs);
  }
  for (const word of reply.split(/(?<= )/)) {
    yield { event: 'token', data: { content: word } };
    await pause(18);
  }
  yield { event: 'done', data: { chat_id: chatId, message_id: turn?.messageId ?? null, usage: { prompt_tokens: 5120, completion_tokens: 210 } } };
}

/**
 * One assistant turn, as the preview runs it: records the user's message in
 * the chat (an ephemeral rewrite keeps no chat) and yields the canned events.
 */
export function assistantTurn(request: AgentChatRequest, { workspaceId }: AssistantTurnContext): AsyncGenerator<AssistantEvent> {
  const message = request.message ?? '';
  const attachments = (request.attachments ?? []).flatMap<MessageImage | MessagePdf>((ref) => {
    if (ref.kind === 'image') {
      const stored = fixtures.images.get(ref.image_id);
      return stored && stored.workspaceId === workspaceId
        ? [{ kind: 'image', image_id: stored.image.id, filename: stored.image.filename, media_type: stored.image.media_type, size_bytes: stored.image.size_bytes }]
        : [];
    }
    const resource = fixtures.pdfs.find((item) => item.id === ref.resource_id && item.workspace_id === workspaceId);
    return resource ? [{ kind: 'resource', resource_id: resource.id, filename: resource.filename, media_type: 'application/pdf', size_bytes: resource.byte_size }] : [];
  });
  const turn = request.ephemeral === true
    ? null
    : recordTurn(request.document_id, request.chat_id ?? null, request.leaf_id ?? null, message, attachments);
  return scriptedTurn(
    message,
    request.mode === 'rewrite' && request.ephemeral === true,
    turn,
    request.document_id,
    request.engine ?? 'gateway',
    applyPolicyFor(request, workspaceId),
  );
}
