import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueries,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { api, multipartBody, unwrap } from '@/api/client';
import type {
  BodyResourcesUploadResource,
  CollectionPlaceAfter,
  CollectionPlaceBefore,
  CollectionDetail as WireCollectionDetail,
  CollectionGrantState as WireCollectionGrantState,
  CollectionListResponse as WireCollectionListResponse,
  CollectionPathItem as WireCollectionPathItem,
  CollectionRestoreResult as WireCollectionRestoreResult,
  CollectionSummary as WireCollectionSummary,
  CollectionTrashPreview as WireCollectionTrashPreview,
  CollectionTrashResult as WireCollectionTrashResult,
  PdfGrant as WirePdfGrant,
  PdfGrantState as WirePdfGrantState,
  ResourceExtraction,
  ResourceItem as WireResourceItem,
  ResourceListResponse as WireResourceListResponse,
  ResourceMarkdownWindow as WireResourceMarkdownWindow,
  ResourceSearchMatch as WireResourceSearchMatch,
  ResourceSearchResponse as WireResourceSearchResponse,
  ResourceSearchSkipped as WireResourceSearchSkipped,
  ResourceTrashResult,
} from '@/api/schema';
import { apiUrl } from '@/api/url';
import { uid } from '@/lib/uid';
import { workspaceScope } from './workspaces';

/*
 * A workspace's PDFs, collections and PDF grants, all under
 * `/workspaces/{w}` (`ColWrite-api/docs/resources.md`). Every function takes
 * the workspace id first, and every query key starts `['ws', <id>, …]`.
 */

/** Where a PDF is in the upload-to-readable-text pipeline. */
export type ExtractionStatus = ResourceExtraction['status'];

export type ResourceItem = WireResourceItem;
export type ResourceLocation = ResourceItem['location'];

/** True while the text is still on its way and the row is worth re-polling. */
export function isSettling(resource: ResourceItem): boolean {
  return resource.extraction.status === 'pending' || resource.extraction.status === 'running';
}

/** The page a PDF is on, or null. */
export function resourceDocumentId(resource: ResourceItem): string | null {
  return resource.location.kind === 'document' ? resource.location.document_id : null;
}

/** The collection a PDF is in, or null. */
export function resourceCollectionId(resource: ResourceItem): number | null {
  return resource.location.kind === 'collection' ? resource.location.collection_id : null;
}

/** All scopes accepted by the resource list and search endpoints. */
export type ResourceScope =
  | 'library'
  | 'document'
  | 'context'
  | 'collection'
  | 'collection_recursive'
  | 'unfiled';

export type SmartResourceScope = Extract<ResourceScope, 'library' | 'document' | 'context'>;
export type CollectionResourceScope = Extract<ResourceScope, 'collection' | 'collection_recursive'>;

/**
 * A library location is deliberately more specific than a bare API scope.
 * Document views carry their document, folder views carry their folder, and
 * Unfiled cannot accidentally inherit either identifier.
 */
export type ResourceLibraryLocation =
  | { kind: 'smart'; scope: 'library'; documentId?: null }
  | { kind: 'smart'; scope: 'document' | 'context'; documentId: string }
  | { kind: 'collection'; collectionId: number; recursive?: boolean }
  | { kind: 'unfiled' };

export type ResourceScopeOptions = {
  scope: ResourceScope;
  documentId?: string | null;
  collectionId?: number | null;
};

/** Serialize a discriminated UI location into the API's scope parameters. */
export function resourceScopeOptions(location: ResourceLibraryLocation): ResourceScopeOptions {
  switch (location.kind) {
    case 'smart':
      return { scope: location.scope, documentId: location.documentId ?? null };
    case 'collection':
      return {
        scope: location.recursive ? 'collection_recursive' : 'collection',
        collectionId: location.collectionId,
      };
    case 'unfiled':
      return { scope: 'unfiled' };
  }
}

/** Stable key for request-generation and cache boundaries. */
export function resourceLocationKey(location: ResourceLibraryLocation): string {
  const options = resourceScopeOptions(location);
  return [options.scope, options.documentId ?? '', options.collectionId ?? ''].join(':');
}

export type ResourceListResponse = WireResourceListResponse;
export type ResourceSearchMatch = WireResourceSearchMatch;
export type ResourceSearchSkipped = WireResourceSearchSkipped;
export type ResourceSearchResponse = WireResourceSearchResponse;
export type ResourceMarkdownWindow = WireResourceMarkdownWindow;

/**
 * Where a PDF goes: a page, a collection, or Unfiled when neither is named.
 * The client always says which (`location` on upload, `kind` on a move).
 */
export type ResourceAttachmentTarget = {
  documentId?: string | null;
  collectionId?: number | null;
};

export type CollectionGrantState = WireCollectionGrantState;
export type CollectionItem = WireCollectionSummary;
/**
 * What naming, moving and trashing a collection needs, from a listed row or a
 * detail read: every write is locked on its `etag` (`"cwc:{row_version}"`).
 */
