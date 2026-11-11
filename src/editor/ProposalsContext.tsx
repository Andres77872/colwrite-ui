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
import type { Block, ToolAction, ToolOperation } from './types';
import {
  decideChangeSetOperations,
  decisionRefusal,
  getChangeSet,
  listPendingChangeSets,
  rejectChangeSet,
  type AgentChangeSet,
} from '../services';
import { isRetryableProblem } from '../services/retry';
import {
  buildChangeSet,
  isReady,
  isStale,
  linkPrecedence,
  markChanges,
  markOutdated,
  orderedChanges,
  pendingChanges,
  pendingInDocumentOrder,
  pruneSettledSets,
  rebaseAfterAccept,
  rejectChange,
  resolveAcceptPlan,
  resumeReview,
  type ChangeSet,
  type DocumentInvite,
  type OperationTarget,
  type ProposedChange,
  type ReviewDecision,
} from './proposals';
import {
  forgetDecisions,
  forgetReview,
  loadReview,
  pruneReviews,
  saveReview,
} from './reviewDecisions';
import { focusPageTitle } from './useDocumentTitle';
import { uid } from '../lib/uid';
import { revealElement } from '../lib/reveal';
import { scrollBehavior } from '../lib/motion';
import { lastInputWasPointer } from '../lib/inputModality';
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

/** An accept refused because the block was edited after the suggestion was written. */
const STALE_CHANGE_ERROR =
  'That paragraph changed after the assistant suggested this, so it was not applied. Reject it, or ask the assistant again.';

function staleSkippedError(count: number): string {
  return count === 1
    ? '1 suggestion was not applied because its text changed after it was suggested. It is still in the document for you to reject.'
    : `${count} suggestions were not applied because their text changed after they were suggested. They are still in the document for you to reject.`;
}

/** An insert whose block is already in the document has nothing left to apply. */
function hasLanded(change: ProposedChange, blocks: readonly Block[]): boolean {
  return change.kind === 'insert'
    && change.producesBlockId !== null
    && blocks.some((block) => block.id === change.producesBlockId);
}

/* ----------------------------------------
   Remembering decisions on durable batches
   ---------------------------------------- */

/** Staging fingerprints of a batch, keyed by operation index. */
function basesOf(set: ChangeSet): Record<string, string> {
  const bases: Record<string, string> = {};
  for (const change of set.changes) {
    if (change.opIndex !== undefined && change.base !== undefined) bases[change.opIndex] = change.base;
  }
  return bases;
}

/** Requests recording decisions, one chain per change set. */
const decisionChains = new Map<string, Promise<void>>();

/**
 * Record decisions on the server.
 *
 * One request at a time per change set, so the record keeps the order the
 * decisions were made in: a rejection replayed on the next load re-anchors
 * its continuations by that order.
 *
 * A decision that could not be sent waits in this browser and is sent again
 * when the change set is next staged. One the server refuses for good is
 * dropped, because the server's record is what a reload shows: the operation
 * was decided the other way on another device, or the set has left
 * `pending`. The rest of a request refused over one contradicted operation is
 * sent again without it.
 */
function sendDecisions(
  documentId: string,
  changeSetId: string,
  decisions: readonly ReviewDecision[],
): Promise<void> {
  if (decisions.length === 0) return Promise.resolve();
  const send = async () => {
    let rest = [...decisions];
    while (rest.length > 0) {
      try {
        await decideChangeSetOperations(
          documentId,
          changeSetId,
          rest.map(([opIndex, decision]) => ({ opIndex, decision })),
        );
        break;
      } catch (cause) {
        const refusal = decisionRefusal(cause);
        if (refusal.kind === 'transient') {
          saveReview(documentId, changeSetId, { decisions: rest });
          return;
        }
        if (refusal.kind === 'final') break;
        const others = rest.filter(([opIndex]) => opIndex !== refusal.opIndex);
        if (others.length === rest.length) break;
        rest = others;
      }
    }
    forgetDecisions(documentId, changeSetId, decisions.map(([opIndex]) => opIndex));
  };
  const queued = (decisionChains.get(changeSetId) ?? Promise.resolve()).then(send);
  decisionChains.set(changeSetId, queued);
  void queued.finally(() => {
    if (decisionChains.get(changeSetId) === queued) decisionChains.delete(changeSetId);
  });
  return queued;
}

