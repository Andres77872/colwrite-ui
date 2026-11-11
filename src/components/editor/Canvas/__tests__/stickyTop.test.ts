import { afterEach, describe, expect, it, vi } from 'vitest';
import { STICKY_TOP_PROPERTY, observeStickyTop } from '../stickyTop';

/**
 * The scroll padding that keeps focus clear of the review notices pinned to
 * the top of the canvas (WCAG 2.2 SC 2.4.11). jsdom has no layout, so the
 * strip's height is set by hand.
 */

function mount(height: number) {
  const canvas = document.createElement('div');
  canvas.className = 'canvas';
  const strip = document.createElement('div');
  let current = height;
  Object.defineProperty(strip, 'offsetHeight', { configurable: true, get: () => current });
  canvas.append(strip);
  document.body.append(canvas);
  return { canvas, strip, resize: (next: number) => (current = next) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('observeStickyTop', () => {
  it('puts the pinned strip’s height on the canvas that scrolls', () => {
    const { canvas, strip } = mount(52);
    observeStickyTop(strip);
    expect(canvas.style.getPropertyValue(STICKY_TOP_PROPERTY)).toBe('52px');
  });

  it('follows the strip as notices come and go, and clears up after itself', () => {
    let notify: () => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const { canvas, strip, resize } = mount(0);

    const cleanup = observeStickyTop(strip);
    expect(canvas.style.getPropertyValue(STICKY_TOP_PROPERTY)).toBe('0px');

    resize(96);
    notify();
    expect(canvas.style.getPropertyValue(STICKY_TOP_PROPERTY)).toBe('96px');

    cleanup?.();
    expect(disconnect).toHaveBeenCalled();
    expect(canvas.style.getPropertyValue(STICKY_TOP_PROPERTY)).toBe('');
  });

  it('does nothing outside a canvas', () => {
    const strip = document.createElement('div');
    document.body.append(strip);
    expect(observeStickyTop(strip)).toBeUndefined();
    expect(observeStickyTop(null)).toBeUndefined();
  });
});
