/**
 * What every focusable row of a {@link TreeView} carries. A caller extends it
 * with its own row kinds (a collection, a page, a "Show more" line).
 */
export type TreeRowBase = {
  key: string;
  kind: string;
  /** The accessible name of the row, used by its expand button and by type-ahead. */
  label: string;
  /** One-based depth. */
  level: number;
  parentKey: string | null;
  /** One-based position among its siblings, and their count. */
  position: number;
  setSize: number;
  expandable?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  /** False for an action row ("Show more"), which is never selected. */
  selectable?: boolean;
  /** Whether a drag the tree accepts can drop onto this row. */
  droppable?: boolean;
  /** Whether this row can be dragged (a pointer that hovers only). */
  draggable?: boolean;
  /** The open page: `aria-current="page"`, and a mark that is not colour alone. */
  current?: boolean;
};

/**
 * A branch's loading, error or empty line. It is shown in place and hidden
 * from assistive tech: a tree may own only `treeitem` and `group` elements.
 */
export type TreeNoteRow = {
  key: string;
  kind: 'note';
  level: number;
  tone: 'loading' | 'error' | 'empty';
  text: string;
};

export type TreeRow<R extends TreeRowBase> = R | TreeNoteRow;

/** Where a drop lands relative to the row under the pointer. */
export type DropPlacement = 'before' | 'after' | 'inside';
