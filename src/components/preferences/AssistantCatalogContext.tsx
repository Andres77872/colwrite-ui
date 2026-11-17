import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { agentCatalogQuery, invalidateAssistantCatalogs } from '@/data/assistant';
import { workspaceQuery } from '@/data/workspaces';
import { errorMessage } from '@/api/errors';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useAgentEngine } from './agentEngineContextState';
import { AssistantCatalogContext, catalogValue } from './assistantCatalogContextState';

/**
 * The assistant's catalog for the workspace shown, for the engine the chat
 * runs on (`GET /workspaces/{w}/assistant/catalog?engine=`): what the
 * assistant, the research surfaces and Settings → AI & tools render from.
 * It sits inside the workspace scope, so its key names the workspace and a
 * switch drops it with the workspace's other queries.
 *
 * The workspace's policy and the account's role there decide part of it.
 * When either changes (read again on focus, every minute, or after this
 * account changed the policy), the catalog is read again.
 */
export function AssistantCatalogProvider({ children }: { children: ReactNode }) {
  const workspaceId = useWorkspaceId();
  const engine = useAgentEngine().requestFor('chat').engine ?? 'gateway';
  const queryClient = useQueryClient();
  const read = useQuery(agentCatalogQuery(workspaceId, engine));
  const workspace = useQuery(workspaceQuery(workspaceId)).data;
  const scope = workspace ? JSON.stringify([workspace.role, workspace.policy]) : null;
  const seenScope = useRef<string | null>(null);
  useEffect(() => {
    if (scope === null) return;
    if (seenScope.current !== null && seenScope.current !== scope) void invalidateAssistantCatalogs(queryClient, workspaceId);
    seenScope.current = scope;
  }, [queryClient, scope, workspaceId]);

  // A read that failed shows nothing, even after an earlier one succeeded:
  // every check fails closed.
  const catalog = read.isError ? null : (read.data ?? null);
  const error = read.isError ? errorMessage(read.error, 'Could not load what the assistant can use here') : null;
  const { refetch } = read;
  const value = useMemo(() => ({
    ...catalogValue(catalog, read.isPending, error),
    workspaceName: workspace?.name,
    retry: () => { void refetch(); },
  }), [catalog, error, read.isPending, refetch, workspace?.name]);
  return <AssistantCatalogContext.Provider value={value}>{children}</AssistantCatalogContext.Provider>;
}
