/**
 * Motion preferences for script-driven animation.
 *
 * The global `prefers-reduced-motion` rule in globals.css only reaches CSS
 * `scroll-behavior`. A `behavior: 'smooth'` passed to `scrollIntoView` or
 * `scrollTo` still animates, so every scripted scroll asks here instead of
 * hard-coding 'smooth'.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** `'auto'` (jump) under Reduce motion, `'smooth'` otherwise. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
