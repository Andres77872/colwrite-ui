import './DocumentHeader.css';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../editor';

export function DocumentHeader() {
  const { blocks, doc, setDocName, addBlockAtStart, updateHtml, saveRemote, deleteRemote, newLocal, documentId, lastSavedAt } = useEditor();
  const [loading, setLoading] = useState<null | 'save' | 'delete'>(null);
  const [editing, setEditing] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const headingTitle = (() => {
    const h = blocks.find(b => b.type === 'heading');
    const html = (h as any)?.html || '';
    const text = html.replace(/<[^>]*>/g, '').trim();
    return text;
  })();
  const title = (doc.name || headingTitle || 'Untitled document');

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
    // Reflect title into first heading block in canvas
    const escapeHtml = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const heading = blocks.find(b => b.type === 'heading') as any;
    const nextHtml = escapeHtml(normalized);
    if (heading) {
      updateHtml(heading.id, nextHtml);
    } else {
      const id = addBlockAtStart('heading');
      updateHtml(id, nextHtml);
    }
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
        <div className="muted">{lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : (loading === 'save' ? 'Saving…' : '—')}</div>
      </div>
    </div>
  );
}


