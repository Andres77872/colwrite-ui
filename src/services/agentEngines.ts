import { get, post } from './api';

/**
 * Which backend runs an agent turn (`POST /api/agent/chat` → `engine`).
 *
 * - `legacy` — the configured model gateway. The default, and the only engine
 *   a deployed ColWrite has.
 * - `claude` / `codex` — the developer's own Claude Code / Codex CLI, signed
 *   in with their own account. The API offers them only when it runs locally
 *   (`COLWRITE_ENVIRONMENT=local`) and the request comes straight from the
 *   same machine; it never signs anyone in and never falls back to another
 *   engine. See `ColWrite-api/docs/agent-engines.md`.
 */
export type AgentEngineId = 'legacy' | 'claude' | 'codex';

export const AGENT_ENGINE_IDS: readonly AgentEngineId[] = ['legacy', 'claude', 'codex'];
export const LOCAL_CLI_ENGINE_IDS: readonly AgentEngineId[] = ['claude', 'codex'];

export type AgentEngineState =
  | 'ready'
  | 'disabled'
  | 'not_installed'
  | 'unauthenticated'
  | 'unsupported_auth'
  | 'error';

export type AgentEngineStatus = {
  engine: AgentEngineId;
  name: string;
  state: AgentEngineState;
  available: boolean;
  /** Written for people; says what to do when the engine is not ready. */
  message: string;
  /** The official command to run in your own terminal to sign in. */
  login_command?: string;
  auth_method?: string;
  plan?: string;
  version?: string;
  checked_at?: number;
};

export type AgentEngineCatalog = {
  runtime: 'local' | 'deployed';
  default_engine: AgentEngineId;
  engines: AgentEngineStatus[];
};

/** Every engine as the server sees this request. */
export async function getAgentEngines(): Promise<AgentEngineCatalog> {
  return get<AgentEngineCatalog>('/agent/engines');
}

/** Re-probe one engine now — after signing in to its CLI, for example. */
export async function checkAgentEngine(engine: AgentEngineId): Promise<AgentEngineStatus> {
  return post<AgentEngineStatus>(`/agent/engines/${encodeURIComponent(engine)}/check`);
}

export function isAgentEngineId(value: unknown): value is AgentEngineId {
  return typeof value === 'string' && (AGENT_ENGINE_IDS as readonly string[]).includes(value);
}

/**
 * The server's rule for a CLI model override: an id or alias the CLI knows
 * (`sonnet`, `claude-sonnet-5`, `gpt-5.5-codex`), never a gateway id such as
 * `~anthropic/claude-haiku-latest`.
 */
const CLI_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;
const GATEWAY_MODEL_MAX = 200;

/** `null` when *model* is usable for *engine*, else why it is not. */
export function engineModelProblem(engine: AgentEngineId, model: string): string | null {
  if (!model) return null;
  if (engine === 'legacy') {
    if (/\s/.test(model)) return 'A model id has no spaces.';
    return model.length > GATEWAY_MODEL_MAX ? `At most ${GATEWAY_MODEL_MAX} characters.` : null;
  }
  return CLI_MODEL.test(model)
    ? null
    : 'Use a model id or alias this CLI knows (letters, digits, “.”, “-”, “_”, “:”), not a gateway id.';
}
