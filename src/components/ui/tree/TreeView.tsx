import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DropPlacement, TreeNoteRow, TreeRow, TreeRowBase } from './types';

export type TreeRowState = {
  selected: boolean;
  /** A drag the tree accepts is over this row, and where it would land. */
  dropTarget: boolean;
  dropPlacement: DropPlacement | null;
};

export type TreeDrop<R> = {
  /** Whether the drag over the tree is one it takes, read on every drag event. */
  accepts: (dataTransfer: DataTransfer) => boolean;
  /**
   * Where the drag now over `row` may land: inside it (a collection), or in
   * the gap before or after it (a reorder). None means the row takes none.
   * During a drag only the payload's types can be read, not its data.
   */
  placements: (row: R, dataTransfer: DataTransfer) => readonly DropPlacement[];
  onDrop: (row: R, placement: DropPlacement, dataTransfer: DataTransfer) => void;
};

export type TreeDrag<R> = {
  onDragStart: (row: R, dataTransfer: DataTransfer) => void;
  onDragEnd?: () => void;
};

/** What a caller can ask of the tree from outside: put focus on a row. */
export type TreeViewHandle = {
  /** Focus a row and make it the tab stop; false when it is not shown. */
  focusRow: (key: string) => boolean;
  /** A shown row's element, for a dialog to give focus back to. */
  rowElement: (key: string) => HTMLElement | null;
};

type TreeViewProps<R extends TreeRowBase> = {
  rows: readonly TreeRow<R>[];
  ariaLabel: string;
  selectedKey: string | null;
  /** Set while any branch is loading; the tree carries it as `aria-busy`. */
  busy?: boolean;
  className?: string;
  /** Enter, Space or a click on the row. */
  onActivate: (row: R) => void;
  /** The row's twisty, ArrowRight on a closed row and ArrowLeft on an open one. */
  onExpandedChange: (row: R, expanded: boolean) => void;
  /** What the row shows after its twisty. */
  renderRow: (row: R, state: TreeRowState) => ReactNode;
  rowClassName?: (row: R, state: TreeRowState) => string | false | undefined;
  /**
   * A key on a focused row, before the tree's own keys (F2, Delete, moving
   * the row). Calling `preventDefault` keeps the tree from acting on it.
   */
  onRowKeyDown?: (row: R, event: KeyboardEvent<HTMLDivElement>) => void;
  drop?: TreeDrop<R>;
  drag?: TreeDrag<R>;
  /** A closed row a drag rests on opens after this long, so a deep target can be reached. */
  expandOnDragMs?: number;
  handleRef?: Ref<TreeViewHandle>;
};

const indent = (level: number) => ({ paddingLeft: `${Math.max(4, (level - 1) * 14 + 4)}px` });

const isNote = <R extends TreeRowBase>(row: TreeRow<R>): row is TreeNoteRow => row.kind === 'note';

/** How long typed letters count as one search (the APG's type-ahead). */
const TYPEAHEAD_MS = 500;

/**
 * Where on the row the pointer is: the top or bottom quarter is the gap
 * before or after it, the middle is inside. A row with no height (no layout,
 * as in a test) is its middle.
 */
function placementAt(event: DragEvent<HTMLElement>, allowed: readonly DropPlacement[]): DropPlacement | null {
  if (allowed.length === 0) return null;
  const rect = event.currentTarget.getBoundingClientRect();
  const inside = allowed.includes('inside');
  const before = allowed.includes('before');
  const after = allowed.includes('after');
  if (rect.height <= 0) return inside ? 'inside' : before ? 'before' : 'after';
  const y = (event.clientY - rect.top) / rect.height;
  if (inside) {
    if (before && y < 0.25) return 'before';
    if (after && y > 0.75) return 'after';
    return 'inside';
  }
  if (before && after) return y < 0.5 ? 'before' : 'after';
  return before ? 'before' : 'after';
}

/**
 * An accessible tree (the WAI-ARIA APG navigation tree) over rows its caller
 * has already flattened in display order.
 *
 * One row is a tab stop at a time (roving focus), and the arrow keys, Home,
 * End and type-ahead walk the rows. `note` rows (a branch's loading, error or
 * empty line) are shown in place but hidden from assistive tech, because a
 * tree may own only `treeitem` and `group` elements; the caller announces
 * their text outside the tree.
 *
 * Every drop it takes is one the caller also offers without dragging
 * (WCAG 2.2 SC 2.5.7): the tree only reports where a drag landed.
 */
