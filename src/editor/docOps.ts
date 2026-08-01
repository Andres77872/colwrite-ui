import { citationYear } from './citations';
import type { Block, ParagraphChild, ToolOperation } from './types';

/** Block types the canvas knows how to render. */
const BLOCK_TYPES = new Set<Block['type']>(['paragraph', 'heading', 'divider']);

/** Inline widget types the canvas has a component for. */
const CHILD_TYPES = new Set<ParagraphChild['type']>([
  'aiBeat',
  'table',
  'citation',
  'equation',
  'graph',
]);

const CHILD_ID_RE = /data-child-id="([^"]+)"/g;

/** Ids of the inline-widget placeholders present in a paragraph's html. */
export function placeholderIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const match of html.matchAll(CHILD_ID_RE)) ids.add(match[1]);
  return ids;
}

/**
 * Validate inline children arriving from outside the editor.
 *
 * Two things get in here that the canvas cannot render. An unknown `type` has
 * no component in the widget registry, and rendering `undefined` as an element
 * takes down the whole document rather than the one widget. And a citation
 * `year` can arrive as a number — the agent's `doc_edit` schema accepts a
 * provider-style integer — which used to throw the moment the reference list
 * formatted it.
 *
 * Both are dropped or repaired here rather than at each reader, so the rest of
 * the editor can trust the declared types.
 */
export function coerceChildren(raw: unknown): ParagraphChild[] {
  if (!Array.isArray(raw)) return [];
  const out: ParagraphChild[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const child = value as Record<string, unknown>;
    if (typeof child.id !== 'string' || child.id === '') continue;
    if (!CHILD_TYPES.has(child.type as ParagraphChild['type'])) continue;

    if (child.type !== 'citation' || !Array.isArray(child.sources)) {
      out.push(child as unknown as ParagraphChild);
      continue;
    }
    out.push({
      ...child,
      sources: child.sources.map((source) => {
        if (!source || typeof source !== 'object') return source;
        const year = citationYear((source as Record<string, unknown>).year);
        const { year: _dropped, ...rest } = source as Record<string, unknown>;
        return year ? { ...rest, year } : rest;
      }),
    } as unknown as ParagraphChild);
  }
  return out;
}

/**
 * Drop `children` entries whose placeholder span is gone from the html.
 *
 * The two halves of a paragraph are edited independently: `updateHtml` writes
 * the serialized contenteditable, while `children` is a separate array. Delete
 * a widget in the browser and the span disappears but the child stays — an
 * entry with no rendered position, invisible to the user, that makes the
 * backend's html/children validation fail for the whole document.
 */
export function withoutOrphanChildren(block: Block): Block {
  if (block.type !== 'paragraph') return block;
  const children = block.children;
  if (!Array.isArray(children) || children.length === 0) return block;

  const present = placeholderIds(block.html ?? '');
  const kept = children.filter((child: ParagraphChild) => present.has(child.id));
  if (kept.length === children.length) return block;
  return { ...block, children: kept };
}

/**
 * Repair every paragraph in a document. Used when adopting foreign state.
 *
 * This is the load path as well as the adopt path, so it has to survive
 * whatever is already stored: documents written before the child contract was
 * enforced can hold an unrenderable widget or a numeric year, and neither
 * should cost the author their document.
 */
export function reconcileBlocks(blocks: Block[]): Block[] {
  let changed = false;
  const out = blocks.map((block) => {
    let next = block;
    if (block.type === 'paragraph' && Array.isArray(block.children)) {
      const children = coerceChildren(block.children);
      if (children.length !== block.children.length) next = { ...block, children };
      else if (children.some((child, index) => child !== block.children![index])) {
        next = { ...block, children };
      }
    }
    next = withoutOrphanChildren(next);
    if (next !== block) changed = true;
    return next;
  });
  return changed ? out : blocks;
}

/**
 * Validate a block that arrived from the server before it enters editor state.
 *
 * Tool payloads are typed as `Record<string, unknown>` on the wire and used to
 * be cast straight to `Block`. A block with an unknown `type` renders as an
 * empty row the user cannot select, edit, or delete.
 */
