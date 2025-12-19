import { useCallback, type ReactNode, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { usePanels, PANEL_CONFIG } from '@/components/panels/panelsContext';
import { ResizeHandle } from '@/components/ui/resizable-panel';

interface AppShellProps {
  header?: ReactNode;
  main: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  aside?: ReactNode;
}

/**
 * AppShell - Main application layout with resizable panels
 * Uses CSS custom properties for dynamic panel widths
 */
export function AppShell({
  header,
  main,
  left,
  right,
  aside,
}: AppShellProps) {
  const { 
    leftWidth, 
    setLeftWidth, 
    rightWidth, 
    setRightWidth, 
    leftCollapsed,
    isOpen,
  } = usePanels();

  // Handle resize for left panel - use functional update to avoid stale closures
  const handleLeftResize = useCallback((delta: number) => {
    setLeftWidth((prev: number) => Math.min(
      PANEL_CONFIG.left.max, 
      Math.max(PANEL_CONFIG.left.min, prev + delta)
    ));
  }, [setLeftWidth]);

  // Handle resize for right panel - use functional update to avoid stale closures
  const handleRightResize = useCallback((delta: number) => {
    setRightWidth((prev: number) => Math.min(
      PANEL_CONFIG.right.max, 
      Math.max(PANEL_CONFIG.right.min, prev - delta)
    ));
  }, [setRightWidth]);

  // Calculate actual widths
  const actualLeftWidth = leftCollapsed ? PANEL_CONFIG.left.collapsed : leftWidth;
  const actualRightWidth = isOpen ? rightWidth : 0;
  const showAside = aside && isOpen;

  // CSS custom properties for panel widths
  const shellStyle: CSSProperties = {
    '--left-width': `${actualLeftWidth}px`,
    '--right-width': `${actualRightWidth}px`,
    '--rail-width': `${PANEL_CONFIG.rail.width}px`,
  } as CSSProperties;

  // Common panel styles for consistency
  const panelClasses = "bg-card border border-border/60 rounded-xl overflow-hidden";

  return (
    <div className="h-dvh p-2 flex flex-col gap-2 bg-background" style={shellStyle}>
      {header && (
        <header className="w-full z-20">
          {header}
        </header>
      )}
      
      <div className="flex flex-1 min-h-0 gap-0">
        {/* Left Sidebar */}
        {left && (
          <>
            <nav
              className={cn(
                panelClasses,
                "hidden md:flex flex-col",
                "transition-[width] duration-200 ease-out",
              )}
              style={{ width: `var(--left-width)` }}
            >
              {left}
            </nav>
            {/* Left resize handle */}
            {!leftCollapsed && (
              <ResizeHandle
                direction="horizontal"
                onResize={handleLeftResize}
                className="hidden md:flex"
              />
            )}
            {leftCollapsed && <div className="w-2 hidden md:block" />}
          </>
        )}
        
        {/* Main Content */}
        <main className={cn(panelClasses, "flex-1 p-4 overflow-auto min-w-0")}>
          {main}
        </main>
        
        {/* Right Panel (Aside) */}
        {showAside && (
          <>
            {/* Right resize handle */}
            <ResizeHandle
              direction="horizontal"
              onResize={handleRightResize}
              className="hidden md:flex"
            />
            <aside
              className={cn(
                panelClasses,
                "hidden md:flex flex-col",
                "transition-[width] duration-200 ease-out",
              )}
              style={{ width: `var(--right-width)` }}
            >
              {aside}
            </aside>
          </>
        )}
        
        {/* Spacer when aside is closed */}
        {aside && !isOpen && <div className="w-2 hidden md:block" />}
        
        {/* Right Rail */}
        {right && (
          <nav
            className={cn(
              panelClasses,
              "p-1.5 overflow-auto hidden md:block ml-2",
              "transition-all duration-200 ease-out",
            )}
            style={{ width: `var(--rail-width)` }}
          >
            {right}
          </nav>
        )}
      </div>
    </div>
  );
}
