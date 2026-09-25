import { describe, it, expect } from 'vitest';
import type { Block, ToolAction } from '../types';
import {
  blockText,
  buildChangeSet,
  describeChange,
  documentChanges,
  projectDocument,
  isReady,
  mergedBlock,
  pendingCount,
  proposedBlock,
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
