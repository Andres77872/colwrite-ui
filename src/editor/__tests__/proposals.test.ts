import { itemAt, takeItems } from '@/lib/itemAt';
import { describe, it, expect } from 'vitest';
import type { Block, ToolAction, ToolOperation } from '../types';
import {
  alreadyInDocument,
  blockFingerprint,
  blockText,
  buildChangeSet,
  describeChange,
  documentChanges,
  projectDocument,
  isReady,
  isStale,
  markChanges,
  markOutdated,
  mergedBlock,
  pendingCount,
  proposedBlocks,
  rebaseAfterAccept,
  resolveAcceptPlan,
  resumeReview,
} from '../proposals';
import { append, deleteBlocks, moveBlock, paragraph, replaceText, rewrite, setMeta, writeAfter, writeBefore } from './operations';
import { reference } from '@/__tests__/agentSource';

function action(overrides: Partial<ToolAction> = {}): ToolAction & { changeSetId: string } {
  return {
    tool: 'doc_edit',
    toolCallId: 'call_1',
    actions: [],
    documentId: 'doc-1',
    version: 3,
    status: 'proposed',
    changeSetId: 'cs-1',
    ...overrides,
  } as ToolAction & { changeSetId: string };
}

const blocks: Block[] = [
  { id: 'h', type: 'heading', level: 2, html: 'Title' },
  { id: 'p', type: 'paragraph', html: 'Body text', children: [], columns: 1 },
];

/** `p` rewritten whole, as the stored form holds it. */
const rewriteP = (html: string, extra: Record<string, unknown> = {}) =>
  rewrite('p', { type: 'paragraph', html, children: [], columns: 1, ...extra });

const batch = (...ops: ToolOperation[]) => buildChangeSet(action({ actions: ops }), blocks);

