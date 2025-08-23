import { useState } from 'react';
import { useEditor } from '../../../editor';

export function Toolbar() {
  const { saveRemote, deleteRemote, newLocal, lastSavedAt, documentId } = useEditor();
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
    <div className="flex items-center gap-2 p-2 border border-border rounded-md bg-elev">
      <div className="flex-1" />
      <div className="inline-flex items-center gap-2">
        <button className="btn" title="New document" onClick={onNew} disabled={loading !== null}>New</button>
        <button className="btn primary" title={documentId ? 'Save changes' : 'Save and create document'} onClick={onSave} disabled={loading !== null}>
          {loading === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button className="btn danger" title="Delete current document" onClick={onDelete} disabled={!documentId || loading !== null}>
          {loading === 'delete' ? 'Deleting…' : 'Delete'}
        </button>
        <div className="muted text-sm">{documentId ? `ID: ${documentId}` : 'Unsaved'}</div>
        <div className="muted text-sm">{lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : (loading === 'save' ? 'Saving…' : '—')}</div>
      </div>
    </div>
  );
}
