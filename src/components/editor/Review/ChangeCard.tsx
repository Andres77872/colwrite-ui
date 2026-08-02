import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useEditor } from '@/editor';
import { useProposals } from '@/editor/proposalsContextState';
import {
  blockText,
  describeChange,
  mergedBlock,
  proposedBlock,
  type ProposedChange,
} from '@/editor/proposals';
import { ProposedBlockView, ProposedRewriteView } from './ProposedBlockView';
import { ArrowDownUp, Check, Lock, Pencil, Plus, TextCursorInput, Trash2, X } from 'lucide-react';

/**
 * One proposed change, rendered in the document at the position it would take.
 *
 * This used to be a bordered card in panel typography, indented by its own
 * margin, showing the block as stripped plain text. It read as a notification
 * that had landed on the page rather than as a change to the page — and
 * because the accept path applied the operation literally, the position it
 * showed was not reliably the position the block would end up in.
 *
 * Now the row lines up with `.block-row`: same gutter, same measure, same
 * prose size, so the proposed paragraph sits in the column of text it is
 * joining. The only chrome is a coloured rail and one line of controls.
 */

const KIND: Record<
  ProposedChange['kind'],
  { label: string; rail: string; tint: string; badge: string; icon: typeof Plus }
> = {
  insert: {
    label: 'Addition',
    rail: 'border-l-diff-add-border',
    tint: 'bg-diff-add/30',
    badge: 'text-diff-add-fg',
    icon: Plus,
  },
  replace: {
    label: 'Rewrite',
    rail: 'border-l-primary',
    tint: 'bg-primary/5',
    badge: 'text-primary',
    icon: Pencil,
  },
  delete: {
    label: 'Deletion',
    rail: 'border-l-diff-remove-border',
    tint: 'bg-diff-remove/25',
    badge: 'text-diff-remove-fg',
    icon: Trash2,
  },
  reorder: {
    label: 'Move',
    rail: 'border-l-primary',
    tint: 'bg-primary/5',
    badge: 'text-primary',
    icon: ArrowDownUp,
  },
  rename: {
    label: 'Title',
    rail: 'border-l-primary',
    tint: 'bg-primary/5',
    badge: 'text-primary',
    icon: TextCursorInput,
  },
};

/** One-line preview of a block, for naming a move's destination. */
function shortText(text: string, max = 42): string {
  const trimmed = text.trim();
  if (!trimmed) return 'an empty block';
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function ChangeBody({ change }: { change: ProposedChange }) {
  const { blocks } = useEditor();

  if (change.kind === 'rename') {
    const next = change.op.op === 'update_meta' ? change.op.meta?.name?.trim() : undefined;
    if (!next) {
      return (
        <p className="text-sm text-muted-foreground">
          The assistant proposed a title with no text, so there is nothing to apply.
        </p>
      );
    }
    return <p className="text-xl font-semibold">{next}</p>;
  }

  if (change.kind === 'reorder') {
    // Naming the neighbour survives other changes being accepted first; a raw
    // index goes stale the moment anything above it moves.
    const toIndex = change.op.op === 'reorder_block' ? change.op.toIndex : 0;
    const others = blocks.filter((block) => block.id !== change.anchorBlockId);
    const above = others[toIndex - 1];
    return (
      <p className="text-sm text-muted-foreground">
        {above
          ? <>Move below “{shortText(blockText(above))}”.</>
          : 'Move to the top of the document.'}
      </p>
    );
  }

  const current = blocks.find((block) => block.id === change.anchorBlockId);

  if (!current && change.anchorBlockId) {
    return (
      <p className="text-sm text-muted-foreground">
        The block this was written for is no longer in the document, so it cannot be applied.
      </p>
    );
  }

  if (change.kind === 'delete') {
    // The block itself is struck through in place, so repeating its text here
    // would be the second copy of something the author is already looking at.
    return (
      <p className="text-sm text-muted-foreground">
        Remove this block from the document.
      </p>
    );
  }

  if (change.kind === 'insert') {
    return <ProposedBlockView block={proposedBlock(change)} />;
  }

  const merged = mergedBlock(change, current);
  return (
    <ProposedRewriteView
      before={blockText(current)}
      after={blockText(merged)}
      block={merged}
    />
  );
}

export function ChangeCard({ change }: { change: ProposedChange }) {
  const { blocks } = useEditor();
  const { accept, reject, ready, focusedChangeId } = useProposals();

  const style = KIND[change.kind];
  const isReady = ready(change);
  const isFocused = focusedChangeId === change.id;
  const Icon = style.icon;
  const summary = describeChange(change, blocks);

  /**
   * Why Accept is not offered.
   *
   * A lock with no explanation is worse than no lock: the author cannot tell
   * whether the app is broken, whether they are meant to wait, or whether the
   * change is dead. Each of the three reasons has a different answer.
   */
  const blockedReason = (() => {
    if (change.dependsOn.length > 0) {
      return 'This continues the addition above — accept that one first.';
    }
    if (change.anchorBlockId && !blocks.some((block) => block.id === change.anchorBlockId)) {
      return 'The block this was written for is no longer in the document.';
    }
    return 'Decide the change above it first — the two would not combine cleanly.';
  })();

  return (
    <div
      data-change-id={change.id}
      // Deliberately not `.block-row`: the canvas measures those to place the
      // drag indicator, and a proposal is not a drop target.
      className={cn(
        'review-change group/change relative my-1 rounded-r-md border-l-2 py-1.5 pr-3 transition-colors',
        style.rail,
        style.tint,
        isFocused && 'ring-1 ring-primary/50',
      )}
      style={{ paddingLeft: 'var(--doc-gutter)' }}
      // Read as one thing rather than as loose text followed by two buttons.
      role="group"
      aria-label={summary}
    >
      {/* Every kind shares this header: what the change is, what it touches,
          and — when this card can be decided on its own — the decision.
          Naming the kind in text is the difference between reviewing and
          decoding: the old gutter column showed three unlabeled glyphs
          (kind, accept, reject) stacked in 14px, and with 48 cards on screen
          the author could not tell what any of them meant. */}
      <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 text-2xs font-semibold uppercase tracking-wide',
            style.badge,
          )}
        >
          <Icon aria-hidden="true" className="h-3 w-3" />
          {style.label}
        </span>

        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
          {summary}
        </span>

        {/* Immediately after the label, on the left half of the measure —
            `ml-auto` put them at the right edge of the prose column, which is
            exactly where the floating assistant rests, so the panel covered
            the buttons it was telling the author to press. Dimmed rather than
            hover-only, which would be unreachable on touch. */}
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 transition-opacity',
            'focus-within:opacity-100 group-hover/change:opacity-100',
            isFocused ? 'opacity-100' : 'opacity-80',
          )}
        >
          {isReady && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-xs text-diff-add-fg hover:bg-diff-add"
              onClick={() => accept(change.id)}
              aria-label={`Accept: ${summary}`}
            >
              <Check className="h-3 w-3" />
              Accept
            </Button>
          )}
          {/* Always available. A blocked change previously offered neither
              button, so a batch whose first change the author did not want
              could not be cleared from the document at all. */}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => reject(change.id)}
            aria-label={`Reject: ${summary}`}
          >
            <X className="h-3 w-3" />
            Reject
          </Button>
        </span>
      </div>

      {!isReady && (
        <p className="mb-0.5 flex items-center gap-1 text-2xs text-muted-foreground">
          <Lock aria-hidden="true" className="h-3 w-3 shrink-0" />
          {blockedReason}
        </p>
      )}

      <ChangeBody change={change} />
    </div>
  );
}
