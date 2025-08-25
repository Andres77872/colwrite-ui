import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function AppShell({
  header,
  main,
  left,
  right,
  aside,
  leftCollapsed,
}: {
  header?: ReactNode;
  main: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  aside?: ReactNode;
  leftCollapsed?: boolean;
}) {
  // Compute desktop grid template columns with improved spacing
  const leftCol = left ? (leftCollapsed ? '56px' : '280px') : null;
  const colsParts: string[] = [];
  if (leftCol) colsParts.push(leftCol);
  colsParts.push('1fr');
  if (aside) colsParts.push('400px');
  if (right) colsParts.push('60px');
  
  const gridCols = colsParts.join(' ');

  return (
    <div className="h-[100dvh] bg-background">
      {/* Enhanced header with consistent spacing */}
      {header && (
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center px-4">
            {header}
          </div>
        </header>
      )}
      
      {/* Main content area with improved layout */}
      <div 
        className={cn(
          "flex-1 min-h-0 overflow-hidden",
          "grid grid-cols-1 lg:grid-cols-[auto_1fr] xl:grid-cols-[auto_1fr_auto_auto]",
          "gap-0"
        )}
        style={{ 
          ['--app-cols' as any]: gridCols,
          height: header ? 'calc(100dvh - 4rem)' : '100dvh'
        }}
      >
        {/* Left Sidebar */}
        {left && (
          <nav className={cn(
            "min-h-0 border-r bg-muted/40 hidden lg:flex flex-col",
            leftCollapsed ? "w-14" : "w-70 xl:w-80"
          )}>
            {left}
          </nav>
        )}

        {/* Main Content */}
        <main className="min-h-0 flex-1 overflow-auto bg-background">
          <div className="container p-6 space-y-6">
            {main}
          </div>
        </main>

        {/* Aside Panel */}
        {aside && (
          <aside className="min-h-0 w-96 border-l bg-muted/40 hidden xl:flex flex-col">
            <div className="p-4 border-b">
              <h3 className="font-semibold">Tools</h3>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {aside}
            </div>
          </aside>
        )}

        {/* Right Rail */}
        {right && (
          <nav className="min-h-0 w-15 border-l bg-muted/40 hidden xl:flex flex-col">
            <div className="p-2">
              {right}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}

