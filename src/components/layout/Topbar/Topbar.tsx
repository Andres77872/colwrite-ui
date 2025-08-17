import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './Topbar.css';
import { login, setSessionTokenCookie, clearSessionTokenCookie } from '../../../services';

type User = { name: string; email: string };

const STORAGE_KEY = 'cw_user';

export function Topbar() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch { /* no-op */ }
  }, []);

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
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setMenuOpen(false);
    clearSessionTokenCookie();
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
          <button className="btn primary" onClick={() => setOpen(true)}>
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

      {open && (
        <AuthDialog
          onClose={() => setOpen(false)}
          onSubmit={(u) => { localStorage.setItem(STORAGE_KEY, JSON.stringify(u)); setUser(u); setOpen(false); }}
        />)
      }
    </div>
  );
}

function AuthDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (u: User) => void }) {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'signin') {
      try {
        setLoading(true);
        const resp = await login({ username: username.trim() || email.trim(), password: password });
        if (!resp?.session_token) throw new Error(resp?.message || 'Login failed');
        setSessionTokenCookie(resp.session_token);
        onSubmit({ name: resp.user?.username || username || 'User', email: resp.user?.email || email || '' });
      } catch (err: any) {
        setError(err?.message || 'Login failed');
      } finally {
        setLoading(false);
      }
      return;
    }
    // Register (client-only placeholder)
    const u: User = { name: name.trim(), email: email.trim() };
    if (!u.email) return;
    onSubmit(u);
  };

  return createPortal((
    <div className="auth-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="auth-modal card" onClick={(e) => e.stopPropagation()}>
        <div className="auth-head">
          <div className="brand-logo">CW</div>
          <div className="brand-title">Welcome to ColWrite</div>
        </div>
        <div className="auth-tabs" role="tablist" aria-label="Authentication">
          <button role="tab" aria-selected={mode === 'signin'} className={`auth-tab${mode === 'signin' ? ' active' : ''}`} onClick={() => setMode('signin')}>Sign in</button>
          <button role="tab" aria-selected={mode === 'register'} className={`auth-tab${mode === 'register' ? ' active' : ''}`} onClick={() => setMode('register')}>Create account</button>
        </div>

        <form className="stack" onSubmit={submit}>
          {mode === 'register' && (
            <label className="stack">
              <span className="muted">Name</span>
              <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
            </label>
          )}
          {mode === 'signin' ? (
            <>
              <label className="stack">
                <span className="muted">Username or email</span>
                <input className="input" required type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@uni.edu or username" />
              </label>
              <label className="stack">
                <span className="muted">Password</span>
                <input className="input" required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </label>
            </>
          ) : (
            <label className="stack">
              <span className="muted">Email</span>
              <input className="input" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@uni.edu" />
            </label>
          )}
          {error && <div className="error-text">{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="btn primary" disabled={loading}>{loading ? 'Please wait…' : (mode === 'signin' ? 'Continue' : 'Create account')}</button>
          </div>
        </form>
        <div className="muted" style={{ fontSize: '12px', marginTop: 6 }}>By continuing you agree to the Terms and Privacy Policy.</div>
        <div className="alpha-notice">
          <div className="alpha-title">Alpha Version Notice</div>
          <div className="alpha-text">This project is currently in alpha development. Login and registration functionality may change in future updates. User accounts and data may be deleted without prior notification during development phases.</div>
        </div>
      </div>
    </div>
  ), document.body);
}


