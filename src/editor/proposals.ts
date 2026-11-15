/**
 * Pending agent changes — the model behind the editor's review workflow.
 *
 * The agent never writes to the document. `doc_edit` stages its operations
 * server-side and streams them down as a `tool_action` with status
 * `proposed`; everything here turns that wire payload into changes the author
 * can read, accept and reject *in the document*, next to the text they affect.
 *
 * Two things this file exists to get right:
 *
 * 1. **Order.** Operations were authored as a sequence. Accepting a subset has
 *    to replay the accepted ones in their original order, or an insert lands
 *    in the wrong place.
 * 2. **Dependencies.** An operation may reference a block an earlier operation
 *    in the same batch created. Rejecting the first moves an insert that
 *    continued from it onto its place, and takes a change to the block itself
 *    with it, rather than let either fail against a block that never existed
 *    (see `rejectChange`).
 *
 * Both used to be aspirations. `order` was written and never read: accepting
 * one change at a time replayed that single operation against the live
 * document, so the result depended on the sequence the author happened to
 * click in. For three paragraphs appended to a section, five of the six click
 * orders produced a document `Accept all` would never produce. The two
 * exported pieces that close that gap are `projectDocument`, which is the only
 * thing that decides where a pending change is *shown*, and `resolveAcceptOp`,
 * which is the only thing that decides where an accepted change *lands*. They
 * read the same authoring order, so the preview is the outcome.
 */

import { kindLabel } from './blockKinds';
import type { Block, ParagraphChild, ToolAction, ToolOperation } from './types';
import { applyPatchToBlocks, coerceBlock } from './docOps';
import { uid } from '../lib/uid';

export type ChangeKind = 'insert' | 'replace' | 'delete' | 'reorder' | 'rename';

export type ChangeStatus = 'pending' | 'accepted' | 'rejected';

export type ProposedChange = {
  id: string;
  /** Index within the batch. Accepted changes replay in this order. */
  order: number;
  kind: ChangeKind;
  op: ToolOperation;
  /**
   * Existing block this change is about — where the review card renders.
   * Null for inserts at the start or end of the document, and for renames.
   */
  anchorBlockId: string | null;
  /** Which side of the anchor an insert belongs on. */
  placement: 'before' | 'after' | 'start' | 'end' | null;
  /** Block id this change brings into existence, if any. */
  producesBlockId: string | null;
  /** Changes in the same batch that must be accepted before this one can be. */
  dependsOn: string[];
  status: ChangeStatus;
  /**
   * Position of the operation in the batch as the server stored it. Unlike
   * `order`, which a rejection renumbers (see `rejectChange`), this never
   * changes, so it is how a decision is remembered across reloads.
   */
  opIndex?: number;
  /**
   * Fingerprint of the block a rewrite or deletion is aimed at, taken when
   * the change was staged. A block that no longer matches it was edited after
   * the suggestion was written (see `isStale`).
   */
  base?: string;
  /**
   * Set when the server's fingerprints say the saved block is not the one
   * this change was written for (see `markOutdated`). It is the server's
   * word on what happened between the proposal and the staging, which `base`
   * cannot see, and nothing done in the editor afterwards takes it back.
   */
  outdated?: boolean;
};

export type ChangeSet = {
  id: string;
  tool: string;
  toolCallId: string;
  documentId: string;
  message?: string;
  receivedAt: number;
  changes: ProposedChange[];
  /**
   * The stored change set this batch is. Each decision on one of its
   * changes is recorded against it, by operation index.
   */
  changeSetId: string;
  /**
   * The server said, per operation, whether the saved document still holds
   * the block it was written for. Without it, the staging fingerprints are
   * kept in this browser across reloads instead.
   */
  targetsOnServer?: boolean;
  /**
   * A set the server stored with `apply_policy: "auto"` that the editor did
   * not apply: it arrived while the page was closed, or after Auto was
   * turned off. Nothing is applied while the author is not looking, so it
   * waits for them under "‹n› changes from an Auto turn are waiting" (D18).
   */
  autoWaiting?: boolean;
  /**
   * The block with the caret, when an Auto set the editor applied left a
   * change because of it (D18). It is applied once the caret leaves that
   * block, while Auto is still on for the page and chat.
   */
  autoHeldAt?: string;
};

/**
 * The server's fingerprints of one operation's target block: as the
 * operation found it, and as the saved document holds it now. They are only
 * comparable with each other, never with `blockFingerprint`.
 */
export type OperationTarget = {
  blockId: string;
  fingerprint: string;
  headFingerprint: string | null;
};

/** A document the assistant created, offered to the author rather than forced. */
export type DocumentInvite = {
  id: string;
  documentId: string;
  receivedAt: number;
};

/* ----------------------------------------
   Building
   ---------------------------------------- */

function classify(op: ToolOperation): ChangeKind | null {
  switch (op.op) {
    case 'replace_block':
      return 'replace';
    case 'insert_block_after':
    case 'insert_block_before':
    case 'insert_block_at_start':
    case 'append_block':
      return 'insert';
    case 'delete_block':
      return 'delete';
    case 'reorder_block':
      return 'reorder';
    case 'update_meta':
      return 'rename';
    default:
      return null;
  }
}

function anchorOf(op: ToolOperation): { blockId: string | null; placement: ProposedChange['placement'] } {
  switch (op.op) {
    case 'replace_block':
    case 'delete_block':
    case 'reorder_block':
      return { blockId: op.blockId, placement: null };
    case 'insert_block_after':
      return { blockId: op.referenceId, placement: 'after' };
    case 'insert_block_before':
      return { blockId: op.referenceId, placement: 'before' };
    case 'insert_block_at_start':
      return { blockId: null, placement: 'start' };
    case 'append_block':
      return { blockId: null, placement: 'end' };
    default:
      return { blockId: null, placement: null };
  }
}

