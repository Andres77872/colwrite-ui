import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AGENT_ENGINE_KEY } from '@/lib/storageKeys';
import { usePersistentState } from '@/hooks/usePersistentState';
import {
  agentEnginesQuery,
  engineModelProblem,
  gatewayModelsFor,
  useCheckAgentEngine,
  type AgentEngineId,
  type AgentEngineStatus,
  type GatewayModelTier,
} from '@/data/agentEngines';
import { errorMessage } from '@/api/errors';
import {
  AgentEngineContext,
  DEFAULT_ENGINE_PREFS,
  isAgentEnginePrefs,
  resolveEngineRequest,
  type AgentEngineContextValue,
  type AgentEngineSurface,
} from './agentEngineContextState';

const PREFS_KEY = AGENT_ENGINE_KEY;

/**
 * The agent engines this server offers, and which one each surface uses.
 *
 * The server decides what may run: a deployed API reports only `gateway`, and
 * a local one reports the `claude` / `codex` CLIs with their sign-in state.
 * This provider never signs anyone in — when a CLI needs a login it shows the
 * command to run in a terminal and re-checks when asked.
 */
export function AgentEngineProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePersistentState(PREFS_KEY, DEFAULT_ENGINE_PREFS, isAgentEnginePrefs);
  const engines = useQuery(agentEnginesQuery());
  const catalog = engines.data ?? null;
  const loading = engines.isFetching;
  // The catalog failed to load: the default engine keeps working.
  const error = engines.isError ? errorMessage(engines.error, 'Could not load the agent engines') : null;
  const refetchEngines = engines.refetch;
  const refresh = useCallback(async () => {
    await refetchEngines();
  }, [refetchEngines]);

  const [checking, setChecking] = useState<AgentEngineId | null>(null);
  const [checkError, setCheckError] = useState<Partial<Record<AgentEngineId, string>>>({});
  const checkEngine = useCheckAgentEngine().mutateAsync;
  const check = useCallback(async (engine: AgentEngineId): Promise<AgentEngineStatus | null> => {
    setChecking(engine);
    setCheckError((previous) => ({ ...previous, [engine]: undefined }));
    try {
      return await checkEngine(engine);
    } catch (caught) {
      setCheckError((previous) => ({
        ...previous,
        [engine]: errorMessage(caught, 'Could not check this engine'),
      }));
      return null;
    } finally {
      setChecking((current) => (current === engine ? null : current));
    }
  }, [checkEngine]);

  const setChatEngine = useCallback(
    (engine: AgentEngineId) => setPrefs((previous) => ({ ...previous, chat: engine })),
    [setPrefs],
  );
  const setInlineEngine = useCallback(
    (engine: AgentEngineId | 'chat') => setPrefs((previous) => ({ ...previous, inline: engine })),
    [setPrefs],
  );
  const setGatewayModel = useCallback(
    (tier: GatewayModelTier, model: string): string | null => {
      const trimmed = model.trim();
      if (trimmed && !gatewayModelsFor(catalog, tier).includes(trimmed)) {
        return 'Choose one of the models configured on this server.';
      }
      setPrefs((previous) => {
        if (tier === 'lite') {
          const next = { ...previous };
          if (trimmed) next.liteModel = trimmed;
          else delete next.liteModel;
          return next;
        }
        const models = { ...previous.models };
        if (trimmed) models.gateway = trimmed;
        else delete models.gateway;
        return { ...previous, models };
      });
      return null;
    },
    [catalog, setPrefs],
  );
  const setModel = useCallback(
    (engine: AgentEngineId, model: string): string | null => {
      if (engine === 'gateway') return setGatewayModel('main', model);
      const trimmed = model.trim();
      const problem = engineModelProblem(engine, trimmed);
      if (problem) return problem;
      setPrefs((previous) => {
        const models = { ...previous.models };
        if (trimmed) models[engine] = trimmed;
        else delete models[engine];
        return { ...previous, models };
      });
      return null;
    },
    [setGatewayModel, setPrefs],
  );

  const noteRunError = useCallback(
    (code: string) => {
      if (code.startsWith('ENGINE_') || code === 'MODEL_NOT_CONFIGURED') void refresh();
    },
    [refresh],
  );

  const value = useMemo<AgentEngineContextValue>(() => {
    const statuses = new Map(catalog?.engines.map((status) => [status.engine, status]));
    return {
      catalog,
      loading,
      error,
      prefs,
      selectable: catalog?.runtime === 'local',
      statusOf: (engine) => statuses.get(engine) ?? null,
      requestFor: (surface: AgentEngineSurface) => resolveEngineRequest(prefs, catalog, surface),
      setChatEngine,
      setInlineEngine,
      setModel,
      setGatewayModel,
      checking,
      checkError,
      check,
      refresh,
      noteRunError,
    };
  }, [
    catalog,
    check,
    checkError,
    checking,
    error,
    loading,
    noteRunError,
    prefs,
    refresh,
    setChatEngine,
    setInlineEngine,
    setModel,
    setGatewayModel,
  ]);

  return <AgentEngineContext.Provider value={value}>{children}</AgentEngineContext.Provider>;
}
