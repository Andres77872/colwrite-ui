import { useEffect, useState } from 'react';
import './JsonPanel.css';
import { useEditor } from '../../../editor';
import { createDocument, saveDocument, loadDocument, listDocuments, deleteDocument } from '../../../services';

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
    <div className="json-panel">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong>Document JSON</strong>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Document ID"
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <button className="btn" disabled={loading} onClick={onCreate}>Create</button>
          <button className="btn" disabled={loading} onClick={onSaveById}>Save by ID</button>
          <button className="btn" disabled={loading} onClick={onLoadById}>Load by ID</button>
          <button className="btn danger" disabled={loading} onClick={onDeleteById}>Delete</button>
          <button className="btn" disabled={loading} onClick={onList}>List</button>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => setText(getJSON())}>Refresh</button>
          <button className="btn" onClick={onLoad}>Apply JSON</button>
          <button className="btn primary" onClick={save}>Save (local)</button>
        </div>
      </div>

      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} />

      {documents.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ marginBottom: 4 }}>Found {count} documents</div>
          <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {documents.map((d: any) => {
              const id = d._id || d.id || '';
              const title = d.title || '(untitled)';
              return (
                <li key={id} style={{ cursor: 'pointer' }} onClick={() => setDocumentId(String(id))}>
                  <span className="muted">{String(id)}</span> — {String(title)}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
