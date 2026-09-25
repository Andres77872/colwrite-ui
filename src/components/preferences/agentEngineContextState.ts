import { createContext, useContext } from 'react';
import {
  engineModelProblem,
  isAgentEngineId,
  type AgentEngineCatalog,
  type AgentEngineId,
  type AgentEngineStatus,
} from '@/services/agentEngines';

/**
 * Where an agent run starts: the chat assistant, or the inline AI (Ask AI,
 * selection rewrites, AI beat widgets). They can use different engines: a
 * local CLI takes a few seconds to start, which suits a conversation better
 * than a one-line rewrite.
 */
export type AgentEngineSurface = 'chat' | 'inline';

/**
 * The engine choice, kept on this device (localStorage), not the account: the
 * `claude` / `codex` engines are this machine's own CLIs.
 */
export type AgentEnginePrefs = {
  chat: AgentEngineId;
  /** `'chat'` follows the chat assistant's engine. */
  inline: AgentEngineId | 'chat';
  /** Per-engine model override; missing or empty means the engine's default. */
  models: Partial<Record<AgentEngineId, string>>;
};

export const DEFAULT_ENGINE_PREFS: AgentEnginePrefs = { chat: 'legacy', inline: 'chat', models: {} };

export function isAgentEnginePrefs(value: unknown): value is AgentEnginePrefs {
  if (!value || typeof value !== 'object') return false;
  const prefs = value as Record<string, unknown>;
  if (!isAgentEngineId(prefs.chat)) return false;
  if (prefs.inline !== 'chat' && !isAgentEngineId(prefs.inline)) return false;
  if (!prefs.models || typeof prefs.models !== 'object') return false;
  return Object.entries(prefs.models as Record<string, unknown>).every(
    ([engine, model]) => isAgentEngineId(engine) && typeof model === 'string',
  );
}

/** What `streamAgentChat` gets: nothing at all for the plain default. */
export type AgentEngineRequest = { engine?: AgentEngineId; model?: string };

/** The engine a surface uses, before the runtime is taken into account. */
export function selectedEngine(prefs: AgentEnginePrefs, surface: AgentEngineSurface): AgentEngineId {
  return surface === 'inline' && prefs.inline !== 'chat' ? prefs.inline : prefs.chat;
}

/**
 * The engine a request on *surface* actually names.
 *
 * A deployed API has no local engines at all, so a choice remembered from a
 * local session is ignored there rather than failing every request. Locally
 * the choice is sent as is, even when that CLI is not signed in: the server
 * then refuses with instructions, and nothing silently switches engines.
 */
export function effectiveEngine(
  prefs: AgentEnginePrefs,
  catalog: AgentEngineCatalog | null,
  surface: AgentEngineSurface,
): AgentEngineId {
  const engine = selectedEngine(prefs, surface);
  if (catalog?.runtime === 'deployed') return 'legacy';
  return engine;
}

export function resolveEngineRequest(
  prefs: AgentEnginePrefs,
  catalog: AgentEngineCatalog | null,
  surface: AgentEngineSurface,
): AgentEngineRequest {
  const engine = effectiveEngine(prefs, catalog, surface);
  const model = (prefs.models[engine] ?? '').trim();
  const usableModel = model && engineModelProblem(engine, model) === null ? model : '';
  if (engine === 'legacy' && !usableModel) return {};
  return usableModel ? { engine, model: usableModel } : { engine };
}

export type AgentEngineContextValue = {
  catalog: AgentEngineCatalog | null;
  loading: boolean;
  error: string | null;
  prefs: AgentEnginePrefs;
  /** The server runs locally, so engines can be chosen at all. */
  selectable: boolean;
  statusOf: (engine: AgentEngineId) => AgentEngineStatus | null;
  engineFor: (surface: AgentEngineSurface) => AgentEngineId;
  requestFor: (surface: AgentEngineSurface) => AgentEngineRequest;
  setChatEngine: (engine: AgentEngineId) => void;
  setInlineEngine: (engine: AgentEngineId | 'chat') => void;
  /** Saves a valid override (or clears it with `''`); returns why not otherwise. */
  setModel: (engine: AgentEngineId, model: string) => string | null;
  /** Engine being re-checked right now, if any. */
  checking: AgentEngineId | null;
  checkError: Partial<Record<AgentEngineId, string>>;
  check: (engine: AgentEngineId) => Promise<AgentEngineStatus | null>;
  refresh: () => Promise<void>;
  /** A run ended with this SSE error code; `ENGINE_*` re-reads the statuses. */
  noteRunError: (code: string) => void;
};

const noop = () => {};

/**
 * Outside the provider (isolated component tests, previews) everything runs
 * on the default engine exactly as before engines existed.
 */
const DEFAULT_CONTEXT: AgentEngineContextValue = {
  catalog: null,
  loading: false,
  error: null,
  prefs: DEFAULT_ENGINE_PREFS,
  selectable: false,
  statusOf: () => null,
  engineFor: () => 'legacy',
  requestFor: () => ({}),
  setChatEngine: noop,
  setInlineEngine: noop,
  setModel: () => null,
  checking: null,
  checkError: {},
  check: async () => null,
  refresh: async () => {},
  noteRunError: noop,
};

export const AgentEngineContext = createContext<AgentEngineContextValue | undefined>(undefined);

export function useAgentEngine(): AgentEngineContextValue {
  return useContext(AgentEngineContext) ?? DEFAULT_CONTEXT;
}
