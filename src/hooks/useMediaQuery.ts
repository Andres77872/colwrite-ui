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

/** Tailwind's `md` breakpoint: below this the shell switches to overlay panels. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)');
}
