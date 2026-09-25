import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { displayTitle, isUntitledName } from '@/components/layout/displayTitle';
import { editedLabel, shortDateTime } from '@/components/layout/editedLabel';
import { rememberDocumentSummaries } from '@/components/layout/documentSummaryCache';
import { Skeleton, Spinner } from '@/components/ui/spinner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import { useEditor } from '@/editor';
import { useNewDocument } from '@/components/layout/useNewDocument';
import {
  sidebarHoverAction,
  sidebarRow,
  sidebarRowActive,
} from '@/components/layout/Sidebar/sidebarStyles';
import type {
  DocumentListOptions,
  DocumentSortBy,
  DocumentSortOrder,
  DocumentSummary,
} from '@/services';
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Link2,
  ListFilter,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';

const PAGE_SIZE = 10;
/** The API's largest page; "Load more" stops here and the filter takes over. */
const MAX_LIMIT = 100;
/** Below this many documents a filter field is clutter, not help. */
const FILTER_THRESHOLD = 8;
const SEARCH_DEBOUNCE_MS = 350;

type SortValue = `${DocumentSortBy}:${DocumentSortOrder}`;

const SORT_OPTIONS: {
  value: SortValue;
  label: string;
  sortBy: DocumentSortBy;
  sortOrder: DocumentSortOrder;
}[] = [
  { value: 'updated_at:desc', label: 'Last updated — newest', sortBy: 'updated_at', sortOrder: 'desc' },
  { value: 'updated_at:asc', label: 'Last updated — oldest', sortBy: 'updated_at', sortOrder: 'asc' },
  { value: 'created_at:desc', label: 'Date created — newest', sortBy: 'created_at', sortOrder: 'desc' },
  { value: 'created_at:asc', label: 'Date created — oldest', sortBy: 'created_at', sortOrder: 'asc' },
  { value: 'name:asc', label: 'Title — A–Z', sortBy: 'name', sortOrder: 'asc' },
  { value: 'name:desc', label: 'Title — Z–A', sortBy: 'name', sortOrder: 'desc' },
];

function documentLink(id: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('doc', id);
  return url.toString();
}

/**
 * The sidebar's "Documents" section: a section label, one quiet row per
 * document and a "Load more" row.
 *
 * It used to be a form — a search box, a refresh button, a native sort
 * select, a full-width primary button and 50px rows repeating a timestamp to
 * the second. Sorting, refreshing and filtering now live in the section's
 * hover menu, each row's actions in its own "…" menu, and the update time in
 * the row's tooltip.
 */
