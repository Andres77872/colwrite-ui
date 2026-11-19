import { useEffect, useState, type RefObject } from 'react';

/**
 * How far outside the visible part of the scroller still counts as near: the
 * scroller's own height again, above and below.
 */
const MARGIN = '100% 0px';

type Watch = { observer: IntersectionObserver; waiting: Map<Element, () => void> };

/** One observer per scroller (`null` is the window), for everything waiting inside it. */
const watches = new Map<Element | null, Watch>();

function watchOf(root: Element | null): Watch {
  const existing = watches.get(root);
  if (existing) return existing;
  const waiting = new Map<Element, () => void>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const arrived = waiting.get(entry.target);
        forget(root, entry.target);
        arrived?.();
      }
    },
    { root, rootMargin: MARGIN },
  );
  const watch = { observer, waiting };
  watches.set(root, watch);
  return watch;
}

function forget(root: Element | null, el: Element): void {
  const watch = watches.get(root);
  if (!watch?.waiting.delete(el)) return;
  watch.observer.unobserve(el);
  if (watch.waiting.size > 0) return;
  watch.observer.disconnect();
  watches.delete(root);
}

/**
 * Whether `target` has come near the visible part of its scroller, the
 * closest ancestor matching `scroller` (the window without one). It answers
 * `false` until then and `true` from then on, also after the element is
 * scrolled away again.
 *
 * For what a long list mounts for every row and shows for few: a row's
 * closed menus and tooltips can wait until the row is about to be seen. The
 * element must be rendered together with the component that asks.
 *
 * Where the browser cannot observe intersections the answer is `true` from
 * the first render, so nothing waits for a notice that never comes.
 */
export function useNearViewport(target: RefObject<Element | null>, scroller?: string): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = target.current;
    if (near || !el) return;
    const root = scroller ? el.closest(scroller) : null;
    const watch = watchOf(root);
    watch.waiting.set(el, () => setNear(true));
    watch.observer.observe(el);
    return () => forget(root, el);
  }, [near, scroller, target]);
  return near;
}
