import { useRef, useState, type DragEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import { formatBytes, formatDateTime } from '@/lib/text';
import { errorMessage } from '@/services/contracts';
import {
  deleteUpload,
  listUploads,
  uploadContentUrl,
  uploadPdf,
  type UploadItem,
} from '@/services/userProfile';
import { Download, FileUp, Paperclip, Trash2, Upload } from 'lucide-react';

const PAGE_SIZE = 20;

/**
 * UploadsSection — the user's PDF library, stored server-side.
 *
 * Unlike the editor's Library panel, which keeps files in the browser session
 * only, these live in the API and survive a new device. Uploading goes
 * straight through the API's own validation: it rejects anything that is not
 * a real PDF regardless of what the browser labels it.
 */
export function UploadsSection({
  uploads,
  totalKnown,
  onChanged,
}: {
  uploads: UploadItem[];
  totalKnown: number;
  /** Signals that the usage totals shown elsewhere are now stale. */
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [items, setItems] = useState(uploads);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const canLoadMore = !exhausted && items.length < totalKnown;

  const addFiles = async (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;

    setBusy(true);
    const stored: UploadItem[] = [];
    const failures: string[] = [];

    // Sequential rather than parallel: the server enforces a size ceiling per
    // request, and a queue of large PDFs firing at once is the easiest way to
    // make several of them fail together.
    for (const file of selected) {
      try {
        const response = await uploadPdf(file);
        stored.push(response.upload);
      } catch (error) {
        failures.push(`${file.name}: ${errorMessage(error, 'Upload failed')}`);
      }
    }

    if (stored.length > 0) {
      setItems((previous) => [...stored, ...previous]);
      onChanged();
      toast({
        title: `Uploaded ${stored.length} file${stored.length === 1 ? '' : 's'}`,
        variant: 'success',
      });
    }
    if (failures.length > 0) {
      toast({
        title: `${failures.length} file${failures.length === 1 ? '' : 's'} rejected`,
        description: failures.join(' · '),
        variant: 'error',
      });
    }
    setBusy(false);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    void addFiles(event.dataTransfer?.files ?? null);
  };

  const onDelete = async (upload: UploadItem) => {
    const confirmed = await confirm({
      title: `Delete ${upload.filename}?`,
      description: 'The file is removed from your library and cannot be recovered.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await deleteUpload(upload.id);
      setItems((previous) => previous.filter((item) => item.id !== upload.id));
      onChanged();
      toast({ title: `Deleted ${upload.filename}`, variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not delete the file',
        description: errorMessage(error, 'Request failed'),
        variant: 'error',
      });
    }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const response = await listUploads(PAGE_SIZE, items.length);
      const fetched = response.uploads ?? [];
      if (fetched.length === 0) setExhausted(true);
      setItems((previous) => [...previous, ...fetched]);
    } catch (error) {
      toast({
        title: 'Could not load more files',
        description: errorMessage(error, 'Request failed'),
        variant: 'error',
      });
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-md font-semibold">Uploaded PDFs</h2>
        <p className="text-xs text-muted-foreground">
          {totalKnown} {totalKnown === 1 ? 'file' : 'files'}
        </p>
      </div>

      <div
        className={cn(
          'mt-3 rounded-lg border-2 border-dashed p-4 text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <Upload aria-hidden="true" className="mx-auto mb-1.5 h-5 w-5 text-muted-foreground" />
        <p className="text-sm font-medium">Drop PDFs here</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Stored on your account and available from any device
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? <Spinner /> : <FileUp aria-hidden="true" />}
          {busy ? 'Uploading…' : 'Choose files'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(event) => {
            void addFiles(event.target.files);
            // Clearing lets the same file be picked again after a delete.
            event.target.value = '';
          }}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Paperclip}
          title="No files yet"
          description="PDFs you upload are kept with your account."
        />
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border/50">
            {items.map((upload) => (
              <li key={upload.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{upload.filename}</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {formatBytes(upload.byte_size)}
                    {upload.created_at && ` · ${formatDateTime(upload.created_at)}`}
                    {upload.document_name && ` · attached to ${upload.document_name}`}
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" asChild>
                  <a
                    href={uploadContentUrl(upload.id)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${upload.filename}`}
                  >
                    <Download aria-hidden="true" className="h-4 w-4" />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => void onDelete(upload)}
                  aria-label={`Delete ${upload.filename}`}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>

          {canLoadMore && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore && <Spinner />}
              {loadingMore ? 'Loading…' : `Show more (${totalKnown - items.length} left)`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
