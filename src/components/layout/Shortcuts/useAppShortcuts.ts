import { useEffect } from 'react';
import { useEditor } from '@/editor';
import { usePanels } from '@/components/panels/panelsContextState';
import { matchShortcut, type ShortcutId } from './shortcuts';

/**
 * Whether a modal is currently on screen.
 *
 * Radix renders open dialogs, sheets and the confirm prompt with
 * `role="dialog"` and `data-state="open"`. Toggling a panel behind a modal
 * rearranges a layout the user cannot see or reach, and Escape is already the
 * way out of one — so the shortcuts stand down while anything is open. Save is
 * exempt: it is never the wrong thing to do.
 */
function modalIsOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"]') !== null;
}

/**
 * The app-level keyboard shortcuts.
 *
 * Installed once, on `window`, in the bubble phase — deliberately not capture.
 * The editor's own handlers (the slash menu, the reference picker, Ctrl+Enter
 * in a block) run on `document` in capture and get first refusal; nothing here
 * should ever preempt them.
 */
export function useAppShortcuts({ onShowHelp }: { onShowHelp: () => void }) {
  const { toggle, toggleLeftCollapsed, toggleAssistant } = usePanels();
  const { save } = useEditor();

  useEffect(() => {
    const run: Record<ShortcutId, () => void> = {
      'toggle-tools': toggle,
      'toggle-sidebar': toggleLeftCollapsed,
      'toggle-assistant': toggleAssistant,
      save,
      help: onShowHelp,
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const shortcut = matchShortcut(event);
      if (!shortcut) return;
      if (shortcut.id !== 'save' && modalIsOpen()) return;
      // Claim the key before the browser does — Mod+S in particular would
      // otherwise open the "save page as" dialog over the app.
      event.preventDefault();
      run[shortcut.id]();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onShowHelp, save, toggle, toggleAssistant, toggleLeftCollapsed]);
}