/**
 * Record these decisions for each durable batch they belong to: on the
 * server when it keeps them, otherwise in this browser.
 */
function rememberDecisions(
  sets: ChangeSet[],
  decided: ReadonlyArray<readonly [string, 'accepted' | 'rejected']>,
): void {
  for (const set of sets) {
    if (!set.changeSetId || !set.documentId) continue;
    const byId = new Map(set.changes.map((change) => [change.id, change]));
    const decisions: ReviewDecision[] = [];
    for (const [id, status] of decided) {
      const opIndex = byId.get(id)?.opIndex;
      if (opIndex !== undefined) decisions.push([opIndex, status]);
    }
    if (decisions.length === 0) continue;
    if (set.decisionsOnServer) void sendDecisions(set.documentId, set.changeSetId, decisions);
    else saveReview(set.documentId, set.changeSetId, { decisions });
  }
}

/**
 * Write the fingerprints of every durable batch `rebased` changed. A batch
 * with server targets needs none: a reload asks the server what each block
 * looks like then.
 */
function rememberRebased(before: ChangeSet[], rebased: ChangeSet[]): void {
  rebased.forEach((set, index) => {
    if (set === before[index] || !set.changeSetId || !set.documentId) return;
    if (set.targetsOnServer) return;
    saveReview(set.documentId, set.changeSetId, { bases: basesOf(set) });
  });
}

/** What the server said about a durable batch when it was read. */
type ServerReview = {
  /** In the order they were made; `null` when the API keeps no such record. */
  decisions: ReviewDecision[] | null;
  /** By operation index; `null` when the API sent none for this batch. */
  targets: ReadonlyArray<OperationTarget | null> | null;
  /** Stages recorded by the batches this one was written on top of. */
  earlier: ReadonlyMap<string, ReadonlySet<string>>;
};

const NO_STAGES: ReadonlyMap<string, ReadonlySet<string>> = new Map();

/** How far up a run's chain of batches to look; the API allows 32. */
const MAX_ANCESTORS = 32;

function serverReview(
  changeSet: AgentChangeSet,
  earlier: ReadonlyMap<string, ReadonlySet<string>> = NO_STAGES,
): ServerReview {
  return {
    decisions:
      changeSet.operationDecisions?.map(
        ({ opIndex, decision }): ReviewDecision => [opIndex, decision],
      ) ?? null,
    targets: changeSet.operationTargets ?? null,
    earlier,
  };
}

/**
 * Whether deciding if a batch's targets are current takes the batches it was
 * written on top of: only when it has such a batch, and the saved document
 * holds one of its targets differently from how the operation found it.
 */
function needsAncestors(changeSet: AgentChangeSet): boolean {
  return Boolean(changeSet.dependsOnChangeSetId)
    && (changeSet.operationTargets ?? []).some(
      (target) => target !== null && target.headFingerprint !== target.fingerprint,
    );
}

/**
 * The fingerprints the earlier batches of a run recorded, per block.
 *
 * A later batch is computed on top of the earlier ones, so its target is the
 * block as they leave it. While they are undecided, or once they are
 * rejected, the saved block is still at one of their stages, which is not an
 * edit by the author (see `markOutdated`). Batches the review no longer
 * holds are read from the server; one that cannot be read ends the walk, and
 * the operation then reads as changed, which can still be rejected.
 */
async function ancestorStages(
  documentId: string,
  changeSet: AgentChangeSet,
  known: ReadonlyMap<string, AgentChangeSet>,
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const stages = new Map<string, Set<string>>();
  const seen = new Set([changeSet.changeSetId]);
  let parentId = changeSet.dependsOnChangeSetId;
  while (parentId && !seen.has(parentId) && seen.size <= MAX_ANCESTORS) {
    seen.add(parentId);
    let parent = known.get(parentId);
    if (!parent) {
      try {
        parent = await getChangeSet(documentId, parentId);
      } catch {
        break;
      }
    }
    for (const target of parent.operationTargets ?? []) {
      if (!target) continue;
      const recorded = stages.get(target.blockId) ?? new Set<string>();
      recorded.add(target.fingerprint);
      stages.set(target.blockId, recorded);
    }
    parentId = parent.dependsOnChangeSetId;
  }
  return stages;
}

