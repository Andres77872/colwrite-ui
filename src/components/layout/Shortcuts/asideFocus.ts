import { captureFocus, restoreFocus, type FocusSnapshot } from '@/hooks/useReturnFocus';
import type { SidebarTab } from '@/components/panels/panelsContextState';
import { toolMeta } from '@/components/panels/toolsConfig';

/**
 * Focus across the docked right sidebar, for the shortcuts that close it.
 *
 * Mod+Shift+J and Mod+Shift+\ unmount the docked sidebar. With focus inside
 * it (the composer, a search field) focus then fell to <body> and the next
 * Tab started again at the top of the window. Where focus was just before it
 * went into the sidebar is remembered, the caret included, and the closing
 * shortcut puts it back there.
 */

const ASIDE = 'aside[aria-label="Tools"]';

let beforeAside: FocusSnapshot | null = null;
let installed = false;

function aside(): HTMLElement | null {
  return document.querySelector<HTMLElement>(ASIDE);
}

function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  // `focusout` fires while the selection is still where the author left it,
  // which `focusin` on the sidebar's field would be too late for.
  document.addEventListener(
    'focusout',
    (event) => {
      const panel = aside();
      const to = event.relatedTarget as Node | null;
      const from = event.target as HTMLElement | null;
      if (!panel || !to || !from || !panel.contains(to) || panel.contains(from)) return;
      beforeAside = captureFocus(from);
    },
    true,
  );
}

install();

/** Whether focus is inside the docked right sidebar. */
export function focusIsInAside(): boolean {
  const active = document.activeElement;
  return Boolean(active && aside()?.contains(active));
}

/** The topbar button that opens `tab`, which shows again once it closes. */
function opener(tab: SidebarTab): HTMLElement | null {
  const main = document.querySelector('main');
  if (!main) return null;
  const buttons = [...main.querySelectorAll<HTMLElement>('button')];
  const found =
    tab === 'assistant'
      ? buttons.find((button) => button.textContent?.trim() === 'Ask AI')
      : tab === 'json'
        ? undefined
        : buttons.find((button) => button.getAttribute('aria-label') === toolMeta(tab).label);
  return found ?? main.querySelector<HTMLElement>('button[aria-label="Page options"]');
}

/**
 * After a shortcut that may have closed the sidebar while it held focus:
 * once the sidebar is gone, focus goes back to where it was before it went
 * in, or to the topbar button for the tab that was showing.
 */
export function returnFocusFromAside(tab: SidebarTab) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (aside()) return; // Still open: the shortcut switched tabs.
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const saved = beforeAside;
      beforeAside = null;
      if (saved && restoreFocus(saved)) return;
      opener(tab)?.focus({ preventScroll: true });
    }),
  );
}