export type CollectionRef = Pick<CollectionItem, 'id' | 'name' | 'description' | 'parent_id' | 'etag'>;
/** How a home orders its children: by name, by hand, or pages by their last edit. */
export type SortMode = CollectionItem['sort_mode'];
/** Where a new or moved collection goes among its siblings. */
export type CollectionPosition = 'last' | CollectionPlaceAfter | CollectionPlaceBefore;
/** What a collection's `PATCH` changes; the fields left out stay as they are. */
export type CollectionChanges = {
  name?: string;
  description?: string | null;
  sort_mode?: SortMode;
  grant_new_pages?: boolean;
};
export type CollectionPathItem = WireCollectionPathItem;
export type CollectionListResponse = WireCollectionListResponse;
export type CollectionDetail = WireCollectionDetail;
/** What moving a collection to the Trash takes with it; the trash sends these counts back. */
export type CollectionTrashPreview = WireCollectionTrashPreview;
export type CollectionTrashResult = WireCollectionTrashResult;
export type CollectionRestoreResult = WireCollectionRestoreResult;
export type PdfGrant = WirePdfGrant;
export type PdfGrantState = WirePdfGrantState;

/** MySQL/Pydantic ceiling for a collection folder name. */
export const MAX_COLLECTION_NAME = 191;
/** MySQL/Pydantic ceiling for a collection folder description. */
export const MAX_COLLECTION_DESCRIPTION = 1_000;
/** Server-side ceiling for a resource-search query. */
export const MAX_SEARCH_QUERY_CHARS = 200;
/** Server-side ceiling for one `readResourceMarkdown` window. */
export const MAX_READ_CHARS = 120_000;
/** Server-side ceiling for `searchResources`. */
export const MAX_SEARCH_MATCHES = 40;

/** Query parameters with the unset ones left out, as the API reads an absent one. */
function query<T extends Record<string, string | number | boolean | null | undefined>>(params: T) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  ) as { [K in keyof T]?: NonNullable<T[K]> };
}

/** Per-call transport controls: a query cancels what it no longer needs. */
export type Transport = { signal?: AbortSignal };

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export type ListResourcesOptions = Partial<ResourceScopeOptions> & {
  limit?: number;
  cursor?: string | null;
};

export async function listResources(
  workspaceId: string,
  options: ListResourcesOptions = {},
  init?: Transport,
): Promise<ResourceListResponse> {
  const { scope = 'library', documentId, collectionId, limit = 20, cursor } = options;
  return unwrap(api.GET('/workspaces/{workspace_id}/resources', {
    params: {
      path: { workspace_id: workspaceId },
      query: query({ scope, document_id: documentId, collection_id: collectionId, limit, cursor }),
    },
    signal: init?.signal,
  }));
}

/** Store a PDF on a page, in an exact collection, or in Unfiled. */
export async function uploadResource(
  workspaceId: string,
  file: File,
  target: ResourceAttachmentTarget = {},
): Promise<ResourceItem> {
  const form = new FormData();
  form.append('file', file);
  if (target.documentId) {
    form.append('location', 'document');
    form.append('document_id', target.documentId);
  } else if (target.collectionId != null) {
    form.append('location', 'collection');
    form.append('collection_id', String(target.collectionId));
  } else {
    form.append('location', 'unfiled');
  }
  return unwrap(api.POST('/workspaces/{workspace_id}/resources', {
    params: { path: { workspace_id: workspaceId }, header: { 'Idempotency-Key': uid() } },
    body: multipartBody<BodyResourcesUploadResource>(form),
  }));
}

export async function getResource(workspaceId: string, resourceId: number, init?: Transport): Promise<ResourceItem> {
  return unwrap(api.GET('/workspaces/{workspace_id}/resources/{resource_id}', {
    params: { path: { workspace_id: workspaceId, resource_id: resourceId } },
    signal: init?.signal,
  }));
}

export type SearchResourcesOptions = Partial<ResourceScopeOptions> & {
  query: string;
  resourceId?: number | null;
  maxMatches?: number;
  cursor?: string | null;
};

export async function searchResources(
  workspaceId: string,
  options: SearchResourcesOptions,
  init?: Transport,
): Promise<ResourceSearchResponse> {
  const { scope = 'library', documentId, collectionId, resourceId, maxMatches = 12, cursor } = options;
  return unwrap(api.GET('/workspaces/{workspace_id}/resources/search', {
    params: {
      path: { workspace_id: workspaceId },
      query: {
        query: options.query,
        ...query({
          scope,
          document_id: documentId,
          collection_id: collectionId,
          resource_id: resourceId,
          max_matches: Math.min(maxMatches, MAX_SEARCH_MATCHES),
          cursor,
        }),
      },
    },
    signal: init?.signal,
  }));
}

export async function readResourceMarkdown(
  workspaceId: string,
  resourceId: number,
  options: { offset?: number; limit?: number } = {},
  init?: Transport,
): Promise<ResourceMarkdownWindow> {
  const { offset = 0, limit = 20_000 } = options;
  return unwrap(api.GET('/workspaces/{workspace_id}/resources/{resource_id}/markdown', {
    params: {
      path: { workspace_id: workspaceId, resource_id: resourceId },
      query: { offset, limit: Math.min(limit, MAX_READ_CHARS) },
    },
    signal: init?.signal,
  }));
}