function producedBlockId(op: ToolOperation): string | null {
  if (
    op.op === 'insert_block_after' ||
    op.op === 'insert_block_before' ||
    op.op === 'insert_block_at_start' ||
    op.op === 'append_block'
  ) {
    const id = (op.block as { id?: unknown } | undefined)?.id;
    return typeof id === 'string' && id ? id : null;
  }
  return null;
}

/* ----------------------------------------
   Staleness
   ---------------------------------------- */

/**
 * Change kinds whose effect depends on the text of their block. A rewrite
 * replaces it and a deletion removes it, so either one applied to a paragraph
 * the author has since edited throws that edit away. An insert or a move only
 * needs its block to exist.
 */
const CONTENT_BOUND: ReadonlySet<ChangeKind> = new Set<ChangeKind>(['replace', 'delete']);

/** Fields that change how a block is shown, not what it says. */
const VIEW_ONLY_FIELDS: ReadonlySet<string> = new Set(['collapsed', 'aiHidden', 'locked']);

function stableStringify(value: unknown, skip?: ReadonlySet<string>): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined && !skip?.has(key))
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A short, well-mixed 53-bit hash (cyrb53), so a fingerprint stays small enough to store. */
function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * What a block says, reduced to a short string. Key order and view-only
 * flags (collapsing a block, locking it) do not count as edits.
 */
export function blockFingerprint(block: Block): string {
  return hashText(stableStringify(block, VIEW_ONLY_FIELDS));
}

/**
 * Whether a rewrite or deletion was written against text the author has
 * since changed.
 *
 * Applying it anyway is what this guards against: a rewrite merges the
 * assistant's version over the block, so the author's newer sentence would
 * be replaced without a word. Such a change can still be rejected; it can no
 * longer be accepted (see `isReady`).
 */
export function isStale(change: ProposedChange, blocks: readonly Block[]): boolean {
  if (!CONTENT_BOUND.has(change.kind)) return false;
  const target = blocks.find((block) => block.id === change.anchorBlockId);
  if (target === undefined) return false;
  // Changed between the proposal and the staging, by the server's account.
  if (change.outdated) return true;
  // Changed since it was staged here.
  return change.base !== undefined && blockFingerprint(target) !== change.base;
}

/**
 * Mark the rewrites and deletions of a durable batch whose block changed
 * after the assistant read it, going by the server's fingerprints.
 *
 * `base` is taken when a batch is staged, so on its own it only notices an
 * edit made while the batch is on screen. A paragraph the author rewrote
 * between the proposal and a reload, or on another device, looked untouched,
 * and accepting the suggestion replaced it. The server records each target as
 * its operation found it (`fingerprint`) and reports the same digest for the
 * saved document (`headFingerprint`).
 *
 * The fingerprints of the operations on one block, in order, are the stages
 * that block goes through as the review is accepted. The saved block is
 * current for an operation when it is at that operation's own stage, or at
 * the stage of an earlier operation on the block — those are still
 * undecided, or were rejected. `earlier` carries the stages recorded by the
 * batches this one was written on top of. Anything else is text the
 * suggestion was not written for.
 *
 * `targets` is addressed by operation index. Changes without a target keep
 * relying on `base` alone.
 */
export function markOutdated(
  set: ChangeSet,
  targets: ReadonlyArray<OperationTarget | null>,
  earlier?: ReadonlyMap<string, ReadonlySet<string>>,
): ChangeSet {
  let changed = false;
  const changes = set.changes.map((change) => {
    if (change.opIndex === undefined || !CONTENT_BOUND.has(change.kind)) return change;
    const target = targets[change.opIndex];
    if (!target || target.blockId !== change.anchorBlockId) return change;
    let current = target.headFingerprint === target.fingerprint;
    if (!current && target.headFingerprint !== null) {
      current = earlier?.get(target.blockId)?.has(target.headFingerprint) === true
        || targets.slice(0, change.opIndex).some(
          (before) => before?.blockId === target.blockId
            && before.fingerprint === target.headFingerprint,
        );
    }
    if (current === !change.outdated) return change;
    changed = true;
    return { ...change, outdated: !current };
  });
  return changed ? { ...set, changes } : set;
}

/**
 * Carry the staging fingerprints forward over an accepted change.
 *
 * Accepting a rewrite changes its block, and that is the author's own
 * decision, not an edit the next suggestion on the same block was written
 * without. Without this, accepting the first of two rewrites of a paragraph
 * marked the second one stale. A change that was already stale stays stale.
 */
export function rebaseAfterAccept(
  sets: ChangeSet[],
  before: readonly Block[],
  after: readonly Block[],
  touched: readonly string[],
): ChangeSet[] {
  if (touched.length === 0) return sets;
  const prior = new Map(before.map((block) => [block.id, block]));
  const next = new Map(after.map((block) => [block.id, block]));
  const fresh = new Map<string, { was: string | undefined; now: string }>();
  for (const id of touched) {
    const landed = next.get(id);
    if (!landed) continue;
    const previous = prior.get(id);
    fresh.set(id, {
      was: previous ? blockFingerprint(previous) : undefined,
      now: blockFingerprint(landed),
    });
  }
  if (fresh.size === 0) return sets;

  let changed = false;
  const rebased = sets.map((set) => {
    let setChanged = false;
    const changes = set.changes.map((change) => {
      if (change.status !== 'pending' || !CONTENT_BOUND.has(change.kind)) return change;
      const target = change.anchorBlockId ? fresh.get(change.anchorBlockId) : undefined;
      if (!target || change.base === target.now) return change;
      // Already out of date before this accept: it stays that way.
      if (change.outdated) return change;
      if (change.base !== undefined && change.base !== target.was) return change;
      setChanged = true;
      return { ...change, base: target.now };
    });
    if (!setChanged) return set;
    changed = true;
    return { ...set, changes };
  });
  return changed ? rebased : sets;
}

