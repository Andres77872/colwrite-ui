import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollBehavior } from '../motion';

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion: reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('scrollBehavior', () => {
  it('animates by default', () => {
    mockReducedMotion(false);
    expect(scrollBehavior()).toBe('smooth');
  });

  it('jumps when the reader asked for reduced motion', () => {
    mockReducedMotion(true);
    expect(scrollBehavior()).toBe('auto');
  });
});
