import type { RevisionSummary } from '@/services/documentHistory';

/**
 * How a revision reads in the History list: a human name for its kind, a
 * summary only when it adds something, and a short timestamp.
 */

const KIND_LABELS: Record<string, string> = {
  create: 'Created',
  save: 'Saved',
  semantic_edit: 'Edited',
  change_set_accept: 'Accepted suggestions',
  restore: 'Restored',
  delete: 'Moved to trash',
  migration: 'Migrated',
  import: 'Imported',
  history_backfill: 'Imported',
  autosave: 'Saved',
  manual_save: 'Saved',
  rename: 'Renamed',
};

/** "change_set_accept" → "Change set accept": never a raw identifier. */
function sentenceCase(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Saved';
}

export function kindLabel(revision: Pick<RevisionSummary, 'kind'>): string {
  return KIND_LABELS[revision.kind] ?? sentenceCase(revision.kind);
}

/** The summary is noise when it only repeats the kind ("Created … Created"). */
export function distinctSummary(revision: RevisionSummary): string | null {
  const summary = revision.summary?.trim();
  if (!summary) return null;
  const label = kindLabel(revision).toLowerCase();
  const same = summary.toLowerCase().replace(/[.\s]+$/, '');
  return same === label || same === revision.kind.replace(/_/g, ' ').toLowerCase() ? null : summary;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today, 8:32 AM", "Yesterday, 3:12 AM", "Sep 18, 11:40 AM" (plus the year when it differs). */
export function revisionTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay(date, now)) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday, ${time}`;
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${day}, ${time}`;
}
