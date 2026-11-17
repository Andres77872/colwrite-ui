import { takeItems } from '@/lib/itemAt';
import { describe, it, expect } from 'vitest';
import { ApiError } from '@/api/errors';
import type { Block, Doc, ParagraphBlock, ToolOperation } from '../types';
import { append, deleteBlocks, moveBlock, replaceText, rewrite, setMeta, writeAfter, writeBefore } from './operations';
import {
  applyOperations,
  applyPatchToBlocks,
  coerceBlock,
  describeSaveError,
  placeholderIds,
  reconcileBlocks,
  withoutOrphanChildren,
  isSaveConflict,
  sameContent,
} from '../docOps';
import { reference } from '@/__tests__/agentSource';

// ── Fixtures ──

// Typed as ParagraphBlock rather than Block: spreading a `Partial<Block>` over
// a paragraph literal widens `type` back to the full union and breaks the
// discriminant.
const makeBlock = (id: string, overrides: Partial<ParagraphBlock> = {}): ParagraphBlock => ({
  id,
  type: 'paragraph',
  html: id,
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
  it('replaces a block with the stored block, keeping its id', () => {
    const result = blocksOf(initialBlocks, [rewrite('b', { type: 'paragraph', html: 'Updated B' })]);
    expect(result).toHaveLength(3);
    expect(result[1]).toMatchObject({ id: 'b', type: 'paragraph', html: 'Updated B' });
  });

  it('puts several blocks in the place of one: the first keeps its id', () => {
    const result = blocksOf(initialBlocks, [
      rewrite('b', { type: 'paragraph', html: 'B, first half' }, makeBlock('b2', { html: 'B, second half' })),
    ]);
    expect(result.map((block) => [block.id, htmlOf(block)])).toEqual([
      ['a', 'a'], ['b', 'B, first half'], ['b2', 'B, second half'], ['c', 'c'],
    ]);
  });

  it('applies a replace_text as its stored block', () => {
    const result = blocksOf(initialBlocks, [replaceText('b', 'b', 'bee', { type: 'paragraph', html: 'bee' })]);
    expect(htmlOf(result[1])).toBe('bee');
  });

  it('keeps how the author shows the block over the stored flags', () => {
    // The stored block carries the defaults as they were when it was proposed.
    const folded: Block[] = [makeBlock('a'), makeBlock('b', { collapsed: true, locked: true }), makeBlock('c')];
    const [, rewritten] = takeItems(blocksOf(folded, [
      rewrite('b', { type: 'paragraph', html: 'new', collapsed: false, locked: false, aiHidden: false }),
    ]), 2);
    expect(rewritten).toMatchObject({ html: 'new', collapsed: true, locked: true });
    expect(rewritten.aiHidden).toBeUndefined();
    // Folding does not survive a change of type, as on the server.
    const [, heading] = takeItems(blocksOf(folded, [rewrite('b', { type: 'heading', level: 2, html: 'B' })]), 2);
    expect(heading).toMatchObject({ type: 'heading', locked: true });
    expect(heading.collapsed).toBeUndefined();
  });

  it('validates the written block before it reaches the canvas', () => {
    const result = blocksOf(initialBlocks, [
      rewrite('b', {
        type: 'paragraph',
        html: '<span data-child-id="c1"></span><span data-child-id="c2"></span>',
        children: [
          { id: 'c1', type: 'footnote' },
          { id: 'c2', type: 'citation', keys: ['k'], sources: [reference('k')] },
        ],
      }),
    ]);

    expect((result[1] as ParagraphBlock).children).toEqual([
      { id: 'c2', type: 'citation', keys: ['k'], sources: [reference('k')] },
    ]);
  });

  it('reports a rewrite into a block the canvas cannot draw as desynced', () => {
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [rewrite('b', { type: 'sidebar' })]);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toHaveLength(1);
  });

  it('reports a rewrite of a missing block as desynced', () => {
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      rewrite('nonexistent', { type: 'paragraph', html: 'X' }),
      replaceText('nonexistent', 'X', 'Y', { type: 'paragraph', html: 'Y' }),
    ]);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toHaveLength(2);
  });

  it('writes blocks after and before a block, in their order', () => {
    expect(blocksOf(initialBlocks, [writeAfter('a', makeBlock('n1'), makeBlock('n2'))]).map((b) => b.id))
      .toEqual(['a', 'n1', 'n2', 'b', 'c']);
    expect(blocksOf(initialBlocks, [writeBefore('b', makeBlock('n1'), makeBlock('n2'))]).map((b) => b.id))
      .toEqual(['a', 'n1', 'n2', 'b', 'c']);
  });

  it('does NOT guess a position when the anchor block is missing', () => {
    // Landing the block at the far end of the document instead reads as
    // corruption — the agent asked for a specific position that this copy of
    // the document cannot express.
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      writeAfter('ghost', makeBlock('orphan')),
      writeBefore('ghost', makeBlock('lead')),
    ]);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toHaveLength(2);
  });

  it('writes before the first block and appends', () => {
    expect(
      blocksOf(initialBlocks, [writeBefore('a', makeBlock('first')), append(makeBlock('last'))]).map((b) => b.id),
    ).toEqual(['first', 'a', 'b', 'c', 'last']);
    expect(blocksOf([], [append(makeBlock('only'))]).map((b) => b.id)).toEqual(['only']);
  });

  it('deletes blocks by id, all or none', () => {
    expect(blocksOf(initialBlocks, [deleteBlocks('a', 'c')]).map((b) => b.id)).toEqual(['b']);
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [deleteBlocks('b', 'ghost')]);
    expect(blocks).toHaveLength(3);
    expect(desynced).toHaveLength(1);
  });

  it('moves a block before or after another', () => {
    expect(blocksOf(initialBlocks, [moveBlock('a', 'after', 'c')]).map((b) => b.id)).toEqual(['b', 'c', 'a']);
    expect(blocksOf(initialBlocks, [moveBlock('c', 'before', 'a')]).map((b) => b.id)).toEqual(['c', 'a', 'b']);
  });

  it('reports a move next to a missing block, or itself, as desynced', () => {
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      moveBlock('a', 'after', 'ghost'),
      moveBlock('ghost', 'after', 'a'),
      moveBlock('a', 'before', 'a'),
    ]);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toHaveLength(3);
  });

  it('leaves the page-level operations to applyOperations', () => {
    const result = blocksOf(initialBlocks, [
      setMeta({ name: 'New Title' }),
      { op: 'add_sources', sources: [reference('k')] },
      { op: 'remove_sources', keys: ['k'] },
      { op: 'create_document', documentId: 'new-doc' },
    ]);
    expect(result).toEqual(initialBlocks);
  });

  it('applies mixed operations in a single batch', () => {
    const result = blocksOf(initialBlocks, [
      rewrite('b', { type: 'paragraph', html: 'Updated' }),
      deleteBlocks('a'),
      writeAfter('c', makeBlock('new')),
    ]);
    expect(result.map((b) => b.id)).toEqual(['b', 'c', 'new']);
    expect(htmlOf(result[0])).toBe('Updated');
  });

  it('returns unchanged blocks for an empty op list', () => {
    const { blocks, desynced, touched } = applyPatchToBlocks(initialBlocks, []);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toEqual([]);
    expect(touched).toEqual([]);
  });

  it('reports touched block ids so changes can be highlighted', () => {
    const { touched } = applyPatchToBlocks(initialBlocks, [
      rewrite('b', { type: 'paragraph', html: 'x' }),
      append(makeBlock('new')),
      moveBlock('a', 'after', 'c'),
    ]);
    expect(touched).toEqual(['b', 'new', 'a']);
  });

  it('rejects a server block the canvas could not render', () => {
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [append(makeBlock('ok'), { id: 'x', type: 'listItem' })]);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toHaveLength(1);
  });

  it('rejects a write whose id already exists instead of duplicating it', () => {
    // Two blocks with one id means duplicate React keys and updates that
    // split-brain between the copies — a desync to report, not a position to
    // guess at.
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      writeAfter('a', makeBlock('b')),
      append(makeBlock('c')),
      writeBefore('a', makeBlock('a')),
      rewrite('b', { type: 'paragraph' }, makeBlock('a')),
    ]);
    expect(blocks).toEqual(initialBlocks);
    expect(desynced).toHaveLength(4);
  });

  it('lets a later op reference a block an earlier op wrote', () => {
    // The duplicate check runs against the batch as it stands, not the
    // pre-batch document.
    const { blocks, desynced } = applyPatchToBlocks(initialBlocks, [
      append(makeBlock('new')),
      rewrite('new', { type: 'paragraph', html: 'edited' }),
      moveBlock('new', 'before', 'a'),
    ]);
    expect(desynced).toEqual([]);
    expect(blocks.map((b) => [b.id, htmlOf(b)])).toEqual([
      ['new', 'edited'], ['a', 'a'], ['b', 'b'], ['c', 'c'],
    ]);
  });
});

