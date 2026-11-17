import { useMemo, useState, type ReactNode } from 'react';
import { loadDocumentId } from '@/editor/storage';
import {
  WorkspaceContext,
  WorkspaceScopeContext,
  type WorkspaceContextValue,
  type WorkspaceScopeValue,
} from '@/components/workspace/workspaceContextState';
import { PERSONAL_WORKSPACE_ID, catalogOf } from '@/dev/msw/fixtures';
import type { Workspace } from '@/data/workspaces';
import { AssistantCatalogContext, catalogValue } from '@/components/preferences/assistantCatalogContextState';

/** The workspace the tests run in: the mock API's personal workspace. */
export const TEST_WORKSPACE_ID = PERSONAL_WORKSPACE_ID;

const PERSONAL = {
  id: PERSONAL_WORKSPACE_ID,
  name: 'Personal',
  kind: 'personal',
  role: 'owner',
  icon: null,
  last_opened_at: null,
  member_count: 1,
} as const;

/**
 * What `WorkspaceProvider` and `WorkspaceScope` give the app, without their
 * reads: the personal workspace, the page the scope would open first
 * (`?doc=`, then the workspace's last page), and the assistant's catalog
 * there as the mock API computes it for the fixture account, the
 * workspace's policy and its role (`AssistantCatalogProvider` reads the same
 * from the mock). A test that needs the real choice renders `App`.
 */
export function TestWorkspace({
  children,
  initialDocumentId,
  switchWorkspace = async () => {},
  workspace = PERSONAL,
}: {
  children: ReactNode;
  /** The page to open; by default `?doc=`, then the workspace's last page. */
  initialDocumentId?: string | null;
  switchWorkspace?: WorkspaceContextValue['switchWorkspace'];
  /**
   * The workspace shown, by default the personal one. A test of another role
   * passes that workspace's row, and a new `role` to change it while mounted.
   */
  workspace?: Workspace;
}) {
  const [scope] = useState<WorkspaceScopeValue>(() => ({
    workspaceId: workspace.id,
    initialDocumentId: initialDocumentId !== undefined
      ? initialDocumentId
      : new URLSearchParams(window.location.search).get('doc') || loadDocumentId(workspace.id),
  }));
  const value = useMemo<WorkspaceContextValue>(
    () => ({ workspaces: workspace.id === PERSONAL.id ? [PERSONAL] : [PERSONAL, workspace], deleted: [], workspace, multiWorkspace: true, switchWorkspace }),
    [switchWorkspace, workspace],
  );
  const catalog = useMemo(() => catalogValue(catalogOf(workspace.id, 'gateway', workspace.role), false, null), [workspace.id, workspace.role]);
  return (
    <WorkspaceContext.Provider value={value}>
      <WorkspaceScopeContext.Provider value={scope}>
        <AssistantCatalogContext.Provider value={catalog}>{children}</AssistantCatalogContext.Provider>
      </WorkspaceScopeContext.Provider>
    </WorkspaceContext.Provider>
  );
}