/**
 * Turn a stored change set's operations into a reviewable batch.
 *
 * Operations the editor cannot render — `create_document`, or anything a
 * future server adds — are dropped here rather than surfaced as a change the
 * author has no way to evaluate.
 *
 * `blocks` is the document as it stands while the batch is staged. A rewrite
 * or deletion records what its block looked like then, so an edit the author
 * makes afterwards is noticed instead of silently overwritten.
 */
export function buildChangeSet(
  action: ToolAction & { changeSetId: string },
  blocks?: readonly Block[],
): ChangeSet {
  const changes: ProposedChange[] = [];
  const producedBy = new Map<string, string>();
  const present = blocks ? new Map(blocks.map((block) => [block.id, block])) : null;

  for (const [opIndex, op] of action.actions.entries()) {
    const kind = classify(op);
    if (!kind) continue;

    const { blockId, placement } = anchorOf(op);
    const produces = producedBlockId(op);
    const dependsOn: string[] = [];

    // An operation that touches a block an earlier operation created cannot be
    // accepted on its own — the block would not be there yet.
    for (const referenced of [blockId]) {
      if (!referenced) continue;
      const source = producedBy.get(referenced);
      if (source) dependsOn.push(source);
    }

    const change: ProposedChange = {
      id: uid(),
      order: changes.length,
      kind,
      op,
      anchorBlockId: blockId,
      placement,
      producesBlockId: produces,
      dependsOn,
      status: 'pending',
      opIndex,
    };
    const target = CONTENT_BOUND.has(kind) && blockId ? present?.get(blockId) : undefined;
    if (target) change.base = blockFingerprint(target);
    changes.push(change);
    if (produces) producedBy.set(produces, change.id);
  }

  return {
    id: uid(),
    tool: action.tool,
    toolCallId: action.toolCallId,
    documentId: action.documentId,
    message: action.message,
    receivedAt: Date.now(),
    changes,
    changeSetId: action.changeSetId,
  };
}

/* ----------------------------------------
   Querying
   ---------------------------------------- */

export function pendingChanges(sets: ChangeSet[]): ProposedChange[] {
  return sets.flatMap((set) => set.changes.filter((c) => c.status === 'pending'));
}

export function pendingCount(sets: ChangeSet[]): number {
  return pendingChanges(sets).length;
}

/**
 * Whether this change can be accepted right now.
 *
 * Three separate conditions, in increasing order of how recently they were
 * discovered to matter:
 *
 * 1. **Prerequisites.** `dependsOn` names changes that must have been
 *    *accepted*, because they create the block this one is addressed to. A
 *    change whose prerequisite was rejected can never become ready.
 * 2. **Precedence.** `after` (see `linkPrecedence`) names changes that must
 *    have been *decided*, either way, because accepting them in the other
 *    order changes the document. `dependsOn` cannot express this: it means
 *    "needs that to have happened", not "cannot be commuted with that".
 * 3. **Somewhere to land.** A change whose anchor the author has deleted has
 *    no position to take. Offering Accept for it meant the only thing the
 *    button could do was raise an error, which reads as the app losing the
 *    change rather than as the document having moved on. That holds for a
 *    rewrite, deletion or move of a deleted block as much as for an insert.
 * 4. **Still current.** A rewrite or deletion of a block the author has
 *    edited since would throw that edit away (see `isStale`).
 *
 * Reject is never gated on any of this — see `ChangeCard`.
 */
export function isReady(
  change: ProposedChange,
  sets: ChangeSet[],
  blocks?: Block[],
  after?: ReadonlyMap<string, string[]>,
): boolean {
  const byId = new Map<string, ProposedChange>();
  for (const set of sets) for (const c of set.changes) byId.set(c.id, c);

  if (!change.dependsOn.every((id) => byId.get(id)?.status === 'accepted')) return false;

  for (const id of after?.get(change.id) ?? []) {
    if (byId.get(id)?.status === 'pending') return false;
  }

  if (!blocks) return true;
  if (
    change.placement === null
    && change.anchorBlockId !== null
    && !blocks.some((block) => block.id === change.anchorBlockId)
  ) {
    return false;
  }
  if (isStale(change, blocks)) return false;
  return resolveAcceptOp(change, sets, blocks) !== null;
}

/** Change kinds that move blocks around, and so cannot be freely reordered. */
const POSITIONAL: ReadonlySet<ChangeKind> = new Set<ChangeKind>([
  'insert',
  'delete',
  'reorder',
]);

/**
 * Which changes must be decided before which, over the global authoring order.
 *
 * `resolveAcceptOp` makes inserts commute by positioning each one against its
 * landed siblings. Two kinds of operation cannot be made to commute that way,
 * so they are serialised instead:
 *
 * - **A reorder** addresses an absolute index, so it moves every block after
 *   it. `insert_at_start(X)` then `reorder(A, 2)` gives one document in
 *   authoring order and a different one reversed, and no amount of
 *   re-anchoring fixes that — the index means different things in the two
 *   documents. A reorder is therefore ordered against every positional
 *   sibling.
 * - **A delete** removes the very block other changes are addressed to.
 *   Accepting `delete(B)` before `insert_after(B, X)` leaves the insert with
 *   no anchor, so the paragraph the author wanted to keep is the one that is
 *   lost. Changes sharing an anchor with a delete are ordered against it.
 *
 * Edges always point from the later change to the earlier one, so the result
 * is acyclic by construction.
 */
export function linkPrecedence(sets: ChangeSet[]): Map<string, string[]> {
  const all = orderedChanges(sets);
  const after = new Map<string, string[]>(all.map((change) => [change.id, []]));

  all.forEach((later, i) => {
    for (const earlier of all.slice(0, i)) {
      const bothPositional = POSITIONAL.has(later.kind) && POSITIONAL.has(earlier.kind);
      const reorderInvolved = later.kind === 'reorder' || earlier.kind === 'reorder';
      const deleteInvolved = later.kind === 'delete' || earlier.kind === 'delete';
      const sharesAnchor =
        later.anchorBlockId !== null && later.anchorBlockId === earlier.anchorBlockId;

      if ((reorderInvolved && bothPositional) || (deleteInvolved && sharesAnchor)) {
        after.get(later.id)!.push(earlier.id);
      }
    }
  });
  return after;
}

