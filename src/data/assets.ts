import { api, multipartBody, unwrap } from '@/api/client';
import type { AssetInfo, BodyAssetsUploadAsset } from '@/api/schema';
import { apiUrl } from '@/api/url';
import { uid } from '@/lib/uid';
import { queryOptions } from '@tanstack/react-query';
import { workspaceScope } from './workspaces';

export type { AssetInfo };
export const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
export type AssetRendition = 'original' | 'display' | 'thumbnail';

/** One upload action; the API client retains its key across network retries. */
export async function uploadAsset(workspaceId: string, file: File): Promise<AssetInfo> {
  const form = new FormData();
  form.append('file', file);
  return unwrap(api.POST('/workspaces/{workspace_id}/assets', {
    params: { path: { workspace_id: workspaceId }, header: { 'Idempotency-Key': uid() } },
    body: multipartBody<BodyAssetsUploadAsset>(form),
  }));
}

export async function getAsset(workspaceId: string, assetId: string): Promise<AssetInfo> {
  return unwrap(api.GET('/workspaces/{workspace_id}/assets/{asset_id}', {
    params: { path: { workspace_id: workspaceId, asset_id: assetId } },
  }));
}

export function assetInfoQuery(workspaceId: string, assetId: string) {
  return queryOptions({
    queryKey: [...workspaceScope(workspaceId), 'assets', assetId] as const,
    queryFn: () => getAsset(workspaceId, assetId),
    staleTime: Infinity,
  });
}

export function assetContentUrl(workspaceId: string, assetId: string): string {
  return apiUrl('/workspaces/{workspace_id}/assets/{asset_id}/content', {
    path: { workspace_id: workspaceId, asset_id: assetId },
  });
}

/** Read through the client so an expired cookie refreshes before decoding. */
export async function loadAssetBlob(
  workspaceId: string, assetId: string, signal: AbortSignal, rendition: AssetRendition = 'original',
): Promise<Blob> {
  return unwrap(api.GET('/workspaces/{workspace_id}/assets/{asset_id}/content', {
    params: { path: { workspace_id: workspaceId, asset_id: assetId }, query: { rendition } },
    parseAs: 'blob',
    signal,
  }));
}
