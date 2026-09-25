import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  login,
  logout as logoutApi,
  getProfile,
  UNAUTHORIZED_EVENT,
  type UnauthorizedDetail,
} from '@/services';
import { clearCachedDocs } from '@/editor/storage';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BrandMark, APP_NAME } from '@/components/common/Brand';
import { AlertCircle, Info } from 'lucide-react';
import {
  AuthContext,
  useAuth,
  type AuthContextValue,
  type AuthStatus,
  type User,
} from './authContextState';
export type { AuthStatus, User } from './authContextState';

const STORAGE_KEY = 'cw_user';
const LEGACY_TOKEN_KEY = 'session_token';

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    /* corrupt entry — start signed out */
    return null;
  }
}

function persistUser(user: User): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    /* session still works for this tab */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [cachedUser] = useState(readCachedUser);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(() => cachedUser ? 'checking' : 'anonymous');
  const [authOpen, setAuthOpen] = useState(false);
  // Explains an involuntary sign-out. Without it the user is dropped on the
  // landing page with no indication of what happened.
  const [notice, setNotice] = useState<string | null>(null);

  const clearLocalSession = useCallback(() => {
    // Document drafts are account data. Every session teardown must clear
    // them, including expiry and a failed boot-time identity check—not only
    // an intentional logout.
    clearCachedDocs();
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch {
      /* storage blocked — the rest of the teardown still applies */
    }
    setUser(null);
    setStatus('anonymous');
  }, []);

  // Confirm the cached identity against the server before trusting it.
  useEffect(() => {
    if (!cachedUser) return;

    let cancelled = false;
    (async () => {
      try {
        const profile = await getProfile();
        if (cancelled) return;
        const confirmed: User = {
          name: profile.username || cachedUser.name,
          email: profile.email || cachedUser.email || '',
          userType: profile.user_type ?? cachedUser.userType ?? null,
        };
        persistUser(confirmed);
        setUser(confirmed);
        setStatus('authenticated');
      } catch {
        // Includes the case where the access cookie expired and the refresh
        // attempt inside the API layer also failed. Nothing to recover.
        if (!cancelled) clearLocalSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cachedUser, clearLocalSession]);

  // A 401/403 that survived a refresh attempt means the session is really gone.
  useEffect(() => {
    const onUnauthorized = (event: Event) => {
      const detail = (event as CustomEvent<UnauthorizedDetail>).detail;
      clearLocalSession();
      setNotice(detail?.message ?? 'Your session expired. Please sign in again.');
      setAuthOpen(true);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized as EventListener);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized as EventListener);
  }, [clearLocalSession]);

  const logout = useCallback(() => {
    // Best-effort server call; local state is cleared either way. Only the
    // server can clear the HttpOnly cookie, so a failure here leaves the
    // session alive on the API until it expires.
    logoutApi().catch(() => {});
    clearLocalSession();
    setNotice(null);
  }, [clearLocalSession]);

  const loginWithCredentials = useCallback(async (usernameOrEmail: string, password: string) => {
    const response = await login({ username: usernameOrEmail.trim(), password });
    // Any non-2xx already threw with the server's message. The body carries no
    // token — the credentials arrive as HttpOnly cookies — so an explicit
    // `authenticated: false` is the only failure signal left. Gating on a body
    // field the API strips is what made a *successful* login surface
    // "Root user login successful" as a red error.
    if (response?.authenticated === false) {
      throw new Error(response?.message || 'Login failed');
    }
    const nextUser: User = {
      name: response?.user?.username || usernameOrEmail.trim() || 'User',
      email: response?.user?.email || '',
      userType: response?.user?.user_type ?? null,
    };
    persistUser(nextUser);
    setUser(nextUser);
    setStatus('authenticated');
    setNotice(null);
    setAuthOpen(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      openAuth: () => setAuthOpen(true),
      closeAuth: () => setAuthOpen(false),
      logout,
      loginWithCredentials,
    }),
    [user, status, logout, loginWithCredentials],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {authOpen && (
        <AuthDialog
          open
          onOpenChange={setAuthOpen}
          notice={notice}
          onNoticeHandled={() => setNotice(null)}
        />
      )}
    </AuthContext.Provider>
  );
}

/* ----------------------------------------
   Auth dialog
   ---------------------------------------- */

type Mode = 'signin' | 'register';

/**
 * Built on the Dialog primitive so it gets a focus trap, focus restoration,
 * Escape handling and `aria-labelledby` wiring. The hand-rolled portal it
 * replaces had none of those, and closed on any backdrop click — including a
 * stray one made while typing a password.
 */
function AuthDialog({
  open,
  onOpenChange,
  notice,
  onNoticeHandled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why the dialog opened by itself, if it did. Superseded by a submit error. */
  notice: string | null;
  onNoticeHandled: () => void;
}) {
  const { loginWithCredentials } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    onNoticeHandled();
    if (mode !== 'signin') return;

    setLoading(true);
    try {
      await loginWithCredentials(username, password);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        // Losing a half-typed password to a stray backdrop click is worse than
        // requiring the Escape key or the close button.
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <BrandMark size="lg" />
            <div>
              <DialogTitle>Welcome to {APP_NAME}</DialogTitle>
              <DialogDescription>Sign in to open your documents.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Radix tabs rather than hand-rolled `role="tab"` buttons, which had
            `aria-selected` but no `aria-controls`, no `tabpanel`, no roving
            tabindex and no arrow-key movement — half of the pattern. */}
        <Tabs
          value={mode}
          onValueChange={(next) => {
            setMode(next as Mode);
            setError(null);
          }}
          className="mt-4"
        >
          <TabsList
            aria-label="Authentication"
            className="flex h-auto w-full justify-start rounded-none border-b border-border bg-transparent p-0"
          >
            {(['signin', 'register'] as const).map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className={cn(
                  '-mb-px rounded-none border-b-2 border-transparent px-4 py-2 text-sm font-medium shadow-none',
                  'text-muted-foreground hover:text-foreground',
                  'data-[state=active]:border-primary data-[state=active]:bg-transparent',
                  'data-[state=active]:text-primary data-[state=active]:shadow-none',
                )}
              >
                {tab === 'signin' ? 'Sign in' : 'Create account'}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="signin">
          <form className="mt-4 flex flex-col gap-4" onSubmit={submit}>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Username or email</span>
              <Input
                required
                autoFocus
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="you@university.edu"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Password</span>
              <Input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </label>

            {(error || notice) && (
              <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
                <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words">{error || notice}</span>
              </p>
            )}

            <Button type="submit" disabled={loading || !username.trim() || !password}>
              {loading && <Spinner />}
              {loading ? 'Signing in…' : 'Continue'}
            </Button>
          </form>
          </TabsContent>

          {/* Registration has no server endpoint yet. An earlier version
              rendered a form that silently flipped back to sign-in on submit,
              which read as a broken button. */}
          <TabsContent value="register">
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-sm font-medium">Accounts are invite-only during alpha</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Self-service registration is not available yet. Ask for an invite, then sign in with
                the credentials you were given.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setMode('signin')}>
                Back to sign in
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-medium text-warning">Alpha software</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Accounts and documents may be reset without notice while ColWrite is in development.
            </p>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          By continuing you agree to the Terms and Privacy Policy.
        </p>
      </DialogContent>
    </Dialog>
  );
}
