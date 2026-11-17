import { createContext, useContext } from 'react';
import {
  engineModelProblem,
  gatewayModelsFor,
  isAgentEngineId,
  type AgentEngineCatalog,
  type AgentEngineId,
  type AgentEngineStatus,
  type GatewayModelSelection,
  type GatewayModelTier,
} from '@/data/agentEngines';

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
  /** Per-engine model; `gateway` is the gateway's general choice. Empty uses defaults. */
  models: Partial<Record<AgentEngineId, string>>;
  /** The gateway's lite model; absent uses the server's default. */
  liteModel?: string;
};

export const DEFAULT_ENGINE_PREFS: AgentEnginePrefs = { chat: 'gateway', inline: 'chat', models: {} };

export function isAgentEnginePrefs(value: unknown): value is AgentEnginePrefs {
  if (!value || typeof value !== 'object') return false;
  const prefs = value as Record<string, unknown>;
  if (!isAgentEngineId(prefs.chat)) return false;
  if (prefs.inline !== 'chat' && !isAgentEngineId(prefs.inline)) return false;
  if (!prefs.models || typeof prefs.models !== 'object') return false;
  if (prefs.liteModel !== undefined && typeof prefs.liteModel !== 'string') return false;
  return Object.entries(prefs.models as Record<string, unknown>).every(
    ([engine, model]) => isAgentEngineId(engine) && typeof model === 'string',
  );
}

/** What `runAgentTurn` gets: nothing at all for the plain default. */
export type AgentEngineRequest = {
  engine?: AgentEngineId;
  model?: string;
  gateway_models?: GatewayModelSelection;
};

/** The engine a surface uses, before the runtime is taken into account. */
export function selectedEngine(prefs: AgentEnginePrefs, surface: AgentEngineSurface): AgentEngineId {
  return surface === 'inline' && prefs.inline !== 'chat' ? prefs.inline : prefs.chat;
}

/**
 * The engine a request on *surface* actually names.
 *
 * Only a server that says it is local (`runtime: "local"`) has local engines.
 * A deployed one, and one whose catalog has not answered yet, gets the
 * gateway: a choice remembered from a local session is ignored rather than
 * failing a request, the first one included. Locally the choice is sent as
 * is, even when that CLI is not signed in: the server then refuses with
 * instructions, and nothing silently switches engines.
 */
function effectiveEngine(
  prefs: AgentEnginePrefs,
  catalog: AgentEngineCatalog | null,
  surface: AgentEngineSurface,
): AgentEngineId {
  return catalog?.runtime === 'local' ? selectedEngine(prefs, surface) : 'gateway';
}

export function resolveEngineRequest(
  prefs: AgentEnginePrefs,
  catalog: AgentEngineCatalog | null,
  surface: AgentEngineSurface,
): AgentEngineRequest {
  const engine = effectiveEngine(prefs, catalog, surface);
  const request: AgentEngineRequest = {};
  if (engine !== 'gateway') {
    request.engine = engine;
    const model = (prefs.models[engine] ?? '').trim();
    if (model && engineModelProblem(engine, model) === null) request.model = model;
  }
  const selected: GatewayModelSelection = {};
  const main = prefs.models.gateway?.trim();
  const lite = prefs.liteModel?.trim();
  if (main && gatewayModelsFor(catalog, 'main').includes(main)) selected.main = main;
  if (lite && gatewayModelsFor(catalog, 'lite').includes(lite)) selected.lite = lite;
  if (Object.keys(selected).length) request.gateway_models = selected;
  return request;
}

export type AgentEngineContextValue = {
  catalog: AgentEngineCatalog | null;
  loading: boolean;
  error: string | null;
  prefs: AgentEnginePrefs;
  /** The server runs locally, so engines can be chosen at all. */
  selectable: boolean;
  statusOf: (engine: AgentEngineId) => AgentEngineStatus | null;
  requestFor: (surface: AgentEngineSurface) => AgentEngineRequest;
  setChatEngine: (engine: AgentEngineId) => void;
  setInlineEngine: (engine: AgentEngineId | 'chat') => void;
  /** Saves a valid override (or clears it with `''`); returns why not otherwise. */
  setModel: (engine: AgentEngineId, model: string) => string | null;
  setGatewayModel: (tier: GatewayModelTier, model: string) => string | null;
  /** Engine being re-checked right now, if any. */
  checking: AgentEngineId | null;
  checkError: Partial<Record<AgentEngineId, string>>;
  check: (engine: AgentEngineId) => Promise<AgentEngineStatus | null>;
  refresh: () => Promise<void>;
  /** Engine errors and stale gateway selections re-read the server catalog. */
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
  requestFor: () => ({}),
  setChatEngine: noop,
  setInlineEngine: noop,
  setModel: () => null,
  setGatewayModel: () => null,
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
