import { createContext, useContext } from 'react';
import type { DeletedWorkspace, Workspace } from '@/data/workspaces';

/** How a switch came about: following a link says where it went ("Opened in ‹workspace›"). */
export type SwitchOptions = {
  /** The page to open there; otherwise the workspace's last page, or its newest. */
  documentId?: string | null;
  reason?: 'link';
};

/**
 * The workspace the app is showing, and how to leave it for another
 * (`docs/workspace_collection/08` §5).
 *
 * The id comes only from here: no request takes a workspace id from a stored
 * record or a model's output. Everything below `WorkspaceScope` is remounted
 * when it changes, so a component there reads one id for its whole life.
 */
export type WorkspaceContextValue = {
  /** The account's workspaces, as `GET /workspaces` listed them: most recently opened first. */
  workspaces: readonly Workspace[];
  /** The deleted shared workspaces the account owns and can still restore. */
  deleted: readonly DeletedWorkspace[];
  /** The one being shown. */
  workspace: Workspace;
  /** The account may create more than its personal workspace. */
  multiWorkspace: boolean;
  /**
   * Show another workspace: the open page's edits are saved (or kept on
   * this device) first, then the old workspace's queries are dropped and the
   * scope remounts. The address is pushed, so Back returns.
   */
  switchWorkspace: (workspaceId: string, options?: SwitchOptions) => Promise<void>;
};

/** What the app says when a workspace it was asked for is not one the account can open (14 §4). */
export const WORKSPACE_UNAVAILABLE = {
  title: 'This workspace isn’t available',
  description: 'It may have been deleted, or you may not have access.',
} as const;

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return value;
}

/** The id of the workspace being shown. */
export function useWorkspaceId(): string {
  return useWorkspace().workspace.id;
}

/** The page the scope opens first, chosen before the editor mounts. */
export type WorkspaceScopeValue = {
  workspaceId: string;
  initialDocumentId: string | null;
};

export const WorkspaceScopeContext = createContext<WorkspaceScopeValue | null>(null);

export function useWorkspaceScope(): WorkspaceScopeValue {
  const value = useContext(WorkspaceScopeContext);
  if (!value) throw new Error('useWorkspaceScope must be used within WorkspaceScope');
  return value;
}
