import { useMemo, type KeyboardEvent } from 'react';
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
  proposedBlocks,
  withPendingBlocks,
  type AcceptBlocker,
  type ProposedChange,
} from '@/editor/proposals';
import type { Block } from '@/editor/types';
import { coerceBlock } from '@/editor/docOps';
import { RecordedPassage } from './RecordedPassage';
import { citationStyleInfo } from '@/editor/csl/styles';
import { referenceChanges, referenceTitle, type ReferenceChange } from '@/editor/referenceRecords';
import { ProposedBlockView, ProposedRewriteView, STRIKE_WIDGETS } from './ProposedBlockView';
import { previewBibliography } from './diffText';
import { ArrowDownUp, BookMarked, Check, CircleAlert, Eye, History, Lock, Pencil, Plus, TextCursorInput, Trash2, X } from 'lucide-react';

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
  move: { label: 'Suggested move', rail: 'bg-ai/60', icon: ArrowDownUp },
  meta: { label: 'Suggested title', rail: 'bg-ai/60', icon: TextCursorInput },
  sources: { label: 'Suggested sources', rail: 'bg-ai/60', icon: BookMarked },
};

/** The kind's label; a `set_meta` that leaves the title alone sets the citation style. */
function kindLabel(change: ProposedChange): string {
  if (change.op.op === 'set_meta' && change.op.name === undefined) return 'Suggested citation style';
  return KIND[change.kind].label;
}

const CHANGE_FIELDS: Record<ReferenceChange['field'], string> = {
  title: 'Title',
  authors: 'Authors',
  year: 'Year',
  state: 'State',
  flags: 'Marks',
};

/** A library entry as a reader names it: its title, else its key. */
const sourceName = referenceTitle;

