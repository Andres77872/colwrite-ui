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
import { usePanels } from '@/components/panels/panelsContext';
import { BrandMark, APP_NAME, APP_TAGLINE } from '@/components/common/Brand';
import { ChevronDown, LogOut, Menu, User } from 'lucide-react';

/** Two-letter monogram from a display name or email local-part. */
function initialsFor(nameOrEmail: string): string {
  const parts = nameOrEmail
    .replace(/@.*/, '')
    .split(/[\s._-]+/g)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? 'C';
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? 'W';
  return `${first}${second}`.toUpperCase();
}

export function Topbar() {
  const { user, logout } = useAuth();
  const { isDesktop, setMobileNavOpen } = usePanels();

  const initials = useMemo(
    () => (user ? initialsFor(user.name || user.email || '?') : ''),
    [user],
  );

  // App renders LandingPage when there is no user, so the topbar is only ever
  // shown to a signed-in account; a signed-out branch here would be dead code.
  if (!user) return null;

  const displayName = user.name || user.email?.split('@')[0] || 'Account';

  return (
    <div className="relative flex w-full items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-3 py-2 z-[var(--z-sticky)]">
      <div className="flex min-w-0 items-center gap-2">
        {!isDesktop && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}

        {/* Presentational lockup: there is no other page to navigate to, so
            this is deliberately not a link to `#`. */}
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandMark size="md" />
          <div className="min-w-0">
            <div className="text-base font-semibold leading-tight">{APP_NAME}</div>
            <div className="hidden truncate text-xs text-muted-foreground sm:block">
              {APP_TAGLINE}
            </div>
          </div>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto gap-2 px-2 py-1.5">
            <span
              aria-hidden="true"
              className="grid h-6 w-6 place-items-center rounded-md bg-secondary text-2xs font-bold text-secondary-foreground"
            >
              {initials}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block text-sm font-medium leading-tight">{displayName}</span>
              {user.email && (
                <span className="block text-2xs leading-tight text-muted-foreground">
                  {user.email}
                </span>
              )}
            </span>
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 opacity-50" />
            <span className="sr-only">Account menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <span className="block text-xs font-normal text-muted-foreground">Signed in as</span>
            <span className="block truncate text-sm font-medium">{user.email || displayName}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            <User aria-hidden="true" className="mr-2 h-4 w-4" />
            Profile
            <span className="ml-auto text-2xs text-muted-foreground">Soon</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
            <LogOut aria-hidden="true" className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
