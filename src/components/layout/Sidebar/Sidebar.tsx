import { useState } from 'react';
import './Sidebar.css';
import { DocumentsMenu } from '../../editor/DocumentsMenu';

export function Sidebar() {
  const [active, setActive] = useState<string>('editor');
  const [docsOpen, setDocsOpen] = useState<boolean>(true);

  const go = (id: string) => () => setActive(id);

  return (
    <aside className="sidebar">
      <div className="sb-header">
        <div className="sb-brand">
          <div className="sb-logo">CW</div>
          <div className="sb-title">Colwrite</div>
        </div>
      </div>

      <div className="sb-scroll">
        <nav className="sb-nav">
          <button className={`sb-item${active === 'dashboard' ? ' active' : ''}`} onClick={go('dashboard')}>
            <span className="sb-icn" aria-hidden>🏠</span>
            <span>Dashboard</span>
          </button>
          <button className={`sb-item${active === 'editor' ? ' active' : ''}`} onClick={go('editor')}>
            <span className="sb-icn" aria-hidden>📝</span>
            <span>Editor</span>
          </button>
          <button className={`sb-item${active === 'settings' ? ' active' : ''}`} onClick={go('settings')}>
            <span className="sb-icn" aria-hidden>⚙️</span>
            <span>Settings</span>
          </button>
        </nav>

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
      </div>

      <div className="sb-footer">
        <div className="sb-meta muted">v0.1 • UI Preview</div>
      </div>
    </aside>
  );
}


