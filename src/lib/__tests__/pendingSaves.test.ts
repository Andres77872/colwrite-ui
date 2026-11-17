import { afterEach, describe, expect, it, vi } from 'vitest';
import { endPendingSaves, flushPendingSaves, registerPendingSave } from '../pendingSaves';

const unregister: Array<() => void> = [];

afterEach(() => {
  while (unregister.length) unregister.pop()?.();
  vi.useRealTimers();
});

describe('pending saves', () => {
  it('flushes every registered save, and a failing one does not stop the others', async () => {
    const failing = vi.fn(async () => {
      throw new Error('network down');
    });
    const working = vi.fn(async () => {});
    unregister.push(registerPendingSave({ flush: failing, end: vi.fn() }));
    unregister.push(registerPendingSave({ flush: working, end: vi.fn() }));

    await expect(flushPendingSaves()).resolves.toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(working).toHaveBeenCalledTimes(1);
  });

  it('stops waiting for a server that does not answer', async () => {
    vi.useFakeTimers();
    unregister.push(registerPendingSave({ flush: () => new Promise(() => {}), end: vi.fn() }));

    let settled = false;
    const flushing = flushPendingSaves(5000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flushing;
    expect(settled).toBe(true);
  });

  it('ends every registered save, and forgets one that unregistered', () => {
    const kept = vi.fn();
    const gone = vi.fn();
    unregister.push(registerPendingSave({ flush: async () => {}, end: kept }));
    registerPendingSave({ flush: async () => {}, end: gone })();

    endPendingSaves();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(gone).not.toHaveBeenCalled();
  });
});
