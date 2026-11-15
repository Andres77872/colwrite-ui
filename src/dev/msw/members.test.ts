import { describe, expect, it } from 'vitest';
import { problemBody, problemCode } from '@/api/errors';
import { getDocument, saveDocument } from '@/data/documents';
import {
  acceptInvitation,
  acceptOwnershipTransfer,
  cancelOwnershipTransfer,
  changeMemberRole,
  createInvitation,
  listInvitations,
  listMembers,
  removeMember,
  requestOwnershipTransfer,
  revokeInvitation,
} from '@/data/members';
import { getWorkspace, listWorkspaces } from '@/data/workspaces';
import { listTrash } from '@/data/trash';
import {
  INVITED_WORKSPACE_ID,
  INVITE_TOKENS,
  LAB_WORKSPACE_ID,
  OWNED_WORKSPACE_ID,
  PEOPLE,
  PERSONAL_WORKSPACE_ID,
  PREVIEW_USER_ID,
  VIEWER_DOCUMENT_ID,
  VIEWER_WORKSPACE_ID,
  setRoleElsewhere,
} from './fixtures';

/** The problem code a refused call answered, or null when it succeeded. */
async function refusal(call: Promise<unknown>): Promise<string | null> {
  try {
    await call;
    return null;
  } catch (error) {
    return problemCode(error);
  }
}

describe('members (M6)', () => {
  it('lists every member, owners first, to any member', async () => {
    const members = await listMembers(LAB_WORKSPACE_ID);
    expect(members.map((row) => [row.display_name, row.role])).toEqual([
      ['Grace Hopper', 'owner'], ['Alan Turing', 'admin'], ['Ada Author', 'editor'], ['Katherine Johnson', 'viewer'],
    ]);
    expect((await listMembers(VIEWER_WORKSPACE_ID)).find((row) => row.user_id === PREVIEW_USER_ID)?.role).toBe('viewer');
    expect((await getWorkspace(LAB_WORKSPACE_ID)).counts.members).toBe(4);
  });

  it('changes roles as an admin, never the last owner’s', async () => {
    // An editor in the lab workspace: no role changes there.
    const refused = await changeMemberRole(LAB_WORKSPACE_ID, PEOPLE.katherine.user_id, 'editor').catch((error: unknown) => error);
    expect(problemCode(refused)).toBe('workspace_role_required');
    expect(problemBody(refused)?.required_role).toBe('admin');

    // The owner of Side project.
    expect((await changeMemberRole(OWNED_WORKSPACE_ID, PEOPLE.marie.user_id, 'admin')).role).toBe('admin');
    expect(await refusal(changeMemberRole(OWNED_WORKSPACE_ID, PREVIEW_USER_ID, 'editor'))).toBe('last_owner');
    expect(await refusal(changeMemberRole(OWNED_WORKSPACE_ID, 'u-nobody', 'viewer'))).toBe('member_not_found');
  });

  it('removes members, lets anyone leave, and never the last owner', async () => {
    expect(await refusal(removeMember(LAB_WORKSPACE_ID, PEOPLE.katherine.user_id))).toBe('workspace_role_required');
    expect(await refusal(removeMember(OWNED_WORKSPACE_ID, PREVIEW_USER_ID))).toBe('last_owner');
    expect(await refusal(removeMember(PERSONAL_WORKSPACE_ID, PREVIEW_USER_ID))).toBe('last_owner');

    await removeMember(OWNED_WORKSPACE_ID, PEOPLE.marie.user_id);
    expect((await listMembers(OWNED_WORKSPACE_ID)).map((row) => row.user_id)).toEqual([PREVIEW_USER_ID]);

    // Leaving: the workspace is gone from the list and from every route.
    await removeMember(VIEWER_WORKSPACE_ID, PREVIEW_USER_ID);
    expect((await listWorkspaces()).items.some((item) => item.id === VIEWER_WORKSPACE_ID)).toBe(false);
    expect(await refusal(getWorkspace(VIEWER_WORKSPACE_ID))).toBe('workspace_not_found');
  });

  it('loses a removed member at their next request', async () => {
    setRoleElsewhere(LAB_WORKSPACE_ID, null);
    expect(await refusal(getWorkspace(LAB_WORKSPACE_ID))).toBe('workspace_not_found');
    expect(await refusal(listMembers(LAB_WORKSPACE_ID))).toBe('workspace_not_found');
  });
});

describe('the role matrix (D6) in the mock', () => {
  it('refuses a viewer’s writes with the role they need, and lets them read', async () => {
    const { doc, etag } = await getDocument(VIEWER_WORKSPACE_ID, VIEWER_DOCUMENT_ID);
    const refused = await saveDocument(VIEWER_WORKSPACE_ID, VIEWER_DOCUMENT_ID, doc, etag).catch((error: unknown) => error);
    expect(problemCode(refused)).toBe('workspace_role_required');
    expect(problemBody(refused)?.required_role).toBe('editor');
    // The Trash reads, and names who moved each item there.
    const trash = await listTrash(VIEWER_WORKSPACE_ID);
    expect(trash.items.map((item) => item.trashed_by)).toEqual([PEOPLE.marie.user_id]);
  });

  it('applies a demotion at the next write', async () => {
    const { doc, etag } = await getDocument(LAB_WORKSPACE_ID, '66f0c0ffee0000000000d1a1');
    setRoleElsewhere(LAB_WORKSPACE_ID, 'viewer');
    expect(await refusal(saveDocument(LAB_WORKSPACE_ID, '66f0c0ffee0000000000d1a1', doc, etag))).toBe('workspace_role_required');
    expect((await getWorkspace(LAB_WORKSPACE_ID)).role).toBe('viewer');
  });
});

