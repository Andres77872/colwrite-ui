import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useEditor } from '@/editor';
import type { Block, Doc } from '@/editor';
import { blockText } from '@/editor/proposals';
import { formatDateTime } from '@/lib/text';
import { errorMessage } from '@/services/contracts';
import {
  type DocumentHead,
  type RevisionChange,
  type RevisionSummary,
  diffRevision,
  fetchDocumentHead,
  getRevision,
  historyErrorCode,
  isStaleHead,
  listRevisions,
  restoreRevision,
} from '@/services/documentHistory';
import {
  ProposedBlockView,
  ProposedRewriteView,
} from '@/components/editor/Review/ProposedBlockView';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import {
  AlertCircle,
  ArrowDownUp,
  Bot,
  History,
  RotateCcw,
  Trash2,
} from 'lucide-react';

/**
 * HistoryPanel — the document's saved versions.
 *
 * Every accepted save is an immutable server-side snapshot; this panel lists
 * them newest first, shows what each one changed (or how it differs from the
 * current state), and restores. Restore is append-only on the server: the
 * current state stays in the timeline, so nothing here can lose work.
 */

const PAGE_SIZE = 30;

/** Auto-refreshes while the server prepares history, before "Check again". */
const MAX_PREPARING_POLLS = 5;

const KIND_LABELS: Record<string, string> = {
  create: 'Created',
  save: 'Saved',
  semantic_edit: 'Edited',
  restore: 'Restored',
  delete: 'Moved to trash',
  migration: 'Migrated',
  history_backfill: 'Imported',
};

const CHILD_LABELS: Record<string, string> = {
  citation: 'Citation',
  equation: 'Equation',
  table: 'Table',
  graph: 'Chart',
  aiBeat: 'AI passage',
};

function kindLabel(revision: RevisionSummary): string {
  return KIND_LABELS[revision.kind] ?? revision.kind.replace(/_/g, ' ');
}

function entityLabel(change: RevisionChange): string {
  if (change.entity === 'child') {
    return CHILD_LABELS[change.entityType] ?? 'Inline element';
  }
  if (change.entityType === 'heading') return 'Heading';
  if (change.entityType === 'divider') return 'Divider';
  return 'Paragraph';
}

type Timeline = { revisions: RevisionSummary[]; nextCursor: string | null };

