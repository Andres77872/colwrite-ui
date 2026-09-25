import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirmContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { menuItem, menuSeparator } from '@/components/ui/menuStyles';
import { useEditor } from '@/editor';
import { useProposals } from '@/editor/proposalsContextState';
import { describeChange, pendingInDocumentOrder, type ProposedChange } from '@/editor/proposals';
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
} from 'lucide-react';

const KIND_ICON: Record<ProposedChange['kind'], typeof Plus> = {
  insert: Plus,
  replace: Pencil,
  delete: Trash2,
  reorder: ArrowDownUp,
  rename: TextCursorInput,
};

/**
 * "3 suggestions" in the page topbar: the one place a pending batch is
 * announced, and the one place its batch controls live.
 *
 * The pill opens a small review menu — step through the changes (‹ 1 of 3 ›),
 * jump to any of them from the list, or decide the lot with Accept all /
 * Reject all. It replaced a floating bar that pinned the same controls over
 * the first lines of the page, where it covered the text being reviewed and
 * repeated the count the topbar already showed.
 */
export function ReviewPill() {
  const { blocks } = useEditor();
  const { sets, pendingCount, acceptAll, rejectAll, focusChange, focusedChangeId } = useProposals();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);

  if (pendingCount === 0) return null;

  // Reading order, so Next always means "further down the page".
  const pending = pendingInDocumentOrder(blocks, sets);
  const current = pending.findIndex((change) => change.id === focusedChangeId);
  const plural = `${pendingCount} change${pendingCount === 1 ? '' : 's'}`;
  const label = `${pendingCount} suggestion${pendingCount === 1 ? '' : 's'}`;

  const step = (delta: 1 | -1) => {
    if (pending.length === 0) return;
    // Nothing focused yet: Next starts at the first change, Previous at the last.
    const next =
      current === -1
        ? delta === 1 ? 0 : pending.length - 1
        : (current + delta + pending.length) % pending.length;
    focusChange(pending[next].id);
  };

  // Both act on every pending change at once and there is no undo, so both
  // ask first — rejecting all used to discard a whole batch on one click.
  const onAcceptAll = async () => {
    setOpen(false);
    const ok = await confirm({
      title: `Accept all ${plural}?`,
      description: 'Every pending suggestion will be applied to the document.',
      confirmLabel: 'Accept all',
    });
    if (ok) acceptAll();
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

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="flex-1 text-diff-add-fg hover:bg-diff-add hover:text-diff-add-fg"
            onClick={() => void onAcceptAll()}
          >
            <Check />
            Accept all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="flex-1 font-normal text-muted-foreground hover:text-foreground"
            onClick={() => void onRejectAll()}
          >
            <X />
            Reject all
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
