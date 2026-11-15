/**
 * `items[index]` where the code guarantees the index is in range: dense vertex
 * and edge ids, parallel arrays of one length, a length checked a line above.
 *
 * Under `noUncheckedIndexedAccess` every indexed read may be `undefined`. This
 * states the guarantee instead of asserting it away, and fails loudly with a
 * `RangeError` if it ever breaks, rather than letting an `undefined` turn into
 * a `NaN` coordinate three functions later.
 */
export function itemAt<T>(items: ArrayLike<T>, index: number): T {
  const value = items[index];
  if (value === undefined) throw new RangeError(`No item at index ${index} of ${items.length}.`);
  return value;
}

type Tuple<T, N extends number, Items extends T[] = []> = Items['length'] extends N ? Items : Tuple<T, N, [...Items, T]>;

/**
 * The first `count` items as a tuple to destructure, where the code guarantees
 * there are that many (`const [a, b] = takeItems(points, 2)`). Fails loudly,
 * like {@link itemAt}, when there are fewer.
 */
export function takeItems<T, N extends number>(items: readonly T[], count: N): Tuple<T, N> {
  if (items.length < count) throw new RangeError(`Expected ${count} items, found ${items.length}.`);
  for (let index = 0; index < count; index += 1) itemAt(items, index);
  return items.slice(0, count) as Tuple<T, N>;
}
