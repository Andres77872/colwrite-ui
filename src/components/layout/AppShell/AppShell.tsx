import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { usePanels } from '@/components/panels/panelsContextState';
import { PANEL_CONFIG } from '@/components/panels/panelConfig';
import { ResizeHandle } from '@/components/ui/resizable-panel';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { focusPageTitle } from '@/editor';
import { captureFocus, restoreFocus, useReturnFocus, type FocusSnapshot } from '@/hooks/useReturnFocus';
import {
  setLeftSidebarOverride,
  useLeftSidebarAutoHidden,
  useSidebarDocked,
} from '../useShellLayout';

interface AppShellProps {
  /** The page: its topbar and scroll area. */
  main: ReactNode;
  /** The workspace sidebar. */
  left?: ReactNode;
  /** The right sidebar (assistant and page tools). */
  aside?: ReactNode;
}

/** A resize handle straddles its region's hairline instead of taking a gutter. */
const EDGE_HANDLE = 'absolute inset-y-0 z-[var(--z-sticky)]';

/**
 * AppShell — the application frame, edge to edge.
 *
 * Three regions in one row: a tinted, full-height sidebar, the page, and a
 * docked right sidebar. They are separated by a single hairline each — no
 * outer padding, no gaps and no rounded cards, which is what made the old
 * workspace read as a dashboard of five tiles rather than one page.
 *
 * Narrower windows move the side regions into sheets: the sidebar below
 * 900px, the right sidebar below 1024px (`isDesktop`). Between 1024px and
 * the width where both sidebars fit beside a readable page, the left one
 * steps aside (and peeks on the left edge) while the right one is open.
 */
