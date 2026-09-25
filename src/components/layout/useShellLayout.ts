import { useCallback, useSyncExternalStore } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePanels } from '@/components/panels/panelsContextState';

/**
 * Whether the left sidebar docks as a column.
 *
 * Deliberately narrower than the right sidebar's breakpoint (`isDesktop`,
 * 1024px): a 240px navigation column and a readable page both fit on a
 * tablet in landscape, and hiding the document list behind a hamburger there
 * only cost a click.
 */
export function useSidebarDocked(): boolean {
  return useMediaQuery('(min-width: 900px)');
}

/** The page never gets narrower than this while both sidebars are docked. */
export const MIN_MAIN_WIDTH = 560;

function subscribeResize(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function useWindowWidth(): number {
  return useSyncExternalStore(
    subscribeResize,
    () => window.innerWidth,
    () => 1440,
  );
}

// "Show the sidebar anyway": set when the author reopens a sidebar that was
// hidden to make room, cleared when the right sidebar closes again.
let leftOverride = false;
const overrideListeners = new Set<() => void>();

export function setLeftSidebarOverride(next: boolean) {
  if (leftOverride === next) return;
  leftOverride = next;
  overrideListeners.forEach((listener) => listener());
}

function subscribeOverride(listener: () => void) {
  overrideListeners.add(listener);
  return () => overrideListeners.delete(listener);
}

/**
 * Whether the docked left sidebar is stepping aside for the right one.
 *
 * With both sidebars docked on a 1024–1200px window the page would shrink
 * below a readable width; as in Notion, the left sidebar hides (and peeks on
 * the left edge) while the right one is open, and comes back when it closes.
 */
export function useLeftSidebarAutoHidden(): boolean {
  const { isOpen, isDesktop, leftWidth, rightWidth, leftCollapsed } = usePanels();
  const docked = useSidebarDocked();
  const width = useWindowWidth();
  const override = useSyncExternalStore(subscribeOverride, () => leftOverride, () => false);
  return (
    docked &&
    isDesktop &&
    isOpen &&
    !leftCollapsed &&
    !override &&
    width - leftWidth - rightWidth < MIN_MAIN_WIDTH
  );
}

/**
 * The page topbar's (and the shortcut's) way back to a hidden sidebar.
 *
 * Docked, the sidebar can be collapsed to nothing and the button re-opens it;
 * as a drawer, the sidebar is always hidden and the button slides it in.
 * `visible` is false while the docked sidebar is showing — its own header
 * carries the collapse control then.
 */
export function useSidebarToggle() {
  const docked = useSidebarDocked();
  const autoHidden = useLeftSidebarAutoHidden();
  const { leftCollapsed, toggleLeftCollapsed, setMobileNavOpen } = usePanels();

  const toggle = useCallback(() => {
    if (!docked) setMobileNavOpen(true);
    else if (autoHidden) setLeftSidebarOverride(true);
    else toggleLeftCollapsed();
  }, [autoHidden, docked, setMobileNavOpen, toggleLeftCollapsed]);

  return { docked, visible: !docked || leftCollapsed || autoHidden, open: toggle, toggle };
}
