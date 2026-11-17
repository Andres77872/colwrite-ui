import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, unwrap, unwrapWithHeaders } from '@/api/client';
import { toEditorDoc, toWireContent } from '@/api/content';
import type {
  DocumentPlacementResponse,
  DocumentStateResponse,
  DocumentSummaryResponse,
  PlaceAfter,
  PlaceBefore,
  paths,
} from '@/api/schema';
import type { Doc } from '@/editor/types';
import { uid } from '@/lib/uid';
import { invalidateWorkspace, workspaceScope, type SortMode } from './workspaces';

/**
 * A workspace's pages (`/workspaces/{w}/documents`,
 * `ColWrite-api/docs/document-history-api.md`).
 *
 * Every write is locked on the page's strong `ETag`: a save sends the one it
 * was based on as `If-Match`, with an `Idempotency-Key`, and a page someone
 * else saved since answers 412 `stale_head`. The editor session's own reads
 * and writes of the open page are not cached: the session owns the open
 * body, its ETag and its saves.
 */

type ListQuery = NonNullable<paths['/workspaces/{workspace_id}/documents']['get']['parameters']['query']>;
export type DocumentSortBy = NonNullable<ListQuery['sort_by']>;
export type DocumentSortOrder = NonNullable<ListQuery['sort_order']>;

/**
 * Which pages a list holds: the whole workspace (`any`, the default), the top
 * level (`root`), or the pages whose home is one collection.
 */
export type DocumentHome = number | 'root' | 'any';

export interface DocumentListOptions {
  limit?: number;
  query?: string;
  tags?: string[];
  sortBy?: DocumentSortBy;
  sortOrder?: DocumentSortOrder;
  /** `custom` order needs a home: `root` or a collection. */
  home?: DocumentHome;
  cursor?: string | null;
}

/** One row of a page list, with where the page lives. */
export interface DocumentSummary {
  id: string;
  name: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** The page's home: a collection, or `null` for the top level. */
  collectionId: number | null;
  sortKey: string;
  /** What a move from this row sends as `If-Match`; the content ETag comes from the page read. */
  placementEtag: string;
}

/** Where a new or moved page goes among its home's pages. */
export type PagePosition = 'last' | PlaceAfter | PlaceBefore;

/** Where a page lives: its home, its place there, and the ETag the next move is locked on. */
export type PagePlacement = {
  documentId: string;
  collectionId: number | null;
  sortKey: string;
  placementEtag: string;
  /** The workspace's tree version after a move; `null` from a page read. */
  treeVersion: number | null;
};

export interface DocumentListResult {
  documents: DocumentSummary[];
  /** There are more rows past these; the list holds no total. */
  nextCursor: string | null;
}

/** A page as the editor opens it: its body, the ETag the next write is locked on, when it was saved, and where it lives. */
export type OpenedDocument = {
  doc: Doc;
  etag: string;
  updatedAt: string | null;
  placement: PagePlacement;
};

type Transport = { signal?: AbortSignal };

function requireEtag(headers: Headers): string {
  const etag = headers.get('ETag');
  if (!etag) throw new Error('The server did not provide a concurrency token.');
  return etag;
}

function statePlacement(state: DocumentStateResponse): PagePlacement {
  return {
    documentId: state.document_id,
    collectionId: state.collection_id,
    sortKey: state.sort_key,
    placementEtag: state.placement_etag,
    treeVersion: null,
  };
}

function openedDocument(state: DocumentStateResponse, headers: Headers): OpenedDocument {
  return {
    doc: toEditorDoc(state.content),
    etag: requireEtag(headers),
    updatedAt: state.updated_at || null,
    placement: statePlacement(state),
  };
}

/** Where a new page goes: a collection (`null` is the top level), at `position` among its pages. */
export type NewPagePlace = { collectionId?: number | null; position?: PagePosition };

