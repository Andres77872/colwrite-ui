import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDocumentActions, useDocumentSession } from '@/editor';
import { useToast } from '@/components/ui/toastContext';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { displayTitle } from '@/components/layout/displayTitle';
import { revealInTree } from '@/components/layout/Sidebar/PagesTree/treeReveal';
import { describeApiError, problemCode } from '@/api/errors';
import {
  documentKeys,
  listDocuments,
  pagesOf,
  restoreDocument,
  setPagePlacement,
  trashDocument,
  type PageBranchData,
  type PagePlacement,
  type TrashedPage,
} from '@/data/documents';
import {
  freshCollectionEtag,
  previewCollectionTrash,
  restoreCollection as apiRestoreCollection,
  restoreResource,
  trashCollection as apiTrashCollection,
  useTrashResource,
  type CollectionRef,
  type CollectionTrashPreview,
  type ResourceItem,
} from '@/data/resources';
import { invalidateAfterTrash, type TrashItem } from '@/data/trash';
import { noteOwnTreeChange } from '@/data/workspaces';
import { followJob } from './trashJobs';
import { pageBranches, removeCollectionFromTree, removePageFromTree } from './treeCache';

/** A page as trashing it needs it: which, its name for the toast, and where it lives when that is known. */
export type PageToTrash = { id: string; name: string | null | undefined; collectionId?: number | null };
/** A collection as trashing it needs it: the trash is locked on its ETag. */
export type CollectionToTrash = Pick<CollectionRef, 'id' | 'name' | 'etag'>;
/** A PDF as trashing it needs it. */
export type PdfToTrash = Pick<ResourceItem, 'id' | 'filename' | 'title'>;
/** Something in the Trash, as restoring it needs it. */
export type TrashedItem = Pick<TrashItem, 'kind' | 'id' | 'name'> & { originalPath?: TrashItem['original_path'] };

/** How long the undo toast stays (08 §6.4). */
const UNDO_MS = 8000;

/** Why a restore was refused, said for the author. */
export function restoreRefusal(error: unknown): string {
  switch (problemCode(error)) {
    case 'workspace_role_required':
      return 'Only the person who moved it to the Trash, or an admin, can restore it.';
    case 'document_in_trash':
      return 'It went to the Trash with its collection. Restore the collection instead.';
    case 'not_in_trash':
      return 'It is not in the Trash any more.';
    default:
      return describeApiError(error, 'The server refused it.');
  }
}

/** The name a PDF goes by in the toasts. */
const pdfName = (pdf: PdfToTrash) => pdf.title || pdf.filename;

/**
 * The one way pages, collections and PDFs go to the Trash and come back:
 * from the sidebar tree, the page menu, the Library and the Trash dialog.
 *
 * Nothing is deleted. A page and a PDF go at once; a collection goes once
 * the author has seen what it takes with it (`previewCollection`). Each says
 * "Moved ‹name› to Trash" in a toast, a polite live region, whose Undo
 * restores it. Work the server finishes later (a collection's pages) is
 * followed as a job, and everything it changed reads again when it is done.
 *
 * Trashing the open page saves it first, then opens the next page in its
 * collection, or the most recent page; Undo brings it back and opens it.
 */
