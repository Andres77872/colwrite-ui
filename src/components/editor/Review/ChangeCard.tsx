import type { KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { useConfirm } from '@/components/ui/confirmContext';
import { modifierLabel } from '@/components/layout/Shortcuts/shortcuts';
import { useEditorDoc, usePageReadOnly } from '@/editor';
import { useProposals } from '@/editor/proposalsContextState';
import {
  blockText,
  describeChange,
  isStale,
  mergedBlock,
  planRejection,
  proposedBlock,
  type ProposedChange,
} from '@/editor/proposals';
import { ProposedBlockView, ProposedRewriteView, STRIKE_WIDGETS } from './ProposedBlockView';
import { previewBibliography } from './diffText';
import { ArrowDownUp, Check, Eye, History, Lock, Pencil, Plus, TextCursorInput, Trash2, X } from 'lucide-react';

/**
 * One proposed change, rendered in the document at the position it would take.
 *
 * The row lines up with `.block-row`: same gutter, same measure, same prose
 * size, so the proposed paragraph sits in the column of text it is joining.
 * The chrome is deliberately small — a 2px rail in the change's colour, one
 * quiet line naming the change, and two icon buttons whose labels appear on
 * hover or focus. The diff colours on the text are what carry the change.
 */

const KIND: Record<
  ProposedChange['kind'],
  { label: string; rail: string; tint?: string; icon: typeof Plus }
> = {
  insert: { label: 'Suggested addition', rail: 'bg-diff-add-border', tint: 'bg-diff-add/60', icon: Plus },
  replace: { label: 'Suggested rewrite', rail: 'bg-ai/60', icon: Pencil },
  delete: {
    label: 'Suggested deletion',
    rail: 'bg-diff-remove-border',
    tint: 'bg-diff-remove/60',
    icon: Trash2,
  },
  reorder: { label: 'Suggested move', rail: 'bg-ai/60', icon: ArrowDownUp },
  rename: { label: 'Suggested title', rail: 'bg-ai/60', icon: TextCursorInput },
};

/** One-line preview of a block, for naming a move's destination. */
function shortText(text: string, max = 42): string {
  const trimmed = text.trim();
  if (!trimmed) return 'an empty block';
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function ChangeBody({ change }: { change: ProposedChange }) {
  const { blocks, doc } = useEditorDoc();

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
          : 'Move to the top of the page.'}
      </p>
    );
  }

  const current = blocks.find((block) => block.id === change.anchorBlockId);

  if (!current && change.anchorBlockId) {
    return (
      <p className="text-sm text-muted-foreground">
        The block this was written for is no longer on the page, so it cannot be applied.
      </p>
    );
  }

  if (change.kind === 'delete') {
    // Shown in the block's place, struck through, in the same card as every
    // other suggestion: the block row itself is hidden while the deletion is
    // pending (see `.review-change` in globals.css), so the label sits above
    // the text it names rather than under it, next to the following block.
    return (
      <ProposedBlockView
        block={current ?? null}
        className={cn('text-diff-remove-fg line-through decoration-1', STRIKE_WIDGETS)}
      />
    );
  }

  const options = { library: doc?.sources, style: doc?.citationStyle ?? null };

  if (change.kind === 'insert') {
    const block = proposedBlock(change);
    // Where the block would land, as "after this id" (null: the very top).
    const anchorIndex = blocks.findIndex((candidate) => candidate.id === change.anchorBlockId);
    const after =
      change.placement === 'start'
        ? null
        : change.placement === 'end'
          ? blocks[blocks.length - 1]?.id ?? null
          : change.placement === 'before'
            ? blocks[anchorIndex - 1]?.id ?? null
            : change.anchorBlockId;
    return (
      <ProposedBlockView
        block={block}
        bibliography={previewBibliography(blocks, [block], { after }, options)}
      />
    );
  }

  const merged = mergedBlock(change, current);
  return (
    <ProposedRewriteView
      before={current ?? null}
      after={merged}
      block={merged}
      bibliography={previewBibliography(blocks, [merged], { replace: current ? [current.id] : [] }, options)}
    />
  );
}

/**
 * A button's word, shown on hover or focus: icons at rest keep the row quiet
 * while reading, and the label says what the button does once it is reached.
 */
function HoverLabel({ children }: { children: string }) {
  return <span className="hidden group-hover/change:inline group-focus-within/change:inline">{children}</span>;
}

/**
 * The card's own shortcut, shown while the card holds focus — the only time
 * it works. Hidden on narrow screens, where there is rarely a keyboard and
 * never the room. `aria-keyshortcuts` on the button carries it for screen
 * readers, so this copy is not read twice.
 */
function KeyHint({ keys }: { keys: readonly string[] }) {
  return (
    <span aria-hidden="true" className="hidden items-center gap-0.5 sm:group-focus-within/change:inline-flex">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </span>
  );
}

/**
 * Accept and reject from the keyboard while a card has focus.
 *
 * Both carry the platform modifier, like every app shortcut, and neither is
 * one the app or the browser already uses: Mod+Enter is "apply" in Ask AI
 * too, and Mod+Backspace does nothing outside text. They are handled on the
 * card, so they never fire from the document's own text.
 */
function reviewKeys() {
  const shown = modifierLabel();
  const aria = shown === '⌘' ? 'Meta' : 'Control';
  return {
    accept: { aria: `${aria}+Enter`, keys: [shown, 'Enter'], hint: `${shown}+Enter` },
    reject: {
      aria: `${aria}+Backspace ${aria}+Delete`,
      keys: [shown, 'Backspace'],
      hint: `${shown}+Backspace`,
    },
  };
}

