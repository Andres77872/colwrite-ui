import { useCallback, useEffect, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { usePanels } from '@/components/panels/panelsContextState';
import { PANEL_CONFIG } from '@/components/panels/panelConfig';
import { ResizeHandle } from '@/components/ui/resizable-panel';

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
              <ResizeHandle direction="horizontal" onResize={handleLeftResize} label="Resize sidebar" />
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

        {/* Tools rail — narrow enough to stay put at every viewport */}
        {right && (
          <nav
            className={cn(PANEL_SURFACE, 'ml-2 overflow-y-auto p-1.5 transition-all duration-200 ease-out')}
            style={{ width: 'var(--rail-width)' }}
            aria-label="Tools"
          >
            {right}
          </nav>
        )}
      </div>

      {/* ---- Mobile overlays ---- */}
      {!isDesktop && left && (
        <MobileSheet
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          side="left"
          label="Workspace navigation"
        >
          {left}
        </MobileSheet>
      )}

      {!isDesktop && aside && (
        <MobileSheet open={isOpen} onClose={close} side="right" label="Tools">
          {aside}
        </MobileSheet>
      )}
    </div>
  );
}

/* ----------------------------------------
   Mobile sheet
   ---------------------------------------- */

function MobileSheet({
  open,
  onClose,
  side,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  side: 'left' | 'right';
  label: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    // Prevent the canvas behind the sheet from scrolling with it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] md:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 animate-in fade-in-0"
        aria-label={`Close ${label.toLowerCase()}`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          'absolute inset-y-0 flex w-[min(20rem,85vw)] flex-col border-border bg-card shadow-xl',
          'animate-in fade-in-0',
          side === 'left' ? 'left-0 border-r slide-in-from-left-2' : 'right-0 border-l slide-in-from-right-2',
        )}
      >
        {children}
      </div>
    </div>
  );
}