/**
 * Whether Auto must leave this change to the author (D18): it was written
 * against text that has changed since, or it rewrites, deletes or moves the
 * block the author is typing in, or a block they locked or hid from the AI.
 * An insert next to such a block leaves the block itself alone.
 */
function needsAuthor(change: ProposedChange, blocks: readonly Block[], caretBlockId: string | null): boolean {
  if (isStale(change, blocks)) return true;
  if (change.placement !== null || change.anchorBlockId === null) return false;
  if (change.anchorBlockId === caretBlockId) return true;
  const target = blocks.find((block) => block.id === change.anchorBlockId);
  return target?.locked === true || target?.aiHidden === true;
}

/**
 * Which pending changes of an `apply_policy: "auto"` set the editor applies
 * at once, in authoring order, and which stay for the author.
 *
 * A change stays when it needs the author (`needsAuthor`), and so does
 * everything that cannot go without it: a change to a block a held insert
 * creates, or one that must not be decided before a held or still pending
 * change (`linkPrecedence`). `sets` holds every staged batch, this one
 * included. The caller resolves the result with `resolveAcceptPlan`; a change
 * that finds no place there stays as well.
 */
export function planAutoApply(
  set: ChangeSet,
  sets: ChangeSet[],
  blocks: readonly Block[],
  caretBlockId: string | null,
): { apply: ProposedChange[]; held: ProposedChange[] } {
  const after = linkPrecedence(sets);
  const byId = new Map<string, ProposedChange>();
  for (const batch of sets) for (const change of batch.changes) byId.set(change.id, change);
  const taken = new Set<string>();
  const apply: ProposedChange[] = [];
  const held: ProposedChange[] = [];
  for (const change of orderedChanges([set])) {
    if (change.status !== 'pending') continue;
    const prerequisites = change.dependsOn.every(
      (id) => taken.has(id) || byId.get(id)?.status === 'accepted',
    );
    const inOrder = (after.get(change.id) ?? []).every(
      (id) => taken.has(id) || byId.get(id)?.status !== 'pending',
    );
    if (prerequisites && inOrder && !needsAuthor(change, blocks, caretBlockId)) {
      taken.add(change.id);
      apply.push(change);
    } else {
      held.push(change);
    }
  }
  return { apply, held };
}

/**
 * The block whose caret holds back a change of an Auto set: `caretBlockId`,
 * when the set would apply more with the caret elsewhere. `null` otherwise.
 */
export function caretHeldBlock(
  set: ChangeSet,
  sets: ChangeSet[],
  blocks: readonly Block[],
  caretBlockId: string | null,
): string | null {
  if (caretBlockId === null) return null;
  const withCaret = new Set(planAutoApply(set, sets, blocks, caretBlockId).apply.map((change) => change.id));
  return planAutoApply(set, sets, blocks, null).apply.some((change) => !withCaret.has(change.id))
    ? caretBlockId
    : null;
}

/*
 * `changesForBlock`, `edgeChanges` and `orphanChanges` used to live here, and
 * the canvas rendered from them. They are gone rather than merely unused:
 *
 * - The first two returned changes in the order the operations were authored,
 *   which is not the order their blocks end up in. Rendering from them is what
 *   made a stack of additions read in one order and land in another.
 * - `orphanChanges` called a change orphaned whenever its anchor was missing
 *   from the *committed* blocks, so the second and third of three chained
 *   inserts — the ordinary way an agent adds consecutive paragraphs — were
 *   declared homeless and rendered at the foot of the page.
 *
 * `projectDocument` answers all three questions at once, from the same replay
 * the accept path uses. Leaving the old selectors exported is how a future
 * caller reintroduces the bug.
 */

/** Renames and other document-level changes, which the header reviews. */
export function documentChanges(sets: ChangeSet[]): ProposedChange[] {
  return pendingChanges(sets).filter((c) => c.kind === 'rename');
}

/* ----------------------------------------
   Authoring order and landing position
   ---------------------------------------- */

/**
 * Every change across every batch, in the order the agent authored them.
 *
 * Batches arrive in sequence and a later one may build on an earlier one, so
 * authoring order is `(batch, operation)` — not operation alone. This is the
 * order `acceptAll` replays in, and therefore the order everything else here
 * has to agree with.
 */
export function orderedChanges(sets: ChangeSet[]): ProposedChange[] {
  return sets.flatMap((set) => [...set.changes].sort((a, b) => a.order - b.order));
}

/** Position of each change in authoring order, for comparing two of them. */
export function changeSequence(sets: ChangeSet[]): Map<string, number> {
  const sequence = new Map<string, number>();
  orderedChanges(sets).forEach((change, index) => sequence.set(change.id, index));
  return sequence;
}

/**
 * The landing zone an insert belongs to. Two inserts share a slot when they
 * are aimed at the same fixed point in the document.
 */
export function slotKey(change: ProposedChange): string | null {
  if (change.kind !== 'insert' || !change.placement) return null;
  return `${change.placement}:${change.anchorBlockId ?? ''}`;
}

/**
 * Whether a slot replays back-to-front.
 *
 * `insert_block_after` and `insert_block_at_start` each land immediately next
 * to a fixed point, so replaying them in order pushes every earlier one
 * further away: three inserts after `A`, authored X then Y then Z, end up as
 * `A, Z, Y, X`. `insert_block_before` and `append_block` land against a point
 * that moves with them, so they keep their authored order.
 *
 * This is the server's replay semantics, not a preference — it is what the
 * stored document will look like, so it is what the review has to show.
 */
function slotIsReversed(placement: ProposedChange['placement']): boolean {
  return placement === 'after' || placement === 'start';
}

/* ----------------------------------------
   Projection
   ---------------------------------------- */

