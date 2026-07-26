import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query.
 * Used to give the shell a real mobile layout instead of hiding the
 * sidebar and tool panels behind `hidden md:flex`, which left every
 * navigation surface unreachable on small screens.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `md` breakpoint: below this the shell switches to overlay panels. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)');
}
