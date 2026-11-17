import { queryOptions } from '@tanstack/react-query';
import { api, unwrapWithHeaders } from '@/api/client';
import type { ChatPlan, ChatPlanUpdateRequest } from '@/api/schema';
import { workspaceScope } from './workspaces';

export type ChatPlanVersion = { plan: ChatPlan; etag: string };
export type PlanLocation = { workspaceId: string; documentId: string; chatId: string; planId: string };

const pathOf = (location: PlanLocation) => ({
  workspace_id: location.workspaceId, document_id: location.documentId,
  chat_id: location.chatId, plan_id: location.planId,
});

function versionOf({ data, headers }: { data: ChatPlan; headers: Headers }): ChatPlanVersion {
  const etag = headers.get('ETag');
  if (!etag) throw new Error('The plan has no revision validator. Read it again before editing.');
  return { plan: data, etag };
}

/** A plan is outside page content and has its own revision/ETag. */
export async function getChatPlan(location: PlanLocation, signal?: AbortSignal): Promise<ChatPlanVersion> {
  return versionOf(await unwrapWithHeaders(api.GET('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}/plans/{plan_id}', {
    params: { path: pathOf(location) }, signal,
  })));
}

/** No automatic 412 replay: callers retain the draft and show the new revision. */
export async function updateChatPlan(location: PlanLocation, etag: string, edit: ChatPlanUpdateRequest): Promise<ChatPlanVersion> {
  return versionOf(await unwrapWithHeaders(api.PATCH('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}/plans/{plan_id}', {
    params: { path: pathOf(location), header: { 'If-Match': etag } }, body: edit,
  })));
}

export function chatPlanQuery(location: PlanLocation) {
  return queryOptions({
    queryKey: [...workspaceScope(location.workspaceId), 'chats', location.documentId, 'plan', location.chatId, location.planId] as const,
    queryFn: ({ signal }) => getChatPlan(location, signal),
    refetchInterval: (query) => query.state.data?.plan.state === 'running' ? 3_000 : false,
  });
}
