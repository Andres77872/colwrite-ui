import { createContext, useContext } from 'react';
import type { ToolAction } from './types';
import type { ChangeSet, DocumentInvite, ProposedChange } from './proposals';

/** How a turn hands over its `tool_action`s. */
export type ReceiveOptions = {
  /**
   * Whether the turn's chat has Auto on, asked when a stored set has been
   * read. Only a set the server stored as `apply_policy: "auto"` is applied,
   * and only while this says yes; one that arrives after Auto was turned off
   * waits for the author (D18).
   */
  autoApply?: () => boolean;
};

/**
 * What the editor applied of a change set in an Auto turn, as one undo step:
 * the set as it arrived, or later a change the caret held, once the caret
 * left its block.
 */
export type AutoAppliedSet = {
  /** This step. */
  id: string;
  changeSetId: string;
  /** Changes the editor applied in this step. */
  applied: number;
  /**
   * The set's changes still waiting for the author, under its newest step
   * only: written against text changed since, in the block with the caret,
   * in a locked or hidden block, or with nowhere to land.
   */
  heldIds: string[];
  /**
   * Whether Undo can take it back now: it is the newest step in the undo
   * journal, because the page is still exactly as it left it.
   */
  canUndo: boolean;
  /** Taken back with the chat's Undo, and not redone since. */
  undone: boolean;
};

export type ProposalsContextValue = {
  sets: ChangeSet[];
  pending: ProposedChange[];
  pendingCount: number;
  invites: DocumentInvite[];
  /**
   * Take a streamed `tool_action`.
   *
   * `changes` is the size of the change set it names, which is staged for
   * review, or applied for an Auto turn, once it has been read (see
   * `autoApplied`). A redelivery reports zero — the caller prints these
   * numbers in the transcript.
   */
  receive: (action: ToolAction, options?: ReceiveOptions) => {
    changes: number;
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
  /** The steps applied in Auto turns on this page, oldest first. */
  autoApplied: AutoAppliedSet[];
  /** Undo one of them, if it is still the newest step. Returns whether it was undone. */
  undoAutoApplied: (id: string) => boolean;
  /** Show one of them in the page. */
  revealAutoApplied: (id: string) => void;
  /**
   * Pending changes from Auto turns that were not applied: the page was
   * closed when they arrived, or Auto had been turned off.
   */
  waiting: ProposedChange[];
  /** Apply the waiting changes as one undo step ("Apply all"). */
  applyWaiting: () => void;
};

export const ProposalsContext = createContext<ProposalsContextValue | null>(null);

export function useProposals(): ProposalsContextValue {
  const context = useContext(ProposalsContext);
  if (!context) throw new Error('useProposals must be used within ProposalsProvider');
  return context;
}
