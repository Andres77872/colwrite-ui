import { useCallback, useContext, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { useConfirm } from '@/components/ui/confirmContext';
import { AuthContext } from '@/components/auth/authContextState';
import { formatDateTime } from '@/lib/text';
import { relativeTime } from '@/components/layout/relativeTime';
import { shortDate } from '@/components/layout/editedLabel';
import { errorMessage, problemBody, problemCode } from '@/api/errors';
import {
  deleteAccount,
  useUpdateProfile,
  type ProfileUpdate,
  type UserIdentity,
  type UserProfile,
} from '@/data/userProfile';
import { AlertCircle, LogOut, UserX } from 'lucide-react';
import { WorkspaceContext } from '@/components/workspace/workspaceContextState';
import { listOf } from '@/components/collections/trashCopy';
import { TypedConfirmDialog } from './TypedConfirmDialog';
import { useSettingsEscape } from './settingsEscape';
import { ReadOnlyValue, Row, Section } from './SettingsSection';

/** Two-letter monogram from a display name or username. */
function initialsFor(value: string): string {
  const parts = value.replace(/@.*/, '').split(/[\s._-]+/g).filter(Boolean);
  const first = parts[0]?.[0] ?? 'C';
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? 'W';
  return `${first}${second}`.toUpperCase();
}

/** Account types every signed-up person has; only other roles get a badge. */
const DEFAULT_ROLES = new Set(['', 'user', 'consumer', 'member', 'free', 'standard']);

type Values = {
  display_name: string;
  headline: string;
  affiliation: string;
  avatar_url: string;
  bio: string;
  timezone: string;
};

function valuesFrom(profile: UserProfile): Values {
  return {
    display_name: profile.display_name ?? '',
    headline: profile.headline ?? '',
    affiliation: profile.affiliation ?? '',
    avatar_url: profile.avatar_url ?? '',
    bio: profile.bio ?? '',
    timezone: profile.timezone ?? 'UTC',
  };
}

function sameValues(a: Values, b: Values): boolean {
  return (Object.keys(a) as (keyof Values)[]).every((key) => a[key] === b[key]);
}

/**
 * The Account pane of Settings, laid out like Notion's "My account": who you
 * are at the top, then labelled rows. The profile rows edit in place, and a
 * save bar appears once something has changed. Email and username belong to
 * the auth service — the API rejects them — so they are shown, read-only,
 * with a note saying where they are managed.
 */
export function AccountPane({
  identity,
  profile,
}: {
  identity: UserIdentity;
  /** The saved profile; a save shows here through the dashboard's cache. */
  profile: UserProfile;
}) {
  const auth = useContext(AuthContext);
  const updateProfile = useUpdateProfile().mutateAsync;
  const { toast } = useToast();
  const confirm = useConfirm();
  const id = useId();

  const [values, setValues] = useState<Values>(() => valuesFrom(profile));
  const [baseline, setBaseline] = useState<UserProfile>(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = valuesFrom(baseline);
  const dirty = !sameValues(values, saved);

  // A refresh from another pane brings a new profile. Take it, unless the
  // author is in the middle of changing something.
  if (profile !== baseline) {
    setBaseline(profile);
    if (!dirty) setValues(valuesFrom(profile));
  }

  const set = (key: keyof Values, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const discard = useCallback(() => {
    setValues(valuesFrom(baseline));
    setError(null);
  }, [baseline]);

  // Escape with changes typed asks before throwing them away, instead of
  // closing Settings over them.
  const onEscape = useCallback(() => {
    if (saving) return;
    void confirm({
      title: 'Discard your changes?',
      description: 'The edits to your profile have not been saved.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
    }).then((ok) => {
      if (ok) discard();
    });
  }, [confirm, discard, saving]);
  useSettingsEscape(dirty ? onEscape : null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Every field is sent, including the empty ones: an empty string is how
      // the API is told to clear a value, and omitting it would mean
      // "unchanged" instead.
      const changes: ProfileUpdate = {
        display_name: values.display_name.trim(),
        headline: values.headline.trim(),
        affiliation: values.affiliation.trim(),
        avatar_url: values.avatar_url.trim(),
        bio: values.bio.trim(),
        timezone: values.timezone.trim() || 'UTC',
      };
      const response = await updateProfile(changes);
      setBaseline(response.profile);
      setValues(valuesFrom(response.profile));
      toast({ title: 'Profile updated', variant: 'success' });
    } catch (caught) {
      setError(errorMessage(caught, 'Could not save your profile'));
    } finally {
      setSaving(false);
    }
  };

  const name = baseline.display_name || identity.username;
  // The handle is the auth username; some accounts only have a display name
  // there ("Ada Author"), which is not a handle and should not get an "@".
  const handle = /^[\w.-]+$/.test(identity.username) ? identity.username : null;
  const email = auth?.user?.email ?? '';
  const role = identity.user_type?.trim() ?? '';
  const since = monthYear(baseline.created_at);
  const lastSeen = lastSeenLabel(baseline.last_seen_at);
  const field = (key: string) => `${id}-${key}`;

  return (
    <form className="flex flex-col gap-9" onSubmit={submit} noValidate>
      {/* Who this is, at a glance. */}
      <div className="flex items-center gap-4">
        {baseline.avatar_url ? (
          <img
            src={baseline.avatar_url}
            alt=""
            className="size-14 shrink-0 rounded-full object-cover ring-1 ring-border"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-14 shrink-0 place-items-center rounded-full bg-tint-orange text-lg font-semibold text-tint-orange-fg"
          >
            {initialsFor(name)}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate text-md font-semibold">{name}</h3>
            {!DEFAULT_ROLES.has(role.toLowerCase()) && (
              <Badge variant="secondary" className="shrink-0 capitalize">
                {role}
              </Badge>
            )}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {[handle && `@${handle}`, email].filter(Boolean).join(' · ') || 'ColWrite account'}
          </p>
          {(since || lastSeen) && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {since && <span>Member since {since}</span>}
              {since && lastSeen && <span aria-hidden="true"> · </span>}
              {lastSeen && <span title={formatDateTime(baseline.last_seen_at)}>Active {lastSeen}</span>}
            </p>
          )}
        </div>
      </div>

      <Section title="Profile">
        <Row id={field('name')} label="Preferred name" description="How you appear in the sidebar and on your pages.">
          <Input
            id={field('name')}
            value={values.display_name}
            maxLength={191}
            placeholder={identity.username}
            autoComplete="name"
            onChange={(event) => set('display_name', event.target.value)}
          />
        </Row>
        <Row id={field('headline')} label="Headline" description="One line about what you do.">
          <Input
            id={field('headline')}
            value={values.headline}
            maxLength={255}
            placeholder="PhD candidate, computational linguistics"
            onChange={(event) => set('headline', event.target.value)}
          />
        </Row>
        <Row id={field('affiliation')} label="Affiliation" description="Your lab, company or university.">
          <Input
            id={field('affiliation')}
            value={values.affiliation}
            maxLength={191}
            placeholder="University of Somewhere"
            autoComplete="organization"
            onChange={(event) => set('affiliation', event.target.value)}
          />
        </Row>
        <Row id={field('avatar')} label="Photo" description="A link to an image, shown as your avatar.">
          <Input
            id={field('avatar')}
            type="url"
            value={values.avatar_url}
            maxLength={512}
            placeholder="https://…"
            onChange={(event) => set('avatar_url', event.target.value)}
          />
        </Row>
        <Row id={field('timezone')} label="Time zone" description="Used for the dates in your usage history.">
          <div className="flex gap-2">
            <Input
              id={field('timezone')}
              value={values.timezone}
              maxLength={64}
              placeholder="UTC"
              onChange={(event) => set('timezone', event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}
            >
              Detect
            </Button>
          </div>
        </Row>
        <Row id={field('about')} label="About" description="What you are working on." stacked>
          <Textarea
            id={field('about')}
            value={values.bio}
            maxLength={1000}
            rows={3}
            placeholder="Add a few lines about your research."
            aria-describedby={field('about-count')}
            onChange={(event) => set('bio', event.target.value)}
          />
          <span id={field('about-count')} className="mt-1 block text-right text-2xs text-muted-foreground">
            {values.bio.length}/1000
          </span>
        </Row>
      </Section>

      <Section
        title="Sign-in"
        note="Your email, username and password are managed by your ColWrite account, not here."
      >
        <Row label="Email" description="Where sign-in and account notices go.">
          <ReadOnlyValue value={email} />
        </Row>
        <Row label="Username" description="Your sign-in name.">
          <ReadOnlyValue value={identity.username} />
        </Row>
        {auth && (
          <Row label="Sign out" description="Sign out of ColWrite on this device.">
            <div className="flex sm:justify-end">
              <Button type="button" variant="outline" onClick={auth.logout}>
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            </div>
          </Row>
        )}
      </Section>

      <DeleteAccountSection username={identity.username} />

      {(dirty || error) && (
        // Pinned to the foot of the pane while there is something to save,
        // the way Notion confirms an edit to your account.
        <div
          role="region"
          aria-label="Unsaved changes"
          className="sticky bottom-4 z-10 -mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-popover px-4 py-2.5 shadow-lg ring-1 ring-border"
        >
          {error ? (
            <p role="alert" className="flex min-w-0 flex-1 items-start gap-1.5 text-sm text-destructive">
              <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </p>
          ) : (
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">You have unsaved changes.</p>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={discard} disabled={saving}>
              Discard
            </Button>
            <Button type="submit" disabled={saving || !dirty}>
              {saving && <Spinner />}
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

/** "Jan 2026". */
function monthYear(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** "today", "yesterday", "3 days ago", then "Sep 20". */
function lastSeenLabel(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return '';
  const days = Math.floor((Date.now() - time) / (24 * 3600 * 1000));
  if (days < 7) return days <= 0 ? 'today' : relativeTime(time);
  return shortDate(date);
}

/**
 * Settings → Account → Delete account (07 §8): the username typed exactly.
 * While a shared workspace has this account as its only owner the server
 * refuses, naming them, and the author deletes those first. Once deleted,
 * the session is over: the server already signed it out, and nothing of the
 * account stays in this browser.
 */
function DeleteAccountSection({ username }: { username: string }) {
  const auth = useContext(AuthContext);
  const workspaces = useContext(WorkspaceContext);
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);

  const namesOf = (ids: readonly string[]) =>
    ids.map((id) => workspaces?.workspaces.find((item) => item.id === id)?.name ?? 'A workspace that is no longer listed');

  const describe = (error: unknown) => {
    switch (problemCode(error)) {
      case 'sole_owner': {
        const names = namesOf(problemBody(error)?.workspace_ids ?? []);
        const one = names.length === 1;
        return `You are the only owner of ${listOf(names)}. For each, make another member the owner in Settings → Members, or delete ${one ? 'it' : 'the workspace'} in Settings → Workspace, then delete your account.`;
      }
      case 'confirmation_mismatch':
        return 'The username you typed is not this account’s. Type it exactly, with the same capitals.';
      default:
        return errorMessage(error, 'Could not delete your account.');
    }
  };

  return (
    <Section title="Delete account">
      <Row
        label="Delete your account"
        description="Deletes your personal workspace with everything in it, and takes you out of every other workspace. It can’t be undone."
      >
        <div className="flex sm:justify-end">
          <Button type="button" variant="outline" className="text-destructive" onClick={() => setConfirming(true)}>
            <UserX aria-hidden="true" />
            Delete account
          </Button>
        </div>
      </Row>
      {confirming && (
        <TypedConfirmDialog
          title="Delete your account?"
          description="Your personal workspace and everything in it is deleted for good, and you leave every other workspace. Shared workspaces you alone own must be deleted first."
          expected={username}
          confirmLabel="Delete account"
          onClose={() => setConfirming(false)}
          describe={describe}
          onConfirm={async () => {
            await deleteAccount(username);
            toast({ title: 'Your account was deleted', description: 'You have been signed out.' });
            auth?.endSession();
          }}
        />
      )}
    </Section>
  );
}