/**
 * A durable batch as it should be staged: the decisions already made on it
 * applied, and — when it is staged again on opening the document —
 * operations the document already holds marked as such. A batch that has just
 * arrived from the stream is shown as the assistant wrote it.
 *
 * The decisions come from the server when it records them. This browser's
 * record then only holds the ones that could not be sent, which are applied
 * after the server's and sent again. Without a server record (an older API)
 * the browser's is all there is.
 *
 * The same goes for staleness: with the server's targets, a change whose
 * block was edited after the proposal is marked from them; without, the
 * staging fingerprints kept in this browser are restored.
 */
function resumeDurableSet(
  built: ChangeSet,
  blocks: readonly Block[] | null,
  server: ServerReview | null,
): ChangeSet {
  if (!built.changeSetId || !built.documentId) return built;
  const { documentId, changeSetId } = built;
  const recorded = server?.decisions ?? null;
  const targets = server?.targets ?? null;
  const set: ChangeSet = {
    ...built,
    ...(recorded ? { decisionsOnServer: true } : null),
    ...(targets ? { targetsOnServer: true } : null),
  };

  const local = loadReview(documentId, changeSetId);
  const onServer = new Set((recorded ?? []).map(([opIndex]) => opIndex));
  const unsent = (local?.decisions ?? []).filter(([opIndex]) => !onServer.has(opIndex));
  const stored = local || onServer.size > 0
    ? {
        decisions: [...(recorded ?? []), ...unsent],
        bases: targets ? {} : local?.bases ?? {},
      }
    : null;
  const { set: resumed, landed } = resumeReview(set, stored, blocks);
  const found = landed.map((opIndex): ReviewDecision => [opIndex, 'accepted']);

  if (recorded) {
    // The server already has these; whatever this browser held for them,
    // the same or not, is no longer needed.
    forgetDecisions(documentId, changeSetId, [...onServer]);
    void sendDecisions(documentId, changeSetId, [...unsent, ...found]);
  }
  saveReview(documentId, changeSetId, {
    decisions: recorded ? [] : found,
    bases: targets ? {} : basesOf(resumed),
  });
  return targets ? markOutdated(resumed, targets, server?.earlier) : resumed;
}

/* ----------------------------------------
   Focus after a decision
   ---------------------------------------- */

/** Where focus goes once a change is decided and nothing else is pending. */
type FocusFallback = { blockId: string | null; title: boolean };

type FocusIntent = {
  /** Pending changes in reading order, as they were when the decision was made. */
  order: string[];
  from: string;
  fallback: FocusFallback;
};

/** The block a decision left the author on. */
function fallbackFor(
  change: ProposedChange,
  status: 'accepted' | 'rejected',
  blocks: readonly Block[],
): FocusFallback {
  if (change.kind === 'rename') return { blockId: null, title: true };
  if (change.kind === 'insert') {
    if (status === 'accepted' && change.producesBlockId) {
      return { blockId: change.producesBlockId, title: false };
    }
    if (change.placement === 'start') return { blockId: blocks[0]?.id ?? null, title: false };
    if (change.placement === 'end') return { blockId: blocks[blocks.length - 1]?.id ?? null, title: false };
    return { blockId: change.anchorBlockId, title: false };
  }
  if (change.kind === 'delete' && status === 'accepted') {
    // The block is gone; the one that took its place is where the author is.
    const at = blocks.findIndex((block) => block.id === change.anchorBlockId);
    return { blockId: blocks[at + 1]?.id ?? blocks[at - 1]?.id ?? null, title: false };
  }
  return { blockId: change.anchorBlockId, title: false };
}

function attributeValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Focus a review card without throwing the page around.
 *
 * Next/Previous centres and flashes its target, because the author asked to
 * go there. Moving on after a decision happens on every click, so it only
 * scrolls when the card's header would be out of view, and it shows a ring
 * only when the decision came from the keyboard.
 */
