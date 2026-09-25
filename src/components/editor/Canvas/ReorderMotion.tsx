import { PureComponent, type RefObject } from 'react';
import { blockRows, prefersReducedMotion } from './canvasDom';

interface Props {
  /** The block ids in document order, joined by newlines. A new value is a reorder. */
  order: string;
  /** The canvas: where the rows are found. */
  containerRef: RefObject<HTMLElement | null>;
  /** The block a drop just put down; it settles in place rather than sliding. */
  landedRef: RefObject<string | null>;
}

/** Each row's viewport top just before a reorder was committed, by block id. */
type Snapshot = Map<string, number> | null;

/** --transition-slow, on the decelerating curve things arriving use. */
const SLIDE = { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
const SETTLE = { duration: 240, easing: 'ease-out' };

/** The same ids in a different order, rather than blocks added or removed. */
function isPermutation(before: string, after: string): boolean {
  if (before === after || before.length !== after.length) return false;
  const a = before.split('\n').sort();
  const b = after.split('\n').sort();
  return a.every((id, i) => id === b[i]);
}

/**
 * The block a drop just put down: it brightens from the stepped-back look it
 * had while carried and takes a brief tint, so the eye finds where it went.
 */
function land(row: HTMLElement, motion: boolean) {
  // Restart the tint if the same block is dropped again before it fades.
  row.removeAttribute('data-landed');
  void row.offsetWidth;
  row.setAttribute('data-landed', '');
  const done = (event: AnimationEvent) => {
    if (event.target !== row || event.animationName !== 'block-landed') return;
    row.removeAttribute('data-landed');
    row.removeEventListener('animationend', done);
    row.removeEventListener('animationcancel', done);
  };
  row.addEventListener('animationend', done);
  row.addEventListener('animationcancel', done);
  // One keyframe at the start: it eases into the row's own opacity, which a
  // pending rewrite keeps below 1.
  if (motion) row.animate([{ opacity: 0.35, offset: 0 }], SETTLE);
}

/**
 * Animates block rows from where they were to where a reorder put them, so a
 * move reads as the blocks trading places rather than the page jumping. It
 * covers every path that reorders: a drop, Move up/down in the block menu,
 * ⌘⇧↑/↓, undo, and accepting a suggested move.
 *
 * Old positions must be read before React moves the DOM nodes, which only a
 * class component's `getSnapshotBeforeUpdate` is guaranteed to do. It renders
 * nothing, and as a PureComponent it updates only when the order changes.
 * Inserts and deletes are not animated: those rows shift because text was
 * added or removed, and making them glide would only slow typing down.
 */
export class ReorderMotion extends PureComponent<Props> {
  getSnapshotBeforeUpdate(prev: Props): Snapshot {
    if (!isPermutation(prev.order, this.props.order)) return null;
    const tops = new Map<string, number>();
    for (const row of blockRows(this.props.containerRef.current)) {
      if (row.dataset.blockId) tops.set(row.dataset.blockId, row.getBoundingClientRect().top);
    }
    return tops;
  }

  componentDidUpdate(_prev: Props, _state: unknown, before: Snapshot) {
    if (!before) return;
    const landed = this.props.landedRef.current;
    this.props.landedRef.current = null;
    // jsdom and very old engines have no Web Animations.
    const motion = !prefersReducedMotion() && typeof Element.prototype.animate === 'function';
    const viewport = window.innerHeight;

    for (const row of blockRows(this.props.containerRef.current)) {
      const id = row.dataset.blockId;
      if (!id) continue;
      if (id === landed) {
        land(row, motion);
        continue;
      }
      const was = before.get(id);
      if (!motion || was === undefined) continue;
      const rect = row.getBoundingClientRect();
      const dy = was - rect.top;
      if (Math.abs(dy) < 1) continue;
      // Rows that were and still are off screen have nothing to show.
      const offscreen = (top: number) => top + rect.height < 0 || top > viewport;
      if (offscreen(was) && offscreen(rect.top)) continue;
      // A block from far away enters from the edge of the screen rather than
      // crossing the whole page in the same 200ms.
      const from = Math.max(-viewport, Math.min(viewport, dy));
      row.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], SLIDE);
    }
  }

  render() {
    return null;
  }
}
