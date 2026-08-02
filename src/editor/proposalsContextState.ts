import { createContext, useContext } from 'react';
import type { ToolAction } from './types';
import type { ChangeSet, DocumentInvite, ProposedChange } from './proposals';

export type ProposalsContextValue = {
  sets: ChangeSet[];
  pending: ProposedChange[];
  pendingCount: number;
  invites: DocumentInvite[];
  /**
   * Take a streamed batch.
   *
   * `changes` are staged for review; `applied` were already committed
   * server-side and have just been replayed into the document. A redelivery
   * reports zero of both — the caller prints these numbers in the transcript.
   */
  receive: (action: ToolAction) => {
    changes: number;
    /** Ids of the staged changes, so a reply can point at its own work. */
    changeIds: string[];
    applied: number;
    invited: boolean;
  };
  accept: (changeId: string) => void;
  reject: (changeId: string) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  ready: (change: ProposedChange) => boolean;
  focusChange: (changeId: string) => void;
  focusedChangeId: string | null;
  dismissInvite: (inviteId: string) => void;
  error: string | null;
  clearError: () => void;
};

export const ProposalsContext = createContext<ProposalsContextValue | null>(null);

export function useProposals(): ProposalsContextValue {
  const context = useContext(ProposalsContext);
  if (!context) throw new Error('useProposals must be used within ProposalsProvider');
  return context;
}
