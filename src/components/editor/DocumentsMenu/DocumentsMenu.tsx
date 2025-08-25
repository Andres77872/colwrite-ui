import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../../../editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Search, RefreshCw, Plus, Trash2 } from 'lucide-react';

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
      // no-op display handled elsewhere if desired
    } finally {
      setLoading(false);
    }
  };

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Reset to page 1 on new search term
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
      // Optionally auto-load is already the current document after create
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
      // If the last item on the last page was removed, move back a page
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
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            Documents
            <Badge variant="secondary" className="text-xs">{count}</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchList} disabled={loading}>
              {loading ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
            <Button size="sm" onClick={onCreate} disabled={creating}>
              {creating ? <Spinner size="sm" /> : <Plus className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search documents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="space-y-2">
          {loading && (
            <div className="flex items-center gap-2 p-3 text-muted-foreground text-sm">
              <Spinner size="sm" />
              Loading documents…
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="p-4 text-center">
              <div className="text-muted-foreground text-sm mb-2">No documents found</div>
              <div className="text-xs text-muted-foreground/80">
                {query ? 'Try a different search term' : 'Create your first document to get started'}
              </div>
            </div>
          )}
          {!loading && items.map((d: any) => {
            const id: string = String(d._id || d.id || d.document_id || '');
            if (!id) return null;
            const title: string = String(d.title || d.name || '(untitled)');
            const isActive = documentId === id;
            return (
              <div
                key={id}
                className={[
                  'group flex items-center justify-between gap-3 p-3 rounded-lg cursor-pointer border transition-all duration-200',
                  isActive
                    ? 'border-accent/30 bg-accent/5 shadow-sm ring-1 ring-accent/10'
                    : 'border-transparent hover:border-border hover:bg-muted/5 hover:shadow-xs',
                ].join(' ')}
                onClick={() => onLoad(id)}
              >
                <div className="min-w-0 flex-1">
                  <div className={[
                    'text-sm font-medium truncate transition-colors',
                    isActive ? 'text-accent-ink' : 'text-foreground group-hover:text-accent'
                  ].join(' ')}>
                    {title}
                  </div>
                  <div className="text-xs truncate text-muted-foreground mt-0.5 font-mono">
                    {id.slice(-8)}
                  </div>
                </div>
                <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onDelete(id); }}
                    disabled={deletingId === id}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Delete document"
                  >
                    {deletingId === id ? (
                      <Spinner size="sm" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {totalPages > 1 && (
          <>
            <Separator />
            <div className="flex items-center justify-center gap-2">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={prev} 
                disabled={page <= 1}
                className="h-8 px-3 font-medium disabled:opacity-50"
              >
                ← Prev
              </Button>
              <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-16 justify-center">
                {page} / {totalPages}
              </div>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={next} 
                disabled={page >= totalPages}
                className="h-8 px-3 font-medium disabled:opacity-50"
              >
                Next →
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
