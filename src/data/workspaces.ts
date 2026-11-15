import { queryOptions, type Query, type QueryClient } from '@tanstack/react-query';
import { api, unwrap, unwrapWithHeaders } from '@/api/client';
import { registerModuleReset } from '@/lib/moduleState';
import { dispositionFilename } from './documentExport';
import type {
  AccountUsageResponse,
  DeletedWorkspaceSummary,
  DocumentLocationResponse,
  PageCopyAccepted,
  PageCopyRequest,
  WorkspaceDeletion,
  WorkspaceDetailResponse,
  WorkspaceJob,
  WorkspaceListResponse,
  WorkspacePolicyModel,
  WorkspaceSummary,
  WorkspaceUpdateRequest,
  WorkspaceUsageResponse,
  WorkspaceUsageShare,
} from '@/api/schema';

/**
 * The account's workspaces (`/workspaces`, `ColWrite-api/docs/workspaces.md`).
 *
 * Every tenant route names its workspace in the path, and every query a
 * workspace's data fills is keyed by it: `['ws', <id>, …]` for the domain
 * queries in `src/data/*`, `init.params.path.workspace_id` for the typed
 * `$api` queries. A switch removes them with one predicate
 * ({@link removeWorkspaceQueries}).
 */

export type Workspace = WorkspaceSummary;
export type WorkspaceList = WorkspaceListResponse;
export type WorkspaceDetail = WorkspaceDetailResponse;
export type WorkspaceUsage = WorkspaceUsageResponse;
export type AccountUsage = AccountUsageResponse;
export type WorkspaceUsageEntry = WorkspaceUsageShare;
export type DocumentLocation = DocumentLocationResponse;
/** A deleted workspace its owner can restore until `purge_after`. */
export type DeletedWorkspace = DeletedWorkspaceSummary;
/** What the assistant may use here, on top of each person's own settings: `false` switches it off for everyone. */
export type WorkspacePolicy = WorkspacePolicyModel;
export type WorkspaceChanges = WorkspaceUpdateRequest;
export type WorkspaceRole = Workspace['role'];
/** How a home orders its children: by name, by hand (`custom`), or pages by their last edit. */
export type SortMode = WorkspaceDetail['root_sort_mode'];
/** The PDFs a copy takes along: none, those on the page, or those and the ones from the collections it uses. */
export type CopyPdfs = PageCopyRequest['include_pdfs'];

type Transport = { signal?: AbortSignal };

/** How many live workspaces one account may own, its personal one included (D14). */
export const OWNED_WORKSPACE_LIMIT = 20;
/** A workspace name's longest (D14). */
export const WORKSPACE_NAME_MAX = 100;

/** The role is at least `role`: owner over admin over editor over viewer. */
export function roleAtLeast(held: WorkspaceRole, role: WorkspaceRole): boolean {
  const order: readonly WorkspaceRole[] = ['viewer', 'editor', 'admin', 'owner'];
  return order.indexOf(held) >= order.indexOf(role);
}

/** The caller's workspaces, the server's last-opened one, the deleted ones it can restore, and what the account may do. */
export async function listWorkspaces(init?: Transport): Promise<WorkspaceList> {
  return unwrap(api.GET('/workspaces', { signal: init?.signal }));
}

/** A shared workspace with the caller as its owner; a replay of the key answers the same one. */
export async function createWorkspace(
  input: { name: string; icon: string | null },
  idempotencyKey: string,
): Promise<WorkspaceDetail> {
  return unwrap(api.POST('/workspaces', {
    params: { header: { 'Idempotency-Key': idempotencyKey } },
    body: { name: input.name, icon: input.icon },
  }));
}

/**
 * Delete a shared workspace for 30 days: its owner's, locked on its ETag,
 * with its name typed exactly. Its members lose it at once.
 */
export async function deleteWorkspace(workspaceId: string, etag: string, confirmName: string): Promise<WorkspaceDeletion> {
  return unwrap(api.DELETE('/workspaces/{workspace_id}', {
    params: { path: { workspace_id: workspaceId }, header: { 'If-Match': etag }, query: { confirm_name: confirmName } },
  }));
}

/** Bring a deleted workspace back, with everything it held. */
export async function restoreWorkspace(workspaceId: string): Promise<WorkspaceDetail> {
  return unwrap(api.POST('/workspaces/{workspace_id}/restore', {
    params: { path: { workspace_id: workspaceId } },
  }));
}

/** Export the workspace as a zip, as a job (202); an admin's. */
export async function exportWorkspace(workspaceId: string, includePdfs: boolean): Promise<WorkspaceJob> {
  const { job } = await unwrap(api.POST('/workspaces/{workspace_id}/export', {
    params: { path: { workspace_id: workspaceId } },
    body: { include_pdfs: includePdfs },
  }));
  return job;
}

