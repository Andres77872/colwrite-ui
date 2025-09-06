import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import './LibraryPanel.css';
import { uid } from '../../../lib/uid';

export type LocalDoc = {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  url: string; // object URL for preview
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

export function LibraryPanel() {
  const [docs, setDocs] = useState<LocalDoc[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => docs.find(d => d.id === selectedId) || null, [docs, selectedId]);

  useEffect(() => {
    return () => {
      // cleanup object URLs on unmount
      for (const d of docs) URL.revokeObjectURL(d.url);
    };
  }, [docs]);

  function addFiles(files: FileList | null) {
    if (!files || !files.length) return;
    const next: LocalDoc[] = [];
    for (const file of Array.from(files)) {
      if (file.type !== 'application/pdf') continue;
      const id = uid();
      const url = URL.createObjectURL(file);
      next.push({ id, name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, url });
    }
    setDocs(prev => [...next, ...prev]);
    if (!selectedId && next.length) setSelectedId(next[0].id);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    addFiles(e.dataTransfer?.files || null);
  }

  function onRemove(id: string) {
    setDocs(prev => {
      const d = prev.find(x => x.id === id);
      if (d) URL.revokeObjectURL(d.url);
      const filtered = prev.filter(x => x.id !== id);
      if (selectedId === id) setSelectedId(filtered[0]?.id || null);
      return filtered;
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter(d => d.name.toLowerCase().includes(q));
  }, [docs, query]);

  return (
    <div className="library-panel">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong>Library</strong>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="muted">{docs.length ? `${docs.length} document${docs.length > 1 ? 's' : ''}` : 'No documents yet'}</span>
        </div>
      </div>

      <div className={`dropzone card${dragOver ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        role="region"
        aria-label="Upload PDF"
      >
        <div className="dz-icon">📄</div>
        <div className="dz-title">Drop PDF here</div>
        <div className="dz-text muted">or</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => inputRef.current?.click()}>Choose file</button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => addFiles(e.target.files)}
          />
        </div>
      </div>

      <form className="search" onSubmit={(e) => e.preventDefault()}>
        <input
          className="input grow"
          placeholder="Search your documents"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="btn" onClick={() => setQuery('')} type="button">Clear</button>
        )}
      </form>

      <div className="list" role="list">
        {filtered.map((d) => (
          <div
            key={d.id}
            role="listitem"
            className={`item card${selectedId === d.id ? ' selected' : ''}`}
            onClick={() => setSelectedId(d.id)}
          >
            <div className="item-icon">📑</div>
            <div className="item-main">
              <div className="item-title">{d.name}</div>
              <div className="item-meta muted">{formatBytes(d.size)} · {new Date(d.lastModified).toLocaleDateString()}</div>
            </div>
            <div className="item-actions">
              <button className="btn" onClick={(e) => { e.stopPropagation(); setSelectedId(d.id); }}>Preview</button>
              <button className="btn danger" onClick={(e) => { e.stopPropagation(); onRemove(d.id); }}>Remove</button>
            </div>
          </div>
        ))}

        {!docs.length && (
          <div className="empty-state">
            <div className="empty-icon">📚</div>
            <div className="empty-title">Your library is empty</div>
            <div className="empty-text muted">Upload PDFs to build your library. Drag and drop supported.</div>
          </div>
        )}

        {!!docs.length && !filtered.length && (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <div className="empty-title">No matches</div>
            <div className="empty-text muted">Try a different search.</div>
          </div>
        )}
      </div>

      {selected && (
        <div className="preview card">
          <div className="preview-header">
            <div className="preview-title">{selected.name}</div>
            <div className="row" style={{ gap: 8 }}>
              <a className="btn" href={selected.url} target="_blank" rel="noreferrer">Open</a>
              <button className="btn" onClick={() => setSelectedId(null)}>Close</button>
            </div>
          </div>
          <div className="preview-frame">
            <iframe className="pdf-frame" src={selected.url} title={selected.name} />
          </div>
        </div>
      )}
    </div>
  );
}
