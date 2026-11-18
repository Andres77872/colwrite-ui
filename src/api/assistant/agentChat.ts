import type { AgentChatRequestInput, AgentChatRequestOutput, AgentContext, EngineCatalogResponse, EngineStatusResponse } from '@/api/schema';
import { streamAgentSession, type CheckpointResume, type ResumeAgentRun } from './agentSessionChat';
import type { ChatAttachment } from './chatAttachments';
import type { AgentDone, AgentEventHandlers } from './streamParser';

// ── Types ──

/**
 * The kind of run (`ColWrite-api/src/models/agent_chat_request.py`).
 *
 * - `chat` — the assistant panel, stored as a chat; the agent may read,
 *   propose edits to and create pages. Its edits do **not** reach storage:
 *   the server stores them as change sets and sends them down as
 *   `tool_action` events with status `proposed`, which the editor shows on
 *   the affected blocks for the author to accept or reject, or applies
 *   itself while Auto is on.
 * - `inline` — Ask AI and the AI beats: the run returns text only, because
 *   the caller applies the result itself behind its own accept/reject
 *   affordance, and stores no chat. It cannot resume one or use Auto.
 *
 * Both end at the same place: the person editing the page decides what lands
 * in it.
 */
export type AgentRunProfile = AgentChatRequestInput['profile'];

/**
 * Where the author is working, sent next to the message rather than pasted
 * into it: the caret's block, the selected text (at most 4,000 characters)
 * and the blocks referenced as `#this/<id>` (at most 20). The server keeps
 * only blocks the model can see.
 */
export type AgentChatContext = Partial<AgentContext>;

export type AgentChatParams = {
  /** The workspace the page is in; every command of the run names it. */
  workspace_id: string;
  message: string;
  document_id: string;
  chat_id?: string | null;
  /** The message the turn continues from: an older branch of the chat. Omitted, the newest. */
  leaf_id?: number | null;
  model?: string | null;
  /** First choices from the server's configured main/lite gateway catalogs. */
  gateway_models?: Partial<Record<keyof EngineCatalogResponse['gateway_models'], string>>;
  /**
   * Which backend runs the turn. Omitted means the server default
   * (`gateway`). `claude` / `codex` exist only on a local API reached from
   * the same machine; the server rejects them otherwise with an `ENGINE_*`
   * error and never falls back to another engine.
   */
  engine?: EngineStatusResponse['engine'] | null;
  /** Omitted means `chat`. */
  profile?: AgentRunProfile;
  review?: NonNullable<AgentChatRequestInput['review']>;
  /**
   * A server preset id (`ColWrite-api/src/agent/profiles/presets.py`): the
   * server supplies its instruction, so the message carries only the
   * author's own words, and may be empty. Its profile must be the run's.
   */
  preset?: string;
  /** The run's catalog-backed budget tier; Deep without a plan scopes one first. */
  effort?: NonNullable<AgentChatRequestInput['effort']>;
  /** Opt this turn into public web search and page reading when the catalog permits them. Defaults to false. */
  web?: boolean;
  plan_id?: string;
  plan?: NonNullable<AgentChatRequestInput['plan']>;
  answers?: NonNullable<AgentChatRequestInput['answers']>;
  context?: AgentChatContext;
  attachments?: ChatAttachment[];
  /**
   * `auto` asks for the run's change sets to be applied by the open editor
   * without review (D18): sent while the author has Auto on in the chat
   * composer, and only for a `chat` run. The server decides; each set
   * carries the effective `apply_policy`. Omitted means `propose`.
   */
  apply_mode?: Extract<AgentChatRequestInput['apply_mode'], 'auto'>;
};

export type AgentChatResult = {
  /** The turn's `done`: its stored answer (the chat's new leaf), what served it, used and cost. */
  done: AgentDone | null;
  /**
   * How the stream ended: `done` (completed), `error` (server reported a
   * terminal error), or `null` — the connection closed without either, which
   * means the reply the user is looking at is incomplete.
   */
  terminal: 'done' | 'error' | null;
};

export type AgentChatRetryOptions = {
  /** Total attempts including the first one. Default 8. */
  maxAttempts?: number;
  /** First backoff delay. Default 500 ms, doubled on each attempt up to 10 seconds. */
  baseDelayMs?: number;
};

export type AgentChatOptions = {
  signal?: AbortSignal;
  /** Detach on navigation; explicit Stop uses signal.reason === 'cancel'. */
  abortBehavior?: 'cancel' | 'detach';
  resume?: ResumeAgentRun;
  /** New generation from an interrupted run's checkpoint, not event replay. */
  checkpoint?: CheckpointResume;
  /** Supplies the stored request when an uncertain start finds an existing run. */
  onRunStarted?: (run: ResumeAgentRun, admittedRequest?: AgentChatRequestOutput) => void;
  /**
   * WebSocket reconnect policy. The saved event cursor and idempotent start
   * key prevent duplicate generation. `{maxAttempts: 1}` disables retry.
   */
  retry?: AgentChatRetryOptions;
};

/**
 * Run one assistant turn over the durable WebSocket session
 * (`ColWrite-api/docs/assistant-websocket.md`), streaming its events to
 * `handlers`.
 */
export function runAgentTurn(
  params: AgentChatParams,
  handlers: AgentEventHandlers,
  opts?: AgentChatOptions,
): Promise<AgentChatResult> {
  return streamAgentSession(params, handlers, opts);
}
