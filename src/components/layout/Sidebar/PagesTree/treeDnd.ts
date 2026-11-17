import type { DropPlacement } from '@/components/ui/tree';
import { dragKind, setLibraryDragPayload, type LibraryDragPayload } from '@/components/panels/Library/collectionDnd';
import { registerModuleReset } from '@/lib/moduleState';

/*
 * Drag and drop in the pages tree (08 §6.3), with native HTML5 drags, as the
 * Library has. Every drop here has a menu twin ("Move to…", "Move up",
 * "Move down"), so nothing needs a drag (WCAG 2.2 SC 2.5.7).
 *
 * - A page or a collection dropped on a collection row moves inside it.
 * - Dropped in the gap between two rows of the same kind, in a home ordered
 *   by hand, it goes there.
 * - Dropped on the "Pages" heading, it moves to the top level.
 * - A PDF dragged from the Library onto a collection row moves there.
 *
 * Dragging is off on a coarse pointer, where the row menu is the way.
 */

/** A tree row as the drop rules see it. */
export type DropRow =
  | { kind: 'collection'; id: number; parentId: number | null; key: string; ancestors: readonly string[] }
  | { kind: 'page'; id: string; collectionId: number | null; key: string }
  | { kind: 'other' };

/** What this tab is dragging: during a drag only a payload's types can be read. */
let active: { kind: 'page' | 'collection'; key: string } | null = null;
registerModuleReset(() => {
  active = null;
});

/** Whether rows can be dragged here: a pointer that hovers and is fine, not a finger. */
export function canDragRows(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia('(pointer: coarse)').matches;
}

export function startRowDrag(dataTransfer: DataTransfer, row: { key: string }, payload: LibraryDragPayload): void {
  setLibraryDragPayload(dataTransfer, payload);
  active = payload.kind === 'document' ? { kind: 'page', key: row.key } : payload.kind === 'collection' ? { kind: 'collection', key: row.key } : null;
}

export function endRowDrag(): void {
  active = null;
}

/** Whether a drag is one the tree takes: a page, a collection or a PDF row. */
export function acceptsTreeDrag(dataTransfer: DataTransfer): boolean {
  return dragKind(dataTransfer) !== null;
}

/**
 * Where the drag over `row` may land. `custom(home)` says whether a home
 * (`null` the top level) is ordered by hand, which a gap drop needs.
 */
export function dropPlacements(
  row: DropRow,
  dataTransfer: DataTransfer,
  custom: (home: number | null) => boolean,
): DropPlacement[] {
  const kind = dragKind(dataTransfer);
  if (!kind || row.kind === 'other') return [];
  if (row.kind === 'collection') {
    // A collection never goes inside itself or a collection within it.
    const ownSubtree = kind === 'collection' && active !== null && (active.key === row.key || row.ancestors.includes(active.key));
    if (ownSubtree) return [];
    const places: DropPlacement[] = ['inside'];
    if (kind === 'collection' && custom(row.parentId)) places.push('before', 'after');
    return places;
  }
  if (kind === 'document' && custom(row.collectionId) && active?.key !== row.key) return ['before', 'after'];
  return [];
}

/** The "Pages" heading takes pages and collections, which move to the top level. */
export function acceptsRootDrop(dataTransfer: DataTransfer): boolean {
  const kind = dragKind(dataTransfer);
  return kind === 'document' || kind === 'collection';
}