export function coerceBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;

  const id = candidate.id;
  if (typeof id !== 'string' || id === '') return null;

  const type = candidate.type;
  if (typeof type !== 'string' || !BLOCK_TYPES.has(type as Block['type'])) return null;

  if (type === 'divider') return { ...candidate, id, type: 'divider' } as Block;

  const html = typeof candidate.html === 'string' ? candidate.html : '';

  if (type === 'heading') {
    const rawLevel = Number(candidate.level);
    const level = rawLevel === 1 || rawLevel === 2 || rawLevel === 3 ? rawLevel : 2;
    return { ...candidate, id, type: 'heading', level, html } as Block;
  }

  const rawColumns = Number(candidate.columns);
  const columns = Number.isFinite(rawColumns)
    ? Math.max(1, Math.min(6, Math.floor(rawColumns)))
    : 1;
  const children = coerceChildren(candidate.children);

  return withoutOrphanChildren({
    ...candidate,
    id,
    type: 'paragraph',
    html,
    columns,
    children,
  } as Block);
}

export type ApplyPatchResult = {
  blocks: Block[];
  /** Ops that could not be applied against the local copy. */
  desynced: ToolOperation[];
  /** Ids of blocks this patch touched, for change highlighting. */
  touched: string[];
};

/**
 * Apply agent tool operations to a block list.
 *
 * The server has already committed these operations, so the goal is to end up
 * with the same document it has. Where that is impossible — an insert whose
 * reference block does not exist locally — the op is reported as desynced
 * rather than guessed at: appending to the end or unshifting to the top puts
 * the content somewhere the agent never asked for, which reads as corruption.
 */
export function applyPatchToBlocks(
  blocks: Block[],
  ops: ToolOperation[],
): ApplyPatchResult {
  let next = [...blocks];
  const desynced: ToolOperation[] = [];
  const touched: string[] = [];

  const insertAt = (index: number, op: ToolOperation, raw: unknown) => {
    const block = coerceBlock(raw);
    if (!block) {
      desynced.push(op);
      return;
    }
    next.splice(index, 0, block);
    touched.push(block.id);
  };

  for (const op of ops) {
    switch (op.op) {
      case 'replace_block': {
        const idx = next.findIndex((b) => b.id === op.blockId);
        if (idx === -1) {
          desynced.push(op);
          break;
        }
        // A partial merge, mirroring the server: unspecified fields are kept.
        // Coerced rather than cast, because the merged result is as much
        // agent-authored as an inserted block is — a bad child here would
        // otherwise reach the canvas by the one path that never validated.
        const merged = coerceBlock({ ...next[idx], ...op.block });
        if (!merged) {
          desynced.push(op);
          break;
        }
        next[idx] = merged;
        touched.push(op.blockId);
        break;
      }
      case 'insert_block_after': {
        const idx = next.findIndex((b) => b.id === op.referenceId);
        if (idx === -1) {
          desynced.push(op);
          break;
        }
        insertAt(idx + 1, op, op.block);
        break;
      }
      case 'insert_block_before': {
        const idx = next.findIndex((b) => b.id === op.referenceId);
        if (idx === -1) {
          desynced.push(op);
          break;
        }
        insertAt(idx, op, op.block);
        break;
      }
      case 'insert_block_at_start':
        insertAt(0, op, op.block);
        break;
      case 'append_block':
        insertAt(next.length, op, op.block);
        break;
      case 'delete_block': {
        const idx = next.findIndex((b) => b.id === op.blockId);
        if (idx === -1) {
          desynced.push(op);
          break;
        }
        next = [...next.slice(0, idx), ...next.slice(idx + 1)];
        break;
      }
      case 'reorder_block': {
        const from = next.findIndex((b) => b.id === op.blockId);
        if (from === -1) {
          desynced.push(op);
          break;
        }
        const [moved] = next.splice(from, 1);
        // The server sends an absolute index it already translated out of the
        // AI-visible (aiHidden-filtered) index space.
        next.splice(Math.max(0, Math.min(op.toIndex, next.length)), 0, moved);
        touched.push(op.blockId);
        break;
      }
      case 'update_meta':
      case 'create_document':
        // Handled by the caller — these target document state, not blocks.
        break;
    }
  }

  return { blocks: next, desynced, touched };
}

/** Turn a save rejection into something worth showing a writer. */
export function describeSaveError(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  if (status === 409) {
    return 'This document changed elsewhere, so your latest edits were not saved. Reload to get the current version.';
  }
  if (status === 404) {
    return 'This document no longer exists on the server.';
  }
  if (status === 401 || status === 403) {
    return 'Your session expired, so changes are no longer being saved.';
  }
  const message = error instanceof Error ? error.message : '';
  return message ? `Changes could not be saved: ${message}` : 'Changes could not be saved.';
}
