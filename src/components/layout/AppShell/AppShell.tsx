import type { ReactNode } from 'react';

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
  // Compute desktop grid template columns to mirror legacy layout
  const leftCol = left ? (leftCollapsed ? '56px' : '260px') : null;
  const colsParts: string[] = [];
  if (leftCol) colsParts.push(leftCol);
  colsParts.push('1fr');
  if (aside) colsParts.push('380px');
  if (right) colsParts.push('52px');
  // Use CSS variable + media query class to avoid Tailwind JIT missing dynamic arbitrary values
  const gridCols = colsParts.join(' ');
  const bodyClass = [
    'grid gap-3 flex-1 min-h-0 grid-cols-1',
    'app-grid', // applies grid-template-columns: var(--app-cols) on desktop
  ].filter(Boolean).join(' ');

  return (
    <div className="h-[100dvh] p-3 flex flex-col gap-3">
      {header && (
        <header className="p-0 w-full bg-transparent border-0 shadow-none relative z-20">{header}</header>
      )}
      <div className={bodyClass} style={{ ['--app-cols' as any]: gridCols }}>
        {left && (
          <nav className="overflow-hidden max-[980px]:hidden h-full bg-card border border-border rounded-lg shadow-sm">
            {left}
          </nav>
        )}
        <main className="p-3 overflow-auto bg-card border border-border rounded-lg shadow-sm">{main}</main>
        {aside && (
          <aside className="p-3 overflow-auto max-[980px]:hidden bg-card border border-border rounded-lg shadow-sm">{aside}</aside>
        )}
        {right && (
          <nav className="p-2 overflow-auto max-[980px]:hidden bg-card border border-border rounded-lg shadow-sm">{right}</nav>
        )}
      </div>
    </div>
  );
}