describe('buildChangeSet', () => {
  it('turns each operation into one reviewable change', () => {
    const set = buildChangeSet(action({ actions: [rewriteP('New'), deleteBlocks('h')] }));

    expect(set.changes.map((c) => c.kind)).toEqual(['replace', 'delete']);
    expect(set.changes.map((c) => c.order)).toEqual([0, 1]);
    expect(set).not.toHaveProperty('version');
  });

  it('reads every operation kind', () => {
    const set = batch(
      replaceText('p', 'Body', 'Main', { type: 'paragraph', html: 'Main text', children: [] }),
      writeAfter('p', paragraph('n1'), paragraph('n2')),
      deleteBlocks('h'),
      moveBlock('p', 'before', 'h'),
      setMeta({ name: 'Renamed' }),
      { op: 'add_sources', sources: [reference('k')] },
      { op: 'remove_sources', keys: ['k'] },
    );
    expect(set.changes.map((change) => change.kind)).toEqual(['replace', 'insert', 'delete', 'move', 'meta', 'sources', 'sources']);
    expect(set.changes.map((change) => change.opIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('anchors an insert to its block and side, with every block it writes', () => {
    const set = batch(writeBefore('p', { id: 'n1', type: 'divider' }), writeAfter('p', paragraph('n2'), paragraph('n3')));

    expect(set.changes[0]).toMatchObject({ anchorBlockId: 'p', placement: 'before', producesBlockIds: ['n1'] });
    expect(set.changes[1]).toMatchObject({ anchorBlockId: 'p', placement: 'after', producesBlockIds: ['n2', 'n3'] });
  });

  it('marks an append so the canvas can place it at the end', () => {
    const set = batch(append({ id: 'b', type: 'divider' }));

    expect(set.changes[0]).toMatchObject({ anchorBlockId: null, placement: 'end' });
    const rows = projectDocument(blocks, [set]).rows;
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'insert' });
  });

  it('reads a rewrite written as several blocks: the first keeps the id, the rest are new', () => {
    const set = batch(rewriteP('First half'));
    const split = batch(rewrite('p', { type: 'paragraph', html: 'First half' }, paragraph('p2', 'Second half')));
    expect(set.changes[0]).toMatchObject({ kind: 'replace', targetBlockIds: ['p'], producesBlockIds: [] });
    expect(split.changes[0]).toMatchObject({ kind: 'replace', anchorBlockId: 'p', targetBlockIds: ['p'], producesBlockIds: ['p2'] });
  });

  it('aims a deletion of several blocks at each of them', () => {
    const set = batch(deleteBlocks('h', 'p'));
    expect(set.changes[0]).toMatchObject({ kind: 'delete', anchorBlockId: 'h', targetBlockIds: ['h', 'p'] });
    // Each target's staging fingerprint, so an edit to either is noticed.
    expect(set.changes[0]?.bases).toEqual({ h: blockFingerprint(itemAt(blocks, 0)), p: blockFingerprint(itemAt(blocks, 1)) });
  });

  it('records a dependency when one operation names another’s new block', () => {
    const set = buildChangeSet(
      action({
        actions: [
          append(paragraph('fresh', 'x'), paragraph('fresh2', 'z')),
          rewrite('fresh', { type: 'paragraph', html: 'y' }),
          moveBlock('h', 'after', 'fresh2'),
          deleteBlocks('fresh2', 'p'),
        ],
      }),
    );

    const [insert, rewritten, moved, deleted] = takeItems(set.changes, 4);
    expect(insert.dependsOn).toEqual([]);
    expect(rewritten.dependsOn).toEqual([insert.id]);
    expect(moved.dependsOn).toEqual([insert.id]);
    expect(deleted.dependsOn).toEqual([insert.id]);
  });

  it('does not invent a dependency on a block that already exists', () => {
    const set = buildChangeSet(action({ actions: [append({ id: 'fresh', type: 'divider' }), rewriteP('y')] }));

    expect(set.changes[1]?.dependsOn).toEqual([]);
  });

  it('drops operations the editor cannot review', () => {
    // `create_document` targets a different document entirely; there is
    // nothing on this page for the author to accept or reject.
    const set = buildChangeSet(action({ actions: [{ op: 'create_document', documentId: 'other' }] }));

    expect(set.changes).toHaveLength(0);
  });
});

describe('readiness', () => {
  const chained = () => buildChangeSet(
    action({ actions: [append(paragraph('fresh', 'x')), rewrite('fresh', { type: 'paragraph', html: 'y' })] }),
  );

  it('is false until the prerequisite is accepted', () => {
    const set = chained();
    expect(isReady(itemAt(set.changes, 1), [set])).toBe(false);

    const accepted = {
      ...set,
      changes: [{ ...itemAt(set.changes, 0), status: 'accepted' as const }, itemAt(set.changes, 1)],
    };
    expect(isReady(itemAt(accepted.changes, 1), [accepted])).toBe(true);
  });

  it('stays false when the prerequisite was rejected', () => {
    const set = chained();
    const rejected = {
      ...set,
      changes: [{ ...itemAt(set.changes, 0), status: 'rejected' as const }, itemAt(set.changes, 1)],
    };

    expect(isReady(itemAt(rejected.changes, 1), [rejected])).toBe(false);
  });

  it('is false for a move next to a block the author deleted, or a deletion of one', () => {
    const set = batch(moveBlock('p', 'before', 'h'), deleteBlocks('h', 'p'));
    const withoutHeading = [itemAt(blocks, 1)];
    expect(set.changes.map((change) => isReady(change, [set], blocks))).toEqual([true, true]);
    expect(isReady(itemAt(set.changes, 0), [set], withoutHeading)).toBe(false);
    expect(isReady(itemAt(set.changes, 1), [set], withoutHeading)).toBe(false);
  });
});

describe('querying', () => {
  const set = buildChangeSet(action({ actions: [rewriteP('New'), setMeta({ name: 'Renamed' }), { op: 'add_sources', sources: [reference('k')] }] }));

  it('counts only what is still pending', () => {
    expect(pendingCount([set])).toBe(3);

    const half = { ...set, changes: [{ ...itemAt(set.changes, 0), status: 'accepted' as const }, ...set.changes.slice(1)] };
    expect(pendingCount([half])).toBe(2);
  });

  it('attaches the changes about a block to that block’s row', () => {
    const rows = projectDocument(blocks, [set]).rows;
    const rowFor = (id: string) =>
      rows.find((row) => row.kind === 'block' && row.block.id === id);

    expect(rowFor('p')).toMatchObject({ changes: [expect.objectContaining({ anchorBlockId: 'p' })] });
    expect(rowFor('h')).toMatchObject({ changes: [] });
  });

  it('separates the page’s name, style and library from block changes', () => {
    expect(documentChanges([set]).map((change) => change.kind)).toEqual(['meta', 'sources']);
  });

  it('surfaces changes whose block has been deleted', () => {
    // Otherwise the review bar counts a suggestion that renders nowhere, and
    // the author cannot reach it to dismiss it.
    expect(projectDocument(blocks, [set]).orphans).toHaveLength(0);
    expect(projectDocument([itemAt(blocks, 0)], [set]).orphans).toHaveLength(1);
  });

  it('does not treat a page-level change as orphaned', () => {
    // A rename has no block to be homeless from; the header reviews it.
    expect(projectDocument([], [set]).orphans.map((c) => c.kind)).toEqual(['replace']);
  });

  it('cards a deletion of several blocks once, and strikes the others in place', () => {
    const three: Block[] = [...blocks, { id: 'q', type: 'paragraph', html: 'More', children: [] }];
    const deletion = buildChangeSet(action({ actions: [deleteBlocks('h', 'q')] }), three);
    const { rows } = projectDocument(three, [deletion]);
    expect(rows.map((row) => (row.kind === 'block' ? [row.block.id, row.changes.length, row.struck.length] : null))).toEqual([
      ['h', 1, 0], ['p', 0, 0], ['q', 0, 1],
    ]);
    // With the first gone, the card moves to the next one still on the page.
    const later = projectDocument(three.slice(1), [deletion]).rows;
    expect(later.map((row) => (row.kind === 'block' ? [row.block.id, row.changes.length, row.struck.length] : null))).toEqual([
      ['p', 0, 0], ['q', 1, 0],
    ]);
  });

  it('shows an insert addressed to a block a pending rewrite adds after that rewrite', () => {
    const set = batch(rewrite('p', { type: 'paragraph', html: 'One' }, paragraph('p2', 'Two')), writeAfter('p2', paragraph('n', 'Three')));
    const { rows, orphans } = projectDocument(blocks, [set]);
    expect(orphans).toEqual([]);
    expect(rows.map((row) => (row.kind === 'block' ? row.block.id : `+${row.change.producesBlockIds.join(',')}`))).toEqual(['h', 'p', '+n']);
  });
});

describe('rendering helpers', () => {
  it('applies a rewrite as the stored block, as accepting it would', () => {
    const set = batch(rewriteP('Rewritten'));
    expect(mergedBlock(itemAt(set.changes, 0), blocks[1])).toMatchObject({ id: 'p', type: 'paragraph', html: 'Rewritten', columns: 1 });
    const text = batch(replaceText('p', 'Body', 'Main', { type: 'paragraph', html: 'Main text', children: [] }));
    expect(mergedBlock(itemAt(text.changes, 0), blocks[1])).toMatchObject({ id: 'p', html: 'Main text' });
  });

  it('lists the blocks an insert adds, and those a rewrite adds after its own', () => {
    expect(proposedBlocks(itemAt(batch(writeAfter('p', paragraph('a'), paragraph('b'))).changes, 0)).map((block) => block.id)).toEqual(['a', 'b']);
    expect(proposedBlocks(itemAt(batch(rewrite('p', { type: 'paragraph' }, paragraph('b'))).changes, 0)).map((block) => block.id)).toEqual(['b']);
  });

  it('rejects a proposed block the canvas could not render', () => {
    const set = batch(append({ id: 'x', type: 'listicle' }));

    expect(proposedBlocks(itemAt(set.changes, 0))).toEqual([]);
  });

  it('reads inline widgets as what they are rather than dropping them silently', () => {
    const text = blockText({
      id: 'p',
      type: 'paragraph',
      html: 'See <span data-child-id="c1" contenteditable="false"></span> and '
        + '<span data-child-id="e1" contenteditable="false"></span> in '
        + '<span data-child-id="gone" contenteditable="false"></span>',
      children: [
        { id: 'c1', type: 'citation', keys: ['k'] },
        { id: 'e1', type: 'equation', latex: 'x_t' },
      ],
    });

    expect(text).toBe('See [ref] and x_t in …');
  });

  it('decodes entities and line breaks', () => {
    const text = blockText({
      id: 'p',
      type: 'paragraph',
      html: 'a &amp; b<br>c',
      children: [],
    });

    expect(text).toBe('a & b\nc');
  });

  it('describes each change in words a writer would use', () => {
    const set = batch(
      rewrite('h', { type: 'heading', level: 2, html: 'New' }),
      deleteBlocks('p'),
      append({ id: 'n', type: 'heading', level: 3, html: 'x' }),
      setMeta({ name: 'X' }),
      replaceText('p', 'Body', 'Main', { type: 'paragraph', html: 'Main text', children: [] }),
      writeAfter('p', paragraph('a', 'One'), paragraph('b', 'Two')),
      rewrite('p', { type: 'paragraph', html: 'One' }, paragraph('p2', 'Two')),
      deleteBlocks('h', 'p'),
      moveBlock('p', 'before', 'h'),
      setMeta({ citationStyle: 'ieee' }),
      setMeta({ name: 'Y', citationStyle: 'ieee' }),
      { op: 'add_sources', sources: [reference('k'), reference('l')] },
      { op: 'remove_sources', keys: ['k'] },
    );

    // The text is quoted so two same-kind changes in a long batch read as
    // two different changes, not as a duplicate row.
    expect(set.changes.map((c) => describeChange(c, blocks))).toEqual([
      'Rewrite heading “Title”',
      'Delete paragraph “Body text”',
      'Add heading “x”',
      'Rename page',
      'Rewrite paragraph “Body text”',
      'Add 2 blocks “One”',
      'Rewrite paragraph “Body text” as 2 blocks',
      'Delete 2 blocks “Title”',
      'Move paragraph “Body text”',
      'Change citation style',
      'Rename page and change citation style',
      'Add 2 sources to the page’s sources',
      'Remove a source from the page’s sources',
    ]);
  });
});

describe('a suggestion whose block changed or went away', () => {
  const rewriting = () => batch(rewriteP('Assistant text'));
  const edited: Block[] = [itemAt(blocks, 0), { ...blocks[1], html: 'Body text, edited by the author' } as Block];

  it('records what the block said when the suggestion was staged', () => {
    const set = rewriting();
    expect(set.changes[0]?.bases).toEqual({ p: blockFingerprint(itemAt(blocks, 1)) });
    expect(set.changes[0]?.opIndex).toBe(0);
    expect(isStale(itemAt(set.changes, 0), blocks)).toBe(false);
  });

  it('is stale once the author edits the block, and can no longer be accepted', () => {
    const set = rewriting();
    expect(isStale(itemAt(set.changes, 0), edited)).toBe(true);
    expect(isReady(itemAt(set.changes, 0), [set], edited)).toBe(false);
    expect(isReady(itemAt(set.changes, 0), [set], blocks)).toBe(true);
  });

  it('treats a deletion of an edited block the same way, any of its blocks', () => {
    expect(isStale(itemAt(batch(deleteBlocks('p')).changes, 0), edited)).toBe(true);
    expect(isStale(itemAt(batch(deleteBlocks('h', 'p')).changes, 0), edited)).toBe(true);
    expect(isStale(itemAt(batch(deleteBlocks('h', 'p')).changes, 0), blocks)).toBe(false);
  });

  it('does not count collapsing or locking the block as an edit', () => {
    const set = rewriting();
    const folded: Block[] = [itemAt(blocks, 0), { ...blocks[1], collapsed: true, locked: true } as Block];
    expect(isStale(itemAt(set.changes, 0), folded)).toBe(false);
  });

  it('never marks an insert, a move or a page change stale', () => {
    const set = batch(writeAfter('p', { id: 'n', type: 'divider' }), moveBlock('p', 'before', 'h'), setMeta({ name: 'Z' }));
    expect(set.changes.map((change) => isStale(change, edited))).toEqual([false, false, false]);
  });

  it('does not offer Accept for a rewrite of a block that was deleted', () => {
    const set = rewriting();
    // Accept used to be shown here, and the only thing it could do was fail.
    expect(isReady(itemAt(set.changes, 0), [set], [itemAt(blocks, 0)])).toBe(false);
  });

  it('carries the baseline over the author accepting an earlier rewrite of the same block', () => {
    const set = batch(rewriteP('First pass'), rewriteP('Second pass'));
    const after: Block[] = [itemAt(blocks, 0), { ...blocks[1], html: 'First pass' } as Block];
    const accepted = markChanges([set], new Set([itemAt(set.changes, 0).id]), 'accepted');

    // Without the rebase, accepting the first made the second look stale.
    expect(isStale(itemAt(itemAt(accepted, 0).changes, 1), after)).toBe(true);
    const rebased = rebaseAfterAccept(accepted, blocks, after, ['p']);
    expect(isStale(itemAt(itemAt(rebased, 0).changes, 1), after)).toBe(false);
  });

  it('applies successive rewrites of the same block in one bulk plan', () => {
    const first = batch(rewriteP('First pass'));
    const second = buildChangeSet(action({
      changeSetId: 'cs-2',
      actions: [rewriteP('Second pass'), deleteBlocks('p')],
    }), blocks);
    const plan = resolveAcceptPlan([...first.changes, ...second.changes], [first, second], { blocks });

    expect(plan.desynced).toEqual([]);
    expect(plan.ops).toEqual([rewriteP('First pass'), rewriteP('Second pass'), deleteBlocks('p')]);
  });

  it('keeps a suggestion stale when an accept lands on a block the author had already edited', () => {
    const set = batch(rewriteP('Body text, edited by the author', { columns: 2 }), rewriteP('Second pass'));
    const after: Block[] = [itemAt(blocks, 0), { ...(edited[1] as Block), columns: 2 } as Block];
    const accepted = markChanges([set], new Set([itemAt(set.changes, 0).id]), 'accepted');
    const rebased = rebaseAfterAccept(accepted, edited, after, ['p']);
    expect(isStale(itemAt(itemAt(rebased, 0).changes, 1), after)).toBe(true);
  });
});

describe('a target the server says changed since the proposal', () => {
  const target = (fingerprint: string, headFingerprint: string | null, blockId = 'p') => ({
    blockId,
    fingerprint,
    headFingerprint,
  });

  it('is stale although the block has not been touched since it was staged', () => {
    // Staged after a reload: the live block is the author's newer text, so
    // the staging fingerprint alone sees nothing wrong.
    const set = batch(rewriteP('Assistant text'));
    expect(isStale(itemAt(set.changes, 0), blocks)).toBe(false);

    const marked = markOutdated(set, [[target('as-proposed', 'edited-since')]]);

    expect(marked.changes[0]?.outdated).toBe(true);
    expect(isStale(itemAt(marked.changes, 0), blocks)).toBe(true);
    expect(isReady(itemAt(marked.changes, 0), [marked], blocks)).toBe(false);
  });

  it('is current when the saved block is the one the operation found', () => {
    const set = batch(rewriteP('Assistant text'), deleteBlocks('h'));
    const marked = markOutdated(set, [[target('same', 'same')], [target('h-1', 'h-1', 'h')]]);

    // Nothing to mark: the batch is handed back as it was.
    expect(marked).toBe(set);
    expect(marked.changes.map((change) => isStale(change, blocks))).toEqual([false, false]);
  });

  it('marks a deletion of several blocks when any one of them changed', () => {
    const set = batch(deleteBlocks('h', 'p'));
    expect(markOutdated(set, [[target('h-1', 'h-1', 'h'), target('p-1', 'p-1')]])).toBe(set);
    expect(markOutdated(set, [[target('h-1', 'h-1', 'h'), target('p-1', 'p-2')]]).changes[0]?.outdated).toBe(true);
  });

  it('still notices an edit made after staging on a block the server called current', () => {
    const marked = markOutdated(batch(rewriteP('Assistant text')), [[target('same', 'same')]]);
    const edited: Block[] = [itemAt(blocks, 0), { ...blocks[1], html: 'Typed just now' } as Block];
    expect(isStale(itemAt(marked.changes, 0), edited)).toBe(true);
  });

  it('is stale when the block is gone from the saved document but still on screen', () => {
    const marked = markOutdated(batch(rewriteP('Assistant text')), [[target('as-proposed', null)]]);
    expect(isStale(itemAt(marked.changes, 0), blocks)).toBe(true);
  });

  it('reads a later rewrite of the same block as current while the earlier one is undecided', () => {
    // The second operation was written for the block as the first leaves it.
    // The saved block is still at the first one's stage, which is not an edit.
    const set = batch(rewriteP('First pass'), rewriteP('Second pass'));
    const marked = markOutdated(set, [[target('stage-0', 'stage-0')], [target('stage-1', 'stage-0')]]);
    expect(marked.changes.map((change) => change.outdated ?? false)).toEqual([false, false]);
  });

  it('reads it as current once the earlier rewrite is accepted and saved', () => {
    const set = batch(rewriteP('First pass'), rewriteP('Second pass'));
    const marked = markOutdated(set, [[target('stage-0', 'stage-1')], [target('stage-1', 'stage-1')]]);
    // The first is decided by then; what matters is the one still open.
    expect(itemAt(marked.changes, 1).outdated ?? false).toBe(false);
  });

  it('is stale when the block was edited by hand after the earlier rewrite was accepted', () => {
    const set = batch(rewriteP('First pass'), rewriteP('Second pass'));
    const marked = markOutdated(set, [[target('stage-0', 'by-hand')], [target('stage-1', 'by-hand')]]);
    expect(marked.changes[1]?.outdated).toBe(true);
  });

  it('counts the stages recorded by the batches it was written on top of', () => {
    const set = batch(rewriteP('Second batch'));
    const targets = [[target('after-first-batch', 'before-first-batch')]];

    expect(markOutdated(set, targets).changes[0]?.outdated).toBe(true);
    const earlier = new Map([['p', new Set(['before-first-batch'])]]);
    expect(itemAt(markOutdated(set, targets, earlier).changes, 0).outdated ?? false).toBe(false);
    // A stage of another block says nothing about this one.
    const unrelated = new Map([['h', new Set(['before-first-batch'])]]);
    expect(markOutdated(set, targets, unrelated).changes[0]?.outdated).toBe(true);
  });

  it('does not take a later operation on the block for an earlier stage', () => {
    const set = batch(rewriteP('First pass'), rewriteP('Second pass'));
    // The saved block equals what the *second* operation found, which the
    // first was not written for.
    const marked = markOutdated(set, [[target('stage-0', 'stage-1')], [target('stage-1', 'stage-1')]]);
    expect(marked.changes[0]?.outdated).toBe(true);
  });

  it('leaves inserts, moves and operations without a target alone', () => {
    const set = batch(writeAfter('p', { id: 'n', type: 'divider' }), rewriteP('Assistant text'), deleteBlocks('h'));
    const marked = markOutdated(set, [
      // A target on an insert, or for another block, is not this change's.
      [target('x', 'y')],
      [],
      [target('x', 'y')],
    ]);
    expect(marked).toBe(set);
  });

  it('follows the stored operation index after a rejection renumbers the batch', () => {
    const set = batch(writeAfter('p', { id: 'n', type: 'divider' }), rewriteP('Assistant text'));
    const marked = markOutdated(set, [[], [target('as-proposed', 'edited-since')]]);
    expect(marked.changes.find((change) => change.kind === 'replace')?.outdated).toBe(true);
  });

  it('stays stale when an accept lands on the same block', () => {
    const set = markOutdated(
      batch(rewriteP('Body text', { columns: 2 }), rewriteP('Second pass')),
      [[target('stage-0', 'stage-0')], [target('stage-1', 'by-hand')]],
    );
    const after: Block[] = [itemAt(blocks, 0), { ...blocks[1], columns: 2 } as Block];
    const accepted = markChanges([set], new Set([itemAt(set.changes, 0).id]), 'accepted');

    const rebased = rebaseAfterAccept(accepted, blocks, after, ['p']);

    // The server said this one was written for other text. Accepting its
    // sibling does not change that.
    expect(isStale(itemAt(itemAt(rebased, 0).changes, 1), after)).toBe(true);
  });
});

describe('resuming a half-reviewed durable batch', () => {
  const durable = () =>
    buildChangeSet(
      action({
        changeSetId: 'cs-1',
        actions: [
          rewriteP('Rewritten'),
          writeAfter('p', paragraph('n1', 'one')),
          writeAfter('n1', paragraph('n2', 'two')),
          append(paragraph('n3', 'three')),
        ],
      }),
      blocks,
    );

  it('replays the decisions already made instead of offering them again', () => {
    const { set, landed } = resumeReview(durable(), { decisions: [[0, 'rejected'], [1, 'rejected']] }, blocks);

    expect(set.changes.map((change) => change.status)).toEqual([
      'rejected',
      'rejected',
      'pending',
      'pending',
    ]);
    expect(landed).toEqual([]);
    // The second paragraph was moved onto the rejected first one, exactly as
    // it was when the author rejected it.
    const second = set.changes.find((change) => change.opIndex === 2)!;
    expect(second).toMatchObject({ anchorBlockId: 'p', placement: 'after', dependsOn: [] });
    expect(second.op).toMatchObject({ op: 'write_blocks', position: 'after', blockId: 'p' });
  });

  it('does not offer an insert again when its blocks are already in the document', () => {
    const withLanded: Block[] = [
      ...blocks,
      { id: 'n1', type: 'paragraph', html: 'one', children: [], columns: 1 },
    ];
    const { set, landed } = resumeReview(durable(), null, withLanded);

    expect(landed).toEqual([1]);
    const byIndex = (opIndex: number) => set.changes.find((change) => change.opIndex === opIndex)!;
    expect(byIndex(1).status).toBe('accepted');
    // Its continuation is now ready, instead of waiting on a duplicate.
    expect(isReady(byIndex(2), [set], withLanded)).toBe(true);
    expect(byIndex(0).status).toBe('pending');
  });

  it('recognises a rewrite, a deletion and a move that are already in the document', () => {
    const rewritten: Block[] = [itemAt(blocks, 0), { ...blocks[1], html: 'Rewritten' } as Block];
    const set = durable();
    expect(alreadyInDocument(itemAt(set.changes, 0), rewritten)).toBe(true);
    expect(alreadyInDocument(itemAt(set.changes, 0), blocks)).toBe(false);
    const others = batch(deleteBlocks('h'), moveBlock('p', 'before', 'h'));
    expect(alreadyInDocument(itemAt(others.changes, 0), [itemAt(blocks, 1)])).toBe(true);
    expect(alreadyInDocument(itemAt(others.changes, 1), [itemAt(blocks, 1), itemAt(blocks, 0)])).toBe(true);
    expect(alreadyInDocument(itemAt(others.changes, 1), blocks)).toBe(false);
  });
});
