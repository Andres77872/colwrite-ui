import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, LogOut, UserMinus, UserPlus, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import { useView } from '@/components/layout/viewContextState';
import { shortDate } from '@/components/layout/editedLabel';
import { useWorkspace } from '@/components/workspace/workspaceContextState';
import { accessOf, roleLabel, roleWithArticle } from '@/components/workspace/workspaceAccess';
import { useWorkspaceActions, workspaceProblem } from '@/actions/useWorkspaceActions';
import { meQuery } from '@/data/userProfile';
import { workspaceQuery, type WorkspaceDetail } from '@/data/workspaces';
import {
  ASSIGNABLE_ROLES,
  changeMemberRole,
  invalidateMembership,
  invitationsQuery,
  memberName,
  membersQuery,
  removeMember,
  requestOwnershipTransfer,
  revokeInvitation,
  type AssignableRole,
  type Member,
  type PendingInvitation,
} from '@/data/members';
import { InviteDialog } from './InviteDialog';
import { Section } from './SettingsSection';

const DAY_MS = 24 * 3600 * 1000;

/** "Expires today", "Expires tomorrow", "Expires in 6 days". */
function expiresLabel(expireTime: string, now = Date.now()): string {
  const days = Math.max(0, Math.ceil((Date.parse(expireTime) - now) / DAY_MS));
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `Expires in ${days} days`;
}

/** One or two letters for a member's avatar. */
function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')).toUpperCase();
}

/**
 * Settings → Members (M6.UI-1): who is in the workspace being shown and with
 * which role; for admins, changing roles, removing people and inviting them
 * by link, with the pending invitations and Revoke; for its owner, asking a
 * member to become the owner; for the member a transfer names, Accept or
 * Decline. Everyone can leave, except the last owner.
 *
 * The server decides every one of these: a refusal is said in words
 * (`workspaceProblem`) and the list reads again.
 */
export function MembersPane() {
  const { workspace } = useWorkspace();
  const detail = useQuery(workspaceQuery(workspace.id));
  const data = detail.data;

  if (workspace.kind === 'personal') {
    return (
      <p className="text-sm text-muted-foreground">
        Your personal workspace is only yours. To work with other people, create a workspace from the workspace menu and invite them there; copy pages into it with <strong className="font-medium text-foreground">Copy to workspace…</strong>.
      </p>
    );
  }
  if (!data) {
    return detail.isError ? (
      <Alert variant="destructive">{workspaceProblem(detail.error, 'Could not load this workspace.')}</Alert>
    ) : (
      <p className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Loading the members…
      </p>
    );
  }
  return <SharedMembers detail={data} />;
}

