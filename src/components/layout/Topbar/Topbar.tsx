import { useEffect, useMemo, useState } from 'react';
import { login, setSessionTokenCookie, clearSessionTokenCookie } from '@/services/auth';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

type User = { name: string; email: string };

const STORAGE_KEY = 'cw_user';

export function Topbar() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState<boolean>(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch { /* no-op */ }
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
    clearSessionTokenCookie();
  };

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 bg-card border border-border rounded-lg shadow-sm relative z-10 w-full">
      <a className="flex items-center gap-3 no-underline text-foreground" href="#" aria-label="ColWrite home">
        <div className="w-7 h-7 rounded-sm grid place-items-center bg-primary text-primary-foreground font-bold">CW</div>
        <div className="brand-text">
          <div className="font-bold">ColWrite</div>
          <div className="text-sm text-muted-foreground">Assistant writer for arXiv papers</div>
        </div>
      </a>

      {/* Primary navigation intentionally removed for now */}

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {!user ? (
          <Button onClick={() => setOpen(true)}>Sign in</Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="flex items-center gap-2 px-1.5 py-1 shadow-sm">
                <Avatar className="h-6 w-6">
                  <AvatarImage alt={user.name || user.email} />
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="text-left leading-tight">
                  <div className="text-sm font-semibold">{user.name || user.email}</div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Signed in</DropdownMenuLabel>
              <DropdownMenuItem disabled>{user.email}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

  return (
    <Dialog open onOpenChange={(v: boolean) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Welcome to ColWrite</DialogTitle>
          <DialogDescription>Sign in to your account or create a new one.</DialogDescription>
        </DialogHeader>

        <div className="inline-flex gap-2">
          <Button type="button" variant={mode === 'signin' ? 'default' : 'outline'} onClick={() => setMode('signin')}>Sign in</Button>
          <Button type="button" variant={mode === 'register' ? 'default' : 'outline'} onClick={() => setMode('register')}>Create account</Button>
        </div>

        <form id="auth-form" className="flex flex-col gap-3" onSubmit={submit}>
          {mode === 'register' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name" className="text-muted-foreground">Name</Label>
              <Input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
            </div>
          )}
          {mode === 'signin' ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="username">Username or email</Label>
                <Input id="username" required type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@uni.edu or username" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@uni.edu" />
            </div>
          )}
          {error && <div className="text-destructive text-sm">{error}</div>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="submit" form="auth-form" disabled={loading}>{loading ? 'Please wait…' : (mode === 'signin' ? 'Continue' : 'Create account')}</Button>
        </DialogFooter>
        <div className="text-muted-foreground text-xs">By continuing you agree to the Terms and Privacy Policy.</div>
        <div className="mt-3 p-3 border border-dashed border-border rounded-sm bg-secondary">
          <div className="font-bold mb-1">Alpha Version Notice</div>
          <div className="text-sm text-muted-foreground">This project is currently in alpha development. Login and registration functionality may change in future updates. User accounts and data may be deleted without prior notification during development phases.</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


