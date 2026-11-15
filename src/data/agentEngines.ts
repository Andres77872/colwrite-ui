import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { EngineCatalogResponse, EngineStatusResponse } from '@/api/schema';

/**
 * Which backend runs an agent turn (the run request's `engine`).
 *
 * - `gateway` — the configured model gateway. The default, and the only engine
 *   a deployed ColWrite has.
 * - `claude` / `codex` — the developer's own Claude Code / Codex CLI, signed
 *   in with their own account. The API offers them only when it runs locally
 *   (`COLWRITE_ENVIRONMENT=local`) and the request comes straight from the
 *   same machine; it never signs anyone in and never falls back to another
 *   engine. See `ColWrite-api/docs/agent-engines.md`.
 */
export type AgentEngineId = EngineStatusResponse['engine'];

export const AGENT_ENGINE_IDS: readonly AgentEngineId[] = ['gateway', 'claude', 'codex'];

export type GatewayModelTier = keyof EngineCatalogResponse['gateway_models'];
export type GatewayModelCatalog = EngineCatalogResponse['gateway_models'];
export type GatewayModelSelection = Partial<Record<GatewayModelTier, string>>;

export type AgentEngineState = EngineStatusResponse['state'];

export type AgentEngineStatus = EngineStatusResponse;
export type AgentEngineCatalog = EngineCatalogResponse;

export function gatewayModelsFor(catalog: AgentEngineCatalog | null, tier: GatewayModelTier): string[] {
  const models = catalog?.gateway_models[tier] ?? [];
  return [...new Set(models.filter((model) => model !== '' && engineModelProblem('gateway', model) === null))];
}

/** Every engine as the server sees this request. */
export async function getAgentEngines(init?: { signal?: AbortSignal }): Promise<AgentEngineCatalog> {
  return unwrap(api.GET('/api/agent/engines', { signal: init?.signal }));
}

/** Re-probe one engine now — after signing in to its CLI, for example. */
export async function checkAgentEngine(engine: AgentEngineId): Promise<AgentEngineStatus> {
  return unwrap(api.POST('/api/agent/engines/{engine_id}/check', { params: { path: { engine_id: engine } } }));
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
  if (engine === 'gateway') {
    if (/\s/.test(model)) return 'A model id has no spaces.';
    return model.length > GATEWAY_MODEL_MAX ? `At most ${GATEWAY_MODEL_MAX} characters.` : null;
  }
  return CLI_MODEL.test(model)
    ? null
    : 'Use a model id or alias this CLI knows (letters, digits, “.”, “-”, “_”, “:”), not a gateway id.';
}

export const agentEngineKeys = {
  catalog: ['agent', 'engines'] as const,
};

/** Every engine as the server sees this request. */
export function agentEnginesQuery() {
  return queryOptions({
    queryKey: agentEngineKeys.catalog,
    queryFn: ({ signal }) => getAgentEngines({ signal }),
  });
}

/**
 * Probe one engine again (after signing in to its CLI, for example). Its
 * answer replaces that engine's row and supersedes a list read still on its
 * way, which could only be older.
 */
export function useCheckAgentEngine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (engine: AgentEngineId) => checkAgentEngine(engine),
    onSuccess: async (status, engine) => {
      await queryClient.cancelQueries({ queryKey: agentEngineKeys.catalog });
      queryClient.setQueryData<AgentEngineCatalog>(agentEngineKeys.catalog, (catalog) =>
        catalog
          ? { ...catalog, engines: catalog.engines.map((item) => (item.engine === engine ? status : item)) }
          : catalog,
      );
    },
  });
}
