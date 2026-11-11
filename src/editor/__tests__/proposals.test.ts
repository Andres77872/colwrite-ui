import { describe, it, expect } from 'vitest';
import type { Block, ToolAction } from '../types';
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
  proposedBlock,
  rebaseAfterAccept,
  resumeReview,
} from '../proposals';

function action(overrides: Partial<ToolAction> = {}): ToolAction {
  return {
    tool: 'doc_edit',
    toolCallId: 'call_1',
    actions: [],
    documentId: 'doc-1',
    version: 3,
    status: 'proposed',
    ...overrides,
  };
}

const blocks: Block[] = [
  { id: 'h', type: 'heading', level: 2, html: 'Title' },
  { id: 'p', type: 'paragraph', html: 'Body text', children: [], columns: 1 },
];

describe('buildChangeSet', () => {
  it('turns each operation into one reviewable change', () => {
    const set = buildChangeSet(
      action({
        actions: [
          { op: 'replace_block', blockId: 'p', block: { html: 'New' } },
          { op: 'delete_block', blockId: 'h' },
        ],
      }),
    );

    expect(set.changes.map((c) => c.kind)).toEqual(['replace', 'delete']);
    expect(set.changes.map((c) => c.order)).toEqual([0, 1]);
    expect(set.version).toBe(3);
  });

  it('anchors an insert to its reference block and side', () => {
    const set = buildChangeSet(
      action({
        actions: [
          { op: 'insert_block_before', referenceId: 'p', block: { id: 'n1', type: 'divider' } },
          { op: 'insert_block_after', referenceId: 'p', block: { id: 'n2', type: 'divider' } },
        ],
      }),
    );

    expect(set.changes[0]).toMatchObject({ anchorBlockId: 'p', placement: 'before' });
    expect(set.changes[1]).toMatchObject({ anchorBlockId: 'p', placement: 'after' });
  });

  it('marks document-edge inserts so the canvas can place them', () => {
    const set = buildChangeSet(
      action({
        actions: [
          { op: 'insert_block_at_start', block: { id: 'a', type: 'divider' } },
          { op: 'append_block', block: { id: 'b', type: 'divider' } },
        ],
      }),
    );

    expect(set.changes.map((change) => change.placement)).toEqual(['start', 'end']);
    // One lands above the document, the other below it.
    const rows = projectDocument(blocks, [set]).rows;
    expect(rows[0]).toMatchObject({ kind: 'insert' });
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'insert' });
  });

  it('records a dependency when one operation targets another’s new block', () => {
    const set = buildChangeSet(
      action({
        actions: [
          { op: 'append_block', block: { id: 'fresh', type: 'paragraph', html: 'x' } },
          { op: 'replace_block', blockId: 'fresh', block: { html: 'y' } },
        ],
      }),
    );

    const [insert, rewrite] = set.changes;
    expect(insert.dependsOn).toEqual([]);
    expect(rewrite.dependsOn).toEqual([insert.id]);
  });

  it('does not invent a dependency on a block that already exists', () => {
    const set = buildChangeSet(
      action({
        actions: [
          { op: 'append_block', block: { id: 'fresh', type: 'divider' } },
          { op: 'replace_block', blockId: 'p', block: { html: 'y' } },
        ],
      }),
    );

    expect(set.changes[1].dependsOn).toEqual([]);
  });

  it('drops operations the editor cannot review', () => {
    // `create_document` targets a different document entirely; there is
    // nothing on this page for the author to accept or reject.
    const set = buildChangeSet(
      action({ actions: [{ op: 'create_document', documentId: 'other' }] }),
    );

    expect(set.changes).toHaveLength(0);
  });
});

