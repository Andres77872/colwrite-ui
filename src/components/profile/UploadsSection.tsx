import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import { formatBytes, formatDateTime } from '@/lib/text';
import { PDF_ACCEPT, partitionPdfs, skippedNonPdfMessage } from '@/lib/fileDrop';
import { createPollSchedule } from '@/lib/pollSchedule';
import { useFileDropZone } from '@/hooks/useFileDropZone';
import { usePagedList } from '@/hooks/usePagedList';
import { describeApiError } from '@/services/contracts';
import {
  deleteResource,
  extractResource,
  getResource,
  isSettling,
  listResources,
  resourceContentUrl,
  uploadResource,
  type ResourceItem,
} from '@/services/resources';
import { DELETE_RESOURCE_WARNING } from '@/services/resourceCopy';
import { ExtractionBadge, describeExtraction } from '@/components/common/ExtractionStatus';
import { Download, FileUp, Paperclip, RefreshCw, Trash2, Upload } from 'lucide-react';

const PAGE_SIZE = 20;

const keyOfUpload = (upload: ResourceItem) => upload.id;

/**
 * UploadsSection — the user's PDF library, stored server-side.
 *
 * The same files the editor's Library panel works with; this is the account
 * view of them. Uploading goes straight through the API's own validation,
 * which rejects anything that is not a real PDF regardless of what the
 * browser labels it.
 *
 * Every file also carries an extraction state, because storing a PDF and the
 * assistant being able to read it are two different things: a scan with no
 * text layer uploads perfectly and is never readable. The badge is the only
 * place that distinction is visible.
 */
