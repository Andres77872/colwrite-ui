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
 */

import type { Block, ToolAction, ToolOperation } from './types';
import { coerceBlock } from './docOps';
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
 * Whether every change this one depends on has been accepted.
 *
 * A change whose prerequisite was rejected can never become ready; the review
 * UI shows it as blocked and rejecting the prerequisite discards it too.
 */
export function isReady(change: ProposedChange, sets: ChangeSet[]): boolean {
  if (change.dependsOn.length === 0) return true;
  const byId = new Map<string, ProposedChange>();
  for (const set of sets) for (const c of set.changes) byId.set(c.id, c);
  return change.dependsOn.every((id) => byId.get(id)?.status === 'accepted');
}

/** Every change still awaiting a decision that is anchored to a given block. */
export function changesForBlock(sets: ChangeSet[], blockId: string): ProposedChange[] {
  return pendingChanges(sets).filter((c) => c.anchorBlockId === blockId);
}

/** Pending inserts with no anchor block — they belong at a document edge. */
export function edgeChanges(sets: ChangeSet[], edge: 'start' | 'end'): ProposedChange[] {
  return pendingChanges(sets).filter((c) => c.placement === edge);
}

/**
 * Pending changes whose anchor block is not in the document.
 *
 * The agent read the document a moment before the author deleted the very
 * paragraph it was rewriting. Without somewhere to put these, they render
 * nowhere at all — and the review bar keeps counting a change the author has
 * no way to reach, let alone dismiss.
 */
export function orphanChanges(sets: ChangeSet[], blocks: Block[]): ProposedChange[] {
  const present = new Set(blocks.map((block) => block.id));
  return pendingChanges(sets).filter(
    (change) =>
      change.kind !== 'rename' &&
      change.anchorBlockId !== null &&
      !present.has(change.anchorBlockId),
  );
}

/** Renames and other document-level changes, which the header reviews. */
export function documentChanges(sets: ChangeSet[]): ProposedChange[] {
  return pendingChanges(sets).filter((c) => c.kind === 'rename');
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

  switch (change.kind) {
    case 'insert':
      return `Add ${label(proposedBlock(change))}`;
    case 'replace':
      return `Rewrite ${label(target)}`;
    case 'delete':
      return `Delete ${label(target)}`;
    case 'reorder':
      return `Move ${label(target)}`;
    case 'rename':
      return 'Rename document';
  }
}
