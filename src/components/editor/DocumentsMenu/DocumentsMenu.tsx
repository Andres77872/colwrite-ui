import { useEffect, useMemo, useState } from 'react';
import './DocumentsMenu.css';
import { useEditor } from '../../../editor';

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
    <div className="documents-menu">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Documents</strong>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={fetchList} disabled={loading}>Refresh</button>
          <button className="btn primary" onClick={onCreate} disabled={creating}>New</button>
        </div>
      </div>

      <div className="row">
        <input
          className="input grow"
          type="search"
          placeholder="Search documents…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search documents"
        />
      </div>

      <div className="muted" style={{ fontSize: 12 }}>
        Page {page} / {totalPages} · {count} total
      </div>

      <div className="list">
        {loading && <div className="muted">Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="muted">No documents yet. Create one to get started.</div>
        )}
        {!loading && items.map((d: any) => {
          const id: string = String(d._id || d.id || d.document_id || '');
          if (!id) return null;
          const title: string = String(d.title || d.name || '(untitled)');
          const isActive = documentId === id;
          return (
            <div key={id} className={`doc-row${isActive ? ' active' : ''}`} onClick={() => onLoad(id)}>
              <div className="doc-main">
                <div className="doc-title">{title}</div>
                <div className="doc-sub muted">{id}</div>
              </div>
              <div className="doc-actions">
                <button
                  className="btn danger"
                  onClick={(e) => { e.stopPropagation(); onDelete(id); }}
                  disabled={deletingId === id}
                  title="Delete document"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <button className="btn" onClick={prev} disabled={page <= 1}>Prev</button>
        <button className="btn" onClick={next} disabled={page >= totalPages}>Next</button>
      </div>
    </div>
  );
}
