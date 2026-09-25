import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/auth/authContextState';
import { DocumentsMenu } from '@/components/editor/DocumentsMenu';
import { usePanels } from '@/components/panels/panelsContextState';
import { APP_NAME } from '@/components/common/Brand';
import { modifierLabel } from '../Shortcuts/shortcuts';
import { useView } from '../viewContextState';
import { useNewDocument } from '../useNewDocument';
import { useLeftSidebarAutoHidden, useSidebarDocked, useSidebarToggle } from '../useShellLayout';
import { useCompactMenus } from '../useCompactMenus';
import { sidebarHoverAction, sidebarRow } from './sidebarStyles';
import {
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Keyboard,
  LogOut,
  Monitor,
  Moon,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Sun,
  X,
} from 'lucide-react';

const APP_VERSION = 'v0.1 · alpha';

const APPEARANCE: ReadonlyArray<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

/** Two-letter monogram from a display name or email local-part. */
function initialsFor(nameOrEmail: string): string {
  const parts = nameOrEmail
    .replace(/@.*/, '')
    .split(/[\s._-]+/g)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? 'C';
  const second = parts[1]?.[0] ?? '';
  return `${first}${second}`.toUpperCase();
}

/**
 * Sidebar — the workspace: who you are, how to get around, your documents.
 *
 * Top to bottom, as in Notion: the account button (which replaced the global
 * header bar and its brand lockup), quick actions, the Documents section, and
 * quiet links to the Library and Settings. Page-level actions are not here;
 * they live on the page's own topbar.
 */
export function Sidebar({
  onOpenPalette,
  onShowShortcuts,
}: {
  onOpenPalette: () => void;
  onShowShortcuts: () => void;
}) {
  const { toggleLeftCollapsed, leftCollapsed, setMobileNavOpen, setTool, setAssistantOpen } = usePanels();
  const { setView } = useView();
  const docked = useSidebarDocked();
  // Collapsed, or stepping aside for the right sidebar: this copy is the
  // edge peek, and its chevron pins the sidebar open again.
  const autoHidden = useLeftSidebarAutoHidden();
  const hiddenNow = leftCollapsed || autoHidden;
  const sidebarToggle = useSidebarToggle();
  const newDocument = useNewDocument();
  const modifier = modifierLabel();

  // Anything that moves the author somewhere else also closes the drawer.
  const closeDrawer = () => {
    if (!docked) setMobileNavOpen(false);
  };
  const run = (action: () => void) => () => {
    closeDrawer();
    action();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="group/header flex h-11 shrink-0 items-center gap-1 px-2">
        <WorkspaceMenu
          onOpenSettings={run(() => setView('profile'))}
          onShowShortcuts={run(onShowShortcuts)}
        />
        {/* Collapsed to no width until wanted, so the workspace name gets
            the whole row at the default 240px. Still in the tab order: focus
            opens it like hover does. */}
        <div className="flex w-0 items-center gap-0.5 overflow-hidden opacity-0 transition-opacity focus-within:w-auto focus-within:overflow-visible focus-within:opacity-100 group-hover/header:w-auto group-hover/header:overflow-visible group-hover/header:opacity-100 pointer-coarse:w-auto pointer-coarse:overflow-visible pointer-coarse:opacity-100">
          {docked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(sidebarHoverAction, 'size-7')}
                  onClick={hiddenNow ? sidebarToggle.toggle : toggleLeftCollapsed}
                  aria-label={hiddenNow ? 'Keep sidebar open' : 'Close sidebar'}
                >
                  {hiddenNow ? <ChevronsRight aria-hidden="true" /> : <ChevronsLeft aria-hidden="true" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {hiddenNow ? 'Keep sidebar open' : 'Close sidebar'}
                <span className="ml-2 text-tooltip-foreground/60">{modifier}+\</span>
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              className={cn(sidebarHoverAction, 'size-7')}
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close sidebar"
            >
              <X aria-hidden="true" />
            </button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(sidebarHoverAction, 'size-7')}
                onClick={run(() => void newDocument.createDocument())}
                disabled={newDocument.disabled}
                aria-label="Create a new page"
              >
                <SquarePen aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Create a new page</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-px px-2 pb-2">
        <button type="button" className={cn(sidebarRow, 'group/row')} onClick={run(onOpenPalette)}>
          <Search aria-hidden="true" />
          <span className="flex-1 truncate">Search</span>
          <span
            aria-hidden="true"
            className="flex gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 pointer-coarse:hidden"
          >
            <Kbd>{modifier}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <button
          type="button"
          className={cn(sidebarRow, '[&>svg]:text-ai')}
          onClick={run(() => setAssistantOpen(true))}
        >
          <Sparkles aria-hidden="true" />
          <span className="flex-1 truncate">Ask AI</span>
        </button>
        <button
          type="button"
          className={sidebarRow}
          onClick={run(() => void newDocument.createDocument())}
          disabled={newDocument.disabled}
        >
          {newDocument.creating ? <Spinner className="size-[18px]" /> : <SquarePen aria-hidden="true" />}
          <span className="flex-1 truncate">New page</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <DocumentsMenu onDocumentCommitted={closeDrawer} />
      </div>

      <div className="flex shrink-0 flex-col gap-px border-t border-border px-2 py-2">
        <button type="button" className={sidebarRow} onClick={run(() => setTool('library'))}>
          <BookOpen aria-hidden="true" />
          <span className="flex-1 truncate">Library</span>
        </button>
        <button type="button" className={sidebarRow} onClick={run(() => setView('profile'))}>
          <Settings aria-hidden="true" />
          <span className="flex-1 truncate">Settings</span>
        </button>
      </div>
    </div>
  );
}