export async function extractResource(
  workspaceId: string,
  resourceId: number,
  options: { force?: boolean } = {},
): Promise<ResourceItem> {
  return unwrap(api.POST('/workspaces/{workspace_id}/resources/{resource_id}/extract', {
    params: { path: { workspace_id: workspaceId, resource_id: resourceId }, query: query({ force: options.force || null }) },
  }));
}

/** Move a PDF to a page, to an exact collection, or to Unfiled. */
export async function moveResource(
  workspaceId: string,
  resourceId: number,
  target: ResourceAttachmentTarget = {},
): Promise<ResourceItem> {
  const body = target.documentId
    ? { kind: 'document' as const, document_id: target.documentId }
    : target.collectionId != null
      ? { kind: 'collection' as const, collection_id: target.collectionId }
      : { kind: 'unfiled' as const };
  return unwrap(api.PUT('/workspaces/{workspace_id}/resources/{resource_id}/location', {
    params: { path: { workspace_id: workspaceId, resource_id: resourceId } },
    body,
  }));
}

/** Give a PDF a new file name. */
export async function renameResource(workspaceId: string, resourceId: number, filename: string): Promise<ResourceItem> {
  return unwrap(api.PATCH('/workspaces/{workspace_id}/resources/{resource_id}', {
    params: { path: { workspace_id: workspaceId, resource_id: resourceId } },
    body: { filename },
  }));
}

/**
 * Move a PDF to the Trash. It keeps its location and its text, and is in no
 * list, search or assistant context until it is restored.
 */
export async function trashResource(workspaceId: string, resourceId: number): Promise<ResourceTrashResult> {
  return unwrap(api.POST('/workspaces/{workspace_id}/resources/{resource_id}/trash', {
    params: { path: { workspace_id: workspaceId, resource_id: resourceId } },
  }));
}

/** Bring a PDF back to its location, or to Unfiled when that page or collection is gone. */
export async function restoreResource(workspaceId: string, resourceId: number): Promise<ResourceItem> {
  return unwrap(api.POST('/workspaces/{workspace_id}/resources/{resource_id}/restore', {
    params: { path: { workspace_id: workspaceId, resource_id: resourceId } },
  }));
}

/** Same-origin URL for a resource's original bytes. */
export function resourceContentUrl(workspaceId: string, resourceId: number): string {
  return apiUrl('/workspaces/{workspace_id}/resources/{resource_id}/content', {
    path: { workspace_id: workspaceId, resource_id: resourceId },
  });
}

// ---------------------------------------------------------------------------
// Collections and PDF grants
// ---------------------------------------------------------------------------

/** The top level, or one collection's immediate children, a page at a time. */
export async function listCollections(
  workspaceId: string,
  options: { parentId?: number | null; grantStateFor?: string | null; limit?: number; cursor?: string | null } = {},
  init?: Transport,
): Promise<CollectionListResponse> {
  const { parentId = null, grantStateFor, limit = 50, cursor } = options;
  return unwrap(api.GET('/workspaces/{workspace_id}/collections', {
    params: {
      path: { workspace_id: workspaceId },
      query: { parent_id: parentId ?? 'root', ...query({ grant_state_for: grantStateFor, limit, cursor }) },
    },
    signal: init?.signal,
  }));
}

export async function createCollection(
  workspaceId: string,
  input: { name: string; description?: string | null; parentId?: number | null; position?: CollectionPosition },
): Promise<CollectionDetail> {
  return unwrap(api.POST('/workspaces/{workspace_id}/collections', {
    params: { path: { workspace_id: workspaceId }, header: { 'Idempotency-Key': uid() } },
    body: {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.parentId != null ? { parent_id: input.parentId } : {}),
      ...(input.position ? { position: input.position } : {}),
    },
  }));
}

/** A collection with its path from the top (itself last) and its subtree counts. */
export async function getCollection(workspaceId: string, collectionId: number, init?: Transport): Promise<CollectionDetail> {
  return unwrap(api.GET('/workspaces/{workspace_id}/collections/{collection_id}', {
    params: { path: { workspace_id: workspaceId, collection_id: collectionId } },
    signal: init?.signal,
  }));
}

/**
 * Rename a collection, or change its order or its "Pages here can use these
 * PDFs". Locked on the collection's ETag: a stale one is 412 `stale_collection`.
 */
export async function updateCollection(
  workspaceId: string,
  collectionId: number,
  etag: string,
  changes: CollectionChanges,
): Promise<CollectionDetail> {
  return unwrap(api.PATCH('/workspaces/{workspace_id}/collections/{collection_id}', {
    params: { path: { workspace_id: workspaceId, collection_id: collectionId }, header: { 'If-Match': etag } },
    body: changes,
  }));
}

/** Move a collection and everything in it under `parentId` (`null` for the top level). */
export async function moveCollection(
  workspaceId: string,
  collectionId: number,
  etag: string,
  target: { parentId: number | null; position?: CollectionPosition },
): Promise<CollectionDetail> {
  return unwrap(api.POST('/workspaces/{workspace_id}/collections/{collection_id}/move', {
    params: { path: { workspace_id: workspaceId, collection_id: collectionId }, header: { 'If-Match': etag } },
    body: { parent_id: target.parentId, ...(target.position ? { position: target.position } : {}) },
  }));
}

