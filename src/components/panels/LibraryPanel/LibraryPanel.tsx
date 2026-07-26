import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { uid } from '@/lib/uid';
import { cn } from '@/lib/utils';
import { formatBytes, formatDate } from '@/lib/text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { BookOpen, FileText, SearchX, Upload, X } from 'lucide-react';

export type LocalDoc = {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  /** Object URL used for the inline preview; revoked when the doc is removed. */
  url: string;
};

export function LibraryPanel() {
  const [docs, setDocs] = useState<LocalDoc[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  // Revoking has to happen exactly once per URL, at unmount. Keying the
  // cleanup on `docs` used to revoke every still-listed document's URL on each
  // add or remove, so previews went blank as soon as a second file arrived.
  const docsRef = useRef<LocalDoc[]>([]);
  docsRef.current = docs;
  useEffect(
    () => () => {
      for (const doc of docsRef.current) URL.revokeObjectURL(doc.url);
    },
    [],
  );

  const selected = useMemo(() => docs.find((d) => d.id === selectedId) ?? null, [docs, selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => d.name.toLowerCase().includes(q));
  }, [docs, query]);

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const accepted: LocalDoc[] = [];
    let rejected = 0;

    for (const file of Array.from(files)) {
      if (file.type !== 'application/pdf') {
        rejected += 1;
        continue;
      }
      accepted.push({
        id: uid(),
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        url: URL.createObjectURL(file),
      });
    }

    if (rejected > 0) {
      // Non-PDFs were previously dropped in silence, which read as a bug.
      toast({
        title: `Skipped ${rejected} file${rejected === 1 ? '' : 's'}`,
        description: 'Only PDF files can be added to the library.',
        variant: 'warning',
      });
    }
    if (accepted.length === 0) return;

    setDocs((prev) => [...accepted, ...prev]);
    setSelectedId((current) => current ?? accepted[0].id);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    addFiles(event.dataTransfer?.files ?? null);
  }

  function onRemove(id: string) {
    setDocs((prev) => {
      const doc = prev.find((d) => d.id === id);
      if (doc) URL.revokeObjectURL(doc.url);
      const remaining = prev.filter((d) => d.id !== id);
      setSelectedId((current) => (current === id ? (remaining[0]?.id ?? null) : current));
      return remaining;
    });
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div
        className={cn(
          'rounded-lg border-2 border-dashed p-5 text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <Upload aria-hidden="true" className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
        <p className="text-sm font-medium">Drop PDFs here</p>
        <p className="mb-3 text-xs text-muted-foreground">Files stay in this browser session</p>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="sr-only"
          aria-label="Add PDF files to the library"
          onChange={(event) => {
            addFiles(event.target.files);
            // Reset so re-picking the same file fires `change` again.
            event.target.value = '';
          }}
        />
      </div>

      {docs.length > 0 && (
        <Input
          type="search"
          placeholder="Filter by file name…"
          aria-label="Filter library"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}

      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {filtered.map((doc) => {
          const isSelected = selectedId === doc.id;
          return (
            <li key={doc.id}>
              <div
                className={cn(
                  'group flex items-center gap-2 rounded-lg border transition-colors',
                  isSelected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent',
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(isSelected ? null : doc.id)}
                  aria-pressed={isSelected}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-2.5 text-left"
                >
                  <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{doc.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatBytes(doc.size)} · {formatDate(doc.lastModified)}
                    </span>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="mr-2 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => onRemove(doc.id)}
                  aria-label={`Remove ${doc.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          );
        })}

        {docs.length === 0 && (
          <EmptyState
            icon={BookOpen}
            title="Your library is empty"
            description="Add PDFs to keep reference material next to your draft."
          />
        )}

        {docs.length > 0 && filtered.length === 0 && (
          <EmptyState
            icon={SearchX}
            title="No matches"
            description={`No file name contains “${query.trim()}”.`}
          />
        )}
      </ul>

      {selected && (
        <div className="flex-shrink-0 overflow-hidden rounded-lg border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
            <p className="min-w-0 truncate text-sm font-medium">{selected.name}</p>
            <div className="flex flex-shrink-0 items-center gap-1">
              <Button variant="outline" size="sm" asChild>
                <a href={selected.url} target="_blank" rel="noreferrer noopener">
                  Open
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSelectedId(null)}
                aria-label="Close preview"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <iframe className="h-80 w-full border-0" src={selected.url} title={`Preview of ${selected.name}`} />
        </div>
      )}
    </div>
  );
}
