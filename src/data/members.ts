import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type {
  Invitation,
  InvitationAcceptance,
  InvitationCreated,
  OwnershipTransferModel,
  WorkspaceMember,
} from '@/api/schema';
import { invalidateWorkspace, invalidateWorkspaceList, workspaceScope, type WorkspaceDetail, type WorkspaceRole } from './workspaces';

/**
 * Who is in a workspace, and how people join and leave it (M6,
 * `ColWrite-api/docs/workspaces.md#members-invitations-and-ownership`).
 *
 * Members carry no version, so none of these takes `If-Match`; only creating
 * an invitation takes an `Idempotency-Key`. Invitations are links, not
 * emails: the API answers the token once, and the inviter shares the link.
 */

export type Member = WorkspaceMember;
export type PendingInvitation = Invitation;
export type CreatedInvitation = InvitationCreated;
export type Acceptance = InvitationAcceptance;
export type OwnershipTransfer = OwnershipTransferModel;
/** What a role change or an invitation can give: never the owner role, which moves only by a transfer. */
export type AssignableRole = Exclude<WorkspaceRole, 'owner'>;

export const ASSIGNABLE_ROLES: readonly AssignableRole[] = ['admin', 'editor', 'viewer'];

type Transport = { signal?: AbortSignal };

/** Every active member: owners first, then admins, editors and viewers, each by name. */
export async function listMembers(workspaceId: string, init?: Transport): Promise<Member[]> {
  const { items } = await unwrap(api.GET('/workspaces/{workspace_id}/members', {
    params: { path: { workspace_id: workspaceId } },
    signal: init?.signal,
  }));
  return items;
}

/** Give a member admin, editor or viewer; an admin's (an owner's for an owner). */
export async function changeMemberRole(workspaceId: string, userId: string, role: AssignableRole): Promise<Member> {
  return unwrap(api.PATCH('/workspaces/{workspace_id}/members/{user_id}', {
    params: { path: { workspace_id: workspaceId, user_id: userId } },
    body: { role },
  }));
}

/** Remove a member, or, with one's own id, leave. */
export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  await api.DELETE('/workspaces/{workspace_id}/members/{user_id}', {
    params: { path: { workspace_id: workspaceId, user_id: userId } },
  });
}

/** The pending invitations, newest first; an admin's. */
export async function listInvitations(workspaceId: string, init?: Transport): Promise<PendingInvitation[]> {
  const { items } = await unwrap(api.GET('/workspaces/{workspace_id}/invitations', {
    params: { path: { workspace_id: workspaceId } },
    signal: init?.signal,
  }));
  return items;
}

/**
 * An invitation for one address, with a role, for seven days. The answer is
 * the only time its `token` is ever sent: the link is built from it.
 */
export async function createInvitation(
  workspaceId: string,
  input: { email: string; role: AssignableRole },
  idempotencyKey: string,
): Promise<CreatedInvitation> {
  return unwrap(api.POST('/workspaces/{workspace_id}/invitations', {
    params: { path: { workspace_id: workspaceId }, header: { 'Idempotency-Key': idempotencyKey } },
    body: { email: input.email, role: input.role },
  }));
}

/** Revoke a pending invitation: its link stops working. */
export async function revokeInvitation(workspaceId: string, invitationId: string): Promise<void> {
  await api.DELETE('/workspaces/{workspace_id}/invitations/{invitation_id}', {
    params: { path: { workspace_id: workspaceId, invitation_id: invitationId } },
  });
}

/** Join the workspace an invitation's token names, when it was sent to one of the account's verified addresses. */
export async function acceptInvitation(token: string): Promise<Acceptance> {
  return unwrap(api.POST('/invitations/accept', { body: { token } }));
}

/** Ask a member to become the owner; nothing changes until they accept. The owner's. */
export async function requestOwnershipTransfer(workspaceId: string, userId: string): Promise<OwnershipTransfer> {
  return unwrap(api.POST('/workspaces/{workspace_id}/ownership-transfer', {
    params: { path: { workspace_id: workspaceId } },
    body: { user_id: userId },
  }));
}

/** Become the owner, as the member the transfer names; the previous owner becomes an admin. */
export async function acceptOwnershipTransfer(workspaceId: string): Promise<WorkspaceDetail> {
  return unwrap(api.POST('/workspaces/{workspace_id}/ownership-transfer/accept', {
    params: { path: { workspace_id: workspaceId } },
  }));
}

/** Withdraw a transfer (the owner) or decline it (the member it names). */
export async function cancelOwnershipTransfer(workspaceId: string): Promise<void> {
  await api.DELETE('/workspaces/{workspace_id}/ownership-transfer', {
    params: { path: { workspace_id: workspaceId } },
  });
}

/** The invitation link for a token: this app, opened with `?invite=`. */
export function invitationLink(token: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('invite', token);
  return url.toString();
}

export const memberKeys = {
  list: (workspaceId: string) => [...workspaceScope(workspaceId), 'members'] as const,
  invitations: (workspaceId: string) => [...workspaceScope(workspaceId), 'invitations'] as const,
};

export function membersQuery(workspaceId: string) {
  return queryOptions({
    queryKey: memberKeys.list(workspaceId),
    queryFn: ({ signal }) => listMembers(workspaceId, { signal }),
    staleTime: 30_000,
  });
}

export function invitationsQuery(workspaceId: string) {
  return queryOptions({
    queryKey: memberKeys.invitations(workspaceId),
    queryFn: ({ signal }) => listInvitations(workspaceId, { signal }),
  });
}

/**
 * Membership changed: the members, the invitations, the workspace (its
 * `counts.members`, its pending transfer, the account's own role) and the
 * list (`member_count`, "Shared") read again.
 */
export async function invalidateMembership(queryClient: QueryClient, workspaceId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: memberKeys.list(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: memberKeys.invitations(workspaceId) }),
    invalidateWorkspace(queryClient, workspaceId),
    invalidateWorkspaceList(queryClient),
  ]);
}

/** A member's name as the workspace shows it: the display name, else the username. */
export const memberName = (member: Pick<Member, 'display_name' | 'username'>) => member.display_name?.trim() || member.username;
