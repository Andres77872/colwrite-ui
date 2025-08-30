import { useEffect, useMemo, useState } from 'react';
import { login, setSessionTokenCookie, clearSessionTokenCookie } from '@/services/auth';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, Settings, LogOut, FileText } from 'lucide-react';
import { ThemeToggle } from '../ThemeToggle';

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
    clearSessionTokenCookie();
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  return (
    <div className="flex items-center justify-between w-full">
      {/* Left: Logo and Branding */}
      <div className="flex items-center space-x-4">
        <a 
          className="flex items-center space-x-3 no-underline text-foreground hover:opacity-80 transition-opacity" 
          href="#" 
          aria-label="ColWrite home"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/80 text-primary-foreground font-bold text-sm flex items-center justify-center shadow-sm">
            CW
          </div>
          <div className="hidden sm:block">
            <div className="font-semibold text-lg text-foreground">
              ColWrite
            </div>
            <div className="text-sm text-muted-foreground -mt-0.5">
              Assistant writer for arXiv papers
            </div>
          </div>
        </a>
      </div>

      {/* Center: Search or Navigation (expandable) */}
      <div className="flex-1 max-w-md mx-4 hidden md:block">
        {/* Future: Add search bar or navigation breadcrumbs here */}
      </div>

      {/* Right: Theme + User Actions */}
      <div className="flex items-center space-x-3">
        <ThemeToggle />
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 px-2">
                <Avatar className="w-7 h-7 mr-2 ring-2 ring-accent/20 ring-offset-2 ring-offset-background">
                  <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name)}`} />
                  <AvatarFallback className="bg-gradient-to-br from-accent to-accent-hover text-accent-foreground text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{user.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                  </div>
                </DropdownMenuLabel>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer">
                <FileText className="mr-2 h-4 w-4" />
                Documents
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="cursor-pointer text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button onClick={() => setOpen(true)} size="sm">
            Sign In
          </Button>
        )}
      </div>

      {open && (
        <AuthDialog
          onClose={() => setOpen(false)}
          onSubmit={(u) => { localStorage.setItem(STORAGE_KEY, JSON.stringify(u)); setUser(u); setOpen(false); }}
        />
      )}
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