/** One row of the document as the author sees it while a review is open. */
export type DocumentRow =
  | {
      kind: 'block';
      block: Block;
      /** Rewrites, deletions and moves, which are about this block. */
      changes: ProposedChange[];
    }
  | { kind: 'insert'; change: ProposedChange; block: Block | null };

export type DocumentProjection = {
  rows: DocumentRow[];
  /**
   * Pending changes with nowhere to render: the agent read the document a
   * moment before the author deleted the very paragraph it was rewriting.
   */
  orphans: ProposedChange[];
};

/**
 * The document with every pending change shown where it would actually land.
 *
 * This replays the pending inserts exactly the way `applyPatchToBlocks`
 * replays accepted ones — same order, same splice points — against a list that
 * already contains the blocks earlier inserts in the batch will produce. Two
 * things fall out of that, both of which the previous per-slot rendering got
 * wrong:
 *
 * - Stacked inserts read top-to-bottom in the order they will end up in, so
 *   `Accept all` can no longer rearrange what the author was looking at.
 * - A chained insert (`insert_after(A,X)` then `insert_after(X,Y)` — how an
 *   agent adds consecutive paragraphs) resolves against the pending `X` and
 *   renders under it. It used to count as an orphan, land at the very bottom
 *   of the page, and claim its block had been deleted.
 *
 * A change is only an orphan when its anchor is in neither the document nor
 * the batch.
 */
export function projectDocument(blocks: Block[], sets: ChangeSet[]): DocumentProjection {
  const pending = pendingChanges(sets);
  const present = new Set(blocks.map((block) => block.id));
  const orphans: ProposedChange[] = [];

  const onBlock = new Map<string, ProposedChange[]>();
  for (const change of pending) {
    if (change.kind === 'rename' || change.placement !== null) continue;
    if (change.anchorBlockId === null) continue;
    // A rewrite, deletion or move of a block the author has since deleted has
    // no row to sit on. Without this it was dropped from the projection
    // entirely while the review bar went on counting it — a change the author
    // could neither see nor dismiss.
    if (!present.has(change.anchorBlockId)) {
      orphans.push(change);
      continue;
    }
    const list = onBlock.get(change.anchorBlockId);
    if (list) list.push(change);
    else onBlock.set(change.anchorBlockId, [change]);
  }

  const rows: DocumentRow[] = blocks.map((block) => ({
    kind: 'block',
    block,
    changes: onBlock.get(block.id) ?? [],
  }));

  /** Row identity, so a pending insert can anchor another pending insert. */
  const idOf = (row: DocumentRow): string | null =>
    row.kind === 'block' ? row.block.id : row.change.producesBlockId;

  for (const change of pending) {
    if (change.kind !== 'insert' || !change.placement) continue;

    const row: DocumentRow = { kind: 'insert', change, block: proposedBlock(change) };
    const anchor = change.anchorBlockId;

    if (change.placement === 'start') {
      rows.unshift(row);
      continue;
    }
    if (change.placement === 'end') {
      rows.push(row);
      continue;
    }

    const at = rows.findIndex((candidate) => idOf(candidate) === anchor);
    if (at === -1) {
      orphans.push(change);
      continue;
    }
    rows.splice(change.placement === 'after' ? at + 1 : at, 0, row);
  }

  return { rows, orphans };
}

/**
 * Rewrite an accepted change into the operation that puts it where authoring
 * order says it belongs, whatever order the author accepted things in.
 *
 * An insert is addressed relative to a fixed point — "after A", "at the end" —
 * and the previous accept path applied that address literally, against the
 * document as it stood at the moment of the click. So `append X`, `append Y`,
 * `append Z` accepted as Z, X, Y produced `Z, X, Y`, and `Accept all` on the
 * same batch produced `X, Y, Z`. Same decisions, different document.
 *
 * The fix is to position the block against the batch siblings that are already
 * in the document rather than against the raw address: everything authored
 * ahead of it in the same slot goes before, everything authored behind it goes
 * after, and where the slot replays back-to-front (see `slotIsReversed`) those
 * two are swapped. Siblings the author has since deleted are simply not there
 * to constrain it.
 *
 * Returns `null` when the change genuinely cannot be placed — its anchor is
 * gone — which the caller reports as a desync rather than guessing at.
 */
export function resolveAcceptOp(
  change: ProposedChange,
  sets: ChangeSet[],
  blocks: Block[],
): ToolOperation | null {
  if (change.kind !== 'insert' || !change.placement) return change.op;

  const slot = slotKey(change);
  const sequence = changeSequence(sets);
  const own = sequence.get(change.id) ?? change.order;
  const reversed = slotIsReversed(change.placement);

  // Batch siblings aimed at the same place that are already in the document.
  const precede: number[] = [];
  const follow: number[] = [];
  for (const sibling of orderedChanges(sets)) {
    if (sibling.id === change.id || sibling.status !== 'accepted') continue;
    if (slotKey(sibling) !== slot || !sibling.producesBlockId) continue;
    const at = blocks.findIndex((block) => block.id === sibling.producesBlockId);
    if (at === -1) continue;
    const rank = sequence.get(sibling.id) ?? sibling.order;
    const isEarlier = reversed ? rank > own : rank < own;
    (isEarlier ? precede : follow).push(at);
  }

  let anchorIndex = -1;
  if (change.anchorBlockId !== null) {
    anchorIndex = blocks.findIndex((block) => block.id === change.anchorBlockId);
    if (anchorIndex === -1) return null;
  }

  // Where the slot puts this block when no sibling has landed yet.
  const alone =
    change.placement === 'after'
      ? anchorIndex + 1
      : change.placement === 'before'
        ? anchorIndex
        : change.placement === 'start'
          ? 0
          : blocks.length;

  const lower = precede.length > 0 ? Math.max(...precede) + 1 : alone;
  const upper = follow.length > 0 ? Math.min(...follow) : blocks.length;
  const index = Math.max(0, Math.min(lower, upper, blocks.length));

  const block = (change.op as { block?: Record<string, unknown> }).block ?? {};
  const previous = index > 0 ? blocks[index - 1] : undefined;
  if (!previous) return { op: 'insert_block_at_start', block };
  return { op: 'insert_block_after', referenceId: previous.id, block };
}