/**
 * The account button at the top of the sidebar and its menu: settings,
 * appearance, shortcuts and sign-out — everything the old header's account
 * chip and keyboard button held, in one place.
 */
function WorkspaceMenu({
  onOpenSettings,
  onShowShortcuts,
}: {
  onOpenSettings: () => void;
  onShowShortcuts: () => void;
}) {
  const { user, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const modifier = modifierLabel();
  // A side flyout has no room on a phone: the choices go inline instead.
  const compact = useCompactMenus();
  const appearanceChoices = (
    <DropdownMenuRadioGroup
      value={preference}
      onValueChange={(value) => setPreference(value as ThemePreference)}
    >
      {APPEARANCE.map(({ value, label, icon: Icon }) => (
        <DropdownMenuRadioItem
          key={value}
          value={value}
          indicator
          // Picking a theme inline keeps the menu open, so the change shows.
          onSelect={compact ? (event) => event.preventDefault() : undefined}
        >
          <Icon aria-hidden="true" />
          {label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );

  const displayName = user?.name || user?.email?.split('@')[0] || 'Account';
  const initials = useMemo(() => initialsFor(displayName), [displayName]);
  const firstName = displayName.split(/\s+/)[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-hover"
        aria-label="Account and workspace menu"
      >
        <span
          aria-hidden="true"
          className="grid size-[22px] shrink-0 place-items-center rounded-[5px] bg-tint-orange text-2xs font-semibold text-tint-orange-fg"
        >
          {initials}
        </span>
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {firstName}&rsquo;s workspace
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2.5 pb-2">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-md bg-tint-orange text-xs font-semibold text-tint-orange-fg"
          >
            {initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{displayName}</span>
            {user?.email && (
              <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
            )}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        {compact ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Appearance</DropdownMenuLabel>
            {appearanceChoices}
            <DropdownMenuSeparator />
          </>
        ) : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Sun aria-hidden="true" />
              Appearance
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44" collisionPadding={8}>
              {appearanceChoices}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuItem onSelect={onShowShortcuts}>
          <Keyboard aria-hidden="true" />
          Keyboard shortcuts
          <DropdownMenuShortcut>{modifier}+/</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="px-2 pb-1 pt-0.5 text-2xs text-muted-foreground">
          {APP_NAME} {APP_VERSION}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
