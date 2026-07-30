import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Key = string | number;

/**
 * A list whose first page comes from a parent fetch and whose later pages come
 * from its own.
 *
 * This exists because of what the profile dashboard used to do instead: remount
 * both list sections with `key={generation}` on every Refresh. That did fix the
 * real bug — the sections seed paging state from props, and React keeps state
 * across a prop change, so the tiles updated while the lists showed the old
 * fetch — but it threw away every page the user had loaded. Clicking "Show
 * more" three times and then Refresh dropped them back to twenty rows.
 *
 * The reconciliation: `first` is authoritative, later pages are kept across a
 * refresh, and the local overlay (optimistic inserts, deletes, and polled
 * updates) is dropped the moment `first` changes — by then the server has
 * spoken and the overlay can only be staler.
 *
 * Deduplication by key is not incidental: pages are requested by offset, and an
 * optimistic insert shifts the offsets under the next request, so the same row
 * can legitimately arrive twice.
 */
export function usePagedList<T>({
  first,
  keyOf,
}: {
  first: T[];
  keyOf: (item: T) => Key;
}) {
  const [appended, setAppended] = useState<T[]>([]);
  const [prepended, setPrepended] = useState<T[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<Key>>(() => new Set());
  const [updated, setUpdated] = useState<ReadonlyMap<Key, T>>(() => new Map());

  // Identity, not contents: the parent hands down a fresh array per fetch.
  const previousFirstRef = useRef(first);
  useEffect(() => {
    if (previousFirstRef.current === first) return;
    previousFirstRef.current = first;
    setPrepended([]);
    setRemoved(new Set());
    setUpdated(new Map());
  }, [first]);

  const items = useMemo(() => {
    const seen = new Set<Key>();
    const out: T[] = [];
    for (const item of [...prepended, ...first, ...appended]) {
      const key = keyOf(item);
      if (removed.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(updated.get(key) ?? item);
    }
    return out;
  }, [appended, first, keyOf, prepended, removed, updated]);

  /**
   * The offset to request next.
   *
   * Counted from rows that came from the paged endpoint, never from what is on
   * screen: paging by `items.length` after prepending a fresh upload asked the
   * server to skip a row it had not sent yet, which silently dropped one.
   */
  const serverOffset = first.length + appended.length;

  const appendPage = useCallback((page: T[]) => {
    setAppended((previous) => [...previous, ...page]);
  }, []);

  const prepend = useCallback((rows: T[]) => {
    setPrepended((previous) => [...rows, ...previous]);
  }, []);

  const remove = useCallback((key: Key) => {
    setRemoved((previous) => new Set(previous).add(key));
    setPrepended((previous) => previous.filter((item) => keyOf(item) !== key));
    setAppended((previous) => previous.filter((item) => keyOf(item) !== key));
  }, [keyOf]);

  const update = useCallback(
    (rows: T[]) => {
      setUpdated((previous) => {
        const next = new Map(previous);
        for (const row of rows) next.set(keyOf(row), row);
        return next;
      });
    },
    [keyOf],
  );

  return { items, serverOffset, appendPage, prepend, remove, update };
}
