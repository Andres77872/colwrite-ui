import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';
import {
  checkAgentEngine,
  engineModelProblem,
  getAgentEngines,
  type AgentEngineCatalog,
  type AgentEngineId,
  type AgentEngineStatus,
} from '@/services/agentEngines';
import { errorMessage } from '@/services/contracts';
import {
  AgentEngineContext,
  DEFAULT_ENGINE_PREFS,
  effectiveEngine,
  isAgentEnginePrefs,
  resolveEngineRequest,
  type AgentEngineContextValue,
  type AgentEngineSurface,
} from './agentEngineContextState';

const PREFS_KEY = 'colwrite:agent-engine:v1';

/**
 * The agent engines this server offers, and which one each surface uses.
 *
 * The server decides what may run: a deployed API reports only `legacy`, and
 * a local one reports the `claude` / `codex` CLIs with their sign-in state.
 * This provider never signs anyone in — when a CLI needs a login it shows the
 * command to run in a terminal and re-checks when asked.
 */
export function AgentEngineProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePersistentState(PREFS_KEY, DEFAULT_ENGINE_PREFS, isAgentEnginePrefs);
  const [catalog, setCatalog] = useState<AgentEngineCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<AgentEngineId | null>(null);
  const [checkError, setCheckError] = useState<Partial<Record<AgentEngineId, string>>>({});
  const requestEpoch = useRef(0);

  const refresh = useCallback(async () => {
    const epoch = ++requestEpoch.current;
    setLoading(true);
    try {
      const next = await getAgentEngines();
      if (epoch !== requestEpoch.current) return;
      setCatalog(next);
      setError(null);
    } catch (caught) {
      if (epoch !== requestEpoch.current) return;
      // An older API without engines: the default engine keeps working.
      setError(errorMessage(caught, 'Could not load the agent engines'));
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestEpoch.current += 1;
    };
  }, [refresh]);

  const check = useCallback(async (engine: AgentEngineId): Promise<AgentEngineStatus | null> => {
    setChecking(engine);
    setCheckError((previous) => ({ ...previous, [engine]: undefined }));
    try {
      const status = await checkAgentEngine(engine);
      // A re-check supersedes any list request still in flight.
      requestEpoch.current += 1;
      setCatalog((previous) =>
        previous
          ? {
              ...previous,
              engines: previous.engines.map((item) => (item.engine === engine ? status : item)),
            }
          : previous,
      );
      return status;
    } catch (caught) {
      setCheckError((previous) => ({
        ...previous,
        [engine]: errorMessage(caught, 'Could not check this engine'),
      }));
      return null;
    } finally {
      setChecking((current) => (current === engine ? null : current));
    }
  }, []);

  const setChatEngine = useCallback(
    (engine: AgentEngineId) => setPrefs((previous) => ({ ...previous, chat: engine })),
    [setPrefs],
  );
  const setInlineEngine = useCallback(
    (engine: AgentEngineId | 'chat') => setPrefs((previous) => ({ ...previous, inline: engine })),
    [setPrefs],
  );
  const setModel = useCallback(
    (engine: AgentEngineId, model: string): string | null => {
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
    [setPrefs],
  );

  const noteRunError = useCallback(
    (code: string) => {
      if (code.startsWith('ENGINE_')) void refresh();
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
      engineFor: (surface: AgentEngineSurface) => effectiveEngine(prefs, catalog, surface),
      requestFor: (surface: AgentEngineSurface) => resolveEngineRequest(prefs, catalog, surface),
      setChatEngine,
      setInlineEngine,
      setModel,
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
  ]);

  return <AgentEngineContext.Provider value={value}>{children}</AgentEngineContext.Provider>;
}
