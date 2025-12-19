import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useEditor } from '../../../editor';
import { FilePlus, Save, Trash2 } from 'lucide-react';

export function DocumentHeader() {
  const { doc, setDocName, saveRemote, deleteRemote, newLocal, documentId, lastSavedAt, isAutoSaving, lastSaveSource } = useEditor();
  const [loading, setLoading] = useState<null | 'save' | 'delete'>(null);
  const [editing, setEditing] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const title = (doc.name || 'Untitled document');

  useEffect(() => {
    if (editing) queueMicrotask(() => inputRef.current?.select());
  }, [editing]);

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

  const commitTitle = async (next: string) => {
    const trimmed = (next || '').trim();
    const normalized = trimmed || 'Untitled document';
    setDocName(normalized);
    const override = { ...doc, name: normalized } as any;
    try { await saveRemote(override); } catch {}
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

  const statusText = (() => {
    if (loading === 'save') return 'Saving…';
    if (isAutoSaving) return 'Auto-saving…';
    if (lastSavedAt) {
      const time = new Date(lastSavedAt).toLocaleTimeString();
      return lastSaveSource === 'auto' ? `Auto-saved ${time}` : `Saved ${time}`;
    }
    return '—';
  })();

  return (
    <div className={cn(
      "sticky top-0 z-[5] bg-card border-b border-border",
      "px-3 py-2 -mx-3 -mt-3 mb-3 rounded-t-lg",
      "flex items-center justify-between gap-3 flex-wrap"
    )}>
      <div className="flex items-baseline gap-3 min-w-0">
        {!editing && (
          <button
            className="text-xl font-semibold bg-transparent border-none p-0 cursor-text text-left hover:underline decoration-primary/30 underline-offset-2"
            title="Rename"
            onClick={() => setEditing(true)}
          >
            {title}
          </button>
        )}
        {editing && (
          <Input
            ref={inputRef}
            className="text-xl font-semibold h-auto py-0.5 px-1.5 max-w-[300px]"
            defaultValue={title}
            onBlur={(e) => { setEditing(false); commitTitle(e.currentTarget.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }}
          />
        )}
        {documentId && (
          <Badge variant="outline" className="text-xs font-mono">
            {documentId.slice(0, 8)}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onNew} disabled={loading !== null}>
          <FilePlus className="h-3.5 w-3.5 mr-1" />
          New
        </Button>
        <Button size="sm" onClick={onSave} disabled={loading !== null}>
          <Save className="h-3.5 w-3.5 mr-1" />
          {loading === 'save' ? 'Saving…' : (documentId ? 'Save' : 'Save (create)')}
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete} disabled={!documentId || loading !== null}>
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          {loading === 'delete' ? 'Deleting…' : 'Delete'}
        </Button>
        <span className="text-muted-foreground text-sm">{statusText}</span>
      </div>
    </div>
  );
}