/** One-line preview of a block, for naming a move's destination. */
function shortText(text: string, max = 42): string {
  const trimmed = text.trim();
  if (!trimmed) return 'an empty block';
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function ChangeBody({ change }: { change: ProposedChange }) {
  const { blocks, doc } = useEditorDoc();
  const { sets } = useProposals();
  // A change can be about a block another suggestion adds; it reads against
  // that block as the suggestion would add it.
  const known = useMemo(() => withPendingBlocks(blocks, sets), [blocks, sets]);
  const op = change.op;

  if (op.op === 'set_meta') {
    const name = op.name?.trim();
    return (
      <div className="space-y-0.5">
        {op.name !== undefined && (name
          ? <p className="text-xl font-semibold">{name}</p>
          : <p className="text-sm text-muted-foreground">The assistant proposed a title with no text.</p>)}
        {op.citationStyle && (
          <p className="text-sm">Citation style: {citationStyleInfo(op.citationStyle).name}</p>
        )}
      </div>
    );
  }

  if (op.op === 'update_sources') {
    // Each work as the registries now give it, with what changed in it.
    const library = new Map((doc?.sources ?? []).map((source) => [source.key, source]));
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">Refreshes these references from the registries:</p>
        <ul className="ml-4 list-disc space-y-1">
          {op.sources.map((source) => {
            const changes = referenceChanges(library.get(source.key), source);
            return (
              <li key={source.key}>
                <span className="font-medium">{sourceName(library.get(source.key) ?? source, source.key)}</span>
                {changes.length === 0 ? (
                  <span className="text-muted-foreground"> — no visible change</span>
                ) : (
                  <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                    {changes.map((change) => (
                      <li key={change.field}>
                        {CHANGE_FIELDS[change.field]}: <span className="text-diff-remove-fg line-through decoration-1">{change.from}</span>
                        {' → '}
                        <span className="text-foreground">{change.to}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (op.op === 'add_sources' || op.op === 'remove_sources') {
    const library = new Map((doc?.sources ?? []).map((source) => [source.key, source]));
    const names = op.op === 'add_sources'
      ? op.sources.map((source) => sourceName(source, source.key))
      : op.keys.map((key) => sourceName(library.get(key), key));
    return (
      <div className="text-sm">
        <p className="text-muted-foreground">
          {op.op === 'add_sources' ? 'Adds to the page’s sources, without citing them:' : 'Removes from the page’s sources:'}
        </p>
        <ul className={cn('ml-4 list-disc', op.op === 'remove_sources' && 'text-diff-remove-fg line-through decoration-1')}>
          {names.map((name, index) => <li key={`${index}:${name}`}>{name}</li>)}
        </ul>
      </div>
    );
  }

  if (op.op === 'move_block') {
    // Naming the neighbour survives other changes being accepted first.
    const target = known.find((block) => block.id === op.targetBlockId);
    return (
      <p className="text-sm text-muted-foreground">
        {target
          ? <>Move {op.position === 'before' ? 'above' : 'below'} “{shortText(blockText(target))}”.</>
          : 'The block it would move next to is no longer on the page.'}
      </p>
    );
  }

  // A deletion's card sits on the first of its blocks still on the page.
  const current = change.kind === 'delete'
    ? change.targetBlockIds.map((id) => known.find((block) => block.id === id)).find((block): block is Block => block !== undefined)
    : known.find((block) => block.id === change.anchorBlockId);
  const onPage = current !== undefined && blocks.some((block) => block.id === current.id);

  if (!current && change.anchorBlockId && change.kind !== 'insert') {
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
    // The deletion's other blocks are struck where they stand.
    return (
      <ProposedBlockView
        block={current ?? null}
        className={cn('text-diff-remove-fg line-through decoration-1', STRIKE_WIDGETS)}
      />
    );
  }

  const options = { library: doc?.sources, style: doc?.citationStyle ?? null };
  const added = proposedBlocks(change);

  if (change.kind === 'insert') {
    // Where the blocks would land, as "after this id" (null: the very top).
    const anchorIndex = blocks.findIndex((candidate) => candidate.id === change.anchorBlockId);
    const after =
      change.placement === 'end'
        ? blocks[blocks.length - 1]?.id ?? null
        : change.placement === 'before'
          ? blocks[anchorIndex - 1]?.id ?? null
          : change.anchorBlockId;
    const bibliography = previewBibliography(blocks, added, { after }, options);
    return (
      <div>
        {added.map((block) => <ProposedBlockView key={block.id} block={block} bibliography={bibliography} />)}
      </div>
    );
  }

  const merged = mergedBlock(change, current);
  const bibliography = previewBibliography(blocks, [merged, ...added], { replace: current && onPage ? [current.id] : [] }, options);
  return (
    <div>
      <ProposedRewriteView before={current ?? null} after={merged} block={merged} bibliography={bibliography} />
      {/* A rewrite written as several blocks: the first takes the block's place, the rest follow it. */}
      {added.map((block) => (
        <ProposedBlockView key={block.id} block={block} bibliography={bibliography} className="rounded-sm bg-diff-add/60" />
      ))}
    </div>
  );
}

/**
 * What a change rests on, in plain words (TD18): the server flags one that
 * adds a number, source or named term the page does not hold
 * (`new_information`), and names the sources one draws on
 * (`basis`). An operation that only rewords the author's text says nothing.
 */
function EvidenceNote({ change }: { change: ProposedChange }) {
  const { doc } = useEditorDoc();
  const op = change.op;
  const added = op.op === 'add_sources' ? new Set(op.sources.map((source) => source.key)) : null;
  // The additions are already listed above. Repeating their raw keys as
  // evidence (or asking for a citation passage) made a library edit look
  // like a factual claim.
  const keys = (op.basis ?? []).filter((key) => key !== 'author' && !added?.has(key));
  if (!op.newInformation && keys.length === 0) return null;
  const library = new Map((doc?.sources ?? []).map((source) => [source.key, source]));
  const written = op.op === 'write_blocks' ? op.blocks : op.op === 'replace_text' ? [op.block] : [];
  const citations = written.flatMap((raw) => {
    const block = coerceBlock(raw);
    return block?.type === 'paragraph' ? block.children?.filter((child) => child.type === 'citation') ?? [] : [];
  });
  for (const citation of citations) for (const record of citation.sources ?? []) {
    if (!library.has(record.key)) library.set(record.key, record);
  }
  const passages = [...new Map(citations.flatMap((citation) => citation.passage
    ? [[`${citation.passage.chat_id ?? ''}:${citation.passage.id}`, citation.passage] as const] : [])).values()];
  return (
    <div className="mt-0.5 space-y-0.5 break-words text-xs text-muted-foreground">
      {op.newInformation && (
        <p className="flex items-start gap-1">
          <CircleAlert aria-hidden="true" className="mt-px h-3 w-3 shrink-0 text-warning" />
          <span>{added
            ? 'Adds new sources. Check them before accepting.'
            : 'Adds a number, claim, or citation the page doesn’t have yet. Check it before accepting.'}</span>
        </p>
      )}
      {keys.length > 0 && (
        <p className="flex items-start gap-1">
          <BookMarked aria-hidden="true" className="mt-px h-3 w-3 shrink-0" />
          <span>Based on {keys.map((key) => sourceName(library.get(key), key)).join('; ')}</span>
        </p>
      )}
      {op.newInformation && !added && keys.length === 0 && citations.length === 0 && <p>No source recorded.</p>}
      {passages.length > 0
        ? <ul aria-label="Recorded passages">{passages.map((passage) =>
          <li key={`${passage.chat_id ?? ''}:${passage.id}`}><RecordedPassage passage={passage} /></li>)}</ul>
        : op.newInformation && !added && <p>Passage not recorded.</p>}
    </div>
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

/** Why Accept is not offered, as the card says it, and the change to look at first. */
function blockedWords(blocker: AcceptBlocker): { text: string; why?: string; waitsOn: ProposedChange | null } {
  switch (blocker.reason) {
    case 'needs':
      // Rejecting it instead moves an addition that continues it onto its
      // place, or takes a change to its block along, so either decision
      // settles this one.
      return {
        text: 'Accept this first:',
        why: 'This builds on a block another suggestion adds.',
        waitsOn: blocker.change,
      };
    case 'after':
      return {
        text: 'Decide this first:',
        why: 'Both suggestions touch the same block, and the page would come out differently in the other order.',
        waitsOn: blocker.change,
      };
    case 'needs-rejected':
      return { text: 'It builds on a suggestion that was rejected.', waitsOn: null };
    case 'missing':
      return { text: 'The block this was written for is no longer on the page.', waitsOn: null };
    case 'unplaced':
      return { text: 'The block it would go next to is no longer on the page.', waitsOn: null };
    case 'stale':
      return { text: 'The text changed after this was suggested.', waitsOn: null };
    case 'locked':
      return { text: 'This change would edit a locked block or one hidden from the assistant.', waitsOn: null };
    case 'sources':
      return { text: 'The sources or citations no longer match this suggestion.', waitsOn: null };
  }
}

export function ChangeCard({ change }: { change: ProposedChange }) {
  const { blocks } = useEditorDoc();
  const { accept, reject, blocker, focusChange, focusedChangeId, sets } = useProposals();
  const confirm = useConfirm();
  // A viewer sees the suggestion and decides nothing: deciding is an edit (D6).
  const readOnly = usePageReadOnly();
  const viewOnlyNote = 'Viewers can’t accept or reject changes';

  const style = KIND[change.kind];
  /**
   * Why Accept is not offered, naming the suggestion to decide first when
   * there is one. A lock with no explanation is worse than no lock: the
   * author cannot tell whether the app is broken, whether they are meant to
   * wait, or whether the change is dead, and "the change above" sent them
   * looking in the wrong place when the one in the way was further down.
   */
  const blocked = blocker(change);
  const isReady = blocked === null;
  const isFocused = focusedChangeId === change.id;
  const Icon = style.icon;
  const known = useMemo(() => withPendingBlocks(blocks, sets), [blocks, sets]);
  const summary = describeChange(change, known);
  const stale = isStale(change, blocks);
  const keys = reviewKeys();
  const why = blocked ? blockedWords(blocked) : null;
  const waitsOnName = why?.waitsOn ? describeChange(why.waitsOn, known) : null;
  const BlockedIcon = blocked?.reason === 'stale' ? History : Lock;

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
        <span className="shrink-0">{kindLabel(change)}</span>
        {why && !readOnly && (
          <span className="flex min-w-0 items-center gap-1">
            <span aria-hidden="true">·</span>
            <BlockedIcon aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className={cn('truncate', why.waitsOn && 'shrink-0')} title={why.why}>{why.text}</span>
            {why.waitsOn && waitsOnName && (
              <button
                type="button"
                className="min-w-0 truncate rounded-sm text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                onClick={() => focusChange(why.waitsOn!.id)}
                aria-label={`Go to the suggestion to decide first: ${waitsOnName}`}
                title={why.why ? `${why.why} Go to: ${waitsOnName}` : waitsOnName}
              >
                {waitsOnName}
              </button>
            )}
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
      <EvidenceNote change={change} />
    </div>
  );
}
