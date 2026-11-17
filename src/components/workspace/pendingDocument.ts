import { createContext, useContext } from 'react';

/**
 * The page the workspace choice named (`?doc=`, or a switch that opens a
 * page), read once by `WorkspaceScope` when it mounts.
 */
export const PendingDocumentContext = createContext<string | null>(null);

export function usePendingDocument(): string | null {
  return useContext(PendingDocumentContext);
}
