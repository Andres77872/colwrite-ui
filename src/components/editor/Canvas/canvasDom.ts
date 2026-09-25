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
