import type {
  AssistantEvent,
  DoneData,
  ErrorData,
  SourceEntry,
  StatusData,
  SubagentData,
  TodoItem,
  ToolActionData,
  ToolCallArgsData,
  ToolCallEndData,
  ToolCallStartData,
} from '@/api/schema';
import type {
  ApplyPolicy,
  AutoBlockedReason,
  CitationSource,
  ToolAction,
  ToolOperation,
  ToolOperationResult,
} from '@/editor/types';
import { isUnknownRecord } from '@/lib/json';

// ── Event handler types ──

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
 * A source a research tool returned during the run, as the server's source
 * registry recorded it: bibliographic metadata only, under the `id` the
 * assistant cites it by in its answer (`[S3]`).
 */
export type AgentSource = CitationSource & {
  id: string;
  /** The tool that returned it (`semantic_scholar_search`, `web_read`, …). */
  origin?: string;
};

const SOURCE_HANDLE = /^S[1-9]\d{0,4}$/;

/** Keep only well-formed sources; the event is untrusted like any other. */
function mapSources(raw: readonly SourceEntry[]): AgentSource[] {
  const out: AgentSource[] = [];
  for (const record of raw) {
    if (typeof record.id !== 'string' || !SOURCE_HANDLE.test(record.id)) continue;
    if (typeof record.key !== 'string' || !record.key) continue;
    const source: AgentSource = { id: record.id, key: record.key };
    for (const field of ['title', 'authors', 'year', 'venue', 'url', 'doi', 'providerId', 'pdfUrl', 'kind', 'accessed', 'origin'] as const) {
      if (typeof record[field] === 'string') (source as Record<string, unknown>)[field] = record[field];
    }
    if (['arxiv', 'semantic_scholar', 'crossref', 'web', 'resource', 'manual'].includes(String(record.provider))) {
      source.provider = record.provider as AgentSource['provider'];
    }
    if (isUnknownRecord(record.externalIds)) {
      source.externalIds = Object.fromEntries(
        Object.entries(record.externalIds).filter(
          (pair): pair is [string, string] => typeof pair[1] === 'string',
        ),
      );
    }
    if (typeof record.citationCount === 'number') source.citationCount = record.citationCount;
    out.push(source);
  }
  return out;
}

export type AgentTodo = TodoItem;
export type AgentWorker = { id: string; status: string; engine: string };

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
  /** Sources the run's research tools returned, as they arrive. */
  onSources?: (sources: AgentSource[]) => void;
  onStatus?: (status: string, detail: string) => void;
  /**
   * The run's effective apply policy, from its `status` events (D18): `auto`
   * when the server granted Auto for it, otherwise `review` with the reason
   * when the request asked for Auto.
   */
  onApplyPolicy?: (policy: ApplyPolicy, blockedReason: AutoBlockedReason | null) => void;
  onToolCallStart?: (tool: string, toolCallId: string, args: Record<string, unknown>) => void;
  onToolCallArgs?: (event: ToolCallArgsEvent) => void;
  onToolCallEnd?: (event: ToolCallEndEvent) => void;
  onToolAction?: (action: ToolAction) => void;
  onError?: (errorCode: string, message: string) => void;
  onDone?: (
    chatId: string | null,
    messageId: number | null,
    usage: { promptTokens: number; completionTokens: number },
  ) => void;
};

/** What one event meant for the turn: whether it ended it, and how. */
export type AgentEventOutcome = {
  chatId: string | null;
  messageId: number | null;
  /**
   * Whether this event ended the turn. `null` for every event but the
   * terminal `done` and `error`.
   */
  terminal: 'done' | 'error' | null;
};

const NO_OUTCOME: AgentEventOutcome = { chatId: null, messageId: null, terminal: null };

/* ----------------------------------------
   Decoding: untrusted frames into the generated `AssistantEvent`
   ---------------------------------------- */