export function AppShell({ main, left, aside }: AppShellProps) {
  const {
    leftWidth,
    setLeftWidth,
    rightWidth,
    setRightWidth,
    leftCollapsed,
    isOpen,
    close,
    isDesktop,
    mobileNavOpen,
    setMobileNavOpen,
  } = usePanels();
  const sidebarDocked = useSidebarDocked();
  const leftAutoHidden = useLeftSidebarAutoHidden();
  const leftHidden = leftCollapsed || leftAutoHidden;
  // Both sheets open from code ("Open sidebar", Ask AI, a page-menu item),
  // never a Radix trigger, so Radix has nothing to give focus back to on
  // close. Each remembers its opener instead (a menu item resolves to the
  // button that opened the menu).
  const navFocus = useReturnFocus();
  const toolsFocus = useReturnFocus();
  // Ask AI puts focus in the composer before the sheet's own open-focus step
  // runs, which then never fires; the sheet's opener is also noted as focus
  // first crosses into it.
  const toolsOpener = useRef<FocusSnapshot | null>(null);
  useEffect(() => {
    if (isDesktop) return;
    const onFocusOut = (event: FocusEvent) => {
      const sheet = document.querySelector('[data-tools-sheet]');
      const { target, relatedTarget } = event;
      if (!sheet || !(relatedTarget instanceof Node) || !sheet.contains(relatedTarget)) return;
      if (!(target instanceof HTMLElement) || sheet.contains(target)) return;
      // The first crossing only: coming back from a menu the sheet portals
      // out is not how it was opened.
      toolsOpener.current ??= captureFocus(target);
    };
    document.addEventListener('focusout', onFocusOut, true);
    return () => document.removeEventListener('focusout', onFocusOut, true);
  }, [isDesktop]);

  // "Show the sidebar anyway" lasts while the right sidebar stays open.
  useEffect(() => {
    if (!isOpen) setLeftSidebarOverride(false);
  }, [isOpen]);

  // Functional updates keep drag deltas correct across rapid pointer moves.
  const handleLeftResize = useCallback(
    (delta: number) => setLeftWidth((prev) => prev + delta),
    [setLeftWidth],
  );

  // The right sidebar grows as the handle moves left, hence the inverted delta.
  const handleRightResize = useCallback(
    (delta: number) => setRightWidth((prev) => prev - delta),
    [setRightWidth],
  );

  const shellStyle = {
    '--left-width': `${leftWidth}px`,
    '--right-width': `${rightWidth}px`,
  } as CSSProperties;

  return (
    <div className="flex h-dvh overflow-hidden bg-background" style={shellStyle}>
      <SkipToPage />
      {left && sidebarDocked && !leftHidden && (
        <nav
          aria-label="Workspace navigation"
          className="relative flex h-full shrink-0 flex-col bg-sidebar text-sidebar-foreground shadow-[inset_-1px_0_0_var(--color-border)]"
          style={{ width: 'var(--left-width)', minWidth: PANEL_CONFIG.left.min }}
        >
          {left}
          <ResizeHandle
            direction="horizontal"
            onResize={handleLeftResize}
            label="Resize sidebar"
            value={leftWidth}
            min={PANEL_CONFIG.left.min}
            max={PANEL_CONFIG.left.max}
            className={cn(EDGE_HANDLE, '-right-1')}
          />
        </nav>
      )}
      {left && sidebarDocked && leftHidden && <SidebarPeek>{left}</SidebarPeek>}

      <main className="relative flex min-w-0 flex-1 flex-col bg-background">{main}</main>

      {aside && isDesktop && isOpen && (
        <aside
          aria-label="Tools"
          className="relative flex h-full shrink-0 flex-col border-l border-border bg-sidebar"
          style={{ width: 'var(--right-width)', minWidth: PANEL_CONFIG.right.min }}
        >
          <ResizeHandle
            direction="horizontal"
            onResize={handleRightResize}
            label="Resize right sidebar"
            value={rightWidth}
            min={PANEL_CONFIG.right.min}
            max={PANEL_CONFIG.right.max}
            className={cn(EDGE_HANDLE, '-left-1')}
          />
          {aside}
        </aside>
      )}

      {/* Radix sheets bring the focus trap and initial focus; the return goes
          to the opener captured when the sheet opened. */}
      {left && !sidebarDocked && (
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent
            side="left"
            title="Workspace navigation"
            className="w-[min(18rem,85vw)] bg-sidebar text-sidebar-foreground"
            onOpenAutoFocus={navFocus.onOpenAutoFocus}
            onCloseAutoFocus={navFocus.onCloseAutoFocus}
          >
            {left}
          </SheetContent>
        </Sheet>
      )}

      {aside && !isDesktop && (
        <Sheet open={isOpen} onOpenChange={(next) => !next && close()}>
          <SheetContent
            side="right"
            title="Tools"
            // A phone gets the whole screen: the assistant and search results
            // are unreadable in a sliver beside a page nobody can see anyway.
            className="w-full bg-sidebar sm:w-[min(28rem,92vw)]"
            // Focus the sheet itself rather than its first button, which
            // popped that button's tooltip over the header on every opening.
            onOpenAutoFocus={(event) => {
              toolsFocus.onOpenAutoFocus();
              event.preventDefault();
              (event.currentTarget as HTMLElement | null)?.focus();
            }}
            data-tools-sheet=""
            onCloseAutoFocus={(event) => {
              toolsFocus.onCloseAutoFocus(event);
              const opener = toolsOpener.current;
              toolsOpener.current = null;
              if (event.defaultPrevented || !opener) return;
              const active = document.activeElement;
              if (active && active !== document.body && active.isConnected) return;
              if (restoreFocus(opener)) event.preventDefault();
            }}
          >
            {aside}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/** Dwell on the edge before the panel slides in, so a flick past it does not. */
const PEEK_OPEN_DELAY = 90;
/** Grace after the pointer leaves, so a slight overshoot does not snap it shut. */
const PEEK_CLOSE_DELAY = 250;

/**
 * The collapsed sidebar, peeking in over the page while the pointer rests on
 * the window's left edge.
 *
 * The edge strip and the panel share one wrapper, and leaving that wrapper is
 * what closes the peek. Closing on the panel's own `mouseleave` left it stuck
 * open whenever the pointer touched the strip and went elsewhere without ever
 * entering the panel. The strip starts below the topbar, level with the panel,
 * so flicking into the top-left corner for the » button does not trigger it.
 * Escape and a press anywhere outside also close it.
 *
 * It stays mounted off-screen between peeks so the document list is not
 * refetched every time the pointer brushes the edge. Keyboard users reopen
 * the sidebar from the page topbar instead, so the hidden copy is inert.
 */
function SidebarPeek({ children }: { children: ReactNode }) {
  const [peeking, setPeeking] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const schedule = useCallback((next: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeeking(next), delay);
  }, []);
  const cancel = useCallback(() => window.clearTimeout(timer.current), []);
  useEffect(() => cancel, [cancel]);

  // A row's menu portals outside the panel; reaching for it, or using it,
  // is not leaving the sidebar.
  const menuOpen = () => Boolean(panelRef.current?.querySelector('[aria-expanded="true"]'));

  useEffect(() => {
    if (!peeking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || menuOpen()) return;
      cancel();
      setPeeking(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && wrapperRef.current?.contains(target)) return;
      // A press inside a portalled row menu belongs to the sidebar.
      if (target instanceof Element && target.closest('[role="menu"], [data-radix-popper-content-wrapper]')) return;
      cancel();
      setPeeking(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [cancel, peeking]);

  return (
    <div
      ref={wrapperRef}
      className="contents"
      onMouseLeave={() => {
        if (menuOpen()) return;
        if (peeking) schedule(false, PEEK_CLOSE_DELAY);
        else cancel();
      }}
    >
      <div
        aria-hidden="true"
        data-testid="sidebar-peek-edge"
        className="fixed bottom-0 left-0 top-12 z-[var(--z-chrome)] w-2"
        onMouseEnter={() => schedule(true, peeking ? 0 : PEEK_OPEN_DELAY)}
        // Passing over the edge without resting on it does not open the peek.
        onMouseLeave={() => {
          if (!peeking) cancel();
        }}
      />
      <nav
        ref={panelRef}
        aria-label="Workspace navigation"
        inert={!peeking}
        onMouseEnter={() => {
          if (peeking) cancel();
        }}
        className={cn(
          'fixed bottom-3 left-0 top-12 z-[var(--z-dropdown)] flex flex-col overflow-hidden rounded-r-lg bg-sidebar text-sidebar-foreground',
          'transition-[translate,box-shadow] duration-200 ease-out',
          // The shadow goes with it, or its blur would tint the page edge.
          peeking ? 'translate-x-0 shadow-xl' : '-translate-x-full shadow-none',
        )}
        style={{ width: 'var(--left-width)' }}
      >
        {children}
      </nav>
    </div>
  );
}

/**
 * "Skip to page": the first stop of the tab order, visible only on focus.
 *
 * Without it a keyboard user tabbed through ~30 sidebar and topbar controls
 * before reaching the page. It puts the caret in the page title.
 */
function SkipToPage() {
  return (
    <a
      href="#page"
      onClick={(event) => {
        event.preventDefault();
        if (focusPageTitle()) return;
        document.querySelector<HTMLElement>('.canvas [contenteditable="true"]')?.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-2 focus:z-[var(--z-toast)] focus:rounded-lg focus:bg-popover focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
    >
      Skip to page
    </a>
  );
}
