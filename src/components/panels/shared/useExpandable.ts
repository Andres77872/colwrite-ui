import { useCallback, useState } from 'react';

/**
 * Tracks which result cards have their abstract expanded.
 * Both research panels had a byte-identical copy of this Set juggling.
 */
export function useExpandable() {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const reset = useCallback(() => setExpanded(new Set()), []);

  const isExpanded = useCallback((key: string) => expanded.has(key), [expanded]);

  return { isExpanded, toggle, reset };
}