/** Place a collection among its current siblings, under a parent in custom order. */
export async function reorderCollection(
  workspaceId: string,
  collectionId: number,
  etag: string,
  position: CollectionPosition,
): Promise<CollectionDetail> {
  return unwrap(api.POST('/workspaces/{workspace_id}/collections/{collection_id}/reorder', {
    params: { path: { workspace_id: workspaceId, collection_id: collectionId }, header: { 'If-Match': etag } },
    body: { position },
  }));
}

/** What moving a collection to the Trash would take with it: its subtree, its pages and its PDFs. */
export async function previewCollectionTrash(workspaceId: string, collectionId: number, init?: Transport): Promise<CollectionTrashPreview> {
  return unwrap(api.GET('/workspaces/{workspace_id}/collections/{collection_id}/trash-preview', {
    params: { path: { workspace_id: workspaceId, collection_id: collectionId } },
    signal: init?.signal,
  }));
}

/**
 * Move a collection and everything in it to the Trash, if it still holds
 * what the preview showed (409 `preview_changed` otherwise, and nothing
 * moves). Locked on its ETag (412 `stale_collection`). The answer is 202 with
 * a `job` while its pages are on their way; they are hidden at once.
 */
export async function trashCollection(
  workspaceId: string,
  collectionId: number,
  etag: string,
  expected: CollectionTrashPreview,
): Promise<CollectionTrashResult> {
  return unwrap(api.POST('/workspaces/{workspace_id}/collections/{collection_id}/trash', {
    params: { path: { workspace_id: workspaceId, collection_id: collectionId }, header: { 'If-Match': etag } },
    body: {
      expected_collection_count: expected.collection_count,
      expected_page_count: expected.page_count,
      expected_pdf_count: expected.pdf_count,
      expected_pdf_bytes: expected.pdf_bytes,
    },
  }));
}

/**
 * Bring a collection back with what it held, to its place or to the top
 * level (`moved_to_root`). Its pages come back through `job` (202).
 */
export async function restoreCollection(workspaceId: string, collectionId: number): Promise<CollectionRestoreResult> {
  return unwrap(api.POST('/workspaces/{workspace_id}/collections/{collection_id}/restore', {
    params: { path: { workspace_id: workspaceId, collection_id: collectionId } },
  }));
}

/** The collections a page uses ("Use on this page"), each with its path. */
export async function listPdfGrants(workspaceId: string, documentId: string, init?: Transport): Promise<PdfGrant[]> {
  const response = await unwrap(api.GET('/workspaces/{workspace_id}/documents/{document_id}/pdf-grants', {
    params: { path: { workspace_id: workspaceId, document_id: documentId } },
    signal: init?.signal,
  }));
  return response.items;
}

/** Let a page's assistant read a collection and everything inside it. Idempotent. */
export async function grantPdfs(workspaceId: string, documentId: string, collectionId: number): Promise<PdfGrantState> {
  return unwrap(api.PUT('/workspaces/{workspace_id}/documents/{document_id}/pdf-grants/{collection_id}', {
    params: { path: { workspace_id: workspaceId, document_id: documentId, collection_id: collectionId } },
  }));
}

/** Stop using a collection on a page; a grant on a collection above it still applies. */
export async function revokePdfs(workspaceId: string, documentId: string, collectionId: number): Promise<PdfGrantState> {
  return unwrap(api.DELETE('/workspaces/{workspace_id}/documents/{document_id}/pdf-grants/{collection_id}', {
    params: { path: { workspace_id: workspaceId, document_id: documentId, collection_id: collectionId } },
  }));
}

/**
 * A page's grant state for a collection, from the page's grants and the
 * collection's path (itself last): direct when the collection itself is
 * granted, effective through the nearest granted collection on the path.
 */
export function grantStateOf(path: readonly CollectionPathItem[], grants: readonly PdfGrant[]): CollectionGrantState {
  const granted = new Set(grants.map((grant) => grant.collection_id));
  const self = path.at(-1);
  const via = [...path].reverse().find((item) => granted.has(item.id)) ?? null;
  return {
    direct: self !== undefined && granted.has(self.id),
    effective: via !== null,
    via_collection_id: via?.id ?? null,
    via_collection_name: via?.name ?? null,
  };
}

/*
 * The Library's server data: the workspace's PDFs, where they are, what this
 * page can read, and the collections that hold them.
 *
 * Every list is a query keyed by what it lists, so a request for a place the
 * author has left can never land in the place they are in, and a change
 * marks the lists it affects stale instead of each view refreshing the
 * others by hand.
 */

/** A scope as a key part, with the unset parts left out. */
function scopeKey(scope: ResourceScopeOptions) {
  return {
    scope: scope.scope,
    documentId: scope.documentId ?? null,
    collectionId: scope.collectionId ?? null,
  };
}