/**
 * A status the client treats as open: a newer server may add one, and the
 * client shows an unknown run status like `thinking` and an unknown worker
 * status as sent (`ColWrite-api/docs/agent-sse-protocol.md`).
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
const AUTO_BLOCKED_REASONS = new Set<AutoBlockedReason>(['web_research', 'role', 'policy']);

function applyPolicyOf(value: unknown): ApplyPolicy | null {
  return APPLY_POLICIES.has(value as ApplyPolicy) ? (value as ApplyPolicy) : null;
}

function blockedReasonOf(value: unknown): AutoBlockedReason | null {
  return AUTO_BLOCKED_REASONS.has(value as AutoBlockedReason) ? (value as AutoBlockedReason) : null;
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
    error_type: nonEmpty(data.error_type),
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
  sources: (data) => {
    if (!Array.isArray(data.sources)) return null;
    return { sources: data.sources.filter(isUnknownRecord) as SourceEntry[] };
  },
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
      usage: Object.fromEntries(
        Object.entries(usage).filter((pair): pair is [string, number] => typeof pair[1] === 'number'),
      ),
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
  subagent: (data) => (
    typeof data.id === 'string' && typeof data.status === 'string'
      ? { id: data.id, status: data.status, engine: typeof data.engine === 'string' ? data.engine : '' }
      : null
  ),
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
};

/**
 * Read one event of the assistant WebSocket into the generated union, or
 * `null` for an unknown event or a payload that carries nothing to act on.
 */
export function decodeAgentEvent(event: string, payload: unknown): DecodedAgentEvent | null {
  if (!isUnknownRecord(payload) || !Object.hasOwn(DECODERS, event)) return null;
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
export function handleAgentEvent(event: DecodedAgentEvent, handlers: AgentEventHandlers): AgentEventOutcome {
  switch (event.event) {
    case 'token':
      handlers.onToken?.(event.data.content);
      return NO_OUTCOME;
    case 'reasoning':
      handlers.onReasoning?.(event.data.content);
      return NO_OUTCOME;
    case 'tool_call_progress':
      handlers.onToolCallProgress?.({
        tool: event.data.tool,
        toolCallId: event.data.tool_call_id,
        argumentsChars: event.data.arguments_chars,
      });
      return NO_OUTCOME;
    case 'status': {
      const { status, detail, apply_policy: policy, auto_blocked_reason: reason } = event.data;
      if (policy) handlers.onApplyPolicy?.(policy, reason ?? null);
      handlers.onStatus?.(status, detail);
      return NO_OUTCOME;
    }
    case 'tool_call_start':
      handlers.onToolCallStart?.(event.data.tool, event.data.tool_call_id, event.data.arguments);
      return NO_OUTCOME;
    case 'tool_call_args':
      handlers.onToolCallArgs?.({
        tool: event.data.tool,
        toolCallId: event.data.tool_call_id,
        ...argumentFields(event.data),
      });
      return NO_OUTCOME;
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
      return NO_OUTCOME;
    }
    case 'tool_action':
      handlers.onToolAction?.(toolAction(event.data));
      return NO_OUTCOME;
    case 'sources': {
      const sources = mapSources(event.data.sources);
      if (sources.length) handlers.onSources?.(sources);
      return NO_OUTCOME;
    }
    case 'error':
      handlers.onError?.(event.data.error_code, event.data.message);
      return { chatId: null, messageId: null, terminal: 'error' };
    case 'done': {
      const { chat_id: chatId, message_id: messageId, usage } = event.data;
      handlers.onDone?.(chatId, messageId, {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
      });
      return { chatId, messageId, terminal: 'done' };
    }
    case 'todo':
      handlers.onTodo?.(event.data.items);
      return NO_OUTCOME;
    case 'subagent':
      handlers.onSubagent?.({ id: event.data.id, status: event.data.status, engine: event.data.engine });
      return NO_OUTCOME;
    case 'session.chat':
      handlers.onSessionChat?.(event.data.chat_id);
      return NO_OUTCOME;
    case 'run.status':
      // The session client reads the run's lifecycle itself (`agentSessionChat`).
      return NO_OUTCOME;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/** Dispatch one event of the assistant WebSocket to its handler. */
export function dispatchAgentEvent(
  event: string,
  payload: unknown,
  handlers: AgentEventHandlers,
): AgentEventOutcome {
  const decoded = decodeAgentEvent(event, payload);
  return decoded ? handleAgentEvent(decoded, handlers) : NO_OUTCOME;
}
