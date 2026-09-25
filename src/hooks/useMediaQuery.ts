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
 * Width from which the right sidebar docks beside the page instead of
 * opening as a modal sheet over it (spec: desktop is 1024px and up).
 *
 * Between 1024px and roughly 1220px there is no room for both sidebars and a
 * readable page; the shell then hides the left sidebar while the right one
 * is open (`useLeftSidebarAutoHidden`) rather than covering the page.
 */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}
