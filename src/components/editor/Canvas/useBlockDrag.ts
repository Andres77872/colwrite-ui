import { useEffect, useRef } from 'react';
import type { DragEvent, RefObject } from 'react';
import type { Block } from '@/editor';
import { BLOCK_ROW, blockRows, edgeScrollDelta } from './canvasDom';

/** The drag type the block handle sets (see BlockControls). */
export const BLOCK_DRAG_TYPE = 'application/x-block-id';

/** `types` identifies the drag even where `getData` is still empty mid-drag. */
export const isBlockDrag = (event: DragEvent) =>
  Array.from(event.dataTransfer.types || []).includes(BLOCK_DRAG_TYPE);

/** Enough of a long block to recognise it by; the rest fades out. */
const PREVIEW_MAX_HEIGHT = 200;
/** The preview card's padding, so its text sits where the block's does. */
const PREVIEW_PAD_X = 12;
const PREVIEW_PAD_Y = 6;

/** One drag of a block handle, from dragstart to drop or dragend. */
interface Session {
  id: string;
  row: HTMLElement;
  /** Where the block would be inserted, as an index into the rows; null while outside the page. */
  index: number | null;
  /** The pointer's last viewport height, which auto-scroll keeps working from. */
  y: number;
  scrollFrame: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * What follows the pointer: the block itself on a lifted card. By default
 * the browser drags a picture of the handle, a six-dot glyph that says
 * nothing about what is being moved.
 *
 * The card is built inside the page so the block keeps its own type styles,
 * parked off screen, and removed as soon as the browser has taken its
 * snapshot, which it does when dragstart returns.
 */
function setDragPreview(row: HTMLElement, event: DragEvent) {
  const content = row.querySelector<HTMLElement>('.block-content') ?? row;
  const box = content.getBoundingClientRect();
  const clone = row.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.block-controls, .block-marks').forEach((node) => node.remove());
  // A copy to look at: nothing in it can be focused, edited, or mistaken for
  // the real block by a selector.
  for (const el of [clone, ...clone.querySelectorAll<HTMLElement>('*')]) {
    el.removeAttribute('id');
    el.removeAttribute('contenteditable');
    el.removeAttribute('tabindex');
  }
  for (const name of ['data-block-id', 'data-active', 'data-selected', 'data-ai-target', 'aria-selected']) {
    clone.removeAttribute(name);
  }

  const preview = document.createElement('div');
  preview.className = 'block-drag-preview';
  preview.setAttribute('aria-hidden', 'true');
  preview.style.width = `${box.width + 2 * PREVIEW_PAD_X}px`;
  preview.style.maxHeight = `${PREVIEW_MAX_HEIGHT}px`;
  preview.style.padding = `${PREVIEW_PAD_Y}px ${PREVIEW_PAD_X}px`;
  preview.append(clone);
  (row.closest('.document-container') ?? document.body).append(preview);
  if (preview.scrollHeight > preview.clientHeight) preview.setAttribute('data-clipped', '');

  // Picked up where it was grabbed: the card opens over the block itself.
  const { width, height } = preview.getBoundingClientRect();
  event.dataTransfer.setDragImage(
    preview,
    clamp(event.clientX - (box.left - PREVIEW_PAD_X), 0, width),
    clamp(event.clientY - (box.top - PREVIEW_PAD_Y), 0, height),
  );
  setTimeout(() => preview.remove(), 0);
}

/**
 * Moving a block by dragging its handle.
 *
 * While a block is carried it stays in place, stepped back, and a single
 * line laid over the page (never in the flow, so the text does not shift
 * under the pointer) glides to wherever it would land. Near the top or
 * bottom of the page the canvas scrolls, as the marquee does. Slots
 * directly above or below the block itself would change nothing, so none
 * is shown there.
 *
 * The drop hands the landed block's id to `landedRef` before reordering, so
 * `ReorderMotion` can settle it into place instead of sliding it.
 */
export function useBlockDrag({
  containerRef,
  blocks,
  reorderBlock,
}: {
  containerRef: RefObject<HTMLElement | null>;
  blocks: Block[];
  reorderBlock: (id: string, toIndex: number) => void;
}) {
  const lineRef = useRef<HTMLDivElement | null>(null);
  const landedRef = useRef<string | null>(null);
  const session = useRef<Session | null>(null);

  const hideLine = () => {
    if (lineRef.current) lineRef.current.hidden = true;
  };

  const stopScrolling = (s: Session) => {
    if (s.scrollFrame) cancelAnimationFrame(s.scrollFrame);
    s.scrollFrame = 0;
  };

  const end = () => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    stopScrolling(s);
    s.row.removeAttribute('data-dragging');
    hideLine();
  };