/** The newest export, as the zip and the server's file name; 404 `export_not_found` when there is none. */
export async function downloadWorkspaceExport(workspaceId: string): Promise<{ blob: Blob; filename: string | null }> {
  const { data, headers } = await unwrapWithHeaders(api.GET('/workspaces/{workspace_id}/export', {
    params: { path: { workspace_id: workspaceId } },
    parseAs: 'blob',
  }));
  return { blob: data as Blob, filename: dispositionFilename(headers.get('Content-Disposition')) };
}

/**
 * Copy a page into another workspace (D11), as a job in the target workspace:
 * poll it there (`GET /workspaces/{target}/jobs/{id}`); its result names the
 * new page. History, review, chats and PDF grants are never copied.
 */
export async function copyPageToWorkspace(
  workspaceId: string,
  documentId: string,
  target: { workspaceId: string; collectionId: number | null; includePdfs: CopyPdfs },
  idempotencyKey: string,
): Promise<PageCopyAccepted> {
  return unwrap(api.POST('/workspaces/{workspace_id}/documents/{document_id}/copy', {
    params: { path: { workspace_id: workspaceId, document_id: documentId }, header: { 'Idempotency-Key': idempotencyKey } },
    body: {
      target_workspace_id: target.workspaceId,
      target_collection_id: target.collectionId,
      include_pdfs: target.includePdfs,
    },
  }));
}

/** Settings → Usage, "All workspaces": the account's usage across every workspace it is in. */
export async function getAccountUsage(days: number, init?: Transport): Promise<AccountUsage> {
  return unwrap(api.GET('/users/me/usage', { params: { query: { days } }, signal: init?.signal }));
}

/** One workspace with its counts (`pages` decides the first-run screen) and `tree_version`. */
export async function getWorkspace(workspaceId: string, init?: Transport): Promise<WorkspaceDetail> {
  return unwrap(api.GET('/workspaces/{workspace_id}', {
    params: { path: { workspace_id: workspaceId } },
    signal: init?.signal,
  }));
}

/**
 * The workspace's name, icon (`null` clears it), how the top level is ordered
 * (`root_sort_mode`) and its policy switches; only the fields present change.
 * An admin's write, locked on the workspace's ETag (412 `stale_workspace`).
 */
export async function updateWorkspace(
  workspaceId: string,
  etag: string,
  changes: WorkspaceChanges,
): Promise<WorkspaceDetail> {
  return unwrap(api.PATCH('/workspaces/{workspace_id}', {
    params: { path: { workspace_id: workspaceId }, header: { 'If-Match': etag } },
    body: changes,
  }));
}

/** Remember the workspace the author chose, for their next sign-in on any device. */
export async function setLastWorkspace(workspaceId: string): Promise<void> {
  await unwrap(api.PUT('/users/me/last-workspace', { body: { workspace_id: workspaceId } }));
}

/**
 * Which workspace a page is in, for a bare `?doc=` link. A 404 for a page
 * that is gone and for one in a workspace the caller is not a member of.
 */
export async function locateDocument(documentId: string, init?: Transport): Promise<DocumentLocation> {
  return unwrap(api.GET('/documents/{document_id}/location', {
    params: { path: { document_id: documentId } },
    signal: init?.signal,
  }));
}

/** Settings → Usage: the workspace's activity, tools, pages and storage. */
export async function getWorkspaceUsage(workspaceId: string, days: number, init?: Transport): Promise<WorkspaceUsage> {
  return unwrap(api.GET('/workspaces/{workspace_id}/usage', {
    params: { path: { workspace_id: workspaceId }, query: { days } },
    signal: init?.signal,
  }));
}

/** The first two parts of every domain key that holds one workspace's data. */
export const workspaceScope = (workspaceId: string) => ['ws', workspaceId] as const;

export const workspaceKeys = {
  /** The account's workspace list: the person's, not one workspace's. */
  list: () => ['workspaces'] as const,
  detail: (workspaceId: string) => [...workspaceScope(workspaceId), 'workspace'] as const,
  usage: (workspaceId: string, days: number) => [...workspaceScope(workspaceId), 'usage', { days }] as const,
  /** Usage over every workspace: the person's. */
  accountUsage: (days: number) => ['users', 'me', 'usage', { days }] as const,
  /** What this session's last export of the workspace made, once its job is done. */
  export: (workspaceId: string) => [...workspaceScope(workspaceId), 'export'] as const,
  /** Where a linked page is, as this workspace asked: dropped with the workspace on a switch. */
  location: (workspaceId: string, documentId: string) => [...workspaceScope(workspaceId), 'location', documentId] as const,
};

export function workspaceListQuery() {
  return queryOptions({
    queryKey: workspaceKeys.list(),
    queryFn: ({ signal }) => listWorkspaces({ signal }),
  });
}

export function accountUsageQuery(days: number) {
  return queryOptions({
    queryKey: workspaceKeys.accountUsage(days),
    queryFn: ({ signal }) => getAccountUsage(days, { signal }),
  });
}

