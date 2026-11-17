import { problemCode } from '@/api/errors';
import { sanitizeEditableHtml } from '@/export/sanitize';
import { placeholderIdList } from './placeholderIds';
import { MAX_BLOCK_INDENT } from './types';
import type { Block, Doc, ParagraphBlock, ParagraphChild, ParagraphVariant, ToolOperation } from './types';

/** Block types the canvas knows how to render. */
const BLOCK_TYPES = new Set<Block['type']>(['paragraph', 'heading', 'divider', 'code', 'image']);
const ASSET_ID_RE = /^ast-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const PARAGRAPH_VARIANTS = new Set<ParagraphVariant>(['bullet', 'numbered', 'todo', 'quote', 'callout']);

/** Same pattern as the API's `code.language` validator. */
const CODE_LANGUAGE_RE = /^[A-Za-z0-9][A-Za-z0-9+#._-]{0,39}$/;

/**
 * Fields each block type owns beyond id/type and the author flags. The
 * canonical model forbids unknown fields, so a block that picked up another
 * type's field — a heading still carrying `children` after a conversion —
 * fails the save of the whole document. Mirrors `_BLOCK_TYPE_FIELDS` in the
 * API's operations module.
 */
const BLOCK_META_FIELDS = ['id', 'type', 'aiHidden', 'locked', 'collapsed'];
const BLOCK_TYPE_FIELDS: Record<Block['type'], readonly string[]> = {
  paragraph: ['html', 'children', 'columns', 'variant', 'checked', 'indent'],
  heading: ['html', 'level', 'instructions'],
  divider: [],
  code: ['text', 'language'],
  image: ['assetId', 'alt', 'caption', 'width', 'label', 'origin'],
};

/** Drop every field the block's type does not own. */
function ownFields(candidate: Record<string, unknown>, type: Block['type']): Record<string, unknown> {
  const allowed = new Set([...BLOCK_META_FIELDS, ...BLOCK_TYPE_FIELDS[type]]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (allowed.has(key) && value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Paragraph role fields in canonical form: an unknown variant is dropped (the
 * text survives as body text), `checked` only on a to-do, and a top-level
 * indent is omitted rather than stored as 0.
 */
function paragraphRole(candidate: Record<string, unknown>): Partial<ParagraphBlock> {
  const role: Partial<ParagraphBlock> = {};
  const variant = candidate.variant;
  if (typeof variant === 'string' && PARAGRAPH_VARIANTS.has(variant as ParagraphVariant)) {
    role.variant = variant as ParagraphVariant;
  }
  if (role.variant === 'todo') role.checked = candidate.checked === true;
  const indent = Number(candidate.indent);
  if (Number.isFinite(indent) && indent >= 1) role.indent = Math.min(MAX_BLOCK_INDENT, Math.floor(indent));
  return role;
}

/** Inline widget types the canvas has a component for. */
const CHILD_TYPES = new Set<ParagraphChild['type']>([
  'aiBeat',
  'table',
  'citation',
  'equation',
  'graph',
]);

/** Ids of the inline-widget placeholders present in a paragraph's html, as its children name them. */
export function placeholderIds(html: string): Set<string> {
  return new Set(placeholderIdList(html));
}

/**
 * Validate inline children arriving from outside the editor.
 *
 * An unknown `type` has no component in the widget registry, and rendering
 * `undefined` as an element takes down the whole document rather than the
 * one widget, so such a child is dropped here rather than at each reader.
 */
export function coerceChildren(raw: unknown): ParagraphChild[] {
  if (!Array.isArray(raw)) return [];
  const out: ParagraphChild[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const child = value as Record<string, unknown>;
    if (typeof child.id !== 'string' || child.id === '') continue;
    if (!CHILD_TYPES.has(child.type as ParagraphChild['type'])) continue;
    out.push(child as unknown as ParagraphChild);
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
  // Blocks whose id or type the canvas cannot handle used to sail through
  // here (stored by an older build, or hand-edited into JSON) and render as
  // empty rows the author cannot select, edit, or delete. Same rejection rule
  // as `coerceBlock`, inlined so clean blocks keep their identity.
  const kept = blocks.filter((block) => {
    const ok =
      block &&
      typeof block.id === 'string' &&
      block.id !== '' &&
      BLOCK_TYPES.has(block.type) &&
      (block.type !== 'image' || coerceBlock(block) !== null);
    if (!ok) changed = true;
    return ok;
  });
  const out = kept.map((block) => {
    let next = block;
    // Sanitize persisted html: stored documents predate the ingest boundary,
    // so markup that the boundary now rejects can still be sitting in the
    // local cache or on the server. Widget placeholders are preserved —
    // dropping them would delete the widgets.
    if (
      (block.type === 'paragraph' || block.type === 'heading') &&
      typeof block.html === 'string'
    ) {
      const html = sanitizeEditableHtml(block.html);
      if (html !== block.html) next = { ...next, html } as Block;
    }
    if (next.type === 'code' && typeof next.text !== 'string') {
      next = { ...next, text: '' };
    }
    if (next.type === 'paragraph' && Array.isArray(next.children)) {
      const original = next.children;
      const children = coerceChildren(original);
      if (
        children.length !== original.length ||
        children.some((child, index) => child !== original[index])
      ) {
        next = { ...next, children };
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

  const own = ownFields(candidate, type as Block['type']);

  if (type === 'divider') return { ...own, id, type: 'divider' } as Block;

  if (type === 'image') {
    if (typeof candidate.assetId !== 'string' || !ASSET_ID_RE.test(candidate.assetId)
      || typeof candidate.alt !== 'string' || !candidate.alt.trim() || candidate.alt.length > 4000) return null;
    if (candidate.width !== undefined && (typeof candidate.width !== 'number'
      || !Number.isFinite(candidate.width) || candidate.width < 0.2 || candidate.width > 1)) return null;
    if (candidate.label != null && (typeof candidate.label !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,127}$/.test(candidate.label))) return null;
    if (candidate.caption != null && (typeof candidate.caption !== 'string' || candidate.caption.length > 10000)) return null;
    const origin = candidate.origin as Record<string, unknown> | undefined;
    if (!origin || (origin.kind !== 'upload' && origin.kind !== 'generated')) return null;
    if (origin.kind === 'generated' && (typeof origin.generationId !== 'string'
      || !/^gen-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(origin.generationId))) return null;
    return {
      ...own, id, type, assetId: candidate.assetId, alt: candidate.alt,
      caption: typeof candidate.caption === 'string' ? candidate.caption : undefined,
      width: candidate.width ?? 1,
      label: typeof candidate.label === 'string' ? candidate.label : undefined,
      origin,
    } as Block;
  }

  if (type === 'code') {
    // Plain text rendered as text, never as markup, so it needs no html
    // sanitizing — only a string.
    const text = typeof candidate.text === 'string' ? candidate.text : '';
    const language =
      typeof candidate.language === 'string' && CODE_LANGUAGE_RE.test(candidate.language)
        ? candidate.language
        : undefined;
    const { language: _language, ...rest } = own;
    return { ...rest, id, type: 'code', text, ...(language ? { language } : {}) } as Block;
  }

  // The html is as untrusted as the rest of the payload: it lands on the
  // canvas via `innerHTML`, so active markup must not survive this boundary.
  const html = typeof candidate.html === 'string' ? sanitizeEditableHtml(candidate.html) : '';

  if (type === 'heading') {
    const rawLevel = Number(candidate.level);
    const level = rawLevel === 1 || rawLevel === 2 || rawLevel === 3 ? rawLevel : 2;
    return { ...own, id, type: 'heading', level, html,
      instructions: typeof candidate.instructions === 'string' ? candidate.instructions : undefined } as Block;
  }

  const rawColumns = Number(candidate.columns);
  const columns = Number.isFinite(rawColumns)
    ? Math.max(1, Math.min(6, Math.floor(rawColumns)))
    : 1;
  const children = coerceChildren(candidate.children);
  const { variant: _variant, checked: _checked, indent: _indent, ...rest } = own;

  return withoutOrphanChildren({
    ...rest,
    id,
    type: 'paragraph',
    html,
    columns,
    children,
    ...paragraphRole(candidate),
  } as Block);
}

export type ApplyPatchResult = {
  blocks: Block[];
  /** Ops that could not be applied against the local copy. */
  desynced: ToolOperation[];
  /** Ids of blocks this patch touched, for change highlighting. */
  touched: string[];
  /**
   * True when nothing was applied because the document moved on since the
   * caller computed its plan. The caller should recompute against the
   * returned live `blocks` and retry.
   */
  stale?: boolean;
};

/** The flags that say how the author shows a block, not what it says. */
const VIEW_FLAGS = ['aiHidden', 'locked', 'collapsed'] as const;

/**
 * A stored block put in the place of `current`, keeping how the author shows
 * it. The stored block carries the flags as they were when it was proposed;
 * folding, locking or hiding the block since is the author's, and accepting a
 * rewrite of its text does not undo it. Folding only survives a block of the
 * same type, as on the server (`_apply_write_blocks`).
 */
function keepingView(next: Block, current: Block): Block {
  const out: Record<string, unknown> = { ...next };
  for (const flag of VIEW_FLAGS) {
    if (flag === 'collapsed' && next.type !== current.type) continue;
    if (current[flag] === true) out[flag] = true;
    else delete out[flag];
  }
  if (next.type === 'heading' && current.type === 'heading') out.instructions = current.instructions;
  return out as Block;
}

/**
 * Apply the block operations of a stored change set to a block list, as the
 * server applies them (`ColWrite-api/src/documents/domain/operations.py`).
 * Page-level operations (`set_meta`, the library) are `applyOperations`'.
 *
 * Accepting an operation is an edit of the author's document, so the goal is
 * the document the server's own replay gives. Where that is impossible — an
 * anchor that does not exist locally, an id already taken — the operation is
 * reported as desynced rather than guessed at: appending to the end or
 * unshifting to the top puts the content somewhere the agent never asked
 * for, which reads as corruption. An operation applies whole or not at all.
 */
export function applyPatchToBlocks(
  blocks: Block[],
  ops: ToolOperation[],
): ApplyPatchResult {
  let next = [...blocks];
  const desynced: ToolOperation[] = [];
  const touched: string[] = [];
  const indexOf = (id: string) => next.findIndex((block) => block.id === id);

  for (const op of ops) {
    switch (op.op) {
      case 'replace_text': {
        const at = indexOf(op.blockId);
        const current = next[at];
        // Coerced rather than cast: the stored block is as agent-authored as
        // an inserted one, and a bad child here would otherwise reach the
        // canvas by the one path that never validated.
        const block = coerceBlock(op.block);
        if (!current || !block || block.id !== op.blockId) {
          desynced.push(op);
          break;
        }
        next[at] = keepingView(block, current);
        touched.push(op.blockId);
        break;
      }
      case 'write_blocks': {
        const written = op.blocks.map(coerceBlock);
        const fresh = written.filter((block): block is Block => block !== null);
        const replaced = op.position === 'replace' && op.blockId !== null ? indexOf(op.blockId) : -1;
        const anchor = op.position === 'before' || op.position === 'after' ? indexOf(op.blockId ?? '') : -1;
        const taken = new Set(next.filter((_, index) => index !== replaced).map((block) => block.id));
        // An id already in the document is a desync, not an insert: applying
        // it produces duplicate React keys, and later updates split-brain
        // between the two copies.
        if (
          fresh.length !== written.length
          || new Set(fresh.map((block) => block.id)).size !== fresh.length
          || fresh.some((block) => taken.has(block.id))
          || (op.position === 'replace' && (replaced === -1 || fresh[0]?.id !== op.blockId))
          || ((op.position === 'before' || op.position === 'after') && anchor === -1)
        ) {
          desynced.push(op);
          break;
        }
        if (op.position === 'replace') {
          const current = next[replaced];
          const [first, ...rest] = fresh;
          if (!current || !first) {
            desynced.push(op);
            break;
          }
          next.splice(replaced, 1, keepingView(first, current), ...rest);
        } else {
          const at = op.position === 'append' ? next.length : anchor + (op.position === 'after' ? 1 : 0);
          next.splice(at, 0, ...fresh);
        }
        touched.push(...fresh.map((block) => block.id));
        break;
      }
      case 'delete_blocks': {
        const gone = new Set(op.blockIds);
        if (op.blockIds.some((id) => indexOf(id) === -1)) {
          desynced.push(op);
          break;
        }
        next = next.filter((block) => !gone.has(block.id));
        break;
      }
      case 'move_block': {
        const from = indexOf(op.blockId);
        const moved = next[from];
        if (!moved || op.blockId === op.targetBlockId || indexOf(op.targetBlockId) === -1) {
          desynced.push(op);
          break;
        }
        next.splice(from, 1);
        const target = indexOf(op.targetBlockId);
        next.splice(target + (op.position === 'after' ? 1 : 0), 0, moved);
        touched.push(op.blockId);
        break;
      }
      case 'set_meta':
      case 'add_sources':
      case 'remove_sources':
      case 'update_sources':
      case 'create_document':
        // Page-level state, not blocks (`applyOperations`).
        break;
    }
  }

  return { blocks: next, desynced, touched };
}

/** Every key a citation on these blocks cites. */
function citedKeys(blocks: readonly Block[]): Set<string> {
  const keys = new Set<string>();
  for (const block of blocks) {
    if (block.type !== 'paragraph') continue;
    for (const child of block.children ?? []) {
      if (child.type === 'citation') for (const key of child.keys) keys.add(key);
    }
  }
  return keys;
}

/**
 * Apply operations to the whole page in authoring order, with the server's refusals: a
 * source already in the library is not added again, one still cited on the
 * page is not removed, and a refresh names only works the library holds,
 * each once (`_apply_update_sources`).
 */
export function applyOperations(doc: Doc, ops: ToolOperation[]): ApplyPatchResult & { doc: Doc } {
  let next = doc;
  const desynced: ToolOperation[] = [];
  const touched: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'set_meta':
        next = {
          ...next,
          ...(op.name !== undefined ? { name: op.name } : {}),
          ...(op.citationStyle !== undefined ? { citationStyle: op.citationStyle } : {}),
        };
        break;
      case 'add_sources': {
        const library = next.sources ?? [];
        const held = new Set(library.map((source) => source.key));
        const keys = op.sources.map((source) => source.key);
        if (keys.some((key) => held.has(key)) || new Set(keys).size !== keys.length) {
          desynced.push(op);
          break;
        }
        next = { ...next, sources: [...library, ...op.sources] };
        break;
      }
      case 'remove_sources': {
        const library = next.sources ?? [];
        const held = new Set(library.map((source) => source.key));
        const cited = citedKeys(next.blocks);
        if (op.keys.some((key) => !held.has(key) || cited.has(key))) {
          desynced.push(op);
          break;
        }
        const gone = new Set(op.keys);
        const remaining = library.filter((source) => !gone.has(source.key));
        const { sources: _removed, ...rest } = next;
        next = remaining.length > 0 ? { ...rest, sources: remaining } : rest;
        break;
      }
      case 'update_sources': {
        const library = next.sources ?? [];
        const at = new Map(library.map((source, index) => [source.key, index]));
        const keys = op.sources.map((source) => source.key);
        if (keys.some((key) => !at.has(key)) || new Set(keys).size !== keys.length) {
          desynced.push(op);
          break;
        }
        const refreshed = [...library];
        for (const source of op.sources) refreshed[at.get(source.key) as number] = source;
        next = { ...next, sources: refreshed };
        break;
      }
      case 'create_document':
        break;
      default: {
        const result = applyPatchToBlocks(next.blocks, [op]);
        if (result.desynced.length > 0) desynced.push(op);
        else {
          next = { ...next, blocks: result.blocks };
          for (const id of result.touched) touched.push(id);
        }
        break;
      }
    }
  }
  return { blocks: next.blocks, touched, doc: next, desynced };
}

/** Above this many reordered blocks, only the smaller group is reported. */
const MOVED_SHOWN = 8;

/**
 * What going from one document state to another touched: the blocks that are
 * new or different in `to`; when blocks only changed places, the ones that
 * moved; and when blocks only went away, the one that now stands where the
 * first of them was.
 */
export function replayFootprint(from: Doc, to: Doc): { changed: string[]; near: string | null } {
  const before = new Map(from.blocks.map((block) => [block.id, block]));
  const changed = to.blocks.filter((block) => before.get(block.id) !== block).map((block) => block.id);
  if (changed.length > 0) return { changed, near: null };

  const kept = new Set(to.blocks.map((block) => block.id));
  const firstGone = from.blocks.findIndex((block) => !kept.has(block.id));
  if (firstGone !== -1) {
    const neighbour = from.blocks.slice(0, firstGone).reverse().find((block) => kept.has(block.id))
      ?? from.blocks.slice(firstGone).find((block) => kept.has(block.id));
    return { changed, near: neighbour?.id ?? null };
  }

  // Same blocks in another order. A block dragged a long way shifts every
  // block it passed by one place; those are not what the author moved, so
  // past a handful only the smaller group counts.
  const was = new Map(from.blocks.map((block, index) => [block.id, index]));
  const down: string[] = [];
  const up: string[] = [];
  to.blocks.forEach((block, index) => {
    const old = was.get(block.id);
    if (old === undefined || old === index) return;
    (index > old ? down : up).push(block.id);
  });
  if (down.length + up.length <= MOVED_SHOWN) {
    const moved = new Set([...down, ...up]);
    return { changed: to.blocks.filter((block) => moved.has(block.id)).map((block) => block.id), near: null };
  }
  return { changed: down.length <= up.length ? down : up, near: null };
}

/**
 * Whether a save was refused because someone saved the page since the head
 * it was based on: 412 `stale_head`, the `If-Match` ETag no longer the head.
 *
 * Trying again cannot help: the same body over the same ETag is refused
 * every time. The author has to choose which version stays. The route's 409
 * `schema_unsupported` is content stored by a newer server than this one
 * can read, which no choice of version settles.
 */
export function isSaveConflict(error: unknown): boolean {
  return problemCode(error) === 'stale_head';
}

/**
 * A value with its keys in order and its default-valued fields left out.
 *
 * The editor writes `columns: 1`, `children: []` and `checked: false`; the
 * server may store a block without them. Both describe the same block.
 */
function canonicalContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalContent);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = canonicalContent((value as Record<string, unknown>)[key]);
    if (item === undefined || item === null || item === false || item === '') continue;
    if (Array.isArray(item) && item.length === 0) continue;
    if ((key === 'columns' && item === 1) || (key === 'indent' && item === 0)) continue;
    out[key] = item;
  }
  return out;
}

/**
 * Whether two documents hold the same content, however each writer spelled
 * its defaults.
 */
export function sameContent(a: Doc, b: Doc): boolean {
  if (a.blocks === b.blocks && a.name === b.name && a.sources === b.sources && a.citationStyle === b.citationStyle) {
    return true;
  }
  const content = (doc: Doc) => JSON.stringify(canonicalContent({
    blocks: doc.blocks,
    name: doc.name,
    sources: doc.sources,
    citationStyle: doc.citationStyle,
  }));
  return content(a) === content(b);
}

/** Turn a save rejection into something worth showing a writer. */
export function describeSaveError(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  if (problemCode(error) === 'schema_unsupported') {
    return 'This page was saved by a newer version of ColWrite, so it cannot be changed from here.';
  }
  if (isSaveConflict(error)) {
    return 'This page was changed somewhere else, so your latest edits are not saved yet.';
  }
  if (status === 404) {
    return 'This page no longer exists on the server.';
  }
  if (status === 401 || status === 403) {
    return 'Your session expired, so changes are no longer being saved.';
  }
  const message = error instanceof Error ? error.message : '';
  return message ? `Changes could not be saved: ${message}` : 'Changes could not be saved.';
}
