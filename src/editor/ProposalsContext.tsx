import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useActiveBlock, useEditorActions } from './editorContextState';
import { useDocumentSession, useEditorDoc } from './documentSessionState';
import type { Block, Doc, ToolAction, ToolOperation } from './types';
import {
  decideChangeSetOperations,
  decisionRefusal,
  getChangeSet,
  listPendingChangeSets,
  rejectChangeSet,
  type AgentChangeSet,
  type DecisionOrigin,
} from '@/data/documentHistory';
import { isRetryableProblem } from '@/api/retry';
import {
  buildChangeSet,
  caretHeldBlock,
  isReady,
  isStale,
  linkPrecedence,
  markChanges,
  markOutdated,
  orderedChanges,
  pendingChanges,
  pendingInDocumentOrder,
  planAutoApply,
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
import {
  ProposalsContext,
  type AutoAppliedSet,
  type ProposalsContextValue,
  type ReceiveOptions,
} from './proposalsContextState';
import { registerModuleReset } from '@/lib/moduleState';
export type { ProposalsContextValue } from './proposalsContextState';

/**
 * What the editor applied of an Auto set, as one undo step: the set as it
 * arrived, or a change the caret held, once the caret left its block.
 * `after` is the page the step left: while the page is still exactly that,
 * the step is the newest one in the undo journal, so Undo takes back this
 * step and nothing else.
 */
type AutoAppliedRecord = {
  id: string;
  setId: string;
  changeSetId: string;
  applied: number;
  touched: string[];
  after: Pick<Doc, 'blocks' | 'name' | 'sources' | 'citationStyle'>;
  undone: boolean;
};

type DocumentProposalsState = {
  documentId: string | null;
  sets: ChangeSet[];
  invites: DocumentInvite[];
  focusedChangeId: string | null;
  error: string | null;
  autoApplied: AutoAppliedRecord[];
};

function emptyState(documentId: string | null): DocumentProposalsState {
  return {
    documentId,
    sets: [],
    invites: [],
    focusedChangeId: null,
    error: null,
    autoApplied: [],
  };
}

/** Whether the page is still exactly as an Auto step left it. */
function isLatestStep(record: AutoAppliedRecord, doc: Doc): boolean {
  return doc.blocks === record.after.blocks
    && doc.name === record.after.name
    && doc.sources === record.after.sources
    && doc.citationStyle === record.after.citationStyle;
}

/**
 * How an Auto set should be staged: applied at once, with what says whether
 * Auto is still on for its page and chat, or left waiting.
 */
type AutoStaging = { stillOn: () => boolean } | 'wait' | null;

/** The set with the block whose caret holds back one of its changes, or with none. */
function heldAt(set: ChangeSet, blockId: string | null): ChangeSet {
  if (blockId) return set.autoHeldAt === blockId ? set : { ...set, autoHeldAt: blockId };
  if (set.autoHeldAt === undefined) return set;
  const { autoHeldAt: _released, ...rest } = set;
  return rest;
}

const NO_AUTO_APPLIED: AutoAppliedSet[] = [];

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
    ? '1 suggestion was not applied because its text changed after it was suggested. It is still on the page for you to reject.'
    : `${count} suggestions were not applied because their text changed after they were suggested. They are still on the page for you to reject.`;
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
registerModuleReset(() => decisionChains.clear());

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
 *
 * `origin` is `auto` for the operations the editor applied from an
 * `apply_policy: "auto"` set. One kept to be sent again goes as the author's
 * own (`manual`): this browser's record does not keep who decided.
 */
function sendDecisions(
  workspaceId: string,
  documentId: string,
  changeSetId: string,
  decisions: readonly ReviewDecision[],
  origin: DecisionOrigin = 'manual',
): Promise<void> {
  if (decisions.length === 0) return Promise.resolve();
  const send = async () => {
    let rest = [...decisions];
    while (rest.length > 0) {
      try {
        await decideChangeSetOperations(
          workspaceId,
          documentId,
          changeSetId,
          rest.map(([opIndex, decision]) => ({ opIndex, decision })),
          origin,
        );
        break;
      } catch (cause) {
        const refusal = decisionRefusal(cause);
        if (refusal.kind === 'transient') {
          saveReview(workspaceId, documentId, changeSetId, { decisions: rest });
          return;
        }
        if (refusal.kind === 'final') break;
        const others = rest.filter(([opIndex]) => opIndex !== refusal.opIndex);
        if (others.length === rest.length) break;
        rest = others;
      }
    }
    forgetDecisions(workspaceId, documentId, changeSetId, decisions.map(([opIndex]) => opIndex));
  };
  const queued = (decisionChains.get(changeSetId) ?? Promise.resolve()).then(send);
  decisionChains.set(changeSetId, queued);
  void queued.finally(() => {
    if (decisionChains.get(changeSetId) === queued) decisionChains.delete(changeSetId);
  });
  return queued;
}

/** Record these decisions on the server, for each durable batch they belong to. */
function rememberDecisions(
  workspaceId: string,
  sets: ChangeSet[],
  decided: ReadonlyArray<readonly [string, 'accepted' | 'rejected']>,
): void {
  for (const set of sets) {
    const byId = new Map(set.changes.map((change) => [change.id, change]));
    const decisions: ReviewDecision[] = [];
    for (const [id, status] of decided) {
      const opIndex = byId.get(id)?.opIndex;
      if (opIndex !== undefined) decisions.push([opIndex, status]);
    }
    if (decisions.length > 0) void sendDecisions(workspaceId, set.documentId, set.changeSetId, decisions);
  }
}

/**
 * Write the fingerprints of every durable batch `rebased` changed. A batch
 * with server targets needs none: a reload asks the server what each block
 * looks like then.
 */
function rememberRebased(workspaceId: string, before: ChangeSet[], rebased: ChangeSet[]): void {
  rebased.forEach((set, index) => {
    if (set === before[index] || set.targetsOnServer) return;
    saveReview(workspaceId, set.documentId, set.changeSetId, { bases: basesOf(set) });
  });
}

/** What the server said about a durable batch when it was read. */
type ServerReview = {
  /** In the order they were made. */
  decisions: ReviewDecision[];
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
    decisions: changeSet.operationDecisions.map(
      ({ opIndex, decision }): ReviewDecision => [opIndex, decision],
    ),
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
  workspaceId: string,
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
        parent = await getChangeSet(workspaceId, documentId, parentId);
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
 * The decisions come from the server. This browser's record only holds the
 * ones that could not be sent, which are applied after the server's and sent
 * again.
 *
 * The same goes for staleness: with the server's targets, a change whose
 * block was edited after the proposal is marked from them; without, the
 * staging fingerprints kept in this browser are restored.
 */
function resumeDurableSet(
  workspaceId: string,
  built: ChangeSet,
  blocks: readonly Block[] | null,
  server: ServerReview,
  canDecide: boolean,
): ChangeSet {
  const { documentId, changeSetId } = built;
  const recorded = server.decisions;
  const targets = server.targets;
  const set: ChangeSet = { ...built, ...(targets ? { targetsOnServer: true } : null) };

  const local = loadReview(workspaceId, documentId, changeSetId);
  const onServer = new Set(recorded.map(([opIndex]) => opIndex));
  const unsent = (local?.decisions ?? []).filter(([opIndex]) => !onServer.has(opIndex));
  const stored = local || onServer.size > 0
    ? {
        decisions: [...recorded, ...unsent],
        bases: targets ? {} : local?.bases ?? {},
      }
    : null;
  const { set: resumed, landed } = resumeReview(set, stored, blocks);
  const found = landed.map((opIndex): ReviewDecision => [opIndex, 'accepted']);

  // The server already has these; whatever this browser held for them, the
  // same or not, is no longer needed.
  forgetDecisions(workspaceId, documentId, changeSetId, [...onServer]);
  // A viewer decides nothing (D6): this browser's unsent decisions wait for
  // an open that can send them, and nothing is sent from here.
  if (!canDecide) return targets ? markOutdated(resumed, targets, server.earlier) : resumed;
  void sendDecisions(workspaceId, documentId, changeSetId, [...unsent, ...found]);
  saveReview(workspaceId, documentId, changeSetId, { decisions: [], bases: targets ? {} : basesOf(resumed) });
  return targets ? markOutdated(resumed, targets, server.earlier) : resumed;
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
 * The assistant does not apply anything. `doc_edit` stores its operations as
 * a change set and the stream names it; the set is read here and the
 * document renders each change in place with accept and reject controls, and
 * only an accept writes to the editor state that autosave persists — or, for
 * a set the server stored as `auto`, the editor's own accept (D18). That
 * keeps the decision where the author can see its consequences — on the
 * paragraph — instead of behind a summary in a chat bubble.
 */
export function ProposalsProvider({ children }: { children: ReactNode }) {
  const { doc, blocks } = useEditorDoc();
  const { documentId, restoreEpoch, restoreReason, readOnly } = useDocumentSession();
  const workspaceId = useWorkspaceId();
  /**
   * A read-only page (a viewer, D6): the suggestions are shown, and nothing
   * accepts, rejects or applies them, by hand or by Auto, since each would
   * be an edit or a decision the server refuses.
   */
  const readOnlyRef = useRef(readOnly);
  useLayoutEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);
  const { applyPatch, batch, markRecentlyChanged, undo } = useEditorActions();
  const { activeId } = useActiveBlock();
  const ownerDocumentId = documentId;
  const activeDocumentIdRef = useRef(ownerDocumentId);

  /**
   * The document as it stands, for staging that finishes after an await.
   * A batch records what its blocks looked like when it was staged (see
   * `isStale`), and that has to be the document at that moment, not the one
   * the callback was created with.
   */
  const blocksRef = useRef(blocks);
  const docRef = useRef(doc);
  /** The block with the caret, which Auto leaves alone (D18). */
  const activeIdRef = useRef<string | null>(activeId ?? null);
  useLayoutEffect(() => {
    blocksRef.current = blocks;
    docRef.current = doc;
    activeIdRef.current = activeId ?? null;
  }, [activeId, blocks, doc]);

  // Keep one mounted provider while making its value document-scoped. The
  // render-phase reset is conditional on the identity mismatch, which React
  // resolves before committing descendants. They never observe the previous
  // document's review state.
  const resetState = useMemo(() => emptyState(ownerDocumentId), [ownerDocumentId]);
  const [storedState, setStoredState] = useState<DocumentProposalsState>(() => resetState);
  const needsReset = storedState.documentId !== ownerDocumentId;
  if (needsReset) setStoredState(resetState);
  const state = needsReset ? resetState : storedState;

  /** The staged batches as last rendered, for an Auto set applied after an await. */
  const setsRef = useRef(state.sets);
  useLayoutEffect(() => {
    setsRef.current = state.sets;
  }, [state.sets]);

  /**
   * Change sets already taken, keyed by their id.
   *
   * Held in a ref rather than derived from state because `receive` has to
   * answer "how many changes did this add?" synchronously — the chat transcript
   * prints that number. Deciding it inside the state updater meant a
   * redelivered batch was correctly ignored and still reported as N new
   * changes, so the reply claimed edits the document did not have.
   */
  const seenBatchesRef = useRef<Set<string>>(new Set());

  /**
   * For each Auto set with a change the caret holds back (`autoHeldAt`):
   * whether Auto is still on for its page and chat.
   */
  const autoStillOnRef = useRef<Map<string, () => boolean>>(new Map());

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
    autoStillOnRef.current = new Map();
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

  /** Change sets with a rejection in flight; blocks double submission. */
  const supersedingSetsRef = useRef<Set<string>>(new Set());

  /**
   * Retire the server-side record of a durable batch a restore left
   * undecided.
   *
   * The review itself is per change, in the editor, exactly like any other
   * batch: accepted operations are applied locally and autosaved as author
   * edits, and each decision is recorded on the server
   * (`rememberDecisions`), which retires the set itself when the last one is
   * recorded. A restore leaves operations undecided, so it rejects the set
   * with a note instead.
   */
  const supersedeDurableSet = useCallback(
    async (set: ChangeSet) => {
      const changeSetId = set.changeSetId;
      if (supersedingSetsRef.current.has(changeSetId)) return;
      supersedingSetsRef.current.add(changeSetId);
      try {
        await rejectChangeSet(workspaceId, set.documentId, changeSetId, 'Superseded: the page was restored to another version');
        // Kept until now on purpose: if the request fails, the next load
        // stages the batch again, where it can simply be rejected.
        forgetReview(workspaceId, set.documentId, changeSetId);
      } catch {
        // Cleanup only: the restore has already replaced the page. The worst
        // case is this batch reappearing on the next load.
      } finally {
        supersedingSetsRef.current.delete(changeSetId);
      }
    },
    [workspaceId],
  );

  /**
   * Apply an `apply_policy: "auto"` set (D18): every change that is current
   * and editable, in one `batch()` so it is one undo step, through the accept
   * path, each one an ordinary edit. Their decisions are recorded with
   * `origin: "auto"`. The rest stays staged for the author (`planAutoApply`),
   * and so does anything that finds no place.
   *
   * `staged` is false for a set as it arrives and true for one already on
   * the page, whose change the caret held back. A change still held by the
   * caret is marked with its block (`autoHeldAt`), and `stillOn` is kept to
   * ask, when the caret leaves it, whether Auto is still on.
   */
  const applyAutoSet = useCallback((set: ChangeSet, stillOn: () => boolean, staged: boolean) => {
    if (readOnlyRef.current) return;
    const { documentId: setDocumentId, changeSetId } = set;
    const sets = [...setsRef.current.filter((candidate) => candidate.id !== set.id), set];

    const outcome = batch(() => {
      let base = blocksRef.current;
      // Twice at most: the author can type between the render these blocks
      // come from and now, and the plan is then made again on the live ones.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { apply } = planAutoApply(set, sets, base, activeIdRef.current);
        const plan = resolveAcceptPlan(apply, sets, base);
        if (plan.ops.length === 0) return null;
        const result = applyPatch(plan.ops, { persist: true, base });
        if (result.stale) {
          base = result.blocks;
          continue;
        }
        const missed = new Set(result.desynced);
        return {
          applied: plan.applied.filter((_, index) => {
            const op = plan.ops[index];
            return op !== undefined && !missed.has(op);
          }),
          before: base,
          after: result.blocks,
          touched: result.touched,
          renamed: plan.ops.reduce<string | undefined>(
            (name, op) => (op.op === 'update_meta' && op.meta?.name ? op.meta.name : name),
            undefined,
          ),
        };
      }
      return null;
    });

    const applied = outcome?.applied ?? [];
    const appliedIds = new Set(applied.map((change) => change.id));
    const firstHeld = set.changes.find(
      (change) => change.status === 'pending' && !appliedIds.has(change.id),
    );
    const page = docRef.current;
    const record: AutoAppliedRecord | null = outcome && applied.length > 0
      ? {
          id: uid(),
          setId: set.id,
          changeSetId,
          applied: applied.length,
          touched: outcome.touched,
          after: {
            blocks: outcome.after,
            name: outcome.renamed ?? page.name,
            sources: page.sources,
            citationStyle: page.citationStyle,
          },
          undone: false,
        }
      : null;
    const settle = (current: ChangeSet[]): ChangeSet[] => {
      const accepted = markChanges(current, appliedIds, 'accepted');
      return outcome ? rebaseAfterAccept(accepted, outcome.before, outcome.after, outcome.touched) : accepted;
    };

    // What the caret still holds back, on the page this step left.
    const left = settle(sets);
    const settled = left.find((candidate) => candidate.id === set.id);
    const holdAt = settled
      ? caretHeldBlock(settled, left, outcome?.after ?? blocksRef.current, activeIdRef.current)
      : null;
    if (holdAt) autoStillOnRef.current.set(set.id, stillOn);
    else autoStillOnRef.current.delete(set.id);

    updateForDocument((current) => {
      const focused = current.focusedChangeId !== null && !appliedIds.has(current.focusedChangeId)
        ? current.focusedChangeId
        : null;
      return {
        ...current,
        sets: pruneSettledSets(
          settle(staged ? current.sets : [...current.sets, set])
            .map((candidate) => (candidate.id === set.id ? heldAt(candidate, holdAt) : candidate)),
        ),
        // What is left is for the author; the first of it is where to look.
        focusedChangeId: focused ?? firstHeld?.id ?? null,
        autoApplied: record ? [...current.autoApplied, record] : current.autoApplied,
      };
    });

    if (outcome) markRecentlyChanged(outcome.touched);
    void sendDecisions(
      workspaceId,
      setDocumentId,
      changeSetId,
      applied.flatMap((change): ReviewDecision[] => (change.opIndex === undefined ? [] : [[change.opIndex, 'accepted']])),
      'auto',
    );
    if (outcome) {
      const accepted = markChanges(sets, appliedIds, 'accepted');
      rememberRebased(workspaceId, accepted, rebaseAfterAccept(accepted, outcome.before, outcome.after, outcome.touched));
    }
  }, [applyPatch, batch, markRecentlyChanged, updateForDocument, workspaceId]);

  /**
   * A change of an Auto set held because the caret was in its block is
   * applied once the caret leaves that block, as a step of its own, while
   * Auto is still on for the page and chat. Otherwise it stays for the
   * author. One that went stale meanwhile stays as well (`planAutoApply`).
   */
  useEffect(() => {
    const caret = activeId ?? null;
    for (const set of state.sets) {
      if (set.autoHeldAt === undefined || set.autoHeldAt === caret) continue;
      const stillOn = autoStillOnRef.current.get(set.id);
      autoStillOnRef.current.delete(set.id);
      if (stillOn?.()) {
        applyAutoSet(set, stillOn, true);
      } else {
        updateForDocument((current) => ({
          ...current,
          sets: current.sets.map((candidate) => (candidate.id === set.id ? heldAt(candidate, null) : candidate)),
        }));
      }
    }
  }, [activeId, applyAutoSet, state.sets, updateForDocument]);

  /**
   * Stage a durable batch, or retire it if nothing in it is left to decide
   * (the request that would have retired it failed last time, or the
   * decisions were made in another tab and the document already holds them).
   * An Auto set is applied instead (`auto: 'apply'`), or marked as waiting.
   */
  const stageDurableSet = useCallback(
    (
      built: ChangeSet,
      { restaged, server, auto = null }: { restaged: boolean; server: ServerReview; auto?: AutoStaging },
    ) => {
      const resumed = resumeDurableSet(workspaceId, built, restaged ? blocksRef.current : null, server, !readOnlyRef.current);
      const first = resumed.changes.find((change) => change.status === 'pending');
      // Nothing left to decide: the decisions `resumeDurableSet` sent retire it.
      if (!first) return;
      if (auto !== null && auto !== 'wait' && !readOnlyRef.current) {
        applyAutoSet(resumed, auto.stillOn, false);
        return;
      }
      const set = auto === 'wait' ? { ...resumed, autoWaiting: true } : resumed;
      updateForDocument((current) => ({
        ...current,
        sets: [...current.sets, set],
        // A batch that just arrived is the one the author is waiting for; one
        // found on opening the document is not singled out.
        focusedChangeId: restaged ? current.focusedChangeId : current.focusedChangeId ?? first.id,
      }));
    },
    [applyAutoSet, updateForDocument, workspaceId],
  );

  /**
   * Fetch a durable change set's operations and stage them for review.
   *
   * The stream carries only the change set id — the operations are redacted
   * out of the SSE payload — so staging is necessarily asynchronous. Anything
   * fetched for a document the author has since left is dropped.
   */
  const stageDurableProposal = useCallback(
    async (action: ToolAction, changeSetId: string, options: ReceiveOptions) => {
      const targetDocumentId = action.documentId || ownerDocumentId;
      if (!targetDocumentId) return;
      // A restore that lands while the fetch is in flight moves the document
      // to another version; a batch computed against the old one must not be
      // staged onto it.
      const epochAtStart = restoreEpochRef.current;
      try {
        const fetched = await getChangeSet(workspaceId, targetDocumentId, changeSetId);
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
          earlier = await ancestorStages(workspaceId, targetDocumentId, fetched, knownChangeSetsRef.current);
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
        // The server's record decides, never the stream or the switch: only a
        // set stored as `auto` is applied, and only while Auto is still on.
        const stillOn = options.autoApply;
        const auto: AutoStaging = fetched.applyPolicy !== 'auto'
          ? null
          : stillOn?.() ? { stillOn } : 'wait';
        stageDurableSet(set, { restaged: false, server: serverReview(fetched, earlier), auto });
      } catch (cause) {
        // The request layer already waited out a server still catching up with
        // the save this batch was computed against, so reaching here means the
        // wait was not enough — the batch is safe on the server either way, and
        // reopening the document re-stages it.
        updateForDocument((current) => ({
          ...current,
          error: isRetryableProblem(cause)
            ? 'The assistant prepared changes, but the server is still catching up. Reopen the page in a moment to review them.'
            : 'The assistant prepared changes, but they could not be loaded for review. Reopen the page to try again.',
        }));
      }
    },
    [ownerDocumentId, stageDurableSet, updateForDocument, workspaceId],
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
        const pending = await listPendingChangeSets(workspaceId, ownerDocumentId);
        if (cancelled || activeDocumentIdRef.current !== ownerDocumentId) return;
        if (restoreEpochRef.current !== epochAtStart) return;
        pruneReviews(
          workspaceId,
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
            earlier = await ancestorStages(workspaceId, ownerDocumentId, changeSet, knownChangeSetsRef.current);
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
              status: 'proposed',
              actions: changeSet.operations,
              changeSetId: changeSet.changeSetId,
            },
            blocksRef.current,
          );
          if (set.changes.length === 0) continue;
          // An Auto turn's set found on opening the page was not seen by the
          // author, and leaving the page turned Auto off: it waits (D18).
          stageDurableSet(set, {
            restaged: true,
            server: serverReview(changeSet, earlier),
            auto: changeSet.applyPolicy === 'auto' ? 'wait' : null,
          });
        }
      } catch {
        // Silent: live proposals still arrive over the stream, and a document
        // without v2 history simply has nothing pending.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerDocumentId, relistTick, stageDurableSet, updateForDocument, workspaceId]);

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
        if (!set.changes.some((change) => change.status === 'pending')) continue;
        void supersedeDurableSet(set);
      }
    }
    advanceRef.current = null;
    autoStillOnRef.current = new Map();
    setStoredState(emptyState(activeDocumentIdRef.current));
    if (sameHistory) setRelistTick((tick) => tick + 1);
  }, [restoreEpoch, restoreReason, state, supersedeDurableSet]);

  /**
   * Take one `tool_action` from a turn.
   *
   * A `proposed` action names the change set the server stored; the stream
   * carries none of its operations. It is read and staged, or applied for an
   * Auto turn: `options.autoApply` says whether the turn's chat has Auto on,
   * and it is asked once the set has been read, so a set that arrives after
   * Auto was turned off waits. The server-counted size is reported at once,
   * so the transcript can say what was prepared.
   *
   * `applied` is a page `doc_create` made, announced by its
   * `create_document` operation and offered rather than opened. `error`
   * describes work the server did not do. `doc_edit` never commits by itself.
   */
  const receive = useCallback<ProposalsContextValue['receive']>((action, options = {}) => {
    if (activeDocumentIdRef.current !== ownerDocumentId) return { changes: 0, invited: false };

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
     * another document, whose change set must never be staged here.
     *
     * So the two halves are scoped separately: change sets require an exact
     * match, invitations do not.
     */
    const targetsThisDocument =
      ownerDocumentId !== null
      && (action.documentId === ownerDocumentId
        // A payload that names no document is answering the request this
        // client addressed to *this* document. Requiring an exact match
        // dropped it in total silence, which reads as the assistant having
        // done nothing.
        || action.documentId === '');

    let changes = 0;
    if (targetsThisDocument && action.status === 'proposed' && action.changeSetId) {
      const signature = `change-set:${action.changeSetId}`;
      // A redelivery adds nothing, and saying otherwise made the reply claim
      // changes the document does not have.
      if (!seenBatchesRef.current.has(signature)) {
        seenBatchesRef.current.add(signature);
        void stageDurableProposal(action, action.changeSetId, options);
        changes = action.proposalOperationCount ?? 0;
      }
    }

    const invite = createOp?.documentId && createOp.documentId !== ownerDocumentId ? createOp.documentId : null;
    const error = action.status === 'error' && (targetsThisDocument || invited)
      ? action.message || 'The assistant could not prepare that edit.'
      : null;
    if (invite || error) {
      updateForDocument((current) => {
        const invites = invite && !current.invites.some((candidate) => candidate.documentId === invite)
          ? [...current.invites, { id: uid(), documentId: invite, receivedAt: Date.now() }]
          : current.invites;
        const nextError = error ?? current.error;
        return invites === current.invites && nextError === current.error
          ? current
          : { ...current, invites, error: nextError };
      });
    }
    return { changes, invited };
  }, [stageDurableProposal, ownerDocumentId, updateForDocument]);

  const settle = useCallback(
    (changeId: string, status: 'accepted' | 'rejected') => {
      if (activeDocumentIdRef.current !== ownerDocumentId || readOnlyRef.current) return;
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
              'That change refers to a part of the page that is no longer there, so it was not applied. Reject it to clear it.';
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
      rememberDecisions(workspaceId, state.sets, decided);
      if (landed) {
        const accepted = markChanges(state.sets, new Set([changeId]), 'accepted');
        rememberRebased(workspaceId, accepted, rebaseAfterAccept(accepted, landed.before, landed.after, landed.touched));
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
      markRecentlyChanged,
      ownerDocumentId,
      state.sets,
      updateForDocument,
      workspaceId,
    ],
  );

  const accept = useCallback((id: string) => settle(id, 'accepted'), [settle]);
  const reject = useCallback((id: string) => settle(id, 'rejected'), [settle]);

  /**
   * Accept these pending changes in one patch, except the ones written
   * against text the author has changed since. `open` is in authoring order.
   */
  const acceptOpen = useCallback((open: ProposedChange[]) => {
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
        ? `${failed} change${failed === 1 ? '' : 's'} could not be applied — the page has moved on since the assistant read it.`
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
      workspaceId,
      state.sets,
      orderedChanges(state.sets)
        .filter((change) => decided.has(change.id))
        .map((change) => [change.id, 'accepted'] as const),
    );
    if (landed) {
      const accepted = markChanges(state.sets, decided, 'accepted');
      rememberRebased(workspaceId, accepted, rebaseAfterAccept(accepted, landed.before, landed.after, landed.touched));
    }
  }, [
    applyPatch,
    blocks,
    markRecentlyChanged,
    state.sets,
    updateForDocument,
    workspaceId,
  ]);

  const acceptAll = useCallback(() => {
    if (activeDocumentIdRef.current !== ownerDocumentId || readOnlyRef.current) return;
    // Original authoring order, across batches: a later batch may build on an
    // earlier one, and replaying them out of order puts blocks in the wrong
    // place even though each operation on its own is valid.
    acceptOpen(orderedChanges(state.sets).filter((change) => change.status === 'pending'));
  }, [acceptOpen, ownerDocumentId, state.sets]);

  /**
   * "Apply all" on the changes an Auto turn left waiting: one undo step, and
   * the author's own decision. What it cannot apply stays as ordinary
   * suggestions, no longer singled out.
   */
  const applyWaiting = useCallback(() => {
    if (activeDocumentIdRef.current !== ownerDocumentId || readOnlyRef.current) return;
    const waiting = new Set(state.sets.filter((set) => set.autoWaiting).map((set) => set.id));
    if (waiting.size === 0) return;
    batch(() => acceptOpen(
      orderedChanges(state.sets.filter((set) => waiting.has(set.id)))
        .filter((change) => change.status === 'pending'),
    ));
    updateForDocument((current) => ({
      ...current,
      sets: current.sets.map((set) => (waiting.has(set.id) ? { ...set, autoWaiting: false } : set)),
    }));
  }, [acceptOpen, batch, ownerDocumentId, state.sets, updateForDocument]);

  /**
   * Take back an Auto step from the chat. Only while it is the newest step
   * in the undo journal, which is when the page is still exactly as it left
   * it: an older one would be reached only by undoing the author's own edits
   * first. Returns whether it was undone.
   */
  const undoAutoApplied = useCallback((id: string): boolean => {
    const record = state.autoApplied.find((candidate) => candidate.id === id);
    if (!record || !isLatestStep(record, docRef.current)) return false;
    undo();
    updateForDocument((current) => ({
      ...current,
      autoApplied: current.autoApplied.map((candidate) => (
        candidate.id === id ? { ...candidate, undone: true } : candidate
      )),
    }));
    return true;
  }, [state.autoApplied, undo, updateForDocument]);

  const rejectAll = useCallback(() => {
    if (readOnlyRef.current) return;
    // Same reasoning as `acceptAll`: reject what was on screen, not whatever
    // has arrived since.
    const decided = new Set(pendingChanges(state.sets).map((change) => change.id));
    updateForDocument((current) => ({
      ...current,
      sets: pruneSettledSets(markChanges(current.sets, decided, 'rejected')),
      focusedChangeId: null,
    }));

    // Durable batches are retired by the server once every decision is in.
    rememberDecisions(
      workspaceId,
      state.sets,
      orderedChanges(state.sets)
        .filter((change) => decided.has(change.id))
        .map((change) => [change.id, 'rejected'] as const),
    );
  }, [state.sets, updateForDocument, workspaceId]);

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
   * Show an Auto step in the page: the first change it left for the author,
   * or else the blocks it changed, highlighted.
   */
  const revealAutoApplied = useCallback((id: string) => {
    const record = state.autoApplied.find((candidate) => candidate.id === id);
    if (!record) return;
    const held = new Set(state.sets.find((set) => set.id === record.setId)?.changes
      .filter((change) => change.status === 'pending')
      .map((change) => change.id));
    const firstHeld = pendingInDocumentOrder(blocks, state.sets).find((change) => held.has(change.id));
    if (firstHeld) {
      focusChange(firstHeld.id);
      return;
    }
    const present = record.touched.filter((id) => blocks.some((block) => block.id === id));
    const [first] = present;
    if (!first) return;
    markRecentlyChanged(present);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`.block-row[data-block-id="${attributeValue(first)}"]`)
        ?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'center' });
    });
  }, [blocks, focusChange, markRecentlyChanged, state.autoApplied, state.sets]);

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

  const waiting = useMemo(
    () => pendingChanges(state.sets.filter((set) => set.autoWaiting)),
    [state.sets],
  );

  const autoApplied = useMemo<AutoAppliedSet[]>(() => {
    if (state.autoApplied.length === 0) return NO_AUTO_APPLIED;
    // What a set still leaves for the author is told once, under its newest step.
    const newest = new Map(state.autoApplied.map((record) => [record.setId, record.id]));
    return state.autoApplied.map((record) => ({
      id: record.id,
      changeSetId: record.changeSetId,
      applied: record.applied,
      heldIds: newest.get(record.setId) !== record.id
        ? []
        : state.sets.find((set) => set.id === record.setId)?.changes
          .filter((change) => change.status === 'pending')
          .map((change) => change.id) ?? [],
      canUndo: isLatestStep(record, doc),
      // Redone since (Mod+Shift+Z): the page is as the step left it again.
      undone: record.undone && !isLatestStep(record, doc),
    }));
  }, [doc, state.autoApplied, state.sets]);

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
      autoApplied,
      undoAutoApplied,
      revealAutoApplied,
      waiting,
      applyWaiting,
    }),
    [
      accept,
      acceptAll,
      applyWaiting,
      autoApplied,
      clearError,
      dismissInvite,
      focusChange,
      pending,
      ready,
      receive,
      reject,
      rejectAll,
      revealAutoApplied,
      state,
      undoAutoApplied,
      waiting,
    ],
  );

  return <ProposalsContext.Provider value={value}>{children}</ProposalsContext.Provider>;
}
