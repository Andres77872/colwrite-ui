import { useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { usePageSettings } from '@/editor/pageSettings';
import { useView } from '@/components/layout/viewContextState';
import { usePanels } from '@/components/panels/panelsContextState';
import { errorMessage } from '@/api/errors';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { meQuery } from '@/data/userProfile';
import { accountUsageQuery, workspaceUsageQuery } from '@/data/workspaces';
import { useWorkspace } from '@/components/workspace/workspaceContextState';
import { ActivityChart } from './ActivityChart';
import { AccountPane } from './AccountPane';
import { PageActivityTable } from './PageActivityTable';
import { StatTiles } from './StatTiles';
import { StorageSummary } from './StorageSummary';
import { ToolUsageList } from './ToolUsageList';
import { WorkspacePane } from './WorkspacePane';
import { MembersPane } from './MembersPane';
import { WorkspaceUsageTable } from './WorkspaceUsageTable';
import { AgentEnginePreferences, AgentToolsPreferences } from '@/components/preferences';
import { takeRequestedSettingsPane, type SettingsPane } from './settingsPane';
import { BarChart3, Layers, RefreshCw, SlidersHorizontal, Sparkles, UserRound, Users, type LucideIcon } from 'lucide-react';

const ACTIVITY_DAYS = 30;

/**
 * The panes, in order. Pages and PDFs have no pane: pages are managed in the
 * sidebar and PDFs in the Library, so Settings keeps only their usage.
 */
const PANES: ReadonlyArray<{ value: SettingsPane; label: string; icon: LucideIcon }> = [
  { value: 'account', label: 'Account', icon: UserRound },
  { value: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { value: 'ai', label: 'AI & tools', icon: Sparkles },
  { value: 'workspace', label: 'Workspace', icon: Layers },
  { value: 'members', label: 'Members', icon: Users },
  { value: 'usage', label: 'Usage', icon: BarChart3 },
];

/** What Usage counts: the workspace being shown (the default), or every workspace of the account. */
type UsageScope = 'workspace' | 'all';

/**
 * ProfileView — the body of the Settings dialog: a left nav of panes and one
 * flat, scrolling pane beside it.
 *
 * Everything here comes from ColWrite's own API rather than the auth service:
 * Account reads the person (`GET /users/me`), Workspace the workspace being
 * shown (`GET /workspaces/{w}`), Members its members and invitations
 * (`GET /workspaces/{w}/members`, `…/invitations`), and Usage that workspace
 * (`GET /workspaces/{w}/usage`) or, switched to "All workspaces", every
 * workspace of the account (`GET /users/me/usage`), each in one request.
 */
export function ProfileView() {
  const { setView } = useView();
  const { setTool } = usePanels();

  // Read once, on mount: the dialog remounts this view each time it opens.
  const [initialPane] = useState(() => takeRequestedSettingsPane() ?? 'account');
  const { workspace } = useWorkspace();
  const workspaceId = workspace.id;
  const [usageScope, setUsageScope] = useState<UsageScope>('workspace');
  const me = useQuery(meQuery());
  const usage = useQuery({ ...workspaceUsageQuery(workspaceId, ACTIVITY_DAYS), enabled: usageScope === 'workspace' });
  const allUsage = useQuery({ ...accountUsageQuery(ACTIVITY_DAYS), enabled: usageScope === 'all' });
  const shownUsage = usageScope === 'workspace' ? usage : allUsage;
  const refreshing = me.isFetching || shownUsage.isFetching;
  const refreshUsage = () => void shownUsage.refetch();

  // Settings closes first: the Library is a tab of the right sidebar, behind
  // this dialog.
  const openLibrary = () => {
    setView('editor');
    setTool('library');
  };

  const refreshButton = (
    <Button variant="ghost" size="sm" onClick={refreshUsage} disabled={shownUsage.isFetching}>
      {shownUsage.isFetching ? <Spinner /> : <RefreshCw aria-hidden="true" />}
      {shownUsage.isFetching ? 'Refreshing…' : 'Refresh'}
    </Button>
  );

  /** A pane backed by one read: its loading state, its failure and a retry. */
  const withData = <T,>(
    read: UseQueryResult<T>,
    labels: { loading: string; failed: string },
    render: (data: T) => ReactNode,
  ) => {
    const error = read.isError ? errorMessage(read.error, labels.failed) : null;
    return (
      <>
        {error && <Alert variant="destructive">{error}</Alert>}
        {read.data ? (
          render(read.data)
        ) : (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3">
            {error ? (
              <Button variant="outline" size="sm" onClick={() => void read.refetch()}>
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
            ) : (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                {labels.loading}
              </span>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <Tabs
      defaultValue={initialPane}
      orientation="vertical"
      className="flex min-h-0 flex-1 max-sm:flex-col"
    >
      <div className="flex shrink-0 flex-col gap-2 bg-sidebar p-2 sm:w-56 sm:border-r sm:border-border max-sm:border-b max-sm:border-border max-sm:pr-11">
        <p className="px-2 pt-1.5 text-xs font-medium text-muted-foreground max-sm:hidden">Settings</p>
        {/* On a phone the panes are a row that scrolls sideways, clear of the
            close button, fading out at its end so it reads as scrollable. */}
        <TabsList className="h-auto flex-col items-stretch gap-px max-sm:flex-row max-sm:overflow-x-auto max-sm:pr-6 max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-2rem),transparent)] max-sm:[scrollbar-width:none]">
          {PANES.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-[30px] justify-start gap-2 px-2 font-normal text-sidebar-foreground data-[state=active]:font-medium [&_svg]:size-[18px] [&_svg]:text-muted-foreground max-sm:shrink-0"
            >
              <Icon aria-hidden="true" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* The pane scrolls as one column; sections never nest their own
          scrollbars except the activity table, which is explicitly capped. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto" aria-busy={refreshing}>
        <div className="mx-auto w-full max-w-3xl px-5 pb-8 pt-6 sm:px-10 sm:pt-9">
          <TabsContent value="account" className="mt-0 flex flex-col gap-6">
            <PaneTitle title="Account" />
            {withData(me, { loading: 'Loading your profile…', failed: 'Could not load your profile' }, (data) => (
              <AccountPane identity={data.identity} profile={data.profile} />
            ))}
          </TabsContent>

          <TabsContent value="preferences" className="mt-0 flex flex-col gap-6">
            <PaneTitle title="Preferences" />
            <PreferencesPane />
          </TabsContent>

          {/* Force-mounted, so the pane keeps its loaded state (and a row's
              "could not save" note) across a look at another pane. */}
          <TabsContent value="ai" className="mt-0 flex flex-col gap-6" forceMount>
            {/* Model choices lead AI & tools on every server; local engine
                controls are offered only when the server supports them. */}
            <AgentToolsPreferences leading={<AgentEnginePreferences />} />
          </TabsContent>

          <TabsContent value="workspace" className="mt-0 flex flex-col gap-6">
            <PaneTitle title="Workspace" />
            <WorkspacePane />
          </TabsContent>

          <TabsContent value="members" className="mt-0 flex flex-col gap-6">
            <PaneTitle title="Members" />
            <MembersPane />
          </TabsContent>

          <TabsContent value="usage" className="mt-0 flex flex-col gap-6">
            <PaneTitle title="Usage" action={refreshButton} />
            <UsageScopeSwitch scope={usageScope} onChange={setUsageScope} workspaceName={workspace.name} />
            {usageScope === 'workspace'
              ? withData(usage, { loading: 'Loading the usage…', failed: 'Could not load the usage' }, (data) => (
                  <>
                    <StatTiles summary={data.summary} />
                    <ActivityChart activity={data.activity} days={ACTIVITY_DAYS} />
                    <PageActivityTable pages={data.pages} totalPages={data.summary.documents_active} />
                    <ToolUsageList tools={data.tools} />
                    <StorageSummary summary={data.summary} onOpenLibrary={openLibrary} />
                  </>
                ))
              : withData(allUsage, { loading: 'Loading the usage…', failed: 'Could not load the usage' }, (data) => (
                  <>
                    <StatTiles summary={data.summary} />
                    <ActivityChart activity={data.activity} days={ACTIVITY_DAYS} />
                    <WorkspaceUsageTable workspaces={data.workspaces} />
                    <ToolUsageList tools={data.tools} />
                    <StorageSummary summary={data.summary} onOpenLibrary={openLibrary} />
                  </>
                ))}
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}

/**
 * "This workspace" (the default) or "All workspaces": a radio group of two,
 * one tab stop, arrows move between them.
 */
function UsageScopeSwitch({
  scope,
  onChange,
  workspaceName,
}: {
  scope: UsageScope;
  onChange: (scope: UsageScope) => void;
  workspaceName: string;
}) {
  const options: ReadonlyArray<{ value: UsageScope; label: string }> = [
    { value: 'workspace', label: 'This workspace' },
    { value: 'all', label: 'All workspaces' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="radiogroup" aria-label="Usage of" className="inline-flex rounded-md bg-subtle p-0.5">
        {options.map((option, index) => {
          const checked = scope === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                event.preventDefault();
                const next = options[(index + 1) % options.length];
                if (!next) return;
                onChange(next.value);
                (event.currentTarget.parentElement?.children[(index + 1) % options.length] as HTMLElement | undefined)?.focus();
              }}
              className={cn(
                'h-7 rounded-[5px] px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                checked ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {scope === 'workspace' ? `Counting ${workspaceName} only.` : 'Counting every workspace you are in.'}
      </p>
    </div>
  );
}

function PaneTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {action}
    </div>
  );
}

const APPEARANCE: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'Use system setting' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Appearance and the page defaults, applied at once and kept on this device. */
function PreferencesPane() {
  const { preference, setPreference } = useTheme();
  const page = usePageSettings();

  return (
    <div className="flex flex-col divide-y divide-border border-y border-border">
      <SettingRow
        id="setting-appearance"
        title="Appearance"
        description="Follow the system, or keep ColWrite light or dark on this device."
        stackOnPhone
      >
        <NativeSelect
          id="setting-appearance"
          className="w-full sm:w-48"
          value={preference}
          onChange={(event) => setPreference(event.target.value as ThemePreference)}
        >
          {APPEARANCE.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </SettingRow>
      <SettingRow
        id="setting-full-width"
        title="Full width"
        description="Let the text use the whole page instead of a reading column."
      >
        <Switch
          id="setting-full-width"
          checked={page.fullWidth}
          onCheckedChange={(fullWidth) => page.set({ fullWidth })}
        />
      </SettingRow>
      <SettingRow
        id="setting-small-text"
        title="Small text"
        description="Set the page body at 14px instead of 16px."
      >
        <Switch
          id="setting-small-text"
          checked={page.smallText}
          onCheckedChange={(smallText) => page.set({ smallText })}
        />
      </SettingRow>
    </div>
  );
}

function SettingRow({
  id,
  title,
  description,
  stackOnPhone = false,
  children,
}: {
  id: string;
  title: string;
  description: string;
  stackOnPhone?: boolean;
  children: ReactNode;
}) {
  return (
    // A wide control (a select) goes under its label on a phone, so the
    // description keeps the full width instead of wrapping into a narrow
    // column; a switch stays on the right.
    <div
      className={cn(
        'flex items-center justify-between gap-6 py-4',
        stackOnPhone && 'max-sm:flex-col max-sm:items-stretch max-sm:gap-2.5',
      )}
    >
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {title}
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
