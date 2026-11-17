import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { ImageGenerationInfo, ImageGenerationRequest, ImageGenerationEdit } from '@/api/schema';
import { uid } from '@/lib/uid';
import { workspaceScope } from './workspaces';

export type { ImageGenerationInfo, ImageGenerationRequest, ImageGenerationEdit };
const path = (workspaceId: string, generationId: string) => ({ workspace_id: workspaceId, generation_id: generationId });

export function imageAvailabilityQuery(workspaceId: string, engine: ImageGenerationRequest['engine']) {
  return queryOptions({
    queryKey: [...workspaceScope(workspaceId), 'image-generations', 'availability', engine] as const,
    queryFn: ({ signal }) => unwrap(api.GET('/workspaces/{workspace_id}/image-generations/availability', {
      params: { path: { workspace_id: workspaceId }, query: { engine } }, signal,
    })),
    staleTime: 0,
    refetchInterval: 30_000,
  });
}

export function imageGenerationQuery(workspaceId: string, generationId: string) {
  return queryOptions({
    queryKey: [...workspaceScope(workspaceId), 'image-generations', generationId] as const,
    queryFn: ({ signal }) => unwrap(api.GET('/workspaces/{workspace_id}/image-generations/{generation_id}', {
      params: { path: path(workspaceId, generationId) }, signal,
    })),
    refetchInterval: (query) => ['confirmed', 'running'].includes(query.state.data?.status ?? '') ? 1_000 : false,
  });
}

export function imageGenerationListQuery(workspaceId: string, documentId: string) {
  return infiniteQueryOptions({
    queryKey: [...workspaceScope(workspaceId), 'image-generations', 'list', documentId] as const,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => unwrap(api.GET('/workspaces/{workspace_id}/image-generations', {
      params: { path: { workspace_id: workspaceId }, query: { document_id: documentId, limit: 50, cursor: pageParam ?? undefined } }, signal,
    })),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
}

/** This only proposes. Nothing calls confirm except the explicit Generate button. */
export function proposeImage(workspaceId: string, body: ImageGenerationRequest, actionKey: string) {
  return unwrap(api.POST('/workspaces/{workspace_id}/image-generations', {
    params: { path: { workspace_id: workspaceId }, header: { 'Idempotency-Key': actionKey } }, body,
  }));
}

export function editImageRequest(workspaceId: string, generationId: string, body: ImageGenerationEdit) {
  return unwrap(api.PATCH('/workspaces/{workspace_id}/image-generations/{generation_id}', {
    params: { path: path(workspaceId, generationId) }, body,
  }));
}

export function confirmImage(workspaceId: string, generationId: string, confirmationToken: string, actionKey: string) {
  return unwrap(api.POST('/workspaces/{workspace_id}/image-generations/{generation_id}/confirm', {
    params: { path: path(workspaceId, generationId), header: { 'Idempotency-Key': actionKey } },
    body: { confirmation_token: confirmationToken },
  }));
}

export function discardImageRequest(workspaceId: string, generationId: string) {
  return unwrap(api.POST('/workspaces/{workspace_id}/image-generations/{generation_id}/discard', {
    params: { path: path(workspaceId, generationId) },
  }));
}

export async function proposeImageAgain(workspaceId: string, previous: ImageGenerationInfo) {
  const next = await proposeImage(workspaceId, {
    ...previous.arguments, document_id: previous.document_id, engine: previous.engine, aspect_ratio: previous.aspect_ratio,
  }, uid());
  return next.prompt === previous.prompt ? next : editImageRequest(workspaceId, next.generation_id, {
    prompt: previous.prompt, aspect_ratio: previous.aspect_ratio, confirmation_token: next.confirmation_token,
  });
}
