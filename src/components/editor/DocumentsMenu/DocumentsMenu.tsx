import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import { useEditor } from '@/editor';
import { AlertCircle, ChevronLeft, ChevronRight, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 350;

interface DocumentSummary {
  id: string;
  title: string;
}

/** The list endpoint has returned several id/title shapes over time. */
function normalize(raw: Record<string, unknown>): DocumentSummary | null {
  const id = String(raw._id ?? raw.id ?? raw.document_id ?? '');
  if (!id) return null;
  return { id, title: String(raw.title ?? raw.name ?? '').trim() || 'Untitled document' };
}

export function DocumentsMenu() {
  const { listRemote, switchTo, createRemote, deleteRemote, documentId } = useEditor();
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

  const totalPages = useMemo(() => Math.max(1, Math.ceil(count / PAGE_SIZE)), [count]);

  const fetchList = useCallback(
    async (targetPage: number, search: string) => {
      // Keep effect-driven fetches on the asynchronous side of the boundary;
      // event-driven refreshes still begin in the same microtask.
      await Promise.resolve();
      setLoading(true);
      try {
        const res = await listRemote(targetPage, PAGE_SIZE, search);
        setItems((res.documents ?? []).map(normalize).filter((d): d is DocumentSummary => d !== null));
        setCount(res.count ?? 0);
        setListError(null);
      } catch (error) {
        // Reported in place rather than as a toast: this load is not something
        // the user asked for, so it belongs where the missing list would be.
        // (Previously it was swallowed entirely, leaving an empty list that
        // was indistinguishable from "you have no documents".)
        setListError(error instanceof Error ? error.message : 'Request failed');
        setItems([]);
        setCount(0);
      } finally {
        setLoading(false);
      }
    },
    [listRemote],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchList(page, debouncedQuery);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchList, page, debouncedQuery]);

  const onCreate = async () => {
    setBusy('create');
    try {
      await createRemote({ version: 1, name: 'Untitled document', blocks: [] });
      await fetchList(1, debouncedQuery);
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
      // switchTo flushes pending edits first: autosave is debounced 5s, so
      // opening another document straight after typing dropped that typing.
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
      title: `Delete “${doc.title}”?`,
      description: 'This permanently removes the document and its chats. It cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    setBusy('delete');
    try {
      await deleteRemote(doc.id);
      // Deleting the last item on the final page would otherwise strand the
      // user on a page that no longer exists.
      const nextPage = Math.min(page, Math.max(1, Math.ceil(Math.max(0, count - 1) / PAGE_SIZE)));
      setPage(nextPage);
      await fetchList(nextPage, debouncedQuery);
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
          onClick={() => fetchList(page, debouncedQuery)}
          disabled={loading}
          aria-label="Refresh document list"
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

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
                    <span className="truncate text-sm">{doc.title}</span>
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
                    aria-label={`Delete ${doc.title}`}
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
            onClick={() => fetchList(page, debouncedQuery)}
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
            onClick={() => setPage((p) => Math.max(1, p - 1))}
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
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