/**
 * Where a linked page is, read from the workspace being shown: its workspace
 * and home, or a 404 for a page the account cannot open.
 */
export function pageLocationQuery(workspaceId: string, documentId: string) {
  return queryOptions({
    queryKey: workspaceKeys.location(workspaceId, documentId),
    queryFn: ({ signal }) => locateDocument(documentId, { signal }),
    staleTime: 60_000,
  });
}

/** The workspace list reads again: one was created, deleted or restored. */
export function invalidateWorkspaceList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: workspaceKeys.list() });
}

/** A workspace's detail was answered by a write: the cache holds it, so the next read is not stale. */
export function setWorkspaceDetail(queryClient: QueryClient, detail: WorkspaceDetail): void {
  queryClient.setQueryData(workspaceKeys.detail(detail.id), detail);
  syncListedWorkspace(queryClient, detail);
}

/**
 * The listed row of a workspace takes what its newer detail says: its name,
 * icon, kind, the account's role there and how many members it has. Nothing
 * changes when they already agree.
 */
export function syncListedWorkspace(queryClient: QueryClient, detail: WorkspaceDetail): void {
  queryClient.setQueryData<WorkspaceList>(workspaceKeys.list(), (current) => {
    const listed = current?.items.find((item) => item.id === detail.id);
    if (!current || !listed) return current;
    const next = { ...listed, name: detail.name, icon: detail.icon, role: detail.role, kind: detail.kind, member_count: detail.counts.members };
    const same = (Object.keys(next) as Array<keyof Workspace>).every((field) => next[field] === listed[field]);
    return same ? current : { ...current, items: current.items.map((item) => (item.id === detail.id ? next : item)) };
  });
}

export function workspaceQuery(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: ({ signal }) => getWorkspace(workspaceId, { signal }),
    // The scope reads it to choose the first page, and the session right
    // after for the first-run screen: one request answers both. A create or
    // delete invalidates it (`invalidateWorkspace`), so the count stays true.
    staleTime: 30_000,
  });
}

export function workspaceUsageQuery(workspaceId: string, days: number) {
  return queryOptions({
    queryKey: workspaceKeys.usage(workspaceId, days),
    queryFn: ({ signal }) => getWorkspaceUsage(workspaceId, days, { signal }),
  });
}

/*
 * The tree's freshness. Every structural change advances the workspace's
 * `tree_version`; the tree compares it on focus and on a poll, and reads its
 * open branches again only when someone else moved it. A change this client
 * made itself, which it already refreshed, is noted so it is not read twice.
 */
const seenTreeVersions = new Map<string, number>();
registerModuleReset(() => seenTreeVersions.clear());

/**
 * This client's own write advanced the tree to `version`. When nobody else
 * changed it in between, the tree has nothing more to read.
 */
export function noteOwnTreeChange(workspaceId: string, version: number | null | undefined): void {
  if (version === null || version === undefined) return;
  const seen = seenTreeVersions.get(workspaceId);
  if (seen !== undefined && version === seen + 1) seenTreeVersions.set(workspaceId, version);
}

/**
 * Whether the tree moved past what this client has caught up with; it has
 * caught up with `version` afterwards. The first version seen is the start.
 */
export function treeMovedElsewhere(workspaceId: string, version: number): boolean {
  const seen = seenTreeVersions.get(workspaceId);
  if (seen === undefined || version > seen) seenTreeVersions.set(workspaceId, version);
  return seen !== undefined && version > seen;
}

/** The page count changed (a page was created or deleted): the workspace reads again. */
export function invalidateWorkspace(queryClient: QueryClient, workspaceId: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) });
}

function pathWorkspace(init: unknown): unknown {
  if (typeof init !== 'object' || init === null) return undefined;
  const params = (init as { params?: unknown }).params;
  if (typeof params !== 'object' || params === null) return undefined;
  const path = (params as { path?: unknown }).path;
  if (typeof path !== 'object' || path === null) return undefined;
  return (path as { workspace_id?: unknown }).workspace_id;
}

/**
 * Whether a cached query holds workspace `workspaceId`'s data: a domain key
 * `['ws', id, …]`, or an `$api` key `[method, path, init]` whose path names it.
 */
export function isWorkspaceQuery(workspaceId: string): (query: Pick<Query, 'queryKey'>) => boolean {
  return ({ queryKey }) => {
    if (queryKey[0] === 'ws') return queryKey[1] === workspaceId;
    return typeof queryKey[1] === 'string' && pathWorkspace(queryKey[2]) === workspaceId;
  };
}

/**
 * The workspace-switch rule (`docs/workspace_collection/15` §6.3): cancel
 * and drop everything read for the workspace being left, so nothing of it is
 * shown, or refetched, in the next one.
 */
export async function removeWorkspaceQueries(queryClient: QueryClient, workspaceId: string): Promise<void> {
  const predicate = isWorkspaceQuery(workspaceId);
  await queryClient.cancelQueries({ predicate });
  queryClient.removeQueries({ predicate });
}
