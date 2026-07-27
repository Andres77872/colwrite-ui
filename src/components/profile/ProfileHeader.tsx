import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { formatDate, formatDateTime } from '@/lib/text';
import { errorMessage } from '@/services/contracts';
import {
  updateProfile,
  type ProfileUpdate,
  type UserIdentity,
  type UserProfile,
} from '@/services/userProfile';
import { AlertCircle, Building2, Check, Clock, Pencil, X } from 'lucide-react';

/** Two-letter monogram from a display name or username. */
function initialsFor(value: string): string {
  const parts = value.replace(/@.*/, '').split(/[\s._-]+/g).filter(Boolean);
  const first = parts[0]?.[0] ?? 'C';
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? 'W';
  return `${first}${second}`.toUpperCase();
}

const FIELDS = [
  {
    key: 'display_name',
    label: 'Display name',
    placeholder: 'Ada Lovelace',
    maxLength: 191,
  },
  {
    key: 'headline',
    label: 'Headline',
    placeholder: 'PhD candidate, computational linguistics',
    maxLength: 255,
  },
  {
    key: 'affiliation',
    label: 'Affiliation',
    placeholder: 'University of Somewhere',
    maxLength: 191,
  },
  {
    key: 'avatar_url',
    label: 'Avatar URL',
    placeholder: 'https://…',
    maxLength: 512,
  },
] as const;

type EditableKey = (typeof FIELDS)[number]['key'] | 'bio' | 'timezone';

/**
 * ProfileHeader — who the user is, as far as this application is concerned.
 *
 * Username, email, and password belong to the auth service and are not
 * editable here; the API rejects them outright. Everything on this card is
 * ColWrite's own record.
 */
export function ProfileHeader({
  identity,
  profile,
  onSaved,
}: {
  identity: UserIdentity;
  profile: UserProfile;
  onSaved: (profile: UserProfile) => void;
}) {
  const [editing, setEditing] = useState(false);

  const name = profile.display_name || identity.username;
  const initials = initialsFor(name);

  if (editing) {
    return (
      <ProfileForm
        profile={profile}
        onCancel={() => setEditing(false)}
        onSaved={(next) => {
          onSaved(next);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-start gap-4">
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt=""
            className="h-14 w-14 shrink-0 rounded-xl border border-border object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-secondary text-lg font-bold text-secondary-foreground"
          >
            {initials}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold">{name}</h1>
            <Badge variant="secondary">{identity.user_type}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">@{identity.username}</p>

          {profile.headline && <p className="mt-2 text-sm">{profile.headline}</p>}
          {profile.bio && (
            <p className="mt-2 max-w-prose whitespace-pre-line text-sm text-muted-foreground">
              {profile.bio}
            </p>
          )}

          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
            {profile.affiliation && (
              <div className="flex items-center gap-1.5">
                <Building2 aria-hidden="true" className="h-3.5 w-3.5" />
                <dt className="sr-only">Affiliation</dt>
                <dd>{profile.affiliation}</dd>
              </div>
            )}
            {profile.created_at && (
              <div className="flex items-center gap-1.5">
                <dt>Profile since</dt>
                <dd className="text-foreground/80">{formatDate(profile.created_at)}</dd>
              </div>
            )}
            {profile.last_seen_at && (
              <div className="flex items-center gap-1.5">
                <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                <dt className="sr-only">Last seen</dt>
                <dd>{formatDateTime(profile.last_seen_at)}</dd>
              </div>
            )}
          </dl>
        </div>

        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" />
          Edit profile
        </Button>
      </div>
    </section>
  );
}

function ProfileForm({
  profile,
  onCancel,
  onSaved,
}: {
  profile: UserProfile;
  onCancel: () => void;
  onSaved: (profile: UserProfile) => void;
}) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<EditableKey, string>>({
    display_name: profile.display_name ?? '',
    headline: profile.headline ?? '',
    affiliation: profile.affiliation ?? '',
    avatar_url: profile.avatar_url ?? '',
    bio: profile.bio ?? '',
    timezone: profile.timezone ?? 'UTC',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: EditableKey, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
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
      onSaved(response.profile);
      toast({ title: 'Profile updated', variant: 'success' });
    } catch (caught) {
      setError(errorMessage(caught, 'Could not save your profile'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div>
          <h2 className="text-md font-semibold">Edit profile</h2>
          <p className="text-xs text-muted-foreground">
            Your username, email, and password are managed by your account settings, not here.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <label key={field.key} className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">{field.label}</span>
              <Input
                value={values[field.key]}
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                onChange={(event) => set(field.key, event.target.value)}
              />
            </label>
          ))}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">About</span>
          <Textarea
            value={values.bio}
            maxLength={1000}
            rows={4}
            placeholder="What you are working on."
            onChange={(event) => set('bio', event.target.value)}
          />
          <span className="text-2xs text-muted-foreground">
            {values.bio.length}/1000
          </span>
        </label>

        <label className="flex max-w-xs flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">Time zone</span>
          <div className="flex gap-2">
            <Input
              value={values.timezone}
              maxLength={64}
              placeholder="UTC"
              onChange={(event) => set('timezone', event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              onClick={() =>
                set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
              }
            >
              Detect
            </Button>
          </div>
        </label>

        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner /> : <Check aria-hidden="true" />}
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            <X aria-hidden="true" />
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
