import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import type { Block } from '@/editor';
import { BLOCK_DRAG_TYPE, useBlockDrag } from '../useBlockDrag';
import { ReorderMotion } from '../ReorderMotion';
import { blockRows } from '../canvasDom';

/**
 * Moving a block by its handle, end to end: `useBlockDrag` drives the drag
 * and `ReorderMotion` animates the reorder it commits. jsdom has no layout,
 * so geometry comes from document order: row i sits at 100 + 40i, 30px tall,
 * in a canvas whose viewport runs from 0 to 600.
 */

const ROW_TOP = 100;
const ROW_STEP = 40;
const ROW_HEIGHT = 30;
const CANVAS_BOTTOM = 600;

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 700, width: 700, x: 0, y: top, toJSON: () => ({}) };
}

function geometry(this: HTMLElement): DOMRect {
  const row = this.closest<HTMLElement>('.block-row');
  const index = row ? blockRows(document).indexOf(row) : -1;
  if (index !== -1) return rect(ROW_TOP + index * ROW_STEP, ROW_HEIGHT);
  if (this.classList.contains('blocks-container')) return rect(ROW_TOP, 400);
  if (this.classList.contains('canvas')) return rect(0, CANVAS_BOTTOM);
  return rect(0, 0);
}

/** The canvas's part in a drag: rows with handles, the drop line and the motion. */
function Page({ initial, onReorder }: { initial: string[]; onReorder?: (id: string, to: number) => void }) {
  const [ids, setIds] = useState(initial);
  const blocks = ids.map((id) => ({ id, type: 'paragraph', html: id, children: [], columns: 1 }) as Block);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reorderBlock = (id: string, to: number) => {
    onReorder?.(id, to);
    setIds((prev) => {
      const out = prev.filter((other) => other !== id);
      out.splice(to, 0, id);
      return out;
    });
  };
  const { lineRef, landedRef, handlers } = useBlockDrag({ containerRef, blocks, reorderBlock });
  return (
    <div>
      <div className="canvas" data-testid="canvas" ref={containerRef} {...handlers}>
        <div className="document-container">
          <div className="blocks-container">
            {ids.map((id) => (
              <div key={id} className="block-row" data-block-id={id} data-active="">
                <div className="block-controls">
                  <button type="button" draggable data-testid={`handle-${id}`} />
                </div>
                <div className="block-content">
                  <div contentEditable suppressContentEditableWarning>
                    text {id}
                  </div>
                </div>
              </div>
            ))}
            <div ref={lineRef} data-testid="line" className="block-drop-line" hidden />
            <ReorderMotion order={ids.join('\n')} containerRef={containerRef} landedRef={landedRef} />
          </div>
        </div>
      </div>
      <div data-testid="outside" />
    </div>
  );
}

let frames: FrameRequestCallback[] = [];
/** Runs the animation frames requested so far (not the ones they request). */
function flushFrame() {
  const due = frames;
  frames = [];
  act(() => due.forEach((callback) => callback(performance.now())));
}

let animate: ReturnType<typeof vi.fn>;
let setDragImage: ReturnType<typeof vi.fn>;

function transfer(types = ['text/plain', BLOCK_DRAG_TYPE]) {
  return { types, dropEffect: 'none', effectAllowed: 'move', setDragImage, setData: vi.fn(), getData: () => '' };
}

/** A drag event at viewport height `y`. jsdom has no DragEvent to carry clientY. */
function drag(type: 'dragOver' | 'drop' | 'dragStart', target: HTMLElement, y: number, types?: string[]) {
  const event = createEvent[type](target, { dataTransfer: transfer(types) });
  Object.defineProperty(event, 'clientY', { value: y });
  Object.defineProperty(event, 'clientX', { value: 300 });
  return fireEvent(target, event);
}

/** Viewport height `fraction` of the way down row `index`. */
const within = (index: number, fraction: number) => ROW_TOP + index * ROW_STEP + ROW_HEIGHT * fraction;

const order = () => blockRows(document).map((row) => row.dataset.blockId);
const row = (id: string) => document.querySelector<HTMLElement>(`[data-block-id="${id}"]`)!;
const line = () => screen.getByTestId('line');

