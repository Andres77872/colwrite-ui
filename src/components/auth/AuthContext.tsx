import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { login, setSessionTokenCookie, clearSessionTokenCookie, UNAUTHORIZED_EVENT } from '../../services';
// Reuse modal styles from Topbar for the auth dialog
import '../layout/Topbar/Topbar.css';

export type User = { name: string; email: string };

type AuthContextValue = {
  user: User | null;
  openAuth: () => void;
  closeAuth: () => void;
  logout: () => void;
  loginWithCredentials: (usernameOrEmail: string, password: string) => Promise<void>;
};

const STORAGE_KEY = 'cw_user';

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState<boolean>(false);

  // Hydrate user from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch { /* no-op */ }
  }, []);

  // Listen for global unauthorized events to force re-authentication
  useEffect(() => {
    const onUnauthorized = () => {
      // Ensure any stored session artifacts are cleared and prompt login
      try {
        localStorage.removeItem(STORAGE_KEY);
        // Remove any stray token entries if they exist
        localStorage.removeItem('session_token');
      } catch { /* no-op */ }
      setUser(null);
      clearSessionTokenCookie();
      setAuthOpen(true);
    };
    // Casts to satisfy TS for custom event names
    window.addEventListener(UNAUTHORIZED_EVENT as any, onUnauthorized as EventListener);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT as any, onUnauthorized as EventListener);
  }, []);

  const logout = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('session_token');
    } catch { /* no-op */ }
    setUser(null);
    clearSessionTokenCookie();
  };

  const loginWithCredentials = async (usernameOrEmail: string, password: string) => {
    const resp = await login({ username: usernameOrEmail.trim(), password });
    if (!resp?.session_token) throw new Error(resp?.message || 'Login failed');
    setSessionTokenCookie(resp.session_token);
    const u: User = { name: resp.user?.username || usernameOrEmail || 'User', email: resp.user?.email || '' };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(u)); } catch { /* no-op */ }
    setUser(u);
    setAuthOpen(false);
  };

  const value = useMemo<AuthContextValue>(() => ({
    user,
    openAuth: () => setAuthOpen(true),
    closeAuth: () => setAuthOpen(false),
    logout,
    loginWithCredentials,
  }), [user]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onSuccess={() => setAuthOpen(false)} />}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function AuthDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { loginWithCredentials } = useAuth();
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
        await loginWithCredentials(username.trim() || email.trim(), password);
        onSuccess();
      } catch (err: any) {
        setError(err?.message || 'Login failed');
      } finally {
        setLoading(false);
      }
      return;
    }
    // Register (client-only placeholder)
    const uEmail = email.trim();
    if (!uEmail) return;
    // For now, registration is not implemented server-side; close the modal and ask user to sign in.
    setMode('signin');
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