describe('readiness', () => {
  it('is false until the prerequisite is accepted', () => {
    const set = buildChangeSet(
      action({
        actions: [
          { op: 'append_block', block: { id: 'fresh', type: 'paragraph', html: 'x' } },
          { op: 'replace_block', blockId: 'fresh', block: { html: 'y' } },
        ],
      }),
    );

    expect(isReady(set.changes[1], [set])).toBe(false);

    const accepted = {
      ...set,
      changes: [{ ...set.changes[0], status: 'accepted' as const }, set.changes[1]],
    };
    expect(isReady(accepted.changes[1], [accepted])).toBe(true);
  });

  it('stays false when the prerequisite was rejected', () => {
    const set = buildChangeSet(
      action({
        actions: [
          { op: 'append_block', block: { id: 'fresh', type: 'paragraph', html: 'x' } },
          { op: 'replace_block', blockId: 'fresh', block: { html: 'y' } },
        ],
      }),
    );
    const rejected = {
      ...set,
      changes: [{ ...set.changes[0], status: 'rejected' as const }, set.changes[1]],
    };

    expect(isReady(rejected.changes[1], [rejected])).toBe(false);
  });
});

describe('querying', () => {
  const set = buildChangeSet(
    action({
      actions: [
        { op: 'replace_block', blockId: 'p', block: { html: 'New' } },
        { op: 'update_meta', meta: { name: 'Renamed' } },
      ],
    }),
  );

  it('counts only what is still pending', () => {
    expect(pendingCount([set])).toBe(2);

    const half = { ...set, changes: [{ ...set.changes[0], status: 'accepted' as const }, set.changes[1]] };
    expect(pendingCount([half])).toBe(1);
  });

  it('attaches the changes about a block to that block\u2019s row', () => {
    const rows = projectDocument(blocks, [set]).rows;
    const rowFor = (id: string) =>
      rows.find((row) => row.kind === 'block' && row.block.id === id);

    expect(rowFor('p')).toMatchObject({ changes: [expect.objectContaining({ anchorBlockId: 'p' })] });
    expect(rowFor('h')).toMatchObject({ changes: [] });
  });

  it('separates document-level changes from block ones', () => {
    expect(documentChanges([set])).toHaveLength(1);
    expect(documentChanges([set])[0].kind).toBe('rename');
  });

  it('surfaces changes whose block has been deleted', () => {
    // Otherwise the review bar counts a suggestion that renders nowhere, and
    // the author cannot reach it to dismiss it.
    expect(projectDocument(blocks, [set]).orphans).toHaveLength(0);
    expect(projectDocument([blocks[0]], [set]).orphans).toHaveLength(1);
  });

  it('does not treat a document-level change as orphaned', () => {
    // A rename has no block to be homeless from; the header reviews it.
    expect(projectDocument([], [set]).orphans.map((c) => c.kind)).not.toContain('rename');
  });
});

describe('rendering helpers', () => {
  it('merges a replace the way the server does', () => {
    const set = buildChangeSet(
      action({ actions: [{ op: 'replace_block', blockId: 'p', block: { html: 'Rewritten' } }] }),
    );
    const merged = mergedBlock(set.changes[0], blocks[1]);

    expect(merged).toMatchObject({ id: 'p', type: 'paragraph', html: 'Rewritten' });
    // Fields the agent did not mention keep their value.
    expect(merged).toMatchObject({ columns: 1 });
  });

  it('rejects a proposed block the canvas could not render', () => {
    const set = buildChangeSet(
      action({ actions: [{ op: 'append_block', block: { id: 'x', type: 'listicle' } }] }),
    );

    expect(proposedBlock(set.changes[0])).toBeNull();
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
    const set = buildChangeSet(
      action({
        actions: [
          { op: 'replace_block', blockId: 'h', block: { html: 'New' } },
          { op: 'delete_block', blockId: 'p' },
          { op: 'append_block', block: { id: 'n', type: 'heading', level: 3, html: 'x' } },
          { op: 'update_meta', meta: { name: 'X' } },
        ],
      }),
    );

    // The text is quoted so two same-kind changes in a long batch read as
    // two different changes, not as a duplicate row.
    expect(set.changes.map((c) => describeChange(c, blocks))).toEqual([
      'Rewrite heading “Title”',
      'Delete paragraph “Body text”',
      'Add heading “x”',
      'Rename document',
    ]);
  });
});

