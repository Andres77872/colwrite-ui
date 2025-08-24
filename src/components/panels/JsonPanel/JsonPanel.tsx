import { useEffect, useState } from 'react';
// styles migrated to Tailwind (see src/styles/tailwind.css)
import { useEditor } from '../../../editor';
import { createDocument, saveDocument, loadDocument, listDocuments, deleteDocument } from '../../../services';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function JsonPanel() {
  const { getJSON, setFromJSON, save, doc } = useEditor();
  const [text, setText] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<any[]>([]);
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    setText(getJSON());
  }, [getJSON]);

  const onLoad = () => {
    try {
      setFromJSON(text);
    } catch (e) {
      alert('Invalid JSON. Expecting an object with a blocks array.');
    }
  };

  const onCreate = async () => {
    try {
      setLoading(true);
      const res = await createDocument(doc);
      setDocumentId(res.document_id);
      alert(`Document created with id: ${res.document_id}`);
    } catch (e: any) {
      alert(`Create failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const onSaveById = async () => {
    if (!documentId) return alert('Enter a document ID first');
    try {
      setLoading(true);
      const res = await saveDocument(documentId, doc);
      alert(res.message || 'Saved');
    } catch (e: any) {
      alert(`Save failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const onLoadById = async () => {
    if (!documentId) return alert('Enter a document ID first');
    try {
      setLoading(true);
      const loaded = await loadDocument(documentId);
      setFromJSON(JSON.stringify(loaded));
      setText(JSON.stringify(loaded, null, 2));
    } catch (e: any) {
      alert(`Load failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const onDeleteById = async () => {
    if (!documentId) return alert('Enter a document ID first');
    if (!confirm(`Delete document ${documentId}?`)) return;
    try {
      setLoading(true);
      const res = await deleteDocument(documentId);
      alert(res.message || 'Deleted');
      setDocumentId('');
    } catch (e: any) {
      alert(`Delete failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const onList = async () => {
    try {
      setLoading(true);
      const res = await listDocuments(1, 10);
      setDocuments(res.documents || []);
      setCount(res.count || 0);
    } catch (e: any) {
      alert(`List failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <strong>Document JSON</strong>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Document ID"
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
            className="min-w-[280px]"
          />
          <Button disabled={loading} onClick={onCreate}>Create</Button>
          <Button variant="outline" disabled={loading} onClick={onSaveById}>Save by ID</Button>
          <Button variant="outline" disabled={loading} onClick={onLoadById}>Load by ID</Button>
          <Button variant="destructive" disabled={loading} onClick={onDeleteById}>Delete</Button>
          <Button variant="outline" disabled={loading} onClick={onList}>List</Button>
        </div>
      </div>

      <div className="flex justify-between mt-2">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setText(getJSON())}>Refresh</Button>
          <Button variant="outline" onClick={onLoad}>Apply JSON</Button>
          <Button onClick={save}>Save (local)</Button>
        </div>
      </div>

      <textarea
        className="flex-1 min-h-[200px] font-mono text-sm leading-[1.5] p-[10px] rounded-sm border border-border w-full"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {documents.length > 0 && (
        <div className="mt-2">
          <div className="text-muted-foreground mb-1">Found {count} documents</div>
          <ul className="m-0 pl-5">
            {documents.map((d: any) => {
              const id = d._id || d.id || '';
              const title = d.title || '(untitled)';
              return (
                <li key={id} className="cursor-pointer text-sm" onClick={() => setDocumentId(String(id))}>
                  <span className="text-muted-foreground">{String(id)}</span> — {String(title)}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
