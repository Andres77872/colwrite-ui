import { createContext, useContext, useEffect, type MutableRefObject } from 'react';

/**
 * Escape inside Settings, for a pane with something to lose.
 *
 * Radix closes the dialog on Escape before any field sees the key, so an
 * open profile edit was thrown away with the whole dialog. A pane in the
 * middle of an edit registers a handler here; the dialog then gives Escape
 * to it (cancel the edit) instead of closing.
 */
export type EscapeHandlerRef = MutableRefObject<(() => void) | null>;

export const SettingsEscapeContext = createContext<EscapeHandlerRef | null>(null);

export function useSettingsEscape(handler: (() => void) | null) {
  const ref = useContext(SettingsEscapeContext);
  useEffect(() => {
    if (!ref) return;
    ref.current = handler;
    return () => {
      if (ref.current === handler) ref.current = null;
    };
  }, [handler, ref]);
}