describe('applyOperations', () => {
  const cited = makeBlock('p', {
    html: 'x <span data-child-id="c1" contenteditable="false"></span>',
    children: [{ id: 'c1', type: 'citation', keys: ['cited'], sources: [reference('cited')] }],
  });
  const page: Doc = { blocks: [cited], name: 'Page', sources: [reference('cited', { title: 'Cited' }), reference('spare', { title: 'Spare' })] };

  it('sets the name and the citation style', () => {
    const { doc, desynced } = applyOperations(page, [setMeta({ name: 'Renamed' }), setMeta({ citationStyle: 'apa' })]);
    expect(desynced).toEqual([]);
    expect(doc).toMatchObject({ name: 'Renamed', citationStyle: 'apa' });
  });

  it('adds sources to the library, and refuses one already in it', () => {
    const added = applyOperations(page, [{ op: 'add_sources', sources: [reference('new', { title: 'New' })] }]);
    expect(added.doc.sources?.map((source) => source.key)).toEqual(['cited', 'spare', 'new']);
    const again = applyOperations(page, [{ op: 'add_sources', sources: [reference('spare')] }]);
    expect(again.desynced).toHaveLength(1);
    expect(again.doc.sources).toEqual(page.sources);
  });

  it('removes uncited sources, and refuses one cited on the page or not in the library', () => {
    expect(applyOperations(page, [{ op: 'remove_sources', keys: ['spare'] }]).doc.sources?.map((source) => source.key)).toEqual(['cited']);
    for (const key of ['cited', 'absent']) {
      const refused = applyOperations(page, [{ op: 'remove_sources', keys: [key] }]);
      expect(refused.desynced).toHaveLength(1);
      expect(refused.doc.sources).toEqual(page.sources);
    }
    // The last one gone leaves no library at all.
    expect('sources' in applyOperations({ ...page, sources: [reference('spare')] }, [{ op: 'remove_sources', keys: ['spare'] }]).doc).toBe(false);
  });

  it('replaces library records by key, and refuses a key the library does not hold or one given twice', () => {
    const fresher = reference('spare', { title: 'Spare, corrected', state: 'verified', flags: ['corrected'] });
    const refreshed = applyOperations(page, [{ op: 'update_sources', sources: [fresher] }]);
    expect(refreshed.desynced).toEqual([]);
    expect(refreshed.doc.sources).toEqual([page.sources?.[0], fresher]);
    for (const sources of [[reference('absent')], [fresher, fresher]]) {
      const refused = applyOperations(page, [{ op: 'update_sources', sources }]);
      expect(refused.desynced).toHaveLength(1);
      expect(refused.doc.sources).toEqual(page.sources);
    }
  });

  it('applies the blocks and the page together', () => {
    const { doc, touched } = applyOperations(page, [append(makeBlock('n')), setMeta({ name: 'Both' })]);
    expect(doc.blocks.map((block) => block.id)).toEqual(['p', 'n']);
    expect(doc.name).toBe('Both');
    expect(touched).toEqual(['n']);
  });

  it('only allows removing a source after an earlier operation removed its citation', () => {
    const remove: ToolOperation = { op: 'remove_sources', keys: ['cited'] };
    const rewriteCitation = rewrite('p', makeBlock('p'));
    const refused = applyOperations(page, [remove, rewriteCitation]);
    expect(refused.desynced).toEqual([remove]);
    expect(refused.doc.sources).toEqual(page.sources);
    const applied = applyOperations(page, [rewriteCitation, remove]);
    expect(applied.desynced).toEqual([]);
    expect(applied.doc.sources?.map((source) => source.key)).toEqual(['spare']);
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

  it('sanitises a document loaded from storage, not just one from the wire', () => {
    // `reconcileBlocks` is the load path. A bad child already in the database
    // would otherwise crash the canvas before any tool call happens.
    const [block] = reconcileBlocks([
      withChildren([
        { id: 'c1', type: 'footnote' },
        { id: 'c2', type: 'citation', keys: ['k'], sources: [reference('k')] },
      ]) as unknown as Block,
    ]);

    expect((block as ParagraphBlock).children).toEqual([
      { id: 'c2', type: 'citation', keys: ['k'], sources: [reference('k')] },
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

  it('reads an id the html escapes as the id itself', () => {
    // `children` names the widget `cite&one`; the html holds it escaped.
    expect(placeholderIds('<span data-child-id="cite&amp;one" contenteditable="false"></span><span data-child-id="q&quot;&#60;&#x3e;"></span>'))
      .toEqual(new Set(['cite&one', 'q"<>']));
    const block = makeBlock('p', {
      html: '<span data-child-id="cite&amp;one" contenteditable="false"></span>',
      children: [{ id: 'cite&one', type: 'citation', keys: ['k'] }],
    });
    expect(withoutOrphanChildren(block)).toBe(block);
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
    expect(repaired[0]?.children).toEqual([]);
  });
});

// ── save errors ──

describe('describeSaveError', () => {
  const problem = (code: string, status: number, detail: string) =>
    new ApiError(detail, status, { code, status, detail, retryable: false });

  it('explains a stale head in terms a writer can act on', () => {
    expect(describeSaveError(problem('stale_head', 412, 'The document changed since it was read'))).toMatch(/changed somewhere else/i);
  });

  it('does not call an unsupported schema a conflict the author could settle', () => {
    const schema = problem('schema_unsupported', 409, 'Document schema is not supported');
    expect(isSaveConflict(schema)).toBe(false);
    expect(describeSaveError(schema)).toMatch(/newer version of ColWrite/i);

    const conflict = problem('stale_head', 412, 'The document changed since it was read');
    expect(isSaveConflict(conflict)).toBe(true);
    expect(isSaveConflict(new Error('network down'))).toBe(false);
    // The code decides, not the status.
    expect(isSaveConflict(Object.assign(new Error('Precondition failed'), { status: 412 }))).toBe(false);
  });

  it('compares documents by content', () => {
    const blocks = [{ id: 'a', type: 'paragraph' as const, html: 'x', children: [] }];
    expect(sameContent({ blocks, name: 'A' }, { blocks: structuredClone(blocks), name: 'A' })).toBe(true);
    expect(sameContent({ blocks, name: 'A' }, { blocks, name: 'B' })).toBe(false);
    expect(sameContent({ blocks }, { blocks, sources: [] })).toBe(true);
  });

  it('reads a block the same whether or not its defaults are written out', () => {
    const written = { version: 1, blocks: [{ id: 'a', type: 'paragraph' as const, html: 'x', children: [], columns: 1, checked: false }] };
    const stored = { version: 2, blocks: [{ type: 'paragraph' as const, html: 'x', id: 'a' }] } as unknown as typeof written;
    expect(sameContent(written, stored)).toBe(true);
    const [storedBlock] = takeItems(stored.blocks, 1);
    expect(sameContent(written, { ...stored, blocks: [{ ...storedBlock, html: 'y' }] })).toBe(false);
    expect(sameContent(written, { ...stored, blocks: [{ ...storedBlock, columns: 2 }] })).toBe(false);
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

describe('loading a paragraph with block markup in it', () => {
  it('holds the html the API stores for it', () => {
    // The API's sanitizer output for the same html (`sanitize_inline_html`).
    const [loaded] = reconcileBlocks([makeBlock('p', { html: 'Intro <h2 id="r">Results</h2> <p>a<div>b</div>c</p>' })]);
    expect(htmlOf(loaded)).toBe(
      'Intro <span class="legacy-block">Results</span> <span class="legacy-block">a<span class="legacy-block">b</span>c</span>',
    );
    // And keeps it as it is from then on.
    const clean = makeBlock('p', { html: htmlOf(loaded) });
    expect(reconcileBlocks([clean])[0]).toBe(clean);
  });
});
