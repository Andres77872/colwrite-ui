import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useEditor } from '@/editor';
import { usePageSettings } from '@/editor/pageSettings';
import { useView } from '@/components/layout/viewContextState';
import { errorMessage } from '@/services/contracts';
import { getOverview, type UserOverview, type UserProfile } from '@/services/userProfile';
import { ActivityChart } from './ActivityChart';
import { DocumentsSection } from './DocumentsSection';
import { AccountPane } from './AccountPane';
import { StatTiles } from './StatTiles';
import { ToolUsageList } from './ToolUsageList';
import { UploadsSection } from './UploadsSection';
import { AgentEnginePreferences, AgentToolsPreferences } from '@/components/preferences';
import { takeRequestedSettingsPane } from './settingsPane';
import { BarChart3, FileText, RefreshCw, SlidersHorizontal, Sparkles, UserRound } from 'lucide-react';

const ACTIVITY_DAYS = 30;

const PANES = [
  { value: 'account', label: 'Account', icon: UserRound },
  { value: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { value: 'ai', label: 'AI & tools', icon: Sparkles },
  { value: 'usage', label: 'Usage', icon: BarChart3 },
  // Its documents and uploaded files; "Documents" alone repeated the
  // section heading right under the pane title.
  { value: 'documents', label: 'Documents & files', icon: FileText },
] as const;

/**
 * ProfileView — the body of the Settings dialog: a left nav of panes and one
 * flat, scrolling pane beside it.
 *
 * Everything here comes from ColWrite's own API rather than the auth service.
 * One `/users/me/overview` call backs the Account, Usage and Documents panes,
 * because each endpoint revalidates the session and a per-widget fetch would
 * pay that cost five times over to render the page once.
 */
export function ProfileView() {
  const { setView } = useView();
  const { documentId, loadingDocumentId, switchTo } = useEditor();

  // Read once, on mount: the dialog remounts this view each time it opens.
  const [initialPane] = useState(() => takeRequestedSettingsPane() ?? 'account');
  const [overview, setOverview] = useState<UserOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // Keep effect-driven loads on the asynchronous side of the boundary, the
    // same way the documents menu does; a button press still starts in the
    // same microtask.
    await Promise.resolve();
    setRefreshing(true);
    try {
      const next = await getOverview(ACTIVITY_DAYS);
      setOverview(next);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught, 'Could not load your profile'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openDocument = async (documentId: string) => {
    if (documentId === loadingDocumentId) return;
    try {
      const committed = await switchTo(documentId);
      if (committed) setView('workspace');
    } catch {
      // The editor emits the one shared load notice; keep settings open.
    }
  };

  const onProfileSaved = (profile: UserProfile) =>
    setOverview((previous) => (previous ? { ...previous, profile } : previous));

  const refreshButton = (
    <Button variant="ghost" size="sm" onClick={() => void load()} disabled={refreshing}>
      {refreshing ? <Spinner /> : <RefreshCw aria-hidden="true" />}
      {refreshing ? 'Refreshing…' : 'Refresh'}
    </Button>
  );

  /** Overview-backed panes share one loading and one failure state. */
  const withOverview = (render: (overview: UserOverview) => ReactNode) => (
    <>
      {error && <Alert variant="destructive">{error}</Alert>}
      {overview ? (
        render(overview)
      ) : (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3">
          {error ? (
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          ) : (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Loading your profile…
            </span>
          )}
        </div>
      )}
    </>
  );

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
            {withOverview((data) => (
              <AccountPane identity={data.identity} profile={data.profile} onSaved={onProfileSaved} />
            ))}
          </TabsContent>

          <TabsContent value="preferences" className="mt-0 flex flex-col gap-6">
            <PaneTitle title="Preferences" />
            <PreferencesPane />
          </TabsContent>

          {/* Force-mounted: an unsaved draft of tool choices must survive a
              look at another pane. */}
          <TabsContent value="ai" className="mt-0 flex flex-col gap-6" forceMount>
            {/* The preferences title the pane themselves ("AI & tools"). The
                engine choice leads it, and only exists on a local server. */}
            <AgentToolsPreferences leading={<AgentEnginePreferences />} />
          </TabsContent>

          <TabsContent value="usage" className="mt-0 flex flex-col gap-6">
            <PaneTitle title="Usage" action={refreshButton} />
            {withOverview((data) => (
              <>
                <StatTiles summary={data.summary} />
                <ActivityChart activity={data.activity} days={ACTIVITY_DAYS} />
                <ToolUsageList tools={data.tools} />
              </>
            ))}
          </TabsContent>

          <TabsContent value="documents" className="mt-0 flex flex-col gap-6">
            <PaneTitle title="Documents & files" action={refreshButton} />
            {/* No `key={generation}` remount here. Both sections reconcile a
                fresh first page against the pages they have already loaded
                (`usePagedList`), so Refresh updates the rows instead of
                throwing away everything the user paged in. */}
            {withOverview((data) => (
              <>
                <DocumentsSection
                  documents={data.documents}
                  totalKnown={data.summary.documents_active}
                  onOpen={(documentId) => void openDocument(documentId)}
                  currentDocumentId={documentId}
                  loadingDocumentId={loadingDocumentId}
                />
                <UploadsSection
                  uploads={data.resources}
                  totalKnown={data.summary.resources_active}
                  onChanged={() => void load()}
                />
              </>
            ))}
          </TabsContent>
        </div>
      </div>
    </Tabs>
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
