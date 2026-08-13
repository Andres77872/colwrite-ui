import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribes to a CSS media query.
 * Used to give the shell a real mobile layout instead of hiding the
 * sidebar and tool panels behind `hidden md:flex`, which left every
 * navigation surface unreachable on small screens.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const list = window.matchMedia(query);
    list.addEventListener('change', onStoreChange);
    return () => list.removeEventListener('change', onStoreChange);
  }, [query]);

  const getSnapshot = useCallback(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Width at which the complete four-column workspace can actually fit.
 *
 * The old 768px cutoff was a CSS breakpoint, not a layout constraint: the
 * sidebar, canvas, tools panel, and rail need roughly 1100px even at their
 * minimum useful widths. Treating a tablet as a desktop collapsed the canvas
 * to a sliver instead of moving the secondary surfaces into drawers.
 */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1100px)');
}