function SharedMembers({ detail }: { detail: WorkspaceDetail }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const { setView } = useView();
  const { leaveShown } = useWorkspaceActions();
  const access = accessOf(detail.role);
  const me = useQuery(meQuery()).data?.identity.user_id ?? null;
  const members = useQuery(membersQuery(detail.id));
  const invitations = useQuery({ ...invitationsQuery(detail.id), enabled: access.isAdmin });
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = members.data ?? [];
  const owners = rows.filter((row) => row.role === 'owner').length;
  const nameOf = (userId: string | null | undefined) => {
    const found = rows.find((row) => row.user_id === userId);
    return found ? memberName(found) : 'Someone';
  };

  /** One change; a refusal is said, and the members read again either way. */
  const run = async (key: string, change: () => Promise<unknown>, failed: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      await change();
      return true;
    } catch (caught) {
      setError(workspaceProblem(caught, failed));
      return false;
    } finally {
      // Read back before the row lets go, so it never shows the old state in between.
      await invalidateMembership(queryClient, detail.id).catch(() => undefined);
      setBusy(null);
    }
  };

  const changeRole = (member: Member, role: AssignableRole) =>
    void run(`role:${member.user_id}`, () => changeMemberRole(detail.id, member.user_id, role), `Could not change ${memberName(member)}’s role.`)
      .then((done) => done && toast({ title: `${memberName(member)} is now ${roleWithArticle(role)}` }));

  const remove = async (member: Member) => {
    const name = memberName(member);
    const ok = await confirm({
      title: `Remove ${name} from ${detail.name}?`,
      description: `${name} loses access to its pages at once. Their chats stay private to them. To come back, they need a new invitation.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    if (await run(`remove:${member.user_id}`, () => removeMember(detail.id, member.user_id), `Could not remove ${name}.`)) {
      toast({ title: `Removed ${name} from ${detail.name}` });
    }
  };

  const leave = async (member: Member) => {
    const ok = await confirm({
      title: `Leave ${detail.name}?`,
      description: 'You lose access to its pages at once. Your chats there stay private to you. To come back, someone there has to invite you again.',
      confirmLabel: 'Leave workspace',
      destructive: true,
    });
    if (!ok) return;
    await run(`remove:${member.user_id}`, () => leaveShown(member.user_id, () => setView('editor')), 'Could not leave the workspace.');
  };

  const makeOwner = async (member: Member) => {
    const name = memberName(member);
    const ok = await confirm({
      title: `Make ${name} the owner?`,
      description: `${name} becomes the owner once they accept, and you become an admin. Until then nothing changes, and you can withdraw the request. It expires in 7 days.`,
      confirmLabel: 'Ask to become owner',
    });
    if (!ok) return;
    if (await run(`owner:${member.user_id}`, () => requestOwnershipTransfer(detail.id, member.user_id), `Could not ask ${name} to become the owner.`)) {
      toast({ title: `Asked ${name} to become the owner`, description: 'They can accept it in Settings → Members.' });
    }
  };

  const revoke = (invitation: PendingInvitation) =>
    void run(`invite:${invitation.id}`, () => revokeInvitation(detail.id, invitation.id), 'Could not revoke the invitation.')
      .then((done) => done && toast({ title: `Revoked the invitation for ${invitation.email_hint}` }));

  return (
    <div className="flex flex-col gap-9">
      {detail.ownership_transfer && (
        <TransferNotice detail={detail} me={me} nameOf={nameOf} />
      )}

      <Section title={`Members · ${(members.data?.length ?? detail.counts.members).toLocaleString()}`}>
        {members.isError && !members.data && (
          <div className="py-3"><Alert variant="destructive">{workspaceProblem(members.error, 'Could not load the members.')}</Alert></div>
        )}
        {!members.data && !members.isError && (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Spinner />Loading the members…</p>
        )}
        {members.data && (
          <ul aria-label={`Members of ${detail.name}`} className="divide-y divide-border">
            {rows.map((member) => (
              <MemberRow
                key={member.user_id}
                member={member}
                self={member.user_id === me}
                viewerRole={detail.role}
                soleOwner={member.role === 'owner' && owners <= 1}
                transferPendingTo={detail.ownership_transfer?.to_user_id ?? null}
                busy={busy}
                addedBy={member.added_by ? nameOf(member.added_by) : null}
                onRole={(role) => changeRole(member, role)}
                onRemove={() => void remove(member)}
                onLeave={() => void leave(member)}
                onMakeOwner={() => void makeOwner(member)}
              />
            ))}
          </ul>
        )}
        {error && <div className="py-3"><Alert variant="destructive">{error}</Alert></div>}
      </Section>

      {access.isAdmin && (
        <Section
          title="Pending invitations"
          note="Each link works once, for the address it was made for, for 7 days. Inviting an address again replaces its link."
        >
          <div className="flex items-center justify-between gap-3 py-3">
            <p className="text-xs text-muted-foreground">People join by opening their link and signing in with the invited address.</p>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => setInviting(true)}>
              <UserPlus aria-hidden="true" />
              Invite people…
            </Button>
          </div>
          {invitations.isError && <div className="py-3"><Alert variant="destructive">{workspaceProblem(invitations.error, 'Could not load the invitations.')}</Alert></div>}
          {invitations.data?.length === 0 && <p className="py-3 text-sm text-muted-foreground">No pending invitations.</p>}
          {invitations.data?.map((invitation) => (
            <div key={invitation.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{invitation.email_hint}</p>
                <p className="text-xs text-muted-foreground">
                  {roleLabel(invitation.role)} · {expiresLabel(invitation.expire_time)}
                  {invitation.invited_by ? ` · Invited by ${invitation.invited_by === me ? 'you' : nameOf(invitation.invited_by)}` : ''}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => revoke(invitation)}
                aria-label={`Revoke the invitation for ${invitation.email_hint}`}
              >
                {busy === `invite:${invitation.id}` ? <Spinner /> : <X aria-hidden="true" />}
                Revoke
              </Button>
            </div>
          ))}
        </Section>
      )}

      {!access.isAdmin && (
        <p className="text-xs text-muted-foreground">
          You are {roleWithArticle(detail.role)} here. Only the workspace’s admins can invite people, change roles and remove members.
        </p>
      )}

      {inviting && <InviteDialog workspaceId={detail.id} workspaceName={detail.name} onClose={() => setInviting(false)} />}
    </div>
  );
}

/** The pending ownership transfer: Accept and Decline for the member it names, Withdraw for the owner. */
function TransferNotice({ detail, me, nameOf }: { detail: WorkspaceDetail; me: string | null; nameOf: (userId: string) => string }) {
  const { acceptOwnership, cancelOwnership } = useWorkspaceActions();
  const [busy, setBusy] = useState<'accept' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const transfer = detail.ownership_transfer;
  if (!transfer) return null;
  const forMe = transfer.to_user_id === me;
  const fromMe = transfer.from_user_id === me;
  const until = shortDate(new Date(transfer.expire_time));

  const act = async (kind: 'accept' | 'cancel') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'accept') await acceptOwnership();
      else await cancelOwnership();
    } catch (caught) {
      setError(workspaceProblem(caught, kind === 'accept' ? 'Could not accept the transfer.' : 'Could not cancel the transfer.'));
    } finally {
      setBusy(null);
    }
  };

  let title: string;
  let body: string;
  if (forMe) {
    title = `${nameOf(transfer.from_user_id)} wants to make you the owner`;
    body = `As the owner of ${detail.name} you can delete it or make someone else its owner. ${nameOf(transfer.from_user_id)} becomes an admin. The request expires on ${until}.`;
  } else if (fromMe) {
    title = `You asked ${nameOf(transfer.to_user_id)} to become the owner`;
    body = `Nothing changes until they accept. The request expires on ${until}.`;
  } else {
    title = `${nameOf(transfer.from_user_id)} asked ${nameOf(transfer.to_user_id)} to become the owner`;
    body = `Nothing changes until they accept. The request expires on ${until}.`;
  }

  return (
    <section aria-labelledby={headingId} className="rounded-md bg-tint-blue px-4 py-3 text-tint-blue-fg">
      <h3 id={headingId} className="text-sm font-medium">{title}</h3>
      <p className="mt-0.5 text-xs">{body}</p>
      {(forMe || fromMe) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {forMe && (
            <Button size="sm" disabled={busy !== null} onClick={() => void act('accept')}>
              {busy === 'accept' ? <Spinner /> : <Crown aria-hidden="true" />}
              Accept
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act('cancel')}>
            {busy === 'cancel' && <Spinner />}
            {forMe ? 'Decline' : 'Withdraw'}
          </Button>
        </div>
      )}
      {error && <Alert variant="destructive" className="mt-3">{error}</Alert>}
    </section>
  );
}

function MemberRow({
  member,
  self,
  viewerRole,
  soleOwner,
  transferPendingTo,
  busy,
  addedBy,
  onRole,
  onRemove,
  onLeave,
  onMakeOwner,
}: {
  member: Member;
  self: boolean;
  viewerRole: WorkspaceDetail['role'];
  soleOwner: boolean;
  transferPendingTo: string | null;
  busy: string | null;
  addedBy: string | null;
  onRole: (role: AssignableRole) => void;
  onRemove: () => void;
  onLeave: () => void;
  onMakeOwner: () => void;
}) {
  const roleId = useId();
  const access = accessOf(viewerRole);
  const name = memberName(member);
  const isOwnerRow = member.role === 'owner';
  // An admin manages everyone but owners; an owner manages everyone. Nobody changes their own role here.
  const manages = !self && access.isAdmin && (!isOwnerRow || access.isOwner);
  const rowBusy = busy !== null && busy.endsWith(`:${member.user_id}`);
  // The role picked shows while its change is sent; then the role read back.
  const [picked, setPicked] = useState<AssignableRole | null>(null);
  const shownRole = rowBusy && picked ? picked : member.role;

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-medium text-muted-foreground">
        {initialsOf(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {name}
          {self && <span className="font-normal text-muted-foreground"> (you)</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {member.display_name && member.display_name !== member.username ? `${member.username} · ` : ''}
          {member.joined_at ? `Joined ${shortDate(new Date(member.joined_at))}` : 'Member'}
          {addedBy && !self ? ` · Added by ${addedBy}` : ''}
          {transferPendingTo === member.user_id ? ' · Asked to become the owner' : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {manages && !isOwnerRow ? (
          <>
            <label htmlFor={roleId} className="sr-only">Role of {name}</label>
            <NativeSelect
              id={roleId}
              className="h-8 w-28 text-sm"
              value={shownRole}
              disabled={busy !== null}
              onChange={(event) => {
                const role = event.target.value as AssignableRole;
                setPicked(role);
                onRole(role);
              }}
            >
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>{roleLabel(role)}</option>
              ))}
            </NativeSelect>
          </>
        ) : (
          <Badge variant={isOwnerRow ? 'default' : 'secondary'}>{roleLabel(member.role)}</Badge>
        )}
        {rowBusy && <Spinner className="size-3.5" />}
        {access.isOwner && !self && !isOwnerRow && transferPendingTo !== member.user_id && (
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={onMakeOwner} aria-label={`Make ${name} the owner`}>
            <Crown aria-hidden="true" />
            Make owner…
          </Button>
        )}
        {manages && (
          <Button variant="ghost" size="sm" className="text-destructive" disabled={busy !== null} onClick={onRemove} aria-label={`Remove ${name}`}>
            <UserMinus aria-hidden="true" />
            Remove
          </Button>
        )}
        {self && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null || soleOwner}
            onClick={onLeave}
            title={soleOwner ? 'You are the only owner. Make someone else the owner first, or delete the workspace.' : undefined}
          >
            <LogOut aria-hidden="true" />
            Leave
          </Button>
        )}
      </div>
      {self && soleOwner && (
        <p className="basis-full pl-11 text-xs text-muted-foreground">
          You are the only owner, so you can’t leave. Make another member the owner first, or delete the workspace in Settings → Workspace.
        </p>
      )}
    </li>
  );
}