describe('a suggestion whose block changed or went away', () => {
  const rewrite = () =>
    buildChangeSet(
      action({ actions: [{ op: 'replace_block', blockId: 'p', block: { html: 'Assistant text' } }] }),
      blocks,
    );
  const edited: Block[] = [blocks[0], { ...blocks[1], html: 'Body text, edited by the author' } as Block];

  it('records what the block said when the suggestion was staged', () => {
    const set = rewrite();
    expect(set.changes[0].base).toBe(blockFingerprint(blocks[1]));
    expect(set.changes[0].opIndex).toBe(0);
    expect(isStale(set.changes[0], blocks)).toBe(false);
  });

  it('is stale once the author edits the block, and can no longer be accepted', () => {
    const set = rewrite();
    expect(isStale(set.changes[0], edited)).toBe(true);
    expect(isReady(set.changes[0], [set], edited)).toBe(false);
    expect(isReady(set.changes[0], [set], blocks)).toBe(true);
  });

  it('treats a deletion of an edited block the same way', () => {
    const set = buildChangeSet(action({ actions: [{ op: 'delete_block', blockId: 'p' }] }), blocks);
    expect(isStale(set.changes[0], edited)).toBe(true);
  });

  it('does not count collapsing or locking the block as an edit', () => {
    const set = rewrite();
    const folded: Block[] = [blocks[0], { ...blocks[1], collapsed: true, locked: true } as Block];
    expect(isStale(set.changes[0], folded)).toBe(false);
  });

  it('never marks an insert or a move stale', () => {
    const set = buildChangeSet(
      action({
        actions: [
          { op: 'insert_block_after', referenceId: 'p', block: { id: 'n', type: 'divider' } },
          { op: 'reorder_block', blockId: 'p', toIndex: 0 },
        ],
      }),
      blocks,
    );
    expect(set.changes.map((change) => isStale(change, edited))).toEqual([false, false]);
  });

  it('does not offer Accept for a rewrite of a block that was deleted', () => {
    const set = rewrite();
    // Accept used to be shown here, and the only thing it could do was fail.
    expect(isReady(set.changes[0], [set], [blocks[0]])).toBe(false);
  });

  it('carries the baseline over the author accepting an earlier rewrite of the same block', () => {
    const set = buildChangeSet(
      action({
        actions: [
          { op: 'replace_block', blockId: 'p', block: { html: 'First pass' } },
          { op: 'replace_block', blockId: 'p', block: { html: 'Second pass' } },
        ],
      }),
      blocks,
    );
    const after: Block[] = [blocks[0], { ...blocks[1], html: 'First pass' } as Block];
    const accepted = markChanges([set], new Set([set.changes[0].id]), 'accepted');

    // Without the rebase, accepting the first made the second look stale.
    expect(isStale(accepted[0].changes[1], after)).toBe(true);
    const rebased = rebaseAfterAccept(accepted, blocks, after, ['p']);
    expect(isStale(rebased[0].changes[1], after)).toBe(false);
  });

  it('keeps a suggestion stale when an accept lands on a block the author had already edited', () => {
    const set = buildChangeSet(
      action({
        actions: [
          { op: 'replace_block', blockId: 'p', block: { columns: 2 } },
          { op: 'replace_block', blockId: 'p', block: { html: 'Second pass' } },
        ],
      }),
      blocks,
    );
    const after: Block[] = [blocks[0], { ...(edited[1] as Block), columns: 2 } as Block];
    const accepted = markChanges([set], new Set([set.changes[0].id]), 'accepted');
    const rebased = rebaseAfterAccept(accepted, edited, after, ['p']);
    expect(isStale(rebased[0].changes[1], after)).toBe(true);
  });
});

