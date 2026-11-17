import { infiniteQueryOptions, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type {
  TrashCounts as WireTrashCounts,
  TrashItem as WireTrashItem,
  TrashListResponse as WireTrashListResponse,
  WorkspaceJob as WireWorkspaceJob,
} from '@/api/schema';
import { documentKeys } from './documents';
import { collectionKeys, resourceKeys } from './resources';
import { invalidateWorkspace, workspaceScope } from './workspaces';

/**
 * A workspace's Trash and the jobs that finish trash work
 * (`ColWrite-api/docs/trash.md`).
 *
 * The Trash lists **trash roots**: what a member moved there, each with what
 * it held. Restoring takes a root back with everything it held; deleting one
 * forever, or emptying the Trash, is an admin's and runs as a job (202).
 */

export type TrashItem = WireTrashItem;
export type TrashKind = TrashItem['kind'];
export type TrashCounts = WireTrashCounts;
export type TrashListResponse = WireTrashListResponse;
export type WorkspaceJob = WireWorkspaceJob;

type Transport = { signal?: AbortSignal };

/** One page of the workspace's trash roots, newest first. */
export async function listTrash(
  workspaceId: string,
  options: { limit?: number; cursor?: string | null } = {},
  init?: Transport,
): Promise<TrashListResponse> {
  return unwrap(api.GET('/workspaces/{workspace_id}/trash', {
    params: {
      path: { workspace_id: workspaceId },
      query: { ...(options.limit ? { limit: options.limit } : {}), ...(options.cursor ? { cursor: options.cursor } : {}) },
    },
    signal: init?.signal,
  }));
}

/**
 * Delete one trash root forever (an admin's), as a job. A collection sends
 * the counts the Trash showed for it: when it holds anything else now, the
 * answer is 409 `preview_changed` and nothing is deleted. A page's PDFs are
 * not deleted with it: they move to Unfiled.
 */
export async function deleteForever(
  workspaceId: string,
  item: Pick<TrashItem, 'kind' | 'id' | 'counts'>,
): Promise<WorkspaceJob> {
  const counts = item.kind === 'collection' ? item.counts : null;
  const { job } = await unwrap(api.DELETE('/workspaces/{workspace_id}/trash/{kind}/{item_id}', {
    params: {
      path: { workspace_id: workspaceId, kind: item.kind, item_id: item.id },
      query: counts
        ? {
            expected_collection_count: counts.collection_count,
            expected_page_count: counts.page_count,
            expected_pdf_count: counts.pdf_count,
            expected_pdf_bytes: counts.pdf_bytes,
          }
        : {},
    },
  }));
  return job;
}

/** Delete everything in the Trash forever (an admin's), as a job. */
export async function emptyTrash(workspaceId: string): Promise<WorkspaceJob> {
  const { job } = await unwrap(api.DELETE('/workspaces/{workspace_id}/trash', {
    params: { path: { workspace_id: workspaceId }, query: { confirm: 'empty' } },
  }));
  return job;
}

/** A job's status and progress; poll it until it is `done` or `failed`. */
export async function getJob(workspaceId: string, jobId: number, init?: Transport): Promise<WorkspaceJob> {
  return unwrap(api.GET('/workspaces/{workspace_id}/jobs/{job_id}', {
    params: { path: { workspace_id: workspaceId, job_id: jobId } },
    signal: init?.signal,
  }));
}

/** Whether a job has finished, one way or the other. */
export function jobSettled(job: Pick<WorkspaceJob, 'status'>): boolean {
  return job.status === 'done' || job.status === 'failed';
}

export const trashKeys = {
  all: (workspaceId: string) => [...workspaceScope(workspaceId), 'trash'] as const,
  list: (workspaceId: string, pageSize: number) => [...workspaceScope(workspaceId), 'trash', 'list', { pageSize }] as const,
};

/** The Trash, a page of roots at a time. */
export function trashListQuery(workspaceId: string, pageSize: number) {
  return infiniteQueryOptions({
    queryKey: trashKeys.list(workspaceId, pageSize),
    queryFn: ({ pageParam, signal }) => listTrash(workspaceId, { limit: pageSize, cursor: pageParam }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: TrashListResponse) => last.next_cursor ?? undefined,
  });
}

/** Every root of the pages read so far, once each. */
export function trashItemsOf(data: InfiniteData<TrashListResponse> | undefined): TrashItem[] {
  const byKey = new Map<string, TrashItem>();
  for (const page of data?.pages ?? []) for (const item of page.items) byKey.set(`${item.kind}:${item.id}`, item);
  return [...byKey.values()];
}

/**
 * Moving something to the Trash, restoring it or deleting it forever changes
 * what every list, tree branch, path, count and grant shows: they all read
 * again, with the workspace (its `counts.trash` is the sidebar's badge) and
 * the Trash itself.
 */
export function invalidateAfterTrash(queryClient: QueryClient, workspaceId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: documentKeys.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: collectionKeys.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: resourceKeys.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: trashKeys.all(workspaceId) }),
    invalidateWorkspace(queryClient, workspaceId),
  ]);
}