function startDragging(id: string) {
  drag('dragStart', screen.getByTestId(`handle-${id}`), within(order().indexOf(id), 0.5));
  flushFrame();
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    frames[handle - 1] = () => {};
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(geometry);
  animate = vi.fn();
  Element.prototype.animate = animate as unknown as Element['animate'];
  setDragImage = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (Element.prototype as Partial<Element>).animate;
});

describe('dragging a block by its handle', () => {
  it('carries a picture of the block rather than of the handle', async () => {
    render(<Page initial={['a', 'b', 'c']} />);
    drag('dragStart', screen.getByTestId('handle-b'), within(1, 0.5));

    expect(setDragImage).toHaveBeenCalledTimes(1);
    const [preview] = setDragImage.mock.calls[0] as [HTMLElement];
    expect(preview.classList.contains('block-drag-preview')).toBe(true);
    expect(preview.textContent).toContain('text b');
    // A copy to look at, which nothing can focus, edit or find as the block.
    expect(preview.querySelector('.block-controls, [contenteditable], [data-block-id], [data-active]')).toBeNull();

    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.querySelector('.block-drag-preview')).toBeNull();
  });

  it('steps the carried block back once the drag is under way', () => {
    render(<Page initial={['a', 'b', 'c']} />);
    drag('dragStart', screen.getByTestId('handle-b'), within(1, 0.5));
    expect(row('b').hasAttribute('data-dragging')).toBe(false);

    flushFrame();
    expect(row('b').hasAttribute('data-dragging')).toBe(true);
  });

  it('shows one line where the block would land, laid over the page', () => {
    render(<Page initial={['a', 'b', 'c', 'd']} />);
    startDragging('b');
    const canvas = screen.getByTestId('canvas');

    expect(drag('dragOver', canvas, within(0, 0.25))).toBe(false);
    expect(line().hidden).toBe(false);
    // In the gap just above row a, measured from the rows' container.
    expect(line().style.translate).toBe('0 -1px');

    drag('dragOver', canvas, within(2, 0.75));
    expect(line().style.translate).toBe(`0 ${3 * ROW_STEP - 1}px`);

    drag('dragOver', canvas, within(3, 0.75) + 100);
    expect(line().style.translate).toBe(`0 ${3 * ROW_STEP + ROW_HEIGHT + 1}px`);
    expect(document.querySelectorAll('.block-drop-line')).toHaveLength(1);
  });

  it('shows no line beside the block itself, where a drop would change nothing', () => {
    render(<Page initial={['a', 'b', 'c']} />);
    startDragging('b');
    const canvas = screen.getByTestId('canvas');

    for (const y of [within(1, 0.25), within(1, 0.75), within(2, 0.25)]) {
      drag('dragOver', canvas, y);
      expect(line().hidden).toBe(true);
    }
  });

  it('moves the block on drop and settles it in place while the rest slide', () => {
    const onReorder = vi.fn();
    render(<Page initial={['a', 'b', 'c', 'd']} onReorder={onReorder} />);
    startDragging('b');
    const canvas = screen.getByTestId('canvas');

    drag('dragOver', canvas, within(3, 0.75));
    drag('drop', canvas, within(3, 0.75));

    expect(onReorder).toHaveBeenCalledWith('b', 3);
    expect(order()).toEqual(['a', 'c', 'd', 'b']);
    expect(line().hidden).toBe(true);
    expect(row('b').hasAttribute('data-dragging')).toBe(false);

    // c and d each move up one slot, so they start one slot lower.
    const slid = animate.mock.calls
      .filter((_, i) => animate.mock.contexts[i] !== row('b'))
      .map(([keyframes]) => keyframes);
    expect(slid).toEqual([
      [{ transform: `translateY(${ROW_STEP}px)` }, { transform: 'none' }],
      [{ transform: `translateY(${ROW_STEP}px)` }, { transform: 'none' }],
    ]);
    // b does not fly in from where it was: it brightens where it landed.
    expect(row('b').hasAttribute('data-landed')).toBe(true);
    const landing = animate.mock.calls.find((_, i) => animate.mock.contexts[i] === row('b'));
    expect(landing?.[0]).toEqual([{ opacity: 0.35, offset: 0 }]);
  });

  it('changes nothing when dropped beside itself', () => {
    const onReorder = vi.fn();
    render(<Page initial={['a', 'b', 'c']} onReorder={onReorder} />);
    startDragging('b');
    const canvas = screen.getByTestId('canvas');

    drag('dragOver', canvas, within(1, 0.75));
    drag('drop', canvas, within(1, 0.75));

    expect(onReorder).not.toHaveBeenCalled();
    expect(row('b').hasAttribute('data-dragging')).toBe(false);
  });

  it('lets go of the slot when the pointer leaves the page', () => {
    const onReorder = vi.fn();
    render(<Page initial={['a', 'b', 'c']} onReorder={onReorder} />);
    startDragging('a');
    const canvas = screen.getByTestId('canvas');

    drag('dragOver', canvas, within(2, 0.75));
    expect(line().hidden).toBe(false);
    fireEvent.dragLeave(canvas, { relatedTarget: screen.getByTestId('outside') });
    expect(line().hidden).toBe(true);

    drag('drop', canvas, within(2, 0.75));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('puts everything back when the drag is cancelled', () => {
    render(<Page initial={['a', 'b', 'c']} />);
    startDragging('a');
    drag('dragOver', screen.getByTestId('canvas'), within(2, 0.75));

    fireEvent.dragEnd(screen.getByTestId('handle-a'));

    expect(row('a').hasAttribute('data-dragging')).toBe(false);
    expect(line().hidden).toBe(true);
  });

  it('leaves drags that are not blocks to the browser', () => {
    render(<Page initial={['a', 'b']} />);
    startDragging('a');

    // Not prevented: selected text keeps its native drag-to-move.
    expect(drag('dragOver', screen.getByTestId('canvas'), within(1, 0.75), ['text/plain'])).toBe(true);
    expect(line().hidden).toBe(true);
  });

  it('swallows a block drop it did not start, so the id never lands as text', () => {
    const onReorder = vi.fn();
    render(<Page initial={['a', 'b']} onReorder={onReorder} />);

    expect(drag('drop', screen.getByTestId('canvas'), within(1, 0.75))).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('scrolls the page near its edge and stops when the drag ends', () => {
    render(<Page initial={['a', 'b']} />);
    const canvas = screen.getByTestId('canvas');
    let scrollTop = 0;
    Object.defineProperty(canvas, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, value);
      },
    });
    startDragging('a');

    drag('dragOver', canvas, CANVAS_BOTTOM - 8);
    flushFrame();
    flushFrame();
    expect(scrollTop).toBe(20);

    fireEvent.dragEnd(screen.getByTestId('handle-a'));
    flushFrame();
    expect(scrollTop).toBe(20);
  });
});

