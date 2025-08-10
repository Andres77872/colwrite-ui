import type { ReactNode } from 'react';
import './AppShell.css';

export function AppShell({
  header,
  main,
  left,
  aside,
}: {
  header?: ReactNode;
  main: ReactNode;
  left?: ReactNode;
  aside?: ReactNode;
}) {
  const bodyClass = [
    'app-body',
    left ? 'has-left' : '',
    aside ? 'has-right' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className="app-shell">
      {header && <header className="app-header card">{header}</header>}
      <div className={bodyClass}>
        {left && <nav className="app-left card">{left}</nav>}
        <main className="app-main card">{main}</main>
        {aside && <aside className="app-aside card">{aside}</aside>}
      </div>
    </div>
  );
}
