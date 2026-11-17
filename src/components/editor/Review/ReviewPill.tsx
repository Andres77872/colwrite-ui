import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirmContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { menuItem, menuSeparator } from '@/components/ui/menuStyles';
import { useEditorDoc, usePageReadOnly } from '@/editor';
import { useProposals } from '@/editor/proposalsContextState';
import {
  describeChange,
  groupChanges,
  pendingInDocumentOrder,
  planBulkAccept,
  wordingChanges,
  type ChangeSet,
  type ProposedChange,
} from '@/editor/proposals';
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Sparkles,
  TextCursorInput,
  Trash2,
  X,
  BookMarked,
} from 'lucide-react';

const KIND_ICON: Record<ProposedChange['kind'], typeof Plus> = {
  insert: Plus,
  replace: Pencil,
  delete: Trash2,
  move: ArrowDownUp,
  meta: TextCursorInput,
  sources: BookMarked,
};

const INCLUDE_FLAGGED = { includeFlagged: true } as const;

function bulkSummary(plan: ReturnType<typeof planBulkAccept> | null, changes: ProposedChange[]) {
  const ids = new Set([...(plan?.landedIds ?? []), ...(plan?.applied.map((change) => change.id) ?? [])]);
  return {
    ids,
    count: ids.size,
    flagged: changes.filter((change) => ids.has(change.id) && change.op.newInformation).length,
    remaining: changes.length - ids.size,
  };
}

function bulkDescription({ count, flagged, remaining }: ReturnType<typeof bulkSummary>, excludingFlagged = false) {
  return [
    count === 1 ? '1 suggestion will be accepted.' : `${count} suggestions will be accepted together.`,
    flagged > 0
      ? `Includes ${flagged} with new information. Accepting does not verify claims or sources.`
      : null,
    remaining > 0
      ? `${remaining} will stay pending${excludingFlagged ? ', including suggestions with new information' : ' and won’t be applied'}.`
      : null,
  ].filter(Boolean).join(' ');
}

/** How long an arrival announcement stays in the live region. */
const ANNOUNCEMENT_MS = 6000;

function pendingIds(sets: readonly ChangeSet[]): string[] {
  return sets.flatMap((set) =>
    set.changes.filter((change) => change.status === 'pending').map((change) => change.id),
  );
}

/**
 * What a screen reader hears when suggestions arrive: once per arrival, and
 * never for the author's own decisions.
 *
 * The count in the pill changes silently, so a non-sighted author had no way
 * to know the assistant had proposed anything. Only ids not seen before
 * count as an arrival: accepting or rejecting removes ids and says nothing,
 * and a re-render with the same suggestions says nothing either. Whatever is
 * pending when the pill first mounts is taken as already known.
 */
function useArrivalAnnouncement(sets: readonly ChangeSet[]): string {
  const ids = pendingIds(sets);
  const key = ids.join('\n');
  const seenRef = useRef<Set<string> | null>(null);
  const timerRef = useRef<number | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const current = key ? key.split('\n') : [];
    const seen = seenRef.current;
    seenRef.current = new Set([...(seen ?? []), ...current]);
    if (!seen) return;
    const arrived = current.filter((id) => !seen.has(id)).length;
    if (arrived === 0) return;
    const total = current.length;
    const noun = (count: number) => `suggestion${count === 1 ? '' : 's'}`;
    setMessage(
      arrived === total
        ? `${total} ${noun(total)} to review.`
        : `${arrived} new ${noun(arrived)}, ${total} to review.`,
    );
    // Cleared again so the same sentence is read out the next time it is
    // true, rather than being a no-op change to the region. Not tied to this
    // effect's cleanup: deciding a change a moment later must not leave the
    // sentence stuck in the region.
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setMessage('');
    }, ANNOUNCEMENT_MS);
  }, [key]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return message;
}

/**
 * "3 suggestions" in the page topbar: the one place a pending batch is
 * announced, and the one place its batch controls live.
 *
 * The pill opens a small review menu — step through the changes (‹ 1 of 3 ›),
 * jump to any of them from the list, confirm a bulk acceptance, or reject
 * the lot. It replaced a floating bar that pinned the same controls over
 * the first lines of the page, where it covered the text being reviewed and
 * repeated the count the topbar already showed.
 */
