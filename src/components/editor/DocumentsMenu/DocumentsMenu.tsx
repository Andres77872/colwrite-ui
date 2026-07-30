import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import { useEditor } from '@/editor';
import type {
  DocumentListOptions,
  DocumentSortBy,
  DocumentSortOrder,
  DocumentSummary,
} from '@/services';
import { AlertCircle, ChevronLeft, ChevronRight, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react';

const PAGE_SIZE = 10;
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

export function DocumentsMenu() {
  const {
    listRemote,
    switchTo,
    createAndSwitch,
    deleteRemote,
    documentId,
    documentListRevision,
  } = useEditor();
  const confirm = useConfirm();
  const { toast } = useToast();

  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'delete' | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sortBy, setSortBy] = useState<DocumentSortBy>('updated_at');
  const [sortOrder, setSortOrder] = useState<DocumentSortOrder>('desc');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const requestSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(count / PAGE_SIZE)), [count]);
  const sortValue: SortValue = `${sortBy}:${sortOrder}`;

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
        setCount(res.count);
        setListError(null);
      } catch (error) {
        if (controller.signal.aborted || requestId !== requestSequence.current) return;
        // This load is background work, so report it where the missing list
        // would have been instead of interrupting the user with a toast.
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
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchList({
        page,
        limit: PAGE_SIZE,
        query: debouncedQuery || undefined,
        sortBy,
        sortOrder,
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      activeController.current?.abort();
    };
  }, [
    debouncedQuery,
    documentListRevision,
    fetchList,
    page,
    refreshRevision,
    sortBy,
    sortOrder,
  ]);

  const onSortChange = (value: string) => {
    const selected = SORT_OPTIONS.find((option) => option.value === value);
    if (!selected) return;
    setSortBy(selected.sortBy);
    setSortOrder(selected.sortOrder);
    setPage(1);
  };

  const onCreate = async () => {
    setBusy('create');
    try {
      await createAndSwitch({ version: 1, name: 'Untitled document', blocks: [] });
      setPage(1);
      toast({ title: 'Document created', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not create document',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  const onLoad = async (id: string) => {
    if (id === documentId) return;
    try {
      await switchTo(id);
    } catch (error) {
      toast({
        title: 'Could not open document',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    }
  };

  const onDelete = async (doc: DocumentSummary) => {
    const ok = await confirm({
      title: `Delete “${doc.name}”?`,
      description: 'This permanently removes the document and its chats. It cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    setBusy('delete');
    try {
      await deleteRemote(doc.id);
      // Deleting the last item on the final page would otherwise strand the
      // user on a page that no longer exists. The context revision performs
      // the actual refresh after the mutation.
      const nextPage = Math.min(page, Math.max(1, Math.ceil(Math.max(0, count - 1) / PAGE_SIZE)));
      setPage(nextPage);
      toast({ title: 'Document deleted', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not delete document',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  const showSkeleton = loading && items.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Input
          type="search"
          placeholder="Search documents…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search documents"
          className="h-8 flex-1"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setRefreshRevision((revision) => revision + 1)}
          disabled={loading}
          aria-label="Refresh document list"
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      <select
        className="h-8 w-full rounded-md border border-input bg-input px-2 text-xs text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        value={sortValue}
        aria-label="Sort documents"
        onChange={(event) => onSortChange(event.target.value)}
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <Button size="sm" onClick={onCreate} disabled={busy !== null} className="w-full">
        {busy === 'create' ? <Spinner /> : <Plus className="h-3.5 w-3.5" />}
        New document
      </Button>

      <ul className="flex flex-col gap-1" aria-busy={loading}>
        {showSkeleton &&
          Array.from({ length: 4 }).map((_, index) => (
            <li key={index} className="px-2 py-2">
              <Skeleton className="h-3.5 w-3/4" />
            </li>
          ))}

        {!showSkeleton &&
          items.map((doc) => {
            const isActive = documentId === doc.id;
            const updatedLabel = formatDateTime(doc.updatedAt);
            return (
              <li key={doc.id}>
                <div
                  className={cn(
                    'group flex items-center gap-1 rounded-lg border border-transparent transition-colors',
                    isActive ? 'border-border bg-primary/10' : 'hover:bg-accent',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onLoad(doc.id)}
                    aria-current={isActive ? 'true' : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left"
                  >
                    <FileText
                      aria-hidden="true"
                      className={cn(
                        'h-3.5 w-3.5 flex-shrink-0',
                        isActive ? 'text-primary' : 'text-muted-foreground',
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{doc.name}</span>
                      <time
                        dateTime={doc.updatedAt || undefined}
                        className="block truncate text-2xs text-muted-foreground"
                      >
                        Updated {updatedLabel || '—'}
                      </time>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      'mr-1 flex-shrink-0 text-muted-foreground transition-opacity hover:bg-destructive/10 hover:text-destructive',
                      // Keep the control reachable by keyboard even while hidden on hover-capable devices.
                      'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
                    )}
                    onClick={() => onDelete(doc)}
                    disabled={busy !== null}
                    aria-label={`Delete ${doc.name}`}
                    title="Delete document"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
      </ul>

      {!loading && listError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-center"
        >
          <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-destructive">
            <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
            Could not load documents
          </p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{listError}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setRefreshRevision((revision) => revision + 1)}
          >
            Retry
          </Button>
        </div>
      )}

      {!loading && !listError && items.length === 0 && (
        <EmptyState
          icon={FileText}
          title={debouncedQuery ? 'No matches' : 'No documents yet'}
          description={
            debouncedQuery
              ? `Nothing matches “${debouncedQuery}”.`
              : 'Create one to start writing.'
          }
        />
      )}

      {totalPages > 1 && (
        <div className="mt-1 flex items-center justify-between border-t border-border/50 pt-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
            disabled={page <= 1 || loading}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-2xs tabular-nums text-muted-foreground">
            Page {page} of {totalPages} · {count} total
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
            disabled={page >= totalPages || loading}
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
