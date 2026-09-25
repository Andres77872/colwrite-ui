import * as React from "react"
import { lastInputWasPointer } from "@/lib/inputModality"

/**
 * Focus handling for overlays opened or closed with a pointer.
 *
 * After a click, Radix restores focus to the trigger (menus, popovers) or
 * moves it to the first control (dialogs, sheets). Both are script focus,
 * which Chrome rings with `:focus-visible`, so the chrome showed a heavy ring
 * after every click. These handlers keep focus where Radix puts it but ask the
 * browser not to show it (`focusVisible: false`). The ring then first appears
 * on the next Tab. Keyboard use is left alone.
 */

type FocusOptionsWithVisible = FocusOptions & { focusVisible?: boolean }

export function focusQuietly(el: HTMLElement | null | undefined): void {
  el?.focus({ preventScroll: true, focusVisible: false } as FocusOptionsWithVisible)
}

/** The trigger that controls `content`, while it is open. */
export function findTrigger(content: HTMLElement | null): HTMLElement | null {
  if (!content?.id) return null
  return document.querySelector<HTMLElement>(`[aria-controls="${content.id.replace(/["\\]/g, "\\$&")}"]`)
}

const TABBABLE =
  'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable="true"]'

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number"])

function isTextEntry(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type)
  return (el as HTMLElement).isContentEditable === true
}

/**
 * `onOpenAutoFocus` for a dialog or sheet. After a pointer open, focus goes to
 * the panel itself instead of its first button, so no ring shows until Tab.
 * A panel that starts with a text field still focuses it: typing straight
 * away is the point of that field, and a caret is not a ring.
 */
export function quietOpenAutoFocus(event: Event): void {
  if (event.defaultPrevented || !lastInputWasPointer()) return
  const container = event.target instanceof HTMLElement ? event.target : null
  if (!container) return
  if (isTextEntry(container.querySelector(TABBABLE))) return
  event.preventDefault()
  focusQuietly(container)
}

/**
 * `onCloseAutoFocus` for a menu, popover or dialog. After a pointer close,
 * focus still returns to the trigger, without the ring. If the click already
 * put focus somewhere else (a non-modal menu dismissed by clicking the page,
 * or a dialog a menu item opened), focus stays there.
 */
export function quietCloseAutoFocus(event: Event, trigger: HTMLElement | null): void {
  if (event.defaultPrevented || !lastInputWasPointer()) return
  event.preventDefault()
  const active = document.activeElement
  const focusMovedOn = active && active !== document.body && active.isConnected
  if (!focusMovedOn && trigger?.isConnected) focusQuietly(trigger)
}

function assignRef<T>(ref: React.ForwardedRef<T>, node: T | null): void {
  if (typeof ref === "function") ref(node)
  else if (ref) ref.current = node
}

/**
 * Merges a forwarded ref with capture of the trigger that opened the overlay.
 * Returns the ref callback for the content and a getter for the trigger.
 */
export function useTriggerCapture<T extends HTMLElement>(
  ref: React.ForwardedRef<T>
): [() => HTMLElement | null, (node: T | null) => void] {
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const setRefs = React.useCallback(
    (node: T | null) => {
      // Captured while open: a menu trigger drops `aria-controls` once closed.
      if (node) triggerRef.current = findTrigger(node)
      assignRef(ref, node)
    },
    [ref]
  )
  const getTrigger = React.useCallback(() => triggerRef.current, [])
  return [getTrigger, setRefs]
}
