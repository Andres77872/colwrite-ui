import { useCallback, useEffect, useRef, useState } from 'react';
import { readJson, writeJson } from '@/lib/storageKeys';

/**
 * useState backed by a storage key from `src/lib/storageKeys.ts`. The key is
 * read once, on mount.
 */
export function usePersistentState<T>(
  key: string,
  initialValue: T,
  /** Guards against malformed or stale persisted values. */
  validate?: (value: unknown) => value is T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;
    const parsed = readJson(key);
    if (parsed === undefined || (validate && !validate(parsed))) return initialValue;
    return parsed as T;
  });

  // Writes are cheap but frequent during a drag; coalesce to one per frame.
  const frame = useRef<number | null>(null);
  useEffect(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      // Storage full or blocked: the in-memory value still works.
      writeJson(key, state);
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