export const resourceKeys = {
  all: (workspaceId: string) => [...workspaceScope(workspaceId), 'resources'] as const,
  lists: (workspaceId: string) => [...workspaceScope(workspaceId), 'resources', 'list'] as const,
  list: (workspaceId: string, scope: ResourceScopeOptions, pageSize: number) =>
    [...workspaceScope(workspaceId), 'resources', 'list', { ...scopeKey(scope), pageSize }] as const,
  details: (workspaceId: string) => [...workspaceScope(workspaceId), 'resources', 'detail'] as const,
  detail: (workspaceId: string, resourceId: number) =>
    [...workspaceScope(workspaceId), 'resources', 'detail', resourceId] as const,
  searches: (workspaceId: string) => [...workspaceScope(workspaceId), 'resources', 'search'] as const,
  search: (workspaceId: string, scope: ResourceScopeOptions, query: string) =>
    [...workspaceScope(workspaceId), 'resources', 'search', { ...scopeKey(scope), query }] as const,
  text: (workspaceId: string, resourceId: number, start: number) =>
    [...workspaceScope(workspaceId), 'resources', 'text', resourceId, start] as const,
};

export const collectionKeys = {
  all: (workspaceId: string) => [...workspaceScope(workspaceId), 'collections'] as const,
  /** One level of the hierarchy, with this page's grant state on each row (Browse). */
  children: (workspaceId: string, parentId: number | null, documentId: string | null, pageSize: number) =>
    [...workspaceScope(workspaceId), 'collections', 'children', { parentId, documentId, pageSize }] as const,
  /** One branch of the destination picker's tree, with no page attached. */
  branch: (workspaceId: string, parentId: number | null, pageSize: number) =>
    [...workspaceScope(workspaceId), 'collections', 'branch', { parentId, pageSize }] as const,
  details: (workspaceId: string) => [...workspaceScope(workspaceId), 'collections', 'detail'] as const,
  detail: (workspaceId: string, collectionId: number) =>
    [...workspaceScope(workspaceId), 'collections', 'detail', { collectionId }] as const,
  /** The collections one page uses. */
  grants: (workspaceId: string, documentId: string) =>
    [...workspaceScope(workspaceId), 'collections', 'grants', documentId] as const,
};

/* ---------------------------------------------------------------- resources */

/** The PDFs at one place, a page at a time. */
export function resourceListQuery(workspaceId: string, scope: ResourceScopeOptions, pageSize: number) {
  return infiniteQueryOptions({
    queryKey: resourceKeys.list(workspaceId, scope, pageSize),
    queryFn: ({ pageParam, signal }) =>
      listResources(workspaceId, { ...scope, limit: pageSize, cursor: pageParam }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ResourceListResponse) => last.next_cursor ?? undefined,
  });
}

/** One PDF, for one that is not in the list on screen. */
export function resourceQuery(workspaceId: string, resourceId: number) {
  return queryOptions({
    queryKey: resourceKeys.detail(workspaceId, resourceId),
    queryFn: ({ signal }) => getResource(workspaceId, resourceId, { signal }),
  });
}

/** Every row of a paged list, once each, in the order the pages gave them. */
export function resourcesOf(data: InfiniteData<ResourceListResponse> | undefined): ResourceItem[] {
  if (!data) return [];
  const byId = new Map<number, ResourceItem>();
  for (const page of data.pages) for (const resource of page.items) byId.set(resource.id, resource);
  return [...byId.values()];
}

/** A search inside the PDFs at one place, a page of matches at a time. */
export function resourceSearchQuery(workspaceId: string, scope: ResourceScopeOptions, query: string) {
  return infiniteQueryOptions({
    queryKey: resourceKeys.search(workspaceId, scope, query),
    queryFn: ({ pageParam, signal }) =>
      searchResources(workspaceId, { query, ...scope, cursor: pageParam }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ResourceSearchResponse) => last.next_cursor ?? undefined,
  });
}

/** The pages of one search, as one answer. */
export function searchResultOf(data: InfiniteData<ResourceSearchResponse> | undefined): ResourceSearchResponse | null {
  const [first, ...rest] = data?.pages ?? [];
  if (!first) return null;
  return rest.reduce((previous, page) => {
    const skipped = new Map(
      [...previous.resources_skipped, ...page.resources_skipped].map((item) => [item.resource_id, item]),
    );
    return {
      ...page,
      items: [...previous.items, ...page.items],
      resources_searched: previous.resources_searched + page.resources_searched,
      resources_skipped: [...skipped.values()],
      truncated: previous.truncated || page.truncated,
    };
  }, first);
}

/** A PDF's text from `start`, a window at a time. */
export function resourceTextQuery(workspaceId: string, resourceId: number, start: number, windowChars: number) {
  return infiniteQueryOptions({
    queryKey: resourceKeys.text(workspaceId, resourceId, start),
    queryFn: ({ pageParam, signal }) =>
      readResourceMarkdown(workspaceId, resourceId, { offset: pageParam, limit: windowChars }, { signal }),
    initialPageParam: start,
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });
}

type ResourcePages = InfiniteData<ResourceListResponse>;

function mapRows(data: ResourcePages | undefined, map: (rows: ResourceItem[]) => ResourceItem[]) {
  return data && { ...data, pages: data.pages.map((page) => ({ ...page, items: map(page.items) })) };
}

