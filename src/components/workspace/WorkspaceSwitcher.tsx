import { useRef, useState } from 'react';
import { ChevronsUpDown, Keyboard, LogOut, Monitor, Moon, Plus, Settings, Sun, UserPlus, Users } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
import { APP_NAME } from '@/components/common/Brand';
import { modifierLabel } from '@/components/layout/Shortcuts/shortcuts';
import { useCompactMenus } from '@/components/layout/useCompactMenus';
import { useView } from '@/components/layout/viewContextState';
import { requestSettingsPane } from '@/components/profile/settingsPane';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { useWorkspace } from './workspaceContextState';
import { WorkspaceIcon } from './WorkspaceIcon';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { accessOf, workspaceBadge } from './workspaceAccess';
import { InviteDialog } from '@/components/profile/InviteDialog';

const APP_VERSION = 'v0.1 · alpha';

const APPEARANCE: ReadonlyArray<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

/**
 * The workspace and account menu at the top of the sidebar (08 §6.7, 14
 * §3.1): the workspace's icon and name, and a menu of the account's
 * workspaces as radio items (the one shown is checked and announced so),
 * "New workspace…", "Workspace settings", "Members" (and "Invite people…"
 * for an admin of a shared workspace), then what the account menu held
 * (appearance, shortcuts, sign-out). Each workspace says "Shared" when
 * someone else is in it, and the account's role there unless it owns it.
 * Picking a workspace switches to it the way every switch goes: the open
 * page is saved first.
 */
export function WorkspaceSwitcher({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const { user, logout } = useAuth();
  const { workspace, workspaces, multiWorkspace, switchWorkspace } = useWorkspace();
  const { setView } = useView();
  const { preference, setPreference } = useTheme();
  const modifier = modifierLabel();
  // A side flyout has no room on a phone: the choices go inline instead.
  const compact = useCompactMenus();
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const access = accessOf(workspace.role);
  const shownBadge = workspaceBadge(workspace);

  const displayName = user?.name || user?.email?.split('@')[0] || 'Account';

  const appearanceChoices = (
    <DropdownMenuRadioGroup value={preference} onValueChange={(value) => setPreference(value as ThemePreference)}>
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

  const openSettings = (pane: 'workspace' | 'members') => {
    requestSettingsPane(pane);
    setView('settings');
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-hover"
          aria-label={`Workspace and account menu, ${workspace.name}${shownBadge ? `, ${shownBadge}` : ''}`}
        >
          <WorkspaceIcon workspace={workspace} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{workspace.name}</span>
          <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={workspace.id}
            onValueChange={(id) => {
              if (id !== workspace.id) void switchWorkspace(id);
            }}
          >
            {workspaces.map((item) => {
              const badge = workspaceBadge(item);
              return (
                <DropdownMenuRadioItem key={item.id} value={item.id} indicator className="gap-2">
                  <WorkspaceIcon workspace={item} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {badge && (
                    <span className="shrink-0 rounded-sm bg-subtle px-1.5 text-2xs text-muted-foreground">
                      {badge}
                    </span>
                  )}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
          <DropdownMenuGroup>
            {multiWorkspace && (
              <DropdownMenuItem onSelect={() => setCreating(true)}>
                <Plus aria-hidden="true" />
                New workspace…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => openSettings('workspace')}>
              <Settings aria-hidden="true" />
              Workspace settings
            </DropdownMenuItem>
            {workspace.kind === 'shared' && (
              <DropdownMenuItem onSelect={() => openSettings('members')}>
                <Users aria-hidden="true" />
                Members
              </DropdownMenuItem>
            )}
            {workspace.kind === 'shared' && access.isAdmin && (
              <DropdownMenuItem onSelect={() => setInviting(true)}>
                <UserPlus aria-hidden="true" />
                Invite people…
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="pb-1.5">
            <span className="block truncate text-sm font-medium text-foreground">{displayName}</span>
            {user?.email && <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>}
          </DropdownMenuLabel>
          {compact ? (
            <>
              <DropdownMenuLabel>Appearance</DropdownMenuLabel>
              {appearanceChoices}
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
      {creating && <CreateWorkspaceDialog open onOpenChange={setCreating} returnFocusRef={triggerRef} />}
      {inviting && <InviteDialog workspaceId={workspace.id} workspaceName={workspace.name} onClose={() => setInviting(false)} />}
    </>
  );
}