export function TreeView<R extends TreeRowBase>({
  rows,
  ariaLabel,
  selectedKey,
  busy = false,
  className,
  onActivate,
  onExpandedChange,
  renderRow,
  rowClassName,
  onRowKeyDown,
  drop,
  drag,
  expandOnDragMs = 600,
  handleRef,
}: TreeViewProps<R>) {
  // Only these can hold focus, so they are the ones the arrow keys walk. A
  // row's index in `rows` is not its position in the navigation order.
  const navRows = useMemo(() => rows.filter((row): row is R => !isNote(row)), [rows]);
  const navIndexByKey = useMemo(
    () => new Map(navRows.map((row, index) => [row.key, index])),
    [navRows],
  );

  const [focusState, setFocusState] = useState(() => ({
    activeKey: selectedKey ?? navRows[0]?.key ?? '',
    selectedKey,
  }));
  const [dropAt, setDropAt] = useState<{ key: string; placement: DropPlacement } | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const typeahead = useRef({ text: '', at: -Infinity });
  // A new selection from outside moves the roving tab stop onto it.
  const activeKey =
    focusState.selectedKey === selectedKey
      ? focusState.activeKey
      : (selectedKey ?? focusState.activeKey);
  const setActiveKey = (key: string) => setFocusState({ activeKey: key, selectedKey });

  const tabKey = navIndexByKey.has(activeKey)
    ? activeKey
    : selectedKey && navIndexByKey.has(selectedKey)
      ? selectedKey
      : (navRows[0]?.key ?? '');

  const focusRow = (key: string) => {
    setActiveKey(key);
    queueMicrotask(() => refs.current.get(key)?.focus());
  };

  useImperativeHandle(handleRef, () => ({
    focusRow: (key: string) => {
      if (!navIndexByKey.has(key)) return false;
      focusRow(key);
      return true;
    },
    rowElement: (key: string) => refs.current.get(key) ?? null,
  }));

  // A closed row the drag rests on opens after a pause.
  const expandable = dropAt ? navRows.find((row) => row.key === dropAt.key) : undefined;
  const pendingExpand = expandable?.expandable && !expandable.expanded && dropAt?.placement === 'inside' ? expandable : null;
  const expandUnderDrag = useEffectEvent((row: R) => onExpandedChange(row, true));
  useEffect(() => {
    if (!pendingExpand) return;
    const timer = window.setTimeout(() => expandUnderDrag(pendingExpand), expandOnDragMs);
    return () => window.clearTimeout(timer);
  }, [pendingExpand, expandOnDragMs]);

  const activate = (row: R) => {
    focusRow(row.key);
    if (!row.disabled) onActivate(row);
  };

  /** Focus the next row whose name starts with what was typed, `now` being the key's time. */
  const typeAhead = (character: string, from: R, now: number) => {
    const repeat = now - typeahead.current.at < TYPEAHEAD_MS;
    const text = (repeat ? typeahead.current.text : '') + character.toLowerCase();
    typeahead.current = { text, at: now };
    // The same letter again cycles through the rows that start with it.
    const cycling = text.length > 1 && [...text].every((letter) => letter === text[0]);
    const needle = cycling ? (text[0] as string) : text;
    const start = navIndexByKey.get(from.key) ?? 0;
    const offset = cycling || text.length === 1 ? 1 : 0;
    for (let step = 0; step < navRows.length; step += 1) {
      const candidate = navRows[(start + offset + step) % navRows.length];
      if (candidate && candidate.label.toLowerCase().startsWith(needle)) {
        focusRow(candidate.key);
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: R) => {
    if (event.target !== event.currentTarget) return;
    onRowKeyDown?.(row, event);
    if (event.defaultPrevented) return;
    const index = navIndexByKey.get(row.key) ?? 0;
    const next = navRows[index + 1];
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (next) focusRow(next.key);
        return;
      case 'ArrowUp':
        event.preventDefault();
        { const previous = navRows[index - 1]; if (previous) focusRow(previous.key); }
        return;
      case 'Home':
        event.preventDefault();
        if (navRows[0]) focusRow(navRows[0].key);
        return;
      case 'End': {
        event.preventDefault();
        const last = navRows.at(-1);
        if (last) focusRow(last.key);
        return;
      }
      case 'ArrowRight':
        event.preventDefault();
        if (row.expandable) {
          if (!row.expanded) onExpandedChange(row, true);
          else if (next?.parentKey === row.key) focusRow(next.key);
        }
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (row.expandable && row.expanded) onExpandedChange(row, false);
        else if (row.parentKey) focusRow(row.parentKey);
        return;
      case 'Enter':
      case ' ':
        // A space while typing a name is part of it.
        if (event.key === ' ' && event.timeStamp - typeahead.current.at < TYPEAHEAD_MS) {
          event.preventDefault();
          typeAhead(' ', row, event.timeStamp);
          return;
        }
        event.preventDefault();
        activate(row);
        return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && /\S/.test(event.key)) {
      event.preventDefault();
      typeAhead(event.key, row, event.timeStamp);
    }
  };

  const dropProps = (row: R) => {
    if (!drop || !row.droppable || row.disabled) return {};
    const over = (event: DragEvent<HTMLDivElement>) => {
      if (!drop.accepts(event.dataTransfer)) return null;
      const placement = placementAt(event, drop.placements(row, event.dataTransfer));
      if (!placement) return null;
      event.preventDefault();
      setDropAt((current) => (current?.key === row.key && current.placement === placement ? current : { key: row.key, placement }));
      return placement;
    };
    return {
      onDragEnter: (event: DragEvent<HTMLDivElement>) => { over(event); },
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (over(event)) event.dataTransfer.dropEffect = 'move';
      },
      onDragLeave: (event: DragEvent<HTMLDivElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropAt((current) => (current?.key === row.key ? null : current));
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        const placement = over(event);
        setDropAt(null);
        if (!placement) return;
        event.stopPropagation();
        drop.onDrop(row, placement, event.dataTransfer);
      },
    };
  };

  const dragProps = (row: R) => {
    if (!drag || !row.draggable || row.disabled) return {};
    return {
      draggable: true,
      onDragStart: (event: DragEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
        drag.onDragStart(row, event.dataTransfer);
      },
      onDragEnd: () => {
        setDropAt(null);
        drag.onDragEnd?.();
      },
    };
  };

  const rowRef = (key: string) => (node: HTMLDivElement | null) => {
    if (node) refs.current.set(key, node);
    else refs.current.delete(key);
  };

  return (
    <div role="tree" aria-label={ariaLabel} aria-busy={busy} className={cn('space-y-0.5', className)}>
      {rows.map((row) => {
        if (isNote(row)) {
          return (
            <div
              key={row.key}
              aria-hidden="true"
              style={indent(row.level)}
              className={cn(
                'flex items-center gap-1 py-1 pr-1 text-2xs',
                row.tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {row.tone === 'loading' && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
              <span className="min-w-0 break-words">{row.text}</span>
            </div>
          );
        }

        const selectable = row.selectable !== false;
        const placement = dropAt?.key === row.key ? dropAt.placement : null;
        const state: TreeRowState = {
          selected: selectable && row.key === selectedKey,
          dropTarget: placement !== null,
          dropPlacement: placement,
        };
        return (
          <div
            key={row.key}
            ref={rowRef(row.key)}
            role="treeitem"
            aria-level={row.level}
            aria-posinset={row.position}
            aria-setsize={row.setSize}
            aria-selected={state.selected}
            aria-current={row.current ? 'page' : undefined}
            aria-disabled={row.disabled || undefined}
            {...(row.expandable ? { 'aria-expanded': Boolean(row.expanded) } : {})}
            tabIndex={row.key === tabKey ? 0 : -1}
            style={indent(row.level)}
            data-drop={placement ?? undefined}
            className={cn(
              'group relative flex min-w-0 items-center gap-1 rounded-md border border-transparent py-1 pr-1 outline-none transition-colors',
              'focus-visible:ring-2 focus-visible:ring-ring',
              placement === 'inside' && 'border-primary bg-primary/10 ring-1 ring-primary',
              // The insertion line of a reorder, in the gap the drop would fill.
              placement === 'before' && 'before:pointer-events-none before:absolute before:inset-x-1 before:-top-[2px] before:h-0.5 before:rounded-full before:bg-primary',
              placement === 'after' && 'after:pointer-events-none after:absolute after:inset-x-1 after:-bottom-[2px] after:h-0.5 after:rounded-full after:bg-primary',
              rowClassName?.(row, state),
            )}
            onFocus={(event) => {
              if (event.target === event.currentTarget) setActiveKey(row.key);
            }}
            onClick={(event) => {
              // A row's menu is portaled out of the row, but its clicks still
              // bubble here through React: only a click on the row counts.
              const target = event.target as HTMLElement;
              if (!event.currentTarget.contains(target)) return;
              // A control inside the row (a twisty, a menu, a field) acts on its own.
              if (target === event.currentTarget || !target.closest('button, input, a')) {
                activate(row);
              }
            }}
            onKeyDown={(event) => onKeyDown(event, row)}
            {...dropProps(row)}
            {...dragProps(row)}
          >
            {row.expandable ? (
              <button
                type="button"
                tabIndex={-1}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-sm hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${row.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onExpandedChange(row, !row.expanded);
                }}
              >
                {row.expanded ? (
                  <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                )}
              </button>
            ) : (
              <span className="h-5 w-5 shrink-0" />
            )}
            {renderRow(row, state)}
          </div>
        );
      })}
    </div>
  );
}
