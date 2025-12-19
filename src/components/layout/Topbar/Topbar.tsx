import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/auth/AuthContext';
import { ChevronDown, LogOut, User } from 'lucide-react';

export function Topbar() {
  const { user, openAuth, logout } = useAuth();

  const initials = useMemo(() => {
    if (!user) return '';
    const parts = (user.name || user.email || '?').replace(/@.*/, '').split(/[\s._-]+/g).filter(Boolean);
    const [a, b] = [parts[0]?.[0] || 'C', parts[1]?.[0] || 'W'];
    return `${a}${b}`.toUpperCase();
  }, [user]);

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-card border border-border/60 rounded-xl relative z-10 w-full">
      {/* Brand */}
      <a href="#" className="flex items-center gap-2.5 text-inherit no-underline" aria-label="ColWrite home">
        <div className="w-7 h-7 rounded-md grid place-items-center bg-primary/90 text-white font-bold text-xs">
          CW
        </div>
        <div>
          <div className="font-semibold text-sm">ColWrite</div>
          <div className="text-xs text-muted-foreground">Assistant writer for arXiv papers</div>
        </div>
      </a>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {!user && (
          <Button size="sm" onClick={() => openAuth()}>
            Sign in
          </Button>
        )}
        
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 h-auto py-1.5 px-2">
                <div className="w-6 h-6 rounded-md bg-primary/90 text-white grid place-items-center font-bold text-xs">
                  {initials}
                </div>
                <div className="text-left hidden sm:block">
                  <div className="font-medium text-sm">{user.name || user.email?.split('@')[0]}</div>
                  <div className="text-[11px] text-muted-foreground">{user.email}</div>
                </div>
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Signed in as</span>
                  <span className="font-medium text-sm truncate">{user.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
