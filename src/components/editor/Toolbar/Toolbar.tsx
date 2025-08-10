import './Toolbar.css';
import { useState } from 'react';
import { useEditor } from '../../../editor';

export function Toolbar() {
  const { exec, saveRemote, deleteRemote, newLocal, lastSavedAt, documentId } = useEditor();
  const [loading, setLoading] = useState<null | 'save' | 'delete'>(null);

  const onNew = () => {
    if (!confirm('Start a new document? Unsaved changes will be lost.')) return;
    newLocal();
  };

  const onSave = async () => {
    try {
      setLoading('save');
      await saveRemote();
    } catch (e: any) {
      alert(e?.message || 'Save failed');
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
    } catch (e: any) {
      alert(e?.message || 'Delete failed');
    } finally {
      setLoading(null);
    }
  };
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className="btn" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }}>B</button>
        <button className="btn" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }}>I</button>
        <button className="btn" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }}>U</button>
        <button className="btn" onMouseDown={(e) => { e.preventDefault(); exec('strikeThrough'); }}>S</button>
      </div>
      <div className="spacer" />
      <div className="toolbar-group">
        <button className="btn" title="New document" onClick={onNew} disabled={loading !== null}>New</button>
        <button className="btn primary" title={documentId ? 'Save changes' : 'Save and create document'} onClick={onSave} disabled={loading !== null}>
          {loading === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button className="btn danger" title="Delete current document" onClick={onDelete} disabled={!documentId || loading !== null}>
          {loading === 'delete' ? 'Deleting…' : 'Delete'}
        </button>
        <div className="muted">{documentId ? `ID: ${documentId}` : 'Unsaved'}</div>
        <div className="muted">{lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : (loading === 'save' ? 'Saving…' : '—')}</div>
      </div>
    </div>
  );
}
