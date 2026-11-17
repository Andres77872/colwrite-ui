import { useEffect } from 'react';
import { useDocumentActions, useEditorActions } from '@/editor';
import { useNewPage } from '@/actions/useNewPage';
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
 *
 * The page title sits inside the canvas but is not a block: it commits when
 * it loses focus, so the journal knows nothing of what is being typed there.
 * Mod+Z in it used to revert the last edit to the body, possibly off screen,
 * and leave the typo in the title.
 */
export function inForeignTextField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element?.closest) return false;
  if (element.closest('input, textarea, select')) return true;
  if (element.closest('[data-page-title]')) return true;
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
  const { toggle, toggleAssistant, activePanel, setPanel } = usePanels();
  const sidebar = useSidebarToggle();
  const toggleSidebar = sidebar.toggle;
  const { save } = useDocumentActions();
  const { undo, redo } = useEditorActions();
  // The shared action: one creation in flight, whichever control started it.
  // Until collections exist, "new page here" is a new page.
  const { newPage, disabled: newPageDisabled } = useNewPage();

  useEffect(() => {
    const run: Record<ShortcutId, () => void> = {
      'toggle-tools': toggle,
      // A drawer has nothing to collapse; the chord slides it in instead.
      'toggle-sidebar': toggleSidebar,
      'toggle-assistant': toggleAssistant,
      'command-palette': () => onOpenPalette?.(),
      'new-page': () => {
        // A switch or a creation already owns the editor; the key is still
        // claimed, so a repeat does nothing rather than reach the browser.
        if (!newPageDisabled) void newPage();
      },
      // Opens it, like the sidebar's Library row; it does not toggle.
      library: () => setPanel('library'),
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
      if (leavingAside) returnFocusFromAside(activePanel);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activePanel,
    newPage,
    newPageDisabled,
    onShowHelp,
    onOpenPalette,
    save,
    undo,
    redo,
    setPanel,
    toggle,
    toggleAssistant,
    toggleSidebar,
  ]);
}
