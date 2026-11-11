/**
 * DOM helpers shared by the canvas's pointer interactions: the marquee and
 * drag-to-select (useBlockSelection), moving a block by its handle
 * (useBlockDrag) and the reorder animation (ReorderMotion).
 */

/** A block row, as opposed to a proposal card or panel between rows. */
export const BLOCK_ROW = '.blocks-container > .block-row[data-block-id]';

/** The block rows in document order (proposal rows are not blocks). */
export function blockRows(root: ParentNode | null = document): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(BLOCK_ROW)) : [];
}

/** The row of block `id` inside the same canvas as `from`. */
export function blockRowOf(from: Element | null, id: string): HTMLElement | null {
  const container = from?.closest('.blocks-container');
  if (!container) return null;
  return container.querySelector<HTMLElement>(`:scope > .block-row[data-block-id="${CSS.escape(id)}"]`);
}

/**
 * The suggestion that is shown in place of a block row, if there is one.
 *
 * A pending rewrite or deletion takes its block's place on the page: the row
 * is `display: none` and the suggestion card under it carries the text (see
 * `.review-change` in globals.css, which this mirrors). The block is still in
 * the document, so anything that walks blocks by id has to ask before it puts
 * a caret there or merges text into it.
 */
export function reviewInPlaceOf(row: Element | null): HTMLElement | null {
  let next = row?.nextElementSibling ?? null;
  for (let i = 0; i < 2 && next?.classList.contains('review-change'); i += 1) {
    const kind = next.getAttribute('data-change-kind');
    if (kind === 'replace' || kind === 'delete') return next as HTMLElement;
    next = next.nextElementSibling;
  }
  return null;
}

/** Distance from the scroller's edge at which a drag starts auto-scrolling. */
export const EDGE = 48;

/**
 * How far to scroll this frame with the pointer at viewport height `y`: zero
 * outside the edge band, faster the deeper into it the pointer is.
 */
export function edgeScrollDelta(bounds: DOMRect, y: number): number {
  if (y < bounds.top + EDGE) return -Math.ceil((bounds.top + EDGE - y) / 4);
  if (y > bounds.bottom - EDGE) return Math.ceil((y - (bounds.bottom - EDGE)) / 4);
  return 0;
}

/** Whether the OS asks for reduced motion. CSS honours it globally; script-driven animations must ask. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
