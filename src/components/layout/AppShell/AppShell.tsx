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
const GUTTER = 'w-3 shrink-0';

/** Shared surface treatment so all four regions read as one system. */
const PANEL_SURFACE = 'bg-card border border-border/60 rounded-xl overflow-hidden';

/**
 * AppShell — the application frame: header, sidebar, canvas, tools panel, rail.
 *
 * Below the minimum viable four-column width the sidebar and tools panel become
 * overlay drawers. This is deliberately a workspace constraint rather than a
 * framework breakpoint: at tablet widths the fixed panels left no editor at
 * all even though `md` had technically been reached.
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
        {/* Left sidebar — a column when the full workspace fits, otherwise a drawer. */}
        {left && isDesktop && (
          <>
            <nav
              className={cn(PANEL_SURFACE, 'flex shrink flex-col transition-[width] duration-200 ease-out')}
              style={{
                width: 'var(--left-width)',
                minWidth: leftCollapsed ? PANEL_CONFIG.left.collapsed : PANEL_CONFIG.left.min,
              }}
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
        <main
          className={cn(
            PANEL_SURFACE,
            'relative flex flex-1 flex-col',
            // Once the docked layout is active, protect a readable writing
            // measure and let the side panels shrink toward their own minima.
            // In drawer mode the canvas must be allowed to fit a phone.
            isDesktop ? 'min-w-[32rem]' : 'min-w-0',
          )}
        >
          {main}
        </main>

        {/* Tools panel — a column when the full workspace fits, otherwise an overlay sheet. */}
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
              className={cn(PANEL_SURFACE, 'flex shrink flex-col transition-[width] duration-200 ease-out')}
              style={{ width: 'var(--right-width)', minWidth: PANEL_CONFIG.right.min }}
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
            className={cn(PANEL_SURFACE, 'ml-2 shrink-0 overflow-y-auto p-1.5 transition-all duration-200 ease-out')}
            style={{ width: 'var(--rail-width)', minWidth: PANEL_CONFIG.rail.width }}
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
          <SheetContent
            side="right"
            title="Tools"
            className="w-[min(28rem,92vw)]"
          >
            <div className="flex min-h-0 flex-1">
              {/* With no default tool selected, drawer layouts need their own
                  chooser—the desktop rail is intentionally absent outside the
                  full workspace. Keeping it inside the sheet also makes every
                  tool reachable without spending canvas width while writing. */}
              {right && (
                <nav
                  className="shrink-0 overflow-y-auto border-r border-border/60 p-1.5"
                  style={{ width: 'var(--rail-width)' }}
                  aria-label="Tool chooser"
                >
                  {right}
                </nav>
              )}
              <div className="min-w-0 flex-1">{aside}</div>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
