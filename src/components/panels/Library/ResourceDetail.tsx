import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChatMarkdown } from '@/components/editor/ChatAssistant/ChatMarkdown';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { formatBytes, formatDate, matchOffsets } from '@/lib/text';
import { errorMessage } from '@/api/errors';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  resourceContentUrl,
  resourceDocumentId,
  resourceTextQuery,
  type ResourceAttachmentTarget,
  type ResourceItem,
} from '@/data/resources';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { ExtractionBadge, describeExtraction } from '@/components/common/ExtractionStatus';
import { Highlighted } from './Highlighted';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FolderInput,
  FileInput,
  Inbox,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';

/** The server's ceiling for a PDF's file name. */
const MAX_FILENAME = 255;

/** One window of text per request; the server's own ceiling is far higher. */
const WINDOW_CHARS = 20_000;

/**
 * How far before a search match to start reading.
 *
 * Landing exactly on the offset puts the term on the first line with no
 * lead-in, which is the one position from which a quote cannot be judged.
 */
const MATCH_LEAD_CHARS = 1_200;

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
  ensurePage,
  highlight,
  jumpToOffset,
  onBack,
  backLabel = 'Back to the PDF list',
  onOpenMove,
  moveButtonRef,
  onMove,
  onRename,
  onTrash,
  onRetry,
  readOnly = false,
}: {
  resource: ResourceItem;
  /** The open page's id, or null when it has never been saved. */
  documentId: string | null;
  /** The open page's id, saving the page first when it has none. */
  ensurePage: () => Promise<string | null>;
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
  onRename: (resource: ResourceItem, filename: string) => Promise<ResourceItem>;
  /** Move it to the Trash, with an undo toast; false when the server refused. */
  onTrash: (resource: ResourceItem) => Promise<boolean>;
  onRetry: (resource: ResourceItem, options?: { force?: boolean }) => Promise<ResourceItem>;
  /** A viewer (D6): the PDF opens and reads; nothing moves, renames, converts or trashes it. */
  readOnly?: boolean;
}) {
  const { toast } = useToast();
  const workspaceId = useWorkspaceId();
  const [busy, setBusy] = useState(false);
  /** The file name being typed, while the title is a field. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [activeMatch, setActiveMatch] = useState(0);
  const backRef = useRef<HTMLButtonElement>(null);
  const renameFieldRef = useRef<HTMLInputElement>(null);
  /**
   * Set when Rename is chosen from the actions menu. The menu returns focus to
   * its trigger as it closes, which would blur the new field and end the
   * rename at once; the field takes that focus instead.
   */
  const renameFromMenuRef = useRef(false);
  const textPaneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    queueMicrotask(() => backRef.current?.focus());
  }, []);

  const meta = describeExtraction(resource.extraction.status);
  const readable = resource.extraction.status === 'ready';

  // Opening a resource reads its first window; arriving from a search match
  // reads the window around that match instead, until the author asks for
  // the start.
  const matchStart = jumpToOffset === undefined ? 0 : Math.max(0, jumpToOffset - MATCH_LEAD_CHARS);
  const [fromStart, setFromStart] = useState<{ jumpToOffset: number | undefined } | null>(null);
  const start = fromStart && fromStart.jumpToOffset === jumpToOffset ? 0 : matchStart;
  const windows = useInfiniteQuery({
    ...resourceTextQuery(workspaceId, resource.id, start, WINDOW_CHARS),
    enabled: readable,
  });
  const pages = readable ? (windows.data?.pages ?? []) : [];
  const lastWindow = pages.at(-1);
  const text = {
    text: pages.map((window) => window.text).join(''),
    nextOffset: !readable ? 0 : lastWindow ? (lastWindow.next_offset ?? null) : 0,
    startedAt: pages[0]?.offset ?? start,
    loading: readable && windows.isFetching,
    error: readable && windows.isError ? errorMessage(windows.error, 'Could not read this PDF') : null,
  };
  const readFromStart = () => setFromStart({ jumpToOffset });
  const readMore = () => void windows.fetchNextPage();

  /** Move the PDF onto this page (saving the page first), or back to Unfiled. */
  const onMoveHere = async (here: boolean) => {
    setBusy(true);
    try {
      const pageId = here ? await ensurePage() : null;
      if (here && !pageId) throw new Error('This page could not be saved. Try again.');
      const updated = await onMove(resource.id, pageId ? { documentId: pageId } : {});
      toast({
        title: here ? `Moved ${updated.filename} to this page` : `Moved ${updated.filename} to Unfiled`,
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: 'Could not move the PDF',
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
      if (updated.extraction.status === 'ready') {
        toast({ title: `${updated.filename} is ready to read`, variant: 'success' });
      } else {
        toast({
          title: 'Still could not convert this PDF',
          description: updated.extraction.error ?? undefined,
          variant: 'warning',
        });
      }
    } catch (error) {
      toast({
        title: 'Could not convert this PDF',
        description: errorMessage(error, 'Request failed'),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const startRename = () => {
    renameFromMenuRef.current = true;
    setRenaming(resource.filename);
  };

  const commitRename = async () => {
    if (renaming === null) return;
    const filename = renaming.trim();
    setRenaming(null);
    queueMicrotask(() => backRef.current?.focus());
    if (!filename || filename === resource.filename) return;
    setBusy(true);
    try {
      const updated = await onRename(resource, filename);
      toast({ title: `Renamed to ${updated.filename}`, variant: 'success' });
    } catch (error) {
      toast({ title: 'Could not rename the PDF', description: errorMessage(error, 'Request failed'), variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  /** No confirmation: the Trash gives it back, and the toast's Undo does at once. */
  const onMoveToTrash = async () => {
    setBusy(true);
    // On success the parent leaves this view; touching state afterwards is a
    // warning with nothing to fix.
    if (!(await onTrash(resource))) setBusy(false);
  };

  // Match stepping. The window opens 1 200 characters before the hit, so
  // without this the term the reader searched for is somewhere below the fold
  // of a 20 000-character pane with nothing pointing at it.
  const matches = useMemo(
    () => matchOffsets(text.text, highlight ?? ''),
    [text.text, highlight],
  );

  // Another PDF or another term starts at its first match.
  const [matchesFor, setMatchesFor] = useState({ highlight, resourceId: resource.id });
  if (matchesFor.highlight !== highlight || matchesFor.resourceId !== resource.id) {
    setMatchesFor({ highlight, resourceId: resource.id });
    setActiveMatch(0);
  }

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

  const { location } = resource;
  const onThisPage = documentId !== null && resourceDocumentId(resource) === documentId;
  const facts = [
    formatBytes(resource.byte_size),
    resource.extraction.pages ? `${resource.extraction.pages} pages` : null,
    resource.extraction.chars ? `${resource.extraction.chars.toLocaleString()} chars` : null,
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
          {renaming !== null ? (
            <Input
              ref={renameFieldRef}
              value={renaming}
              maxLength={MAX_FILENAME}
              aria-label="File name"
              className="mt-1 h-7 text-xs"
              onChange={(event) => setRenaming(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={() => void commitRename()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void commitRename();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setRenaming(null);
                  queueMicrotask(() => backRef.current?.focus());
                }
              }}
            />
          ) : resource.title ? (
            <p className="truncate text-xs text-muted-foreground">{resource.filename}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <ExtractionBadge
          status={resource.extraction.status}
          error={resource.extraction.error}
          describe
        />
        <span>{facts.join(' · ')}</span>
        <span aria-hidden="true">·</span>
        <span>
          {location.kind === 'collection' ? (
            <>
              In <span className="text-foreground">{location.collection_name ?? 'a collection'}</span>
            </>
          ) : onThisPage ? (
            'On this page'
          ) : location.kind === 'document' ? (
            <>
              On <span className="text-foreground">{location.document_name ?? 'another page'}</span>
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
          <a href={resourceContentUrl(workspaceId, resource.id)} target="_blank" rel="noreferrer noopener">
            <ExternalLink aria-hidden="true" />
            Open PDF
          </a>
        </Button>
        {!readOnly && (
        <>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={() => void onMoveHere(!onThisPage)}
        >
          {onThisPage ? <Inbox aria-hidden="true" /> : <FileInput aria-hidden="true" />}
          {onThisPage ? 'Move to Unfiled' : 'Move to this page'}
        </Button>
        <Button
          ref={moveButtonRef}
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={onOpenMove}
        >
          <FolderInput aria-hidden="true" />
          Move to…
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="icon" size="icon-sm" disabled={busy} aria-label={`More actions for ${resource.filename}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (!renameFromMenuRef.current) return;
              renameFromMenuRef.current = false;
              event.preventDefault();
              renameFieldRef.current?.focus();
            }}
          >
            <DropdownMenuItem onSelect={startRename}>
              <Pencil aria-hidden="true" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={() => void onMoveToTrash()}>
              <Trash2 aria-hidden="true" />
              Move to Trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </>
        )}
      </div>

      {!readable && (
        <Alert
          variant={resource.extraction.status === 'unsupported' ? 'destructive' : 'warning'}
          role="status"
        >
          <p className="font-medium">{meta.hint}</p>
          {resource.extraction.error && (
            <p className="mt-1 break-words text-xs opacity-90">{resource.extraction.error}</p>
          )}
          {meta.retry !== 'none' && !readOnly && (
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
                <Button variant="ghost" size="xs" onClick={readFromStart}>
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
              <p className="py-4 text-xs text-muted-foreground">This PDF has no text.</p>
            )}

            {text.nextOffset !== null && text.text && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full"
                disabled={text.loading}
                onClick={readMore}
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