function focusInPlace(target: HTMLElement): void {
  target.focus({ preventScroll: true, focusVisible: !lastInputWasPointer() } as FocusOptions);
  const top = target.getBoundingClientRect().top;
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  // The sticky page chrome covers the first few dozen pixels.
  if ((top < 56 || top > viewport - 80) && typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  }
}

/** Put the caret back in the block a decision was about. */
function focusDecidedBlock(fallback: FocusFallback): void {
  if (fallback.blockId) {
    const row = document.querySelector<HTMLElement>(
      `.block-row[data-block-id="${attributeValue(fallback.blockId)}"]`,
    );
    const target = row?.querySelector<HTMLElement>('[contenteditable="true"]');
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: 'nearest' });
      return;
    }
  }
  if (fallback.title || fallback.blockId) focusPageTitle();
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
    blocks,
    documentId,
    applyPatch,
    adoptServerVersion,
    markRecentlyChanged,
    restoreEpoch,
    restoreReason,
  } = useEditor();
  const ownerDocumentId = documentId;
  const activeDocumentIdRef = useRef(ownerDocumentId);

  /**
   * The document as it stands, for staging that finishes after an await.
   * A batch records what its blocks looked like when it was staged (see
   * `isStale`), and that has to be the document at that moment, not the one
   * the callback was created with.
   */
  const blocksRef = useRef(blocks);
  useLayoutEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

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

  /** Where focus goes once the decision just made has been rendered. */
  const advanceRef = useRef<FocusIntent | null>(null);

  /**
   * Change sets read for this document, for walking a run's chain of batches
   * (see `ancestorStages`) without asking for the same one twice.
   */
  const knownChangeSetsRef = useRef<Map<string, AgentChangeSet>>(new Map());

  useLayoutEffect(() => {
    activeDocumentIdRef.current = ownerDocumentId;
    seenBatchesRef.current = new Set();
    knownChangeSetsRef.current = new Map();
    advanceRef.current = null;
  }, [ownerDocumentId]);

  // A restore moved the document onto another version of its tree; the
  // effect below (after resolveDurableSet exists) discards the review state.
  const restoreEpochRef = useRef(restoreEpoch);
  /** Bumped to list the server's pending change sets again for this document. */
  const [relistTick, setRelistTick] = useState(0);

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

  /** Change sets with a server resolution in flight; blocks double submission. */
  const decidingSetsRef = useRef<Set<string>>(new Set());

  /**
   * Retire the server-side record of a durable batch once the author has
   * decided everything in it.
   *
   * The review itself is per change, in the editor, exactly like any other
   * batch: accepted operations are applied locally and autosaved as author
   * edits. Accepting the stored change set server-side would re-apply
   * operations the editor already holds, and leaving it pending re-stages
   * the whole batch on the next document load and blocks the agent's next
   * proposal.
   *
   * A server that records decisions per operation retires the set itself
   * when the last one is recorded (`rememberDecisions` sends them), so there
   * is nothing to do here. Two cases still reject the set by hand: a restore,
   * which leaves operations undecided, and an API without that record, where
   * a rejection with a note is the only way to close the set.
   */
  const resolveDurableSet = useCallback(
    async (set: ChangeSet, outcome: 'rejected' | 'decided' | 'superseded') => {
      const changeSetId = set.changeSetId;
      if (!changeSetId || !set.documentId) return;
      if (set.decisionsOnServer && outcome !== 'superseded') return;
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
        // Kept until now on purpose: if the request fails, the next load
        // finds every operation already decided and retires the batch again
        // instead of staging it whole.
        forgetReview(set.documentId, changeSetId);
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

  /**
   * Stage a durable batch, or retire it if nothing in it is left to decide
   * (the request that would have retired it failed last time, or the
   * decisions were made in another tab and the document already holds them).
   */
  const stageDurableSet = useCallback(
    (
      built: ChangeSet,
      { restaged, server }: { restaged: boolean; server: ServerReview | null },
    ) => {
      const set = resumeDurableSet(built, restaged ? blocksRef.current : null, server);
      const first = set.changes.find((change) => change.status === 'pending');
      if (!first) {
        const anyAccepted = set.changes.some((change) => change.status === 'accepted');
        void resolveDurableSet(set, anyAccepted ? 'decided' : 'rejected');
        return;
      }
      updateForDocument((current) => ({
        ...current,
        sets: [...current.sets, set],
        // A batch that just arrived is the one the author is waiting for; one
        // found on opening the document is not singled out.
        focusedChangeId: restaged ? current.focusedChangeId : current.focusedChangeId ?? first.id,
      }));
    },
    [resolveDurableSet, updateForDocument],
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
        knownChangeSetsRef.current.set(fetched.changeSetId, fetched);
        let earlier = NO_STAGES;
        if (needsAncestors(fetched)) {
          earlier = await ancestorStages(targetDocumentId, fetched, knownChangeSetsRef.current);
          if (activeDocumentIdRef.current !== ownerDocumentId) return;
          if (restoreEpochRef.current !== epochAtStart) return;
        }
        const set = buildChangeSet(
          {
            ...action,
            documentId: targetDocumentId,
            actions: fetched.operations,
            changeSetId: fetched.changeSetId,
          },
          blocksRef.current,
        );
        if (set.changes.length === 0) return;
        stageDurableSet(set, { restaged: false, server: serverReview(fetched, earlier) });
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
    [ownerDocumentId, stageDurableSet, updateForDocument],
  );

  /**
   * A durable proposal outlives the stream that announced it. On opening a
   * document, stage whatever pending change sets the server still holds —
   * without this, a reload between "Prepared changes" and the decision lost
   * the review entirely.
   *
   * The server hands back every operation of a batch that is still pending,
   * including the ones the author already decided, together with its record
   * of those decisions; `resumeDurableSet` takes them back out. For an API
   * without that record, the one in this browser is used instead (see
   * `reviewDecisions.ts`).
   */
  useEffect(() => {
    if (!ownerDocumentId) return;
    let cancelled = false;
    const epochAtStart = restoreEpochRef.current;
    void (async () => {
      try {
        const listedAt = Date.now();
        const pending = await listPendingChangeSets(ownerDocumentId);
        if (cancelled || activeDocumentIdRef.current !== ownerDocumentId) return;
        if (restoreEpochRef.current !== epochAtStart) return;
        pruneReviews(
          ownerDocumentId,
          new Set(pending.map((changeSet) => changeSet.changeSetId)),
          listedAt,
        );
        for (const changeSet of pending) {
          knownChangeSetsRef.current.set(changeSet.changeSetId, changeSet);
        }
        for (const changeSet of pending) {
          const signature = `change-set:${changeSet.changeSetId}`;
          if (seenBatchesRef.current.has(signature)) continue;
          let earlier = NO_STAGES;
          if (changeSet.unmappableOperations.length === 0 && needsAncestors(changeSet)) {
            earlier = await ancestorStages(ownerDocumentId, changeSet, knownChangeSetsRef.current);
            if (cancelled || activeDocumentIdRef.current !== ownerDocumentId) return;
            if (restoreEpochRef.current !== epochAtStart) return;
            // The stream may have staged it while the chain was being read.
            if (seenBatchesRef.current.has(signature)) continue;
          }
          seenBatchesRef.current.add(signature);
          if (changeSet.unmappableOperations.length > 0) {
            updateForDocument((current) => ({ ...current, error: UNREVIEWABLE_PROPOSAL_ERROR }));
            continue;
          }
          const set = buildChangeSet(
            {
              tool: 'doc_edit',
              toolCallId: changeSet.toolCallId ?? '',
              documentId: ownerDocumentId,
              version: changeSet.baseHeadSeq,
              status: 'proposed',
              actions: changeSet.operations,
              changeSetId: changeSet.changeSetId,
            },
            blocksRef.current,
          );
          if (set.changes.length === 0) continue;
          stageDurableSet(set, { restaged: true, server: serverReview(changeSet, earlier) });
        }
      } catch {
        // Silent: live proposals still arrive over the stream, and a document
        // without v2 history simply has nothing pending.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerDocumentId, relistTick, stageDurableSet, updateForDocument]);

  // A restore moved the document onto another version of its tree. Every
  // staged change was computed against the pre-restore content — its anchors
  // may still exist with entirely different text — so the review state is
  // discarded the same way a navigation discards it, and the durable records
  // are retired server-side: left pending, they would re-stage the whole
  // pre-restore batch on the next document load. (Batch dedup keys are kept:
  // a late redelivery of a pre-restore batch must stay ignored.)
  //
  // Opening the server's newer version after a refused save is the exception.
  // The document stays on its own line of history, so the records are left
  // pending and staged again against the newer content, as reopening the
  // document would stage them: retiring them there threw away suggestions the
  // author had not looked at yet.
  useLayoutEffect(() => {
    if (restoreEpochRef.current === restoreEpoch) return;
    restoreEpochRef.current = restoreEpoch;
    const sameHistory = restoreReason === 'newer-version';
    if (sameHistory) {
      for (const signature of seenBatchesRef.current) {
        if (signature.startsWith('change-set:')) seenBatchesRef.current.delete(signature);
      }
    } else {
      for (const set of state.sets) {
        if (!set.changeSetId) continue;
        if (!set.changes.some((change) => change.status === 'pending')) continue;
        void resolveDurableSet(set, 'superseded');
      }
    }
    advanceRef.current = null;
    setStoredState(emptyState(activeDocumentIdRef.current));
    if (sameHistory) setRelistTick((tick) => tick + 1);
  }, [restoreEpoch, restoreReason, state, resolveDurableSet]);

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
    const set = reviewable ? buildChangeSet(action, blocksRef.current) : null;

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
      // Taken before the decision, so "the next one" means the next one the
      // author was looking at.
      const readingOrder = pendingInDocumentOrder(blocks, state.sets).map((change) => change.id);

      let applyError: string | null = null;
      let settled = true;
      /** What an applied accept did to the document, to carry fingerprints over. */
      let landed: { before: Block[]; after: Block[]; touched: string[] } | null = null;
      if (status === 'accepted') {
        if (hasLanded(target, blocks)) {
          // Already in the document — accepted in another tab, or before this
          // browser lost its record of the decision. Applying it again is
          // refused as a duplicate block, which read as the change having
          // nowhere to go.
        } else if (isStale(target, blocks)) {
          // The card does not offer Accept for this; refusing here as well
          // keeps the author's newer text whatever the caller.
          settled = false;
          applyError = STALE_CHANGE_ERROR;
        } else {
          // Positioned against the batch siblings already in the document
          // rather than replayed literally, so the result does not depend on
          // the order the author happened to click in. See `resolveAcceptOp`.
          let plan = resolveAcceptPlan([target], state.sets, blocks);
          if (plan.ops.length === 0) {
            settled = false;
          } else {
            let base = blocks;
            let outcome = applyPatch(plan.ops, { persist: true, base: blocks });
            if (outcome.stale) {
              // The author kept typing between the render this plan came from
              // and the click. Recompute against the live blocks: the retry
              // cannot go stale inside a single synchronous section, and an
              // atomic refusal beats the old half-applied-then-stuck-pending
              // outcome.
              const liveBlocks = outcome.blocks;
              base = liveBlocks;
              plan = resolveAcceptPlan([target], state.sets, liveBlocks);
              outcome = plan.ops.length > 0
                ? applyPatch(plan.ops, { persist: true, base: liveBlocks })
                : { blocks: liveBlocks, desynced: [], touched: [] };
            }
            markRecentlyChanged(outcome.touched);
            settled = !outcome.stale && plan.ops.length > 0 && outcome.desynced.length === 0;
            if (settled) landed = { before: base, after: outcome.blocks, touched: outcome.touched };
          }

          if (!settled) {
            // Leaving it pending is the difference between "this could not be
            // applied" and losing it: the author can still read it in place
            // and reject it. Marking it accepted while applying nothing threw
            // the operation away and told them it had landed.
            applyError =
              'That change refers to a part of the document that is no longer there, so it was not applied. Reject it to clear it.';
          }
        }
      }

      // Rejecting an insert moves the inserts that continued from it onto its
      // place, and takes changes to its block with it (see `rejectChange`).
      // It used to reject the whole rest of a suggested section.
      const decided: Array<readonly [string, 'accepted' | 'rejected']> =
        status === 'rejected'
          ? rejectChange(state.sets, changeId).rejected.map((id) => [id, 'rejected'] as const)
          : settled
            ? [[changeId, 'accepted'] as const]
            : [];

      const decide = (sets: ChangeSet[]): ChangeSet[] => {
        if (status === 'rejected') return rejectChange(sets, changeId).sets;
        if (!settled) return sets;
        const accepted = markChanges(sets, new Set([changeId]), 'accepted');
        return landed
          ? rebaseAfterAccept(accepted, landed.before, landed.after, landed.touched)
          : accepted;
      };

      updateForDocument((current) => ({
        ...current,
        error: applyError ?? current.error,
        sets: pruneSettledSets(decide(current.sets)),
        focusedChangeId:
          settled && current.focusedChangeId === changeId ? null : current.focusedChangeId,
      }));

      // Durable batches outlive this page. Without a record, a reload stages
      // every one of their operations again, decided or not.
      rememberDecisions(state.sets, decided);
      if (landed) {
        const accepted = markChanges(state.sets, new Set([changeId]), 'accepted');
        rememberRebased(accepted, rebaseAfterAccept(accepted, landed.before, landed.after, landed.touched));
      }

      // This decision may have been the batch's last one — retire the server
      // record so it neither re-stages on reload nor blocks the next run.
      const decidedIds = new Set(decided.map(([id]) => id));
      for (const set of concludedDurableSets(decidedIds)) {
        const anyAccepted =
          set.changes.some((change) => change.status === 'accepted')
          || (settled && status === 'accepted' && set.changes.some((c) => c.id === changeId));
        void resolveDurableSet(set, anyAccepted ? 'decided' : 'rejected');
      }

      // The card that held focus is gone with its buttons; focus moves on to
      // the next suggestion once the decision is on screen (see the effect
      // below). A refused accept leaves the card, and focus, where they are.
      if (settled) {
        advanceRef.current = {
          order: readingOrder,
          from: changeId,
          fallback: fallbackFor(target, status, blocks),
        };
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
    const open = orderedChanges(state.sets).filter((change) => change.status === 'pending');
    if (open.length === 0) return;

    // A suggestion written against text the author has changed since stays
    // for them to look at: applying it would overwrite that text unseen.
    const stale = open.filter((change) => isStale(change, blocks));
    // Inserts already in the document are decided without applying them.
    const landedIds = new Set(open.filter((change) => hasLanded(change, blocks)).map((change) => change.id));
    const queue = open.filter(
      (change) => !landedIds.has(change.id) && !stale.some((candidate) => candidate.id === change.id),
    );
    const sets = markChanges(state.sets, landedIds, 'accepted');

    let plan = resolveAcceptPlan(queue, sets, blocks);
    let applyDesynced = 0;
    let landed: { before: Block[]; after: Block[]; touched: string[] } | null = null;
    if (plan.ops.length > 0) {
      let base = blocks;
      let outcome = applyPatch(plan.ops, { persist: true, base: blocks });
      if (outcome.stale) {
        // Same recompute-and-retry as `settle`: the document moved between
        // render and click, so the plan's positions no longer match it.
        const liveBlocks = outcome.blocks;
        base = liveBlocks;
        plan = resolveAcceptPlan(queue, sets, liveBlocks);
        outcome = plan.ops.length > 0
          ? applyPatch(plan.ops, { persist: true, base: liveBlocks })
          : { blocks: liveBlocks, desynced: [], touched: [] };
      }
      markRecentlyChanged(outcome.touched);
      // Ops that desynced at apply time count as failures too — simulation
      // passing is no guarantee the live document agreed.
      applyDesynced = outcome.stale ? plan.ops.length : outcome.desynced.length;
      if (!outcome.stale) landed = { before: base, after: outcome.blocks, touched: outcome.touched };
    }

    // Only what this run actually decided. Clearing every set discarded a
    // batch that had arrived while the confirmation dialog was open — the
    // author never saw it, and it was counted as reviewed.
    const decided = new Set([...landedIds, ...plan.applied.map((change) => change.id)]);
    const failed = plan.desynced.length + applyDesynced;
    const messages = [
      failed > 0
        ? `${failed} change${failed === 1 ? '' : 's'} could not be applied — the document has moved on since the assistant read it.`
        : null,
      stale.length > 0 ? staleSkippedError(stale.length) : null,
    ].filter((message): message is string => message !== null);

    const decide = (current: ChangeSet[]): ChangeSet[] => {
      const accepted = markChanges(current, decided, 'accepted');
      return landed
        ? rebaseAfterAccept(accepted, landed.before, landed.after, landed.touched)
        : accepted;
    };

    updateForDocument((current) => ({
      ...current,
      sets: pruneSettledSets(decide(current.sets)),
      focusedChangeId: null,
      error: messages.length > 0 ? messages.join(' ') : current.error,
    }));

    rememberDecisions(
      state.sets,
      orderedChanges(state.sets)
        .filter((change) => decided.has(change.id))
        .map((change) => [change.id, 'accepted'] as const),
    );
    if (landed) {
      const accepted = markChanges(state.sets, decided, 'accepted');
      rememberRebased(accepted, rebaseAfterAccept(accepted, landed.before, landed.after, landed.touched));
    }

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
      sets: pruneSettledSets(markChanges(current.sets, decided, 'rejected')),
      focusedChangeId: null,
    }));

    // Recorded first: if retiring the batch fails, the next load finds it
    // fully decided and retires it again instead of staging it whole.
    rememberDecisions(
      state.sets,
      orderedChanges(state.sets)
        .filter((change) => decided.has(change.id))
        .map((change) => [change.id, 'rejected'] as const),
    );

    // Rejected batches must clear their server record too — a pending change
    // set re-stages on reload and blocks the agent's next proposal.
    for (const set of concludedDurableSets(decided)) {
      const anyAccepted = set.changes.some((change) => change.status === 'accepted');
      void resolveDurableSet(set, anyAccepted ? 'decided' : 'rejected');
    }
  }, [concludedDurableSets, resolveDurableSet, state.sets, updateForDocument]);

  /**
   * Mark a change as the one under review and bring its card to focus.
   * `reveal` scrolls it to the middle and flashes it, for Next/Previous;
   * `advance` is the quieter move after a decision (see `focusInPlace`).
   */
  const showChange = useCallback(
    (changeId: string, how: 'reveal' | 'advance', fallback?: FocusFallback) => {
      if (!updateForDocument((current) => ({ ...current, focusedChangeId: changeId }))) {
        return;
      }
      // Rendered by the canvas; the frame delay lets a just-mounted card exist.
      requestAnimationFrame(() => {
        if (activeDocumentIdRef.current !== ownerDocumentId) return;
        const card = document.querySelector<HTMLElement>(
          `[data-change-id="${attributeValue(changeId)}"]`,
        );
        if (how === 'reveal') {
          // Scrolling alone is sighted-only: Next/Previous also has to put
          // focus on the card, or the next Tab walks away from what was just
          // revealed.
          revealElement(card);
        } else if (card) {
          focusInPlace(card);
        } else if (fallback) {
          focusDecidedBlock(fallback);
        }
      });
    },
    [ownerDocumentId, updateForDocument],
  );

  const focusChange = useCallback(
    (changeId: string) => showChange(changeId, 'reveal'),
    [showChange],
  );

  /**
   * After Accept or Reject, focus moves to the next suggestion further down
   * the page — the nearest one above it once there is none below — and back
   * into the changed block's text once there is nothing left to review.
   *
   * The buttons that had focus unmount with their card, and focus used to
   * fall to <body>, so the next Tab started again at the top of the app.
   */
  useEffect(() => {
    const intent = advanceRef.current;
    if (!intent) return;
    advanceRef.current = null;
    const live = new Set(pendingChanges(state.sets).map((change) => change.id));
    const at = intent.order.indexOf(intent.from);
    const next =
      intent.order.slice(at + 1).find((id) => live.has(id))
      ?? intent.order.slice(0, Math.max(at, 0)).reverse().find((id) => live.has(id))
      // Something arrived while the author was deciding.
      ?? pendingInDocumentOrder(blocksRef.current, state.sets)[0]?.id;
    if (next) {
      showChange(next, 'advance', intent.fallback);
      return;
    }
    requestAnimationFrame(() => {
      if (activeDocumentIdRef.current !== ownerDocumentId) return;
      focusDecidedBlock(intent.fallback);
    });
  }, [ownerDocumentId, showChange, state.sets]);

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
