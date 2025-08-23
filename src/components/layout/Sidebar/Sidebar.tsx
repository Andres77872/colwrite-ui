import { useState } from 'react';
import { DocumentsMenu } from '../../editor/DocumentsMenu';

export function Sidebar({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const [active, setActive] = useState<string>('editor');
  const [docsOpen, setDocsOpen] = useState<boolean>(true);

  const go = (id: string) => () => setActive(id);

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sb-header">
        <div className="sb-brand">
          <button
            className="sb-logo"
            onClick={collapsed ? onToggle : undefined}
            aria-label={collapsed ? 'Expand sidebar' : undefined}
            title={collapsed ? 'Expand' : undefined}
          >
            CW
          </button>
          <div className="sb-title">Colwrite</div>
        </div>
        {!collapsed && (
          <button
            className="sb-toggle"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            title="Collapse"
          >
            ‹
          </button>
        )}
      </div>

      <div className="sb-scroll">
        <nav className="sb-nav">
          <button className={`sb-item${active === 'dashboard' ? ' active' : ''}`} onClick={go('dashboard')} title="Dashboard" aria-label="Dashboard">
            <span className="sb-icn" aria-hidden>🏠</span>
            <span className="sb-label">Dashboard</span>
          </button>
          <button className={`sb-item${active === 'editor' ? ' active' : ''}`} onClick={go('editor')} title="Editor" aria-label="Editor">
            <span className="sb-icn" aria-hidden>📝</span>
            <span className="sb-label">Editor</span>
          </button>
          <button className={`sb-item${active === 'settings' ? ' active' : ''}`} onClick={go('settings')} title="Settings" aria-label="Settings">
            <span className="sb-icn" aria-hidden>⚙️</span>
            <span className="sb-label">Settings</span>
          </button>
        </nav>

        {!collapsed && (
          <div className="sb-section">
            <button className="sb-section-header" onClick={() => setDocsOpen(v => !v)}>
              <span>Documents</span>
              <span className="sb-chev" aria-hidden>{docsOpen ? '▾' : '▸'}</span>
            </button>
            {docsOpen && (
              <div className="sb-section-body">
                <DocumentsMenu />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sb-footer">
        <div className="sb-meta muted">{collapsed ? 'v0.1' : 'v0.1 • UI Preview'}</div>
      </div>
    </aside>
  );
}


