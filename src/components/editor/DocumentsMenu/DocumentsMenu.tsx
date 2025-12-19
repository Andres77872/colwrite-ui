import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEditor } from '../../../editor';
import { RefreshCw, Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';

export function DocumentsMenu() {
  const { listRemote, loadRemote, createRemote, deleteRemote, documentId } = useEditor();
  const [items, setItems] = useState<any[]>([]);
  const [count, setCount] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(10);
  const [loading, setLoading] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');

  const totalPages = useMemo(() => Math.max(1, Math.ceil(count / limit)), [count, limit]);

  const fetchList = async () => {
    try {
      setLoading(true);
      const res = await listRemote(page, limit, debouncedQuery);
      setItems(res.documents || []);
      setCount(res.count || 0);
    } catch (e) {
      // no-op
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery]);

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedQuery]);

  const onCreate = async () => {
    try {
      setCreating(true);
      await createRemote({ name: 'New document', blocks: [] });
      await fetchList();
    } finally {
      setCreating(false);
    }
  };

  const onLoad = async (id: string) => {
    await loadRemote(id);
  };

  const onDelete = async (id: string) => {
    if (!confirm(`Delete document ${id}?`)) return;
    try {
      setDeletingId(id);
      await deleteRemote(id);
      const nextCount = Math.max(0, count - 1);
      const nextTotalPages = Math.max(1, Math.ceil(nextCount / limit));
      if (page > nextTotalPages) setPage(nextTotalPages);
      await fetchList();
    } finally {
      setDeletingId(null);
    }
  };

  const prev = () => setPage((p) => Math.max(1, p - 1));
  const next = () => setPage((p) => Math.min(totalPages, p + 1));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <strong className="text-sm">Documents</strong>
        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" onClick={fetchList} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
          <Button size="sm" onClick={onCreate} disabled={creating}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New
          </Button>
        </div>
      </div>

      <Input
        type="search"
        placeholder="Search documents…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search documents"
        className="h-8"
      />

      <div className="text-muted-foreground text-xs">
        Page {page} / {totalPages} · {count} total
      </div>

      <div className="flex flex-col gap-2">
        {loading && <div className="text-muted-foreground text-sm">Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="text-muted-foreground text-sm">No documents yet. Create one to get started.</div>
        )}
        {!loading && items.map((d: any) => {
          const id: string = String(d._id || d.id || d.document_id || '');
          if (!id) return null;
          const title: string = String(d.title || d.name || '(untitled)');
          const isActive = documentId === id;
          return (
            <div 
              key={id} 
              className={cn(
                "flex items-center justify-between gap-2 px-2 py-2 rounded-lg",
                "cursor-pointer border border-transparent transition-colors",
                "hover:bg-accent",
                isActive && "border-border bg-primary/5"
              )}
              onClick={() => onLoad(id)}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate font-medium">{title}</div>
                <div className="text-xs text-muted-foreground truncate">{id}</div>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-destructive hover:bg-destructive/10"
                onClick={(e) => { e.stopPropagation(); onDelete(id); }}
                disabled={deletingId === id}
                title="Delete document"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between items-center mt-2">
        <Button variant="outline" size="sm" onClick={prev} disabled={page <= 1}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="sm" onClick={next} disabled={page >= totalPages}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