/** Create a page in the workspace, at the top level or in a collection. */
export async function createDocument(
  workspaceId: string,
  doc: Doc,
  place: NewPagePlace = {},
): Promise<OpenedDocument & { id: string }> {
  const { data, headers } = await unwrapWithHeaders(api.POST('/workspaces/{workspace_id}/documents', {
    params: { path: { workspace_id: workspaceId }, header: { 'Idempotency-Key': uid() } },
    body: {
      content: toWireContent(doc),
      ...(place.collectionId != null ? { collection_id: place.collectionId } : {}),
      ...(place.position ? { position: place.position } : {}),
    },
  }));
  return { id: data.document_id, ...openedDocument(data, headers) };
}

function placementOf(response: DocumentPlacementResponse): PagePlacement {
  return {
    documentId: response.document_id,
    collectionId: response.collection_id,
    sortKey: response.sort_key,
    placementEtag: response.placement_etag,
    treeVersion: response.tree_version,
  };
}

/**
 * Give a page a new home (`null` for the top level). Locked on its placement
 * ETag, which a save never changes, and a move never changes the content
 * ETag: the open page keeps saving. A placement read since is 412
 * `stale_placement`; the move is not retried.
 */
export async function movePage(
  workspaceId: string,
  documentId: string,
  placementEtag: string,
  target: { collectionId: number | null; position?: PagePosition },
): Promise<PagePlacement> {
  return placementOf(await unwrap(api.POST('/workspaces/{workspace_id}/documents/{document_id}/move', {
    params: { path: { workspace_id: workspaceId, document_id: documentId }, header: { 'If-Match': placementEtag } },
    body: { collection_id: target.collectionId, ...(target.position ? { position: target.position } : {}) },
  })));
}

/** Place a page among its current siblings, in a home in custom order. */
export async function reorderPage(
  workspaceId: string,
  documentId: string,
  placementEtag: string,
  position: PagePosition,
): Promise<PagePlacement> {
  return placementOf(await unwrap(api.POST('/workspaces/{workspace_id}/documents/{document_id}/reorder', {
    params: { path: { workspace_id: workspaceId, document_id: documentId }, header: { 'If-Match': placementEtag } },
    body: { position },
  })));
}

/** A page's saved body and the ETag a write must present. */
export async function getDocument(workspaceId: string, documentId: string, init?: Transport): Promise<OpenedDocument> {
  const { data, headers } = await unwrapWithHeaders(api.GET('/workspaces/{workspace_id}/documents/{document_id}', {
    params: { path: { workspace_id: workspaceId, document_id: documentId } },
    signal: init?.signal,
  }));
  return openedDocument(data, headers);
}

/**
 * Save a page's whole body over the head `etag` names. The answer's ETag is
 * what the next save must send; a head that moved since is 412 `stale_head`.
 */
export async function saveDocument(
  workspaceId: string,
  documentId: string,
  doc: Doc,
  etag: string,
): Promise<{ etag: string; updatedAt: string | null }> {
  const { data, headers } = await unwrapWithHeaders(api.PUT('/workspaces/{workspace_id}/documents/{document_id}', {
    params: {
      path: { workspace_id: workspaceId, document_id: documentId },
      header: { 'If-Match': etag, 'Idempotency-Key': uid() },
    },
    body: { content: toWireContent(doc) },
  }));
  return { etag: requireEtag(headers), updatedAt: data.updated_at || null };
}

/**
 * What took a page to the Trash: the page itself (`document`), or the
 * collection it went with (`collection`), which is what a restore takes.
 */
export type TrashRoot = { kind: 'document' | 'collection'; id: string };

/** A page in the Trash: what took it there and when it is deleted for good. */
export type TrashedPage = {
  documentId: string;
  /** Where it lived, and goes back to on a restore (the top level when that is gone). */
  collectionId: number | null;
  trashRoot: TrashRoot;
  purgeAfter: string | null;
};