export function ReviewPill() {
  const { doc, blocks } = useEditorDoc();
  const { sets, pendingCount, acceptAll, acceptWording, acceptGroup, rejectGroup, rejectAll, focusChange, focusedChangeId } = useProposals();
  // A viewer steps through the suggestions and decides none of them.
  const readOnly = usePageReadOnly();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const announcement = useArrivalAnnouncement(sets);

  // Mounted whatever the count: a live region only speaks for changes made
  // after it is in the page, so it cannot arrive together with the pill.
  // A bare polite region rather than `role="status"`: the topbar's save
  // state is the page's status, and this is not a second one.
  const liveRegion = (
    <span aria-live="polite" aria-atomic="true" data-review-announcer="" className="sr-only">
      {announcement}
    </span>
  );

  if (pendingCount === 0) return liveRegion;

  // Reading order, so Next always means "further down the page".
  const pending = pendingInDocumentOrder(blocks, sets);
  const current = pending.findIndex((change) => change.id === focusedChangeId);
  const plural = `${pendingCount} change${pendingCount === 1 ? '' : 's'}`;
  const label = `${pendingCount} suggestion${pendingCount === 1 ? '' : 's'}`;
  const flagged = pending.filter((change) => change.op.newInformation);
  const canAccept = open && !readOnly;
  const bulk = bulkSummary(canAccept ? planBulkAccept(pending, sets, doc, INCLUDE_FLAGGED) : null, pending);
  const unflagged = canAccept && bulk.flagged > 0
    ? bulkSummary(planBulkAccept(pending, sets, doc), pending)
    : null;
  const blocked = canAccept ? bulk.remaining : 0;
  const bulkLabel = blocked > 0 ? 'Accept available' : 'Accept all';
  const nextIndividual = flagged.length > 0
    ? flagged[(flagged.findIndex((change) => change.id === focusedChangeId) + 1) % flagged.length]
    : undefined;

  const step = (delta: 1 | -1) => {
    if (pending.length === 0) return;
    // Nothing focused yet: Next starts at the first change, Previous at the last.
    const next =
      current === -1
        ? delta === 1 ? 0 : pending.length - 1
        : (current + delta + pending.length) % pending.length;
    const change = pending[next];
    if (change) focusChange(change.id);
  };

  const onAcceptAll = async (includeFlagged: boolean) => {
    const selection = includeFlagged ? bulk : unflagged;
    if (!selection?.count) return;
    setOpen(false);
    const ok = await confirm({
      title: `Accept ${selection.count} ${selection.count === 1 ? 'suggestion' : 'suggestions'}?`,
      description: bulkDescription(selection, !includeFlagged),
      confirmLabel: includeFlagged ? bulkLabel : 'Accept without new information',
    });
    if (ok) acceptAll(selection.ids, includeFlagged ? INCLUDE_FLAGGED : undefined);
  };

  const onAcceptWording = async () => {
    setOpen(false);
    if (await confirm({
      title: 'Accept wording changes?',
      description: 'Only unflagged operations in the stored Wording groups are applied. New information, changed or locked targets, and changes waiting on another decision stay pending.',
      confirmLabel: 'Accept wording changes',
    })) acceptWording();
  };

  const onAcceptGroup = async (set: ChangeSet, group: ChangeSet['groups'][number], selection: ReturnType<typeof bulkSummary>) => {
    if (selection.count === 0) return;
    setOpen(false);
    if (await confirm({
      title: `Accept ${group.label.toLowerCase()} group?`,
      description: bulkDescription(selection),
      confirmLabel: 'Accept group',
    })) acceptGroup(set.id, group.kind, selection.ids, INCLUDE_FLAGGED);
  };

  const onRejectGroup = async (set: ChangeSet, group: ChangeSet['groups'][number]) => {
    setOpen(false);
    if (await confirm({
      title: `Reject ${group.label.toLowerCase()} changes?`,
      description: 'This decides every pending operation in this group. Suggestions that depend on a rejected insertion may also be rejected.',
      confirmLabel: 'Reject group',
      destructive: true,
    })) rejectGroup(set.id, group.kind);
  };

  const onRejectAll = async () => {
    setOpen(false);
    const ok = await confirm({
      title: `Reject all ${plural}?`,
      description: 'Every pending suggestion will be discarded. This cannot be undone.',
      confirmLabel: 'Reject all',
      destructive: true,
    });
    if (ok) rejectAll();
  };

  return (
    <>
      {liveRegion}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label}, review`}
            className={cn(
              'mr-1 flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-ai/10 pl-2.5 pr-2 text-sm font-medium text-ai transition-colors hover:bg-ai/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              open && 'bg-ai/15',
            )}
          >
            <Sparkles aria-hidden="true" className="size-3.5" />
            <span className="tabular-nums">
              {pendingCount}
              <span className="max-sm:hidden"> suggestion{pendingCount === 1 ? '' : 's'}</span>
            </span>
            <ChevronDown aria-hidden="true" className={cn('size-3.5 opacity-70 transition-transform', open && 'rotate-180')} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="w-80 max-w-[calc(100vw-16px)] p-1.5"
          aria-label="Suggested changes"
          // Stepping moves focus onto the change in the page (so the next Tab
          // continues from what was just revealed). That is not a reason to
          // close the menu: the author is still stepping through the batch.
          onFocusOutside={(event) => {
            const target = event.target as Element | null;
            if (target?.closest?.('[data-change-id]')) event.preventDefault();
          }}
        >
          <div className="flex h-8 items-center gap-1 pl-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
            <Button size="icon-xs" variant="icon" onClick={() => step(-1)} aria-label="Previous change">
              <ChevronLeft />
            </Button>
            <span className="min-w-[3.25rem] text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {current >= 0 ? `${current + 1} of ${pending.length}` : `– of ${pending.length}`}
            </span>
            <Button size="icon-xs" variant="icon" onClick={() => step(1)} aria-label="Next change">
              <ChevronRight />
            </Button>
          </div>

          <div role="separator" className={menuSeparator} />

          {nextIndividual && (
            <div className="flex items-center gap-2 px-2 py-1">
              <p className="flex-1 text-xs text-muted-foreground">
                {flagged.length} {flagged.length === 1 ? 'suggestion adds' : 'suggestions add'} new information.
              </p>
              <Button size="sm" variant="ghost" onClick={() => focusChange(nextIndividual.id)}>
                Review flagged
              </Button>
            </div>
          )}

          {sets.some((set) => set.groups.length > 0) && (
            <div className="max-h-52 space-y-2 overflow-y-auto px-1 py-1" aria-label="Suggestion groups">
              {sets.map((set) => (
                <div key={set.id}>
                  {set.message && <p className="px-1 text-xs text-muted-foreground">{set.message}</p>}
                  {set.groups.map((group) => {
                    const changes = groupChanges(set, group.kind);
                    if (!changes.length) return null;
                    const selection = bulkSummary(canAccept ? planBulkAccept(changes, sets, doc, INCLUDE_FLAGGED) : null, changes);
                    return <div key={group.kind} className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 text-xs">{group.label} ({changes.length})</span>
                      <Button size="sm" variant="ghost" aria-label={`Accept ${group.label.toLowerCase()} group`}
                        disabled={selection.count === 0}
                        onClick={() => void onAcceptGroup(set, group, selection)}>Accept</Button>
                      <Button size="sm" variant="ghost" aria-label={`Reject ${group.label.toLowerCase()} group`}
                        disabled={readOnly} onClick={() => void onRejectGroup(set, group)}>Reject</Button>
                    </div>;
                  })}
                </div>
              ))}
            </div>
          )}
          <ul aria-label="All suggestions" className="max-h-64 overflow-y-auto">
            {pending.map((change, index) => {
              const Icon = KIND_ICON[change.kind] ?? Pencil;
              const active = index === current;
              return (
                <li key={change.id}>
                  <button
                    type="button"
                    aria-current={active || undefined}
                    onClick={() => focusChange(change.id)}
                    className={cn(menuItem, 'w-full text-left', active && 'bg-active')}
                  >
                    <Icon aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{describeChange(change, blocks)}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div role="separator" className={menuSeparator} />

          {readOnly && (
            <p className="px-2 py-1 text-xs text-muted-foreground">Viewers can’t accept or reject changes. An editor decides them.</p>
          )}
          {blocked > 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {blocked} {blocked === 1 ? 'suggestion can’t' : 'suggestions can’t'} be applied yet. See the cards for details.
            </p>
          )}
          {wordingChanges(sets).length > 0 && (
            <Button size="sm" variant="ghost" className="w-full justify-start" disabled={readOnly}
              onClick={() => void onAcceptWording()}>
              <Check />Accept wording changes
            </Button>
          )}
          {unflagged && unflagged.count > 0 && (
            <Button size="sm" variant="ghost" className="w-full justify-start"
              onClick={() => void onAcceptAll(false)}>
              <Check />Accept without new information ({unflagged.count})
            </Button>
          )}
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 text-diff-add-fg hover:bg-diff-add hover:text-diff-add-fg"
              disabled={bulk.count === 0}
              onClick={() => void onAcceptAll(true)}
            >
              <Check />
              {bulkLabel}{bulk.count > 0 ? ` (${bulk.count})` : ''}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 font-normal text-muted-foreground hover:text-foreground"
              disabled={readOnly}
              onClick={() => void onRejectAll()}
            >
              <X />
              Reject all
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
