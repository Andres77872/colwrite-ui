import { infiniteQueryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { AssistantRunSummary } from '@/api/schema';
import { workspaceScope } from './workspaces';

export type AssistantRun = AssistantRunSummary;
export const assistantRunKeys = (workspaceId: string) => [...workspaceScope(workspaceId), 'assistant', 'runs'] as const;
export const activeRun = (run: AssistantRun) => run.status === 'queued' || run.status === 'running' || run.status === 'cancelling';

export async function listAssistantRuns(workspaceId: string, cursor: string | null, signal?: AbortSignal) {
  return unwrap(api.GET('/workspaces/{workspace_id}/assistant/runs', {
    params: { path: { workspace_id: workspaceId }, query: { limit: 20, ...(cursor ? { cursor } : {}) } }, signal,
  }));
}

export function assistantRunsQuery(workspaceId: string) {
  return infiniteQueryOptions({
    queryKey: assistantRunKeys(workspaceId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => listAssistantRuns(workspaceId, pageParam, signal),
    getNextPageParam: (page) => page.next_cursor,
    refetchInterval: (query) => query.state.data?.pages.some((page) => page.items.some(activeRun)) ? 5_000 : 30_000,
  });
}
