import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useEditor } from '@/editor';
import type { Block, Doc } from '@/editor';
import { formatDateTime } from '@/lib/text';
import { describeApiError } from '@/services/contracts';
import { isRetryableProblem } from '@/services/retry';
import {
  type DocumentHead,
  type RevisionChange,
  type RevisionSummary,
  diffRevision,
  fetchDocumentHead,
  getRevision,
  isStaleHead,
  listRevisions,
  restoreRevision,
} from '@/services/documentHistory';
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

function entityLabel(change: RevisionChange): string {
  if (change.entity === 'child') {
    return CHILD_LABELS[change.entityType] ?? 'Inline element';
  }
  if (change.entityType === 'heading') return 'Heading';
  if (change.entityType === 'divider') return 'Divider';
  return 'Paragraph';
}

type Timeline = { revisions: RevisionSummary[]; nextCursor: string | null };

/** Stable identity for the memo when nothing is loaded yet. */
const NO_REVISIONS: RevisionSummary[] = [];

/** Bound on auto-paging toward the current version — a hint, not a crawl. */
const MAX_REVEAL_PAGES = 10;

/**
 * Fold a refreshed first page into the pages already on screen. A refresh
 * (after a restore or an outside save) must not throw away rows the author
 * paged in: under pointer semantics the "Current" marker can sit on any of
 * them, not just on page one.
 */
function mergeRevisionPages(current: Timeline, page: Timeline): Timeline {
  const fresh = new Set(page.revisions.map((revision) => revision.revisionId));
  const kept = current.revisions.filter(
    (revision) => !fresh.has(revision.revisionId),
  );
  return {
    revisions: [...page.revisions, ...kept].sort(
      (a, b) => b.revisionNo - a.revisionNo,
    ),
    // If the accumulated list reaches deeper than the fresh page, keep paging
    // from where the author already was.
    nextCursor: kept.length > 0 ? current.nextCursor : page.nextCursor,
  };
}

