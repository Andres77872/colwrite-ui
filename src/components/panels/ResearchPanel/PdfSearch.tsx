import { useEffect, useRef, useState } from 'react';
import { FileSearch, FileText, FolderOpen, Upload } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { PDF_ACCEPT, partitionPdfs, skippedNonPdfMessage } from '@/lib/fileDrop';
import { errorMessage } from '@/services/contracts';
import { attachResource, listResources, uploadResource, type ResourceItem } from '@/services/resources';
import { ExtractionBadge } from '@/components/common/ExtractionStatus';
import { SearchResults } from '../LibraryPanel/LibraryResources';
import type { LibraryFocus } from '../LibraryPanel/LibraryPanel';
import { ResultsSkeleton } from '../shared';
import type { PdfSearch } from './usePdfSearch';

/**
 * Upload straight from Research: into the open document when it has been
 * saved (so the assistant can read it here), otherwise into Unfiled.
 */
function UploadButton({ documentId }: { documentId: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  const upload = async (files: FileList | null) => {
    const { pdfs, skipped } = partitionPdfs(files);
    const skippedMessage = skippedNonPdfMessage(skipped);
    if (skippedMessage) toast({ ...skippedMessage, variant: 'warning' });
    if (pdfs.length === 0) return;
    setUploading(true);
    const failures: string[] = [];
    let stored = 0;
    for (const file of pdfs) {
      try {
        await uploadResource(file, { documentId });
        stored += 1;
      } catch (caught) {
        failures.push(`${file.name}: ${errorMessage(caught, 'upload failed')}`);
      }
    }
    setUploading(false);
    if (stored > 0) {
      toast({
        title: `Uploaded ${stored} file${stored === 1 ? '' : 's'}`,
        description: `${documentId ? 'Attached to this document' : 'Added to Unfiled'}. Converting to text now.`,
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
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        disabled={uploading}
        onClick={() => input.current?.click()}
      >
        {uploading ? <Spinner /> : <Upload aria-hidden="true" />}
        {uploading ? 'Uploading…' : 'Upload PDF'}
      </Button>
      <input
        ref={input}
        type="file"
        accept={PDF_ACCEPT}
        multiple
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          void upload(event.target.files);
          event.target.value = '';
        }}
      />
    </>
  );
}

/**
 * The newest PDFs on the account, so "Library" opens on the files rather than
 * on an empty search prompt. Quietly empty when the list cannot be read: the
 * search below still works, and "Manage files" shows the real error.
 */
function useRecentPdfs(enabled: boolean) {
  const [recent, setRecent] = useState<ResourceItem[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    listResources({ scope: 'library', limit: 8 })
      .then((page) => !cancelled && setRecent(page.resources ?? []))
      .catch(() => !cancelled && setRecent([]));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return recent;
}

function RecentPdfs({ items, onOpen }: { items: ResourceItem[]; onOpen: (resourceId: number) => void }) {
  return (
    <section aria-label="Recent PDFs">
      <h3 className="px-0.5 pb-1 text-xs font-medium text-muted-foreground">Recent</h3>
      <ul className="-mx-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              data-library-resource-id={item.id}
              onClick={() => onOpen(item.id)}
              className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium leading-snug" title={item.title || item.filename}>
                  {item.title || item.filename}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {item.extraction_pages ? (
                    <span className="shrink-0">
                      {item.extraction_pages} pages<span aria-hidden="true">&nbsp;·</span>
                    </span>
                  ) : null}
                  {item.extraction_status !== 'ready' && (
                    <ExtractionBadge status={item.extraction_status} error={item.extraction_error} />
                  )}
                  <span className="min-w-0 truncate">{item.filename}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PdfResults({
  state,
  documentId,
  onManage,
}: {
  state: PdfSearch;
  documentId: string | null;
  onManage: (target: LibraryFocus | null) => void;
}) {
  const { toast } = useToast();
  const recent = useRecentPdfs(!state.result);
  const attach = async (resourceId: number) => {
    if (!documentId) return;
    try {
      const updated = await attachResource(resourceId, { documentId });
      toast({ title: `${updated.title || updated.filename} is attached to this page`, variant: 'success' });
    } catch (caught) {
      toast({ title: 'Could not attach the file', description: errorMessage(caught, 'Request failed'), variant: 'error' });
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-2 px-2">
      <div className="-mx-2 flex items-center gap-0.5">
        <UploadButton documentId={documentId} />
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onManage(null)}>
          <FolderOpen aria-hidden="true" />
          Manage files
        </Button>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.loading && !state.result && <ResultsSkeleton />}
      {state.result ? (
        <div aria-busy={state.loading} className={state.loading ? 'pointer-events-none opacity-50' : undefined}>
          <SearchResults
            result={state.result}
            loadingMore={state.loadingMore}
            onLoadMore={() => void state.loadMore()}
            onOpen={(resourceId, offset, term) => onManage({ resourceId, offset, term })}
            onOpenResource={(resourceId) => onManage({ resourceId })}
            onAttach={documentId ? (resourceId) => void attach(resourceId) : undefined}
          />
        </div>
      ) : (
        !state.loading &&
        !state.error &&
        recent !== null &&
        (recent.length > 0 ? (
          <RecentPdfs items={recent} onOpen={(resourceId) => onManage({ resourceId })} />
        ) : (
          <EmptyState
            icon={FileSearch}
            title="Search inside your PDFs"
            description="Every PDF you uploaded, searched word for word. Open a match to read it in context."
          />
        ))
      )}
    </div>
  );
}
