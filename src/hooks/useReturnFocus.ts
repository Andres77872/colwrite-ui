import { useCallback, useRef } from 'react';
import { lastInputWasPointer } from '@/lib/inputModality';

/**
 * Focus return for dialogs that are opened from code rather than from a
 * Radix `DialogTrigger` — Settings, Keyboard shortcuts, the command palette,
 * the delete confirmation.
 *
 * Radix gives focus back to a dialog's trigger, and these dialogs have none,
 * so closing one with Esc dropped focus on `<body>` and the next Tab started
 * again at the top of the sidebar. The element that had focus when the
 * dialog opened is remembered instead; a menu item (which unmounts with its
 * menu) resolves to the button that opened the menu, and a caret inside the
 * page comes back where it was.
 */

/** A menu item's way back: the trigger its menu is labelled by. */
export function resolveReturnTarget(element: Element | null): HTMLElement | null {
  let current: Element | null = element;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const menu = current.closest('[role="menu"]');
    if (!menu) break;
    const triggerId = menu.getAttribute('aria-labelledby');
    current = triggerId ? document.getElementById(triggerId) : null;
  }
  if (!(current instanceof HTMLElement) || current === document.body) return null;
  return current;
}

export type FocusSnapshot = { target: HTMLElement | null; range: Range | null };
type Snapshot = FocusSnapshot;

/**
 * Where focus is now, and the caret with it when it is in editable text.
 * `explicit` names the element to come back to instead of the focused one.
 */
export function captureFocus(explicit?: HTMLElement | null): FocusSnapshot {
  return snapshot(explicit);
}

/**
 * Puts focus (and the caret) back where `captureFocus` found it. Returns
 * false when that element is gone or inert, so the caller can fall back.
 */
export function restoreFocus({ target, range }: FocusSnapshot): boolean {
  if (!target || !target.isConnected || target.closest('[inert]')) return false;
  target.focus({ preventScroll: true, focusVisible: !lastInputWasPointer() } as FocusOptions);
  if (range) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  return true;
}

/**
 * A focus return passed from one dialog to the next.
 *
 * A command palette that closes itself to open another dialog (Keyboard
 * shortcuts, Settings) would otherwise hand that dialog its own search field
 * as the place to return to, which is gone by the time it closes. The palette
 * passes on where focus was before *it* opened instead; the next dialog to
 * open within a moment takes it.
 */
let handoff: { snapshot: Snapshot; at: number } | null = null;
const HANDOFF_TTL_MS = 1000;

function takeHandoff(): Snapshot | null {
  const pending = handoff;
  handoff = null;
  if (!pending || Date.now() - pending.at > HANDOFF_TTL_MS) return null;
  return pending.snapshot;
}

function snapshot(explicit?: HTMLElement | null): Snapshot {
  const target = explicit ?? resolveReturnTarget(document.activeElement);
  let range: Range | null = null;
  if (target?.isContentEditable) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && target.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0).cloneRange();
    }
  }
  return { target, range };
}

/**
 * Handlers for a `DialogContent`'s `onOpenAutoFocus` and `onCloseAutoFocus`,
 * plus `handOff` for a dialog that closes itself to open another.
 *
 * `returnFocus` overrides the remembered element (e.g. a menu's trigger
 * captured before the menu closed).
 */
export function useReturnFocus(returnFocus?: () => HTMLElement | null | undefined) {
  const saved = useRef<Snapshot>({ target: null, range: null });

  const onOpenAutoFocus = useCallback(() => {
    // Runs before Radix moves focus into the dialog, so `activeElement` is
    // still whatever the author was on.
    saved.current = takeHandoff() ?? snapshot(returnFocus?.());
  }, [returnFocus]);

  const onCloseAutoFocus = useCallback((event: Event) => {
    const { target, range } = saved.current;
    saved.current = { target: null, range: null };
    const active = document.activeElement;
    // Something the dialog ran already moved focus on purpose (New page puts
    // the caret in the new title): keep it there.
    if (active && active !== document.body && active.isConnected) {
      event.preventDefault();
      return;
    }
    if (restoreFocus({ target, range })) event.preventDefault();
  }, []);

  /**
   * Gives this dialog's return target to the next dialog that opens, for a
   * dialog that closes itself in order to open another one.
   */
  const handOff = useCallback(() => {
    handoff = { snapshot: saved.current, at: Date.now() };
  }, []);

  return { onOpenAutoFocus, onCloseAutoFocus, handOff };
}
