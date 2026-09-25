import { useEffect } from 'react';
import { useEditorActions } from '@/editor';
import { usePanels } from '@/components/panels/panelsContextState';
import { useSidebarToggle } from '../useShellLayout';
import { matchShortcut, type ShortcutId } from './shortcuts';
import { focusIsInAside, returnFocusFromAside } from './asideFocus';

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
  return document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null;
}

/**
 * Whether the key belongs to a text field other than the document.
 *
 * Undo in the title field, the chat composer or a search box is that field's
 * own undo. The document journal used to take Mod+Z from every one of them —
 * rewinding the paper while the author was correcting a search.
 */
function inForeignTextField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element?.closest) return false;
  if (element.closest('input, textarea, select')) return true;
  const editable = element.closest('[contenteditable="true"], [contenteditable="plaintext-only"]');
  return Boolean(editable && !editable.closest('.canvas'));
}

/** A text selection inside a document block: Mod+K there edits the link. */
function textSelectedInDocument(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const node = selection.anchorNode;
  const element = node && (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement);
  return Boolean(element?.closest('.editable'));
}

/**
 * The app-level keyboard shortcuts.
 *
 * Installed once, on `window`, in the bubble phase — deliberately not capture.
 * The editor's own handlers (the slash menu, the reference picker, Ctrl+Enter
 * in a block) run on `document` in capture and get first refusal; nothing here
 * should ever preempt them.
 */
export function useAppShortcuts({
  onShowHelp,
  onOpenPalette,
}: {
  onShowHelp: () => void;
  onOpenPalette?: () => void;
}) {
  const { toggle, toggleAssistant, activeTool } = usePanels();
  const sidebar = useSidebarToggle();
  const toggleSidebar = sidebar.toggle;
  const { save, undo, redo } = useEditorActions();

  useEffect(() => {
    const run: Record<ShortcutId, () => void> = {
      'toggle-tools': toggle,
      // A drawer has nothing to collapse; the chord slides it in instead.
      'toggle-sidebar': toggleSidebar,
      'toggle-assistant': toggleAssistant,
      'command-palette': () => onOpenPalette?.(),
      save,
      undo,
      redo,
      help: onShowHelp,
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const shortcut = matchShortcut(event);
      if (!shortcut) return;
      if ((shortcut.id === 'undo' || shortcut.id === 'redo') && inForeignTextField(event.target)) return;
      if (shortcut.id === 'command-palette') {
        if (!onOpenPalette) return;
        if (event.key.toLowerCase() === 'k' && textSelectedInDocument()) return;
      }
      if (shortcut.id !== 'save' && modalIsOpen()) return;
      // Claim the key before the browser does — Mod+S in particular would
      // otherwise open the "save page as" dialog over the app. Mod+Z must not
      // reach the contenteditable either: the native undo stack only knows
      // the focused block's DOM and would diverge from document state.
      event.preventDefault();
      // Closing the docked sidebar from inside it would drop focus to <body>.
      const leavingAside =
        (shortcut.id === 'toggle-tools' || shortcut.id === 'toggle-assistant') && focusIsInAside();
      run[shortcut.id]();
      if (leavingAside) returnFocusFromAside(activeTool);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeTool,
    onShowHelp,
    onOpenPalette,
    save,
    undo,
    redo,
    toggle,
    toggleAssistant,
    toggleSidebar,
  ]);
}
