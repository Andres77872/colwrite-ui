import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStableItems } from '../useStableItems';

describe('useStableItems', () => {
  it('keeps the array it holds while the items are the same objects in the same order', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const hook = renderHook(({ items }) => useStableItems(items), { initialProps: { items: [a, b] } });
    const first = hook.result.current;
    hook.rerender({ items: [a, b] });
    expect(hook.result.current).toBe(first);
    // A copy of an item is another item; so is another order.
    const copied = [a, { ...b }];
    hook.rerender({ items: copied });
    expect(hook.result.current).toBe(copied);
    const reordered = [copied[1] as { id: string }, a];
    hook.rerender({ items: reordered });
    expect(hook.result.current).toBe(reordered);
    hook.rerender({ items: [...reordered] });
    expect(hook.result.current).toBe(reordered);
  });
});
