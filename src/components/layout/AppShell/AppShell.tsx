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
  const bodyClass = [
    'app-body',
    left ? 'has-left' : '',
    aside ? 'has-right' : '',
    right ? 'has-right-rail' : '',
    left && leftCollapsed ? 'is-left-collapsed' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className="app-shell">
      {header && <header className="app-header">{header}</header>}
      <div className={bodyClass}>
        {left && <nav className={`app-left card${leftCollapsed ? ' collapsed' : ''}`}>{left}</nav>}
        <main className="app-main card">{main}</main>
        {aside && <aside className="app-aside card">{aside}</aside>}
        {right && <nav className="app-right card">{right}</nav>}
      </div>
    </div>
  );
}
