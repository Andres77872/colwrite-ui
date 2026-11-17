import { useState } from 'react';

/**
 * `items`, or the array held from an earlier render while it holds the same
 * items in the same order (compared by identity). For a list derived afresh
 * on every render whose items rarely change, so what it is passed to
 * (a memoised component, a memo's dependency) changes only when they do.
 */
export function useStableItems<T>(items: readonly T[]): readonly T[] {
  const [held, setHeld] = useState(items);
  const same = held.length === items.length && held.every((item, index) => item === items[index]);
  // Information from the previous render, kept the way React documents it.
  if (!same) setHeld(items);
  return same ? held : items;
}
