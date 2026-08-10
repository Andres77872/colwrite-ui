import { describe, it, expect } from 'vitest';
import type { Block, ParagraphBlock, ToolOperation } from '../types';
import {
  applyPatchToBlocks,
  coerceBlock,
  describeSaveError,
  placeholderIds,
  reconcileBlocks,
  withoutOrphanChildren,
} from '../docOps';

// ── Fixtures ──

// Typed as ParagraphBlock rather than Block: spreading a `Partial<Block>` over
// a paragraph literal widens `type` back to the full union and breaks the
// discriminant.
const makeBlock = (id: string, overrides: Partial<ParagraphBlock> = {}): ParagraphBlock => ({
  id,
  type: 'paragraph',
  html: `<p>${id}</p>`,
  ...overrides,
});

/** Reads `html` off a block in assertions; dividers legitimately have none. */
const htmlOf = (block: Block | undefined): string | undefined =>
  block && 'html' in block ? block.html : undefined;

const initialBlocks: Block[] = [makeBlock('a'), makeBlock('b'), makeBlock('c')];

const blocksOf = (blocks: Block[], ops: ToolOperation[]) =>
  applyPatchToBlocks(blocks, ops).blocks;

// ── applyPatchToBlocks ──

describe('applyPatchToBlocks', () => {
  it('replaces a block by id, merging partial fields', () => {
    const result = blocksOf(initialBlocks, [
      { op: 'replace_block', blockId: 'b', block: { html: '<p>Updated B</p>' } },
    ]);
    expect(result).toHaveLength(3);
    expect(htmlOf(result[1])).toBe('<p>Updated B</p>');
    // Unspecified fields survive the merge, matching the server.
    expect(result[1].type).toBe('paragraph');
  });

  it('validates the merged block, not just the inserted ones', () => {
    // `replace_block` used to spread the agent's payload over the current
    // block and cast the result, so it was the one write path that could put
    // an unrenderable child on the canvas.
    const result = blocksOf(initialBlocks, [
      {
        op: 'replace_block',
        blockId: 'b',
        block: {
          html: '<span data-child-id="c1"></span><span data-child-id="c2"></span>',
          children: [
            { id: 'c1', type: 'footnote' },
            { id: 'c2', type: 'citation', keys: ['k'], sources: [{ key: 'k', year: 2020 }] },
          ],
        },
      },
    ]);

    expect((result[1] as ParagraphBlock).children).toEqual([
      { id: 'c2', type: 'citation', keys: ['k'], sources: [{ key: 'k', year: '2020' }] },
    ]);
  });

  it('reports a replace_block that would destroy the block as desynced', () => {
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      { op: 'replace_block', blockId: 'b', block: { type: 'sidebar' } },
    ]);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toHaveLength(1);
  });

  it('reports replace_block against a missing id as desynced', () => {
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      { op: 'replace_block', blockId: 'nonexistent', block: { html: '<p>X</p>' } },
    ]);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toHaveLength(1);
  });

  it('inserts a block after a reference', () => {
    const result = blocksOf(initialBlocks, [
      { op: 'insert_block_after', referenceId: 'a', block: makeBlock('new') },
    ]);
    expect(result.map((b) => b.id)).toEqual(['a', 'new', 'b', 'c']);
  });

  it('inserts a block before a reference', () => {
    const result = blocksOf(initialBlocks, [
      { op: 'insert_block_before', referenceId: 'b', block: makeBlock('new') },
    ]);
    expect(result.map((b) => b.id)).toEqual(['a', 'new', 'b', 'c']);
  });

  it('does NOT guess a position when the reference block is missing', () => {
    // Landing the block at the far end of the document instead reads as
    // corruption — the agent asked for a specific position that this copy of
    // the document cannot express.
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      { op: 'insert_block_after', referenceId: 'ghost', block: makeBlock('orphan') },
      { op: 'insert_block_before', referenceId: 'ghost', block: makeBlock('lead') },
    ]);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toHaveLength(2);
  });

  it('inserts at the start and appends', () => {
    expect(
      blocksOf(initialBlocks, [
        { op: 'insert_block_at_start', block: makeBlock('first') },
        { op: 'append_block', block: makeBlock('last') },
      ]).map((b) => b.id),
    ).toEqual(['first', 'a', 'b', 'c', 'last']);
  });

  it('deletes a block by id', () => {
    const result = blocksOf(initialBlocks, [{ op: 'delete_block', blockId: 'b' }]);
    expect(result.map((b) => b.id)).toEqual(['a', 'c']);
  });

  it('reports delete of a missing block as desynced', () => {
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      { op: 'delete_block', blockId: 'ghost' },
    ]);
    expect(blocks).toHaveLength(3);
    expect(desynced).toHaveLength(1);
  });

  it('reorders a block to a new index', () => {
    const result = blocksOf(initialBlocks, [
      { op: 'reorder_block', blockId: 'a', toIndex: 2 },
    ]);
    expect(result.map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });

  it('clamps an out-of-range reorder index', () => {
    const result = blocksOf(initialBlocks, [
      { op: 'reorder_block', blockId: 'c', toIndex: 99 },
    ]);
    expect(result[2].id).toBe('c');
  });

  it('treats update_meta and create_document as no-ops on blocks', () => {
    const result = blocksOf(initialBlocks, [
      { op: 'update_meta', meta: { name: 'New Title' } },
      { op: 'create_document', documentId: 'new-doc' },
    ]);
    expect(result).toEqual(initialBlocks);
  });

  it('applies mixed operations in a single batch', () => {
    const result = blocksOf(initialBlocks, [
      { op: 'replace_block', blockId: 'b', block: { html: '<p>Updated</p>' } },
      { op: 'delete_block', blockId: 'a' },
      { op: 'insert_block_after', referenceId: 'c', block: makeBlock('new') },
    ]);
    expect(result.map((b) => b.id)).toEqual(['b', 'c', 'new']);
    expect(htmlOf(result[0])).toBe('<p>Updated</p>');
  });

  it('returns unchanged blocks for an empty op list', () => {
    const { blocks, desynced, touched } = applyPatchToBlocks(initialBlocks, []);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toEqual([]);
    expect(touched).toEqual([]);
  });

  it('reports touched block ids so changes can be highlighted', () => {
    const { touched } = applyPatchToBlocks(initialBlocks, [
      { op: 'replace_block', blockId: 'b', block: { html: '<p>x</p>' } },
      { op: 'append_block', block: makeBlock('new') },
    ]);
    expect(touched).toEqual(['b', 'new']);
  });

  it('rejects a server block the canvas could not render', () => {
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      { op: 'append_block', block: { id: 'x', type: 'listItem' } },
    ]);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toHaveLength(1);
  });

  it('rejects an insert whose id already exists instead of duplicating it', () => {
    // Two blocks with one id means duplicate React keys and updates that
    // split-brain between the copies — a desync to report, not a position to
    // guess at.
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      { op: 'insert_block_after', referenceId: 'a', block: makeBlock('b') },
      { op: 'append_block', block: makeBlock('c') },
      { op: 'insert_block_at_start', block: makeBlock('a') },
    ]);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toHaveLength(3);
  });

  it('rejects a replace whose merge renames onto an existing id', () => {
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      { op: 'replace_block', blockId: 'b', block: { id: 'a' } },
    ]);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toHaveLength(1);
  });

  it('lets a later op reference a block an earlier op inserted', () => {
    // The duplicate check runs against the batch as it stands, not the
    // pre-batch document.
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      { op: 'append_block', block: makeBlock('new') },
      { op: 'replace_block', blockId: 'new', block: { html: '<p>edited</p>' } },
    ]);
    expect(desynced).toEqual([]);
    expect(blocks.map((b) => b.id)).toEqual(['a', 'b', 'c', 'new']);
  });

  it('rejects a reorder to a non-finite index instead of moving the block to the top', () => {
    // splice(NaN) coerces to 0 — the old code unshifted the block to the
    // start of the document.
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      { op: 'reorder_block', blockId: 'c', toIndex: Number.NaN },
      { op: 'reorder_block', blockId: 'c', toIndex: Number.POSITIVE_INFINITY },
    ]);
    expect(blocks.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(desynced).toHaveLength(2);
  });
});

