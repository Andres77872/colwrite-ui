import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, describeApiError } from '@/api/errors';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { readJson, treeExpandedKey, writeJson } from '@/lib/storageKeys';
import {
  documentKeys,
  loadMorePages,
  pageBranchQuery,
  pagesOf,
  type DocumentSummary,
  type PageBranchData,
} from '@/data/documents';
import {
  collectionBranchQuery,
  collectionDetailQuery,
  collectionKeys,
  collectionsOf,
  loadMoreCollections,
  type CollectionBranchData,
  type CollectionItem,
} from '@/data/resources';
import { treeMovedElsewhere, workspaceQuery, type SortMode } from '@/data/workspaces';

/** Rows per page of a branch (D14: 50 by default, 100 at most). */
export const TREE_PAGE_SIZE = 50;
/** How many open collections a workspace remembers. */
const MAX_REMEMBERED = 200;
/** How often the tree asks whether it moved elsewhere, while the window is visible. */
const TREE_POLL_MS = 60_000;

/** A collection's children, or the top level's (`parentId: null`): collections first, then pages. */
export type TreeBranch = {
  parentId: number | null;
  collections: CollectionItem[];
  /** Empty when the tree shows collections only. */
  pages: DocumentSummary[];
  /** The order its children are in; null until it is known. */
  sortMode: SortMode | null;
  /** Both lists have answered once. */
  loaded: boolean;
  loading: boolean;
  moreCollections: boolean;
  morePages: boolean;
  loadingMore: 'collections' | 'pages' | null;
  error: string | null;
};

export type WorkspaceTreeOptions = {
  /** Pages under their collections (the sidebar), or collections only (a destination picker). */
  pages?: boolean;
  /** Remember the open collections for the workspace (the sidebar only). */
  persist?: boolean;
  /** Read `tree_version` on focus and every minute, and refresh what is open when it moved (the sidebar only). */
  watch?: boolean;
  pageSize?: number;
  /**
   * Another of the author's workspaces, read for "Copy to workspace…" (a
   * destination picker over the target's collections); by default the one
   * shown. Its reads are keyed by that workspace.
   */
  workspaceId?: string;
};

export type WorkspaceTree = {
  branch: (parentId: number | null) => TreeBranch | undefined;
  expandedIds: ReadonlySet<number>;
  isExpanded: (collectionId: number) => boolean;
  setExpanded: (collectionId: number, expanded: boolean) => void;
  /** Open every collection of a path, for showing what is inside the last one. */
  expandPath: (collectionIds: readonly number[]) => void;
  loadMore: (parentId: number | null, list: 'collections' | 'pages') => Promise<void>;
  /** Read every open branch again. */
  refresh: () => Promise<void>;
  /** A loaded collection row, wherever it is in the tree. */
  findCollection: (collectionId: number) => CollectionItem | undefined;
  /** The top level's order and the workspace ETag a new one is locked on. */
  root: { sortMode: SortMode | null; etag: string | null; name: string | null };
};

/**
 * What a failed read means, in words. A request that never reached the server
 * surfaces as the browser's bare "Failed to fetch", which says nothing.
 */
function failure(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return describeApiError(error, fallback);
  return 'The server could not be reached. Check your connection.';
}

function readExpanded(workspaceId: string): number[] {
  const stored = readJson(treeExpandedKey(workspaceId));
  return Array.isArray(stored) ? stored.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : [];
}

const branchKeyOf = (parentId: number | null) => (parentId === null ? 'root' : String(parentId));

/**
 * The workspace's tree, a branch at a time (08 §4.2).
 *
 * Each open branch is two queries, its collections and its pages, read in
 * its own order and paged by cursor; the top level is always open. It is
 * keyed by the workspace, never by the open page: opening another page does
 * not reset it, the tree reveals that page instead (C-15). Rows carry no
 * grant state; the Library reads that for the rows it shows.
 *
 * After the author's own changes the affected branches read again
 * (invalidation). A change made elsewhere shows through `tree_version`: the
 * sidebar's tree reads the workspace on focus and every minute, and reads its
 * open branches again when the number moved.
 */
