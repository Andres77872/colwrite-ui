import { useEffect, useMemo, useRef, useState } from 'react';
import './Topbar.css';
import { useAuth } from '../../auth/AuthContext';

export function Topbar() {
  const { user, openAuth, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const initials = useMemo(() => {
    if (!user) return '';
    const parts = (user.name || user.email || '?').replace(/@.*/, '').split(/[\s._-]+/g).filter(Boolean);
    const [a, b] = [parts[0]?.[0] || 'C', parts[1]?.[0] || 'W'];
    return `${a}${b}`.toUpperCase();
  }, [user]);

  const signOut = () => {
    logout();
    setMenuOpen(false);
  };

  return (
    <div className="topbar">
      <a className="brand" href="#" aria-label="ColWrite home">
        <div className="brand-logo">CW</div>
        <div className="brand-text">
          <div className="brand-title">ColWrite</div>
          <div className="brand-sub muted">Assistant writer for arXiv papers</div>
        </div>
      </a>

      {/* Primary navigation intentionally removed for now */}

      <div className="grow" />

      <div className="actions">
        {!user && (
          <button className="btn primary" onClick={() => openAuth()}>
            <span>Sign in</span>
          </button>
        )}
        {user && (
          <div className="user" ref={menuRef}>
            <button className="user-btn" onClick={() => setMenuOpen(v => !v)}>
              <div className="avatar" aria-hidden>{initials}</div>
              <div className="user-meta">
                <div className="user-name">{user.name || user.email}</div>
                <div className="user-sub muted">{user.email}</div>
              </div>
            </button>
            {menuOpen && (
              <div className="menu card">
                <div className="menu-section">
                  <div className="menu-label">Signed in</div>
                  <div className="menu-value">{user.email}</div>
                </div>
                <button className="menu-item" onClick={signOut}>Sign out</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
 
