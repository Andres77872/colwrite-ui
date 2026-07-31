import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  getAgentToolSettings,
  updateAgentToolSettings,
  type AgentToolSettings,
  type AgentToolSettingsUpdate,
} from '@/services/agentTools';
import { errorMessage } from '@/services/contracts';
import {
  AgentToolsContext,
  type AgentToolsContextValue,
} from './agentToolsContextState';

/**
 * Account-scoped agent capabilities shared by the workspace and preferences.
 *
 * Until the server answers, source/tool checks fail closed. If loading fails,
 * the UI continues without optional research integrations rather than
 * accidentally contacting a provider the account may have disabled.
 */
export function AgentToolsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AgentToolSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestEpoch = useRef(0);

  const refresh = useCallback(async (): Promise<AgentToolSettings | null> => {
    const epoch = ++requestEpoch.current;
    setLoading(true);
    try {
      const next = await getAgentToolSettings();
      if (epoch !== requestEpoch.current) return null;
      setSettings(next);
      setError(null);
      return next;
    } catch (caught) {
      if (epoch !== requestEpoch.current) return null;
      setSettings(null);
      setError(errorMessage(caught, 'Could not load agent preferences'));
      return null;
    } finally {
      if (epoch === requestEpoch.current) {
        setLoaded(true);
        setLoading(false);
      }
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

  const updateSettings = useCallback(
    async (changes: AgentToolSettingsUpdate): Promise<AgentToolSettings> => {
      // A save supersedes any older GET so a slow refresh cannot restore its
      // stale response over the mutation result.
      requestEpoch.current += 1;
      const next = await updateAgentToolSettings(changes);
      setSettings(next);
      setError(null);
      setLoaded(true);
      setLoading(false);
      return next;
    },
    [],
  );

  const sourceState = useMemo(
    () => new Map(settings?.sources.map((source) => [source.id, source.effective_enabled])),
    [settings],
  );
  const toolState = useMemo(
    () =>
      new Map(
        settings?.categories.flatMap((category) =>
          category.tools.map((tool) => [tool.id, tool.effective_enabled] as const),
        ),
      ),
    [settings],
  );

  const isSourceEnabled = useCallback(
    (sourceId: string) => sourceState.get(sourceId) === true,
    [sourceState],
  );
  const isToolEnabled = useCallback(
    (toolId: string) => toolState.get(toolId) === true,
    [toolState],
  );

  const value = useMemo<AgentToolsContextValue>(
    () => ({
      settings,
      loading,
      loaded,
      error,
      refresh,
      updateSettings,
      isSourceEnabled,
      isToolEnabled,
    }),
    [
      error,
      isSourceEnabled,
      isToolEnabled,
      loaded,
      loading,
      refresh,
      settings,
      updateSettings,
    ],
  );

  return <AgentToolsContext.Provider value={value}>{children}</AgentToolsContext.Provider>;
}