/** Show the server's answer for one PDF wherever it is listed. */
export function patchResource(queryClient: QueryClient, workspaceId: string, resource: ResourceItem): void {
  queryClient.setQueriesData<ResourcePages>({ queryKey: resourceKeys.lists(workspaceId) }, (data) =>
    mapRows(data, (rows) => rows.map((row) => (row.id === resource.id ? resource : row))),
  );
  queryClient.setQueryData(resourceKeys.detail(workspaceId, resource.id), resource);
}

/** Lists that hold the PDF, or that would hold it after a move, and the PDF itself. */
function invalidateResourceLists(queryClient: QueryClient, workspaceId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: resourceKeys.lists(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: resourceKeys.searches(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: resourceKeys.details(workspaceId) }),
  ]);
}

/** Stop reads that would land under an optimistic change. */
function cancelResourceLists(queryClient: QueryClient, workspaceId: string) {
  return queryClient.cancelQueries({ queryKey: resourceKeys.lists(workspaceId) });
}

/**
 * Library changes run one at a time, in the order they were asked for, so a
 * slow first response never lands after a second one.
 */
const LIBRARY_MUTATIONS = { id: 'library' };

/** Where a PDF is after a move to `target`, before the server has said so. */
function movedLocation(target: ResourceAttachmentTarget): ResourceLocation {
  if (target.documentId) return { kind: 'document', document_id: target.documentId, document_name: null };
  if (target.collectionId != null) return { kind: 'collection', collection_id: target.collectionId, collection_name: null };
  return { kind: 'unfiled' };
}

/** Move a PDF to a page, a collection or Unfiled; it moves on screen at once. */
export function useMoveResource(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    scope: LIBRARY_MUTATIONS,
    mutationFn: ({ resourceId, target }: { resourceId: number; target: ResourceAttachmentTarget }) =>
      moveResource(workspaceId, resourceId, target),
    onMutate: async ({ resourceId, target }) => {
      await cancelResourceLists(queryClient, workspaceId);
      const moved = (row: ResourceItem): ResourceItem => ({ ...row, location: movedLocation(target) });
      queryClient.setQueriesData<ResourcePages>({ queryKey: resourceKeys.lists(workspaceId) }, (data) =>
        mapRows(data, (rows) => rows.map((row) => (row.id === resourceId ? moved(row) : row))),
      );
      queryClient.setQueryData<ResourceItem>(resourceKeys.detail(workspaceId, resourceId), (row) => row && moved(row));
    },
    // A move changes what this page can read and what each collection holds.
    // The lists read again rather than taking the answer: a list read after
    // the move started is newer than it.
    onSettled: () => Promise.all([
      invalidateResourceLists(queryClient, workspaceId),
      queryClient.invalidateQueries({ queryKey: collectionKeys.all(workspaceId) }),
    ]),
  });
}

/** Rename a PDF; the new name shows at once. */
export function useRenameResource(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    scope: LIBRARY_MUTATIONS,
    mutationFn: ({ resource, filename }: { resource: ResourceItem; filename: string }) =>
      renameResource(workspaceId, resource.id, filename),
    onMutate: async ({ resource, filename }) => {
      await cancelResourceLists(queryClient, workspaceId);
      patchResource(queryClient, workspaceId, { ...resource, filename });
    },
    onError: (_, { resource }) => patchResource(queryClient, workspaceId, resource),
    onSuccess: (resource) => patchResource(queryClient, workspaceId, resource),
    onSettled: () => invalidateResourceLists(queryClient, workspaceId),
  });
}

/** Move a PDF to the Trash; it leaves every list at once, and comes back if the server refuses. */
export function useTrashResource(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    scope: LIBRARY_MUTATIONS,
    mutationFn: (resourceId: number) => trashResource(workspaceId, resourceId),
    onMutate: async (resourceId) => {
      await cancelResourceLists(queryClient, workspaceId);
      queryClient.setQueriesData<ResourcePages>({ queryKey: resourceKeys.lists(workspaceId) }, (data) =>
        mapRows(data, (rows) => rows.filter((row) => row.id !== resourceId)),
      );
    },
    onSuccess: (_, resourceId) => queryClient.removeQueries({ queryKey: resourceKeys.detail(workspaceId, resourceId) }),
    onSettled: () => Promise.all([
      invalidateResourceLists(queryClient, workspaceId),
      queryClient.invalidateQueries({ queryKey: collectionKeys.all(workspaceId) }),
    ]),
  });
}

/** Convert a PDF's text again; it shows as converting at once. */
export function useExtractResource(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    scope: LIBRARY_MUTATIONS,
    mutationFn: ({ resource, force }: { resource: ResourceItem; force: boolean }) =>
      extractResource(workspaceId, resource.id, { force }),
    onMutate: async ({ resource }) => {
      await cancelResourceLists(queryClient, workspaceId);
      patchResource(queryClient, workspaceId, {
        ...resource,
        extraction: { ...resource.extraction, status: 'running', error: null },
      });
    },
    onError: (_, { resource }) => patchResource(queryClient, workspaceId, resource),
    // As for a move, the lists read again; the converting row polls itself.
    onSettled: () => invalidateResourceLists(queryClient, workspaceId),
  });
}

/**
 * Store a PDF on a page, in a collection or in Unfiled. Every list reads
 * again, as the PDF may belong in any of them.
 */
