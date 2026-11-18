import { useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { FileText, Folder, FolderOpen, FolderRoot, Inbox, Loader2, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/api/errors';
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
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { InlineError } from '@/components/ui/inline-error';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TreeView, type TreeRow, type TreeRowBase } from '@/components/ui/tree';
import { useWorkspaceTree, type WorkspaceTree } from '@/components/layout/Sidebar/PagesTree/useWorkspaceTree';
import { USE_ON_THIS_PAGE_HINT } from '@/components/panels/Library/collectionAttachment';
import type { ResourceLocation } from '@/data/resources';
import { SEARCH_CAP, useCollectionIndex } from './collectionIndex';

/** What is being moved, and where it is now; or the collection a page should read ("grant"). */
export type MoveSubject =
  | { kind: 'page'; name: string; collectionId: number | null }
  | { kind: 'collection'; name: string; collectionId: number; parentId: number | null }
  | { kind: 'pdf'; name: string; location: ResourceLocation; pageId: string | null }
  | { kind: 'grant' };

/** Where it goes: the top level, a collection, Unfiled or the open page (PDFs). */
export type MoveDestination =
  | { kind: 'root' }
  | { kind: 'collection'; collectionId: number; name: string }
  | { kind: 'unfiled' }
  | { kind: 'page' };

type Option = { key: string; label: string; icon: typeof Inbox; destination: MoveDestination };

const ALREADY_HERE = 'Already here';

const keyOf = (destination: MoveDestination | null) =>
  !destination ? null : destination.kind === 'collection' ? `collection:${destination.collectionId}` : destination.kind;

/** The collection a subject is in now, which is not a destination. */
function homeOf(subject: MoveSubject): string | null {
  switch (subject.kind) {
    case 'page': return subject.collectionId === null ? 'root' : `collection:${subject.collectionId}`;
    case 'collection': return subject.parentId === null ? 'root' : `collection:${subject.parentId}`;
    case 'pdf':
      if (subject.location.kind === 'collection') return `collection:${subject.location.collection_id}`;
      if (subject.location.kind === 'document') return subject.location.document_id === subject.pageId ? 'page' : null;
      return 'unfiled';
    case 'grant': return null;
  }
}

/**
 * The collection being moved and every loaded collection inside it: moving a
 * collection into itself or below itself is impossible, so it is not offered.
 */
function subtreeIds(tree: WorkspaceTree, rootId: number): ReadonlySet<number> {
  const ids = new Set<number>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const child of tree.branch(current)?.collections ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

const COPY: Record<MoveSubject['kind'], { title: (name: string) => string; description: string; confirm: string }> = {
  page: {
    title: (name) => `Move ${name}`,
    description: 'Choose a collection, or the top level.',
    confirm: 'Move here',
  },
  collection: {
    title: (name) => `Move ${name}`,
    description: 'Choose the collection to move this into. The collections inside it are not available.',
    confirm: 'Move here',
  },
  pdf: {
    title: (name) => `Move ${name}`,
    description: 'Choose a collection, Unfiled, or this page.',
    confirm: 'Move here',
  },
  grant: {
    title: () => 'Use PDFs from a collection',
    description: USE_ON_THIS_PAGE_HINT,
    confirm: 'Use on this page',
  },
};

const optionClass = (selected: boolean, disabled: boolean) =>
  cn(
    'flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors',
    selected ? 'border-primary bg-primary/10' : 'border-border',
    disabled ? 'cursor-not-allowed opacity-50' : !selected && 'hover:bg-accent',
  );

/**
 * "Move to…": the one picker for where a page, a collection or a PDF goes,
 * and for the collection a page should use the PDFs of.
 *
 * The destinations are the top level (or, for a PDF, Unfiled and this page)
 * and the workspace's collections, as a tree read a branch at a time. The
 * current home is shown as "Already here" and cannot be chosen; a collection
 * cannot go into itself or a collection inside it. A search filters the
 * collections by their path. This is the single-pointer alternative to every
 * drag (WCAG 2.2 SC 2.5.7).
 */
export function MoveToDialog({
  open,
  subject,
  onOpenChange,
  onChoose,
  returnFocusRef,
}: {
  open: boolean;
  subject: MoveSubject;
  onOpenChange: (open: boolean) => void;
  /** Resolves once the move is done (the action reports its own failure); a throw is shown here. */
  onChoose: (destination: MoveDestination) => Promise<unknown>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const tree = useWorkspaceTree({ pages: false });
  const [destination, setDestination] = useState<MoveDestination | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const groupRef = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const copy = COPY[subject.kind];
  const home = homeOf(subject);
  const name = subject.kind === 'grant' ? '' : subject.name;
  const searching = term.trim() !== '';
  const index = useCollectionIndex(open && searching);

  const disabledIds = useMemo(() => {
    const ids = new Set<number>(subject.kind === 'collection' ? subtreeIds(tree, subject.collectionId) : []);
    if (home?.startsWith('collection:')) ids.add(Number(home.slice('collection:'.length)));
    return ids;
  }, [home, subject, tree]);
  const isDisabled = (candidate: MoveDestination) =>
    keyOf(candidate) === home || (candidate.kind === 'collection' && disabledIds.has(candidate.collectionId));

  const options: Option[] = subject.kind === 'pdf'
    ? [
        { key: 'unfiled', label: 'Unfiled', icon: Inbox, destination: { kind: 'unfiled' } },
        { key: 'page', label: 'This page', icon: FileText, destination: { kind: 'page' } },
      ]
    : subject.kind === 'grant'
      ? []
      : [{ key: 'root', label: 'Top level', icon: FolderRoot, destination: { kind: 'root' } }];

  const choose = (next: MoveDestination) => {
    if (isDisabled(next)) return;
    setDestination(next);
    setError(null);
  };

  const confirm = async () => {
    if (!destination || moving) return;
    setMoving(true);
    setError(null);
    try {
      await onChoose(destination);
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught, subject.kind === 'grant' ? 'Could not use that collection' : `Could not move ${name}`));
      setMoving(false);
    }
  };

  // A radiogroup is a single tab stop whose members are reached with the arrow keys.
  const enabledOptions = options.filter((option) => !isDisabled(option.destination));
  const focusOption = (at: number) => {
    const next = enabledOptions[(at + enabledOptions.length) % enabledOptions.length];
    if (!next) return;
    choose(next.destination);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-option="${next.key}"]`)?.focus();
  };
  const onGroupKeyDown = (event: KeyboardEvent<HTMLElement>, option: Option) => {
    const at = enabledOptions.indexOf(option);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); focusOption(at + 1); }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); focusOption(at - 1); }
  };
  const selectedKey = keyOf(destination);
  const tabOption = enabledOptions.find((option) => option.key === selectedKey) ?? enabledOptions[0];

  const needle = term.trim().toLowerCase();
  const matches = searching
    ? (index.data?.items ?? []).filter((item) => item.path.join(' › ').toLowerCase().includes(needle)).slice(0, 50)
    : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !moving && onOpenChange(next)}>
      <DialogContent
        className="max-w-md"
        showCloseButton={!moving}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="break-words">{copy.title(name)}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-2">
          {options.length > 0 && (
            <div ref={groupRef} role="radiogroup" aria-label="Move destination" className="space-y-1">
              {options.map((option) => {
                const Icon = option.icon;
                const selected = selectedKey === option.key;
                const disabled = isDisabled(option.destination);
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="radio"
                    data-option={option.key}
                    aria-checked={selected}
                    aria-disabled={disabled || undefined}
                    tabIndex={option === tabOption ? 0 : -1}
                    className={optionClass(selected, disabled)}
                    onClick={() => choose(option.destination)}
                    onKeyDown={(event) => onGroupKeyDown(event, option)}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                    <span className="min-w-0 flex-1">{option.label}</span>
                    {disabled && <span className="text-2xs text-muted-foreground">{ALREADY_HERE}</span>}
                  </button>
                );
              })}
            </div>
          )}

          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchId}
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Find a collection…"
              aria-label="Find a collection by its path"
              className="h-8 pl-8 text-sm"
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-border p-1.5">
            {searching ? (
              <SearchResults
                loading={index.isFetching && !index.data}
                failed={index.isError}
                matches={matches}
                incomplete={index.data ? !index.data.complete : false}
                selectedId={destination?.kind === 'collection' ? destination.collectionId : null}
                isDisabled={(id) => disabledIds.has(id)}
                home={home}
                onChoose={(item) => choose({ kind: 'collection', collectionId: item.id, name: item.name })}
              />
            ) : (
              <>
                <p className="px-2 pb-1 pt-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Collections
                </p>
                <DestinationTree
                  tree={tree}
                  selected={destination?.kind === 'collection' ? destination.collectionId : null}
                  disabledIds={disabledIds}
                  home={home}
                  ariaLabel={subject.kind === 'grant' ? 'Choose a collection' : 'Choose a destination collection'}
                  onSelect={(id, label) => choose({ kind: 'collection', collectionId: id, name: label })}
                />
              </>
            )}
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
        </div>

        <DialogFooter className="mt-5">
          <Button type="button" variant="outline" disabled={moving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!destination || moving} onClick={() => void confirm()}>
            {moving && <Spinner />}
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SearchResults({
  loading,
  failed,
  matches,
  incomplete,
  selectedId,
  isDisabled,
  home,
  onChoose,
}: {
  loading: boolean;
  failed: boolean;
  matches: Array<{ id: number; name: string; path: string[] }>;
  incomplete: boolean;
  selectedId: number | null;
  isDisabled: (id: number) => boolean;
  home: string | null;
  onChoose: (item: { id: number; name: string }) => void;
}) {
  if (loading) return <ListSkeleton dense rows={3} />;
  if (failed) return <InlineError title="Could not search the collections" />;
  if (matches.length === 0) return <EmptyState size="inline" title="No collection matches" />;
  return (
    <div role="radiogroup" aria-label="Matching collections" className="space-y-0.5">
      {matches.map((item) => {
        const disabled = isDisabled(item.id);
        const selected = selectedId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled || undefined}
            className={cn(
              'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
              selected ? 'bg-accent text-accent-foreground' : !disabled && 'hover:bg-accent/60',
              disabled && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => !disabled && onChoose(item)}
          >
            <Folder aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{item.name}</span>
              {item.path.length > 1 && (
                <span className="block truncate text-2xs text-muted-foreground">{item.path.slice(0, -1).join(' › ')}</span>
              )}
            </span>
            {home === `collection:${item.id}` && <span className="text-2xs text-muted-foreground">{ALREADY_HERE}</span>}
          </button>
        );
      })}
      {incomplete && <p className="px-2 py-1 text-2xs text-muted-foreground">Only the first {SEARCH_CAP.toLocaleString()} collections are searched.</p>}
    </div>
  );
}

/** The rows of the destination tree. "Show more" is a row, one arrow key away in a widget with one tab stop. */
type DestinationRow = TreeRowBase &
  (
    | { kind: 'collection'; id: number }
    | { kind: 'more'; parentId: number | null; loading: boolean }
  );

/** The collections as an accessible tree, for choosing where something goes. */
export function DestinationTree({
  tree,
  selected,
  disabledIds,
  home,
  ariaLabel,
  onSelect,
}: {
  tree: Pick<WorkspaceTree, 'branch' | 'findCollection' | 'isExpanded' | 'setExpanded' | 'loadMore'>;
  selected: number | null;
  disabledIds: ReadonlySet<number>;
  home: string | null;
  ariaLabel: string;
  onSelect: (collectionId: number, name: string) => void;
}) {
  const { rows, errors, busy } = useMemo(() => {
    const flattened: TreeRow<DestinationRow>[] = [];
    const collected: string[] = [];
    let loading = false;
    const push = (parentId: number | null, level: number, parentKey: string | null) => {
      const branch = tree.branch(parentId);
      const items = branch?.collections ?? [];
      const showMore = Boolean(branch?.loaded && branch.moreCollections);
      const setSize = items.length + (showMore ? 1 : 0);
      items.forEach((item, index) => {
        const key = String(item.id);
        const expanded = tree.isExpanded(item.id);
        flattened.push({
          kind: 'collection', id: item.id, key, label: item.name, level, parentKey,
          position: index + 1, setSize, expandable: item.child_collection_count > 0, expanded,
          disabled: disabledIds.has(item.id),
        });
        if (expanded) push(item.id, level + 1, key);
      });
      if (branch?.loading && !branch.loaded) {
        loading = true;
        flattened.push({ kind: 'note', tone: 'loading', text: 'Loading collections…', key: `loading:${parentId ?? 'root'}`, level: level + 1 });
      }
      if (branch?.error) {
        collected.push(branch.error);
        flattened.push({ kind: 'note', tone: 'error', text: branch.error, key: `error:${parentId ?? 'root'}`, level: level + 1 });
      }
      if (showMore) {
        const loadingMore = branch?.loadingMore === 'collections';
        flattened.push({
          kind: 'more', parentId, loading: loadingMore, key: `more:${parentId ?? 'root'}`, label: 'Show more collections',
          level, parentKey, position: setSize, setSize, selectable: false, disabled: loadingMore,
        });
      }
    };
    push(null, 1, null);
    return { rows: flattened, errors: collected, busy: loading };
  }, [disabledIds, tree]);

  const root = tree.branch(null);
  const hasRows = rows.some((row) => row.kind !== 'note');
  const nameOf = (id: number) => tree.findCollection(id)?.name ?? '';

  return (
    <div className="min-h-0">
      <TreeView
        rows={rows}
        ariaLabel={ariaLabel}
        selectedKey={selected === null ? null : String(selected)}
        busy={busy}
        onActivate={(row) => {
          if (row.kind === 'more') void tree.loadMore(row.parentId, 'collections');
          else onSelect(row.id, nameOf(row.id));
        }}
        onExpandedChange={(row, expanded) => {
          if (row.kind === 'collection') tree.setExpanded(row.id, expanded);
        }}
        rowClassName={(row, state) =>
          row.kind === 'more'
            ? 'text-2xs font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            : cn(
                'text-xs',
                state.selected && 'bg-accent text-accent-foreground',
                !state.selected && !row.disabled && 'hover:bg-accent/60',
                row.disabled && 'opacity-40',
              )
        }
        renderRow={(row) => {
          if (row.kind === 'more') {
            return (
              <>
                {row.loading ? (
                  <Loader2 aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin" />
                ) : (
                  <Plus aria-hidden="true" className="h-3 w-3 shrink-0" />
                )}
                {row.loading ? 'Loading…' : 'Show more collections'}
              </>
            );
          }
          const Icon = row.expanded ? FolderOpen : Folder;
          return (
            <>
              <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
              {home === `collection:${row.id}` && <span className="shrink-0 text-2xs text-muted-foreground">{ALREADY_HERE}</span>}
            </>
          );
        }}
      />
      {!hasRows && root?.loading && (
        <div role="status">
          <span className="sr-only">Loading collections…</span>
          <ListSkeleton dense rows={3} />
        </div>
      )}
      {!hasRows && root?.loaded && !root.loading && (
        <EmptyState size="inline" title="No collections yet" description="Create one from the sidebar to group pages and PDFs." />
      )}
      {/* Outside the tree, so branch errors are announced without making the
          tree own an element it is not allowed to own. */}
      {errors[0] !== undefined && <InlineError title={errors[0]} />}
    </div>
  );
}
