import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEditor } from '@/editor';
import { useView } from '@/components/layout/viewContextState';
import { errorMessage } from '@/services/contracts';
import { getOverview, type UserOverview, type UserProfile } from '@/services/userProfile';
import { ActivityChart } from './ActivityChart';
import { DocumentsSection } from './DocumentsSection';
import { ProfileHeader } from './ProfileHeader';
import { StatTiles } from './StatTiles';
import { ToolUsageList } from './ToolUsageList';
import { UploadsSection } from './UploadsSection';
import { AgentToolsPreferences } from '@/components/preferences';
import { ArrowLeft, LayoutDashboard, RefreshCw, SlidersHorizontal } from 'lucide-react';

const ACTIVITY_DAYS = 30;

/**
 * ProfileView — the account dashboard.
 *
 * Everything here comes from ColWrite's own API rather than the auth service:
 * the profile record, the usage history, the documents, and the uploads. One
 * `/users/me/overview` call backs the whole page, because each endpoint
 * revalidates the session and a per-widget fetch would pay that cost five
 * times over to render it once.
 */
export function ProfileView() {
  const { setView } = useView();
  const { documentId, loadingDocumentId, switchTo } = useEditor();

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
      // The editor emits the one shared load notice; keep the profile visible.
    }
  };

  const onProfileSaved = (profile: UserProfile) =>
    setOverview((previous) => (previous ? { ...previous, profile } : previous));

  return (
    // The whole page scrolls as one column; sections never nest their own
    // scrollbars except the activity table, which is explicitly capped.
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      // Hold the previous render while refetching rather than flashing a
      // skeleton over content that is about to look almost identical.
      aria-busy={refreshing}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setView('workspace')}>
            <ArrowLeft aria-hidden="true" />
            Back to editor
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={refreshing}
          >
            {refreshing ? <Spinner /> : <RefreshCw aria-hidden="true" />}
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        <Tabs defaultValue="overview" className="flex flex-col gap-2">
          <TabsList className="w-fit">
            <TabsTrigger value="overview" className="gap-1.5">
              <LayoutDashboard aria-hidden="true" className="h-3.5 w-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="agent-tools" className="gap-1.5">
              <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
              Agent tools
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0 flex flex-col gap-4">
            {error && <Alert variant="destructive">{error}</Alert>}
            {!overview ? (
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
            ) : (
              <>
                <ProfileHeader
                  identity={overview.identity}
                  profile={overview.profile}
                  onSaved={onProfileSaved}
                />

                <StatTiles summary={overview.summary} />

                <ActivityChart activity={overview.activity} days={ACTIVITY_DAYS} />

                {/* No `key={generation}` remount here any more. Both sections reconcile
                    a fresh first page against the pages they have already loaded
                    (`usePagedList`), so Refresh updates the rows instead of throwing
                    away everything the user paged in. */}
                <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                  <DocumentsSection
                    documents={overview.documents}
                    totalKnown={overview.summary.documents_active}
                    onOpen={(documentId) => void openDocument(documentId)}
                    currentDocumentId={documentId}
                    loadingDocumentId={loadingDocumentId}
                  />
                  <ToolUsageList tools={overview.tools} />
                </div>

                <UploadsSection
                  uploads={overview.resources}
                  totalKnown={overview.summary.resources_active}
                  onChanged={() => void load()}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="agent-tools" className="mt-0" forceMount>
            <AgentToolsPreferences />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