describe('a target the server says changed since the proposal', () => {
  const batch = (...ops: ToolAction['actions']) => buildChangeSet(action({ actions: ops }), blocks);
  const rewrite = (html: string) => ({ op: 'replace_block' as const, blockId: 'p', block: { html } });
  const target = (fingerprint: string, headFingerprint: string | null) => ({
    blockId: 'p',
    fingerprint,
    headFingerprint,
  });

  it('is stale although the block has not been touched since it was staged', () => {
    // Staged after a reload: the live block is the author's newer text, so
    // the staging fingerprint alone sees nothing wrong.
    const set = batch(rewrite('Assistant text'));
    expect(isStale(set.changes[0], blocks)).toBe(false);

    const marked = markOutdated(set, [target('as-proposed', 'edited-since')]);

    expect(marked.changes[0].outdated).toBe(true);
    expect(isStale(marked.changes[0], blocks)).toBe(true);
    expect(isReady(marked.changes[0], [marked], blocks)).toBe(false);
  });

  it('is current when the saved block is the one the operation found', () => {
    const set = batch(rewrite('Assistant text'), { op: 'delete_block', blockId: 'h' });
    const marked = markOutdated(set, [
      target('same', 'same'),
      { blockId: 'h', fingerprint: 'h-1', headFingerprint: 'h-1' },
    ]);

    // Nothing to mark: the batch is handed back as it was.
    expect(marked).toBe(set);
    expect(marked.changes.map((change) => isStale(change, blocks))).toEqual([false, false]);
  });

  it('still notices an edit made after staging on a block the server called current', () => {
    const marked = markOutdated(batch(rewrite('Assistant text')), [target('same', 'same')]);
    const edited: Block[] = [blocks[0], { ...blocks[1], html: 'Typed just now' } as Block];
    expect(isStale(marked.changes[0], edited)).toBe(true);
  });

  it('is stale when the block is gone from the saved document but still on screen', () => {
    const marked = markOutdated(batch(rewrite('Assistant text')), [target('as-proposed', null)]);
    expect(isStale(marked.changes[0], blocks)).toBe(true);
  });

  it('reads a later rewrite of the same block as current while the earlier one is undecided', () => {
    // The second operation was written for the block as the first leaves it.
    // The saved block is still at the first one's stage, which is not an edit.
    const set = batch(rewrite('First pass'), rewrite('Second pass'));
    const marked = markOutdated(set, [target('stage-0', 'stage-0'), target('stage-1', 'stage-0')]);
    expect(marked.changes.map((change) => change.outdated ?? false)).toEqual([false, false]);
  });

  it('reads it as current once the earlier rewrite is accepted and saved', () => {
    const set = batch(rewrite('First pass'), rewrite('Second pass'));
    const marked = markOutdated(set, [target('stage-0', 'stage-1'), target('stage-1', 'stage-1')]);
    // The first is decided by then; what matters is the one still open.
    expect(marked.changes[1].outdated ?? false).toBe(false);
  });

  it('is stale when the block was edited by hand after the earlier rewrite was accepted', () => {
    const set = batch(rewrite('First pass'), rewrite('Second pass'));
    const marked = markOutdated(set, [target('stage-0', 'by-hand'), target('stage-1', 'by-hand')]);
    expect(marked.changes[1].outdated).toBe(true);
  });

  it('counts the stages recorded by the batches it was written on top of', () => {
    const set = batch(rewrite('Second batch'));
    const targets = [target('after-first-batch', 'before-first-batch')];

    expect(markOutdated(set, targets).changes[0].outdated).toBe(true);
    const earlier = new Map([['p', new Set(['before-first-batch'])]]);
    expect(markOutdated(set, targets, earlier).changes[0].outdated ?? false).toBe(false);
    // A stage of another block says nothing about this one.
    const unrelated = new Map([['h', new Set(['before-first-batch'])]]);
    expect(markOutdated(set, targets, unrelated).changes[0].outdated).toBe(true);
  });

  it('does not take a later operation on the block for an earlier stage', () => {
    const set = batch(rewrite('First pass'), rewrite('Second pass'));
    // The saved block equals what the *second* operation found, which the
    // first was not written for.
    const marked = markOutdated(set, [target('stage-0', 'stage-1'), target('stage-1', 'stage-1')]);
    expect(marked.changes[0].outdated).toBe(true);
  });

  it('leaves inserts, moves and operations without a target alone', () => {
    const set = batch(
      { op: 'insert_block_after', referenceId: 'p', block: { id: 'n', type: 'divider' } },
      rewrite('Assistant text'),
      { op: 'delete_block', blockId: 'h' },
    );
    const marked = markOutdated(set, [
      // A target on an insert, or for another block, is not this change's.
      target('x', 'y'),
      null,
      { blockId: 'p', fingerprint: 'x', headFingerprint: 'y' },
    ]);
    expect(marked).toBe(set);
  });

  it('follows the stored operation index after a rejection renumbers the batch', () => {
    const set = batch(
      { op: 'insert_block_after', referenceId: 'p', block: { id: 'n', type: 'divider' } },
      rewrite('Assistant text'),
    );
    const marked = markOutdated(set, [null, target('as-proposed', 'edited-since')]);
    expect(marked.changes.find((change) => change.kind === 'replace')?.outdated).toBe(true);
  });

  it('stays stale when an accept lands on the same block', () => {
    const set = markOutdated(
      batch({ op: 'replace_block', blockId: 'p', block: { columns: 2 } }, rewrite('Second pass')),
      [target('stage-0', 'stage-0'), target('stage-1', 'by-hand')],
    );
    const after: Block[] = [blocks[0], { ...blocks[1], columns: 2 } as Block];
    const accepted = markChanges([set], new Set([set.changes[0].id]), 'accepted');

    const rebased = rebaseAfterAccept(accepted, blocks, after, ['p']);

    // The server said this one was written for other text. Accepting its
    // sibling does not change that.
    expect(isStale(rebased[0].changes[1], after)).toBe(true);
  });
});

