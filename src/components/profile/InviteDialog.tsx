import { useId, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { shortDate } from '@/components/layout/editedLabel';
import { ROLE_DESCRIPTIONS, roleLabel, roleWithArticle } from '@/components/workspace/workspaceAccess';
import { workspaceProblem } from '@/actions/useWorkspaceActions';
import {
  ASSIGNABLE_ROLES,
  createInvitation,
  invalidateMembership,
  invitationLink,
  type AssignableRole,
  type CreatedInvitation,
} from '@/data/members';
import { uid } from '@/lib/uid';

/** Copying needs the clipboard API, which a plain-HTTP page on the network does not have. */
const canCopy = () => typeof window !== 'undefined' && window.isSecureContext && Boolean(navigator.clipboard?.writeText);

/**
 * "Invite people…" (M6): an address and a role make an invitation link. The
 * API sends no email and answers the link's token once, so the dialog shows
 * the link then, with Copy where the clipboard is available, and says it
 * will not be shown again. The link works once, for that address, for seven
 * days; inviting the address again replaces it.
 */
export function InviteDialog({ workspaceId, workspaceName, onClose }: { workspaceId: string; workspaceName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const emailId = useId();
  const roleId = useId();
  const roleHelpId = useId();
  const linkId = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<(CreatedInvitation & { email: string }) | null>(null);
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
  // One key per invitation asked for: a retry after a failure is the same request.
  const keyRef = useRef(uid());
  const linkRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address || busy) return;
    setBusy(true);
    setError(null);
    try {
      const invitation = await createInvitation(workspaceId, { email: address, role }, keyRef.current);
      setCreated({ ...invitation, email: address });
      setCopied(null);
      void invalidateMembership(queryClient, workspaceId);
    } catch (caught) {
      setError(workspaceProblem(caught, 'Could not create the invitation.'));
    } finally {
      setBusy(false);
    }
  };

  const another = () => {
    keyRef.current = uid();
    setCreated(null);
    setEmail('');
    setCopied(null);
    setError(null);
  };

  const link = created ? invitationLink(created.token) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('copied');
    } catch {
      setCopied('failed');
      linkRef.current?.select();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-md">
        {!created ? (
          <form onSubmit={(event) => void submit(event)}>
            <DialogHeader>
              <DialogTitle>Invite people to {workspaceName}</DialogTitle>
              <DialogDescription>
                You get a link to share with them. It works once, for the address you enter, for 7 days.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-1">
                <label htmlFor={emailId} className="block text-sm font-medium">Email address</label>
                <Input
                  id={emailId}
                  type="email"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">They join by signing in with this address, verified on their account.</p>
              </div>
              <div className="space-y-1">
                <label htmlFor={roleId} className="block text-sm font-medium">Role</label>
                <NativeSelect
                  id={roleId}
                  className="w-full"
                  value={role}
                  disabled={busy}
                  aria-describedby={roleHelpId}
                  onChange={(event) => setRole(event.target.value as AssignableRole)}
                >
                  {ASSIGNABLE_ROLES.map((value) => (
                    <option key={value} value={value}>{roleLabel(value)}</option>
                  ))}
                </NativeSelect>
                <p id={roleHelpId} className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
              </div>
              {error && <Alert variant="destructive">{error}</Alert>}
            </div>
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy || !email.trim()}>
                {busy ? <Spinner /> : <Link2 aria-hidden="true" />}
                Create invite link
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Share this link with {created.email}</DialogTitle>
              <DialogDescription>
                Signed in with that address, they join {workspaceName} as {roleWithArticle(created.role)}. The link works once and expires on {shortDate(new Date(created.expire_time))}.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-2">
              <label htmlFor={linkId} className="block text-sm font-medium">Invite link</label>
              <div className="flex gap-2">
                <Input
                  id={linkId}
                  ref={linkRef}
                  readOnly
                  value={link}
                  className="font-mono text-xs"
                  onFocus={(event) => event.currentTarget.select()}
                />
                {canCopy() && (
                  <Button type="button" variant="outline" className="shrink-0" onClick={() => void copy()}>
                    {copied === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {copied === 'copied' ? 'Copied' : 'Copy'}
                  </Button>
                )}
              </div>
              <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
                {copied === 'copied' && 'The link is copied.'}
                {copied === 'failed' && 'Could not copy the link. It is selected: copy it with your keyboard.'}
                {!canCopy() && 'Copying isn’t available on this connection. Select the link and copy it.'}
              </p>
              <Alert variant="info" role="note">
                This link is shown only now. If it gets lost, invite {created.email} again: the new link replaces this one.
              </Alert>
            </div>
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" onClick={another}>Invite someone else</Button>
              <Button type="button" onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
