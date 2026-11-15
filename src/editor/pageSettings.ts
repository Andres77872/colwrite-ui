import { useSyncExternalStore } from 'react';
import { PAGE_SETTINGS_KEY, readJson, writeJson } from '@/lib/storageKeys';

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

const DEFAULTS: PageSettings = { fullWidth: false, smallText: false };

const listeners = new Set<() => void>();

function read(): PageSettings {
  const parsed = readJson(PAGE_SETTINGS_KEY) as Partial<PageSettings> | null | undefined;
  if (!parsed || typeof parsed !== 'object') return DEFAULTS;
  return {
    fullWidth: parsed.fullWidth === true,
    smallText: parsed.smallText === true,
  };
}

let settings: PageSettings = typeof window === 'undefined' ? DEFAULTS : read();

export function setPageSettings(update: Partial<PageSettings>): void {
  settings = { ...settings, ...update };
  // A refused write applies to this tab only.
  writeJson(PAGE_SETTINGS_KEY, settings);
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
