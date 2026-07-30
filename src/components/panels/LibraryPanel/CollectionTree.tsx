import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  GripVertical,
  Inbox,
  Loader2,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CollectionItem } from '@/services/resources';
import type { CollectionTreeController } from './useCollectionTree';
import { CollectionAttachmentLabel } from './CollectionAttachmentLabel';
import {
  hasInternalLibraryDrag,
  readLibraryDragPayload,
  setLibraryDragPayload,
  type LibraryDragPayload,
} from './collectionDnd';

const UNFILED_KEY = 'unfiled';

const branchKey = (collectionId: number | null) =>
  collectionId === null ? 'root' : String(collectionId);

/**
 * A rendered line in the tree.
 *
 * `note` rows are the reason this is a union rather than a list of collections.
 * A tree may only own `treeitem` and `group` elements, so the per-branch
 * "Loading folders…" and error lines cannot be `role="status"` / `role="alert"`
 * elements sitting inside it — that is a real violation, not a technicality,
 * and it used to make the whole tree fail validation. They render `aria-hidden`
 * instead: sighted users still see them in place, `aria-busy` on the tree
 * carries the loading state, and the one `role="alert"` below the tree carries
 * the error text.
 *
 * `more` rows are the other half: pagination used to be a `<Button>` inside the
 * tree, which was both non-conforming and an extra tab stop in a widget that is
 * meant to have exactly one. As a `treeitem` it is reachable with the same
 * arrow keys as everything else.
 */
type TreeRow = {
  key: string;
  level: number;
  parentKey: string | null;
  /** Only meaningful for focusable rows; `note` rows are not in the a11y tree. */
  position: number;
  setSize: number;
} & (
  | { kind: 'unfiled' }
  | {
      kind: 'collection';
      item: CollectionItem;
      inheritedFromAncestor: boolean;
      disabled: boolean;
    }
  | { kind: 'more'; branchId: number | null; loading: boolean }
  | { kind: 'note'; tone: 'loading' | 'error'; text: string }
);

export type CollectionTreeSelection = number | 'unfiled' | null;