/**
 * Move a page to the Trash. It takes no content precondition, because a
 * trash can be undone: the page keeps its body, history, grants and PDFs, and
 * its content ETag does not change. A page already there is 409
 * `document_in_trash`.
 */
export async function trashDocument(workspaceId: string, documentId: string): Promise<TrashedPage> {
  const state = await unwrap(api.POST('/workspaces/{workspace_id}/documents/{document_id}/trash', {
    params: { path: { workspace_id: workspaceId, document_id: documentId }, header: { 'Idempotency-Key': uid() } },
  }));
  return {
    documentId: state.document_id,
    collectionId: state.collection_id,
    trashRoot: state.trash_root ?? { kind: 'document', id: state.document_id },
    purgeAfter: state.purge_after,
  };
}

/**
 * Bring a page back from the Trash, to its home or to the top level when its
 * home is gone. Its content ETag is the one it went with, so an editor that
 * kept it open saves again. A page that went with a collection is 409
 * `document_in_trash` naming that collection; one that is not in the Trash is
 * 409 `not_in_trash`.
 */
export async function restoreDocument(workspaceId: string, documentId: string): Promise<PagePlacement> {
  const state = await unwrap(api.POST('/workspaces/{workspace_id}/documents/{document_id}/restore', {
    params: { path: { workspace_id: workspaceId, document_id: documentId }, header: { 'Idempotency-Key': uid() } },
  }));
  return statePlacement(state);
}

const DEFAULT_LIMIT = 10;
const DEFAULT_SORT_BY: DocumentSortBy = 'updated_at';
const DEFAULT_SORT_ORDER: DocumentSortOrder = 'desc';

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * A list request in one form, so equal lists share a cache entry: the API's
 * defaults filled in, a blank filter left out.
 */
type ListParams = Required<Pick<DocumentListOptions, 'limit' | 'sortBy' | 'sortOrder'>>
  & Pick<DocumentListOptions, 'query' | 'tags' | 'home'>;

function listParams(options: DocumentListOptions): ListParams {
  const query = options.query?.trim();
  const tags = options.tags?.map((tag) => tag.trim()).filter(Boolean);
  return {
    limit: positiveInteger(options.limit, DEFAULT_LIMIT),
    ...(query ? { query } : { query: undefined }),
    ...(tags?.length ? { tags } : {}),
    ...(options.home !== undefined && options.home !== 'any' ? { home: options.home } : {}),
    sortBy: options.sortBy ?? DEFAULT_SORT_BY,
    sortOrder: options.sortOrder ?? DEFAULT_SORT_ORDER,
  };
}

export function summary(row: DocumentSummaryResponse): DocumentSummary {
  return {
    id: row.id,
    name: row.name,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    collectionId: row.collection_id,
    sortKey: row.sort_key,
    placementEtag: row.placement_etag,
  };
}

/** The first rows of a workspace's pages, or of one home's, filtered and sorted on the server. */
export async function listDocuments(
  workspaceId: string,
  options: DocumentListOptions = {},
  init?: Transport,
): Promise<DocumentListResult> {
  const { limit, query, tags, sortBy, sortOrder, home } = listParams(options);
  const response = await unwrap(api.GET('/workspaces/{workspace_id}/documents', {
    params: {
      path: { workspace_id: workspaceId },
      query: {
        limit,
        sort_by: sortBy,
        sort_order: sortOrder,
        ...(home !== undefined ? { collection_id: home } : {}),
        ...(query ? { query } : {}),
        ...(tags ? { tags } : {}),
        ...(options.cursor ? { cursor: options.cursor } : {}),
      },
    },
    signal: init?.signal,
  }));
  return { documents: response.items.map(summary), nextCursor: response.next_cursor };
}

