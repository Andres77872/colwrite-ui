import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

type ThemeModule = typeof import('../theme');

/** A controllable `prefers-color-scheme: dark` media query. */
function stubSystemScheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query === '(prefers-color-scheme: dark)' ? dark : false;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    setDark(next: boolean) {
      dark = next;
      listeners.forEach((listener) => listener());
    },
  };
}

/** Fresh module state per test: the preference lives at module scope. */
async function loadTheme(): Promise<ThemeModule> {
  vi.resetModules();
  return import('../theme');
}

function themeColors(): string[] {
  return Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(
    (meta) => meta.getAttribute('content') ?? '',
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
  // index.html ships one theme-color per OS scheme.
  document.head.innerHTML =
    '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">' +
    '<meta name="theme-color" content="#191919" media="(prefers-color-scheme: dark)">';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('theme', () => {
  it('follows the system by default', async () => {
    stubSystemScheme(true);
    const theme = await loadTheme();
    theme.initTheme();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(themeColors()).toEqual(['#191919', '#191919']);
  });

  it('resolves to light when the system has no dark preference', async () => {
    stubSystemScheme(false);
    const theme = await loadTheme();
    theme.initTheme();

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(themeColors()).toEqual(['#ffffff', '#ffffff']);
  });

  it('applies a stored preference over the system', async () => {
    stubSystemScheme(true);
    localStorage.setItem('colwrite:theme', 'light');
    const theme = await loadTheme();
    theme.initTheme();

    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('ignores an unknown stored value', async () => {
    stubSystemScheme(true);
    localStorage.setItem('colwrite:theme', 'sepia');
    const theme = await loadTheme();
    theme.initTheme();

    const { result } = renderHook(() => theme.useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.resolved).toBe('dark');
  });

  it('persists and applies a new preference, and re-renders subscribers', async () => {
    stubSystemScheme(false);
    const theme = await loadTheme();
    theme.initTheme();
    const { result } = renderHook(() => theme.useTheme());
    expect(result.current.resolved).toBe('light');

    act(() => result.current.setPreference('dark'));

    expect(localStorage.getItem('colwrite:theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(result.current).toMatchObject({ preference: 'dark', resolved: 'dark' });
  });

  it('tracks OS changes only while the preference is "system"', async () => {
    const system = stubSystemScheme(false);
    const theme = await loadTheme();
    theme.initTheme();
    const { result } = renderHook(() => theme.useTheme());

    act(() => system.setDark(true));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(result.current.resolved).toBe('dark');

    act(() => theme.setThemePreference('light'));
    act(() => system.setDark(false));
    act(() => system.setDark(true));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('still applies a choice when storage is unavailable', async () => {
    stubSystemScheme(false);
    const theme = await loadTheme();
    theme.initTheme();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => theme.setThemePreference('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
    setItem.mockRestore();
  });

  it('pins a theme while a forcing component is mounted, then restores it', async () => {
    stubSystemScheme(false);
    const theme = await loadTheme();
    theme.initTheme();

    const forced = renderHook(() => theme.useForcedTheme('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    // The stored preference is the author's and is left alone.
    expect(localStorage.getItem('colwrite:theme')).toBeNull();

    forced.unmount();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
