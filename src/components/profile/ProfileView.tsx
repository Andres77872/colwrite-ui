import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
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
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';

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
  const { switchTo } = useEditor();
  const { toast } = useToast();

  const [overview, setOverview] = useState<UserOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped on every successful load and used as the list sections' key. Those
  // sections seed paging state from their props, and React keeps that state
  // across a prop change — without this, Refresh updated the tiles and the
  // chart while the documents and uploads lists kept showing the old fetch.
  const [generation, setGeneration] = useState(0);

  const load = useCallback(async () => {
    // Keep effect-driven loads on the asynchronous side of the boundary, the
    // same way the documents menu does; a button press still starts in the
    // same microtask.
    await Promise.resolve();
    setRefreshing(true);
    try {
      const next = await getOverview(ACTIVITY_DAYS);
      setOverview(next);
      setGeneration((previous) => previous + 1);
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
    try {
      await switchTo(documentId);
      setView('workspace');
    } catch (caught) {
      toast({
        title: 'Could not open the document',
        description: errorMessage(caught, 'Request failed'),
        variant: 'error',
      });
    }
  };

  const onProfileSaved = (profile: UserProfile) =>
    setOverview((previous) => (previous ? { ...previous, profile } : previous));

  if (!overview) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
        {error ? (
          <>
            <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
              {error}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setView('workspace')}>
                Back to editor
              </Button>
            </div>
          </>
        ) : (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Loading your profile…
          </span>
        )}
      </div>
    );
  }

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

        {error && (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
        )}

        <ProfileHeader
          identity={overview.identity}
          profile={overview.profile}
          onSaved={onProfileSaved}
        />

        <StatTiles summary={overview.summary} />

        <ActivityChart activity={overview.activity} days={ACTIVITY_DAYS} />

        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <DocumentsSection
            key={`documents-${generation}`}
            documents={overview.documents}
            totalKnown={overview.summary.documents_active}
            onOpen={(documentId) => void openDocument(documentId)}
          />
          <ToolUsageList tools={overview.tools} />
        </div>

        <UploadsSection
          key={`uploads-${generation}`}
          uploads={overview.uploads}
          totalKnown={overview.summary.uploads_active}
          onChanged={() => void load()}
        />
      </div>
    </div>
  );
}
