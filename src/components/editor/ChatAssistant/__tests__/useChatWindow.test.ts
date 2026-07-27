import { describe, expect, it } from 'vitest';
import {
  applyDrag,
  clampRect,
  CHAT_MARGIN,
  CHAT_MIN_HEIGHT,
  CHAT_MIN_WIDTH,
  type ChatRect,
} from '../useChatWindow';

/** A 1000×800 canvas with a 400×500 window in the bottom-right corner. */
const CANVAS = { width: 1000, height: 800 };
const RECT: ChatRect = { right: 16, bottom: 16, width: 400, height: 500 };

const drag = (rect: ChatRect, mode: Parameters<typeof applyDrag>[1], dx: number, dy: number) =>
  applyDrag(rect, mode, dx, dy, CANVAS.width, CANVAS.height);

describe('moving the window', () => {
  it('follows the pointer', () => {
    expect(drag(RECT, 'move', -100, -50)).toEqual({ ...RECT, right: 116, bottom: 66 });
  });

  it('stops at the canvas edge instead of leaving it', () => {
    const moved = drag(RECT, 'move', 500, 500);
    expect(moved.right).toBe(CHAT_MARGIN);
    expect(moved.bottom).toBe(CHAT_MARGIN);
    expect(moved.width).toBe(RECT.width);
  });

  it('keeps the far edges inside too', () => {
    const moved = drag(RECT, 'move', -5000, -5000);
    expect(CANVAS.width - moved.right - moved.width).toBe(CHAT_MARGIN);
    expect(CANVAS.height - moved.bottom - moved.height).toBe(CHAT_MARGIN);
  });

  it('does nothing when the canvas has not been measured', () => {
    expect(applyDrag(RECT, 'move', 40, 40, 0, 0)).toEqual(RECT);
  });
});

describe('resizing the window', () => {
  it('grows from the left edge without moving the right one', () => {
    const resized = drag(RECT, 'w', -80, 0);
    expect(resized.width).toBe(480);
    expect(resized.right).toBe(RECT.right);
  });

  it('grows from the top edge without moving the bottom one', () => {
    const resized = drag(RECT, 'n', 0, -60);
    expect(resized.height).toBe(560);
    expect(resized.bottom).toBe(RECT.bottom);
  });

  it('moves the anchored edges when dragged', () => {
    const resized = drag(RECT, 'se', 2, 2);
    expect(resized).toEqual({ right: 14, bottom: 14, width: 402, height: 502 });
  });

  it('stops the anchored edges at the canvas margin', () => {
    const resized = drag(RECT, 'se', 500, 500);
    expect(resized.right).toBe(CHAT_MARGIN);
    expect(resized.bottom).toBe(CHAT_MARGIN);
  });

  it('resizes both axes from a corner', () => {
    const resized = drag(RECT, 'nw', -40, -40);
    expect(resized).toEqual({ right: 16, bottom: 16, width: 440, height: 540 });
  });

  it('refuses to shrink past the minimum', () => {
    const resized = drag(RECT, 'w', 5000, 0);
    expect(resized.width).toBe(CHAT_MIN_WIDTH);
    expect(drag(RECT, 'n', 0, 5000).height).toBe(CHAT_MIN_HEIGHT);
  });

  it('refuses to grow past the canvas', () => {
    const resized = drag(RECT, 'w', -5000, 0);
    expect(CANVAS.width - resized.right - resized.width).toBe(CHAT_MARGIN);
  });
});

describe('a canvas that changed size under a stored window', () => {
  it('leaves a window that still fits alone', () => {
    expect(clampRect(RECT, CANVAS.width, CANVAS.height)).toEqual(RECT);
  });

  it('pulls a window that now hangs off the edge back in', () => {
    // What happens when the tools panel opens: the canvas loses width, and a
    // window remembered against the old one is left half outside it.
    const clamped = clampRect(RECT, 380, CANVAS.height);
    expect(clamped.width).toBeLessThanOrEqual(380 - CHAT_MARGIN * 2);
    expect(clamped.right).toBeGreaterThanOrEqual(CHAT_MARGIN);
    expect(380 - clamped.right - clamped.width).toBeGreaterThanOrEqual(0);
  });

  it('shrinks a window taller than the canvas', () => {
    const clamped = clampRect(RECT, CANVAS.width, 300);
    expect(clamped.height).toBe(300 - CHAT_MARGIN * 2);
    expect(clamped.bottom).toBe(CHAT_MARGIN);
  });

  it('leaves the window alone when the canvas has not been measured', () => {
    expect(clampRect(RECT, 0, 0)).toEqual(RECT);
  });
});
