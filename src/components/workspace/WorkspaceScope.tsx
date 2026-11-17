import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { documentListQuery } from '@/data/documents';
import { workspaceQuery } from '@/data/workspaces';
import { loadDocumentId } from '@/editor/storage';
import { Spinner } from '@/components/ui/spinner';
import { usePendingDocument } from './pendingDocument';
import { WorkspaceScopeContext, useWorkspaceId, type WorkspaceScopeValue } from './workspaceContextState';

/**
 * Everything that belongs to one workspace, remounted when the workspace
 * changes (`docs/workspace_collection/08` §5.1). No page, undo history,
 * review state or chat selection survives a switch; the server data stays in
 * the query cache under the workspace's keys, which the switch drops.
 */
export function WorkspaceScope({ children }: { children: ReactNode }) {
  const workspaceId = useWorkspaceId();
  return (
    <Scope key={workspaceId} workspaceId={workspaceId}>
      {children}
    </Scope>
  );
}

/**
 * The page to open first, in the order of 08 §3.2: the one the choice named,
 * then the page this workspace last had open, then its most recently edited
 * page, then its local starter page. Only the third needs a list request, and
 * only when the workspace's page count says it has pages: an empty workspace
 * opens its first-run screen with no request beyond the workspace read.
 */
function Scope({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const pending = usePendingDocument();
  const [known] = useState(() => pending ?? loadDocumentId(workspaceId));
  const [chosen, setChosen] = useState<{ documentId: string | null } | null>(known ? { documentId: known } : null);

  useEffect(() => {
    if (chosen) return;
    let cancelled = false;
    void (async () => {
      let documentId: string | null = null;
      try {
        const workspace = await queryClient.fetchQuery(workspaceQuery(workspaceId));
        if (workspace.counts.pages > 0) {
          const latest = await queryClient.fetchQuery(
            documentListQuery(workspaceId, { limit: 1, sortBy: 'updated_at', sortOrder: 'desc' }),
          );
          documentId = latest.documents[0]?.id ?? null;
        }
      } catch {
        // The starter page opens; the first-run screen reads the workspace again.
      }
      if (!cancelled) setChosen({ documentId });
    })();
    return () => {
      cancelled = true;
    };
  }, [chosen, queryClient, workspaceId]);

  const value = useMemo<WorkspaceScopeValue | null>(
    () => (chosen ? { workspaceId, initialDocumentId: chosen.documentId } : null),
    [chosen, workspaceId],
  );

  if (!value) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground" aria-busy="true">
        <p className="flex items-center gap-2 text-sm">
          <Spinner />
          Loading your pages…
        </p>
      </div>
    );
  }
  return <WorkspaceScopeContext.Provider value={value}>{children}</WorkspaceScopeContext.Provider>;
}
