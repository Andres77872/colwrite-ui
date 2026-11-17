import { useContext } from 'react';
import { roleAtLeast, type Workspace, type WorkspaceRole } from '@/data/workspaces';
import { WorkspaceContext } from './workspaceContextState';

/**
 * What the account may do in the workspace being shown, from its role there
 * (D6, `ColWrite-api/docs/workspaces.md#roles`):
 *
 * | Role | May |
 * | --- | --- |
 * | viewer | read everything, chat, ask the assistant (no writing tools, no Auto) |
 * | editor | also edit pages, review, create, move, upload, move to the Trash, restore their own |
 * | admin | also restore anyone's, delete forever, settings, policy, export, members |
 * | owner | also transfer ownership and delete the workspace |
 *
 * The role is the workspace read's (`GET /workspaces/{w}`), which the app
 * reads on focus and every minute, so a demotion made elsewhere takes effect
 * on the next read. The server decides in the end: a write it refuses for
 * the role is 403 `workspace_role_required`.
 */
export type WorkspaceAccess = {
  role: WorkspaceRole;
  /** Edit pages, decide on proposals, use Auto; create, move, upload and trash. */
  canEdit: boolean;
  /** Settings, policy, export, members and invitations; restore anyone's trash; delete forever. */
  isAdmin: boolean;
  /** Transfer ownership and delete the workspace. */
  isOwner: boolean;
};

export function accessOf(role: WorkspaceRole): WorkspaceAccess {
  return {
    role,
    canEdit: roleAtLeast(role, 'editor'),
    isAdmin: roleAtLeast(role, 'admin'),
    isOwner: role === 'owner',
  };
}

/**
 * The account's access to the workspace being shown. Outside a workspace
 * (a component rendered on its own) nothing is held back: such a component
 * has no workspace to send a write to.
 */
export function useWorkspaceAccess(): WorkspaceAccess {
  const role = useContext(WorkspaceContext)?.workspace.role ?? 'owner';
  return accessOf(role);
}

/** A role in words, capitalised: "Owner", "Admin", "Editor", "Viewer". */
export const roleLabel = (role: WorkspaceRole): string => role.charAt(0).toUpperCase() + role.slice(1);

/** "an owner", "an admin", "an editor", "a viewer". */
export const roleWithArticle = (role: WorkspaceRole): string => (role === 'viewer' ? 'a viewer' : `an ${role}`);

/** What each role may do, in a sentence, for the role pickers. */
export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: 'Everything an admin can do, and can delete the workspace or make someone else its owner.',
  admin: 'Can edit, manage members and invitations, change settings, export and empty the Trash.',
  editor: 'Can edit pages, review the assistant’s changes, add PDFs and move things to the Trash.',
  viewer: 'Can read everything and ask the assistant, but can’t change anything.',
};

/**
 * Whether the workspace is shared with someone (`GET /workspaces`
 * `member_count`, which counts the account too). A shared workspace nobody
 * else joined yet is not.
 */
export const isSharedWithOthers = (workspace: Pick<Workspace, 'member_count'>): boolean => workspace.member_count > 1;

/**
 * What a workspace's row says besides its name: "Shared" when someone else
 * is in it (`member_count`), and the account's role when it is not the owner.
 * In words, so it is never colour alone.
 */
export function workspaceBadge(workspace: Pick<Workspace, 'member_count' | 'role'>): string | null {
  const parts = [
    isSharedWithOthers(workspace) ? 'Shared' : null,
    workspace.role !== 'owner' ? roleLabel(workspace.role) : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}
