import './DocumentHeader.css';
import { useState } from 'react';
import { useEditor } from '../../../editor';

export function DocumentHeader() {
  const { blocks, saveRemote, deleteRemote, newLocal, documentId, lastSavedAt } = useEditor();
  const [loading, setLoading] = useState<null | 'save' | 'delete'>(null);

  const title = (() => {
    const h = blocks.find(b => b.type === 'heading');
    const html = (h as any)?.html || '';
    const text = html.replace(/<[^>]*>/g, '').trim();
    return text || 'Untitled document';
  })();

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
        <div className="doc-title-text">{title}</div>
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


