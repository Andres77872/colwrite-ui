import { afterEach, describe, it, expect, vi } from 'vitest';
import { uid } from '../uid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when the page is a secure context', () => {
    expect(uid()).toMatch(V4);
  });

  it('still returns a v4 UUID over plain HTTP, where randomUUID is missing', () => {
    // An insecure context (http://<lan-ip>) keeps getRandomValues only.
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    const ids = new Set(Array.from({ length: 50 }, () => uid()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(V4);
  });
});
