import { useCallback } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toastContext';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { displayTitle } from '@/components/layout/displayTitle';
import { revealInTree } from '@/components/layout/Sidebar/PagesTree/treeReveal';
import { describeApiError, problemCode } from '@/api/errors';
import { collectionBranches, editCollections, editPages, pageBranches } from './treeCache';
import {
  documentKeys,
  movePage as apiMovePage,
  pagesOf,
  reorderPage as apiReorderPage,
  setPagePlacement,
  type DocumentSummary,
  type PageBranchData,
  type PagePlacement,
  type PagePosition,
} from '@/data/documents';
import {
  collectionKeys,
  collectionsOf,
  freshCollectionEtag,
  moveCollection as apiMoveCollection,
  reorderCollection as apiReorderCollection,
  resourceKeys,
  useMoveResource,
  type CollectionBranchData,
  type CollectionDetail,
  type CollectionItem,
  type CollectionPosition,
  type ResourceAttachmentTarget,
  type ResourceItem,
} from '@/data/resources';
import { noteOwnTreeChange, workspaceKeys, type SortMode, type WorkspaceDetail } from '@/data/workspaces';

/** A page as a move needs it: where it lives, and the placement ETag the move is locked on. */
export type PageToMove = { id: string; name: string; collectionId: number | null; placementEtag: string };
/** A collection as a move needs it. */
export type CollectionToMove = { id: number; name: string; parentId: number | null; etag: string };
/** Where something goes: a collection, or the top level (`id: null`). */
export type MovePlace = { id: number | null; name: string | null };

/** How long the undo toast stays (08 §6.4). */
const UNDO_MS = 8000;
const TOP_LEVEL = 'the top level';

const placeName = (place: MovePlace) => (place.id === null ? TOP_LEVEL : (place.name ?? 'that collection'));

/* ------------------------------------------------------------- the caches */

type Snapshot = Array<[QueryKey, unknown]>;

function snapshotOf(queryClient: QueryClient, keys: QueryKey[]): Snapshot {
  return keys.map((key) => [key, queryClient.getQueryData(key)]);
}

function restore(queryClient: QueryClient, snapshot: Snapshot) {
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
}

/** Put `item` among `rows` where `position` says, or at the end. */
function insertAt<T>(rows: T[], item: T, position: PagePosition | CollectionPosition | undefined, idOf: (row: T) => string | number): T[] {
  if (position && position !== 'last') {
    const anchor = 'after_id' in position ? position.after_id : position.before_id;
    const index = rows.findIndex((row) => idOf(row) === anchor);
    if (index >= 0) {
      const at = 'after_id' in position ? index + 1 : index;
      return [...rows.slice(0, at), item, ...rows.slice(at)];
    }
  }
  return [...rows, item];
}

/** A home's order as this client last read it: the top level's from the workspace, a collection's from its row. */
function sortModeOf(queryClient: QueryClient, workspaceId: string, home: number | null): SortMode | null {
  if (home === null) return queryClient.getQueryData<WorkspaceDetail>(workspaceKeys.detail(workspaceId))?.root_sort_mode ?? null;
  const detail = queryClient.getQueryData<CollectionDetail>(collectionKeys.detail(workspaceId, home));
  if (detail) return detail.sort_mode;
  for (const { key } of collectionBranches(queryClient, workspaceId)) {
    const row = collectionsOf(queryClient.getQueryData<CollectionBranchData>(key)?.pages).find((item) => item.id === home);
    if (row) return row.sort_mode;
  }
  return null;
}

/**
 * Where to put something back so it lands where it was: after the sibling
 * that was before it, else before the one after it. Only a home in custom
 * order keeps a place; elsewhere the home's order puts it back.
 */
function returnPosition<T, K extends string | number>(
  rows: T[],
  id: K,
  idOf: (row: T) => K,
  custom: boolean,
): 'last' | { after_id: K } | { before_id: K } {
  if (!custom) return 'last';
  const index = rows.findIndex((row) => idOf(row) === id);
  const before = index > 0 ? rows[index - 1] : undefined;
  const after = index >= 0 ? rows[index + 1] : undefined;
  if (before) return { after_id: idOf(before) };
  if (after) return { before_id: idOf(after) };
  return 'last';
}

