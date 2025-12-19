import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { login, setSessionTokenCookie, clearSessionTokenCookie, UNAUTHORIZED_EVENT } from '../../services';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    <div 
      className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" 
      role="dialog" 
      aria-modal="true" 
      onClick={onClose}
    >
      <div 
        className="bg-card border border-border rounded-lg shadow-lg max-w-md w-full p-6" 
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-md grid place-items-center bg-gradient-to-br from-primary to-primary/80 text-white font-bold text-lg">
            CW
          </div>
          <div className="text-xl font-semibold">Welcome to ColWrite</div>
        </div>
        <div className="flex border-b border-border mb-4" role="tablist" aria-label="Authentication">
          <button 
            role="tab" 
            aria-selected={mode === 'signin'} 
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              mode === 'signin' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )} 
            onClick={() => setMode('signin')}
          >
            Sign in
          </button>
          <button 
            role="tab" 
            aria-selected={mode === 'register'} 
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              mode === 'register' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )} 
            onClick={() => setMode('register')}
          >
            Create account
          </button>
        </div>

        <form className="flex flex-col gap-4" onSubmit={submit}>
          {mode === 'register' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Name</span>
              <Input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
            </label>
          )}
          {mode === 'signin' ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">Username or email</span>
                <Input required type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@uni.edu or username" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">Password</span>
                <Input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </label>
            </>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Email</span>
              <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@uni.edu" />
            </label>
          )}
          {error && <div className="text-sm text-destructive">{error}</div>}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Please wait…' : (mode === 'signin' ? 'Continue' : 'Create account')}
            </Button>
          </div>
        </form>
        <div className="text-xs text-muted-foreground mt-3">By continuing you agree to the Terms and Privacy Policy.</div>
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-md">
          <div className="text-sm font-medium text-amber-800">Alpha Version Notice</div>
          <div className="text-xs text-amber-700 mt-1">This project is currently in alpha development. Login and registration functionality may change in future updates. User accounts and data may be deleted without prior notification during development phases.</div>
        </div>
      </div>
    </div>
  ), document.body);
}