describe('ReorderMotion', () => {
  function List({ ids }: { ids: string[] }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const landedRef = useRef<string | null>(null);
    return (
      <div ref={containerRef}>
        <div className="blocks-container">
          {ids.map((id) => (
            <div key={id} className="block-row" data-block-id={id} />
          ))}
          <ReorderMotion order={ids.join('\n')} containerRef={containerRef} landedRef={landedRef} />
        </div>
      </div>
    );
  }

  it('slides the rows of any reorder, such as a keyboard move', () => {
    const { rerender } = render(<List ids={['a', 'b', 'c']} />);
    rerender(<List ids={['b', 'a', 'c']} />);

    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.contexts).toEqual([row('b'), row('a')]);
    expect(animate.mock.calls.map(([keyframes]) => keyframes[0])).toEqual([
      { transform: `translateY(${ROW_STEP}px)` },
      { transform: `translateY(${-ROW_STEP}px)` },
    ]);
    expect(row('a').hasAttribute('data-landed')).toBe(false);
  });

  it('leaves inserts and deletes to the page', () => {
    const { rerender } = render(<List ids={['a', 'b', 'c']} />);
    rerender(<List ids={['x', 'a', 'b', 'c']} />);
    rerender(<List ids={['a', 'c']} />);

    expect(animate).not.toHaveBeenCalled();
  });

  it('does not slide anything when the OS asks for reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const { rerender } = render(<List ids={['a', 'b', 'c']} />);
    rerender(<List ids={['c', 'b', 'a']} />);

    expect(animate).not.toHaveBeenCalled();
  });
});
