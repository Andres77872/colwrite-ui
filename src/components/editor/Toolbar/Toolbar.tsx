import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useEditor } from '../../../editor';
import { FilePlus, Save, Trash2 } from 'lucide-react';

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
    <div className="flex items-center justify-end gap-2 p-2">
      <Button variant="outline" size="sm" onClick={onNew} disabled={loading !== null}>
        <FilePlus className="h-3.5 w-3.5 mr-1" />
        New
      </Button>
      <Button size="sm" onClick={onSave} disabled={loading !== null}>
        <Save className="h-3.5 w-3.5 mr-1" />
        {loading === 'save' ? 'Saving…' : 'Save'}
      </Button>
      <Button variant="destructive" size="sm" onClick={onDelete} disabled={!documentId || loading !== null}>
        <Trash2 className="h-3.5 w-3.5 mr-1" />
        {loading === 'delete' ? 'Deleting…' : 'Delete'}
      </Button>
      <span className="text-muted-foreground text-sm">{documentId ? `ID: ${documentId}` : 'Unsaved'}</span>
      <span className="text-muted-foreground text-sm">
        {lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : (loading === 'save' ? 'Saving…' : '—')}
      </span>
    </div>
  );
}
