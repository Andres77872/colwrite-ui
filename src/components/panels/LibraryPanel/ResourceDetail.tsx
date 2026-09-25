import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChatMarkdown } from '@/components/editor/ChatAssistant/ChatMarkdown';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import { formatBytes, formatDate, matchOffsets } from '@/lib/text';
import { errorMessage } from '@/services/contracts';
import {
  readResourceMarkdown,
  resourceContentUrl,
  type ResourceAttachmentTarget,
  type ResourceItem,
} from '@/services/resources';
import { DELETE_RESOURCE_WARNING } from '@/services/resourceCopy';
import { ExtractionBadge, describeExtraction } from '@/components/common/ExtractionStatus';
import { Highlighted } from './Highlighted';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FolderInput,
  Link2,
  Link2Off,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from 'lucide-react';

/** One window of text per request; the server's own ceiling is far higher. */
const WINDOW_CHARS = 20_000;

/**
 * How far before a search match to start reading.
 *
 * Landing exactly on the offset puts the term on the first line with no
 * lead-in, which is the one position from which a quote cannot be judged.
 */
const MATCH_LEAD_CHARS = 1_200;

type TextState = {
  text: string;
  nextOffset: number | null;
  totalChars: number;
  startedAt: number;
  loading: boolean;
  error: string | null;
};

const EMPTY_TEXT: TextState = {
  text: '',
  nextOffset: 0,
  totalChars: 0,
  startedAt: 0,
  loading: false,
  error: null,
};

/**
 * ResourceDetail — one PDF: its state, its text, and what can be done to it.
 *
 * The text pane is the point of the whole panel. It is the same Markdown the
 * assistant reads, so what is shown here is exactly what it can quote — a
 * writer who cannot see that has no way to tell a file the agent is ignoring
 * from one it simply found nothing in.
 */
