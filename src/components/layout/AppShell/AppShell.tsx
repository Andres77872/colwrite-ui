import { useCallback, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { usePanels } from '@/components/panels/panelsContextState';
import { PANEL_CONFIG } from '@/components/panels/panelConfig';
import { ResizeHandle } from '@/components/ui/resizable-panel';
import { Sheet, SheetContent } from '@/components/ui/sheet';

interface AppShellProps {
  header?: ReactNode;
  main: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  aside?: ReactNode;
}

/** Every gutter in the shell — handles and plain spacers alike — is this wide. */
const GUTTER = 'w-3';

/** Shared surface treatment so all four regions read as one system. */
const PANEL_SURFACE = 'bg-card border border-border/60 rounded-xl overflow-hidden';

/**
 * AppShell — the application frame: header, sidebar, canvas, tools panel, rail.
 *
 * Below `md` the sidebar and tools panel become overlay drawers. They used to
 * be `hidden md:flex`, which meant that on a phone there was no route to the
 * document list, the tools, or the assistant — only the bare canvas.
 */
export function AppShell({ header, main, left, right, aside }: AppShellProps) {
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

  // Functional updates keep drag deltas correct across rapid pointer moves.
  const handleLeftResize = useCallback(
    (delta: number) => setLeftWidth((prev) => prev + delta),
    [setLeftWidth],
  );

  // The right panel grows as the handle moves left, hence the inverted delta.
  const handleRightResize = useCallback(
    (delta: number) => setRightWidth((prev) => prev - delta),
    [setRightWidth],
  );

  const actualLeftWidth = leftCollapsed ? PANEL_CONFIG.left.collapsed : leftWidth;
  const showAside = Boolean(aside) && isOpen;

  const shellStyle: CSSProperties = {
    '--left-width': `${actualLeftWidth}px`,
    '--right-width': `${rightWidth}px`,
    '--rail-width': `${PANEL_CONFIG.rail.width}px`,
  } as CSSProperties;

  return (
    <div className="flex h-dvh flex-col gap-2 bg-background p-2" style={shellStyle}>
      {header && <header className="w-full z-[var(--z-chrome)]">{header}</header>}

      <div className="flex min-h-0 flex-1">
        {/* Left sidebar — a column on desktop, a drawer below md */}
        {left && isDesktop && (
          <>
            <nav
              className={cn(PANEL_SURFACE, 'flex flex-col transition-[width] duration-200 ease-out')}
              style={{ width: 'var(--left-width)' }}
              aria-label="Workspace navigation"
            >
              {left}
            </nav>
            {leftCollapsed ? (
              <div className={GUTTER} aria-hidden="true" />
            ) : (
              <ResizeHandle
                direction="horizontal"
                onResize={handleLeftResize}
                label="Resize sidebar"
                value={leftWidth}
                min={PANEL_CONFIG.left.min}
                max={PANEL_CONFIG.left.max}
              />
            )}
          </>
        )}

        {/* Canvas. A flex column so the document scrolls independently of the
            status footer, instead of the footer bleeding out with negative
            margins that had to match this element's padding exactly. */}
        <main className={cn(PANEL_SURFACE, 'relative flex min-w-0 flex-1 flex-col')}>{main}</main>

        {/* Tools panel — a column on desktop, an overlay sheet below md */}
        {showAside && isDesktop && (
          <>
            <ResizeHandle
              direction="horizontal"
              onResize={handleRightResize}
              label="Resize tools panel"
              value={rightWidth}
              min={PANEL_CONFIG.right.min}
              max={PANEL_CONFIG.right.max}
            />
            <aside
              className={cn(PANEL_SURFACE, 'flex flex-col transition-[width] duration-200 ease-out')}
              style={{ width: 'var(--right-width)' }}
              aria-label="Tools"
            >
              {aside}
            </aside>
          </>
        )}
        {aside && isDesktop && !isOpen && <div className={GUTTER} aria-hidden="true" />}

        {/* Tools rail — desktop only.
            It used to render at every width on the theory that 52px is narrow
            enough to stay put. On a 375px phone that 52px plus its gutter is a
            sixth of the canvas, spent on a control whose panel is already an
            overlay sheet reachable from the topbar. */}
        {right && isDesktop && (
          <nav
            className={cn(PANEL_SURFACE, 'ml-2 overflow-y-auto p-1.5 transition-all duration-200 ease-out')}
            style={{ width: 'var(--rail-width)' }}
            aria-label="Tools"
          >
            {right}
          </nav>
        )}
      </div>

      {/* ---- Mobile overlays ----
          Radix `Sheet` rather than a hand-rolled dialog: it brings the focus
          trap, initial focus and focus restore the previous version lacked. */}
      {!isDesktop && left && (
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" title="Workspace navigation">
            {left}
          </SheetContent>
        </Sheet>
      )}

      {!isDesktop && aside && (
        <Sheet open={isOpen} onOpenChange={(next) => !next && close()}>
          <SheetContent side="right" title="Tools">
            {aside}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
