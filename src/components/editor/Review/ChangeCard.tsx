import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { diffWords } from '@/lib/diff';
import { useEditor } from '@/editor';
import { useProposals } from '@/editor/ProposalsContext';
import {
  blockText,
  describeChange,
  mergedBlock,
  proposedBlock,
  type ProposedChange,
} from '@/editor/proposals';
import { Check, CornerDownRight, Lock, Plus, Trash2, X } from 'lucide-react';

const KIND_STYLES: Record<
  ProposedChange['kind'],
  { accent: string; badge: string; label: string }
> = {
  insert: {
    accent: 'border-l-[var(--color-diff-add-border)]',
    badge: 'bg-[var(--color-diff-add)] text-[var(--color-diff-add-fg)]',
    label: 'Addition',
  },
  replace: {
    accent: 'border-l-primary',
    badge: 'bg-primary/15 text-primary',
    label: 'Rewrite',
  },
  delete: {
    accent: 'border-l-[var(--color-diff-remove-border)]',
    badge: 'bg-[var(--color-diff-remove)] text-[var(--color-diff-remove-fg)]',
    label: 'Deletion',
  },
  reorder: {
    accent: 'border-l-primary',
    badge: 'bg-primary/15 text-primary',
    label: 'Move',
  },
  rename: {
    accent: 'border-l-primary',
    badge: 'bg-primary/15 text-primary',
    label: 'Title',
  },
};

/** Inline word diff, so the author reads only what actually moved. */
function WordDiff({ before, after }: { before: string; after: string }) {
  const segments = useMemo(() => diffWords(before, after), [before, after]);

  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {segments.map((segment, index) => {
        if (segment.type === 'equal') {
          return (
            <span key={index} className="text-muted-foreground">
              {segment.value}
            </span>
          );
        }
        return (
          <span
            key={index}
            className={cn(
              'rounded-sm',
              segment.type === 'insert'
                ? 'bg-[var(--color-diff-add)] text-[var(--color-diff-add-fg)]'
                : 'bg-[var(--color-diff-remove)] text-[var(--color-diff-remove-fg)] line-through decoration-1',
            )}
          >
            {segment.value}
          </span>
        );
      })}
    </p>
  );
}

/** What the change does, rendered as content rather than as a description. */
function ChangeBody({ change }: { change: ProposedChange }) {
  const { blocks } = useEditor();

  if (change.kind === 'rename') {
    const next = change.op.op === 'update_meta' ? change.op.meta?.name : undefined;
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <CornerDownRight aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{next || 'Untitled document'}</span>
      </p>
    );
  }

  if (change.kind === 'reorder') {
    const position = change.op.op === 'reorder_block' ? change.op.toIndex + 1 : 0;
    return (
      <p className="text-sm text-muted-foreground">
        Move to position {position} in the document.
      </p>
    );
  }

  const current = blocks.find((b) => b.id === change.anchorBlockId);

  // The agent read the document a moment before the author deleted the very
  // block it was working on. Say so, rather than rendering an empty diff the
  // author cannot make sense of.
  if (!current && change.anchorBlockId) {
    return (
      <p className="text-sm text-muted-foreground">
        The block this change was written for is no longer in the document, so it cannot be
        applied.
      </p>
    );
  }

  if (change.kind === 'delete') {
    const text = blockText(current);
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-diff-remove-fg)] line-through decoration-1">
        {text || 'Empty block'}
      </p>
    );
  }

  if (change.kind === 'insert') {
    const block = proposedBlock(change);
    if (block?.type === 'divider') {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          divider
          <span className="h-px flex-1 bg-border" />
        </div>
      );
    }
    const text = blockText(block);
    return (
      <p
        className={cn(
          'whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-diff-add-fg)]',
          block?.type === 'heading' && 'font-semibold',
        )}
      >
        {text || 'Empty block'}
      </p>
    );
  }

  const before = blockText(current);
  const after = blockText(mergedBlock(change, current));
  return <WordDiff before={before} after={after} />;
}

/**
 * One proposed change, rendered where it would land in the document.
 *
 * The accept and reject controls live here rather than in the chat panel on
 * purpose: an author cannot judge a rewrite from a summary, only from seeing
 * it against the surrounding paragraph.
 */
export function ChangeCard({ change }: { change: ProposedChange }) {
  const { blocks } = useEditor();
  const { accept, reject, ready, focusedChangeId } = useProposals();

  const style = KIND_STYLES[change.kind];
  const isReady = ready(change);
  const isFocused = focusedChangeId === change.id;

  const Icon = change.kind === 'delete' ? Trash2 : change.kind === 'insert' ? Plus : CornerDownRight;

  return (
    <div
      data-change-id={change.id}
      className={cn(
        'my-2 rounded-lg border border-l-2 border-border bg-card/80 shadow-sm transition-all',
        style.accent,
        isFocused && 'ring-2 ring-primary/40',
      )}
      style={{ marginLeft: 'var(--doc-gutter)' }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
            style.badge,
          )}
        >
          <Icon aria-hidden="true" className="h-3 w-3" />
          {style.label}
        </span>
        <span className="text-xs text-muted-foreground">{describeChange(change, blocks)}</span>

        <div className="ml-auto flex items-center gap-1">
          {isReady ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-[var(--color-diff-add-fg)] hover:bg-[var(--color-diff-add)]"
                onClick={() => accept(change.id)}
              >
                <Check className="h-3.5 w-3.5" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => reject(change.id)}
              >
                <X className="h-3.5 w-3.5" />
                Reject
              </Button>
            </>
          ) : (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
              title="Accept the change this one builds on first."
            >
              <Lock aria-hidden="true" className="h-3 w-3" />
              Needs the change above
            </span>
          )}
        </div>
      </div>

      <div className="px-3 py-2">
        <ChangeBody change={change} />
      </div>
    </div>
  );
}