export const documentKeys = {
  all: (workspaceId: string) => [...workspaceScope(workspaceId), 'documents'] as const,
  /** Every list of pages: the sidebar, the palette, the reference picker. */
  lists: (workspaceId: string) => [...workspaceScope(workspaceId), 'documents', 'list'] as const,
  list: (workspaceId: string, options: DocumentListOptions) =>
    [...workspaceScope(workspaceId), 'documents', 'list', listParams(options)] as const,
  /** Another page's body, read to pick a block from it. */
  content: (workspaceId: string, documentId: string) =>
    [...workspaceScope(workspaceId), 'documents', 'content', documentId] as const,
  /**
   * The pages of one home in the tree, as many pages of rows as were read.
   * Under `lists`, so whatever re-lists the pages refreshes the tree too.
   */
  branch: (workspaceId: string, home: number | null, order: string, pageSize: number) =>
    [...workspaceScope(workspaceId), 'documents', 'list', 'branch', { home, order, pageSize }] as const,
  branches: (workspaceId: string) => [...workspaceScope(workspaceId), 'documents', 'list', 'branch'] as const,
  /** Where one page lives: what the breadcrumb, "New page here" and a move from the page menu read. */
  placement: (workspaceId: string, documentId: string) =>
    [...workspaceScope(workspaceId), 'documents', 'placement', documentId] as const,
  placements: (workspaceId: string) => [...workspaceScope(workspaceId), 'documents', 'placement'] as const,
};

/**
 * Where a page lives. The editor fills it from its own read and every move
 * writes its answer here, so it is read from the server only when the tree
 * moved elsewhere (`tree_version`).
 */
export function pagePlacementQuery(workspaceId: string, documentId: string) {
  return queryOptions({
    queryKey: documentKeys.placement(workspaceId, documentId),
    queryFn: async ({ signal }): Promise<PagePlacement> =>
      (await getDocument(workspaceId, documentId, { signal })).placement,
    staleTime: Infinity,
  });
}

/** Record where a page lives now: the editor's read, or a move's answer. */
export function setPagePlacement(queryClient: QueryClient, workspaceId: string, placement: PagePlacement): void {
  queryClient.setQueryData(documentKeys.placement(workspaceId, placement.documentId), placement);
}

/** How a home's sort mode reads its pages: by name, by hand, or newest edit first. */
export function pageOrder(mode: SortMode): { sortBy: DocumentSortBy; sortOrder: DocumentSortOrder } {
  switch (mode) {
    case 'name': return { sortBy: 'name', sortOrder: 'asc' };
    case 'custom': return { sortBy: 'custom', sortOrder: 'asc' };
    case 'updated': return { sortBy: 'updated_at', sortOrder: 'desc' };
  }
}

/** The pages of one home in the tree: the pages of rows read so far. */
export type PageBranchData = { pages: DocumentListResult[] };

/** Every row of a branch, once each, in the order the pages gave them. */
export function pagesOf(data: PageBranchData | undefined): DocumentSummary[] {
  const byId = new Map<string, DocumentSummary>();
  for (const page of data?.pages ?? []) for (const row of page.documents) byId.set(row.id, row);
  return [...byId.values()];
}

/**
 * The pages of one home (`null` is the top level), in the home's order.
 * Reading it again reads as many rows as it holds, so a refresh never folds
 * away what the author paged in; `loadMorePages` adds the next page.
 */
export function pageBranchQuery(
  queryClient: QueryClient,
  workspaceId: string,
  home: number | null,
  mode: SortMode,
  pageSize: number,
) {
  const queryKey = documentKeys.branch(workspaceId, home, mode, pageSize);
  const order = pageOrder(mode);
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }): Promise<PageBranchData> => {
      const held = pagesOf(queryClient.getQueryData<PageBranchData>(queryKey)).length;
      const target = Math.max(pageSize, held);
      const pages: DocumentListResult[] = [];
      let cursor: string | null = null;
      let count = 0;
      do {
        const page: DocumentListResult = await listDocuments(
          workspaceId,
          { home: home ?? 'root', limit: pageSize, cursor, ...order },
          { signal },
        );
        pages.push(page);
        count += page.documents.length;
        cursor = page.nextCursor;
      } while (cursor !== null && count < target);
      return { pages };
    },
  });
}

