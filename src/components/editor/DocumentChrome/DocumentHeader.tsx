import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../editor';

export function DocumentHeader() {
  const { doc, setDocName, saveRemote, deleteRemote, newLocal, documentId, lastSavedAt } = useEditor();
  const [loading, setLoading] = useState<null | 'save' | 'delete'>(null);
  const [editing, setEditing] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const title = (doc.name || 'Untitled document');

  useEffect(() => {
    if (editing) queueMicrotask(() => inputRef.current?.select());
  }, [editing]);

  const onNew = () => {
    if (!confirm('Start a new document? Unsaved changes will be lost.')) return;
    newLocal();
  };

  const onSave = async () => {
    try {
      setLoading('save');
      await saveRemote();
    } finally {
      setLoading(null);
    }
  };

  const commitTitle = async (next: string) => {
    const trimmed = (next || '').trim();
    const normalized = trimmed || 'Untitled document';
    setDocName(normalized);
    // Save immediately with override so the request includes the latest name
    const override = { ...doc, name: normalized } as any;
    try { await saveRemote(override); } catch {}
  };

  const onDelete = async () => {
    if (!documentId) return;
    if (!confirm(`Delete document ${documentId}?`)) return;
    try {
      setLoading('delete');
      await deleteRemote(documentId);
      newLocal();
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="sticky top-0 z-10 bg-panel border-b border-border -mx-3 -mt-3 mb-3 px-3 py-2 rounded-t-[var(--radius-lg)]">
      <div className="flex items-baseline gap-3">
        {!editing && (
          <button className="text-xl font-semibold bg-transparent border-0 p-0 text-left cursor-text" title="Rename" onClick={() => setEditing(true)}>
            {title}
          </button>
        )}
        {editing && (
          <input
            ref={inputRef}
            className="text-xl font-semibold border border-border rounded-sm px-1.5 py-0.5 bg-elev"
            defaultValue={title}
            onBlur={(e) => { setEditing(false); commitTitle(e.currentTarget.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }}
          />
        )}
        {documentId && <div className="text-muted text-sm px-1.5 py-0.5 border border-dashed border-border rounded-sm bg-elev">{documentId}</div>}
      </div>
      <div className="flex items-center gap-2">
        <button className="px-2.5 py-1.5 rounded-sm border border-border bg-white hover:bg-elev active:translate-y-[0.5px] disabled:opacity-60 disabled:cursor-not-allowed" onClick={onNew} disabled={loading !== null}>New</button>
        <button className="px-2.5 py-1.5 rounded-sm border border-accent bg-accent text-white hover:bg-accent-ink active:translate-y-[0.5px] disabled:opacity-60 disabled:cursor-not-allowed" onClick={onSave} disabled={loading !== null}>
          {loading === 'save' ? 'Saving…' : (documentId ? 'Save' : 'Save (create)')}
        </button>
        <button className="px-2.5 py-1.5 rounded-sm border border-danger bg-danger text-white hover:brightness-90 active:translate-y-[0.5px] disabled:opacity-60 disabled:cursor-not-allowed" onClick={onDelete} disabled={!documentId || loading !== null}>
          {loading === 'delete' ? 'Deleting…' : 'Delete'}
        </button>
        <div className="text-muted">{lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : (loading === 'save' ? 'Saving…' : '—')}</div>
      </div>
    </div>
  );
}


