import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useEditor } from './editorContextState';
import type { ToolAction, ToolOperation } from './types';
import { getChangeSet, listPendingChangeSets, rejectChangeSet } from '../services';
import { isRetryableProblem } from '../services/retry';
import {
  buildChangeSet,
  isReady,
  linkPrecedence,
  orderedChanges,
  pendingChanges,
  pruneSettledSets,
  resolveAcceptPlan,
  type ChangeSet,
  type DocumentInvite,
  type ProposedChange,
} from './proposals';
import { uid } from '../lib/uid';
import { revealElement } from '../lib/reveal';
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
 * A durable batch that uses an operation with no editor mapping fails closed:
 * staging the mappable subset would let the author unknowingly retire the
 * whole server record — unmappable operations included — when the last
 * visible change is decided. The set stays pending for a version that can
 * review it.
 */
const UNREVIEWABLE_PROPOSAL_ERROR =
  'The assistant prepared changes, but they use an operation this app version can’t review. Update the app to review them.';

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
    blocks,
    documentId,
    applyPatch,
    adoptServerVersion,
    markRecentlyChanged,
    restoreEpoch,
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

  /**
   * Batches already taken, keyed by tool call and payload.
   *
   * Held in a ref rather than derived from state because `receive` has to
   * answer "how many changes did this add?" synchronously — the chat transcript
   * prints that number. Deciding it inside the state updater meant a
   * redelivered batch was correctly ignored and still reported as N new
   * changes, so the reply claimed edits the document did not have.
   */
  const seenBatchesRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    activeDocumentIdRef.current = ownerDocumentId;
    seenBatchesRef.current = new Set();
  }, [ownerDocumentId]);

  // A restore moved the document onto another version of its tree; the
  // effect below (after resolveDurableSet exists) discards the review state.
  const restoreEpochRef = useRef(restoreEpoch);

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

  /**
   * Fetch a durable change set's operations and stage them for review.
   *
   * The stream carries only the change set id — the operations are redacted
   * out of the SSE payload — so staging is necessarily asynchronous. Anything
   * fetched for a document the author has since left is dropped.
   */
  const stageDurableProposal = useCallback(
    async (action: ToolAction, changeSetId: string) => {
      const targetDocumentId = action.documentId || ownerDocumentId;
      if (!targetDocumentId) return;
      // A restore that lands while the fetch is in flight moves the document
      // to another version; a batch computed against the old one must not be
      // staged onto it.
      const epochAtStart = restoreEpochRef.current;
      try {
        const fetched = await getChangeSet(targetDocumentId, changeSetId);
        if (activeDocumentIdRef.current !== ownerDocumentId) return;
        if (restoreEpochRef.current !== epochAtStart) return;
        // Another tab may have decided it while the stream was still open.
        if (fetched.status !== 'pending') return;
        if (fetched.unmappableOperations.length > 0) {
          updateForDocument((current) => ({ ...current, error: UNREVIEWABLE_PROPOSAL_ERROR }));
          return;
        }
        const set = buildChangeSet({
          ...action,
          documentId: targetDocumentId,
          actions: fetched.operations,
          changeSetId: fetched.changeSetId,
        });
        if (set.changes.length === 0) return;
        updateForDocument((current) => ({
          ...current,
          sets: [...current.sets, set],
          focusedChangeId: current.focusedChangeId ?? set.changes[0].id,
        }));
      } catch (cause) {
        // The request layer already waited out a server still catching up with
        // the save this batch was computed against, so reaching here means the
        // wait was not enough — the batch is safe on the server either way, and
        // reopening the document re-stages it.
        updateForDocument((current) => ({
          ...current,
          error: isRetryableProblem(cause)
            ? 'The assistant prepared changes, but the server is still catching up. Reopen the document in a moment to review them.'
            : 'The assistant prepared changes, but they could not be loaded for review. Reopen the document to try again.',
        }));
      }
    },
    [ownerDocumentId, updateForDocument],
  );

  /**
   * A durable proposal outlives the stream that announced it. On opening a
   * document, stage whatever pending change sets the server still holds —
   * without this, a reload between "Prepared changes" and the decision lost
   * the review entirely.
   */
  useEffect(() => {
    if (!ownerDocumentId) return;
    let cancelled = false;
    const epochAtStart = restoreEpochRef.current;
    void (async () => {
      try {
        const pending = await listPendingChangeSets(ownerDocumentId);
        if (cancelled || activeDocumentIdRef.current !== ownerDocumentId) return;
        if (restoreEpochRef.current !== epochAtStart) return;
        for (const changeSet of pending) {
          const signature = `change-set:${changeSet.changeSetId}`;
          if (seenBatchesRef.current.has(signature)) continue;
          seenBatchesRef.current.add(signature);
          if (changeSet.unmappableOperations.length > 0) {
            updateForDocument((current) => ({ ...current, error: UNREVIEWABLE_PROPOSAL_ERROR }));
            continue;
          }
          const set = buildChangeSet({
            tool: 'doc_edit',
            toolCallId: changeSet.toolCallId ?? '',
            documentId: ownerDocumentId,
            version: changeSet.baseHeadSeq,
            status: 'proposed',
            actions: changeSet.operations,
            changeSetId: changeSet.changeSetId,
          });
          if (set.changes.length === 0) continue;
          updateForDocument((current) => ({
            ...current,
            sets: [...current.sets, set],
          }));
        }
      } catch {
        // Silent: live proposals still arrive over the stream, and a document
        // without v2 history simply has nothing pending.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerDocumentId, updateForDocument]);

  /** Change sets with a server resolution in flight; blocks double submission. */
  const decidingSetsRef = useRef<Set<string>>(new Set());

  /**
   * Retire the server-side record of a durable batch once the author has
   * decided everything in it.
   *
   * The review itself is per change, in the editor, exactly like any other
   * batch: accepted operations are applied locally and autosaved as author
   * edits. The stored change set is a staging record, and it is *rejected*
   * either way — accepting it server-side would re-apply operations the
   * editor already holds, and leaving it pending re-stages the whole batch
   * on the next document load and blocks the agent's next proposal.
   */
  const resolveDurableSet = useCallback(
    async (set: ChangeSet, outcome: 'rejected' | 'decided' | 'superseded') => {
      const changeSetId = set.changeSetId;
      if (!changeSetId || !set.documentId) return;
      if (decidingSetsRef.current.has(changeSetId)) return;
      decidingSetsRef.current.add(changeSetId);
      try {
        await rejectChangeSet(
          set.documentId,
          changeSetId,
          outcome === 'rejected'
            ? 'Rejected in the editor'
            : outcome === 'superseded'
              ? 'Superseded: the document was restored to another version'
              : 'Decided per change in the editor; accepted changes were applied as author edits',
        );
      } catch {
        // Cleanup only: the author's decisions are already in the document.
        // The worst case is this batch reappearing on the next load, where
        // it can simply be rejected again.
      } finally {
        decidingSetsRef.current.delete(changeSetId);
      }
    },
    [],
  );

  // A restore moved the document onto another version of its tree. Every
  // staged change was computed against the pre-restore content — its anchors
  // may still exist with entirely different text — so the review state is
  // discarded the same way a navigation discards it, and the durable records
  // are retired server-side: left pending, they would re-stage the whole
  // pre-restore batch on the next document load. (Batch dedup keys are kept:
  // a late redelivery of a pre-restore batch must stay ignored.)
  useLayoutEffect(() => {
    if (restoreEpochRef.current === restoreEpoch) return;
    restoreEpochRef.current = restoreEpoch;
    for (const set of state.sets) {
      if (!set.changeSetId) continue;
      if (!set.changes.some((change) => change.status === 'pending')) continue;
      void resolveDurableSet(set, 'superseded');
    }
    setStoredState(emptyState(activeDocumentIdRef.current));
  }, [restoreEpoch, state, resolveDurableSet]);

  /**
   * Server records whose local review just concluded with these decisions.
   * Returns the durable sets that no longer have an undecided change.
   */
  const concludedDurableSets = useCallback(
    (decidedIds: ReadonlySet<string>): ChangeSet[] =>
      state.sets.filter((set) => {
        if (!set.changeSetId) return false;
        if (!set.changes.some((change) => decidedIds.has(change.id))) return false;
        return set.changes.every(
          (change) => change.status !== 'pending' || decidedIds.has(change.id),
        );
      }),
    [state.sets],
  );

  const receive = useCallback<ProposalsContextValue['receive']>((action) => {
    if (activeDocumentIdRef.current !== ownerDocumentId) {
      return { changes: 0, changeIds: [], applied: 0, invited: false };
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
      ownerDocumentId !== null
      && (action.documentId === ownerDocumentId
        // A payload that names no document is answering the request this
        // client addressed to *this* document. Requiring an exact match
        // dropped it in total silence, which reads as the assistant having
        // done nothing.
        || action.documentId === '');

    /**
     * Only a `proposed` batch is something to decide on.
     *
     * `skipped` and `error` describe work the server did not do; staging them
     * offered the author an Accept button for operations that were never
     * carried out, and accepting one wrote the agent's abandoned draft into
     * the document.
     */
    /**
     * A durable proposal arrives as an id, not as operations: the server
     * stored the batch as a change set and redacted the content out of the
     * stream. Fetch and stage it asynchronously; report the server-counted
     * size so the transcript can still say what was prepared.
     */
    if (
      targetsThisDocument
      && action.status === 'proposed'
      && action.changeSetId
      && action.actions.length === 0
    ) {
      const signature = `change-set:${action.changeSetId}`;
      if (seenBatchesRef.current.has(signature)) {
        return { changes: 0, changeIds: [], applied: 0, invited };
      }
      seenBatchesRef.current.add(signature);
      void stageDurableProposal(action, action.changeSetId);
      return {
        changes: action.proposalOperationCount ?? 0,
        changeIds: [],
        applied: 0,
        invited,
      };
    }

    const reviewable =
      targetsThisDocument && (action.status === 'proposed' || action.status === 'applied');
    const set = reviewable ? buildChangeSet(action) : null;

    // Some providers number tool calls per request (call_0, call_1…), so the
    // id alone repeats across runs. Only identical operations are a redelivery.
    let duplicate = false;
    if (set && set.changes.length > 0) {
      const signature = `${set.toolCallId}:${action.status}:${JSON.stringify(
        set.changes.map((change) => change.op),
      )}`;
      duplicate = seenBatchesRef.current.has(signature);
      if (!duplicate) seenBatchesRef.current.add(signature);
    }

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
      if (activeDocumentIdRef.current !== ownerDocumentId || duplicate) {
        return { changes: 0, changeIds: [], applied: 0, invited };
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
      // Reported so the reply can say the document was changed. An auto-applied
      // batch left no trace in the transcript at all: the only sign was a
      // four-second highlight the author had to be looking at to catch.
      return { changes: 0, changeIds: [], applied: set.changes.length - desynced.length, invited };
    }

    // A redelivery adds nothing, and saying otherwise made the reply claim
    // changes the document does not have.
    if (duplicate || !set) return { changes: 0, changeIds: [], applied: 0, invited };
    return {
      changes: set.changes.length,
      changeIds: set.changes.map((change) => change.id),
      applied: 0,
      invited,
    };
  }, [
    adoptServerVersion,
    applyPatch,
    markRecentlyChanged,
    stageDurableProposal,
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
      let settled = true;
      if (status === 'accepted') {
        // Positioned against the batch siblings already in the document rather
        // than replayed literally, so the result does not depend on the order
        // the author happened to click in. See `resolveAcceptOp`.
        let plan = resolveAcceptPlan([target], state.sets, blocks);
        if (plan.ops.length === 0) {
          settled = false;
        } else {
          let outcome = applyPatch(plan.ops, { persist: true, base: blocks });
          if (outcome.stale) {
            // The author kept typing between the render this plan came from
            // and the click. Recompute against the live blocks: the retry
            // cannot go stale inside a single synchronous section, and an
            // atomic refusal beats the old half-applied-then-stuck-pending
            // outcome.
            const liveBlocks = outcome.blocks;
            plan = resolveAcceptPlan([target], state.sets, liveBlocks);
            outcome = plan.ops.length > 0
              ? applyPatch(plan.ops, { persist: true, base: liveBlocks })
              : { blocks: liveBlocks, desynced: [], touched: [] };
          }
          markRecentlyChanged(outcome.touched);
          settled = !outcome.stale && plan.ops.length > 0 && outcome.desynced.length === 0;
        }

        if (!settled) {
          // Leaving it pending is the difference between "this could not be
          // applied" and losing it: the author can still read it in place and
          // reject it. Marking it accepted while applying nothing threw the
          // operation away and told them it had landed.
          applyError =
            'That change refers to a part of the document that is no longer there, so it was not applied. Reject it to clear it.';
        }
      }

      updateForDocument((current) => ({
        ...current,
        error: applyError ?? current.error,
        sets: pruneSettledSets(
          current.sets.map((set) => ({
            ...set,
            changes: set.changes.map((change) => {
              if (change.id === changeId) return settled ? { ...change, status } : change;
              if (discarded.has(change.id)) {
                return { ...change, status: 'rejected' as const };
              }
              return change;
            }),
          })),
        ),
        focusedChangeId:
          settled && current.focusedChangeId === changeId ? null : current.focusedChangeId,
      }));

      // This decision may have been the batch's last one — retire the server
      // record so it neither re-stages on reload nor blocks the next run.
      const decidedIds = new Set<string>([
        ...(settled ? [changeId] : []),
        ...discarded,
      ]);
      for (const set of concludedDurableSets(decidedIds)) {
        const anyAccepted =
          set.changes.some((change) => change.status === 'accepted')
          || (settled && status === 'accepted' && set.changes.some((c) => c.id === changeId));
        void resolveDurableSet(set, anyAccepted ? 'decided' : 'rejected');
      }
    },
    [
      applyPatch,
      blocks,
      concludedDurableSets,
      markRecentlyChanged,
      ownerDocumentId,
      resolveDurableSet,
      state.sets,
      updateForDocument,
    ],
  );

  const accept = useCallback((id: string) => settle(id, 'accepted'), [settle]);
  const reject = useCallback((id: string) => settle(id, 'rejected'), [settle]);

  const acceptAll = useCallback(() => {
    if (activeDocumentIdRef.current !== ownerDocumentId) return;
    // Original authoring order, across batches: a later batch may build on an
    // earlier one, and replaying them out of order puts blocks in the wrong
    // place even though each operation on its own is valid.
    const queue = orderedChanges(state.sets).filter((change) => change.status === 'pending');
    if (queue.length === 0) return;

    let plan = resolveAcceptPlan(queue, state.sets, blocks);
    let applyDesynced = 0;
    if (plan.ops.length > 0) {
      let outcome = applyPatch(plan.ops, { persist: true, base: blocks });
      if (outcome.stale) {
        // Same recompute-and-retry as `settle`: the document moved between
        // render and click, so the plan's positions no longer match it.
        const liveBlocks = outcome.blocks;
        plan = resolveAcceptPlan(queue, state.sets, liveBlocks);
        outcome = plan.ops.length > 0
          ? applyPatch(plan.ops, { persist: true, base: liveBlocks })
          : { blocks: liveBlocks, desynced: [], touched: [] };
      }
      markRecentlyChanged(outcome.touched);
      // Ops that desynced at apply time count as failures too — simulation
      // passing is no guarantee the live document agreed.
      applyDesynced = outcome.stale ? plan.ops.length : outcome.desynced.length;
    }

    // Only what this run actually decided. Clearing every set discarded a
    // batch that had arrived while the confirmation dialog was open — the
    // author never saw it, and it was counted as reviewed.
    const decided = new Set(plan.applied.map((change) => change.id));
    const failed = plan.desynced.length + applyDesynced;

    updateForDocument((current) => ({
      ...current,
      sets: pruneSettledSets(
        current.sets.map((set) => ({
          ...set,
          changes: set.changes.map((change) =>
            decided.has(change.id) ? { ...change, status: 'accepted' as const } : change,
          ),
        })),
      ),
      focusedChangeId: null,
      error: failed > 0
        ? `${failed} change${failed === 1 ? '' : 's'} could not be applied — the document has moved on since the assistant read it.`
        : current.error,
    }));

    for (const set of concludedDurableSets(decided)) {
      void resolveDurableSet(set, 'decided');
    }
  }, [
    applyPatch,
    blocks,
    concludedDurableSets,
    markRecentlyChanged,
    ownerDocumentId,
    resolveDurableSet,
    state.sets,
    updateForDocument,
  ]);

  const rejectAll = useCallback(() => {
    // Same reasoning as `acceptAll`: reject what was on screen, not whatever
    // has arrived since.
    const decided = new Set(pendingChanges(state.sets).map((change) => change.id));
    updateForDocument((current) => ({
      ...current,
      sets: pruneSettledSets(
        current.sets.map((set) => ({
          ...set,
          changes: set.changes.map((change) =>
            decided.has(change.id) ? { ...change, status: 'rejected' as const } : change,
          ),
        })),
      ),
      focusedChangeId: null,
    }));

    // Rejected batches must clear their server record too — a pending change
    // set re-stages on reload and blocks the agent's next proposal.
    for (const set of concludedDurableSets(decided)) {
      const anyAccepted = set.changes.some((change) => change.status === 'accepted');
      void resolveDurableSet(set, anyAccepted ? 'decided' : 'rejected');
    }
  }, [concludedDurableSets, resolveDurableSet, state.sets, updateForDocument]);

  const focusChange = useCallback((changeId: string) => {
    if (!updateForDocument((current) => ({ ...current, focusedChangeId: changeId }))) {
      return;
    }
    // Rendered by the canvas; the frame delay lets a just-mounted card exist.
    requestAnimationFrame(() => {
      if (activeDocumentIdRef.current !== ownerDocumentId) return;
      // Scrolling alone is sighted-only: Next/Previous also has to put focus
      // on the card, or the next Tab walks away from what was just revealed.
      revealElement(document.querySelector(`[data-change-id="${changeId}"]`));
    });
  }, [ownerDocumentId, updateForDocument]);

  // Rebuilt with the batches, not per change: the relation is global, and a
  // card asks for it on every render.
  const precedence = useMemo(() => linkPrecedence(state.sets), [state.sets]);
  const ready = useCallback(
    (change: ProposedChange) => isReady(change, state.sets, blocks, precedence),
    [blocks, precedence, state.sets],
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