function pageRowsOf(queryClient: QueryClient, workspaceId: string, home: number | null): DocumentSummary[] {
  const branch = pageBranches(queryClient, workspaceId).find((item) => item.home === home);
  return branch ? pagesOf(queryClient.getQueryData<PageBranchData>(branch.key)) : [];
}

function collectionRowsOf(queryClient: QueryClient, workspaceId: string, parentId: number | null): CollectionItem[] {
  const branch = collectionBranches(queryClient, workspaceId).find((item) => item.parentId === parentId);
  return branch ? collectionsOf(queryClient.getQueryData<CollectionBranchData>(branch.key)?.pages) : [];
}

/** Read the branches a page move touched again, and what depends on where it lives. */
function refreshAfterPageMove(queryClient: QueryClient, workspaceId: string, pageId: string, homes: Array<number | null>) {
  return Promise.all([
    ...pageBranches(queryClient, workspaceId)
      .filter(({ home }) => homes.includes(home))
      .map(({ key }) => queryClient.invalidateQueries({ queryKey: key, exact: true })),
    // The collections' page counts, the page's "setting" grant, what it can read.
    queryClient.invalidateQueries({ queryKey: collectionKeys.details(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: collectionKeys.grants(workspaceId, pageId) }),
    queryClient.invalidateQueries({ queryKey: resourceKeys.lists(workspaceId) }),
  ]);
}

/* -------------------------------------------------------------- the action */

/**
 * The one way pages, collections and PDFs move: from the sidebar tree (its
 * menus, its keys, a drag), from "Move to…", from the page menu and the
 * palette, and from the Library.
 *
 * A move shows at once in the tree (08 §4.4) and is sent with the row's ETag.
 * A 412 means someone else moved it first: the branches read again, the
 * author is told, and the move is not retried. Any other refusal puts the
 * row back. A move that lands says so in a toast, which is a polite live
 * region, with Undo (8 s): the opposite move, locked on the new ETag. Focus
 * goes back to the moved row in the tree.
 *
 * Tree moves are not in the editor's undo journal: Mod+Z undoes text.
 */
export function useMoveTo() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceId();
  const { toast } = useToast();
  const moveResource = useMoveResource(workspaceId);

  const failed = useCallback((subject: 'page' | 'collection', name: string, error: unknown) => {
    const code = problemCode(error);
    if (code === 'stale_placement' || code === 'stale_collection') {
      toast({
        title: subject === 'page'
          ? 'This page was changed elsewhere. Try the move again.'
          : 'This collection was changed elsewhere. Try the move again.',
        variant: 'error',
      });
      return;
    }
    toast({ title: `Could not move ${name}`, description: describeApiError(error, 'The server refused the move.'), variant: 'error' });
  }, [toast]);

  /** Send a page move, show it at once, and put it back if it is refused. */
  const sendPage = useCallback(async (
    page: PageToMove,
    to: { collectionId: number | null; position?: PagePosition },
    send: () => Promise<PagePlacement>,
  ): Promise<PagePlacement | null> => {
    const name = displayTitle(page.name);
    await queryClient.cancelQueries({ queryKey: documentKeys.branches(workspaceId) });
    const snapshot = snapshotOf(queryClient, pageBranches(queryClient, workspaceId).map(({ key }) => key));
    const original = [...pageBranches(queryClient, workspaceId)]
      .map(({ key }) => pagesOf(queryClient.getQueryData<PageBranchData>(key)).find((row) => row.id === page.id))
      .find(Boolean);
    const moved: DocumentSummary = original
      ? { ...original, collectionId: to.collectionId }
      : { id: page.id, name: page.name, tags: [], createdAt: '', updatedAt: '', collectionId: to.collectionId, sortKey: '', placementEtag: page.placementEtag };
    editPages(queryClient, workspaceId, (home, rows) => {
      const without = rows.some((row) => row.id === page.id) ? rows.filter((row) => row.id !== page.id) : rows;
      return home === to.collectionId ? insertAt(without, moved, to.position, (row) => row.id) : without;
    });
    try {
      const placement = await send();
      setPagePlacement(queryClient, workspaceId, placement);
      noteOwnTreeChange(workspaceId, placement.treeVersion);
      editPages(queryClient, workspaceId, (_, rows) => (rows.some((row) => row.id === page.id)
        ? rows.map((row) => (row.id === page.id ? { ...row, collectionId: placement.collectionId, sortKey: placement.sortKey, placementEtag: placement.placementEtag } : row))
        : rows));
      void refreshAfterPageMove(queryClient, workspaceId, page.id, [page.collectionId, placement.collectionId]);
      return placement;
    } catch (error) {
      restore(queryClient, snapshot);
      const code = problemCode(error);
      if (code === 'stale_placement') {
        // Someone moved it first: show where it is now, and say so.
        void refreshAfterPageMove(queryClient, workspaceId, page.id, [page.collectionId, to.collectionId]);
        void queryClient.invalidateQueries({ queryKey: documentKeys.placement(workspaceId, page.id) });
      }
      failed('page', name, error);
      return null;
    }
  }, [failed, queryClient, workspaceId]);

  const movePage = useCallback(async (page: PageToMove, to: MovePlace & { position?: PagePosition }): Promise<boolean> => {
    const from: MovePlace = { id: page.collectionId, name: null };
    const fromRows = pageRowsOf(queryClient, workspaceId, page.collectionId);
    const back = returnPosition(fromRows, page.id, (row) => row.id, sortModeOf(queryClient, workspaceId, page.collectionId) === 'custom');
    const placement = await sendPage(page, { collectionId: to.id, position: to.position }, () =>
      apiMovePage(workspaceId, page.id, page.placementEtag, { collectionId: to.id, position: to.position }));
    if (!placement) return false;
    const name = displayTitle(page.name);
    revealInTree({ kind: 'page', id: page.id, collectionId: placement.collectionId, focus: true });
    toast({
      title: `Moved ${name} to ${placeName(to)}`,
      variant: 'success',
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onSelect: () => {
          const now: PageToMove = { ...page, collectionId: placement.collectionId, placementEtag: placement.placementEtag };
          const undo = (position: PagePosition) => sendPage(now, { collectionId: from.id, position }, () =>
            apiMovePage(workspaceId, page.id, placement.placementEtag, { collectionId: from.id, position }));
          void (async () => {
            // The neighbour it went back beside may have moved meanwhile.
            let result = await undo(back);
            if (!result && back !== 'last') result = await undo('last');
            if (result) revealInTree({ kind: 'page', id: page.id, collectionId: from.id, focus: true });
          })();
        },
      },
    });
    return true;
  }, [queryClient, sendPage, toast, workspaceId]);

  /** Move a page up or down among its siblings, in a home in custom order. */
  const reorderPage = useCallback(async (page: PageToMove, position: PagePosition): Promise<boolean> => {
    const rows = pageRowsOf(queryClient, workspaceId, page.collectionId);
    const back = returnPosition(rows, page.id, (row) => row.id, true);
    const placement = await sendPage(page, { collectionId: page.collectionId, position }, () =>
      apiReorderPage(workspaceId, page.id, page.placementEtag, position));
    if (!placement) return false;
    const name = displayTitle(page.name);
    revealInTree({ kind: 'page', id: page.id, collectionId: page.collectionId, focus: true });
    toast({
      title: `Moved ${name}`,
      variant: 'success',
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onSelect: () => {
          const now: PageToMove = { ...page, placementEtag: placement.placementEtag };
          void sendPage(now, { collectionId: page.collectionId, position: back }, () =>
            apiReorderPage(workspaceId, page.id, placement.placementEtag, back));
        },
      },
    });
    return true;
  }, [queryClient, sendPage, toast, workspaceId]);

  /** Send a collection move, show it at once, and put it back if it is refused. */
  const sendCollection = useCallback(async (
    collection: CollectionToMove,
    to: { parentId: number | null; position?: CollectionPosition },
    send: (etag: string) => Promise<CollectionDetail>,
  ): Promise<CollectionDetail | null> => {
    await queryClient.cancelQueries({ queryKey: collectionKeys.all(workspaceId) });
    const snapshot = snapshotOf(queryClient, collectionBranches(queryClient, workspaceId).map(({ key }) => key));
    const original = collectionBranches(queryClient, workspaceId)
      .map(({ key }) => collectionsOf(queryClient.getQueryData<CollectionBranchData>(key)?.pages).find((row) => row.id === collection.id))
      .find(Boolean);
    editCollections(queryClient, workspaceId, (parentId, rows) => {
      const without = rows.some((row) => row.id === collection.id) ? rows.filter((row) => row.id !== collection.id) : rows;
      if (parentId !== to.parentId || !original) return without;
      return insertAt(without, { ...original, parent_id: to.parentId }, to.position, (row) => row.id);
    });
    try {
      const detail = await send(freshCollectionEtag(queryClient, workspaceId, collection));
      noteOwnTreeChange(workspaceId, detail.tree_version);
      queryClient.setQueryData(collectionKeys.detail(workspaceId, detail.id), detail);
      return detail;
    } catch (error) {
      restore(queryClient, snapshot);
      failed('collection', collection.name, error);
      return null;
    } finally {
      // Every list that shows collections, and every path below the one that moved.
      void queryClient.invalidateQueries({ queryKey: collectionKeys.all(workspaceId) });
    }
  }, [failed, queryClient, workspaceId]);

  const moveCollection = useCallback(async (collection: CollectionToMove, to: MovePlace & { position?: CollectionPosition }): Promise<boolean> => {
    const from: MovePlace = { id: collection.parentId, name: null };
    const back = returnPosition(
      collectionRowsOf(queryClient, workspaceId, collection.parentId),
      collection.id,
      (row) => row.id,
      sortModeOf(queryClient, workspaceId, collection.parentId) === 'custom',
    );
    const detail = await sendCollection(collection, { parentId: to.id, position: to.position }, (etag) =>
      apiMoveCollection(workspaceId, collection.id, etag, { parentId: to.id, position: to.position }));
    if (!detail) return false;
    revealInTree({ kind: 'collection', id: collection.id, focus: true });
    toast({
      title: `Moved ${collection.name} to ${placeName(to)}`,
      variant: 'success',
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onSelect: () => {
          const now: CollectionToMove = { ...collection, parentId: to.id, etag: detail.etag };
          const undo = (position: CollectionPosition) => sendCollection(now, { parentId: from.id, position }, (etag) =>
            apiMoveCollection(workspaceId, collection.id, etag, { parentId: from.id, position }));
          void (async () => {
            let result = await undo(back);
            if (!result && back !== 'last') result = await undo('last');
            if (result) revealInTree({ kind: 'collection', id: collection.id, focus: true });
          })();
        },
      },
    });
    return true;
  }, [queryClient, sendCollection, toast, workspaceId]);

  const reorderCollection = useCallback(async (collection: CollectionToMove, position: CollectionPosition): Promise<boolean> => {
    const back = returnPosition(collectionRowsOf(queryClient, workspaceId, collection.parentId), collection.id, (row) => row.id, true);
    const detail = await sendCollection(collection, { parentId: collection.parentId, position }, (etag) =>
      apiReorderCollection(workspaceId, collection.id, etag, position));
    if (!detail) return false;
    revealInTree({ kind: 'collection', id: collection.id, focus: true });
    toast({
      title: `Moved ${collection.name}`,
      variant: 'success',
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onSelect: () => {
          const now: CollectionToMove = { ...collection, etag: detail.etag };
          void sendCollection(now, { parentId: collection.parentId, position: back }, (etag) =>
            apiReorderCollection(workspaceId, collection.id, etag, back));
        },
      },
    });
    return true;
  }, [queryClient, sendCollection, toast, workspaceId]);

  /** Move a PDF to a collection, a page or Unfiled, with the same toast and Undo. */
  const movePdf = useCallback(async (resource: ResourceItem, to: ResourceAttachmentTarget & { name: string }): Promise<boolean> => {
    const name = resource.title || resource.filename;
    const from: ResourceAttachmentTarget = resource.location.kind === 'document'
      ? { documentId: resource.location.document_id }
      : resource.location.kind === 'collection'
        ? { collectionId: resource.location.collection_id }
        : {};
    try {
      await moveResource.mutateAsync({ resourceId: resource.id, target: to });
    } catch (error) {
      toast({ title: `Could not move ${name}`, description: describeApiError(error, 'The server refused the move.'), variant: 'error' });
      return false;
    }
    toast({
      title: `Moved ${name} to ${to.name}`,
      variant: 'success',
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onSelect: () => void moveResource.mutateAsync({ resourceId: resource.id, target: from }).catch((error: unknown) => {
          toast({ title: `Could not move ${name} back`, description: describeApiError(error, 'The server refused the move.'), variant: 'error' });
        }),
      },
    });
    return true;
  }, [moveResource, toast]);

  return { movePage, reorderPage, moveCollection, reorderCollection, movePdf };
}

export type MoveActions = ReturnType<typeof useMoveTo>;
