import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import { useEditor } from '@/editor';
import { AlertCircle, Check, Cloud, CloudOff, Download, FilePlus, Save, Trash2 } from 'lucide-react';
import { DocumentExportDialog } from './DocumentExportDialog';

const DEFAULT_TITLE = 'Untitled document';

export function DocumentHeader() {
  const {
    doc,
    setDocName,
    saveRemote,
    deleteRemote,
    newLocal,
    documentId,
    lastSavedAt,
    isAutoSaving,
    lastSaveSource,
    saveError,
  } = useEditor();
  const confirm = useConfirm();
  const { toast } = useToast();

  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null);
  const [editing, setEditing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const title = doc.name?.trim() || DEFAULT_TITLE;

  useEffect(() => {
    if (editing) queueMicrotask(() => inputRef.current?.select());
  }, [editing]);

  const commitTitle = async (next: string) => {
    setEditing(false);
    const normalized = next.trim() || DEFAULT_TITLE;
    if (normalized === title) return;
    setDocName(normalized);
    try {
      // Pass the new name explicitly: `doc` in this closure still holds the
      // previous title when the save fires.
      await saveRemote({ ...doc, name: normalized });
    } catch (error) {
      toast({
        title: 'Renamed locally, but the save failed',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    }
  };

  const onNew = async () => {
    const ok = await confirm({
      title: 'Start a new document?',
      description: 'Unsaved changes to the current document will be lost.',
      confirmLabel: 'Start new',
    });
    if (ok) newLocal();
  };

  const onSave = async () => {
    setBusy('save');
    try {
      await saveRemote();
      toast({ title: 'Document saved', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    if (!documentId) return;
    const ok = await confirm({
      title: `Delete “${title}”?`,
      description: 'This permanently removes the document and its chats. It cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    setBusy('delete');
    try {
      await deleteRemote(documentId);
      toast({ title: 'Document deleted', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Autosave failures only ever surfaced as a `title` on the status span — and
   * that span is `hidden … sm:flex`, so on a phone there was no indication at
   * all, and on a desktop the reason needed a hover. Announce each distinct
   * failure once; the inline status stays as the quiet steady-state readout.
   */
  const announcedSaveError = useRef<string | null>(null);
  useEffect(() => {
    if (!saveError) {
      announcedSaveError.current = null;
      return;
    }
    if (announcedSaveError.current === saveError) return;
    announcedSaveError.current = saveError;
    toast({ title: 'Autosave failed', description: saveError, variant: 'error' });
  }, [saveError, toast]);

  const status = (() => {
    // A failed save outranks everything else: autosave errors were swallowed
    // entirely, so a document that had silently stopped saving looked exactly
    // like one that was saving fine.
    if (saveError) {
      return { icon: AlertCircle, text: 'Not saved', tone: 'text-destructive' };
    }
    if (busy === 'save' || isAutoSaving) {
      return { icon: Spinner, text: 'Saving…', tone: 'text-muted-foreground' };
    }
    if (!documentId) {
      return { icon: CloudOff, text: 'Not saved to the server yet', tone: 'text-muted-foreground' };
    }
    if (lastSavedAt) {
      const time = new Date(lastSavedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      return {
        icon: Check,
        text: `${lastSaveSource === 'auto' ? 'Autosaved' : 'Saved'} ${time}`,
        tone: 'text-muted-foreground',
      };
    }
    return { icon: Cloud, text: 'Synced', tone: 'text-muted-foreground' };
  })();

  const StatusIcon = status.icon;

  return (
    <div
      className={cn(
        // Stickiness belongs to the wrapper in Canvas, which pins this and the
        // review bar as one stack instead of letting them overlap.
        'flex flex-wrap items-center justify-between gap-x-3 gap-y-2',
        'border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur-sm',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {editing ? (
          <Input
            ref={inputRef}
            className="h-8 max-w-sm text-xl font-semibold"
            aria-label="Document title"
            defaultValue={title}
            onBlur={(event) => commitTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="min-w-0 truncate rounded-sm text-left text-xl font-semibold decoration-primary/40 underline-offset-4 hover:underline"
            title="Rename document"
            onClick={() => setEditing(true)}
          >
            {title}
            <span className="sr-only"> — click to rename</span>
          </button>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        <span
          className={cn('hidden items-center gap-1.5 text-xs sm:flex', status.tone)}
          aria-live="polite"
          title={saveError ?? undefined}
        >
          <StatusIcon aria-hidden="true" className="h-3.5 w-3.5" />
          {status.text}
        </span>

        <Button variant="ghost" size="sm" onClick={onNew} disabled={busy !== null}>
          <FilePlus className="h-3.5 w-3.5" />
          New
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setExportOpen(true)} disabled={busy !== null}>
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
        <Button size="sm" onClick={onSave} disabled={busy !== null}>
          {busy === 'save' ? <Spinner /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          disabled={!documentId || busy !== null}
          aria-label="Delete document"
          title="Delete document"
        >
          {busy === 'delete' ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <DocumentExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}
