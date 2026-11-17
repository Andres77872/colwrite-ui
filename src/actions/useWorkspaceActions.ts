import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { problemBody, problemCode } from '@/api/errors';
import { useToast } from '@/components/ui/toastContext';
import { useWorkspace } from '@/components/workspace/workspaceContextState';
import { flushPendingSaves } from '@/lib/pendingSaves';
import {
  OWNED_WORKSPACE_LIMIT,
  createWorkspace,
  deleteWorkspace,
  invalidateWorkspaceList,
  restoreWorkspace,
  setWorkspaceDetail,
  workspaceKeys,
  type WorkspaceList,
} from '@/data/workspaces';
import {
  acceptOwnershipTransfer,
  cancelOwnershipTransfer,
  invalidateMembership,
  removeMember,
} from '@/data/members';

/** What a refused workspace write means for the author, by the API's problem codes. */
export function workspaceProblem(error: unknown, fallback: string): string {
  switch (problemCode(error)) {
    case 'workspace_limit': {
      const limit = problemBody(error)?.limit ?? OWNED_WORKSPACE_LIMIT;
      return limit <= 1
        ? 'This server offers one workspace per account.'
        : `You own ${limit} workspaces, the most one account can have. Delete one you no longer use, in Settings → Workspace, to make room.`;
    }
    case 'personal_workspace_locked':
      return 'Your personal workspace is only yours: it can’t be shared, given away or deleted on its own.';
    case 'confirmation_mismatch':
      return 'The name you typed is not the workspace’s name. Type it exactly, with the same capitals and accents.';
    case 'stale_workspace':
      return 'This workspace was changed elsewhere. Check it and try again.';
    case 'workspace_role_required':
      return problemBody(error)?.required_role === 'owner'
        ? 'Only the workspace’s owner can do this.'
        : 'Only the workspace’s admins can do this.';
    case 'workspace_not_found':
      return 'This workspace isn’t available. It may have been deleted, or you may not have access.';
    case 'workspace_not_deleted':
      return 'This workspace is not deleted.';
    case 'member_not_found':
      return 'This person is no longer a member of the workspace.';
    case 'last_owner':
      return 'The workspace needs an owner. Make someone else the owner first, from their row in Members, then try again.';
    case 'invitation_not_found':
      return 'This invitation is no longer pending: it was revoked, used, or replaced by a newer one.';
    case 'invitation_not_pending':
      return 'This invitation was already accepted.';
    case 'invitation_expired':
      return 'This invitation has expired. Invite the address again for a new link.';
    case 'transfer_not_found':
      return 'There is no ownership transfer waiting any more: it was withdrawn, declined or it expired.';
    case 'unchanged':
      return 'Nothing to change: it is already that way.';
    default:
      return error instanceof Error && error.message ? error.message : fallback;
  }
}

/**
 * Creating, deleting and restoring workspaces (M5.UI-1, M5.UI-3), the same
 * from the switcher, the palette and Settings.
 *
 * - **Create** makes the workspace, reads the list again so it is there, and
 *   switches to it: an empty workspace opens on "Start your first page".
 * - **Delete** saves the open page first, deletes the workspace (its owner,
 *   its name typed), switches to the next workspace and reads the list again;
 *   the toast's Undo restores it. It stays restorable for 30 days, from
 *   Settings → Workspace.
 * - **Restore** brings a deleted workspace back and lists it again.
 * - **Leave** (M6) saves the open page first, takes the account out of the
 *   workspace being shown, switches to the personal workspace and says so.
 * - **Accept** or **decline ownership** (M6) answers a transfer that names
 *   the account; accepting makes it the owner here at once.
 */
export function useWorkspaceActions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { workspace, workspaces, switchWorkspace } = useWorkspace();

  const refreshList = useCallback(async () => {
    await invalidateWorkspaceList(queryClient);
    return queryClient.getQueryData<WorkspaceList>(workspaceKeys.list());
  }, [queryClient]);

  const create = useCallback(async (input: { name: string; icon: string | null }, idempotencyKey: string) => {
    const created = await createWorkspace(input, idempotencyKey);
    await refreshList();
    await switchWorkspace(created.id);
    return created;
  }, [refreshList, switchWorkspace]);

  const restore = useCallback(async (workspaceId: string, options: { open?: boolean } = {}) => {
    const restored = await restoreWorkspace(workspaceId);
    await refreshList();
    if (options.open) await switchWorkspace(restored.id);
    toast({
      title: `Restored ${restored.name}`,
      variant: 'success',
      action: options.open ? undefined : { label: 'Open', onSelect: () => void switchWorkspace(restored.id) },
    });
    return restored;
  }, [refreshList, switchWorkspace, toast]);

  /**
   * Delete the workspace being shown; `etag` is its detail's, `confirmName`
   * what the author typed. `beforeLeaving` runs once it is deleted, before
   * the next workspace opens (Settings closes there).
   */
  const deleteShown = useCallback(async (etag: string, confirmName: string, beforeLeaving?: () => void) => {
    const deleted = workspace;
    // Its edits reach the server while it is still there.
    await flushPendingSaves();
    const result = await deleteWorkspace(deleted.id, etag, confirmName);
    const next = workspaces.find((item) => item.kind === 'personal' && item.id !== deleted.id)
      ?? workspaces.find((item) => item.id !== deleted.id);
    beforeLeaving?.();
    if (next) await switchWorkspace(next.id);
    await refreshList();
    toast({
      title: `Deleted ${result.name}`,
      description: 'You can restore it from Settings → Workspace for 30 days.',
      action: {
        label: 'Undo',
        onSelect: () => {
          void restore(result.id, { open: true }).catch((error: unknown) =>
            toast({ title: `Could not restore ${result.name}`, description: workspaceProblem(error, 'Try again from Settings → Workspace.'), variant: 'error' }));
        },
      },
    });
    return result;
  }, [refreshList, restore, switchWorkspace, toast, workspace, workspaces]);

  /**
   * Leave the workspace being shown, as `userId` (the account's own id).
   * `beforeLeaving` runs once it is done, before the next workspace opens.
   */
  const leaveShown = useCallback(async (userId: string, beforeLeaving?: () => void) => {
    const left = workspace;
    await flushPendingSaves();
    await removeMember(left.id, userId);
    const next = workspaces.find((item) => item.kind === 'personal' && item.id !== left.id)
      ?? workspaces.find((item) => item.id !== left.id);
    beforeLeaving?.();
    if (next) await switchWorkspace(next.id);
    await refreshList();
    toast({ title: `You left ${left.name}`, description: 'To come back, someone there has to invite you again.' });
  }, [refreshList, switchWorkspace, toast, workspace, workspaces]);

  /** Become the owner of the workspace being shown, as the member a transfer names. */
  const acceptOwnership = useCallback(async () => {
    const detail = await acceptOwnershipTransfer(workspace.id);
    setWorkspaceDetail(queryClient, detail);
    await invalidateMembership(queryClient, workspace.id);
    toast({ title: `You’re now the owner of ${detail.name}`, variant: 'success' });
  }, [queryClient, toast, workspace.id]);

  /** Decline a transfer that names the account, or withdraw one the account asked for. */
  const cancelOwnership = useCallback(async () => {
    await cancelOwnershipTransfer(workspace.id);
    await invalidateMembership(queryClient, workspace.id);
  }, [queryClient, workspace.id]);

  return { create, restore, deleteShown, leaveShown, acceptOwnership, cancelOwnership };
}
