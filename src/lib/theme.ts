import { useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * Light / dark appearance.
 *
 * The preference is what the author chose — follow the system, or force one
 * appearance. The resolved theme is what is on screen, written to
 * `<html data-theme>` so every token in globals.css switches with one
 * attribute. `index.html` runs the same resolution inline before the first
 * paint, so a dark-mode reader never sees a white flash while the app loads.
 *
 * A surface with its own art direction (the landing page) can pin a theme
 * while it is mounted with `useForcedTheme`. That has to happen on <html>,
 * not only on the surface's wrapper: its dialogs and tooltips portal into
 * <body> and would otherwise escape into the author's theme.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'colwrite:theme';

/** The browser chrome colour for each theme — the page background. */
const THEME_COLOR: Record<ResolvedTheme, string> = { light: '#ffffff', dark: '#191919' };

const DARK_QUERY = '(prefers-color-scheme: dark)';

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY)?.matches ? 'dark' : 'light';
}

let preference: ThemePreference = typeof window === 'undefined' ? 'system' : readPreference();
let forced: ResolvedTheme | null = null;

export function resolveTheme(value: ThemePreference = preference): ResolvedTheme {
  if (forced) return forced;
  return value === 'system' ? systemTheme() : value;
}

let snapshot: { preference: ThemePreference; resolved: ResolvedTheme } = {
  preference,
  resolved: typeof window === 'undefined' ? 'light' : resolveTheme(),
};

function apply(): void {
  const resolved = resolveTheme();
  if (snapshot.preference !== preference || snapshot.resolved !== resolved) {
    snapshot = { preference, resolved };
  }
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
    // Native controls (a <select>'s popup, scrollbars, autofill) follow
    // `color-scheme`, not the tokens.
    root.style.colorScheme = resolved;
    // index.html ships one theme-color per OS scheme; a forced choice has to
    // win over the media query on both.
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute('content', THEME_COLOR[resolved]));
  }
  listeners.forEach((listener) => listener());
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* the choice still applies to this tab */
  }
  apply();
}

let watching = false;

function watchSystem(): void {
  if (watching || typeof window === 'undefined' || !window.matchMedia) return;
  watching = true;
  window.matchMedia(DARK_QUERY)?.addEventListener?.('change', () => {
    if (preference === 'system') apply();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Apply the stored preference now and follow the OS — called once at startup. */
export function initTheme(): void {
  preference = readPreference();
  watchSystem();
  apply();
}

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
} {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  return { ...current, setPreference: setThemePreference };
}

/**
 * Pin the resolved theme while the calling component is mounted, without
 * touching the author's stored preference. A layout effect, so the switch
 * lands before the first paint of that surface.
 */
export function useForcedTheme(theme: ResolvedTheme): void {
  useLayoutEffect(() => {
    forced = theme;
    apply();
    return () => {
      forced = null;
      apply();
    };
  }, [theme]);
}