/* ----------------------------------------
   Rejection
   ---------------------------------------- */

/** What rejecting a change does to the rest of its batch. */
export type RejectionPlan = {
  /**
   * Inserts that continued from the rejected one (the next paragraph of a
   * suggested section). They take its place and stay reviewable.
   */
  reanchored: ProposedChange[];
  /**
   * Changes to the block the rejected insert would have created — a rewrite
   * or deletion of it. There is nothing left for them to apply to, so they
   * are rejected with it.
   */
  cascaded: ProposedChange[];
};

const byOrder = (a: ProposedChange, b: ProposedChange) => a.order - b.order;

/** Whether `change` continues from the block `rejected` would have added. */
function continuesFrom(change: ProposedChange, rejected: ProposedChange): boolean {
  return (
    change.kind === 'insert'
    && (change.placement === 'after' || change.placement === 'before')
    && rejected.kind === 'insert'
    && rejected.placement !== null
    && rejected.producesBlockId !== null
    && change.anchorBlockId === rejected.producesBlockId
  );
}

/**
 * Work out, without changing anything, what rejecting `changeId` takes with it.
 *
 * Rejecting one paragraph of a suggested section used to reject every
 * paragraph after it, because each one is addressed to the block before it.
 * Those inserts only need *a* place, and the rejected paragraph's own address
 * is the place it was going to take, so they move onto it instead. Only a
 * change to the rejected block itself has nowhere to go.
 */
export function planRejection(changeId: string, sets: ChangeSet[]): RejectionPlan {
  const set = sets.find((candidate) => candidate.changes.some((change) => change.id === changeId));
  const target = set?.changes.find((change) => change.id === changeId);
  if (!set || !target || target.status !== 'pending') return { reanchored: [], cascaded: [] };

  const reanchored: ProposedChange[] = [];
  const cascaded: ProposedChange[] = [];
  const queue = [target];
  const seen = new Set([target.id]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const change of set.changes) {
      if (change.status !== 'pending' || seen.has(change.id)) continue;
      if (!change.dependsOn.includes(current.id)) continue;
      seen.add(change.id);
      if (current === target && continuesFrom(change, target)) {
        reanchored.push(change);
      } else {
        // Built on something that will never exist: it goes too, and so does
        // anything built on it in turn.
        cascaded.push(change);
        queue.push(change);
      }
    }
  }
  return { reanchored, cascaded };
}

/** The rejected insert's own address, given to a change that continued from it. */
function readdress(change: ProposedChange, rejected: ProposedChange): ToolOperation {
  const block = (change.op as { block?: Record<string, unknown> }).block ?? {};
  const anchor = rejected.anchorBlockId ?? '';
  switch (rejected.placement) {
    case 'before':
      return { op: 'insert_block_before', referenceId: anchor, block };
    case 'start':
      return { op: 'insert_block_at_start', block };
    case 'end':
      return { op: 'append_block', block };
    default:
      return { op: 'insert_block_after', referenceId: anchor, block };
  }
}

/**
 * Reject a change, moving the inserts that continued from it onto its place.
 *
 * The continuations also take the rejected change's place in authoring
 * order. Position inside a slot is decided by that order (see
 * `slotIsReversed`), so a continuation that kept its own, later rank would
 * jump ahead of any sibling authored in between: rejecting X in
 * `after(A, X)`, `after(A, V)`, `after(X, Y)` must leave `A, V, Y`, not
 * `A, Y, V`. They are slotted in so that replaying them gives the order they
 * were shown in — the ones before X, then the ones after it.
 *
 * Returns the ids that are now rejected (the change itself first) and the ids
 * that were re-anchored. Unknown or already-decided ids change nothing.
 */
export function rejectChange(
  sets: ChangeSet[],
  changeId: string,
): { sets: ChangeSet[]; rejected: string[]; reanchored: string[] } {
  const setIndex = sets.findIndex((set) => set.changes.some((change) => change.id === changeId));
  const set = sets[setIndex];
  const target = set?.changes.find((change) => change.id === changeId);
  if (!set || !target || target.status !== 'pending') {
    return { sets, rejected: [], reanchored: [] };
  }

  const { reanchored, cascaded } = planRejection(changeId, sets);
  const rejected = new Set([changeId, ...cascaded.map((change) => change.id)]);

  const moved = new Map<string, ProposedChange>(
    reanchored.map((change) => [
      change.id,
      {
        ...change,
        op: readdress(change, target),
        anchorBlockId: target.anchorBlockId,
        placement: target.placement,
        // Its anchor is now the rejected insert's anchor, which may itself be
        // a pending insert of this batch.
        dependsOn: [...target.dependsOn],
      },
    ]),
  );

  // Document order of the continuations: before-X inserts keep their order,
  // after-X inserts replay back-to-front.
  const shown = [
    ...reanchored.filter((change) => change.placement === 'before').sort(byOrder),
    ...reanchored.filter((change) => change.placement === 'after').sort(byOrder).reverse(),
  ];
  const slotted = slotIsReversed(target.placement) ? [...shown].reverse() : shown;

  const rest = [...set.changes].sort(byOrder).filter((change) => !moved.has(change.id));
  const at = rest.findIndex((change) => change.id === changeId);
  const sequence = [
    ...rest.slice(0, at + 1),
    ...slotted.map((change) => moved.get(change.id)!),
    ...rest.slice(at + 1),
  ];

  const changes = sequence.map((change, index) => ({
    ...change,
    order: index,
    status: rejected.has(change.id) ? ('rejected' as const) : change.status,
  }));

  const next = [...sets];
  next[setIndex] = { ...set, changes };
  return {
    sets: next,
    rejected: [changeId, ...cascaded.map((change) => change.id)],
    reanchored: reanchored.map((change) => change.id),
  };
}

