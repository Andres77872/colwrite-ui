import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useState backed by localStorage.
 *
 * Panel widths, collapse state and the assistant's open/closed state were
 * each doing their own try/catch dance around localStorage (or, more often,
 * silently resetting on every reload).
 */
export function usePersistentState<T>(
  key: string,
  initialValue: T,
  /** Guards against malformed or stale persisted values. */
  validate?: (value: unknown) => value is T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return initialValue;
      const parsed = JSON.parse(raw) as unknown;
      if (validate && !validate(parsed)) return initialValue;
      return parsed as T;
    } catch {
      return initialValue;
    }
  });

  // Writes are cheap but frequent during a drag; coalesce to one per frame.
  const frame = useRef<number | null>(null);
  useEffect(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(state));
      } catch {
        /* storage full or blocked — the in-memory value still works */
      }
    });
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [key, state]);

  const set = useCallback((value: T | ((prev: T) => T)) => setState(value), []);

  return [state, set];
}

export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
