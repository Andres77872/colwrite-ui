import type { TrashCounts } from '@/data/trash';

/*
 * The Trash's wording (docs/workspace_collection/14 §4): what a collection
 * takes with it, how long the Trash keeps it, and what deleting it forever
 * removes.
 */

/** How long the Trash keeps what goes there. */
export const RETENTION_DAYS = 30;

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}

/** "a, b and c". */
export function listOf(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** What a collection holds besides itself, the parts that are not empty: "3 collections", "41 pages", "12 PDFs". */
export function contentsOf(counts: TrashCounts): string[] {
  return [
    counts.collection_count > 1 ? plural(counts.collection_count - 1, 'collection') : null,
    counts.page_count > 0 ? plural(counts.page_count, 'page') : null,
    counts.pdf_count > 0 ? plural(counts.pdf_count, 'PDF') : null,
  ].filter((part): part is string => part !== null);
}

/**
 * The collection trash preview: "Moves Chapter 1, 3 collections, 41 pages and
 * 12 PDFs to Trash. You can restore them for 30 days."
 */
export function trashPreviewSentence(name: string, counts: TrashCounts): string {
  const contents = contentsOf(counts);
  const restore = contents.length > 0 ? 'them' : 'it';
  return `Moves ${listOf([name, ...contents])} to Trash. You can restore ${restore} for ${RETENTION_DAYS} days.`;
}

/** What deleting a collection forever removes: "Chapter 1, 3 collections, 41 pages and 12 PDFs". */
export function purgeContents(name: string, counts: TrashCounts): string {
  return listOf([name, ...contentsOf(counts)]);
}

/** Days until the Trash deletes something for good, rounded up; never below zero. */
export function daysLeft(purgeAfter: string | null | undefined, now = Date.now()): number | null {
  if (!purgeAfter) return null;
  const at = Date.parse(purgeAfter);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / (24 * 60 * 60 * 1000)));
}

/** "Deleted forever in 27 days", "… tomorrow", "… today". */
export function purgeLabel(purgeAfter: string | null | undefined, now = Date.now()): string | null {
  const days = daysLeft(purgeAfter, now);
  if (days === null) return null;
  if (days === 0) return 'Deleted forever today';
  if (days === 1) return 'Deleted forever tomorrow';
  return `Deleted forever in ${days} days`;
}
