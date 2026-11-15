import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';
import { useDocumentActions, useDocumentId } from '@/editor';
import { useToast } from '@/components/ui/toastContext';
import { useWorkspace } from '@/components/workspace/workspaceContextState';
import { pageLocationQuery, type DocumentLocation, type Workspace } from '@/data/workspaces';

/**
 * A link to a page, followed from inside a workspace (M5.UI-2, D11): a chat
 * `#doc/…` reference, or a page link pasted into a page. The page is located
 * first (`GET /documents/{id}/location`), so a link never shows another
 * workspace's page under this one's chrome:
 *
 * - **here**: the page is in this workspace and opens in place;
 * - **elsewhere**: it is in another of the author's workspaces, which is
 *   said ("This page is in another workspace") and Open switches there,
 *   saying "Opened in ‹workspace›";
 * - **unavailable**: gone, in the Trash, or in a workspace the author is not
 *   in. The three answer alike, so nothing is learned about a workspace the
 *   author cannot see.
 */
export type PageLinkTarget =
  | { kind: 'loading' }
  | { kind: 'here'; open: boolean }
  | { kind: 'elsewhere'; workspace: Workspace }
  | { kind: 'unavailable' }
  /** The lookup itself failed (the network): nothing is known yet. */
  | { kind: 'failed' };

/** What the app says about a link it cannot open (14 §4). */
export const PAGE_UNAVAILABLE = {
  title: 'This page isn’t available',
  description: 'It may have been deleted, or you may not have access.',
} as const;

/** What a location answer means from the workspace being shown. */
export function linkTargetOf(
  location: DocumentLocation | undefined,
  error: unknown,
  current: Workspace,
  workspaces: readonly Workspace[],
  openId: string | null,
  documentId: string,
): PageLinkTarget {
  if (error) return error instanceof ApiError && error.status === 404 ? { kind: 'unavailable' } : { kind: 'failed' };
  if (!location) return { kind: 'loading' };
  if (location.workspace_id === current.id) return { kind: 'here', open: openId === documentId };
  const workspace = workspaces.find((item) => item.id === location.workspace_id);
  return workspace ? { kind: 'elsewhere', workspace } : { kind: 'unavailable' };
}

/** Where a linked page is, read when `enabled` (a chip's popover opening, a link's card showing). */
export function usePageLinkTarget(documentId: string, enabled = true): PageLinkTarget {
  const { workspace, workspaces } = useWorkspace();
  const openId = useDocumentId();
  const location = useQuery({ ...pageLocationQuery(workspace.id, documentId), enabled });
  if (!enabled) return { kind: 'loading' };
  return linkTargetOf(location.data, location.error, workspace, workspaces, openId, documentId);
}

/**
 * Open a linked page where it lives: in place, or in its own workspace after
 * the open page is saved (the switch does that). A link that cannot be
 * opened says so in a toast; nothing else changes.
 */
export function useOpenPageLink() {
  const queryClient = useQueryClient();
  const { workspace, workspaces, switchWorkspace } = useWorkspace();
  const { switchTo } = useDocumentActions();
  const openId = useDocumentId();
  const { toast } = useToast();

  return useCallback(async (documentId: string): Promise<void> => {
    let location: DocumentLocation | undefined;
    let error: unknown = null;
    try {
      location = await queryClient.fetchQuery(pageLocationQuery(workspace.id, documentId));
    } catch (caught) {
      error = caught;
    }
    const target = linkTargetOf(location, error, workspace, workspaces, openId, documentId);
    if (target.kind === 'here') {
      if (!target.open) await switchTo(documentId, { source: 'selection' }).catch(() => undefined);
      return;
    }
    if (target.kind === 'elsewhere') {
      await switchWorkspace(target.workspace.id, { documentId, reason: 'link' });
      return;
    }
    if (target.kind === 'failed') {
      toast({ title: 'Could not open the page', description: 'The server could not be reached. Check your connection.', variant: 'error' });
      return;
    }
    toast({ title: PAGE_UNAVAILABLE.title, description: PAGE_UNAVAILABLE.description, variant: 'error' });
  }, [openId, queryClient, switchTo, switchWorkspace, toast, workspace, workspaces]);
}
