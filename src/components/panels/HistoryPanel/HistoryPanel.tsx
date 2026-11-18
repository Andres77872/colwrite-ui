import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  kindLabel as blockKindLabel,
  kindOf,
  useDocumentActions,
  useDocumentId,
  useDocumentSession,
  useDocumentStatus,
  useEditorDoc,
} from '@/editor';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import type { Block, Doc } from '@/editor';
import { ProposalsContext } from '@/editor/proposalsContextState';
import { PanelsContext } from '../panelsContextState';
import { formatDateTime } from '@/lib/text';
import { describeApiError } from '@/api/errors';
import { isRetryableProblem } from '@/api/retry';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type RevisionChange,
  type RevisionSummary,
  adoptHead,
  diffRevision,
  documentHeadQuery,
  getRevision,
  historyKeys,
  isStaleHead,
  refreshHistory,
  restoreRevision,
  revisionsQuery,
} from '@/data/documentHistory';
import {
  ProposedBlockView,
  ProposedRewriteView,
  WidgetChip,
} from '@/components/editor/Review/ProposedBlockView';
import { createWidgetTable, diffPieces, diffableText, type DiffPiece } from '@/components/editor/Review/diffText';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import {
  AlertCircle,
  ArrowDownUp,
  GitBranch,
  History,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { buildVersionGraph, type VersionGraphRow } from './versionGraph';
import { distinctSummary, kindLabel, revisionTime } from './revisionLabels';
import { RAIL_ROW_HEIGHT, VersionGraphRail, VersionGraphTail } from './VersionGraphRail';

/**
 * HistoryPanel — the document's version tree.
 *
 * Every accepted save is an immutable server-side snapshot that records the
 * version it grew out of, so history is a tree rather than a line. The panel
 * lists revisions newest first with a graph rail showing that lineage, marks
 * the version the document currently sits on, shows what each one changed (or
 * how it differs from the current state), and switches between them.
 *
 * Restoring moves the document's current-version pointer; it writes no
 * revision and removes nothing, so the list does not grow. The next save
 * writes a revision whose parent is the restored one — a new branch.
 */

const PAGE_SIZE = 30;

const CHILD_LABELS: Record<string, string> = {
  citation: 'Citation',
  equation: 'Equation',
  table: 'Table',
  graph: 'Chart',
  aiBeat: 'AI passage',
};

/** Block types by the names the author knows them by, when no block is at hand. */
const BLOCK_TYPE_LABELS: Record<string, string> = {
  paragraph: 'Text',
  heading: 'Heading',
  code: 'Code',
  divider: 'Divider',
};

/**
 * What changed, named the way Turn into and the block handle name it — "To-do
 * list", "Diagram", "Figure" — rather than "Paragraph" for everything.
 */
function entityLabel(change: RevisionChange, block: Block | null): string {
  if (change.entity === 'child') {
    return CHILD_LABELS[change.entityType] ?? 'Inline element';
  }
  if (block) return blockKindLabel(block);
  return BLOCK_TYPE_LABELS[change.entityType] ?? 'Block';
}

/** Stable identity for the memo when nothing is loaded yet. */
const NO_REVISIONS: RevisionSummary[] = [];

/** Bound on auto-paging toward the current version — a hint, not a crawl. */
const MAX_REVEAL_PAGES = 10;

export function HistoryPanel() {
  const documentId = useDocumentId();
  const workspaceId = useWorkspaceId();
  const { doc } = useEditorDoc();
  const { lastSavedAt } = useDocumentStatus();
  // A viewer reads every version and restores none (D6: restore is an edit).
  const { restoreEpoch, readOnly } = useDocumentSession();
  const { hasPendingEdits, saveRemote, adoptRestoredDocument } = useDocumentActions();
  const confirm = useConfirm();
  const { toast, dismiss } = useToast();
  // Optional: the panel also renders where there is no review (tests, previews).
  const pendingSuggestions = useContext(ProposalsContext)?.pendingCount ?? 0;
  const panels = useContext(PanelsContext);
  const visible = !panels || (panels.isOpen && panels.activePanel === 'history');

  // Every save and restore gives the open page a new version. A hidden
  // History tab stays mounted and catches up once, when it is shown again,
  // instead of refetching after each autosave.
  const headVersion = `${lastSavedAt ?? ''}:${restoreEpoch}`;
  const [seenVersion, setSeenVersion] = useState(headVersion);
  if (visible && seenVersion !== headVersion) setSeenVersion(headVersion);

  const queryClient = useQueryClient();
  const headQuery = useQuery({ ...documentHeadQuery(workspaceId, documentId ?? ''), enabled: documentId !== null });
  const timelineQuery = useInfiniteQuery({
    ...revisionsQuery(workspaceId, documentId ?? '', PAGE_SIZE),
    enabled: documentId !== null,
  });
  const head = documentId ? (headQuery.data ?? null) : null;
  // Another document's rows are not this one's, even for a moment: each
  // document is a query of its own.
  const timelineData = documentId ? timelineQuery.data : undefined;
  const hasOlder = timelineQuery.hasNextPage;
  const timeline = useMemo(
    () => (timelineData
      ? {
          revisions: timelineData.pages.flatMap((page) => page.revisions),
          nextCursor: hasOlder ? (timelineData.pages.at(-1)?.nextCursor ?? null) : null,
        }
      : null),
    [hasOlder, timelineData],
  );
  const loading = headQuery.isFetching || (timelineQuery.isFetching && !timelineQuery.isFetchingNextPage);
  const loadingMore = timelineQuery.isFetchingNextPage;
  // The request layer already retried what is worth retrying, so this goes
  // to the author with "Check again" rather than starting another timer
  // behind their back.
  const failure = headQuery.error ?? (timelineQuery.isFetchNextPageError ? null : timelineQuery.error);
  const error = documentId && failure
    ? { message: describeApiError(failure, 'Could not load the page history.'), retryable: isRetryableProblem(failure) }
    : null;
  const retryLoad = () => {
    if (documentId) void refreshHistory(queryClient, workspaceId, documentId);
  };

  // A new version seen while the tab is shown: the head and the timeline read
  // again, once. The first read of a document is the queries' own.
  const caughtUp = useRef({ documentId, version: seenVersion });
  useEffect(() => {
    const last = caughtUp.current;
    caughtUp.current = { documentId, version: seenVersion };
    if (!documentId || last.documentId !== documentId || last.version === seenVersion) return;
    void refreshHistory(queryClient, workspaceId, documentId);
  }, [documentId, queryClient, seenVersion, workspaceId]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<{ revisionId: string; message: string } | null>(null);
  const [undoError, setUndoError] = useState<{ message: string; retry: () => void } | null>(null);
  const undoToast = useRef<string | null>(null);
  // Read when "Undo" is pressed, which can be long after the restore.
  const currentDocumentId = useRef(documentId);
  useEffect(() => {
    currentDocumentId.current = documentId;
    // An undo offered for another document must not outlive it.
    return () => {
      if (undoToast.current) dismiss(undoToast.current);
      undoToast.current = null;
    };
  }, [documentId, dismiss]);
  const [revealingCurrent, setRevealingCurrent] = useState(false);

  const revisions = timeline?.revisions ?? NO_REVISIONS;
  const graph = useMemo(() => buildVersionGraph(revisions), [revisions]);
  // The version the document sits on can be deeper than the loaded pages —
  // the panel must say so rather than showing a list with no marker at all.
  const currentPointerLoaded =
    !head?.currentRevisionId
    || revisions.some((revision) => revision.revisionId === head.currentRevisionId);

  const loadMore = async () => {
    if (!documentId || !timeline?.nextCursor) return;
    const result = await timelineQuery.fetchNextPage();
    if (result.isFetchNextPageError) {
      toast({
        title: 'Could not load older versions',
        description: describeApiError(result.error, 'The request failed.'),
        variant: 'error',
      });
    }
  };

  /** Page toward the current version until its row is on screen (bounded). */
  const revealCurrent = async () => {
    const pointer = head?.currentRevisionId;
    if (!documentId || !pointer || !timeline) return;
    setRevealingCurrent(true);
    try {
      let result = { data: timelineQuery.data, hasNextPage: timelineQuery.hasNextPage };
      const loaded = () =>
        result.data?.pages.some((page) => page.revisions.some((revision) => revision.revisionId === pointer)) ?? false;
      for (let pages = 0; result.hasNextPage && !loaded() && pages < MAX_REVEAL_PAGES; pages += 1) {
        const next = await timelineQuery.fetchNextPage();
        if (next.isFetchNextPageError) throw next.error;
        result = next;
      }
    } catch (cause) {
      toast({
        title: 'Could not load the current version',
        description: describeApiError(cause, 'The request failed.'),
        variant: 'error',
      });
    } finally {
      setRevealingCurrent(false);
    }
  };

  /**
   * Move the document onto `target` and adopt what the server returns.
   *
   * Edits waiting for autosave are saved first, so they become a version of
   * their own rather than being lost. Returns the revision the document was
   * on before, which is what "Undo" goes back to.
   */
  const switchVersion = async (
    docId: string,
    target: { revisionId: string; revisionNo: number | null },
  ): Promise<string | null> => {
    if (hasPendingEdits()) await saveRemote();
    // Read after that save: it may have moved the pointer to a new revision.
    const before = await queryClient.fetchQuery({ ...documentHeadQuery(workspaceId, docId), staleTime: 0 });
    const restored = await restoreRevision(workspaceId, docId, target.revisionId, {
      summary: target.revisionNo !== null ? `Restored version ${target.revisionNo}` : 'Undid a restore',
      ...(before.etag ? { etag: before.etag } : {}),
    });
    if (!restored.etag) throw new Error('The server did not provide a concurrency token.');
    adoptRestoredDocument(restored.content, restored.etag);
    setExpandedId(null);
    // No revision was written — only the current-version pointer moved. The
    // returned head already carries it; reading again keeps the marker honest
    // if a save landed in between, and picks up any new rows that save left.
    adoptHead(queryClient, workspaceId, docId, restored);
    void refreshHistory(queryClient, workspaceId, docId);
    return before.currentRevisionId || null;
  };

  /**
   * "the version from Today, 8:32 AM". A version is named by when it was
   * saved, never by its counter.
   */
  const versionFrom = (createdAt: string): string => {
    const when = revisionTime(createdAt);
    return when ? `the version from ${when}` : 'this version';
  };

  const revisionNoOf = (revisionId: string): number | null =>
    revisions.find((candidate) => candidate.revisionId === revisionId)?.revisionNo ?? null;

  const undoRestore = async (docId: string, previous: { revisionId: string; revisionNo: number | null }) => {
    // The author moved on to another page since: nothing here to undo.
    if (currentDocumentId.current !== docId) return;
    setUndoError(null);
    setRestoringId(previous.revisionId);
    try {
      await switchVersion(docId, previous);
      toast({
        title: 'Back on the version you were on',
        variant: 'success',
      });
    } catch (cause) {
      setUndoError({
        message: isStaleHead(cause)
          ? 'The page changed in the meantime, so the restore was not undone. The history has been refreshed.'
          : describeApiError(cause, 'The restore could not be undone.'),
        retry: () => void undoRestore(docId, previous),
      });
      void refreshHistory(queryClient, workspaceId, docId);
    } finally {
      setRestoringId(null);
    }
  };

  const handleRestore = async (revision: RevisionSummary) => {
    if (!documentId) return;
    const docId = documentId;
    const discarded =
      pendingSuggestions > 0
        ? ` ${pendingSuggestions} ${pendingSuggestions === 1 ? 'suggestion' : 'suggestions'} waiting for review will be discarded.`
        : '';
    const confirmed = await confirm({
      title: `Switch to ${versionFrom(revision.createdAt)}?`,
      description: (hasPendingEdits()
        ? 'Your unsaved edits are saved as their own version first, then the page switches to this one. Switching does not create a new version and the history is untouched — your next save starts a new branch from here.'
        : 'The page goes back to this version. Switching does not create a new version and the history is untouched — your next save starts a new branch from here.') + discarded,
      confirmLabel: 'Restore',
    });
    if (!confirmed) return;
    setRestoringId(revision.revisionId);
    setRestoreError(null);
    setUndoError(null);
    try {
      const previousId = await switchVersion(docId, revision);
      const previous =
        previousId && previousId !== revision.revisionId
          ? { revisionId: previousId, revisionNo: revisionNoOf(previousId) }
          : null;
      if (undoToast.current) dismiss(undoToast.current);
      undoToast.current = toast({
        title: `Now on ${versionFrom(revision.createdAt)}`,
        description: 'Saving from here starts a new branch.',
        variant: 'success',
        ...(previous
          ? { action: { label: 'Undo', onSelect: () => void undoRestore(docId, previous) } }
          : {}),
      });
    } catch (cause) {
      // Next to the Restore button that failed, not in a passing toast.
      setRestoreError({
        revisionId: revision.revisionId,
        message: isStaleHead(cause)
          ? 'The page changed while restoring. The history has been refreshed; try again.'
          : describeApiError(cause, 'This version could not be restored.'),
      });
      void refreshHistory(queryClient, workspaceId, docId);
    } finally {
      setRestoringId(null);
    }
  };

  if (!documentId) {
    return (
      <EmptyState
        icon={History}
        title="No saved versions yet"
        description="Save this page once and every save after that shows up here."
        className="h-full"
      />
    );
  }

  if (loading && !timeline) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // A failed first load has nothing to show instead. A failed *refresh* keeps
  // the rows — and any comparison open under them — and says so in one line.
  if (error && !timeline) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <AlertCircle aria-hidden="true" className="h-5 w-5 text-destructive" />
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <Button variant="outline" size="sm" onClick={retryLoad}>
          {error.retryable ? 'Check again' : 'Retry'}
        </Button>
      </div>
    );
  }

  if (!timeline || timeline.revisions.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No saved versions yet"
        description="Save this page once and every save after that shows up here."
        className="h-full"
      />
    );
  }

  return (
    // No gap: the graph rail runs down the whole list, so rows are separated
    // by their own padding instead of a break in the lanes.
    <div className="flex flex-col">
      {error && (
        <InlineProblem
          message="Could not refresh the history."
          actionLabel={error.retryable ? 'Check again' : 'Retry'}
          onAction={retryLoad}
          busy={loading}
        />
      )}
      {undoError && (
        <InlineProblem
          message={undoError.message}
          actionLabel="Try again"
          onAction={undoError.retry}
          busy={restoringId !== null}
        />
      )}
      {!currentPointerLoaded && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-subtle px-2.5 py-2">
          <p className="text-xs text-muted-foreground">
            The page is on an older version that isn&apos;t shown yet.
          </p>
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0"
            onClick={revealCurrent}
            disabled={revealingCurrent}
          >
            {revealingCurrent ? <Spinner /> : 'Show current version'}
          </Button>
        </div>
      )}
      <ol className="flex flex-col">
        {timeline.revisions.map((revision, index) => {
          // The pointer, not the newest revision: after a restore the page
          // sits on an older node until the next save branches from it.
          const isCurrent = head?.currentRevisionId === revision.revisionId;
          const isExpanded = expandedId === revision.revisionId;
          const node = graph.rows[index];
          return (
            <li key={revision.revisionId} className="flex gap-1.5">
              {node && (
                <VersionGraphRail
                  row={node}
                  laneCount={graph.laneCount}
                  isCurrent={isCurrent}
                />
              )}
              <div className="min-w-0 flex-1 pb-1.5">
                <RevisionRow
                  revision={revision}
                  node={node}
                  isCurrent={isCurrent}
                  isExpanded={isExpanded}
                  onToggle={() =>
                    setExpandedId(isExpanded ? null : revision.revisionId)
                  }
                />
                {isExpanded && (
                  <RevisionInspector
                    documentId={documentId}
                    revision={revision}
                    currentDoc={doc}
                    isCurrent={isCurrent}
                    restoring={restoringId === revision.revisionId}
                    readOnly={readOnly}
                    restoreError={
                      restoreError?.revisionId === revision.revisionId ? restoreError.message : null
                    }
                    onRestore={() => handleRestore(revision)}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {/* Lineage that continues past the loaded pages leaves the list here. */}
      <VersionGraphTail lanes={graph.danglingLanes} laneCount={graph.laneCount} />
      {timeline.nextCursor && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 self-center"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore ? <Spinner /> : 'Show older versions'}
        </Button>
      )}
    </div>
  );
}

/** One line saying what failed, with the way to try again beside it. */
function InlineProblem({
  message,
  actionLabel,
  onAction,
  busy,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  busy: boolean;
}) {
  return (
    <div role="alert" className="mb-2 flex items-start gap-2 rounded-md bg-tint-red px-2.5 py-2 text-xs text-tint-red-fg">
      <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      <Button variant="ghost" size="xs" className="-my-1 shrink-0" onClick={onAction} disabled={busy}>
        {busy ? <Spinner /> : actionLabel}
      </Button>
    </div>
  );
}

export function RevisionRow({
  revision,
  node,
  isCurrent,
  isExpanded,
  onToggle,
}: {
  revision: RevisionSummary;
  node: VersionGraphRow | undefined;
  isCurrent: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const summary = distinctSummary(revision);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      data-revision-id={revision.revisionId}
      // Pinned to the rail's row height so the node dots line up with the
      // rows they belong to.
      style={{ minHeight: RAIL_ROW_HEIGHT }}
      className={cn(
        'w-full rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isExpanded && 'bg-active hover:bg-active',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-sm font-medium">
          {kindLabel(revision)}
          {revision.kind === 'delete' && (
            <Trash2 aria-hidden="true" className="ml-1 inline h-3 w-3 align-[-1px]" />
          )}
        </span>
        {revision.origin === 'agent' && (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-ai">
            <Sparkles aria-hidden="true" className="h-3 w-3" />
            AI
          </span>
        )}
        {isCurrent && (
          <Badge variant="info" className="shrink-0 px-1.5 py-0 text-2xs font-medium">
            Current
          </Badge>
        )}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2 text-xs text-muted-foreground">
        <time className="shrink-0" dateTime={revision.createdAt} title={formatDateTime(revision.createdAt)}>
          {revisionTime(revision.createdAt)}
        </time>
        {node?.isFork && (
          <span
            className="flex shrink-0 items-center gap-0.5 self-center"
            title="Later versions branch away from this one."
          >
            <GitBranch aria-hidden="true" className="h-3 w-3" />
            {node.childCount} branches
          </span>
        )}
        {summary && <span className="min-w-0 truncate" title={summary}>{summary}</span>}
      </div>
    </button>
  );
}

/** What the inspector compares the selected revision with. */
type CompareMode = 'change' | 'current';

type InspectorData = {
  changes: RevisionChange[];
  baseBlocks: Map<string, Block>;
  targetBlocks: Map<string, Block>;
  /** Set when the document was renamed between the two states. */
  rename: { from: string; to: string } | null;
  /** First revision of the document — there is nothing older to compare. */
  initial: boolean;
};

function blockMap(docValue: Doc): Map<string, Block> {
  return new Map(docValue.blocks.map((block) => [block.id, block]));
}

function renameBetween(base: Doc, target: Doc): { from: string; to: string } | null {
  const from = base.name ?? '';
  const to = target.name ?? '';
  return from !== to ? { from, to } : null;
}

function RevisionInspector({
  documentId,
  revision,
  currentDoc,
  isCurrent,
  restoring,
  restoreError,
  onRestore,
  readOnly = false,
}: {
  documentId: string;
  revision: RevisionSummary;
  currentDoc: Doc;
  isCurrent: boolean;
  restoring: boolean;
  readOnly?: boolean;
  restoreError: string | null;
  onRestore: () => void;
}) {
  const [mode, setMode] = useState<CompareMode>('change');
  const workspaceId = useWorkspaceId();

  const load = async (signal: AbortSignal): Promise<InspectorData> => {
    if (mode === 'change') {
      if (!revision.parentRevisionId) {
        const detail = await getRevision(workspaceId, documentId, revision.revisionId, { signal });
        return {
          changes: [],
          baseBlocks: new Map(),
          targetBlocks: blockMap(detail.content),
          rename: null,
          initial: true,
        };
      }
      // Base = the parent (older), target = this revision: "what this save changed".
      const [diff, parent, detail] = await Promise.all([
        diffRevision(workspaceId, documentId, revision.parentRevisionId, revision.revisionId, { signal }),
        getRevision(workspaceId, documentId, revision.parentRevisionId, { signal }),
        getRevision(workspaceId, documentId, revision.revisionId, { signal }),
      ]);
      return {
        changes: diff.changes,
        baseBlocks: blockMap(parent.content),
        targetBlocks: blockMap(detail.content),
        rename: renameBetween(parent.content, detail.content),
        initial: false,
      };
    }
    // Base = this revision (older), target = the live document: "what changed since".
    const [diff, detail] = await Promise.all([
      diffRevision(workspaceId, documentId, revision.revisionId, 'current', { signal }),
      getRevision(workspaceId, documentId, revision.revisionId, { signal }),
    ]);
    return {
      changes: diff.changes,
      baseBlocks: blockMap(detail.content),
      targetBlocks: blockMap(currentDoc),
      rename: renameBetween(detail.content, currentDoc),
      initial: false,
    };
  };

  // The live document is compared by value when the comparison opens;
  // tracking every keystroke would read the revision again for nothing new.
  const comparison = useQuery({
    queryKey: historyKeys.comparison(
      workspaceId,
      documentId,
      mode === 'change' ? revision.parentRevisionId : revision.revisionId,
      mode === 'change' ? revision.revisionId : 'current',
    ),
    queryFn: ({ signal }) => load(signal),
  });
  const data = comparison.data ?? null;
  const pending = comparison.isFetching;
  const failure = comparison.isError ? describeApiError(comparison.error, 'Could not load this comparison.') : null;

  return (
    // No card: an indented rail under the selected row, on the same surface.
    <div className="ml-2 mt-1 border-l border-border pb-1 pl-3 pt-0.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Comparison">
          <Button
            variant={mode === 'change' ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setMode('change')}
            aria-pressed={mode === 'change'}
          >
            This change
          </Button>
          <Button
            variant={mode === 'current' ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setMode('current')}
            aria-pressed={mode === 'current'}
            disabled={isCurrent}
          >
            Vs. current
          </Button>
        </div>
        {isCurrent ? (
          // Restoring the node the page already sits on is a server-side
          // no-op; say so instead of offering a button that does nothing.
          <span className="text-2xs text-muted-foreground">
            The page is on this version
          </span>
        ) : readOnly ? null : (
          <Button
            size="xs"
            variant="outline"
            onClick={onRestore}
            disabled={restoring}
            title="Switch the page to this version"
          >
            {restoring ? <Spinner /> : <RotateCcw aria-hidden="true" />}
            Restore
          </Button>
        )}
      </div>
      {restoreError && (
        <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{restoreError}</span>
        </p>
      )}

      <div className="mt-2">
        {pending && (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        )}
        {failure && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">{failure}</span>
          </p>
        )}
        {data && !pending && !failure && (
          <ComparisonView data={data} mode={mode} />
        )}
      </div>
    </div>
  );
}

function ComparisonView({ data, mode }: { data: InspectorData; mode: CompareMode }) {
  if (data.initial) {
    return (
      <p className="text-xs text-muted-foreground">
        First version of this page — {data.targetBlocks.size}{' '}
        {data.targetBlocks.size === 1 ? 'block' : 'blocks'}.
      </p>
    );
  }
  if (data.changes.length === 0 && !data.rename) {
    return (
      <p className="text-xs text-muted-foreground">
        {mode === 'change'
          ? 'No content changes in this version.'
          : 'The page currently matches this version.'}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {data.rename && (
        <li className="text-xs">
          <span className="font-medium">Renamed</span>{' '}
          <span className="text-muted-foreground">
            “{data.rename.from || 'Untitled page'}” →{' '}
            “{data.rename.to || 'Untitled page'}”
          </span>
        </li>
      )}
      {data.changes.map((change, index) => (
        <li key={`${change.entityId}-${change.change}-${index}`}>
          <ChangeView
            change={change}
            base={data.baseBlocks.get(change.entityId) ?? null}
            target={data.targetBlocks.get(change.entityId) ?? null}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * The diff reuses the review views, which set page typography (16px body,
 * 20–30px headings). Inside a 13–14px sidebar that shouts, so scale it to UI
 * size: 14px text, headings a step above.
 */
const DIFF_TEXT =
  'text-sm [&_.text-md]:text-sm [&_.text-md]:leading-6 [&_.text-xl]:text-md [&_.text-2xl]:text-md [&_.text-3xl]:text-lg';

/** Field names are the document's JSON keys; say what they mean instead. */
const CHILD_FIELD_WORDS: Record<string, string> = {
  keys: 'sources',
  sources: 'sources',
  style: 'style',
  latex: 'formula',
  display: 'layout',
  numbered: 'numbering',
  rows: 'cells',
  columns: 'columns',
  caption: 'caption',
  spec: 'data',
  data: 'data',
};

/** Fields that change what kind of block it is, from the author's side. */
const KIND_FIELDS = new Set(['type', 'variant', 'level', 'language']);

/** Generic words, for when the blocks themselves are not at hand. */
const BLOCK_FIELD_WORDS: Record<string, string> = {
  checked: 'tick',
  variant: 'list style',
  indent: 'indent',
  language: 'language',
  columns: 'columns',
  level: 'heading level',
  type: 'block type',
  aiHidden: 'visibility to the assistant',
  locked: 'lock',
  collapsed: 'folding',
};

/**
 * The non-text fields of a changed block, said as what happened to it:
 * "ticked", "turned into Numbered list", "indented", "locked" — not
 * "checked, variant".
 */
function blockFieldPhrases(fields: readonly string[], base: Block | null, target: Block | null): string[] {
  const phrases: string[] = [];
  const kindChanged = Boolean(
    base && target && fields.some((field) => KIND_FIELDS.has(field)) && kindOf(base) !== kindOf(target),
  );
  if (kindChanged && target) phrases.push(`turned into ${blockKindLabel(target)}`);
  const generic = new Set<string>();
  for (const field of fields) {
    if (field === 'html' || field === 'text') continue;
    if (kindChanged && KIND_FIELDS.has(field)) continue;
    const before = base as Record<string, unknown> | null;
    const after = target as Record<string, unknown> | null;
    if (!before || !after) {
      generic.add(BLOCK_FIELD_WORDS[field] ?? 'details');
      continue;
    }
    switch (field) {
      case 'checked':
        phrases.push(after.checked ? 'ticked' : 'unticked');
        break;
      case 'indent': {
        const from = Number(before.indent ?? 0);
        const to = Number(after.indent ?? 0);
        phrases.push(to > from ? 'indented' : 'outdented');
        break;
      }
      case 'language':
        phrases.push(typeof after.language === 'string' && after.language ? `language set to ${after.language}` : 'language removed');
        break;
      case 'columns':
        phrases.push(`set to ${Number(after.columns ?? 1)} ${Number(after.columns ?? 1) === 1 ? 'column' : 'columns'}`);
        break;
      case 'aiHidden':
        phrases.push(after.aiHidden ? 'hidden from the assistant' : 'shown to the assistant');
        break;
      case 'locked':
        phrases.push(after.locked ? 'locked' : 'unlocked');
        break;
      case 'collapsed':
        phrases.push(after.collapsed ? 'collapsed' : 'expanded');
        break;
      default:
        generic.add(BLOCK_FIELD_WORDS[field] ?? 'details');
    }
  }
  if (generic.size > 0) phrases.push(`${[...generic].join(' and ')} changed`);
  return phrases;
}

function sentence(phrases: readonly string[]): string {
  const text = phrases.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function childChangeWording(change: RevisionChange, verb: string): string {
  if (change.change !== 'changed' || change.fields.length === 0) return `${verb}.`;
  const words = [...new Set(change.fields.map((field) => CHILD_FIELD_WORDS[field] ?? 'details'))];
  return `${words.join(' and ')} changed.`;
}

export function ChangeView({
  change,
  base,
  target,
}: {
  change: RevisionChange;
  base: Block | null;
  target: Block | null;
}) {
  const label = entityLabel(change, target ?? base);

  if (change.entity === 'child') {
    const verb =
      change.change === 'inserted' ? 'added'
      : change.change === 'deleted' ? 'removed'
      : change.change === 'moved' ? 'moved'
      : 'updated';
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span> {childChangeWording(change, verb)}
      </p>
    );
  }

  if (change.change === 'moved') {
    const snippet = target ?? base;
    return (
      <p className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
        <ArrowDownUp aria-hidden="true" className="h-3 w-3 shrink-0 self-center" />
        <span className="min-w-0">
          <span className="font-medium text-foreground">{label}</span> moved from position{' '}
          {(change.fromIndex ?? 0) + 1} to {(change.toIndex ?? 0) + 1}
          <BlockSnippet block={snippet} />
        </span>
      </p>
    );
  }

  if (change.change === 'inserted') {
    return (
      <div className="border-l-2 border-diff-add-border pl-2.5">
        <p className="mb-0.5 text-xs font-medium text-success">
          {label} added
        </p>
        <div className={DIFF_TEXT}>
          <ProposedBlockView block={target} />
        </div>
      </div>
    );
  }

  if (change.change === 'deleted') {
    return (
      <div className="border-l-2 border-diff-remove-border pl-2.5">
        <p className="mb-0.5 text-xs font-medium text-destructive">
          {label} removed
        </p>
        <div className={cn(DIFF_TEXT, 'opacity-70')}>
          <ProposedBlockView block={base} />
        </div>
      </div>
    );
  }

  // Changed in place. Word-diff the words when they changed — prose `html`,
  // or the `text` of code, a diagram (Mermaid) or a figure (its JSON spec);
  // anything else (ticked, indent, locked …) is said instead of rendered.
  const textChanged = change.fields.includes('html') || change.fields.includes('text');
  const phrases = blockFieldPhrases(change.fields, base, target);
  const code = (target ?? base)?.type === 'code';
  return (
    <div className="border-l-2 border-info pl-2.5">
      <p className="mb-0.5 text-xs font-medium text-info">
        {label} changed
      </p>
      {textChanged && (
        <div className={cn(DIFF_TEXT, code && 'whitespace-pre-wrap break-words font-mono text-xs')}>
          <ProposedRewriteView
            before={base}
            after={target}
            block={target ?? base}
          />
        </div>
      )}
      {phrases.length > 0 && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {textChanged ? `Also ${phrases.join(', ')}.` : sentence(phrases)}
        </p>
      )}
    </div>
  );
}

/** Characters of prose a moved block's snippet keeps; a widget counts as a few. */
const SNIPPET_CHARS = 60;
const WIDGET_CHARS = 4;

/**
 * The start of a block, for a one-line "moved" summary, with its equations and
 * citations drawn as the page draws them rather than flattened to `▦`.
 */
function BlockSnippet({ block }: { block: Block | null }) {
  const { pieces, cut } = useMemo(() => {
    const table = createWidgetTable();
    const all = diffPieces(diffableText(block, table).replace(/\s+/g, ' '), table);
    const kept: DiffPiece[] = [];
    let left = SNIPPET_CHARS;
    for (const piece of all) {
      if (left <= 0) return { pieces: kept, cut: true };
      if (piece.kind === 'widget') {
        kept.push(piece);
        left -= WIDGET_CHARS;
      } else if (piece.text.length > left) {
        kept.push({ kind: 'text', text: piece.text.slice(0, left).trimEnd() });
        return { pieces: kept, cut: true };
      } else {
        kept.push(piece);
        left -= piece.text.length;
      }
    }
    return { pieces: kept, cut: false };
  }, [block]);
  if (!pieces.length) return null;
  return (
    <>
      {' — “'}
      {pieces.map((piece, index) =>
        piece.kind === 'text' ? piece.text : <WidgetChip key={index} child={piece.child} />,
      )}
      {cut && '…'}
      {'”'}
    </>
  );
}
