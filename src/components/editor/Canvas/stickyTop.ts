/** The custom property globals.css reads into the canvas's scroll padding. */
export const STICKY_TOP_PROPERTY = '--canvas-sticky-top';

/**
 * A ref callback for whatever is pinned to the top of the scrolling canvas
 * (the review notices). It keeps `--canvas-sticky-top` on the canvas equal
 * to that strip's height, and globals.css adds it to the canvas's
 * `scroll-padding-top`. Focus moved by the keyboard, and every
 * `scrollIntoView`, then stops below the strip instead of under it
 * (WCAG 2.2 SC 2.4.11).
 *
 * The page topbar is not part of this: it sits above the canvas, outside the
 * element that scrolls, so it can never cover the page.
 */
export function observeStickyTop(strip: HTMLElement | null): (() => void) | void {
  const scroller = strip?.closest<HTMLElement>('.canvas');
  if (!strip || !scroller) return;
  const apply = () => scroller.style.setProperty(STICKY_TOP_PROPERTY, `${strip.offsetHeight}px`);
  apply();
  if (typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(apply);
  observer.observe(strip);
  return () => {
    observer.disconnect();
    scroller.style.removeProperty(STICKY_TOP_PROPERTY);
  };
}