export function HistoryPanel() {
  const {
    documentId,
    doc,
    hasPendingEdits,
    saveRemote,
    adoptRestoredDocument,
    documentListRevision,
  } = useEditor();
  const confirm = useConfirm();
  const { toast } = useToast();

  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [head, setHead] = useState<DocumentHead | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [revealingCurrent, setRevealingCurrent] = useState(false);
  // Bumped when the panel itself learns the server moved on (failed restore).
  const [refreshTick, setRefreshTick] = useState(0);
  // Which document the timeline rows belong to: a refresh of the same
  // document merges pages, a navigation starts over.
  const timelineDocRef = useRef<string | null>(null);

  const revisions = timeline?.revisions ?? NO_REVISIONS;
  const graph = useMemo(() => buildVersionGraph(revisions), [revisions]);
  // The version the document sits on can be deeper than the loaded pages —
  // the panel must say so rather than showing a list with no marker at all.
  const currentPointerLoaded =
    !head?.currentRevisionId
    || revisions.some((revision) => revision.revisionId === head.currentRevisionId);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      if (!documentId) {
        setTimeline(null);
        setHead(null);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [headValue, page] = await Promise.all([
          fetchDocumentHead(documentId, { signal: controller.signal }),
          listRevisions(documentId, { limit: PAGE_SIZE, signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setHead(headValue);
        const fresh: Timeline = {
          revisions: page.revisions,
          nextCursor: page.nextCursor,
        };
        setTimeline((current) =>
          current && timelineDocRef.current === documentId
            ? mergeRevisionPages(current, fresh)
            : fresh,
        );
        timelineDocRef.current = documentId;
      } catch (cause) {
        if (controller.signal.aborted) return;
        // The request layer already retried what is worth retrying, so this
        // goes to the author with "Check again" rather than starting another
        // timer behind their back.
        const preparing = isRetryableProblem(cause);
        setError({
          // What the author is waiting for here is the timeline — say that
          // rather than name the machinery behind it.
          message: preparing
            ? 'The history for this document is still being prepared.'
            : describeApiError(cause, 'Could not load the document history.'),
          retryable: preparing,
        });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [documentId, documentListRevision, refreshTick]);

  const loadMore = async () => {
    if (!documentId || !timeline?.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listRevisions(documentId, {
        limit: PAGE_SIZE,
        cursor: timeline.nextCursor,
      });
      setTimeline((current) => {
        if (!current) return current;
        // A save while the panel is open shifts pagination; drop repeats.
        const seen = new Set(current.revisions.map((revision) => revision.revisionId));
        return {
          revisions: [
            ...current.revisions,
            ...page.revisions.filter((revision) => !seen.has(revision.revisionId)),
          ],
          nextCursor: page.nextCursor,
        };
      });
    } catch (cause) {
      toast({
        title: 'Could not load older versions',
        description: describeApiError(cause, 'The request failed.'),
        variant: 'error',
      });
    } finally {
      setLoadingMore(false);
    }
  };

  /** Page toward the current version until its row is on screen (bounded). */
  const revealCurrent = async () => {
    const pointer = head?.currentRevisionId;
    if (!documentId || !pointer || !timeline) return;
    setRevealingCurrent(true);
    try {
      let merged = timeline.revisions;
      let cursor = timeline.nextCursor;
      let pages = 0;
      const loaded = () =>
        merged.some((revision) => revision.revisionId === pointer);
      while (cursor && !loaded() && pages < MAX_REVEAL_PAGES) {
        const page = await listRevisions(documentId, {
          limit: PAGE_SIZE,
          cursor,
        });
        const seen = new Set(merged.map((revision) => revision.revisionId));
        merged = [
          ...merged,
          ...page.revisions.filter((revision) => !seen.has(revision.revisionId)),
        ];
        cursor = page.nextCursor;
        pages += 1;
      }
      setTimeline({ revisions: merged, nextCursor: cursor });
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

  const handleRestore = async (revision: RevisionSummary) => {
    if (!documentId) return;
    const confirmed = await confirm({
      title: `Switch to version ${revision.revisionNo}?`,
      description: hasPendingEdits()
        ? 'Your unsaved edits are saved as their own version first, then the document switches to this one. Switching does not create a new version and the history is untouched — your next save starts a new branch from here.'
        : 'The document goes back to this version. Switching does not create a new version and the history is untouched — your next save starts a new branch from here.',
      confirmLabel: 'Restore',
    });
    if (!confirmed) return;
    setRestoringId(revision.revisionId);
    try {
      if (hasPendingEdits()) await saveRemote();
      const restored = await restoreRevision(documentId, revision.revisionId, {
        summary: `Restored version ${revision.revisionNo}`,
      });
      adoptRestoredDocument(restored.content, restored.headSeq);
      setExpandedId(null);
      // No revision was written — only the current-version pointer moved. The
      // returned head already carries it; refetching keeps the marker honest
      // if a save landed in between, and picks up any new rows that save left.
      setHead(restored);
      setRefreshTick((tick) => tick + 1);
      toast({
        title: `Now on version ${revision.revisionNo}`,
        description: 'Saving from here starts a new branch.',
        variant: 'success',
      });
    } catch (cause) {
      toast({
        title: 'Could not restore this version',
        description: isStaleHead(cause)
          ? 'The document changed while restoring. The timeline has been refreshed — try again.'
          : describeApiError(cause, 'The request failed.'),
        variant: 'error',
      });
      setRefreshTick((tick) => tick + 1);
    } finally {
      setRestoringId(null);
    }
  };

  if (!documentId) {
    return (
      <EmptyState
        icon={History}
        title="No saved versions yet"
        description="Save this document once and every save after that shows up here."
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

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <AlertCircle aria-hidden="true" className="h-5 w-5 text-destructive" />
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <Button variant="outline" size="sm" onClick={() => setRefreshTick((tick) => tick + 1)}>
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
        description="Save this document once and every save after that shows up here."
        className="h-full"
      />
    );
  }

  return (
    // No gap: the graph rail runs down the whole list, so rows are separated
    // by their own padding instead of a break in the lanes.
    <div className="flex flex-col">
      {!currentPointerLoaded && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-subtle px-2.5 py-2">
          <p className="text-xs text-muted-foreground">
            The document is on an older version that isn&apos;t shown yet.
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
          // The pointer, not the newest revision: after a restore the document
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

function RevisionRow({
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
        <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">v{revision.revisionNo}</span>
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
  onRestore,
}: {
  documentId: string;
  revision: RevisionSummary;
  currentDoc: Doc;
  isCurrent: boolean;
  restoring: boolean;
  onRestore: () => void;
}) {
  const [mode, setMode] = useState<CompareMode>('change');
  const [data, setData] = useState<InspectorData | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    const load = async (): Promise<InspectorData> => {
      if (mode === 'change') {
        if (!revision.parentRevisionId) {
          const detail = await getRevision(documentId, revision.revisionId, { signal });
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
          diffRevision(documentId, revision.parentRevisionId, revision.revisionId, { signal }),
          getRevision(documentId, revision.parentRevisionId, { signal }),
          getRevision(documentId, revision.revisionId, { signal }),
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
        diffRevision(documentId, revision.revisionId, 'current', { signal }),
        getRevision(documentId, revision.revisionId, { signal }),
      ]);
      return {
        changes: diff.changes,
        baseBlocks: blockMap(detail.content),
        targetBlocks: blockMap(currentDoc),
        rename: renameBetween(detail.content, currentDoc),
        initial: false,
      };
    };

    (async () => {
      setPending(true);
      setFailure(null);
      setData(null);
      try {
        const value = await load();
        if (!signal.aborted) setData(value);
      } catch (cause) {
        if (!signal.aborted) {
          setFailure(describeApiError(cause, 'Could not load this comparison.'));
        }
      } finally {
        if (!signal.aborted) setPending(false);
      }
    })();
    return () => controller.abort();
    // The live document is compared by value on each open; tracking every
    // keystroke would refetch the revision for no new information.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, revision.revisionId, revision.parentRevisionId, mode]);

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
          // Restoring the node the document already sits on is a server-side
          // no-op; say so instead of offering a button that does nothing.
          <span className="text-2xs text-muted-foreground">
            The document is on this version
          </span>
        ) : (
          <Button
            size="xs"
            variant="outline"
            onClick={onRestore}
            disabled={restoring}
            title="Switch the document to this version"
          >
            {restoring ? <Spinner /> : <RotateCcw aria-hidden="true" />}
            Restore
          </Button>
        )}
      </div>

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
        First version of this document — {data.targetBlocks.size}{' '}
        {data.targetBlocks.size === 1 ? 'block' : 'blocks'}.
      </p>
    );
  }
  if (data.changes.length === 0 && !data.rename) {
    return (
      <p className="text-xs text-muted-foreground">
        {mode === 'change'
          ? 'No content changes in this version.'
          : 'The document currently matches this version.'}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {data.rename && (
        <li className="text-xs">
          <span className="font-medium">Renamed</span>{' '}
          <span className="text-muted-foreground">
            “{data.rename.from || 'Untitled document'}” →{' '}
            “{data.rename.to || 'Untitled document'}”
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

function childChangeWording(change: RevisionChange, verb: string): string {
  if (change.change !== 'changed' || change.fields.length === 0) return `${verb}.`;
  const words = [...new Set(change.fields.map((field) => CHILD_FIELD_WORDS[field] ?? 'details'))];
  return `${words.join(' and ')} changed.`;
}

function ChangeView({
  change,
  base,
  target,
}: {
  change: RevisionChange;
  base: Block | null;
  target: Block | null;
}) {
  const label = entityLabel(change);

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

  // Changed in place. Word-diff the prose when the html changed; anything
  // else (level, columns, locked …) is named instead of rendered.
  const nonTextFields = change.fields.filter((field) => field !== 'html');
  return (
    <div className="border-l-2 border-info pl-2.5">
      <p className="mb-0.5 text-xs font-medium text-info">
        {label} changed
      </p>
      {change.fields.includes('html') && (
        <div className={DIFF_TEXT}>
          <ProposedRewriteView
            before={base}
            after={target}
            block={target ?? base}
          />
        </div>
      )}
      {nonTextFields.length > 0 && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Also changed: {nonTextFields.join(', ')}.
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
