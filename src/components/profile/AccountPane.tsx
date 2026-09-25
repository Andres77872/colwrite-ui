import { useCallback, useContext, useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { useConfirm } from '@/components/ui/confirmContext';
import { AuthContext } from '@/components/auth/authContextState';
import { formatDateTime } from '@/lib/text';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/components/layout/relativeTime';
import { shortDate } from '@/components/layout/editedLabel';
import { errorMessage } from '@/services/contracts';
import {
  updateProfile,
  type ProfileUpdate,
  type UserIdentity,
  type UserProfile,
} from '@/services/userProfile';
import { AlertCircle, LogOut } from 'lucide-react';
import { useSettingsEscape } from './settingsEscape';

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
  onSaved,
}: {
  identity: UserIdentity;
  profile: UserProfile;
  onSaved: (profile: UserProfile) => void;
}) {
  const auth = useContext(AuthContext);
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
      onSaved(response.profile);
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

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="border-b border-border pb-2.5 text-sm font-medium text-foreground">
        {title}
      </h3>
      <div className="divide-y divide-border">{children}</div>
      {note && <p className="pt-2 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

/**
 * One settings row: the label and a short description on the left, the
 * control on the right. On a phone, or for a long field, the control goes
 * under the label at full width.
 */
function Row({
  id,
  label,
  description,
  stacked = false,
  children,
}: {
  id?: string;
  label: string;
  description?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  const LabelTag = id ? 'label' : 'p';
  return (
    <div
      className={cn(
        'grid gap-x-8 gap-y-2 py-3.5',
        !stacked && 'sm:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] sm:items-center',
      )}
    >
      <div className="min-w-0">
        <LabelTag {...(id ? { htmlFor: id } : {})} className="text-sm font-medium text-foreground">
          {label}
        </LabelTag>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ReadOnlyValue({ value }: { value: string }) {
  return (
    <p className={cn('truncate text-sm sm:text-right', value ? 'text-foreground' : 'text-muted-foreground')} title={value || undefined}>
      {value || 'Not available'}
    </p>
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