export function CollectionTree({
  controller,
  selected,
  onSelectCollection,
  onSelectUnfiled,
  onDrop,
  showUnfiled = true,
  draggable = true,
  disabledIds,
  className,
  ariaLabel = 'Folder tree',
}: {
  controller: CollectionTreeController;
  selected: CollectionTreeSelection;
  onSelectCollection: (collectionId: number) => void;
  onSelectUnfiled?: () => void;
  onDrop?: (payload: LibraryDragPayload, targetCollectionId: number | null) => void | Promise<void>;
  showUnfiled?: boolean;
  draggable?: boolean;
  /**
   * Folders that cannot be chosen — the destination picker passes the folder
   * being moved and its descendants, so an impossible move is never offered.
   */
  disabledIds?: ReadonlySet<number>;
  className?: string;
  ariaLabel?: string;
}) {
  const { rows, errors, busy } = useMemo(() => {
    const flattened: TreeRow[] = [];
    const collected: string[] = [];
    let loading = false;

    const pushBranch = (
      items: CollectionItem[],
      level: number,
      parentKey: string | null,
      branchId: number | null,
      inheritedFromAncestor: boolean,
      withUnfiled = false,
    ) => {
      const branch = controller.branches[branchKey(branchId)];
      const showMore = Boolean(branch && branch.nextOffset !== null && branch.loaded);
      const setSize = (withUnfiled ? 1 : 0) + items.length + (showMore ? 1 : 0);
      let position = 0;

      if (withUnfiled) {
        flattened.push({
          kind: 'unfiled',
          key: UNFILED_KEY,
          level,
          parentKey,
          position: ++position,
          setSize,
        });
      }

      for (const item of items) {
        const key = String(item.id);
        flattened.push({
          kind: 'collection',
          key,
          item,
          level,
          parentKey,
          position: ++position,
          setSize,
          inheritedFromAncestor,
          disabled: disabledIds?.has(item.id) ?? false,
        });
        if (controller.expandedIds.has(item.id)) {
          pushBranch(
            controller.childrenOf(item.id),
            level + 1,
            key,
            item.id,
            inheritedFromAncestor || Boolean(item.attachment?.direct),
          );
        }
      }

      if (branch?.loading) {
        loading = true;
        flattened.push({
          kind: 'note',
          tone: 'loading',
          text: 'Loading folders…',
          key: `loading:${branchKey(branchId)}`,
          level: level + 1,
          parentKey,
          position: 0,
          setSize: 0,
        });
      }
      if (branch?.error) {
        collected.push(branch.error);
        flattened.push({
          kind: 'note',
          tone: 'error',
          text: branch.error,
          key: `error:${branchKey(branchId)}`,
          level: level + 1,
          parentKey,
          position: 0,
          setSize: 0,
        });
      }
      if (showMore) {
        flattened.push({
          kind: 'more',
          branchId,
          loading: Boolean(branch?.loadingMore),
          key: `more:${branchKey(branchId)}`,
          level,
          parentKey,
          position: position + 1,
          setSize,
        });
      }
    };

    pushBranch(controller.roots, 1, null, null, false, showUnfiled);
    return { rows: flattened, errors: collected, busy: loading };
  }, [controller, disabledIds, showUnfiled]);

  // Only these can hold focus, so they are the ones the arrow keys walk. The
  // index map exists because notes are interleaved with focusable rows, so a
  // row's position in `rows` is not its position in the navigation order.
  const navRows = useMemo(() => rows.filter((row) => row.kind !== 'note'), [rows]);
  const navIndexByKey = useMemo(
    () => new Map(navRows.map((row, index) => [row.key, index])),
    [navRows],
  );

  const selectedKey =
    selected === 'unfiled' ? UNFILED_KEY : selected === null ? null : String(selected);
  const [focusState, setFocusState] = useState(() => ({
    activeKey: selectedKey ?? UNFILED_KEY,
    selectedKey,
  }));
  const [dropKey, setDropKey] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const activeKey =
    focusState.selectedKey === selectedKey
      ? focusState.activeKey
      : (selectedKey ?? focusState.activeKey);
  const setActiveKey = (key: string) => setFocusState({ activeKey: key, selectedKey });

  const tabKey = navRows.some((row) => row.key === activeKey)
    ? activeKey
    : selectedKey && navRows.some((row) => row.key === selectedKey)
      ? selectedKey
      : (navRows[0]?.key ?? '');

  const focusRow = (key: string) => {
    setActiveKey(key);
    queueMicrotask(() => refs.current.get(key)?.focus());
  };

  const activateRow = (row: TreeRow) => {
    focusRow(row.key);
    if (row.kind === 'more') {
      void controller.loadMore(row.branchId);
      return;
    }
    if (row.kind === 'unfiled') {
      onSelectUnfiled?.();
      return;
    }
    if (row.kind === 'collection' && !row.disabled) onSelectCollection(row.item.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: TreeRow, index: number) => {
    if (event.target !== event.currentTarget) return;
    const item = row.kind === 'collection' ? row.item : null;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (navRows[index + 1]) focusRow(navRows[index + 1].key);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (navRows[index - 1]) focusRow(navRows[index - 1].key);
        break;
      case 'Home':
        event.preventDefault();
        if (navRows[0]) focusRow(navRows[0].key);
        break;
      case 'End':
        event.preventDefault();
        if (navRows.at(-1)) focusRow(navRows.at(-1)?.key ?? '');
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (item && item.child_count > 0) {
          if (!controller.expandedIds.has(item.id)) void controller.setExpanded(item.id, true);
          else if (navRows[index + 1]?.parentKey === row.key) focusRow(navRows[index + 1].key);
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (item && controller.expandedIds.has(item.id)) {
          void controller.setExpanded(item.id, false);
        } else if (row.parentKey) {
          focusRow(row.parentKey);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activateRow(row);
        break;
    }
  };

  const dropProps = (targetId: number | null, key: string) => ({
    onDragEnter: (event: DragEvent<HTMLDivElement>) => {
      if (!onDrop || !hasInternalLibraryDrag(event.dataTransfer)) return;
      event.preventDefault();
      setDropKey(key);
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!onDrop || !hasInternalLibraryDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropKey(key);
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setDropKey((current) => (current === key ? null : current));
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      if (!onDrop || !hasInternalLibraryDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      setDropKey(null);
      const payload = readLibraryDragPayload(event.dataTransfer);
      if (payload) void onDrop(payload, targetId);
    },
  });

  const rowRef = (key: string) => (node: HTMLDivElement | null) => {
    if (node) refs.current.set(key, node);
    else refs.current.delete(key);
  };

  const indent = (level: number) => ({ paddingLeft: `${Math.max(4, (level - 1) * 14 + 4)}px` });

  const rootBranch = controller.branches.root;
  const isEmpty = navRows.length === 0 && Boolean(rootBranch?.loaded) && !rootBranch?.loading;

  return (
    <div className={cn('min-h-0', className)}>
      <div role="tree" aria-label={ariaLabel} aria-busy={busy} className="space-y-0.5">
        {rows.map((row) => {
          if (row.kind === 'note') {
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

          const index = navIndexByKey.get(row.key) ?? 0;
          const isSelected = row.key === selectedKey;
          const disabled = row.kind === 'collection' && row.disabled;

          if (row.kind === 'more') {
            return (
              <div
                key={row.key}
                ref={rowRef(row.key)}
                role="treeitem"
                aria-level={row.level}
                aria-posinset={row.position}
                aria-setsize={row.setSize}
                aria-selected={false}
                aria-disabled={row.loading || undefined}
                tabIndex={row.key === tabKey ? 0 : -1}
                style={indent(row.level)}
                className={cn(
                  'flex min-w-0 items-center gap-1 rounded-md py-1 pr-1 text-2xs font-medium text-muted-foreground outline-none transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-ring hover:bg-accent/60 hover:text-foreground',
                )}
                onFocus={() => setActiveKey(row.key)}
                onClick={() => activateRow(row)}
                onKeyDown={(event) => onKeyDown(event, row, index)}
              >
                <span className="h-5 w-5 shrink-0" />
                {row.loading ? (
                  <Loader2 aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin" />
                ) : (
                  <Plus aria-hidden="true" className="h-3 w-3 shrink-0" />
                )}
                {row.loading ? 'Loading…' : 'Show more folders'}
              </div>
            );
          }

          const item = row.kind === 'collection' ? row.item : null;
          const expanded = item ? controller.expandedIds.has(item.id) : false;
          const expandable = item ? Boolean(item.child_count) : false;
          const Icon = item ? (expanded ? FolderOpen : Folder) : Inbox;

          return (
            <div
              key={row.key}
              ref={rowRef(row.key)}
              role="treeitem"
              aria-level={row.level}
              aria-posinset={row.position}
              aria-setsize={row.setSize}
              aria-selected={isSelected}
              aria-disabled={disabled || undefined}
              {...(expandable ? { 'aria-expanded': expanded } : {})}
              tabIndex={row.key === tabKey ? 0 : -1}
              className={cn(
                'group flex min-w-0 items-center gap-1 rounded-md border border-transparent py-1 pr-1 text-xs outline-none transition-colors',
                'focus-visible:ring-2 focus-visible:ring-ring',
                isSelected && 'bg-accent text-accent-foreground',
                !isSelected && !disabled && 'hover:bg-accent/60',
                disabled && 'opacity-40',
                dropKey === row.key && 'border-primary bg-primary/10 ring-1 ring-primary',
              )}
              style={indent(row.level)}
              onFocus={() => setActiveKey(row.key)}
              onClick={(event) => {
                if (
                  event.target === event.currentTarget ||
                  !(event.target as HTMLElement).closest('button')
                ) {
                  activateRow(row);
                }
              }}
              onKeyDown={(event) => onKeyDown(event, row, index)}
              {...(disabled ? {} : dropProps(item?.id ?? null, row.key))}
            >
              {item && expandable ? (
                <button
                  type="button"
                  tabIndex={-1}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-sm hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void controller.toggleExpanded(item.id);
                  }}
                >
                  {expanded ? (
                    <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="h-5 w-5 shrink-0" />
              )}
              <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {item?.name ?? 'Unfiled'}
              </span>
              {item && (
                <CollectionAttachmentLabel
                  attachment={item.attachment}
                  inheritedFromAncestor={row.kind === 'collection' && row.inheritedFromAncestor}
                  compact
                />
              )}
              {item && draggable && !disabled && (
                <span
                  // Dragging is a pointer affordance with a keyboard equivalent
                  // elsewhere (the folder's actions menu → Move to folder), so
                  // the handle is hidden from assistive tech rather than
                  // offered as a control that does nothing on Enter.
                  aria-hidden="true"
                  draggable
                  className="grid h-6 w-5 shrink-0 cursor-grab place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-background/70 group-hover:opacity-100 group-focus-within:opacity-100 active:cursor-grabbing"
                  onClick={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    setLibraryDragPayload(event.dataTransfer, {
                      kind: 'collection',
                      id: item.id,
                    });
                  }}
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          );
        })}
      </div>

      {navRows.length === 0 && rootBranch?.loading && (
        <p className="flex items-center gap-1 py-2 text-xs text-muted-foreground" role="status">
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          Loading folders…
        </p>
      )}

      {isEmpty && (
        <p className="py-2 text-2xs text-muted-foreground">
          No folders yet. Create one to group the PDFs you are writing against.
        </p>
      )}

      {/* Outside the tree, so branch errors are announced without making the
          tree own an element it is not allowed to own. */}
      {errors.length > 0 && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {errors[0]}
        </p>
      )}
    </div>
  );
}
