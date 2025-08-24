import { useState } from 'react';
import { useEditor } from '../../../editor';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DocumentsMenu } from '@/components/editor/DocumentsMenu';

export function Toolbar() {
  const { saveRemote, deleteRemote, newLocal, lastSavedAt, documentId } = useEditor();
  const [loading, setLoading] = useState<null | 'save' | 'delete'>(null);
  const [docsOpen, setDocsOpen] = useState(false);

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
    <div className="flex items-center gap-2 p-2 border border-border rounded-md bg-card">
      <Dialog open={docsOpen} onOpenChange={setDocsOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" title="Open documents menu">Documents</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Documents</DialogTitle>
          </DialogHeader>
          <DocumentsMenu />
        </DialogContent>
      </Dialog>
      <div className="flex-1" />
      <div className="inline-flex items-center gap-2">
        <Button variant="outline" title="New document" onClick={onNew} disabled={loading !== null}>New</Button>
        <Button title={documentId ? 'Save changes' : 'Save and create document'} onClick={onSave} disabled={loading !== null}>
          {loading === 'save' ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="destructive" title="Delete current document" onClick={onDelete} disabled={!documentId || loading !== null}>
          {loading === 'delete' ? 'Deleting…' : 'Delete'}
        </Button>
        <div className="text-muted-foreground text-sm">{documentId ? `ID: ${documentId}` : 'Unsaved'}</div>
        <div className="text-muted-foreground text-sm">{lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : (loading === 'save' ? 'Saving…' : '—')}</div>
      </div>
    </div>
  );
}