/** Mark changes decided without touching anything else. */
export function markChanges(
  sets: ChangeSet[],
  ids: ReadonlySet<string>,
  status: 'accepted' | 'rejected',
): ChangeSet[] {
  if (ids.size === 0) return sets;
  return sets.map((set) =>
    set.changes.some((change) => ids.has(change.id))
      ? {
          ...set,
          changes: set.changes.map((change) =>
            ids.has(change.id) ? { ...change, status } : change,
          ),
        }
      : set,
  );
}

/* ----------------------------------------
   Resuming a review
   ---------------------------------------- */

/** One decision on a durable batch, by the operation's stored position. */
export type ReviewDecision = [opIndex: number, status: 'accepted' | 'rejected'];

/**
 * Whether the document already holds what a change asks for.
 *
 * Only meaningful when a durable batch is staged again: this browser may
 * have lost its record of the decision, or it was made in another one. An
 * insert whose block is there has landed — accepting it again is refused as
 * a duplicate id, which read as the change having lost its place. A rewrite
 * that leaves its block exactly as it is, and a deletion of a block that is
 * gone, have nothing left to do either.
 *
 * The caller checks prerequisites first: a deletion of a block the batch has
 * not created yet is not "already done".
 */
export function alreadyInDocument(change: ProposedChange, blocks: readonly Block[]): boolean {
  if (change.kind === 'insert') {
    return change.producesBlockId !== null
      && blocks.some((block) => block.id === change.producesBlockId);
  }
  if (change.kind === 'delete') {
    return !blocks.some((block) => block.id === change.anchorBlockId);
  }
  if (change.kind === 'replace') {
    const current = blocks.find((block) => block.id === change.anchorBlockId);
    const merged = mergedBlock(change, current);
    // Every field, view-only ones included: this asks whether applying it
    // would change anything at all.
    return current !== undefined && merged !== null
      && stableStringify(merged) === stableStringify(current);
  }
  return false;
}

/**
 * A durable batch staged again, with the decisions already made on it.
 *
 * The server keeps a batch pending until every change in it is decided, and
 * hands back all of its operations on the next load. Without this, a review
 * left half-done came back whole: accepted and rejected changes were pending
 * again, and accepting an insert that had already landed failed.
 *
 * Decisions replay in the order they were made, so a rejection re-anchors
 * its continuations exactly as it did the first time. `bases` restores the
 * staging fingerprints, so an edit made before the reload still marks its
 * suggestion stale. With `blocks`, changes the document already holds are
 * marked accepted too (see `alreadyInDocument`); without, nothing is decided
 * beyond what was stored. Returns the batch and the operations found already
 * in the document, which the caller records as accepted.
 */
export function resumeReview(
  set: ChangeSet,
  stored: { decisions: readonly ReviewDecision[]; bases: Readonly<Record<string, string>> } | null,
  blocks: readonly Block[] | null,
): { set: ChangeSet; landed: number[] } {
  // The helpers below work on lists of batches; this one is the only one.
  let current: ChangeSet = (
    stored
      ? {
          ...set,
          changes: set.changes.map((change) => {
            const base = change.opIndex === undefined ? undefined : stored.bases[change.opIndex];
            return base === undefined ? change : { ...change, base };
          }),
        }
      : set
  );
  const update = ([next]: ChangeSet[]) => {
    if (next) current = next;
  };

  for (const [opIndex, status] of stored?.decisions ?? []) {
    const change = current.changes.find((candidate) => candidate.opIndex === opIndex);
    if (!change || change.status !== 'pending') continue;
    update(status === 'rejected'
      ? rejectChange([current], change.id).sets
      : markChanges([current], new Set([change.id]), 'accepted'));
  }

  // In authoring order, so an insert that landed satisfies the dependency of
  // the next one before that one is looked at.
  const landed: number[] = [];
  if (!blocks) return { set: current, landed };
  for (const change of orderedChanges([current])) {
    const live = current.changes.find((candidate) => candidate.id === change.id);
    if (!live || live.status !== 'pending' || live.opIndex === undefined) continue;
    const ready = live.dependsOn.every(
      (id) => current.changes.find((candidate) => candidate.id === id)?.status === 'accepted',
    );
    if (!ready || !alreadyInDocument(live, blocks)) continue;
    landed.push(live.opIndex);
    update(markChanges([current], new Set([live.id]), 'accepted'));
  }

  return { set: current, landed };
}

/**
 * Every pending change in the order the author meets it reading the document.
 *
 * The review bar's Next/Previous and its list both used the order batches
 * arrived in, which is unrelated to position: stepping through a batch that
 * touched the introduction, the conclusion and then the introduction again
 * threw the page up and down instead of walking it.
 */
export function pendingInDocumentOrder(blocks: Block[], sets: ChangeSet[]): ProposedChange[] {
  const { rows, orphans } = projectDocument(blocks, sets);
  const ordered: ProposedChange[] = [...documentChanges(sets)];
  for (const row of rows) {
    if (row.kind === 'insert') ordered.push(row.change);
    else ordered.push(...row.changes);
  }
  return [...ordered, ...orphans];
}

/**
 * Drop settled batches — but only once the whole review is over.
 *
 * `resolveAcceptOp` positions a change against the batch siblings that have
 * already landed, and it can only see siblings that are still in `sets`.
 * Dropping each batch as soon as its own changes were decided erased exactly
 * that record, which brought the ordering bug back in the shape it is most
 * often met in: one operation per batch, because the author asked for one
 * thing and then another. Accepting the second batch first left the first with
 * no sibling to position against, so it appended past it.
 *
 * Settled changes are invisible to everything else here — `pendingChanges` and
 * every caller of it filter on status — so retaining them costs a little
 * memory until the last decision, and nothing else.
 */