// ── coerceBlock ──

describe('coerceBlock', () => {
  it('rejects blocks with no id or an unknown type', () => {
    expect(coerceBlock(null)).toBeNull();
    expect(coerceBlock({ type: 'paragraph' })).toBeNull();
    expect(coerceBlock({ id: '', type: 'paragraph' })).toBeNull();
    expect(coerceBlock({ id: 'a', type: 'table' })).toBeNull();
  });

  it('clamps a heading level into the supported range', () => {
    expect(coerceBlock({ id: 'h', type: 'heading', level: 7, html: 'T' })).toMatchObject({
      type: 'heading',
      level: 2,
    });
    expect(coerceBlock({ id: 'h', type: 'heading', level: 3, html: 'T' })).toMatchObject({
      level: 3,
    });
  });

  it('clamps paragraph columns to 1-6 and defaults missing fields', () => {
    expect(coerceBlock({ id: 'p', type: 'paragraph', columns: 99 })).toMatchObject({
      columns: 6,
      html: '',
      children: [],
    });
  });

  it('keeps a divider without inventing content fields', () => {
    expect(coerceBlock({ id: 'd', type: 'divider' })).toEqual({ id: 'd', type: 'divider' });
  });
});

// ── inline children arriving from outside the editor ──

const withChildren = (children: unknown[]) => ({
  id: 'p',
  type: 'paragraph',
  html:
    '<span data-child-id="c1"></span><span data-child-id="c2"></span>' +
    '<span data-child-id="c3"></span>',
  children,
});

