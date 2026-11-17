import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_DOCUMENT_TITLE, focusPageTitle, useDocumentActions, useDocumentSession } from '@/editor';
import type { Doc } from '@/editor/types';
import { useToast } from '@/components/ui/toastContext';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useWorkspaceAccess } from '@/components/workspace/workspaceAccess';
import { documentKeys, type PagePlacement } from '@/data/documents';

/** Creations whose outcome is already being reported to the author. */
const reported = new WeakSet<Promise<string>>();

/** Where a new page goes: a collection, or (`null`) the top level. */
export type NewPageWhere = { collectionId: number | null };

/**
 * The one "New page" action, used by every control that creates a page.
 *
 * Without a place it creates the page "here", in the open page's collection
 * (08 §6.1): the sidebar's "New page", Mod+Alt+N and the palette. A
 * collection's "+" passes that collection, the "Pages" section's "+" the top
 * level. A brand-new workspace starts at the top level.
 *
 * The editor keeps one creation in flight: a second call while one runs gets
 * the same promise, so rapid clicks on two controls make one page. Pending
 * edits of the open page are saved before the new one is created. A viewer
 * creates no pages (D6): `allowed` is false, and every control hides itself.
 */
export function useNewPage() {
  const { createAndSwitch } = useDocumentActions();
  const { creatingDocument, loadingDocumentId, documentId } = useDocumentSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEdit } = useWorkspaceAccess();

  /** The open page's collection, as the editor's read and any later move left it. */
  const here = useCallback((): number | null => {
    if (!documentId) return null;
    return queryClient.getQueryData<PagePlacement>(documentKeys.placement(workspaceId, documentId))?.collectionId ?? null;
  }, [documentId, queryClient, workspaceId]);

  const newPage = useCallback(
    (doc?: Doc, where?: NewPageWhere): Promise<string | null> => {
      if (!canEdit) return Promise.resolve(null);
      const collectionId = where ? where.collectionId : here();
      const creation = createAndSwitch(doc ?? { name: DEFAULT_DOCUMENT_TITLE, blocks: [] }, { collectionId });
      if (reported.has(creation)) return creation.catch(() => null);
      reported.add(creation);
      return creation.then(
        (id) => {
          // Keyboard-first: the caret waits in the new page's title, which
          // mounts a frame or two after the switch commits.
          focusTitleSoon();
          return id;
        },
        (error: unknown) => {
          toast({
            title: 'Could not create the page',
            description: error instanceof Error ? error.message : undefined,
            variant: 'error',
          });
          return null;
        },
      );
    },
    [canEdit, createAndSwitch, here, toast],
  );

  return {
    newPage,
    creating: creatingDocument,
    /** The account may create pages here: an editor or above. */
    allowed: canEdit,
    /** A switch in flight owns the editor; creating would race it. */
    disabled: !canEdit || creatingDocument || Boolean(loadingDocumentId),
  };
}

function focusTitleSoon(attempts = 10) {
  requestAnimationFrame(() => {
    if (focusPageTitle()) return;
    if (attempts > 1) focusTitleSoon(attempts - 1);
  });
}