export function ChangeCard({ change }: { change: ProposedChange }) {
  const { blocks } = useEditorDoc();
  const { accept, reject, ready, focusedChangeId, sets, pending } = useProposals();
  const confirm = useConfirm();
  // A viewer sees the suggestion and decides nothing: deciding is an edit (D6).
  const readOnly = usePageReadOnly();
  const viewOnlyNote = 'Viewers can’t accept or reject changes';

  const style = KIND[change.kind];
  const isReady = ready(change);
  const isFocused = focusedChangeId === change.id;
  const Icon = style.icon;
  const summary = describeChange(change, blocks);
  const stale = isStale(change, blocks);
  const keys = reviewKeys();

  /**
   * Why Accept is not offered.
   *
   * A lock with no explanation is worse than no lock: the author cannot tell
   * whether the app is broken, whether they are meant to wait, or whether the
   * change is dead. Each of the reasons has a different answer.
   */
  const blockedReason = (() => {
    if (change.dependsOn.some((id) => pending.some((candidate) => candidate.id === id))) {
      // Rejecting that one moves this one onto its place, so either decision
      // unlocks it.
      return 'This continues the addition above. Accept or reject that one first.';
    }
    if (change.anchorBlockId && !blocks.some((block) => block.id === change.anchorBlockId)) {
      return 'The block this was written for is no longer on the page.';
    }
    if (stale) return 'The text changed after this was suggested.';
    return 'Decide the change above it first — the two would not combine cleanly.';
  })();
  const BlockedIcon = stale && !isReady ? History : Lock;

  /**
   * Reject, saying first what goes with it.
   *
   * The paragraphs that continue from a rejected addition move onto its
   * place and stay to be decided. A rewrite or deletion of the block it would
   * have added has nothing left to apply to, so it goes too — and the author
   * is told before rather than finding it gone.
   */
  const onReject = async () => {
    const { cascaded } = planRejection(change.id, sets);
    const count = cascaded.length;
    if (count > 0) {
      const ok = await confirm({
        title: count === 1
          ? 'Reject this addition and the change to it?'
          : `Reject this addition and the ${count} changes to it?`,
        description: count === 1
          ? 'Another suggestion edits the block this would add, so it is rejected too. This cannot be undone.'
          : `${count} other suggestions edit the block this would add, so they are rejected too. This cannot be undone.`,
        confirmLabel: count === 1 ? 'Reject both' : `Reject all ${count + 1}`,
        destructive: true,
      });
      if (!ok) return;
    }
    reject(change.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (isReady) accept(change.id);
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      event.stopPropagation();
      void onReject();
    }
  };

  return (
    <div
      data-change-id={change.id}
      // A pending rewrite takes its block's place on the page (see
      // `.review-change` in globals.css), so the text appears once, as a diff.
      data-change-kind={change.kind}
      data-stale={stale || undefined}
      // The review menu's Next/Previous puts DOM focus here (see `focusChange`), so
      // the card must be focusable — but as a target only, never a tab stop.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // Deliberately not `.block-row`: the canvas measures those to place the
      // drag indicator, and a proposal is not a drop target.
      className={cn(
        'review-change group/change relative my-0.5 rounded-md py-1 pr-2 outline-none transition-colors',
        style.tint,
        isFocused && !style.tint && 'bg-hover',
        'focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
      style={{ paddingLeft: 'var(--doc-gutter)' }}
      // Read as one thing rather than as loose text followed by two buttons.
      role="group"
      aria-label={summary}
    >
      <span
        aria-hidden="true"
        className={cn('absolute bottom-1 top-1 w-0.5 rounded-full', style.rail)}
        style={{ left: 'calc(var(--doc-gutter) - 10px)' }}
      />
      <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0">{style.label}</span>
        {!isReady && !readOnly && (
          <span className="flex min-w-0 items-center gap-1 truncate">
            <span aria-hidden="true">·</span>
            <BlockedIcon aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="truncate">{blockedReason}</span>
          </span>
        )}

        {readOnly && (
          <span className="flex min-w-0 items-center gap-1 truncate">
            <span aria-hidden="true">·</span>
            <Eye aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="truncate">{viewOnlyNote}</span>
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {(isReady || readOnly) && (
            <Button
              size="xs"
              variant="ghost"
              className="font-normal text-diff-add-fg hover:bg-diff-add hover:text-diff-add-fg"
              onClick={() => accept(change.id)}
              disabled={readOnly}
              aria-label={`Accept: ${summary}`}
              aria-keyshortcuts={readOnly ? undefined : keys.accept.aria}
              title={readOnly ? viewOnlyNote : `Accept (${keys.accept.hint})`}
            >
              <Check />
              <HoverLabel>Accept</HoverLabel>
              <KeyHint keys={keys.accept.keys} />
            </Button>
          )}
          {/* Always available. A blocked change previously offered neither
              button, so a batch whose first change the author did not want
              could not be cleared from the document at all. */}
          <Button
            size="xs"
            variant="ghost"
            className="font-normal text-muted-foreground hover:text-foreground"
            onClick={() => void onReject()}
            disabled={readOnly}
            aria-label={`Reject: ${summary}`}
            aria-keyshortcuts={readOnly ? undefined : keys.reject.aria}
            title={readOnly ? viewOnlyNote : `Reject (${keys.reject.hint})`}
          >
            <X />
            <HoverLabel>Reject</HoverLabel>
            <KeyHint keys={keys.reject.keys} />
          </Button>
        </span>
      </div>

      <ChangeBody change={change} />
    </div>
  );
}