export function useUploadResource(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, target }: { file: File; target: ResourceAttachmentTarget }) =>
      uploadResource(workspaceId, file, target),
    onSuccess: () => {
      void invalidateResourceLists(queryClient, workspaceId);
      void queryClient.invalidateQueries({ queryKey: collectionKeys.all(workspaceId) });
    },
  });
}

/**
 * Show PDFs that were just uploaded at the top of the list `shownAt`. The
 * upload's answer is the authoritative row, so it shows at once rather than
 * waiting for a read that has not seen it yet.
 */
export function addUploadedResources(
  queryClient: QueryClient,
  resources: ResourceItem[],
  shownAt: readonly unknown[] | null,
): void {
  if (resources.length === 0 || !shownAt) return;
  const ids = new Set(resources.map((resource) => resource.id));
  const without = (rows: ResourceItem[]) => rows.filter((row) => !ids.has(row.id));
  queryClient.setQueryData<ResourcePages>(shownAt, (data) => {
    const [first, ...rest] = data?.pages ?? [];
    if (!data || !first) return data;
    return {
      ...data,
      pages: [
        { ...first, items: [...resources, ...without(first.items)] },
        ...rest.map((page) => ({ ...page, items: without(page.items) })),
      ],
    };
  });
}

/* -------------------------------------------------------------- collections */

/** One level of collections, with this page's grant state on each row. */
export function collectionChildrenQuery(
  workspaceId: string,
  parentId: number | null,
  documentId: string | null,
  pageSize: number,
) {
  return infiniteQueryOptions({
    queryKey: collectionKeys.children(workspaceId, parentId, documentId, pageSize),
    queryFn: ({ pageParam, signal }) =>
      listCollections(workspaceId, { parentId, grantStateFor: documentId, limit: pageSize, cursor: pageParam }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: CollectionListResponse) => last.next_cursor ?? undefined,
  });
}

/** Every collection of a paged level, once each. */
export function collectionsOf(pages: readonly CollectionListResponse[] | undefined): CollectionItem[] {
  const byId = new Map<number, CollectionItem>();
  for (const page of pages ?? []) for (const collection of page.items) byId.set(collection.id, collection);
  return [...byId.values()];
}

/** A branch of the destination tree: the pages read so far. */
export type CollectionBranchData = { pages: CollectionListResponse[] };

/**
 * One branch of the destination picker's tree. Reading it again reads as many
 * rows as it already holds, so a refresh never folds away what the author
 * paged in; `loadMoreCollections` adds the next page.
 */
export function collectionBranchQuery(
  queryClient: QueryClient,
  workspaceId: string,
  parentId: number | null,
  pageSize: number,
) {
  const queryKey = collectionKeys.branch(workspaceId, parentId, pageSize);
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }): Promise<CollectionBranchData> => {
      const held = collectionsOf(queryClient.getQueryData<CollectionBranchData>(queryKey)?.pages).length;
      const target = Math.max(pageSize, held);
      const pages: CollectionListResponse[] = [];
      let cursor: string | null = null;
      let count = 0;
      do {
        const page: CollectionListResponse = await listCollections(
          workspaceId,
          { parentId, limit: pageSize, cursor },
          { signal },
        );
        pages.push(page);
        count += page.items.length;
        cursor = page.next_cursor;
      } while (cursor !== null && count < target);
      return { pages };
    },
  });
}

/** Read the next page of a tree branch into the cache. */
export async function loadMoreCollections(
  queryClient: QueryClient,
  workspaceId: string,
  parentId: number | null,
  pageSize: number,
): Promise<void> {
  const queryKey = collectionKeys.branch(workspaceId, parentId, pageSize);
  const cursor = queryClient.getQueryData<CollectionBranchData>(queryKey)?.pages.at(-1)?.next_cursor ?? null;
  if (cursor === null) return;
  const page = await listCollections(workspaceId, { parentId, limit: pageSize, cursor });
  queryClient.setQueryData<CollectionBranchData>(queryKey, (data) =>
    data && data.pages.at(-1)?.next_cursor === cursor ? { pages: [...data.pages, page] } : data,
  );
}

/** A collection, its path from the top and its counts. */
export function collectionDetailQuery(workspaceId: string, collectionId: number) {
  return queryOptions({
    queryKey: collectionKeys.detail(workspaceId, collectionId),
    queryFn: ({ signal }) => getCollection(workspaceId, collectionId, { signal }),
  });
}

/** The counter in a collection's ETag, `"cwc:{row_version}"`; higher is newer. */
function rowVersion(etag: string): number {
  const match = /^"cwc:(\d+)"$/.exec(etag);
  return match ? Number(match[1]) : -1;
}

/**
 * The newest ETag this client has seen for a collection: the one it was
 * handed, or a fresher one a read brought in since (after a 412, the detail
 * and the lists read again). A write is locked on it.
 */