  const place = (y: number) => {
    const s = session.current;
    const line = lineRef.current;
    const rows = blockRows(containerRef.current);
    if (!s || !line?.parentElement || rows.length === 0) return;

    let index = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    s.index = index;

    const from = rows.indexOf(s.row);
    if (index === from || index === from + 1) {
      hideLine();
      return;
    }
    // In the 2px between two rows: just above the row it would precede, or
    // just below the last one.
    const edge =
      index < rows.length
        ? rows[index].getBoundingClientRect().top - 1
        : rows[rows.length - 1].getBoundingClientRect().bottom + 1;
    line.style.translate = `0 ${edge - line.parentElement.getBoundingClientRect().top}px`;
    line.hidden = false;
  };

  const autoScroll = () => {
    const s = session.current;
    const scroller = containerRef.current;
    if (!s || !scroller) return;
    s.scrollFrame = 0;
    const delta = edgeScrollDelta(scroller.getBoundingClientRect(), s.y);
    if (delta === 0) return;
    const before = scroller.scrollTop;
    scroller.scrollTop += delta;
    // The page moved under a still pointer: the slot under it changed.
    if (scroller.scrollTop !== before) place(s.y);
    s.scrollFrame = requestAnimationFrame(autoScroll);
  };

  useEffect(
    () => () => {
      const s = session.current;
      if (s?.scrollFrame) cancelAnimationFrame(s.scrollFrame);
      session.current = null;
    },
    [],
  );

  const onDragStart = (event: DragEvent) => {
    if (!isBlockDrag(event)) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>(BLOCK_ROW);
    const id = row?.dataset.blockId;
    if (!row || !id) return;
    end();
    session.current = { id, row, index: null, y: event.clientY, scrollFrame: 0 };
    setDragPreview(row, event);
    // A frame later, so nothing about the source changes while the browser
    // is still starting the drag.
    requestAnimationFrame(() => {
      if (session.current?.row === row) row.setAttribute('data-dragging', '');
    });
  };

  const onDragOverCapture = (event: DragEvent) => {
    const s = session.current;
    if (!s || !isBlockDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    s.y = event.clientY;
    place(event.clientY);
    const scroller = containerRef.current;
    if (scroller && !s.scrollFrame && edgeScrollDelta(scroller.getBoundingClientRect(), s.y) !== 0) {
      s.scrollFrame = requestAnimationFrame(autoScroll);
    }
  };

  const onDragLeave = (event: DragEvent) => {
    // Only when the pointer actually leaves the canvas, not when it crosses
    // between child rows.
    const s = session.current;
    if (!s || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    s.index = null;
    stopScrolling(s);
    hideLine();
  };

  const onDropCapture = (event: DragEvent) => {
    // Only block drags are intercepted here: swallowing any other payload
    // kills native drag-to-move for selected text. A block drag is always
    // swallowed, so its id never lands in a text field as text.
    if (!isBlockDrag(event)) return;
    event.preventDefault();
    const s = session.current;
    end();
    if (!s || s.index === null) return;
    const from = blocks.findIndex((block) => block.id === s.id);
    if (from === -1) return;
    // Removing the dragged block first shifts every later slot up by one.
    const to = from < s.index ? s.index - 1 : s.index;
    if (from === to) return;
    landedRef.current = s.id;
    reorderBlock(s.id, to);
  };

  return {
    lineRef,
    landedRef,
    handlers: { onDragStart, onDragOverCapture, onDragLeave, onDropCapture, onDragEnd: end },
  };
}