describe('resuming a half-reviewed durable batch', () => {
  const durable = () =>
    buildChangeSet(
      action({
        changeSetId: 'cs-1',
        actions: [
          { op: 'replace_block', blockId: 'p', block: { html: 'Rewritten' } },
          { op: 'insert_block_after', referenceId: 'p', block: { id: 'n1', type: 'paragraph', html: 'one' } },
          { op: 'insert_block_after', referenceId: 'n1', block: { id: 'n2', type: 'paragraph', html: 'two' } },
          { op: 'append_block', block: { id: 'n3', type: 'paragraph', html: 'three' } },
        ],
      }),
      blocks,
    );

  it('replays the decisions already made instead of offering them again', () => {
    const { set, landed } = resumeReview(
      durable(),
      { decisions: [[0, 'rejected'], [1, 'rejected']], bases: {} },
      blocks,
    );

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
  });

  it('does not offer an insert again when its block is already in the document', () => {
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

  it('restores the staging fingerprints, so an edit made before the reload still counts', () => {
    const original = durable();
    const before = original.changes[0].base!;
    const editedSinceProposal: Block[] = [blocks[0], { ...blocks[1], html: 'Edited before the reload' } as Block];
    // Staged again after the edit: on its own, the snapshot would be of the edited text.
    const restaged = buildChangeSet(
      action({ changeSetId: 'cs-1', actions: original.changes.map((change) => change.op) }),
      editedSinceProposal,
    );
    expect(isStale(restaged.changes[0], editedSinceProposal)).toBe(false);

    const { set } = resumeReview(restaged, { decisions: [], bases: { 0: before } }, editedSinceProposal);
    expect(isStale(set.changes[0], editedSinceProposal)).toBe(true);
  });

  it('recognises a rewrite that is already in the document', () => {
    const rewritten: Block[] = [blocks[0], { ...blocks[1], html: 'Rewritten' } as Block];
    const set = durable();
    expect(alreadyInDocument(set.changes[0], rewritten)).toBe(true);
    expect(alreadyInDocument(set.changes[0], blocks)).toBe(false);
  });
});
