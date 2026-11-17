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
import type { Block, Doc, ParagraphChild, ToolAction, ToolOperation } from './types';
import type { ChangeSetGroupResponse } from '@/api/schema';
import { applyOperations, applyPatchToBlocks, coerceBlock } from './docOps';
import { attributeText } from './placeholderIds';
import { uid } from '../lib/uid';

/**
 * What an operation does, as the review shows it: blocks added (`write_blocks`
 * before, after or at the end), a block rewritten (`replace_text`, a
 * `write_blocks` replace), blocks deleted, a block moved, the page's name or
 * citation style set (`set_meta`), or its library edited.
 */
export type ChangeKind = 'insert' | 'replace' | 'delete' | 'move' | 'meta' | 'sources';

export type ChangeStatus = 'pending' | 'accepted' | 'rejected';

export type ProposedChange = {
  id: string;
  /** Index within the batch. Accepted changes replay in this order. */
  order: number;
  kind: ChangeKind;
  op: ToolOperation;
  /**
   * Existing block this change is about — where the review card renders: the
   * block an insert goes next to, the block rewritten or moved, the first
   * block deleted. Null for an insert at the end and for page-level changes.
   */
  anchorBlockId: string | null;
  /** Which side of the anchor an insert belongs on; `end` for an append. */
  placement: 'before' | 'after' | 'end' | null;
  /**
   * The blocks whose text this change depends on: the block it rewrites, or
   * every block it deletes. The server fingerprints exactly these
   * (`operation_targets`).
   */
  targetBlockIds: string[];
  /**
   * Every block the operation names: its targets, an insert's anchor, a
   * move's block and the block it moves next to. A change naming a block an
   * earlier change of the batch creates depends on that change.
   */
  references: string[];
  /** Blocks this change brings into existence, in order. */
  producesBlockIds: string[];
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
   * Fingerprints of the blocks a rewrite or deletion is aimed at, by block
   * id, taken when the change was staged. A block that no longer matches was
   * edited after the suggestion was written (see `isStale`).
   */
  bases?: Readonly<Record<string, string>>;
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
  /** Stored by the server, not inferred from the editor's operation kinds. */
  groups: ChangeSetGroupResponse[];
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

const idOf = (raw: Record<string, unknown>): string | null =>
  typeof raw.id === 'string' && raw.id ? raw.id : null;

/** What an operation does to the page, as the review reads it; `null` for one it does not show. */
function shapeOf(op: ToolOperation): Pick<
  ProposedChange,
  'kind' | 'anchorBlockId' | 'placement' | 'targetBlockIds' | 'references' | 'producesBlockIds'
> | null {
  switch (op.op) {
    case 'replace_text':
      return { kind: 'replace', anchorBlockId: op.blockId, placement: null, targetBlockIds: [op.blockId], references: [op.blockId], producesBlockIds: [] };
    case 'write_blocks': {
      const ids = op.blocks.map(idOf).filter((id): id is string => id !== null);
      if (op.position === 'replace' && op.blockId !== null) {
        // The first block keeps the replaced id; the rest are new.
        return { kind: 'replace', anchorBlockId: op.blockId, placement: null, targetBlockIds: [op.blockId], references: [op.blockId], producesBlockIds: ids.slice(1) };
      }
      if (op.position === 'append') {
        return { kind: 'insert', anchorBlockId: null, placement: 'end', targetBlockIds: [], references: [], producesBlockIds: ids };
      }
      if (op.blockId === null || op.position === 'replace') return null;
      return { kind: 'insert', anchorBlockId: op.blockId, placement: op.position, targetBlockIds: [], references: [op.blockId], producesBlockIds: ids };
    }
    case 'delete_blocks':
      return { kind: 'delete', anchorBlockId: op.blockIds[0] ?? null, placement: null, targetBlockIds: [...op.blockIds], references: [...op.blockIds], producesBlockIds: [] };
    case 'move_block':
      return { kind: 'move', anchorBlockId: op.blockId, placement: null, targetBlockIds: [], references: [op.blockId, op.targetBlockId], producesBlockIds: [] };
    case 'set_meta':
      return { kind: 'meta', anchorBlockId: null, placement: null, targetBlockIds: [], references: [], producesBlockIds: [] };
    case 'add_sources':
    case 'remove_sources':
    case 'update_sources':
      return { kind: 'sources', anchorBlockId: null, placement: null, targetBlockIds: [], references: [], producesBlockIds: [] };
    case 'create_document':
      return null;
  }
}

/* ----------------------------------------
   Staleness
   ---------------------------------------- */

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
 * since changed: any of its blocks.
 *
 * Applying it anyway is what this guards against: a rewrite puts the
 * assistant's version in place of the block, so the author's newer sentence
 * would be replaced without a word. Such a change can still be rejected; it
 * can no longer be accepted (see `isReady`). A target the author deleted is
 * not stale: that change has nowhere to land (also `isReady`).
 */
export function isStale(change: ProposedChange, blocks: readonly Block[]): boolean {
  const present = change.targetBlockIds
    .map((id) => blocks.find((block) => block.id === id))
    .filter((block): block is Block => block !== undefined);
  if (present.length === 0) return false;
  // Changed between the proposal and the staging, by the server's account.
  if (change.outdated) return true;
  // Changed since it was staged here.
  return present.some((block) => {
    const base = change.bases?.[block.id];
    return base !== undefined && blockFingerprint(block) !== base;
  });
}

/**
 * Mark the rewrites and deletions of a durable batch whose blocks changed
 * after the assistant read them, going by the server's fingerprints.
 *
 * `bases` are taken when a batch is staged, so on their own they only notice
 * an edit made while the batch is on screen. A paragraph the author rewrote
 * between the proposal and a reload, or on another device, looked untouched,
 * and accepting the suggestion replaced it. The server records each target
 * as its operation found it (`fingerprint`) and reports the same digest for
 * the saved document (`headFingerprint`).
 *
 * The fingerprints of the operations on one block, in order, are the stages
 * that block goes through as the review is accepted. The saved block is
 * current for an operation when it is at that operation's own stage, or at
 * the stage of an earlier operation on the block — those are still
 * undecided, or were rejected. `earlier` carries the stages recorded by the
 * batches this one was written on top of. Anything else is text the
 * suggestion was not written for. An operation is current when every one of
 * its targets is.
 *
 * `targets` holds one list per operation index; an empty list is an
 * operation with no target, which keeps relying on `bases` alone.
 */
export function markOutdated(
  set: ChangeSet,
  targets: ReadonlyArray<readonly OperationTarget[]>,
  earlier?: ReadonlyMap<string, ReadonlySet<string>>,
): ChangeSet {
  const stageCurrent = (target: OperationTarget, opIndex: number): boolean => {
    if (target.headFingerprint === target.fingerprint) return true;
    if (target.headFingerprint === null) return false;
    const head = target.headFingerprint;
    return earlier?.get(target.blockId)?.has(head) === true
      || targets.slice(0, opIndex).some((before) => before.some(
        (other) => other.blockId === target.blockId && other.fingerprint === head,
      ));
  };
  let changed = false;
  const changes = set.changes.map((change) => {
    if (change.opIndex === undefined || change.targetBlockIds.length === 0) return change;
    const entry = (targets[change.opIndex] ?? []).filter((target) => change.targetBlockIds.includes(target.blockId));
    if (entry.length === 0) return change;
    const opIndex = change.opIndex;
    const current = entry.every((target) => stageCurrent(target, opIndex));
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
      if (change.status !== 'pending' || change.targetBlockIds.length === 0) return change;
      // Already out of date before this accept: it stays that way.
      if (change.outdated) return change;
      let bases = change.bases;
      for (const id of change.targetBlockIds) {
        const target = fresh.get(id);
        const base = bases?.[id];
        if (!target || base === target.now) continue;
        if (base !== undefined && base !== target.was) continue;
        bases = { ...bases, [id]: target.now };
      }
      if (bases === change.bases) return change;
      setChanged = true;
      return { ...change, bases };
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
 * or deletion records what its blocks looked like then, so an edit the
 * author makes afterwards is noticed instead of silently overwritten.
 */
export function buildChangeSet(
  action: Omit<ToolAction, 'tool'> & { changeSetId: string; groups?: ChangeSetGroupResponse[] },
  blocks?: readonly Block[],
): ChangeSet {
  const changes: ProposedChange[] = [];
  const producedBy = new Map<string, string>();
  const present = blocks ? new Map(blocks.map((block) => [block.id, block])) : null;

  for (const [opIndex, op] of action.actions.entries()) {
    const shape = shapeOf(op);
    if (!shape) continue;

    // An operation that names a block an earlier operation created cannot be
    // accepted on its own: the block would not be there yet.
    const dependsOn = [...new Set(
      shape.references.flatMap((referenced) => {
        const source = producedBy.get(referenced);
        return source ? [source] : [];
      }),
    )];

    const change: ProposedChange = {
      id: uid(),
      order: changes.length,
      ...shape,
      op,
      dependsOn,
      status: 'pending',
      opIndex,
    };
    const bases: Record<string, string> = {};
    for (const id of shape.targetBlockIds) {
      const target = present?.get(id);
      if (target) bases[id] = blockFingerprint(target);
    }
    if (Object.keys(bases).length > 0) change.bases = bases;
    changes.push(change);
    for (const produced of shape.producesBlockIds) producedBy.set(produced, change.id);
  }

  return {
    id: uid(),
    toolCallId: action.toolCallId,
    documentId: action.documentId,
    message: action.message,
    receivedAt: Date.now(),
    changes,
    changeSetId: action.changeSetId,
    groups: action.groups ?? [],
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

/** A stored group's still-undecided operations; order stays the author's. */
export function groupChanges(set: ChangeSet, kind: ChangeSetGroupResponse['kind']): ProposedChange[] {
  const indices = new Set(set.groups.find((group) => group.kind === kind)?.operations ?? []);
  return orderedChanges([set]).filter((change) =>
    change.status === 'pending' && change.opIndex !== undefined && indices.has(change.opIndex));
}

export function wordingChanges(sets: ChangeSet[]): ProposedChange[] {
  const ids = new Set(sets.flatMap((set) => groupChanges(set, 'wording')).map((change) => change.id));
  return orderedChanges(sets).filter((change) => ids.has(change.id) && !change.op.newInformation);
}

/**
 * Why a change cannot be accepted right now, and the change it waits on when
 * there is one. Each reason has a different answer for the author, so the
 * card says which (see `ChangeCard`):
 *
 * - `needs`: it builds on a block another suggestion adds — accept that one
 *   first. `needs-rejected`: that suggestion was rejected.
 * - `after`: another suggestion touches the same block, and the two give a
 *   different page in the other order — decide that one first.
 * - `locked`: it would edit a block the author locked or hid from the AI.
 * - `missing`: a block it names is no longer on the page.
 * - `stale`: its block changed after it was written.
 * - `unplaced`: the block it would go next to is gone.
 */
export type AcceptBlocker =
  | { reason: 'needs' | 'needs-rejected' | 'after'; change: ProposedChange }
  /** `sources`: the page's sources no longer match it (checked by the review, not here). */
  | { reason: 'locked' | 'missing' | 'stale' | 'unplaced' | 'sources' };

/**
 * What stops this change from being accepted right now; `null` when nothing
 * does.
 *
 * In order:
 *
 * 1. **Prerequisites.** `dependsOn` names changes that must have been
 *    *accepted*, because they create the block this one is addressed to. A
 *    change whose prerequisite was rejected can never become ready.
 * 2. **Precedence.** `after` (see `linkPrecedence`) names changes that must
 *    have been *decided*, either way, because accepting them in the other
 *    order changes the document. `dependsOn` cannot express this: it means
 *    "needs that to have happened", not "cannot be commuted with that".
 * 3. **Somewhere to land.** A change naming a block the author has deleted
 *    has no position to take. Offering Accept for it meant the only thing the
 *    button could do was raise an error, which reads as the app losing the
 *    change rather than as the document having moved on. That holds for a
 *    rewrite, deletion or move of a deleted block (or a move next to one) as
 *    much as for an insert.
 * 4. **Still current.** A rewrite or deletion of a block the author has
 *    edited since would throw that edit away (see `isStale`).
 *
 * Reject is never gated on any of this — see `ChangeCard`. Without `blocks`,
 * only the first two are checked.
 */
export function acceptBlocker(
  change: ProposedChange,
  sets: ChangeSet[],
  blocks?: Block[],
  after?: ReadonlyMap<string, string[]>,
): AcceptBlocker | null {
  const byId = new Map<string, ProposedChange>();
  for (const set of sets) for (const c of set.changes) byId.set(c.id, c);

  for (const id of change.dependsOn) {
    const prerequisite = byId.get(id);
    if (!prerequisite) return { reason: 'missing' };
    if (prerequisite.status === 'pending') return { reason: 'needs', change: prerequisite };
    if (prerequisite.status === 'rejected') return { reason: 'needs-rejected', change: prerequisite };
  }

  for (const id of after?.get(change.id) ?? []) {
    const earlier = byId.get(id);
    if (earlier?.status === 'pending') return { reason: 'after', change: earlier };
  }

  if (!blocks) return null;
  const affected = change.kind === 'move' && change.anchorBlockId !== null ? [change.anchorBlockId] : change.targetBlockIds;
  if (affected.some((id) => {
    const target = blocks.find((block) => block.id === id);
    return target?.locked === true || target?.aiHidden === true;
  })) return { reason: 'locked' };
  if (
    change.placement === null
    && change.references.some((id) => !blocks.some((block) => block.id === id))
  ) {
    return { reason: 'missing' };
  }
  if (isStale(change, blocks)) return { reason: 'stale' };
  return resolveAcceptOp(change, sets, blocks) === null ? { reason: 'unplaced' } : null;
}

/** Whether this change can be accepted right now (see `acceptBlocker`). */
export function isReady(
  change: ProposedChange,
  sets: ChangeSet[],
  blocks?: Block[],
  after?: ReadonlyMap<string, string[]>,
): boolean {
  return acceptBlocker(change, sets, blocks, after) === null;
}

/**
 * Whether a change moves blocks around: an insert, a deletion, a move, or a
 * rewrite written as several blocks (its extra blocks land after its block,
 * wherever that block stands when it is accepted).
 */
function isPositional(change: ProposedChange): boolean {
  return change.kind === 'insert' || change.kind === 'delete' || change.kind === 'move'
    || (change.kind === 'replace' && change.producesBlockIds.length > 0);
}

/**
 * Which changes must be decided before which, over the global authoring order.
 *
 * `resolveAcceptOp` makes inserts commute by positioning each one against its
 * landed siblings. Two kinds of operation cannot be made to commute that way
 * when they name the same block, so those pairs are serialised instead:
 *
 * - **A move** puts a block next to another, which changes what is next to
 *   what for every positional change addressed to either: `after(A, X)` then
 *   `move(B after A)` leaves `A, B, X`, the other order `A, X, B`.
 * - **A delete** removes the very blocks other changes are addressed to.
 *   Accepting `delete(B)` before `write_blocks(after B, X)` leaves the insert
 *   with no anchor, so the paragraph the author wanted to keep is the one
 *   that is lost.
 *
 * Every operation is addressed by block id, so two that name no block in
 * common give the same page in either order. A move used to be ordered
 * against every positional change on the page, in every batch: one change
 * the author could not accept yet (its text edited since, say) then held
 * back a move elsewhere and every addition after it, and the review offered
 * nothing but Reject.
 *
 * Edges always point from the later change to the earlier one, so the result
 * is acyclic by construction.
 */
export function linkPrecedence(sets: ChangeSet[]): Map<string, string[]> {
  const all = orderedChanges(sets);
  const after = new Map<string, string[]>(all.map((change) => [change.id, []]));

  all.forEach((later, i) => {
    for (const earlier of all.slice(0, i)) {
      if (!later.references.some((id) => earlier.references.includes(id))) continue;
      const moveInvolved = later.kind === 'move' || earlier.kind === 'move';
      const deleteInvolved = later.kind === 'delete' || earlier.kind === 'delete';
      if ((moveInvolved && isPositional(later) && isPositional(earlier)) || deleteInvolved) {
        after.get(later.id)?.push(earlier.id);
      }
    }
  });
  return after;
}

/**
 * Whether Auto must leave this change to the author (D18): it was written
 * against text that has changed since, or it rewrites, deletes or moves the
 * block the author is typing in, or a block they locked or hid from the AI.
 * An insert next to such a block leaves the block itself alone, and so does
 * a move of another block next to it.
 */
function needsAuthor(change: ProposedChange, blocks: readonly Block[], caretBlockId: string | null): boolean {
  if (change.op.newInformation) return true;
  if (isStale(change, blocks)) return true;
  const affected = change.kind === 'move' && change.anchorBlockId !== null ? [change.anchorBlockId] : change.targetBlockIds;
  return affected.some((id) => {
    if (id === caretBlockId) return true;
    const target = blocks.find((block) => block.id === id);
    return target?.locked === true || target?.aiHidden === true;
  });
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

/** The page's name, citation style and library: changes the header reviews. */
export function documentChanges(sets: ChangeSet[]): ProposedChange[] {
  return pendingChanges(sets).filter((c) => c.kind === 'meta' || c.kind === 'sources');
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
 * `write_blocks` after a block lands immediately next to a fixed point, so
 * replaying several in order pushes every earlier one further away: three
 * writes after `A`, authored X then Y then Z, end up as `A, Z, Y, X`. Before a
 * block and at the end, each lands against a point that moves with them, so
 * they keep their authored order. Within one operation the blocks keep
 * theirs.
 *
 * This is the server's replay semantics, not a preference — it is what the
 * stored document will look like, so it is what the review has to show.
 */
function slotIsReversed(placement: ProposedChange['placement']): boolean {
  return placement === 'after';
}

/* ----------------------------------------
   Projection
   ---------------------------------------- */

/** One row of the document as the author sees it while a review is open. */
export type DocumentRow =
  | {
      kind: 'block';
      block: Block;
      /** Rewrites, deletions and moves, which are about this block: their cards go under it. */
      changes: ProposedChange[];
      /**
       * Deletions of several blocks whose card sits on another of them: this
       * block is shown struck through in place.
       */
      struck: ProposedChange[];
    }
  /** An addition, with every block it adds, where they would land. */
  | { kind: 'insert'; change: ProposedChange }
  /**
   * A rewrite, deletion or move of a block another pending change adds,
   * shown right after that change: it can be decided once that one is.
   */
  | { kind: 'dependent'; change: ProposedChange };

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
 * - A chained insert (`write_blocks after A [X]` then `after X [Y]` — how an
 *   agent adds consecutive paragraphs) resolves against the pending `X` and
 *   renders under it. It used to count as an orphan, land at the very bottom
 *   of the page, and claim its block had been deleted.
 *
 * An insert is one row with all of its blocks; one addressed to a block in
 * the middle of another pending insert's blocks is shown after that row (the
 * accept itself lands exactly). A deletion of several blocks has its card on
 * the first one still on the page, and strikes the others where they are.
 *
 * A rewrite, deletion or move of a block that a pending change adds (in its
 * own batch or an earlier one of the run) is shown right after that change.
 * A change is only an orphan when its block is in neither the document nor
 * a pending change.
 */
export function projectDocument(blocks: Block[], sets: ChangeSet[]): DocumentProjection {
  const pending = pendingChanges(sets);
  const present = new Set(blocks.map((block) => block.id));
  const adding = new Set(pending.flatMap((change) => change.producesBlockIds));
  const orphans: ProposedChange[] = [];
  /** Changes to a block a pending change adds, with that block. */
  const dependents: Array<{ change: ProposedChange; blockId: string }> = [];

  const onBlock = new Map<string, ProposedChange[]>();
  const struck = new Map<string, ProposedChange[]>();
  const add = (map: Map<string, ProposedChange[]>, id: string, change: ProposedChange) => {
    const list = map.get(id);
    if (list) list.push(change);
    else map.set(id, [change]);
  };
  for (const change of pending) {
    if (change.kind === 'meta' || change.kind === 'sources' || change.placement !== null) continue;
    // The row a rewrite, deletion or move sits on: its block, or for a
    // deletion the first of its blocks still on the page. One whose blocks
    // the author has since deleted has no row; without this it was dropped
    // from the projection entirely while the review bar went on counting it,
    // a change the author could neither see nor dismiss.
    const rows = change.kind === 'delete' ? change.targetBlockIds.filter((id) => present.has(id)) : [change.anchorBlockId];
    const [row, ...others] = rows;
    if (row === null || row === undefined || !present.has(row)) {
      const added = (change.kind === 'delete' ? change.targetBlockIds : [change.anchorBlockId])
        .find((id): id is string => id !== null && adding.has(id));
      if (added !== undefined) dependents.push({ change, blockId: added });
      else orphans.push(change);
      continue;
    }
    add(onBlock, row, change);
    for (const other of others) if (other !== null) add(struck, other, change);
  }

  const rows: DocumentRow[] = blocks.map((block) => ({
    kind: 'block',
    block,
    changes: onBlock.get(block.id) ?? [],
    struck: struck.get(block.id) ?? [],
  }));

  /** The ids a row stands for, so a pending insert can anchor another pending insert. */
  const idsOf = (row: DocumentRow): string[] =>
    row.kind !== 'block'
      ? row.change.producesBlockIds
      : [row.block.id, ...row.changes.flatMap((change) => (change.kind === 'replace' ? change.producesBlockIds : []))];

  for (const change of pending) {
    if (change.kind !== 'insert' || !change.placement) continue;

    const row: DocumentRow = { kind: 'insert', change };
    if (change.placement === 'end') {
      rows.push(row);
      continue;
    }

    const anchor = change.anchorBlockId;
    const at = rows.findIndex((candidate) => anchor !== null && idsOf(candidate).includes(anchor));
    if (at === -1) {
      orphans.push(change);
      continue;
    }
    rows.splice(change.placement === 'after' ? at + 1 : at, 0, row);
  }

  for (const { change, blockId } of dependents) {
    const at = rows.findIndex((candidate) => idsOf(candidate).includes(blockId));
    if (at === -1) {
      orphans.push(change);
      continue;
    }
    // After the row that adds the block, and after the changes to it already
    // placed there, so they read in authoring order.
    let end = at + 1;
    while (rows[end]?.kind === 'dependent') end += 1;
    rows.splice(end, 0, { kind: 'dependent', change });
  }

  return { rows, orphans };
}

/**
 * Rewrite an accepted change into the operation that puts it where authoring
 * order says it belongs, whatever order the author accepted things in.
 *
 * An insert is addressed relative to a fixed point — "after A", "at the end" —
 * and the previous accept path applied that address literally, against the
 * document as it stood at the moment of the click. So three appends X, Y, Z
 * accepted as Z, X, Y produced `Z, X, Y`, and `Accept all` on the same batch
 * produced `X, Y, Z`. Same decisions, different document.
 *
 * The fix is to position the blocks against the batch siblings that are
 * already in the document rather than against the raw address: everything
 * authored ahead of it in the same slot goes before, everything authored
 * behind it goes after, and where the slot replays back-to-front (see
 * `slotIsReversed`) those two are swapped. Siblings the author has since
 * deleted are simply not there to constrain it.
 *
 * Returns `null` when the change genuinely cannot be placed — its anchor is
 * gone — which the caller reports as a desync rather than guessing at.
 */
export function resolveAcceptOp(
  change: ProposedChange,
  sets: ChangeSet[],
  blocks: Block[],
): ToolOperation | null {
  if (change.kind !== 'insert' || !change.placement || change.op.op !== 'write_blocks') return change.op;

  const slot = slotKey(change);
  const sequence = changeSequence(sets);
  const own = sequence.get(change.id) ?? change.order;
  const reversed = slotIsReversed(change.placement);

  // Batch siblings aimed at the same place that are already in the document.
  const precede: number[] = [];
  const follow: number[] = [];
  for (const sibling of orderedChanges(sets)) {
    if (sibling.id === change.id || sibling.status !== 'accepted') continue;
    if (slotKey(sibling) !== slot) continue;
    const landed = sibling.producesBlockIds
      .map((id) => blocks.findIndex((block) => block.id === id))
      .filter((at) => at !== -1);
    if (landed.length === 0) continue;
    const rank = sequence.get(sibling.id) ?? sibling.order;
    const isEarlier = reversed ? rank > own : rank < own;
    if (isEarlier) precede.push(Math.max(...landed));
    else follow.push(Math.min(...landed));
  }

  let anchorIndex = -1;
  if (change.anchorBlockId !== null) {
    anchorIndex = blocks.findIndex((block) => block.id === change.anchorBlockId);
    if (anchorIndex === -1) return null;
  }

  // Where the slot puts these blocks when no sibling has landed yet.
  const alone =
    change.placement === 'after'
      ? anchorIndex + 1
      : change.placement === 'before'
        ? anchorIndex
        : blocks.length;

  const lower = precede.length > 0 ? Math.max(...precede) + 1 : alone;
  const upper = follow.length > 0 ? Math.min(...follow) : blocks.length;
  const index = Math.max(0, Math.min(lower, upper, blocks.length));

  const { basis, newInformation, blocks: written } = change.op;
  const review = { ...(basis ? { basis } : {}), ...(newInformation !== undefined ? { newInformation } : {}) };
  const previous = index > 0 ? blocks[index - 1] : undefined;
  if (previous) return { op: 'write_blocks', position: 'after', blockId: previous.id, blocks: written, ...review };
  const first = blocks[0];
  return first
    ? { op: 'write_blocks', position: 'before', blockId: first.id, blocks: written, ...review }
    : { op: 'write_blocks', position: 'append', blockId: null, blocks: written, ...review };
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

/** Whether `change` continues from a block `rejected` would have added. */
function continuesFrom(change: ProposedChange, rejected: ProposedChange): boolean {
  return (
    change.kind === 'insert'
    && (change.placement === 'after' || change.placement === 'before')
    && rejected.kind === 'insert'
    && rejected.placement !== null
    && change.anchorBlockId !== null
    && rejected.producesBlockIds.includes(change.anchorBlockId)
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
 *
 * That holds across batches too: a later batch of the same run can build on
 * a block an earlier one adds (see `linkAcrossSets`).
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
    for (const change of orderedChanges(sets)) {
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
  if (change.op.op !== 'write_blocks') return change.op;
  const op = change.op;
  return rejected.placement === 'end' || rejected.anchorBlockId === null
    ? { ...op, position: 'append', blockId: null }
    : { ...op, position: rejected.placement === 'before' ? 'before' : 'after', blockId: rejected.anchorBlockId };
}

/** A continuation moved onto the place of the insert it continued, which was rejected. */
function movedOnto(change: ProposedChange, rejected: ProposedChange): ProposedChange {
  return {
    ...change,
    op: readdress(change, rejected),
    anchorBlockId: rejected.anchorBlockId,
    placement: rejected.placement,
    references: rejected.references,
    // Its anchor is now the rejected insert's anchor, which may itself be
    // a pending insert.
    dependsOn: [...rejected.dependsOn],
  };
}

/** The change, in any of `sets`, that adds the block `blockId`. */
export function producerOf(blockId: string, sets: readonly ChangeSet[]): ProposedChange | undefined {
  for (const set of sets) {
    const found = set.changes.find((change) => change.producesBlockIds.includes(blockId));
    if (found) return found;
  }
  return undefined;
}

/**
 * Tie a batch to the batches staged before it.
 *
 * A batch of a run is written on top of the run's earlier batches while they
 * are still pending (`depends_on_change_set_id`), so it can name a block one
 * of them adds: a rewrite of the paragraph the previous call wrote, or the
 * next section after its last paragraph. `buildChangeSet` only sees its own
 * batch, so such a change looked like one whose block had been deleted, and
 * was offered for rejection only. Here it depends on the change that adds
 * the block, as a change of the same batch would: it can be accepted once
 * that one is, and rejecting that one takes it along (`planRejection`).
 *
 * A continuation of an addition that was already rejected takes that
 * addition's place, as it would have when the rejection was made.
 */
export function linkAcrossSets(set: ChangeSet, earlier: readonly ChangeSet[]): ChangeSet {
  const others = earlier.filter((candidate) => candidate.id !== set.id);
  if (others.length === 0) return set;
  let changed = false;
  const changes = set.changes.map((original) => {
    let change = original;
    // A rejected addition may itself have continued another rejected one.
    for (let hop = 0; hop < 32; hop += 1) {
      const anchor = change.anchorBlockId;
      const rejected = anchor === null ? undefined : producerOf(anchor, others);
      if (!rejected || rejected.status !== 'rejected' || !continuesFrom(change, rejected)) break;
      change = movedOnto(change, rejected);
    }
    const linked = change.references.flatMap((id) => {
      const producer = producerOf(id, others);
      return producer && !change.dependsOn.includes(producer.id) ? [producer.id] : [];
    });
    if (linked.length > 0) change = { ...change, dependsOn: [...change.dependsOn, ...new Set(linked)] };
    if (change !== original) changed = true;
    return change;
  });
  return changed ? { ...set, changes } : set;
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
    reanchored.map((change) => [change.id, movedOnto(change, target)]),
  );
  const own = new Set(set.changes.map((change) => change.id));

  // Document order of the continuations: before-X inserts keep their order,
  // after-X inserts replay back-to-front. A continuation in a later batch
  // keeps its place in that batch.
  const local = reanchored.filter((change) => own.has(change.id));
  const shown = [
    ...local.filter((change) => change.placement === 'before').sort(byOrder),
    ...local.filter((change) => change.placement === 'after').sort(byOrder).reverse(),
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

  const next = sets.map((candidate, index) => {
    if (index === setIndex) return { ...set, changes };
    if (!candidate.changes.some((change) => moved.has(change.id) || rejected.has(change.id))) return candidate;
    return {
      ...candidate,
      changes: candidate.changes.map((change) => {
        const decided = moved.get(change.id) ?? change;
        return rejected.has(change.id) ? { ...decided, status: 'rejected' as const } : decided;
      }),
    };
  });
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
 * insert whose blocks are there has landed — accepting it again is refused
 * as a duplicate id, which read as the change having lost its place. A
 * rewrite that leaves its block exactly as it is (and whose new blocks are
 * there), a deletion of blocks that are all gone, and a move whose block
 * already sits there, have nothing left to do either.
 *
 * The caller checks prerequisites first: a deletion of a block the batch has
 * not created yet is not "already done".
 */
export function alreadyInDocument(change: ProposedChange, blocks: readonly Block[]): boolean {
  const has = (id: string) => blocks.some((block) => block.id === id);
  switch (change.kind) {
    case 'insert':
      return change.producesBlockIds.length > 0 && change.producesBlockIds.every(has);
    case 'delete':
      return change.targetBlockIds.every((id) => !has(id));
    case 'replace': {
      const current = blocks.find((block) => block.id === change.anchorBlockId);
      const merged = mergedBlock(change, current);
      // Every field, view-only ones included: this asks whether applying it
      // would change anything at all.
      return current !== undefined && merged !== null
        && stableStringify(merged) === stableStringify(current)
        && change.producesBlockIds.every(has);
    }
    case 'move': {
      if (change.op.op !== 'move_block') return false;
      const { blockId, targetBlockId, position } = change.op;
      const at = blocks.findIndex((block) => block.id === blockId);
      const target = blocks.findIndex((block) => block.id === targetBlockId);
      return at !== -1 && target !== -1 && at === target + (position === 'after' ? 1 : -1);
    }
    case 'meta':
    case 'sources':
      return false;
  }
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
 * its continuations exactly as it did the first time. With `blocks`, changes
 * the document already holds are
 * marked accepted too (see `alreadyInDocument`); without, nothing is decided
 * beyond what was stored. Returns the batch and the operations found already
 * in the document, which the caller records as accepted.
 */
export function resumeReview(
  set: ChangeSet,
  stored: { decisions: readonly ReviewDecision[] } | null,
  blocks: readonly Block[] | null,
): { set: ChangeSet; landed: number[] } {
  // The helpers below work on lists of batches; this one is the only one.
  let current: ChangeSet = set;
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
    if (row.kind === 'block') ordered.push(...row.changes);
    else ordered.push(row.change);
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
  doc: Doc,
): AcceptPlan {
  if (changes.length === 0) return { ops: [], applied: [], desynced: [] };
  const rank = changeSequence(sets);
  const queue = [...changes].sort(
    (a, b) => (rank.get(a.id) ?? a.order) - (rank.get(b.id) ?? b.order),
  );

  const ops: ToolOperation[] = [];
  const applied: ProposedChange[] = [];
  const desynced: ProposedChange[] = [];

  let projected = doc;
  // Statuses advance as the plan is built, so each change is positioned
  // against the siblings the ones before it have just put in the document.
  let projectedSets = sets;
  const after = linkPrecedence(sets);

  for (const entry of queue) {
    // Each step can rebase a later change's fingerprints. Use the current
    // projected change, not the snapshot taken before the first operation.
    const change = projectedSets.flatMap((set) => set.changes).find((candidate) => candidate.id === entry.id) ?? entry;
    // A filtered group may omit a pending prerequisite or a positional
    // predecessor. The presence of its target alone is not permission to
    // skip that decision. Simulate statuses and bases together as we proceed.
    if (!isReady(change, projectedSets, projected.blocks, after)) {
      desynced.push(change);
      continue;
    }
    const op = resolveAcceptOp(change, projectedSets, projected.blocks);
    if (!op) {
      desynced.push(change);
      continue;
    }

    const outcome = applyOperations(projected, [op]);
    if (outcome.desynced.length > 0) {
      desynced.push(change);
      continue;
    }

    ops.push(op);
    applied.push(change);
    const before = projected.blocks;
    projected = outcome.doc;
    projectedSets = markChanges(projectedSets, new Set([change.id]), 'accepted');
    projectedSets = rebaseAfterAccept(projectedSets, before, projected.blocks, outcome.touched);
  }

  return { ops, applied, desynced };
}

export type BulkAcceptOptions = { includeFlagged?: boolean };

/** Only a confirmed manual review opts into flagged changes; all other checks still apply. */
export function planBulkAccept(
  changes: ProposedChange[],
  sets: ChangeSet[],
  doc: Doc,
  { includeFlagged = false }: BulkAcceptOptions = {},
) {
  const candidates = changes.filter((change) => change.status === 'pending' && (includeFlagged || !change.op.newInformation));
  const landedIds = new Set<string>();
  for (const change of candidates) {
    if (change.kind === 'insert' && alreadyInDocument(change, doc.blocks)) landedIds.add(change.id);
  }
  const queue = candidates.filter((change) => !landedIds.has(change.id));
  const plan = resolveAcceptPlan(queue, markChanges(sets, landedIds, 'accepted'), doc);
  return { ...plan, landedIds, stale: plan.desynced.filter((change) => isStale(change, doc.blocks)) };
}

/* ----------------------------------------
   Rendering helpers
   ---------------------------------------- */

/**
 * The blocks an insert would add, or a rewrite would add after its own,
 * validated the same way a patch is.
 */
/**
 * The page's blocks, followed by the blocks pending changes would add that
 * are not on it yet: what a change to such a block is read against, to name
 * it and show it.
 */
export function withPendingBlocks(blocks: Block[], sets: ChangeSet[]): Block[] {
  const present = new Set(blocks.map((block) => block.id));
  const added = pendingChanges(sets).flatMap((change) =>
    proposedBlocks(change).filter((block) => !present.has(block.id)));
  return added.length > 0 ? [...blocks, ...added] : blocks;
}

export function proposedBlocks(change: ProposedChange): Block[] {
  const op = change.op;
  if (op.op !== 'write_blocks') return [];
  const written = op.blocks.map(coerceBlock).filter((block): block is Block => block !== null);
  return op.position === 'replace' ? written.slice(1) : written;
}

/**
 * The block as it would look after a rewrite: exactly what accepting it
 * applies (`applyPatchToBlocks`), the author's view flags kept.
 */
export function mergedBlock(change: ProposedChange, current: Block | undefined): Block | null {
  if (!current || change.kind !== 'replace') return null;
  const outcome = applyPatchToBlocks([current], [change.op]);
  return outcome.desynced.length === 0 ? outcome.blocks[0] ?? null : null;
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
      ` ${widgetStandIn(children.find((child) => child.id === attributeText(id)))} `,
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

  const blocksWord = (count: number) => (count === 1 ? 'block' : `${count} blocks`);

  switch (change.kind) {
    case 'insert': {
      const added = proposedBlocks(change);
      const [first] = added;
      return added.length > 1 ? `Add ${added.length} blocks${quoted(first)}` : `Add ${label(first)}${quoted(first)}`;
    }
    case 'replace': {
      const extra = change.producesBlockIds.length;
      return extra > 0
        ? `Rewrite ${label(target)}${quoted(target)} as ${extra + 1} blocks`
        : `Rewrite ${label(target)}${quoted(target)}`;
    }
    case 'delete': {
      const count = change.targetBlockIds.length;
      return count > 1 ? `Delete ${blocksWord(count)}${quoted(target)}` : `Delete ${label(target)}${quoted(target)}`;
    }
    case 'move':
      return `Move ${label(target)}${quoted(target)}`;
    case 'meta': {
      if (change.op.op !== 'set_meta') return 'Change the page';
      const { name, citationStyle } = change.op;
      if (name !== undefined && citationStyle !== undefined) return 'Rename page and change citation style';
      return name !== undefined ? 'Rename page' : 'Change citation style';
    }
    case 'sources': {
      const op = change.op;
      if (op.op === 'add_sources') {
        return `Add ${op.sources.length === 1 ? 'a source' : `${op.sources.length} sources`} to the page’s sources`;
      }
      if (op.op === 'remove_sources') {
        return `Remove ${op.keys.length === 1 ? 'a source' : `${op.keys.length} sources`} from the page’s sources`;
      }
      if (op.op === 'update_sources') {
        return `Refresh ${op.sources.length === 1 ? 'a reference' : `${op.sources.length} references`} from the registries`;
      }
      return 'Change the page’s sources';
    }
  }
}
