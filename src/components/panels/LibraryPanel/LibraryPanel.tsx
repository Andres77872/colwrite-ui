import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { uid } from '../../../lib/uid';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    <div className="flex flex-col gap-3 h-full">
      {/* Status */}
      <div className="text-xs text-muted-foreground">
        {docs.length ? `${docs.length} document${docs.length > 1 ? 's' : ''}` : 'No documents yet'}
      </div>

      <div 
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
          dragOver ? "border-primary bg-primary/5" : "border-border"
        )}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        role="region"
        aria-label="Upload PDF"
      >
        <div className="text-3xl mb-2">📄</div>
        <div className="font-medium mb-1">Drop PDF here</div>
        <div className="text-sm text-muted-foreground mb-3">or</div>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>Choose file</Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      <form className="flex items-center gap-2" onSubmit={(e) => e.preventDefault()}>
        <Input
          className="flex-1"
          placeholder="Search your documents"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <Button variant="outline" size="sm" onClick={() => setQuery('')} type="button">Clear</Button>
        )}
      </form>

      <div className="space-y-2 overflow-auto" role="list">
        {filtered.map((d) => (
          <div
            key={d.id}
            role="listitem"
            className={cn(
              "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
              selectedId === d.id ? "bg-primary/10 border-primary" : "bg-card border-border hover:bg-accent"
            )}
            onClick={() => setSelectedId(d.id)}
          >
            <div className="text-lg">📑</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{d.name}</div>
              <div className="text-xs text-muted-foreground">{formatBytes(d.size)} · {new Date(d.lastModified).toLocaleDateString()}</div>
            </div>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button variant="outline" size="sm" onClick={() => setSelectedId(d.id)}>Preview</Button>
              <Button variant="destructive" size="sm" onClick={() => onRemove(d.id)}>Remove</Button>
            </div>
          </div>
        ))}

        {!docs.length && (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">📚</div>
            <div className="font-medium">Your library is empty</div>
            <div className="text-sm text-muted-foreground">Upload PDFs to build your library. Drag and drop supported.</div>
          </div>
        )}

        {!!docs.length && !filtered.length && (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">🔍</div>
            <div className="font-medium">No matches</div>
            <div className="text-sm text-muted-foreground">Try a different search.</div>
          </div>
        )}
      </div>

      {selected && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
            <div className="font-medium text-sm truncate">{selected.name}</div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={selected.url} target="_blank" rel="noreferrer">Open</a>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
          <div className="h-[400px]">
            <iframe className="w-full h-full border-0" src={selected.url} title={selected.name} />
          </div>
        </div>
      )}
    </div>
  );
}