/** Read the next page of a home's pages into the tree. */
export async function loadMorePages(
  queryClient: QueryClient,
  workspaceId: string,
  home: number | null,
  mode: SortMode,
  pageSize: number,
): Promise<void> {
  const queryKey = documentKeys.branch(workspaceId, home, mode, pageSize);
  const cursor = queryClient.getQueryData<PageBranchData>(queryKey)?.pages.at(-1)?.nextCursor ?? null;
  if (cursor === null) return;
  const page = await listDocuments(workspaceId, { home: home ?? 'root', limit: pageSize, cursor, ...pageOrder(mode) });
  queryClient.setQueryData<PageBranchData>(queryKey, (data) =>
    data && data.pages.at(-1)?.nextCursor === cursor ? { pages: [...data.pages, page] } : data,
  );
}

/**
 * A page was created in `home` by someone other than the editor (the
 * assistant's `doc_create`): that branch of the tree reads again, and the
 * flat lists with it.
 */
export function invalidatePageBranch(queryClient: QueryClient, workspaceId: string, home: number | null): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: documentKeys.branches(workspaceId),
      predicate: (query) => branchHome(query.queryKey) === home,
    }),
    queryClient.invalidateQueries({ queryKey: documentKeys.lists(workspaceId), predicate: (query) => branchHome(query.queryKey) === undefined }),
    invalidateWorkspace(queryClient, workspaceId),
  ]);
}

/** The home a tree branch query lists, read from its key. */
export function branchHome(queryKey: readonly unknown[]): number | null | undefined {
  const params = queryKey[5] as { home?: number | null } | undefined;
  return params && 'home' in params ? params.home : undefined;
}

/** One list of a workspace's pages. */
export function documentListQuery(workspaceId: string, options: DocumentListOptions) {
  const params = listParams(options);
  return queryOptions({
    queryKey: documentKeys.list(workspaceId, params),
    queryFn: ({ signal }) => listDocuments(workspaceId, params, { signal }),
  });
}

/** A page's stored body, as the editor's `Doc`. */
export function documentContentQuery(workspaceId: string, documentId: string) {
  return queryOptions({
    queryKey: documentKeys.content(workspaceId, documentId),
    queryFn: async ({ signal }) => (await getDocument(workspaceId, documentId, { signal })).doc,
  });
}

/**
 * Creating, trashing and restoring change which pages a list holds and in
 * which order, so every list reads again, and the workspace with its page
 * count. A save does not: the lists patch the open page's row from the
 * editor (`patchOpenRow`).
 */
export function invalidateDocumentLists(queryClient: QueryClient, workspaceId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: documentKeys.lists(workspaceId) }),
    invalidateWorkspace(queryClient, workspaceId),
  ]);
}

/** The open page as the editor knows it, between saves. */
export type OpenPageRow = {
  documentId: string | null;
  name: string | undefined;
  /** When the editor last saved it, in ms; null before the first save. */
  lastSavedAt: number | null;
};

/**
 * The open page's row shows what the editor knows: its name as typed and when
 * it was last saved. A save patches the row in place rather than listing the
 * pages again (B-12).
 */
export function patchOpenRow(result: DocumentListResult, open: OpenPageRow): DocumentListResult {
  if (!open.documentId || !result.documents.some((row) => row.id === open.documentId)) return result;
  const name = open.name?.trim();
  const savedAt = open.lastSavedAt === null ? null : new Date(open.lastSavedAt).toISOString();
  return {
    ...result,
    documents: result.documents.map((row) =>
      row.id !== open.documentId
        ? row
        : { ...row, name: name || row.name, updatedAt: savedAt ?? row.updatedAt },
    ),
  };
}
