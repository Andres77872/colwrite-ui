import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useEditor } from './editorContextState';
import type { ToolOperation } from './types';
import {
  buildChangeSet,
  isReady,
  pendingChanges,
  type ChangeSet,
  type DocumentInvite,
  type ProposedChange,
} from './proposals';
import { uid } from '../lib/uid';
import { ProposalsContext, type ProposalsContextValue } from './proposalsContextState';
export type { ProposalsContextValue } from './proposalsContextState';

type DocumentProposalsState = {
  documentId: string | null;
  sets: ChangeSet[];
  invites: DocumentInvite[];
  focusedChangeId: string | null;
  error: string | null;
};

function emptyState(documentId: string | null): DocumentProposalsState {
  return {
    documentId,
    sets: [],
    invites: [],
    focusedChangeId: null,
    error: null,
  };
}

/**
 * Holds the agent's proposed edits until the author decides on them.
 *
 * The assistant does not apply anything. `doc_edit` stages operations
 * server-side and streams them here; the document renders each one in place
 * with accept and reject controls, and only an accept writes to the editor
 * state that autosave persists. That keeps the decision where the author can
 * see its consequences — on the paragraph — instead of behind a summary in a
 * chat bubble.
 */
export function ProposalsProvider({ children }: { children: ReactNode }) {
  const {
    documentId,
    applyPatch,
    adoptServerVersion,
    markRecentlyChanged,
  } = useEditor();
  const ownerDocumentId = documentId;
  const activeDocumentIdRef = useRef(ownerDocumentId);

  // Keep one mounted provider while making its value document-scoped. The
  // render-phase reset is conditional on the identity mismatch, which React
  // resolves before committing descendants. They never observe the previous
  // document's review state.
  const resetState = useMemo(() => emptyState(ownerDocumentId), [ownerDocumentId]);
  const [storedState, setStoredState] = useState<DocumentProposalsState>(() => resetState);
  const needsReset = storedState.documentId !== ownerDocumentId;
  if (needsReset) setStoredState(resetState);
  const state = needsReset ? resetState : storedState;

  useLayoutEffect(() => {
    activeDocumentIdRef.current = ownerDocumentId;
  }, [ownerDocumentId]);

  /**
   * Every public callback captures the document it was created for. A stream,
   * timer, or event handler can retain that callback after navigation; checking
   * both the live identity and the tagged state makes such updates harmless.
   */
  const updateForDocument = useCallback(
    (update: (current: DocumentProposalsState) => DocumentProposalsState): boolean => {
      if (activeDocumentIdRef.current !== ownerDocumentId) return false;
      setStoredState((current) => {
        if (activeDocumentIdRef.current !== ownerDocumentId) return current;
        const owned = current.documentId === ownerDocumentId
          ? current
          : emptyState(ownerDocumentId);
        return update(owned);
      });
      return true;
    },
    [ownerDocumentId],
  );

  const receive = useCallback<ProposalsContextValue['receive']>((action) => {
    if (activeDocumentIdRef.current !== ownerDocumentId) {
      return { changes: 0, invited: false };
    }

    const createOp = action.actions.find(
      (op): op is Extract<ToolOperation, { op: 'create_document' }> =>
        op.op === 'create_document',
    );
    const invited = createOp !== undefined;

    /**
     * A `tool_action` names the document it was produced against, and that is
     * not always this one. `doc_create` names the document it just made — by
     * definition a different id — and its whole payload is the announcement.
     * Anything else carrying a foreign id is a stray event from a run against
     * another document, whose operations must never be staged here.
     *
     * So the two halves are scoped separately: block operations require an
     * exact match, invitations do not.
     */
    const targetsThisDocument =
      ownerDocumentId !== null && action.documentId === ownerDocumentId;
    const set = targetsThisDocument ? buildChangeSet(action) : null;

    updateForDocument((current) => {
      let invites = current.invites;
      if (
        createOp
        && createOp.documentId
        && createOp.documentId !== ownerDocumentId
        && !invites.some((invite) => invite.documentId === createOp.documentId)
      ) {
        invites = [
          ...invites,
          { id: uid(), documentId: createOp.documentId, receivedAt: Date.now() },
        ];
      }

      let error = current.error;
      if (action.status === 'error' && (targetsThisDocument || invited)) {
        error = action.message || 'The assistant could not prepare that edit.';
      }

      if (!set || action.status === 'applied' || set.changes.length === 0) {
        return invites === current.invites && error === current.error
          ? current
          : { ...current, invites, error };
      }

      // Some providers number tool calls per request (call_0, call_1…), so the
      // id alone repeats across runs. Only identical operations are a
      // redelivery.
      const signature = JSON.stringify(set.changes.map((change) => change.op));
      const duplicate = current.sets.some(
        (existing) =>
          existing.toolCallId === set.toolCallId
          && JSON.stringify(existing.changes.map((change) => change.op)) === signature,
      );

      return {
        ...current,
        invites,
        error,
        sets: duplicate ? current.sets : [...current.sets, set],
        focusedChangeId:
          duplicate
            ? current.focusedChangeId
            : current.focusedChangeId ?? set.changes[0].id,
      };
    });

    // A server running in `auto` apply mode has already committed; replaying
    // it as a proposal would ask the author to approve something already saved.
    if (set && action.status === 'applied' && set.changes.length > 0) {
      if (activeDocumentIdRef.current !== ownerDocumentId) {
        return { changes: 0, invited };
      }
      const { desynced, touched } = applyPatch(
        set.changes.map((change) => change.op),
        { persist: false },
      );
      adoptServerVersion(action.version);
      markRecentlyChanged(touched);
      if (desynced.length > 0) {
        updateForDocument((current) => ({
          ...current,
          error:
            'Some of the assistant’s changes could not be shown here. Reload the document to see the saved version.',
        }));
      }
      return { changes: 0, invited };
    }

    return { changes: set?.changes.length ?? 0, invited };
  }, [
    adoptServerVersion,
    applyPatch,
    markRecentlyChanged,
    ownerDocumentId,
    updateForDocument,
  ]);

  const settle = useCallback(
    (changeId: string, status: 'accepted' | 'rejected') => {
      if (activeDocumentIdRef.current !== ownerDocumentId) return;
      const target = pendingChanges(state.sets).find((change) => change.id === changeId);
      if (!target) return;

      // Rejecting a change discards everything built on top of it in the same
      // batch — those operations reference a block that will never exist.
      const discarded = new Set<string>();
      if (status === 'rejected') {
        const queue = [changeId];
        while (queue.length) {
          const currentId = queue.pop()!;
          for (const set of state.sets) {
            for (const change of set.changes) {
              if (
                change.status === 'pending'
                && !discarded.has(change.id)
                && change.dependsOn.includes(currentId)
              ) {
                discarded.add(change.id);
                queue.push(change.id);
              }
            }
          }
        }
      }

      let applyError: string | null = null;
      if (status === 'accepted') {
        const { desynced, touched } = applyPatch([target.op], { persist: true });
        markRecentlyChanged(touched);
        if (desynced.length > 0) {
          applyError =
            'That change referred to a part of the document that is no longer there, so it was not applied.';
        }
      }

      updateForDocument((current) => ({
        ...current,
        error: applyError ?? current.error,
        sets: current.sets
          .map((set) => ({
            ...set,
            changes: set.changes.map((change) => {
              if (change.id === changeId) return { ...change, status };
              if (discarded.has(change.id)) {
                return { ...change, status: 'rejected' as const };
              }
              return change;
            }),
          }))
          .filter((set) => set.changes.some((change) => change.status === 'pending')),
        focusedChangeId:
          current.focusedChangeId === changeId ? null : current.focusedChangeId,
      }));
    },
    [
      applyPatch,
      markRecentlyChanged,
      ownerDocumentId,
      state.sets,
      updateForDocument,
    ],
  );

  const accept = useCallback((id: string) => settle(id, 'accepted'), [settle]);
  const reject = useCallback((id: string) => settle(id, 'rejected'), [settle]);

  const acceptAll = useCallback(() => {
    if (activeDocumentIdRef.current !== ownerDocumentId) return;
    const ops: ToolOperation[] = [];
    // Original authoring order, across batches: a later batch may build on an
    // earlier one, and replaying them out of order puts blocks in the wrong
    // place even though each operation on its own is valid.
    for (const set of state.sets) {
      for (const change of set.changes) {
        if (change.status === 'pending') ops.push(change.op);
      }
    }
    if (ops.length === 0) return;

    const { desynced, touched } = applyPatch(ops, { persist: true });
    markRecentlyChanged(touched);
    updateForDocument((current) => ({
      ...current,
      sets: [],
      focusedChangeId: null,
      error: desynced.length > 0
        ? `${desynced.length} change${desynced.length === 1 ? '' : 's'} could not be applied — the document has moved on since the assistant read it.`
        : current.error,
    }));
  }, [
    applyPatch,
    markRecentlyChanged,
    ownerDocumentId,
    state.sets,
    updateForDocument,
  ]);

  const rejectAll = useCallback(() => {
    updateForDocument((current) => ({
      ...current,
      sets: [],
      focusedChangeId: null,
    }));
  }, [updateForDocument]);

  const focusChange = useCallback((changeId: string) => {
    if (!updateForDocument((current) => ({ ...current, focusedChangeId: changeId }))) {
      return;
    }
    // Rendered by the canvas; the frame delay lets a just-mounted card exist.
    requestAnimationFrame(() => {
      if (activeDocumentIdRef.current !== ownerDocumentId) return;
      const element = document.querySelector<HTMLElement>(`[data-change-id="${changeId}"]`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [ownerDocumentId, updateForDocument]);

  const ready = useCallback(
    (change: ProposedChange) => isReady(change, state.sets),
    [state.sets],
  );
  const dismissInvite = useCallback((inviteId: string) => {
    updateForDocument((current) => ({
      ...current,
      invites: current.invites.filter((invite) => invite.id !== inviteId),
    }));
  }, [updateForDocument]);
  const clearError = useCallback(() => {
    updateForDocument((current) => ({ ...current, error: null }));
  }, [updateForDocument]);

  const pending = useMemo(() => pendingChanges(state.sets), [state.sets]);

  const value = useMemo<ProposalsContextValue>(
    () => ({
      sets: state.sets,
      pending,
      pendingCount: pending.length,
      invites: state.invites,
      receive,
      accept,
      reject,
      acceptAll,
      rejectAll,
      ready,
      focusChange,
      focusedChangeId: state.focusedChangeId,
      dismissInvite,
      error: state.error,
      clearError,
    }),
    [
      accept,
      acceptAll,
      clearError,
      dismissInvite,
      focusChange,
      pending,
      ready,
      receive,
      reject,
      rejectAll,
      state,
    ],
  );

  return <ProposalsContext.Provider value={value}>{children}</ProposalsContext.Provider>;
}
