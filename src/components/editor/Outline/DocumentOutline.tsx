import { useEffect, useMemo, useState, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { scrollBehavior } from '@/lib/motion';
import { htmlToText, type Block } from '@/editor';

type Entry = { id: string; level: 1 | 2 | 3; text: string };

/** How far below the top of the scroll area a heading counts as "current". */
const READING_LINE = 140;

/**
 * Floating outline at the canvas's right edge.
 *
 * At rest it is a column of short dashes, one per heading, longer for higher
 * levels; hovering or focusing it opens the heading list, and the current
 * section is marked in both states. The same map Notion shows on long pages —
 * the one place a writer sees the shape of the whole document while
 * reading any part of it.
 */
export function DocumentOutline({
  blocks,
  scrollRef,
  fullWidth,
}: {
  blocks: readonly Block[];
  scrollRef: RefObject<HTMLElement | null>;
  /** A full-width page has no margin wider than its padding to open into. */
  fullWidth: boolean;
}) {
  const entries = useMemo<Entry[]>(
    () =>
      blocks.flatMap((block) =>
        block.type === 'heading'
          ? [{ id: block.id, level: block.level, text: htmlToText(block.html).trim() || 'Untitled' }]
          : [],
      ),
    [blocks],
  );
  const [current, setCurrent] = useState<string | null>(null);
  /** The dash the keyboard is on, marked in the heading list that covers it. */
  const [focused, setFocused] = useState<string | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || entries.length < 2) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = container.getBoundingClientRect().top + READING_LINE;
      let found: string | null = null;
      for (const entry of entries) {
        const row = container.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(entry.id)}"]`);
        if (!row) continue;
        if (row.getBoundingClientRect().top <= top) found = entry.id;
        else break;
      }
      setCurrent(found ?? entries[0]?.id ?? null);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [entries, scrollRef]);

  if (entries.length < 2) return null;

  const jump = (id: string) => {
    const row = scrollRef.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
    const editable = row?.querySelector<HTMLElement>('[role="textbox"]');
    editable?.focus({ preventScroll: true });
  };

  return (
    // A zero-height sticky host keeps the outline in view without taking any
    // room from the document column. It lives in the page's right padding and
    // only appears once that padding is the full 96px (a canvas of 820px or
    // more), so the dashes never sit on text.
    //
    // It comes after the page in the DOM (Canvas renders it last) so Tab
    // reaches the title before five outline stops; `order-first` keeps it
    // visually at the top, where the sticky offset measures from.
    <div className="pointer-events-none sticky top-32 z-[var(--z-chrome)] order-first hidden h-0 @min-[820px]/canvas:block">
      <nav
        aria-label="Document outline"
        className="group/outline pointer-events-auto absolute right-6 top-0 flex max-h-[60vh] flex-col items-end"
      >
        {/* The dashes are the outline: one button per heading, longer for
            higher levels, the current section in the text colour. */}
        <ol className="flex flex-col items-end py-1">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => jump(entry.id)}
                aria-label={entry.text}
                aria-current={entry.id === current ? 'location' : undefined}
                onFocus={() => setFocused(entry.id)}
                onBlur={() => setFocused((id) => (id === entry.id ? null : id))}
                className={cn(
                  'group/dash flex h-3.5 w-6 items-center justify-end rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  // Where the heading list opens over the dashes, the focus is
                  // shown on its row instead of as a ring peeking out from under it.
                  !fullWidth && '@min-[1200px]/canvas:focus-visible:ring-0',
                )}
              >
                <span
                  className={cn(
                    'h-0.5 rounded-full transition-colors',
                    entry.level === 1 ? 'w-4' : entry.level === 2 ? 'w-3' : 'w-2',
                    entry.id === current
                      ? 'bg-foreground'
                      : 'bg-muted-foreground/40 group-hover/dash:bg-muted-foreground',
                  )}
                />
              </button>
            </li>
          ))}
        </ol>
        {/* The heading list, for the pointer: it opens into the margin beside
            the dashes, and only where the margin is wide enough to hold it
            without covering the text. The dashes above carry the same
            targets for the keyboard and assistive tech. */}
        <ol
          aria-hidden="true"
          className={cn(
            'absolute right-0 top-0 hidden max-h-[60vh] w-52 overflow-y-auto rounded-lg bg-popover p-1.5 shadow-lg',
            // 708px of text plus 2 × (24px inset + 208px panel + 12px air).
            !fullWidth && '@min-[1200px]/canvas:block',
            'invisible opacity-0 transition-opacity duration-150 group-focus-within/outline:visible group-focus-within/outline:opacity-100 group-hover/outline:visible group-hover/outline:opacity-100',
          )}
        >
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => jump(entry.id)}
                className={cn(
                  'block w-full truncate rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-hover',
                  entry.level === 2 && 'pl-4',
                  entry.level === 3 && 'pl-6',
                  entry.id === current ? 'text-foreground' : 'text-muted-foreground',
                  // The heading Enter would jump to, for a keyboard user.
                  entry.id === focused && 'bg-hover text-foreground ring-2 ring-inset ring-ring',
                )}
              >
                {entry.text}
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
