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
 *    in the same batch created. Rejecting the first has to disable the second
 *    rather than let it fail against a block that never existed.
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

import type { Block, ToolAction, ToolOperation } from './types';
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
};

export type ChangeSet = {
  id: string;
  tool: string;
  toolCallId: string;
  documentId: string;
  /** Version the server held when it staged this. Untouched by a proposal. */
  version: number;
  message?: string;
  receivedAt: number;
  changes: ProposedChange[];
  /**
   * Set when this batch is a durable server-side change set. Such a batch is
   * atomic: accept or reject decides the whole set against the server, which
   * owns the operations and applies them to the authoritative head.
   */
  changeSetId?: string | null;
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

/**
 * Turn a streamed `tool_action` into a reviewable batch.
 *
 * Operations the editor cannot render — `create_document`, or anything a
 * future server adds — are dropped here rather than surfaced as a change the
 * author has no way to evaluate.
 */
export function buildChangeSet(action: ToolAction): ChangeSet {
  const changes: ProposedChange[] = [];
  const producedBy = new Map<string, string>();

  for (const op of action.actions) {
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
    };
    changes.push(change);
    if (produces) producedBy.set(produces, change.id);
  }

  return {
    id: uid(),
    tool: action.tool,
    toolCallId: action.toolCallId,
    documentId: action.documentId,
    version: action.version,
    message: action.message,
    receivedAt: Date.now(),
    changes,
    changeSetId: action.changeSetId ?? null,
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
 *    change rather than as the document having moved on.
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

  if (blocks && resolveAcceptOp(change, sets, blocks) === null) return false;
  return true;
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

  for (let i = 0; i < all.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const later = all[i];
      const earlier = all[j];

      const bothPositional = POSITIONAL.has(later.kind) && POSITIONAL.has(earlier.kind);
      const reorderInvolved = later.kind === 'reorder' || earlier.kind === 'reorder';
      const deleteInvolved = later.kind === 'delete' || earlier.kind === 'delete';
      const sharesAnchor =
        later.anchorBlockId !== null && later.anchorBlockId === earlier.anchorBlockId;

      if ((reorderInvolved && bothPositional) || (deleteInvolved && sharesAnchor)) {
        after.get(later.id)!.push(earlier.id);
      }
    }
  }
  return after;
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
  if (index === 0) return { op: 'insert_block_at_start', block };
  return { op: 'insert_block_after', referenceId: blocks[index - 1].id, block };
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

/** Plain text of a block, for diffing and for one-line summaries. */
export function blockText(block: Block | null | undefined): string {
  if (!block || !('html' in block)) return '';
  return block.html
    .replace(/<span[^>]*data-child-id[^>]*><\/span>/g, ' ▦ ')
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
    if (block.type === 'divider') return 'divider';
    return 'paragraph';
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
      return 'Rename document';
  }
}