export function freshCollectionEtag(queryClient: QueryClient, workspaceId: string, ref: Pick<CollectionRef, 'id' | 'etag'>): string {
  let best = ref.etag;
  const consider = (etag: string | undefined) => {
    if (etag && rowVersion(etag) > rowVersion(best)) best = etag;
  };
  consider(queryClient.getQueryData<CollectionDetail>(collectionKeys.detail(workspaceId, ref.id))?.etag);
  for (const [, data] of queryClient.getQueriesData<unknown>({ queryKey: collectionKeys.all(workspaceId) })) {
    const pages = (data as { pages?: unknown } | undefined)?.pages;
    if (!Array.isArray(pages)) continue;
    for (const page of pages as CollectionListResponse[]) {
      for (const item of page.items ?? []) if (item.id === ref.id) consider(item.etag);
    }
  }
  return best;
}

/** "Thesis › Chapter 2": a collection's path from the top, itself last. */
export function pathLabel(path: readonly CollectionPathItem[]): string {
  return path.map((item) => item.name).join(' › ');
}

/**
 * Where each of these collections is, as "Thesis › Chapter 2", for the path
 * hints of search results. One detail read per collection, shared with every
 * other reader of that collection; the top level is `null` and reads nothing.
 */
export function useCollectionPaths(workspaceId: string, collectionIds: readonly (number | null)[]) {
  const key = [...new Set(collectionIds.filter((id): id is number => id !== null))].sort((a, b) => a - b).join(',');
  const ids = useMemo(() => (key ? key.split(',').map(Number) : []), [key]);
  const combine = useCallback(
    (results: { data?: CollectionDetail }[]) => {
      const paths = new Map<number, CollectionPathItem[]>();
      results.forEach((result, index) => {
        const id = ids[index];
        if (id !== undefined && result.data) paths.set(id, result.data.path);
      });
      return paths;
    },
    [ids],
  );
  return useQueries({ queries: ids.map((id) => collectionDetailQuery(workspaceId, id)), combine });
}

/** The collections a page uses. */
export function pdfGrantsQuery(workspaceId: string, documentId: string) {
  return queryOptions({
    queryKey: collectionKeys.grants(workspaceId, documentId),
    queryFn: ({ signal }) => listPdfGrants(workspaceId, documentId, { signal }),
  });
}

/**
 * Collection changes run one at a time, then every collection read and every
 * PDF list reads again: a collection's name, place, contents and grants are
 * shown in all of them.
 */
export function useCollectionMutations(workspaceId: string) {
  const queryClient = useQueryClient();
  const settled = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: collectionKeys.all(workspaceId) }),
      invalidateResourceLists(queryClient, workspaceId),
    ]);
  const options = { scope: LIBRARY_MUTATIONS, onSettled: settled };
  const etagOf = (collection: Pick<CollectionRef, 'id' | 'etag'>) => freshCollectionEtag(queryClient, workspaceId, collection);

  const create = useMutation({
    ...options,
    mutationFn: (input: { name: string; description?: string | null; parentId: number | null; position?: CollectionPosition }) =>
      createCollection(workspaceId, input),
  });
  const rename = useMutation({
    ...options,
    mutationFn: ({ collection, changes }: { collection: Pick<CollectionRef, 'id' | 'etag'>; changes: CollectionChanges }) =>
      updateCollection(workspaceId, collection.id, etagOf(collection), changes),
    // The answer is the row as it is now: every list that shows it shows that.
    onSuccess: (detail: CollectionDetail) => patchCollection(queryClient, workspaceId, detail),
  });
  const move = useMutation({
    ...options,
    mutationFn: ({ collection, parentId }: { collection: Pick<CollectionRef, 'id' | 'etag'>; parentId: number | null }) =>
      moveCollection(workspaceId, collection.id, etagOf(collection), { parentId }),
  });
  const setUsed = useMutation({
    ...options,
    mutationFn: ({ collectionId, used, documentId }: { collectionId: number; used: boolean; documentId: string }): Promise<PdfGrantState> =>
      used ? grantPdfs(workspaceId, documentId, collectionId) : revokePdfs(workspaceId, documentId, collectionId),
  });

  return {
    create: create.mutateAsync,
    rename: rename.mutateAsync,
    move: move.mutateAsync,
    setUsed: setUsed.mutateAsync,
  };
}

/** Show a collection as a write left it, in its detail and wherever a list holds its row. */
export function patchCollection(queryClient: QueryClient, workspaceId: string, detail: CollectionDetail): void {
  queryClient.setQueryData(collectionKeys.detail(workspaceId, detail.id), detail);
  queryClient.setQueriesData<unknown>({ queryKey: collectionKeys.all(workspaceId) }, (data: unknown) => {
    const pages = (data as { pages?: unknown } | undefined)?.pages;
    if (!Array.isArray(pages)) return data;
    return {
      ...(data as object),
      pages: (pages as CollectionListResponse[]).map((page) => ({
        ...page,
        items: page.items.map((item) => (item.id === detail.id
          ? {
              ...item,
              name: detail.name,
              description: detail.description,
              sort_mode: detail.sort_mode,
              grant_new_pages: detail.grant_new_pages,
              sort_key: detail.sort_key,
              etag: detail.etag,
              updated_at: detail.updated_at,
            }
          : item)),
      })),
    };
  });
}

/** Every collection's detail and this page's grants, read again. */
export function refreshCollectionDetails(queryClient: QueryClient, workspaceId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: collectionKeys.details(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: [...collectionKeys.all(workspaceId), 'grants'] }),
  ]);
}
