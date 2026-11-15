import { useCallback, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  agentToolSettingsQuery,
  useUpdateAgentToolSettings,
  type AgentToolSettings,
  type AgentToolSettingsUpdate,
} from '@/data/agentTools';
import { workspaceQuery } from '@/data/workspaces';
import { errorMessage } from '@/api/errors';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import {
  AgentToolsContext,
  policySwitchFor,
  type AgentToolsContextValue,
} from './agentToolsContextState';

/**
 * What the assistant and the research surfaces may use here: the person's
 * own tool settings (account-wide, shown in Settings → AI & tools), narrowed
 * by the workspace's policy, which can only switch features off (D7). It sits
 * inside the workspace scope so the policy of the workspace shown applies.
 *
 * Until both answer, source/tool checks fail closed. If loading fails, the
 * UI continues without optional research integrations rather than
 * accidentally contacting a provider the account or the workspace switched
 * off.
 */
export function AgentToolsProvider({ children }: { children: ReactNode }) {
  const read = useQuery(agentToolSettingsQuery());
  const workspaceId = useWorkspaceId();
  const policy = useQuery(workspaceQuery(workspaceId)).data?.policy ?? null;
  // A read that failed shows nothing, even after an earlier one succeeded:
  // the checks below fail closed.
  const settings = read.isError ? null : (read.data ?? null);
  const loading = read.isFetching;
  const loaded = read.isFetched || read.isSuccess;
  const error = read.isError ? errorMessage(read.error, 'Could not load agent preferences') : null;

  const refetch = read.refetch;
  const refresh = useCallback(async (): Promise<AgentToolSettings | null> => {
    const result = await refetch();
    return result.isError ? null : (result.data ?? null);
  }, [refetch]);

  const save = useUpdateAgentToolSettings().mutateAsync;
  const updateSettings = useCallback(
    (changes: AgentToolSettingsUpdate): Promise<AgentToolSettings> => save(changes),
    [save],
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

  const switchedOffBy = useCallback(
    (kind: 'source' | 'tool', id: string) => (policy ? policySwitchFor(policy, kind, id) : null),
    [policy],
  );
  const isSourceEnabled = useCallback(
    (sourceId: string) => policy !== null && sourceState.get(sourceId) === true && !policySwitchFor(policy, 'source', sourceId),
    [policy, sourceState],
  );
  const isToolEnabled = useCallback(
    (toolId: string) => policy !== null && toolState.get(toolId) === true && !policySwitchFor(policy, 'tool', toolId),
    [policy, toolState],
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
      policy,
      switchedOffBy,
    }),
    [
      error,
      isSourceEnabled,
      isToolEnabled,
      loaded,
      loading,
      policy,
      refresh,
      settings,
      switchedOffBy,
      updateSettings,
    ],
  );

  return <AgentToolsContext.Provider value={value}>{children}</AgentToolsContext.Provider>;
}