describe('coerceChildren', () => {
  it('drops a child the canvas has no widget for', () => {
    // The registry lookup is by `type`; an unknown one used to resolve to
    // `undefined` and unmount the whole document rather than the one widget.
    const block = coerceBlock(
      withChildren([
        { id: 'c1', type: 'citation', keys: ['k'] },
        { id: 'c2', type: 'footnote' },
        { id: 'c3', type: 'equation', latex: 'x' },
      ]),
    ) as ParagraphBlock;

    expect(block.children?.map((child) => child.id)).toEqual(['c1', 'c3']);
  });

  it('drops a child with no usable id', () => {
    const block = coerceBlock(
      withChildren([{ type: 'citation', keys: ['k'] }, { id: '', type: 'citation' }, null]),
    ) as ParagraphBlock;

    expect(block.children).toEqual([]);
  });

  it('turns a provider-style integer year into the text the editor expects', () => {
    const block = coerceBlock(
      withChildren([
        {
          id: 'c1',
          type: 'citation',
          keys: ['k'],
          sources: [{ key: 'k', title: 'T', year: 2020 }],
        },
      ]),
    ) as ParagraphBlock;

    expect(block.children?.[0]).toMatchObject({
      sources: [{ key: 'k', title: 'T', year: '2020' }],
    });
  });

  it('sanitises a document loaded from storage, not just one from the wire', () => {
    // `reconcileBlocks` is the load path. A bad child already in the database
    // would otherwise crash the canvas before any tool call happens.
    const [block] = reconcileBlocks([
      withChildren([
        { id: 'c1', type: 'footnote' },
        { id: 'c2', type: 'citation', keys: ['k'], sources: [{ key: 'k', year: 1999 }] },
      ]) as unknown as Block,
    ]);

    expect((block as ParagraphBlock).children).toEqual([
      { id: 'c2', type: 'citation', keys: ['k'], sources: [{ key: 'k', year: '1999' }] },
    ]);
  });

  it('leaves a clean document identical', () => {
    const blocks = [makeBlock('a'), makeBlock('b')];
    expect(reconcileBlocks(blocks)).toBe(blocks);
  });

  it('drops blocks whose type or id the canvas cannot handle', () => {
    // Stored by an older build or hand-edited into JSON, these used to render
    // as empty rows the author could not select, edit, or delete.
    const good = makeBlock('good');
    const result = reconcileBlocks([
      good,
      { id: 'bad', type: 'image', html: 'x' } as unknown as Block,
      { id: '', type: 'paragraph', html: 'x' } as unknown as Block,
    ]);
    expect(result).toEqual([good]);
  });

  it('strips active markup from stored html on the load path', () => {
    const [block] = reconcileBlocks([
      makeBlock('p', { html: 'ok <img src=x onerror="alert(1)">' }) as unknown as Block,
    ]);
    expect((block as ParagraphBlock).html).toBe('ok ');
  });
});

// ── html ↔ children reconciliation ──

describe('withoutOrphanChildren', () => {
  it('finds placeholder ids regardless of attribute order', () => {
    expect(
      placeholderIds('<span contenteditable="false" data-child-id="c1"></span>'),
    ).toEqual(new Set(['c1']));
  });

  it('drops children whose placeholder span is gone', () => {
    const block = makeBlock('p', {
      html: 'text <span data-child-id="c1" contenteditable="false"></span>',
      children: [
        { id: 'c1', type: 'citation', keys: [] },
        { id: 'c2', type: 'citation', keys: [] },
      ],
    });
    const result = withoutOrphanChildren(block) as ParagraphBlock;
    expect(result.children?.map((c) => c.id)).toEqual(['c1']);
  });

  it('leaves a consistent block untouched by identity', () => {
    const block = makeBlock('p', {
      html: '<span data-child-id="c1" contenteditable="false"></span>',
      children: [{ id: 'c1', type: 'citation', keys: [] }],
    });
    expect(withoutOrphanChildren(block)).toBe(block);
  });

  it('ignores non-paragraph blocks', () => {
    const divider: Block = { id: 'd', type: 'divider' };
    expect(withoutOrphanChildren(divider)).toBe(divider);
  });

  it('reconciles a whole document and preserves identity when clean', () => {
    expect(reconcileBlocks(initialBlocks)).toBe(initialBlocks);

    const dirty: Block[] = [
      makeBlock('p', { html: '', children: [{ id: 'gone', type: 'citation', keys: [] }] }),
    ];
    const repaired = reconcileBlocks(dirty) as ParagraphBlock[];
    expect(repaired[0].children).toEqual([]);
  });
});

// ── save errors ──

describe('describeSaveError', () => {
  it('explains a version conflict in terms a writer can act on', () => {
    const err = Object.assign(new Error('conflict'), { status: 409 });
    expect(describeSaveError(err)).toMatch(/changed elsewhere/i);
  });

  it('distinguishes a missing document and an expired session', () => {
    expect(describeSaveError(Object.assign(new Error(''), { status: 404 }))).toMatch(
      /no longer exists/i,
    );
    expect(describeSaveError(Object.assign(new Error(''), { status: 401 }))).toMatch(
      /session expired/i,
    );
  });

  it('falls back to the underlying message', () => {
    expect(describeSaveError(new Error('network down'))).toContain('network down');
    expect(describeSaveError(null)).toBe('Changes could not be saved.');
  });
});