export function useWorkspaceTree(options: WorkspaceTreeOptions = {}): WorkspaceTree {
  const { pages: withPages = true, persist = false, watch = false, pageSize = TREE_PAGE_SIZE } = options;
  const queryClient = useQueryClient();
  const shownId = useWorkspaceId();
  const workspaceId = options.workspaceId ?? shownId;

  const [expanded, setExpandedList] = useState<number[]>(() => (persist ? readExpanded(workspaceId) : []));
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  useEffect(() => {
    if (persist) writeJson(treeExpandedKey(workspaceId), expanded);
  }, [expanded, persist, workspaceId]);

  const [moreLoading, setMoreLoading] = useState<ReadonlyMap<string, 'collections' | 'pages'>>(new Map());
  const [moreErrors, setMoreErrors] = useState<ReadonlyMap<string, string>>(new Map());

  const workspace = useQuery({
    ...workspaceQuery(workspaceId),
    ...(watch
      ? { staleTime: 0, refetchOnMount: false, refetchOnWindowFocus: true, refetchInterval: TREE_POLL_MS, refetchIntervalInBackground: false }
      : {}),
  });
  const rootSortMode = workspace.data?.root_sort_mode ?? null;

  // The top level, and every open collection.
  const open = useMemo<(number | null)[]>(() => [null, ...expanded], [expanded]);

  const collectionResults = useQueries({
    queries: open.map((parentId) => collectionBranchQuery(queryClient, workspaceId, parentId, pageSize)),
  });

  // A collection's order is on its row in its parent's branch; a collection
  // whose row is not loaded (revealed from a link, past "Show more") reads
  // its detail instead.
  const knownRows = useMemo(() => {
    const rows = new Map<number, CollectionItem>();
    for (const result of collectionResults) {
      for (const row of collectionsOf((result.data as CollectionBranchData | undefined)?.pages)) rows.set(row.id, row);
    }
    return rows;
  }, [collectionResults]);
  const unknownModes = useMemo(
    () => (withPages ? expanded.filter((id) => !knownRows.has(id)) : []),
    [expanded, knownRows, withPages],
  );
  const details = useQueries({ queries: unknownModes.map((id) => collectionDetailQuery(workspaceId, id)) });
  const modeOf = useCallback((parentId: number | null): SortMode | null => {
    if (parentId === null) return rootSortMode;
    const row = knownRows.get(parentId);
    if (row) return row.sort_mode;
    const index = unknownModes.indexOf(parentId);
    return index >= 0 ? (details[index]?.data?.sort_mode ?? null) : null;
  }, [details, knownRows, rootSortMode, unknownModes]);

  const modes = open.map(modeOf);
  const pageResults = useQueries({
    queries: open.map((parentId, index) => ({
      ...pageBranchQuery(queryClient, workspaceId, parentId, modes[index] ?? 'name', pageSize),
      enabled: withPages && modes[index] !== null,
    })),
  });

  const branches = useMemo(() => {
    const map = new Map<string, TreeBranch>();
    open.forEach((parentId, index) => {
      const key = branchKeyOf(parentId);
      const collections = collectionResults[index];
      const pageList = pageResults[index];
      const collectionData = collections?.data as CollectionBranchData | undefined;
      const pageData = pageList?.data as PageBranchData | undefined;
      const pagesLoaded = !withPages || pageData !== undefined;
      const error = collections?.isError
        ? failure(collections.error, 'Could not load collections')
        : withPages && pageList?.isError
          ? failure(pageList.error, 'Could not load pages')
          : (moreErrors.get(key) ?? null);
      map.set(key, {
        parentId,
        collections: collectionsOf(collectionData?.pages),
        pages: withPages ? pagesOf(pageData) : [],
        sortMode: modes[index] ?? null,
        loaded: collectionData !== undefined && pagesLoaded,
        loading: Boolean(collections?.isFetching) || (withPages && Boolean(pageList?.isFetching)),
        moreCollections: (collectionData?.pages.at(-1)?.next_cursor ?? null) !== null,
        morePages: withPages && (pageData?.pages.at(-1)?.nextCursor ?? null) !== null,
        loadingMore: moreLoading.get(key) ?? null,
        error,
      });
    });
    return map;
  }, [collectionResults, modes, moreErrors, moreLoading, open, pageResults, withPages]);

  const setExpanded = useCallback((collectionId: number, value: boolean) => {
    setExpandedList((previous) => {
      const without = previous.filter((id) => id !== collectionId);
      return value ? [...without, collectionId].slice(-MAX_REMEMBERED) : without;
    });
  }, []);

  const expandPath = useCallback((collectionIds: readonly number[]) => {
    if (collectionIds.length === 0) return;
    setExpandedList((previous) => {
      if (collectionIds.every((id) => previous.includes(id))) return previous;
      const without = previous.filter((id) => !collectionIds.includes(id));
      return [...without, ...collectionIds].slice(-MAX_REMEMBERED);
    });
  }, []);

  const loadMore = useCallback(async (parentId: number | null, list: 'collections' | 'pages') => {
    const key = branchKeyOf(parentId);
    setMoreLoading((previous) => new Map(previous).set(key, list));
    setMoreErrors((previous) => {
      const next = new Map(previous);
      next.delete(key);
      return next;
    });
    try {
      if (list === 'collections') {
        await loadMoreCollections(queryClient, workspaceId, parentId, pageSize);
      } else {
        const mode = modeOf(parentId);
        if (mode) await loadMorePages(queryClient, workspaceId, parentId, mode, pageSize);
      }
    } catch (error) {
      setMoreErrors((previous) => new Map(previous).set(key, failure(error, 'Could not load more')));
    } finally {
      setMoreLoading((previous) => {
        const next = new Map(previous);
        next.delete(key);
        return next;
      });
    }
  }, [modeOf, pageSize, queryClient, workspaceId]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...collectionKeys.all(workspaceId), 'branch'] }),
      queryClient.invalidateQueries({ queryKey: documentKeys.branches(workspaceId) }),
    ]);
  }, [queryClient, workspaceId]);

  // Moved elsewhere: another tab or device changed the tree.
  const treeVersion = watch ? workspace.data?.tree_version : undefined;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (treeVersion === undefined) return;
    if (!treeMovedElsewhere(workspaceId, treeVersion)) return;
    void refreshRef.current();
    // Where the open page lives, and every path the breadcrumb or a hint shows.
    void queryClient.invalidateQueries({ queryKey: documentKeys.placements(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: collectionKeys.details(workspaceId) });
  }, [queryClient, treeVersion, workspaceId]);

  const findCollection = useCallback((collectionId: number) => knownRows.get(collectionId), [knownRows]);

  return {
    branch: (parentId) => branches.get(branchKeyOf(parentId)),
    expandedIds: expandedSet,
    isExpanded: (collectionId) => expandedSet.has(collectionId),
    setExpanded,
    expandPath,
    loadMore,
    refresh,
    findCollection,
    root: { sortMode: rootSortMode, etag: workspace.data?.etag ?? null, name: workspace.data?.name ?? null },
  };
}
