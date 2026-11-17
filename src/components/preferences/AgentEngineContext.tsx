import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { assistantSettingsQuery, useUpdateAssistantSettings, type AssistantDefaults } from '@/data/assistant';
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
  preferencesOf,
  resolveEngineRequest,
  type AgentEngineContextValue,
  type AgentEngineSurface,
} from './agentEngineContextState';

/**
 * The agent engines this server offers, and which one each surface uses.
 *
 * The server decides what may run: a deployed API reports only `gateway`, and
 * a local one reports the `claude` / `codex` CLIs with their sign-in state.
 * This provider never signs anyone in — when a CLI needs a login it shows the
 * command to run in a terminal and re-checks when asked.
 */
export function AgentEngineProvider({ children }: { children: ReactNode }) {
  const settings = useQuery(assistantSettingsQuery());
  const preferencesReady = settings.data !== undefined;
  const defaults = settings.data?.defaults;
  const prefs = useMemo(() => preferencesOf(defaults), [defaults]);
  const { mutate: update, isPending: savingPreferences, error: saveError } = useUpdateAssistantSettings();
  const preferenceError = saveError ? errorMessage(saveError, 'Could not save your assistant preferences.') : null;
  const saveDefaults = useCallback((changes: AssistantDefaults) => {
    if (preferencesReady) update({ defaults: changes });
  }, [preferencesReady, update]);
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
    (engine: AgentEngineId) => saveDefaults({ chat_engine: engine === 'gateway' ? null : engine }),
    [saveDefaults],
  );
  const setSurfaceEngine = useCallback(
    (surface: 'inline' | 'review', engine: AgentEngineId | 'chat') => saveDefaults({
      [surface === 'inline' ? 'inline_engine' : 'review_engine']: engine === 'chat' ? null : engine,
    }),
    [saveDefaults],
  );
  const setGatewayModel = useCallback(
    (tier: GatewayModelTier, model: string): string | null => {
      const trimmed = model.trim();
      if (trimmed && !gatewayModelsFor(catalog, tier).includes(trimmed)) {
        return 'Choose one of the models configured on this server.';
      }
      saveDefaults({ [tier === 'lite' ? 'gateway_lite' : 'gateway_main']: trimmed || null });
      return null;
    },
    [catalog, saveDefaults],
  );
  const setModel = useCallback(
    (engine: AgentEngineId, model: string): string | null => {
      if (engine === 'gateway') return setGatewayModel('main', model);
      const trimmed = model.trim();
      const problem = engineModelProblem(engine, trimmed);
      if (problem) return problem;
      saveDefaults({ [engine === 'claude' ? 'claude_model' : 'codex_model']: trimmed || null });
      return null;
    },
    [setGatewayModel, saveDefaults],
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
      preferencesReady,
      savingPreferences,
      preferenceError,
      selectable: catalog?.runtime === 'local',
      statusOf: (engine) => statuses.get(engine) ?? null,
      requestFor: (surface: AgentEngineSurface) => resolveEngineRequest(prefs, catalog, surface),
      setChatEngine,
      setSurfaceEngine,
      saveDefaults,
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
    preferencesReady,
    savingPreferences,
    preferenceError,
    refresh,
    setChatEngine,
    setSurfaceEngine,
    saveDefaults,
    setModel,
    setGatewayModel,
  ]);

  return <AgentEngineContext.Provider value={value}>{children}</AgentEngineContext.Provider>;
}