describe('invitations (M6)', () => {
  it('creates a link once, replays it for the same key, and lists it for admins', async () => {
    const created = await createInvitation(OWNED_WORKSPACE_ID, { email: 'Lin@Example.org', role: 'editor' }, 'key-1');
    expect(created.token).toMatch(/^cwinv-/);
    expect(created.email_hint).toBe('l***@example.org');
    expect(Date.parse(created.expire_time) - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    expect((await createInvitation(OWNED_WORKSPACE_ID, { email: 'lin@example.org', role: 'editor' }, 'key-1')).token).toBe(created.token);
    expect(await refusal(createInvitation(OWNED_WORKSPACE_ID, { email: 'lin@example.org', role: 'viewer' }, 'key-1'))).toBe('idempotency_key_reused');

    const pending = await listInvitations(OWNED_WORKSPACE_ID);
    expect(pending.map((row) => row.email_hint)).toEqual(['l***@example.org', 's***@example.org']);
    expect(pending[0]).not.toHaveProperty('token');

    expect(await refusal(listInvitations(LAB_WORKSPACE_ID))).toBe('workspace_role_required');
    expect(await refusal(createInvitation(PERSONAL_WORKSPACE_ID, { email: 'a@b.org', role: 'viewer' }, 'key-2'))).toBe('personal_workspace_locked');
  });

  it('revokes a pending invitation, and its link stops working', async () => {
    const created = await createInvitation(OWNED_WORKSPACE_ID, { email: 'ada@example.org', role: 'viewer' }, 'key-3');
    await revokeInvitation(OWNED_WORKSPACE_ID, created.id);
    expect(await listInvitations(OWNED_WORKSPACE_ID)).not.toContainEqual(expect.objectContaining({ id: created.id }));
    expect(await refusal(acceptInvitation(created.token))).toBe('invitation_not_found');
  });

  it('joins with the invitation’s role, then answers already_member', async () => {
    expect(await acceptInvitation(INVITE_TOKENS.join)).toEqual({ status: 'joined', workspace_id: INVITED_WORKSPACE_ID, role: 'editor' });
    expect((await listWorkspaces()).items.find((item) => item.id === INVITED_WORKSPACE_ID)?.role).toBe('editor');
    expect((await acceptInvitation(INVITE_TOKENS.join)).status).toBe('already_member');
  });

  it('refuses a lapsed link, one for another address and an unknown one', async () => {
    expect(await refusal(acceptInvitation(INVITE_TOKENS.expired))).toBe('invitation_expired');
    expect(await refusal(acceptInvitation(INVITE_TOKENS.mismatch))).toBe('invitation_email_mismatch');
    expect(await refusal(acceptInvitation('cwinv-nothing'))).toBe('invitation_not_found');
  });
});

describe('ownership transfer (M6)', () => {
  it('shows the pending transfer to the member it names, who accepts it', async () => {
    const lab = await getWorkspace(LAB_WORKSPACE_ID);
    expect(lab.ownership_transfer).toMatchObject({ from_user_id: PEOPLE.grace.user_id, to_user_id: PREVIEW_USER_ID });
    const accepted = await acceptOwnershipTransfer(LAB_WORKSPACE_ID);
    expect(accepted.role).toBe('owner');
    expect(accepted.ownership_transfer).toBeNull();
    expect((await listMembers(LAB_WORKSPACE_ID)).find((row) => row.user_id === PEOPLE.grace.user_id)?.role).toBe('admin');
  });

  it('lets the member decline it', async () => {
    await cancelOwnershipTransfer(LAB_WORKSPACE_ID);
    expect((await getWorkspace(LAB_WORKSPACE_ID)).ownership_transfer).toBeNull();
    expect(await refusal(acceptOwnershipTransfer(LAB_WORKSPACE_ID))).toBe('transfer_not_found');
  });

  it('is the owner’s to ask, of a member who is not an owner', async () => {
    expect(await refusal(requestOwnershipTransfer(LAB_WORKSPACE_ID, PEOPLE.alan.user_id))).toBe('workspace_role_required');
    expect(await refusal(requestOwnershipTransfer(OWNED_WORKSPACE_ID, PREVIEW_USER_ID))).toBe('unchanged');
    expect(await refusal(requestOwnershipTransfer(OWNED_WORKSPACE_ID, 'u-nobody'))).toBe('member_not_found');
    expect(await refusal(requestOwnershipTransfer(PERSONAL_WORKSPACE_ID, PREVIEW_USER_ID))).toBe('personal_workspace_locked');
    const transfer = await requestOwnershipTransfer(OWNED_WORKSPACE_ID, PEOPLE.marie.user_id);
    expect(transfer).toMatchObject({ from_user_id: PREVIEW_USER_ID, to_user_id: PEOPLE.marie.user_id });
    expect((await getWorkspace(OWNED_WORKSPACE_ID)).ownership_transfer?.to_user_id).toBe(PEOPLE.marie.user_id);
    await cancelOwnershipTransfer(OWNED_WORKSPACE_ID);
    expect((await getWorkspace(OWNED_WORKSPACE_ID)).ownership_transfer).toBeNull();
  });
});