export function HistoryPanel() {
  const {
    documentId,
    doc,
    hasPendingEdits,
    saveRemote,
    adoptRestoredDocument,
    documentListRevision,
    waitForReady,
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
  // Bumped when the panel itself learns the server moved on (failed restore).
  const [refreshTick, setRefreshTick] = useState(0);
  // Bounded retries while the server says the history is still being prepared,
  // so the author does not have to press "Check again" while a backfill runs.
  const pollAttemptRef = useRef(0);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    pollAttemptRef.current = 0;
  }, [documentId]);

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
        pollAttemptRef.current = 0;
        setHead(headValue);
        setTimeline({ revisions: page.revisions, nextCursor: page.nextCursor });
      } catch (cause) {
        if (controller.signal.aborted) return;
        // `history_not_ready` and `projection_pending` are the failures the
        // server itself calls retryable — the timeline is still being prepared.
        const code = historyErrorCode(cause);
        const preparing = code === 'history_not_ready' || code === 'projection_pending';
        setError({
          message: preparing
            ? 'The history for this document is still being prepared.'
            : errorMessage(cause, 'Could not load the document history.'),
          retryable: preparing,
        });
        if (preparing && pollAttemptRef.current < MAX_PREPARING_POLLS) {
          pollAttemptRef.current += 1;
          pollTimerRef.current = window.setTimeout(() => {
            pollTimerRef.current = null;
            setRefreshTick((tick) => tick + 1);
          }, pollAttemptRef.current * 1000);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
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
        description: errorMessage(cause, 'The request failed.'),
        variant: 'error',
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRestore = async (revision: RevisionSummary) => {
    if (!documentId) return;
    const confirmed = await confirm({
      title: `Restore version ${revision.revisionNo}?`,
      description: hasPendingEdits()
        ? 'Your unsaved edits are saved as their own version first, then the document returns to this one. The history keeps both, so nothing is lost.'
        : 'The document returns to this version. The current state stays in the history, so nothing is lost.',
      confirmLabel: 'Restore',
    });
    if (!confirmed) return;
    setRestoringId(revision.revisionId);
    try {
      if (hasPendingEdits()) await saveRemote();
      // Let the server's projections catch up with that save so the restore
      // and the next assistant turn agree on which head they started from.
      await waitForReady({ save: false, timeoutMs: 4000 });
      const restored = await restoreRevision(documentId, revision.revisionId, {
        summary: `Restored version ${revision.revisionNo}`,
      });
      adoptRestoredDocument(restored.content, restored.headSeq);
      setExpandedId(null);
      toast({ title: `Version ${revision.revisionNo} restored`, variant: 'success' });
    } catch (cause) {
      toast({
        title: 'Could not restore this version',
        description: isStaleHead(cause)
          ? 'The document changed while restoring. The timeline has been refreshed — try again.'
          : errorMessage(cause, 'The request failed.'),
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
    <div className="flex flex-col gap-1.5">
      <ol className="flex flex-col gap-1.5">
        {timeline.revisions.map((revision) => {
          const isCurrent = head?.revisionId === revision.revisionId;
          const isExpanded = expandedId === revision.revisionId;
          return (
            <li key={revision.revisionId}>
              <RevisionRow
                revision={revision}
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
            </li>
          );
        })}
      </ol>
      {timeline.nextCursor && (
        <Button
          variant="ghost"
          size="sm"
          className="self-center"
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
  isCurrent,
  isExpanded,
  onToggle,
}: {
  revision: RevisionSummary;
  isCurrent: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      className={cn(
        'w-full rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-muted/60',
        isExpanded ? 'border-border bg-muted/40' : 'border-transparent',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-2xs text-muted-foreground">
          v{revision.revisionNo}
        </span>
        <span className="text-sm font-medium">
          {kindLabel(revision)}
          {revision.kind === 'delete' && (
            <Trash2 aria-hidden="true" className="ml-1 inline h-3 w-3 align-[-1px]" />
          )}
        </span>
        {revision.origin === 'agent' && (
          <Badge variant="info" className="gap-1 px-1.5 py-0 text-2xs font-medium">
            <Bot aria-hidden="true" className="h-3 w-3" />
            Assistant
          </Badge>
        )}
        {isCurrent && (
          <Badge variant="secondary" className="px-1.5 py-0 text-2xs font-medium">
            Current
          </Badge>
        )}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2 text-xs text-muted-foreground">
        <time dateTime={revision.createdAt}>{formatDateTime(revision.createdAt)}</time>
        {revision.summary && (
          <span className="min-w-0 truncate italic">{revision.summary}</span>
        )}
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
          setFailure(errorMessage(cause, 'Could not load this comparison.'));
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
    <div className="mt-1 rounded-md border bg-muted/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Comparison">
          <Button
            variant={mode === 'change' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setMode('change')}
            aria-pressed={mode === 'change'}
          >
            This change
          </Button>
          <Button
            variant={mode === 'current' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setMode('current')}
            aria-pressed={mode === 'current'}
            disabled={isCurrent}
          >
            Vs. current
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          onClick={onRestore}
          disabled={isCurrent || restoring}
          title={isCurrent ? 'This is already the current version' : undefined}
        >
          {restoring ? <Spinner /> : <RotateCcw aria-hidden="true" className="h-3 w-3" />}
          Restore
        </Button>
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
        <span className="font-medium text-foreground">{label}</span> {verb} inside a paragraph
        {change.change === 'changed' && change.fields.length > 0 && (
          <> ({change.fields.join(', ')})</>
        )}
        .
      </p>
    );
  }

  if (change.change === 'moved') {
    const snippet = blockText(target ?? base);
    return (
      <p className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
        <ArrowDownUp aria-hidden="true" className="h-3 w-3 shrink-0 self-center" />
        <span className="min-w-0">
          <span className="font-medium text-foreground">{label}</span> moved from position{' '}
          {(change.fromIndex ?? 0) + 1} to {(change.toIndex ?? 0) + 1}
          {snippet && <> — “{snippet.length > 60 ? `${snippet.slice(0, 60)}…` : snippet}”</>}
        </span>
      </p>
    );
  }

  if (change.change === 'inserted') {
    return (
      <div className="border-l-2 border-success/60 pl-2">
        <p className="mb-0.5 text-2xs font-medium uppercase tracking-wide text-success">
          {label} added
        </p>
        <div className="text-sm">
          <ProposedBlockView block={target} />
        </div>
      </div>
    );
  }

  if (change.change === 'deleted') {
    return (
      <div className="border-l-2 border-destructive/60 pl-2">
        <p className="mb-0.5 text-2xs font-medium uppercase tracking-wide text-destructive">
          {label} removed
        </p>
        <div className="text-sm opacity-70">
          <ProposedBlockView block={base} />
        </div>
      </div>
    );
  }

  // Changed in place. Word-diff the prose when the html changed; anything
  // else (level, columns, locked …) is named instead of rendered.
  const nonTextFields = change.fields.filter((field) => field !== 'html');
  return (
    <div className="border-l-2 border-info/60 pl-2">
      <p className="mb-0.5 text-2xs font-medium uppercase tracking-wide text-info">
        {label} changed
      </p>
      {change.fields.includes('html') && (
        <div className="text-sm">
          <ProposedRewriteView
            before={blockText(base)}
            after={blockText(target)}
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
