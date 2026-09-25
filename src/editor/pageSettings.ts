import { useSyncExternalStore } from 'react';

/**
 * How the page is laid out on this device: Notion's "Full width" and
 * "Small text". Presentation only — never part of the document JSON, so they
 * change nothing another reader or the exporter sees.
 */
export type PageSettings = {
  /** Let the text column use the whole canvas instead of the reading measure. */
  fullWidth: boolean;
  /** 14px body text instead of 16px. */
  smallText: boolean;
};

export const PAGE_SETTINGS_STORAGE_KEY = 'colwrite:page-settings';
const DEFAULTS: PageSettings = { fullWidth: false, smallText: false };

const listeners = new Set<() => void>();

function read(): PageSettings {
  try {
    const raw = window.localStorage.getItem(PAGE_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PageSettings>;
    return {
      fullWidth: parsed.fullWidth === true,
      smallText: parsed.smallText === true,
    };
  } catch {
    return DEFAULTS;
  }
}

let settings: PageSettings = typeof window === 'undefined' ? DEFAULTS : read();

export function setPageSettings(update: Partial<PageSettings>): void {
  settings = { ...settings, ...update };
  try {
    window.localStorage.setItem(PAGE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* applies to this tab only */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePageSettings(): PageSettings & { set: (update: Partial<PageSettings>) => void } {
  const current = useSyncExternalStore(subscribe, () => settings, () => DEFAULTS);
  return { ...current, set: setPageSettings };
}