export function UploadsSection({
  uploads,
  totalKnown,
  onChanged,
}: {
  uploads: ResourceItem[];
  totalKnown: number;
  /** Signals that the usage totals shown elsewhere are now stale. */
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { items, serverOffset, appendPage, prepend, remove, update } = usePagedList({
    first: uploads,
    keyOf: keyOfUpload,
  });
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const canLoadMore = !exhausted && items.length < totalKnown;

  // A file that was just uploaded arrives `pending` and becomes readable a
  // moment later. Without this the badge would stay on "Queued" until the
  // page is reloaded, which reads as a conversion that never ran.
  const settlingIds = items.filter(isSettling).map((item) => item.id);
  const settlingKey = settlingIds.join(',');
  // The same backoff the library panel uses. This used to be a flat 4s with no
  // ceiling, so one stuck file kept asking for as long as the page was open.
  const scheduleRef = useRef(createPollSchedule());
  useEffect(() => {
    if (!settlingKey) {
      scheduleRef.current.reset();
      return;
    }
    const schedule = scheduleRef.current;
    if (schedule.exhausted()) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (ids: number[]) => {
      const refreshed = await Promise.all(
        ids.map(async (id) => {
          try {
            return await getResource(id);
          } catch {
            // A file deleted from another tab, or a transient request failure:
            // keep asking while this section remains mounted.
            return null;
          }
        }),
      );
      if (cancelled) return;
      update(refreshed.filter((item) => item !== null));

      const nextIds = ids.filter((_id, index) => {
        const item = refreshed[index];
        return item === null || isSettling(item);
      });
      if (nextIds.length > 0 && !schedule.exhausted()) {
        schedule.advance();
        timer = setTimeout(() => void poll(nextIds), schedule.delay());
      }
    };

    timer = setTimeout(() => void poll(settlingKey.split(',').map(Number)), schedule.delay());
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [settlingKey, update]);

  const addFiles = useCallback(
    async (files: FileList | null) => {
      // Filtered client-side, the way the library panel does it. Posting
      // whatever was dropped and reporting the server's rejections one by one
      // made "you dropped a folder of mixed files" look like six failures.
      const { pdfs, skipped } = partitionPdfs(files);
      const skippedMessage = skippedNonPdfMessage(skipped);
      if (skippedMessage) toast({ ...skippedMessage, variant: 'warning' });
      if (pdfs.length === 0) return;

      setBusy(true);
      const stored: ResourceItem[] = [];
      const failures: string[] = [];

      // Sequential rather than parallel: the server enforces a size ceiling per
      // request, and a queue of large PDFs firing at once is the easiest way to
      // make several of them fail together.
      for (const file of pdfs) {
        try {
          stored.push(await uploadResource(file, {}));
        } catch (error) {
          failures.push(`${file.name}: ${describeApiError(error, 'Upload failed')}`);
        }
      }

      if (stored.length > 0) {
        prepend(stored);
        onChanged();
        toast({
          title: `Uploaded ${stored.length} file${stored.length === 1 ? '' : 's'}`,
          description: 'Converting to text now.',
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
    },
    [onChanged, prepend, toast],
  );

  const { dragOver, dropHandlers } = useFileDropZone({
    onFiles: (files) => void addFiles(files),
    disabled: busy,
  });

  const onDelete = async (upload: ResourceItem) => {
    const confirmed = await confirm({
      title: `Delete ${upload.filename}?`,
      description: DELETE_RESOURCE_WARNING,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await deleteResource(upload.id);
      remove(upload.id);
      onChanged();
      toast({ title: `Deleted ${upload.filename}`, variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not delete the file',
        description: describeApiError(error, 'Request failed'),
        variant: 'error',
      });
    }
  };

  /**
   * Retry a conversion from here.
   *
   * The status vocabulary already says which failures are worth retrying; the
   * affordance just existed only in the editor's detail view, so a dashboard
   * showing "Failed" offered no way to act on it.
   */
  const onRetry = async (upload: ResourceItem) => {
    const meta = describeExtraction(upload.extraction_status);
    setRetrying(upload.id);
    try {
      const updated = await extractResource(upload.id, { force: meta.retry === 'force' });
      update([updated]);
      if (updated.extraction_status === 'ready') {
        toast({ title: `${updated.filename} is ready to read`, variant: 'success' });
      } else {
        toast({
          title: 'Still could not convert this file',
          description: updated.extraction_error ?? undefined,
          variant: 'warning',
        });
      }
      onChanged();
    } catch (error) {
      toast({
        title: 'Could not convert this file',
        description: describeApiError(error, 'Request failed'),
        variant: 'error',
      });
    } finally {
      setRetrying(null);
    }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const response = await listResources({
        scope: 'library',
        limit: PAGE_SIZE,
        offset: serverOffset,
      });
      const fetched = response.resources ?? [];
      if (fetched.length === 0) setExhausted(true);
      appendPage(fetched);
    } catch (error) {
      toast({
        title: 'Could not load more files',
        description: describeApiError(error, 'Request failed'),
        variant: 'error',
      });
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-md font-semibold">Resources</h2>
        <p className="text-xs text-muted-foreground">
          {totalKnown} {totalKnown === 1 ? 'file' : 'files'}
        </p>
      </div>

      <div
        className={cn(
          'mt-3 rounded-lg border-2 border-dashed p-4 text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border',
        )}
        {...dropHandlers}
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
          accept={PDF_ACCEPT}
          multiple
          className="sr-only"
          // An unlabelled file input. The library panel's equivalent has always
          // had this; this one was simply missed.
          aria-label="Add PDFs to your library"
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
            {items.map((upload) => {
              const meta = describeExtraction(upload.extraction_status);
              return (
                <li
                  key={upload.id}
                  className="flex items-center gap-3 rounded-md py-2.5 transition-colors hover:bg-accent/40 has-focus-visible:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {upload.title || upload.filename}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-muted-foreground">
                      <ExtractionBadge
                        status={upload.extraction_status}
                        error={upload.extraction_error}
                        describe
                      />
                      <span>
                        {formatBytes(upload.byte_size)}
                        {upload.extraction_pages ? ` · ${upload.extraction_pages} pages` : ''}
                        {upload.created_at && ` · ${formatDateTime(upload.created_at)}`}
                        {upload.document_name && ` · attached to ${upload.document_name}`}
                        {upload.collection_name && ` · shared via ${upload.collection_name}`}
                      </span>
                    </p>
                  </div>
                  {meta.retry !== 'none' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={retrying === upload.id}
                      onClick={() => void onRetry(upload)}
                    >
                      {retrying === upload.id ? (
                        <Spinner />
                      ) : (
                        <RefreshCw aria-hidden="true" />
                      )}
                      {meta.retry === 'force' ? 'Try anyway' : 'Convert'}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon-sm" asChild>
                    <a
                      href={resourceContentUrl(upload.id)}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`Open ${upload.filename} in a new tab`}
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
              );
            })}
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
