import './DocumentHeader.css';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../editor';

export function DocumentHeader() {
  const { doc, setDocName, saveRemote, deleteRemote, newLocal, documentId, lastSavedAt, isAutoSaving, lastSaveSource } = useEditor();
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

  const statusText = (() => {
    if (loading === 'save') return 'Saving…';
    if (isAutoSaving) return 'Auto-saving…';
    if (lastSavedAt) {
      const time = new Date(lastSavedAt).toLocaleTimeString();
      return lastSaveSource === 'auto' ? `Auto-saved ${time}` : `Saved ${time}`;
    }
    return '—';
  })();

  return (
    <div className="doc-header">
      <div className="doc-title">
        {!editing && (
          <button className="doc-title-text as-button" title="Rename" onClick={() => setEditing(true)}>
            {title}
          </button>
        )}
        {editing && (
          <input
            ref={inputRef}
            className="doc-title-input"
            defaultValue={title}
            onBlur={(e) => { setEditing(false); commitTitle(e.currentTarget.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }}
          />
        )}
        {documentId && <div className="doc-id">{documentId}</div>}
      </div>
      <div className="doc-actions">
        <button className="btn" onClick={onNew} disabled={loading !== null}>New</button>
        <button className="btn primary" onClick={onSave} disabled={loading !== null}>
          {loading === 'save' ? 'Saving…' : (documentId ? 'Save' : 'Save (create)')}
        </button>
        <button className="btn danger" onClick={onDelete} disabled={!documentId || loading !== null}>
          {loading === 'delete' ? 'Deleting…' : 'Delete'}
        </button>
        <div className="muted">{statusText}</div>
      </div>
    </div>
  );
}