export function useTrash() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceId();
  const { toast } = useToast();
  const { documentId } = useDocumentSession();
  const { flushPendingSave, switchTo, newLocal, markPageTrashed, markPageRestored } = useDocumentActions();
  const trashResource = useTrashResource(workspaceId);
  const [trashing, setTrashing] = useState(false);

  const refresh = useCallback(() => invalidateAfterTrash(queryClient, workspaceId), [queryClient, workspaceId]);

  /** Where a page lives, as this client last read it. */
  const homeOf = useCallback((page: PageToTrash): number | null => {
    if (page.collectionId !== undefined) return page.collectionId;
    return queryClient.getQueryData<PagePlacement>(documentKeys.placement(workspaceId, page.id))?.collectionId ?? null;
  }, [queryClient, workspaceId]);

  /** The page beside this one in the tree's order: the one after it, else the one before. */
  const siblingOf = useCallback((pageId: string, home: number | null): string | null => {
    const branch = pageBranches(queryClient, workspaceId).find((item) => item.home === home);
    const rows = branch ? pagesOf(queryClient.getQueryData<PageBranchData>(branch.key)) : [];
    const index = rows.findIndex((row) => row.id === pageId);
    if (index < 0) return null;
    return (rows[index + 1] ?? rows[index - 1])?.id ?? null;
  }, [queryClient, workspaceId]);

  /**
   * Leave the open page that just went to the Trash for the next page in its
   * collection, or the most recent page; never a blank draft, unless nothing
   * is left, when the first-run screen shows.
   */
  const openNext = useCallback(async (pageId: string, home: number | null, sibling: string | null) => {
    let next = sibling;
    if (!next) {
      try {
        const inHome = await listDocuments(workspaceId, { home: home ?? 'root', limit: 2, sortBy: 'updated_at', sortOrder: 'desc' });
        next = inHome.documents.find((row) => row.id !== pageId)?.id ?? null;
        if (!next) {
          const recent = await listDocuments(workspaceId, { limit: 2, sortBy: 'updated_at', sortOrder: 'desc' });
          next = recent.documents.find((row) => row.id !== pageId)?.id ?? null;
        }
      } catch {
        // The page in the Trash stays open and says so, with Restore.
        return;
      }
    }
    if (!next) {
      newLocal();
      return;
    }
    try {
      await switchTo(next);
    } catch {
      // The editor reports the failed load; the page in the Trash stays open and says so.
    }
  }, [newLocal, switchTo, workspaceId]);

  /* ----------------------------------------------------------- restoring */

  /** Bring a page back. Throws what the server refused. */
  const restorePage = useCallback(async (pageId: string): Promise<PagePlacement> => {
    const placement = await restoreDocument(workspaceId, pageId);
    setPagePlacement(queryClient, workspaceId, placement);
    markPageRestored(pageId);
    void refresh();
    return placement;
  }, [markPageRestored, queryClient, refresh, workspaceId]);

  /**
   * Bring a collection back. Its pages come back through a job, followed
   * until it is done. Throws what the server refused.
   */
  const restoreCollection = useCallback(async (collectionId: number, name: string) => {
    const result = await apiRestoreCollection(workspaceId, collectionId);
    noteOwnTreeChange(workspaceId, result.tree_version);
    void refresh();
    if (result.job) {
      followJob(workspaceId, result.job, { label: `Restoring ${name}`, unit: 'pages', onSettled: () => void refresh() });
    }
    return result;
  }, [refresh, workspaceId]);

  /** Bring a PDF back, to its place or to Unfiled. Throws what the server refused. */
  const restorePdf = useCallback(async (resourceId: number): Promise<ResourceItem> => {
    const resource = await restoreResource(workspaceId, resourceId);
    void refresh();
    return resource;
  }, [refresh, workspaceId]);

  /**
   * Restore one trash root, from the Trash or the page's "in the Trash" bar,
   * and say where it went. Throws what the server refused, for the caller to
   * show where the author is.
   */
  const restore = useCallback(async (item: TrashedItem): Promise<void> => {
    const wasAway = (item.originalPath?.length ?? 0) > 0;
    if (item.kind === 'document') {
      const placement = await restorePage(item.id);
      revealInTree({ kind: 'page', id: item.id, collectionId: placement.collectionId, focus: false });
      const name = displayTitle(item.name);
      toast({
        title: wasAway && placement.collectionId === null ? `Restored ${name} to the top level` : `Restored ${name}`,
        variant: 'success',
        ...(item.id !== documentId
          ? { action: { label: 'Open', onSelect: () => void switchTo(item.id).catch(() => undefined) } }
          : {}),
      });
      return;
    }
    if (item.kind === 'collection') {
      const result = await restoreCollection(Number(item.id), item.name);
      revealInTree({ kind: 'collection', id: Number(item.id), focus: false });
      toast({ title: result.moved_to_root ? `Restored ${item.name} to the top level` : `Restored ${item.name}`, variant: 'success' });
      return;
    }
    const resource = await restorePdf(Number(item.id));
    toast({
      title: wasAway && resource.location.kind === 'unfiled' ? `Restored ${item.name} to Unfiled` : `Restored ${item.name}`,
      variant: 'success',
    });
  }, [documentId, restoreCollection, restorePage, restorePdf, switchTo, toast]);

  /* ------------------------------------------------------------- pages */

  const trashPage = useCallback(async (page: PageToTrash): Promise<boolean> => {
    const name = displayTitle(page.name);
    const wasOpen = page.id === documentId;
    // Its last edits go with it, so a restore brings them back.
    if (wasOpen) await flushPendingSave();
    const home = homeOf(page);
    const sibling = wasOpen ? siblingOf(page.id, home) : null;
    setTrashing(true);
    let trashed: TrashedPage;
    try {
      trashed = await trashDocument(workspaceId, page.id);
    } catch (error) {
      toast({ title: `Could not move ${name} to Trash`, description: describeApiError(error, 'The server refused it.'), variant: 'error' });
      return false;
    } finally {
      setTrashing(false);
    }
    if (wasOpen) markPageTrashed(page.id, { trashRoot: trashed.trashRoot, purgeAfter: trashed.purgeAfter });
    removePageFromTree(queryClient, workspaceId, page.id);
    void refresh();
    if (wasOpen) await openNext(page.id, home, sibling);
    toast({
      title: `Moved ${name} to Trash`,
      variant: 'success',
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onSelect: () => void (async () => {
          try {
            const placement = await restorePage(page.id);
            revealInTree({ kind: 'page', id: page.id, collectionId: placement.collectionId, focus: !wasOpen });
            if (wasOpen) await switchTo(page.id).catch(() => undefined);
          } catch (error) {
            toast({ title: `Could not restore ${name}`, description: restoreRefusal(error), variant: 'error' });
          }
        })(),
      },
    });
    return true;
  }, [documentId, flushPendingSave, homeOf, markPageTrashed, openNext, queryClient, refresh, restorePage, siblingOf, switchTo, toast, workspaceId]);

  /* -------------------------------------------------------- collections */

  /** What moving a collection to the Trash would take with it. */
  const previewCollection = useCallback(
    (collectionId: number, signal?: AbortSignal) => previewCollectionTrash(workspaceId, collectionId, { signal }),
    [workspaceId],
  );

  /**
   * Move a collection to the Trash with what the author was shown. Throws
   * what the server refused (`preview_changed` when it holds something else
   * now, `stale_collection` when it changed), for the preview to show; on
   * success the toast says so, with Undo.
   */
  const trashCollection = useCallback(async (collection: CollectionToTrash, expected: CollectionTrashPreview): Promise<void> => {
    const result = await apiTrashCollection(workspaceId, collection.id, freshCollectionEtag(queryClient, workspaceId, collection), expected);
    noteOwnTreeChange(workspaceId, result.tree_version);
    removeCollectionFromTree(queryClient, workspaceId, collection.id);
    void refresh();
    if (result.job) {
      followJob(workspaceId, result.job, { label: `Moving ${collection.name} to Trash`, unit: 'pages', onSettled: () => void refresh() });
    }
    toast({
      title: `Moved ${collection.name} to Trash`,
      variant: 'success',
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onSelect: () => void restoreCollection(collection.id, collection.name).then(
          () => revealInTree({ kind: 'collection', id: collection.id, focus: true }),
          (error: unknown) => toast({ title: `Could not restore ${collection.name}`, description: restoreRefusal(error), variant: 'error' }),
        ),
      },
    });
  }, [queryClient, refresh, restoreCollection, toast, workspaceId]);

  /* --------------------------------------------------------------- PDFs */

  const trashPdf = useCallback(async (pdf: PdfToTrash): Promise<boolean> => {
    const name = pdfName(pdf);
    try {
      await trashResource.mutateAsync(pdf.id);
    } catch (error) {
      toast({ title: `Could not move ${name} to Trash`, description: describeApiError(error, 'The server refused it.'), variant: 'error' });
      return false;
    }
    void refresh();
    toast({
      title: `Moved ${name} to Trash`,
      variant: 'success',
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onSelect: () => void restorePdf(pdf.id).catch((error: unknown) => {
          toast({ title: `Could not restore ${name}`, description: restoreRefusal(error), variant: 'error' });
        }),
      },
    });
    return true;
  }, [refresh, restorePdf, toast, trashResource]);

  return { trashPage, previewCollection, trashCollection, trashPdf, restore, trashing };
}

export type TrashActions = ReturnType<typeof useTrash>;
