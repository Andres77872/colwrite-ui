import { useCallback, useMemo } from 'react';
import { infiniteQueryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  collectionChildrenQuery,
  collectionDetailQuery,
  collectionsOf,
  grantStateOf,
  pdfGrantsQuery,
  useCollectionMutations,
  type CollectionChanges,
  type CollectionDetail,
  type CollectionGrantState,
  type CollectionItem,
  type CollectionRef,
  type PdfGrantState,
} from '@/data/resources';
import { documentKeys, listDocuments, pageOrder, type DocumentListResult, type DocumentSummary } from '@/data/documents';
import { errorMessage } from '@/api/errors';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import type { SortMode } from '@/data/workspaces';

export const BROWSE_PAGE_SIZE = 50;

export type CollectionBrowse = {
  /** The collections at this level, with this page's grant state on each. */
  collections: CollectionItem[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** The open collection's pages, in its order; empty at the top level. */
  pages: DocumentSummary[];
  pagesLoading: boolean;
  hasMorePages: boolean;
  loadingMorePages: boolean;
  loadMorePages: () => Promise<void>;
  /** The open collection and its path from the top. */
  detail: CollectionDetail | null;
  /** This page's grant on the open collection, from the page's grants and its path. */
  grant: CollectionGrantState | null;
  detailLoading: boolean;
  detailError: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  create: (input: { name: string; description?: string | null; parentId: number | null }) => Promise<CollectionDetail>;
  rename: (collection: CollectionRef, changes: CollectionChanges) => Promise<CollectionDetail>;
  /** Let this page's assistant read a collection, or stop. */
  setUsed: (collectionId: number, used: boolean, documentId: string) => Promise<PdfGrantState>;
};

/** One collection's pages, a page of rows at a time, in the collection's order. */
function collectionPagesQuery(workspaceId: string, collectionId: number, mode: SortMode) {
  return infiniteQueryOptions({
    queryKey: [...documentKeys.lists(workspaceId), 'browse', { collectionId, mode }] as const,
    queryFn: ({ pageParam, signal }) =>
      listDocuments(workspaceId, { home: collectionId, limit: BROWSE_PAGE_SIZE, cursor: pageParam, ...pageOrder(mode) }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: DocumentListResult) => last.nextCursor ?? undefined,
  });
}

/**
 * What Browse shows at one level: the collections there and, inside one, its
 * detail and its pages. A list and a breadcrumb rather than a second tree,
 * because the tree lives in the sidebar; both read the same collections in
 * the same order.
 *
 * Where the author is browsing belongs to the caller and survives a page
 * switch. A new page only changes the grant state ("Used here"), so the rows
 * on screen stay while that level is read again for the new page (C-15).
 */
export function useCollectionBrowse(
  parentId: number | null,
  documentId: string | null,
  { enabled = true }: { enabled?: boolean } = {},
): CollectionBrowse {
  const workspaceId = useWorkspaceId();
  const children = useInfiniteQuery({
    ...collectionChildrenQuery(workspaceId, parentId, documentId, BROWSE_PAGE_SIZE),
    enabled,
    // The same level for another page keeps its rows while it reads; another
    // level starts empty.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[4].parentId === parentId ? previous : undefined,
  });
  const detail = useQuery({
    ...collectionDetailQuery(workspaceId, parentId ?? 0),
    enabled: enabled && parentId !== null,
  });
  const grants = useQuery({
    ...pdfGrantsQuery(workspaceId, documentId ?? ''),
    enabled: enabled && parentId !== null && documentId !== null,
  });
  const mode = parentId !== null ? detail.data?.sort_mode ?? null : null;
  const pageList = useInfiniteQuery({
    ...collectionPagesQuery(workspaceId, parentId ?? 0, mode ?? 'name'),
    enabled: enabled && parentId !== null && mode !== null,
  });
  const { create, rename, setUsed } = useCollectionMutations(workspaceId);

  const refetchChildren = children.refetch;
  const refetchDetail = detail.refetch;
  const refetchGrants = grants.refetch;
  const refresh = useCallback(async () => {
    if (!enabled) return;
    await Promise.all([
      refetchChildren(),
      parentId !== null ? refetchDetail() : null,
      parentId !== null && documentId !== null ? refetchGrants() : null,
    ]);
  }, [documentId, enabled, parentId, refetchChildren, refetchDetail, refetchGrants]);

  const { fetchNextPage, hasNextPage, isFetching } = children;
  const loadMore = useCallback(async () => {
    if (!hasNextPage || isFetching) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetching]);

  const nextPages = pageList.fetchNextPage;
  const morePages = pageList.hasNextPage;
  const fetchingPages = pageList.isFetching;
  const loadMorePages = useCallback(async () => {
    if (!morePages || fetchingPages) return;
    await nextPages();
  }, [fetchingPages, morePages, nextPages]);

  const collections = useMemo(() => collectionsOf(children.data?.pages), [children.data]);
  const pages = useMemo(() => {
    const byId = new Map<string, DocumentSummary>();
    for (const page of pageList.data?.pages ?? []) for (const row of page.documents) byId.set(row.id, row);
    return [...byId.values()];
  }, [pageList.data]);
  const open = parentId === null ? null : (detail.data ?? null);
  const grant = useMemo(
    () => (open && documentId !== null && grants.data ? grantStateOf(open.path, grants.data) : null),
    [documentId, grants.data, open],
  );

  return {
    collections,
    hasMore: children.hasNextPage,
    loading: !enabled || children.isPending,
    loadingMore: children.isFetchingNextPage,
    error: children.isError ? errorMessage(children.error, 'Could not load collections') : null,
    pages: parentId === null ? [] : pages,
    pagesLoading: parentId !== null && (mode === null || pageList.isPending),
    hasMorePages: parentId !== null && pageList.hasNextPage,
    loadingMorePages: pageList.isFetchingNextPage,
    loadMorePages,
    detail: open,
    grant,
    detailLoading: parentId !== null && (detail.isPending || detail.isFetching),
    detailError: parentId !== null && detail.isError ? errorMessage(detail.error, 'Could not open that collection') : null,
    refresh,
    loadMore,
    create,
    rename: useCallback(
      (collection: CollectionRef, changes: CollectionChanges) => rename({ collection, changes }),
      [rename],
    ),
    setUsed: useCallback(
      (collectionId: number, used: boolean, pageId: string) => setUsed({ collectionId, used, documentId: pageId }),
      [setUsed],
    ),
  };
}
