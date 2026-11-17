import { ApiError } from '@/api/errors';
import type { DocumentLocation, WorkspaceList } from '@/data/workspaces';

/**
 * Which workspace to show, and the page to open in it (null: the scope
 * chooses). `link` says how a `?doc=` link was followed:
 *
 * - `elsewhere`: the page is in another workspace than the rest of the
 *   order picks, which is shown with "Opened in ‹workspace›";
 * - `unavailable`: the account cannot open the page (gone, in the Trash, or
 *   in a workspace it is not a member of), which is said plainly instead of
 *   opening it.
 */
export type WorkspaceChoice = {
  workspaceId: string;
  documentId: string | null;
  link: 'elsewhere' | 'unavailable' | null;
};

/**
 * The workspace to show at sign-in and on a cold load
 * (`docs/workspace_collection/08` §3.2), in this order:
 *
 * 1. the page named by `?doc=`: its workspace, found through the locate
 *    route, wins when the author is a member of it;
 * 2. `?ws=`, if the author is a member of it;
 * 3. the server's `last_workspace_id`;
 * 4. this browser's last workspace;
 * 5. the personal workspace.
 *
 * A page the locate route does not find (404) is not opened, unless `?ws=`
 * names a workspace of the author's: there the editor reads it and says what
 * it found (a page in the Trash). A lookup that failed otherwise (the
 * network) keeps the page requested, so opening it reports why.
 */
export async function chooseWorkspace(
  list: WorkspaceList,
  request: { workspaceId: string | null; documentId: string | null },
  storedWorkspaceId: string | null,
  locate: (documentId: string) => Promise<DocumentLocation>,
): Promise<WorkspaceChoice> {
  const member = (id: string | null | undefined): id is string => Boolean(id) && list.items.some((item) => item.id === id);
  const { documentId } = request;

  const fallback = [request.workspaceId, list.last_workspace_id, storedWorkspaceId].find(member)
    ?? list.items.find((item) => item.kind === 'personal')?.id
    ?? list.items[0]?.id;
  if (!fallback) throw new Error('This account has no workspace.');

  if (!documentId) return { workspaceId: fallback, documentId: null, link: null };
  try {
    const location = await locate(documentId);
    if (member(location.workspace_id)) {
      return { workspaceId: location.workspace_id, documentId, link: location.workspace_id === fallback ? null : 'elsewhere' };
    }
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) return { workspaceId: fallback, documentId, link: null };
    if (member(request.workspaceId)) return { workspaceId: request.workspaceId, documentId, link: null };
  }
  return { workspaceId: fallback, documentId: null, link: 'unavailable' };
}