export function pruneSettledSets(sets: ChangeSet[]): ChangeSet[] {
  const reviewing = sets.some((set) =>
    set.changes.some((change) => change.status === 'pending'),
  );
  return reviewing ? sets : [];
}

export type AcceptPlan = {
  /** Operations to apply, in the order they must be applied. */
  ops: ToolOperation[];
  /** Changes the plan covers, which the caller marks accepted. */
  applied: ProposedChange[];
  /** Changes that no longer have a place in the document. */
  desynced: ProposedChange[];
};

/**
 * Work out how to apply a set of accepted changes, in authoring order.
 *
 * Each operation is resolved against the document as the *previous* ones in
 * this plan leave it, because resolving them all against the starting state
 * would place every sibling at the same index. The resolved operations are
 * addressed by block id, so applying them for real in this order reproduces
 * the simulation exactly.
 *
 * `acceptAll` needs this as much as a single accept does. Replaying the raw
 * operations is only correct while nothing has been accepted yet: append
 * X, Y, Z with Z already accepted leaves `append X, append Y` to run after it,
 * which puts them past the block they were authored before.
 */
export function resolveAcceptPlan(
  changes: ProposedChange[],
  sets: ChangeSet[],
  blocks: Block[],
): AcceptPlan {
  const rank = changeSequence(sets);
  const queue = [...changes].sort(
    (a, b) => (rank.get(a.id) ?? a.order) - (rank.get(b.id) ?? b.order),
  );

  const ops: ToolOperation[] = [];
  const applied: ProposedChange[] = [];
  const desynced: ProposedChange[] = [];

  let projected = blocks;
  // Statuses advance as the plan is built, so each change is positioned
  // against the siblings the ones before it have just put in the document.
  let projectedSets = sets;

  for (const change of queue) {
    const op = resolveAcceptOp(change, projectedSets, projected);
    if (!op) {
      desynced.push(change);
      continue;
    }

    const outcome = applyPatchToBlocks(projected, [op]);
    if (outcome.desynced.length > 0) {
      desynced.push(change);
      continue;
    }

    ops.push(op);
    applied.push(change);
    projected = outcome.blocks;
    projectedSets = projectedSets.map((set) => ({
      ...set,
      changes: set.changes.map((candidate) =>
        candidate.id === change.id ? { ...candidate, status: 'accepted' as const } : candidate,
      ),
    }));
  }

  return { ops, applied, desynced };
}

/* ----------------------------------------
   Rendering helpers
   ---------------------------------------- */

/** The block a change would produce, validated the same way a patch is. */
export function proposedBlock(change: ProposedChange): Block | null {
  const op = change.op;
  if (
    op.op === 'insert_block_after' ||
    op.op === 'insert_block_before' ||
    op.op === 'insert_block_at_start' ||
    op.op === 'append_block'
  ) {
    return coerceBlock(op.block);
  }
  return null;
}

/**
 * The block as it would look after a replace.
 *
 * Mirrors the server's merge semantics: fields the agent did not mention keep
 * their current value, so a change to `html` alone must not blank the
 * paragraph's inline widgets in the preview.
 */
export function mergedBlock(change: ProposedChange, current: Block | undefined): Block | null {
  if (change.op.op !== 'replace_block' || !current) return null;
  return coerceBlock({ ...current, ...change.op.block });
}

/**
 * What an inline widget reads as in a one-line summary: the maths itself, or
 * what kind of thing sits there. It used to be a `▦`, which told the author
 * nothing and which a screen reader announced as "square with orthogonal
 * crosshatch fill".
 */
function widgetStandIn(child: ParagraphChild | undefined): string {
  if (!child) return '…';
  switch (child.type) {
    case 'equation': {
      const latex = child.latex.replace(/\s+/g, ' ').trim();
      return latex.length > 32 ? `${latex.slice(0, 31)}…` : latex || '(equation)';
    }
    case 'citation':
      return '[ref]';
    case 'table':
      return '(table)';
    case 'graph':
      return '(chart)';
    case 'aiBeat':
      return '(AI passage)';
  }
}

/** Plain text of a block, for one-line summaries and quotes. */
export function blockText(block: Block | null | undefined): string {
  if (block?.type === 'code') return block.text.trim();
  if (!block || !('html' in block)) return '';
  const children = block.type === 'paragraph' ? block.children ?? [] : [];
  return block.html
    .replace(/<span[^>]*data-child-id="([^"]*)"[^>]*><\/span>/g, (_match, id: string) =>
      ` ${widgetStandIn(children.find((child) => child.id === id))} `,
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Short human label for a change, used in the review bar and chat card. */
export function describeChange(change: ProposedChange, blocks: Block[]): string {
  const target = blocks.find((b) => b.id === change.anchorBlockId);
  const label = (block: Block | null | undefined) => {
    if (!block) return 'block';
    if (block.type === 'heading') return 'heading';
    // "Rewrite to-do list" reads better than "Rewrite paragraph" for a
    // checklist item; body text stays "paragraph".
    const kind = kindLabel(block).toLowerCase();
    return kind === 'text' ? 'paragraph' : kind.replace(/ list$/, ' item');
  };
  // Naming the text is what tells two same-kind changes apart in a long
  // batch: "Delete heading" twice reads as a duplicate; quoting doesn't.
  const quoted = (block: Block | null | undefined) => {
    const text = blockText(block).trim();
    if (!text) return '';
    const short = text.length > 36 ? `${text.slice(0, 35)}…` : text;
    return ` “${short}”`;
  };

  switch (change.kind) {
    case 'insert': {
      const block = proposedBlock(change);
      return `Add ${label(block)}${quoted(block)}`;
    }
    case 'replace':
      return `Rewrite ${label(target)}${quoted(target)}`;
    case 'delete':
      return `Delete ${label(target)}${quoted(target)}`;
    case 'reorder':
      return `Move ${label(target)}${quoted(target)}`;
    case 'rename':
      return 'Rename page';
  }
}