export function ResourceDetail({
  resource,
  documentId,
  highlight,
  jumpToOffset,
  onBack,
  backLabel = 'Back to the file list',
  onOpenMove,
  moveButtonRef,
  onMove,
  onDeleted,
  onRetry,
}: {
  resource: ResourceItem;
  /** The open document, or null when it has never been saved to the server. */
  documentId: string | null;
  /** Search term to mark in the text, when arrived at from a match. */
  highlight?: string;
  /** Character offset to open at, when arrived at from a match. */
  jumpToOffset?: number;
  onBack: () => void;
  /** Where the back arrow goes, as its accessible name. */
  backLabel?: string;
  onOpenMove: () => void;
  moveButtonRef?: RefObject<HTMLButtonElement | null>;
  onMove: (resourceId: number, target?: ResourceAttachmentTarget) => Promise<ResourceItem>;
  onDeleted: (resourceId: number) => Promise<void>;
  onRetry: (resource: ResourceItem, options?: { force?: boolean }) => Promise<ResourceItem>;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [text, setText] = useState<TextState>(EMPTY_TEXT);
  const [busy, setBusy] = useState(false);
  const [activeMatch, setActiveMatch] = useState(0);
  const backRef = useRef<HTMLButtonElement>(null);
  const textPaneRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    queueMicrotask(() => backRef.current?.focus());
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const meta = describeExtraction(resource.extraction_status);
  const readable = resource.extraction_status === 'ready';

  const loadWindow = useCallback(
    async (offset: number, { append }: { append: boolean }) => {
      const request = ++requestRef.current;
      setText((previous) => ({
        ...(append ? previous : EMPTY_TEXT),
        startedAt: append ? previous.startedAt : offset,
        loading: true,
        error: null,
      }));
      try {
        const window = await readResourceMarkdown(resource.id, {
          offset,
          limit: WINDOW_CHARS,
        });
        if (!mountedRef.current || request !== requestRef.current) return;
        setText((previous) => ({
          text: append ? previous.text + window.text : window.text,
          nextOffset: window.next_offset,
          totalChars: window.total_chars,
          startedAt: append ? previous.startedAt : window.offset,
          loading: false,
          error: null,
        }));
      } catch (error) {
        if (!mountedRef.current || request !== requestRef.current) return;
        setText((previous) => ({
          ...previous,
          loading: false,
          error: errorMessage(error, 'Could not read this file'),
        }));
      }
    },
    [resource.id],
  );

  // Opening a resource loads its first window; arriving from a search match
  // loads the window around that match instead.
  useEffect(() => {
    if (!readable) {
      setText(EMPTY_TEXT);
      return;
    }
    const start =
      jumpToOffset === undefined ? 0 : Math.max(0, jumpToOffset - MATCH_LEAD_CHARS);
    void loadWindow(start, { append: false });
  }, [readable, jumpToOffset, loadWindow]);

  const onAttach = async (attached: boolean) => {
    if (!documentId) return;
    setBusy(true);
    try {
      const updated = await onMove(resource.id, attached ? { documentId } : {});
      toast({
        title: attached
          ? `${updated.filename} is now attached to this document`
          : `${updated.filename} moved to Unfiled`,
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: 'Could not change the attachment',
        description: errorMessage(error, 'Request failed'),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const onRetryClick = async () => {
    setBusy(true);
    try {
      const updated = await onRetry(resource, { force: meta.retry === 'force' });
      if (updated.extraction_status === 'ready') {
        toast({ title: `${updated.filename} is ready to read`, variant: 'success' });
      } else {
        toast({
          title: 'Still could not convert this file',
          description: updated.extraction_error ?? undefined,
          variant: 'warning',
        });
      }
    } catch (error) {
      toast({
        title: 'Could not convert this file',
        description: errorMessage(error, 'Request failed'),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    const confirmed = await confirm({
      title: `Delete ${resource.filename}?`,
      description: DELETE_RESOURCE_WARNING,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await onDeleted(resource.id);
      toast({ title: `Deleted ${resource.filename}`, variant: 'success' });
      // No `setBusy(false)`: the parent unmounts this view on success, and
      // touching state afterwards is a warning with nothing to fix.
    } catch (error) {
      toast({
        title: 'Could not delete the file',
        description: errorMessage(error, 'Request failed'),
        variant: 'error',
      });
      setBusy(false);
    }
  };

  // Match stepping. The window opens 1 200 characters before the hit, so
  // without this the term the reader searched for is somewhere below the fold
  // of a 20 000-character pane with nothing pointing at it.
  const matches = useMemo(
    () => matchOffsets(text.text, highlight ?? ''),
    [text.text, highlight],
  );

  useEffect(() => {
    setActiveMatch(0);
  }, [highlight, resource.id]);

  useEffect(() => {
    if (matches.length === 0) return;
    const mark = textPaneRef.current?.querySelector('[data-active-match]');
    // Guarded rather than called outright: not every environment this renders
    // in implements scrollIntoView, and failing to scroll is not a reason to
    // take the pane down with it.
    if (mark instanceof HTMLElement && typeof mark.scrollIntoView === 'function') {
      mark.scrollIntoView({ block: 'center' });
    }
  }, [activeMatch, matches.length]);

  const stepMatch = (delta: number) => {
    if (matches.length === 0) return;
    setActiveMatch((previous) => (previous + delta + matches.length) % matches.length);
  };

  const attachedHere = documentId !== null && resource.document_id === documentId;
  const facts = [
    formatBytes(resource.byte_size),
    resource.extraction_pages ? `${resource.extraction_pages} pages` : null,
    resource.extraction_chars ? `${resource.extraction_chars.toLocaleString()} chars` : null,
    resource.created_at ? formatDate(resource.created_at) : null,
  ].filter(Boolean);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      {/* One header row: the way back and the file's title. */}
      <div className="-ml-1 flex items-start gap-1 pt-1.5">
        <Button
          ref={backRef}
          variant="icon"
          size="icon-sm"
          className="shrink-0"
          onClick={onBack}
          aria-label={backLabel}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1 pt-1">
          {/* A heading, not a paragraph: this is the title of the view. */}
          <h3 className="text-sm font-semibold leading-snug break-words">
            {resource.title || resource.filename}
          </h3>
          {resource.title && (
            <p className="truncate text-xs text-muted-foreground">{resource.filename}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ExtractionBadge
          status={resource.extraction_status}
          error={resource.extraction_error}
          describe
        />
        <span>{facts.join(' · ')}</span>
        <span aria-hidden="true">·</span>
        <span>
          {resource.collection_name ? (
            <>
              In <span className="text-foreground">{resource.collection_name}</span>
            </>
          ) : resource.document_name ? (
            <>
              Attached to <span className="text-foreground">{resource.document_name}</span>
            </>
          ) : (
            'Unfiled'
          )}
        </span>
      </div>

      {/* A quiet action row: the everyday actions as ghost buttons, the
          destructive one behind "…" where it cannot be hit by accident. */}
      <div className="-ml-2 flex flex-wrap items-center gap-0.5">
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" asChild>
          <a href={resourceContentUrl(resource.id)} target="_blank" rel="noreferrer noopener">
            <ExternalLink aria-hidden="true" />
            Open PDF
          </a>
        </Button>
        {documentId && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={() => void onAttach(!attachedHere)}
          >
            {attachedHere ? <Link2Off aria-hidden="true" /> : <Link2 aria-hidden="true" />}
            {attachedHere ? 'Detach to Unfiled' : 'Attach to page'}
          </Button>
        )}
        <Button
          ref={moveButtonRef}
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={onOpenMove}
        >
          <FolderInput aria-hidden="true" />
          Move…
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="icon" size="icon-sm" disabled={busy} aria-label={`More actions for ${resource.filename}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem destructive onSelect={() => void onDelete()}>
              <Trash2 aria-hidden="true" />
              Delete file
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!readable && (
        <Alert
          variant={resource.extraction_status === 'unsupported' ? 'destructive' : 'warning'}
          role="status"
        >
          <p className="font-medium">{meta.hint}</p>
          {resource.extraction_error && (
            <p className="mt-1 break-words text-xs opacity-90">{resource.extraction_error}</p>
          )}
          {meta.retry !== 'none' && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={busy}
              onClick={() => void onRetryClick()}
            >
              {busy ? <Spinner /> : <RefreshCw aria-hidden="true" />}
              {meta.retry === 'force' ? 'Try converting anyway' : 'Convert now'}
            </Button>
          )}
        </Alert>
      )}

      {readable && (
        <div className="flex min-h-0 flex-1 flex-col pt-1">
          <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Extracted text
              {/* A reader has no use for a character offset. What they want to
                  know is whether they are looking at the start of the file. */}
              {text.startedAt > 0 && <span className="ml-1 font-normal">· partway through</span>}
            </p>
            <div className="flex items-center gap-1">
              {matches.length > 0 && (
                <>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {activeMatch + 1} of {matches.length}
                  </span>
                  <Button
                    variant="icon"
                    size="icon-xs"
                    onClick={() => stepMatch(-1)}
                    aria-label="Previous match"
                  >
                    <ChevronUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="icon"
                    size="icon-xs"
                    onClick={() => stepMatch(1)}
                    aria-label="Next match"
                  >
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </>
              )}
              {text.startedAt > 0 && (
                <Button variant="ghost" size="xs" onClick={() => void loadWindow(0, { append: false })}>
                  To start
                </Button>
              )}
            </div>
          </div>

          <div
            ref={textPaneRef}
            className="-mr-2 min-h-0 flex-1 overflow-y-auto py-1 pr-2"
            aria-busy={text.loading}
          >
            {text.error ? (
              <Alert variant="destructive">{text.error}</Alert>
            ) : text.text ? (
              matches.length > 0 ? (
                // Arrived from a search: the plain text, so every match can be
                // marked and stepped through.
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                  <Highlighted
                    text={text.text}
                    needle={highlight ?? ''}
                    activeIndex={activeMatch}
                  />
                </p>
              ) : (
                <ChatMarkdown
                  text={text.text}
                  className="break-words text-sm leading-6 text-muted-foreground [&_h3]:text-md [&_h4]:text-sm [&_h5]:text-sm"
                />
              )
            ) : text.loading ? (
              // The one announcement of this. There used to be a second,
              // sr-only copy alongside it, so a screen reader said it twice.
              <p role="status" className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <Spinner />
                Reading…
              </p>
            ) : (
              <p className="py-4 text-xs text-muted-foreground">This file has no text.</p>
            )}

            {text.nextOffset !== null && text.text && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full"
                disabled={text.loading}
                onClick={() => void loadWindow(text.nextOffset as number, { append: true })}
              >
                {text.loading && <Spinner />}
                {text.loading ? 'Reading…' : 'Read more'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