export function DocumentsMenu({
  onDocumentCommitted,
}: {
  onDocumentCommitted?: () => void;
} = {}) {
  const {
    listRemote,
    switchTo,
    deleteRemote,
    documentId,
    loadingDocumentId,
    documentListRevision,
  } = useEditor();
  const confirm = useConfirm();
  const { toast } = useToast();
  const newDocument = useNewDocument();
  const headingId = useId();
  const filterRef = useRef<HTMLInputElement | null>(null);
  // Set while "Filter documents" closes its menu: the menu would otherwise
  // hand focus back to its trigger and swallow what the author types next.
  const pendingFilterFocus = useRef(false);

  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [count, setCount] = useState(0);
  // Pages loaded so far. Refetches ask for all of them at once, so a save
  // elsewhere (which bumps the list revision) never collapses the list the
  // author has scrolled through.
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState<DocumentSortBy>('updated_at');
  const [sortOrder, setSortOrder] = useState<DocumentSortOrder>('desc');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const requestSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  const sortValue: SortValue = `${sortBy}:${sortOrder}`;
  const limit = Math.min(MAX_LIMIT, pages * PAGE_SIZE);
  const hasMore = items.length < count && limit < MAX_LIMIT;

  const fetchList = useCallback(
    async (options: DocumentListOptions) => {
      activeController.current?.abort();
      const controller = new AbortController();
      activeController.current = controller;
      const requestId = ++requestSequence.current;
      setLoading(true);

      try {
        const res = await listRemote(options, { signal: controller.signal });
        if (controller.signal.aborted || requestId !== requestSequence.current) return;
        setItems(res.documents);
        rememberDocumentSummaries(res.documents);
        setCount(res.count);
        setListError(null);
        // Once the list is long enough to need a filter, keep offering it —
        // it must not vanish under the caret while the query narrows the list.
        if (!options.query && res.count > FILTER_THRESHOLD) setFilterOpen(true);
      } catch (error) {
        if (controller.signal.aborted || requestId !== requestSequence.current) return;
        // Background work: report it where the list would have been instead
        // of interrupting with a toast.
        setListError(error instanceof Error ? error.message : 'Request failed');
        setItems([]);
        setCount(0);
      } finally {
        if (!controller.signal.aborted && requestId === requestSequence.current) {
          setLoading(false);
        }
      }
    },
    [listRemote],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPages(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchList({
        page: 1,
        limit,
        query: debouncedQuery || undefined,
        sortBy,
        sortOrder,
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      activeController.current?.abort();
    };
  }, [debouncedQuery, documentListRevision, fetchList, limit, refreshRevision, sortBy, sortOrder]);

  const onSortChange = (value: string) => {
    const selected = SORT_OPTIONS.find((option) => option.value === value);
    if (!selected) return;
    setSortBy(selected.sortBy);
    setSortOrder(selected.sortOrder);
    setPages(1);
  };

  const showFilter = () => {
    setFilterOpen(true);
    // Focused from the menu's close handler, once the field has mounted.
    pendingFilterFocus.current = true;
  };

  const onLoad = async (id: string) => {
    if (id === documentId || id === loadingDocumentId) return;
    try {
      const committed = await switchTo(id);
      if (committed) onDocumentCommitted?.();
    } catch {
      // The editor owns the single load-failure notice and retains this row's
      // committed document and drawer state.
    }
  };

  const onDelete = async (doc: DocumentSummary) => {
    if (loadingDocumentId) return;
    const ok = await confirm({
      title: `Delete “${displayTitle(doc.name)}”?`,
      description: 'This permanently removes the document and its chats. It cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    setDeleting(true);
    try {
      // The context revision performs the refresh after the mutation.
      await deleteRemote(doc.id);
      toast({ title: 'Document deleted', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not delete document',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setDeleting(false);
    }
  };

  const copyLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(documentLink(id));
      toast({ title: 'Link copied', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy the link', variant: 'error' });
    }
  };

  const showSkeleton = loading && items.length === 0;
  const busy = deleting || Boolean(loadingDocumentId);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-px">
      <div className="group/section flex h-7 items-center gap-0.5 rounded-md pl-2 pr-1 hover:bg-hover">
        <h2 id={headingId} className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          Documents
        </h2>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100 has-[[data-state=open]]:opacity-100 pointer-coarse:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger className={sidebarHoverAction} aria-label="Document list options">
              <MoreHorizontal aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-60"
              onCloseAutoFocus={(event) => {
                if (!pendingFilterFocus.current) return;
                pendingFilterFocus.current = false;
                event.preventDefault();
                filterRef.current?.focus();
              }}
            >
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sortValue} onValueChange={onSortChange}>
                {SORT_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value} indicator>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={showFilter}>
                <ListFilter aria-hidden="true" />
                Filter documents
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRefreshRevision((revision) => revision + 1)}>
                <RefreshCw aria-hidden="true" />
                Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            className={sidebarHoverAction}
            onClick={() => void newDocument.createDocument()}
            disabled={newDocument.disabled}
            aria-label="New document"
            title="New document"
          >
            {newDocument.creating ? <Spinner /> : <Plus aria-hidden="true" />}
          </button>
        </div>
      </div>

      {(filterOpen || query) && (
        <input
          ref={filterRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.preventDefault();
              setQuery('');
            }
          }}
          placeholder="Filter documents…"
          aria-label="Search documents"
          className="mb-1 h-7 w-full rounded-md bg-transparent px-2 text-sm text-foreground outline-none transition-colors placeholder:text-placeholder hover:bg-hover focus:bg-subtle focus:ring-2 focus:ring-ring/40 pointer-coarse:h-9"
        />
      )}

      <ul className="flex flex-col gap-px" aria-busy={loading}>
        {showSkeleton &&
          Array.from({ length: 4 }).map((_, index) => (
            <li key={index} className="flex h-[30px] items-center gap-2 px-2">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-3 flex-1" style={{ maxWidth: `${80 - index * 12}%` }} />
            </li>
          ))}

        {!showSkeleton &&
          items.map((doc) => {
            const isActive = documentId === doc.id;
            const isPending = loadingDocumentId === doc.id;
            const name = displayTitle(doc.name);
            const untitled = isUntitledName(doc.name);
            const updated = shortDateTime(doc.updatedAt);
            const edited = editedLabel(doc.updatedAt);
            return (
              <li key={doc.id}>
                <div
                  className={cn(
                    'group/row relative flex items-center rounded-md transition-colors duration-150',
                    isActive ? 'bg-active' : 'hover:bg-hover has-[[data-state=open]]:bg-hover',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onLoad(doc.id)}
                    aria-current={isActive ? 'true' : undefined}
                    title={updated ? `${name}\nEdited ${updated}` : name}
                    className={cn(
                      sidebarRow,
                      // Room for the "…" only while it shows, so titles are
                      // not cut short on every row by an invisible button.
                      'flex-1 hover:bg-transparent group-hover/row:pr-7 group-focus-within/row:pr-7 group-has-[[data-state=open]]/row:pr-7 pointer-coarse:pr-9',
                      isActive && sidebarRowActive,
                      isActive && 'bg-transparent hover:bg-transparent',
                    )}
                  >
                    {isPending ? <Spinner className="size-[18px]" /> : <FileText aria-hidden="true" />}
                    <span className={cn('min-w-0 flex-1 truncate', untitled && 'text-muted-foreground')}>
                      {name}
                    </span>
                    {isPending && <span className="sr-only">Opening…</span>}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn(
                        sidebarHoverAction,
                        'absolute right-1 opacity-0 group-hover/row:opacity-100',
                      )}
                      aria-label={`Actions for ${name}`}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="right" className="w-56">
                      <DropdownMenuItem disabled={isActive || isPending} onSelect={() => void onLoad(doc.id)}>
                        <FileText aria-hidden="true" />
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a href={documentLink(doc.id)} target="_blank" rel="noreferrer">
                          <ExternalLink aria-hidden="true" />
                          Open in new tab
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void copyLink(doc.id)}>
                        <Link2 aria-hidden="true" />
                        Copy link
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive disabled={busy} onSelect={() => void onDelete(doc)}>
                        <Trash2 aria-hidden="true" />
                        Delete
                      </DropdownMenuItem>
                      {edited && (
                        <>
                          <DropdownMenuSeparator />
                          <p className="px-2 py-1 text-xs text-muted-foreground" title={updated}>
                            {edited}
                          </p>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
      </ul>

      {hasMore && !listError && (
        <button
          type="button"
          className={cn(sidebarRow, 'text-muted-foreground')}
          onClick={() => setPages((current) => current + 1)}
          disabled={loading}
        >
          {loading ? <Spinner className="size-[18px]" /> : <ChevronDown aria-hidden="true" />}
          Load more
        </button>
      )}

      {!loading && listError && (
        <div role="alert" className="px-2 py-1.5 text-xs text-muted-foreground">
          <p className="font-medium text-destructive">Could not load documents</p>
          <p className="mt-0.5 break-words">{listError}</p>
          <button
            type="button"
            className="mt-1 font-medium text-link hover:underline"
            onClick={() => setRefreshRevision((revision) => revision + 1)}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !listError && items.length === 0 && (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">
          {debouncedQuery ? `Nothing matches “${debouncedQuery}”` : 'No documents yet'}
        </p>
      )}
    </section>
  );
}
