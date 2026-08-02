import { describe, it, expect } from 'vitest';
import type { Block, ToolAction, ToolOperation } from '../types';
import { applyPatchToBlocks } from '../docOps';
import {
  buildChangeSet,
  isReady,
  linkPrecedence,
  projectDocument,
  resolveAcceptOp,
  type ChangeSet,
  type ProposedChange,
} from '../proposals';

/**
 * The property this file exists for.
 *
 * Accepting changes is a sequence of independent decisions, and the author
 * makes them in whatever order they read the document in. The document they
 * end up with must not depend on that order — it must be the document the
 * agent authored, minus whatever was rejected.
 */

function batch(actions: ToolOperation[], overrides: Partial<ToolAction> = {}): ChangeSet {
  return buildChangeSet({
    tool: 'doc_edit',
    toolCallId: 'call_1',
    actions,
    documentId: 'doc-1',
    version: 3,
    status: 'proposed',
    ...overrides,
  });
}

function para(id: string, html = id): Record<string, unknown> {
  return { id, type: 'paragraph', html, children: [], columns: 1 };
}

const doc: Block[] = [
  { id: 'A', type: 'paragraph', html: 'A', children: [], columns: 1 },
  { id: 'B', type: 'paragraph', html: 'B', children: [], columns: 1 },
  { id: 'C', type: 'paragraph', html: 'C', children: [], columns: 1 },
];

const ids = (blocks: Block[]) => blocks.map((block) => block.id).join(',');

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

function subsets<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 0; mask < 1 << items.length; mask += 1) {
    out.push(items.filter((_, index) => mask & (1 << index)));
  }
  return out;
}

/** What `acceptAll` produces: the accepted operations replayed in authoring order. */
function acceptAll(blocks: Block[], set: ChangeSet, accepted: ProposedChange[]): string {
  const order = new Map(set.changes.map((change, index) => [change.id, index]));
  const ops = [...accepted]
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((change) => change.op);
  return ids(applyPatchToBlocks(blocks, ops).blocks);
}

/** What clicking Accept on each change, one at a time, in `order` produces. */
function acceptOneByOne(blocks: Block[], set: ChangeSet, order: ProposedChange[]): string {
  let current = blocks;
  // Statuses live in the set, exactly as ProposalsContext keeps them.
  let sets: ChangeSet[] = [set];

  for (const change of order) {
    const live = sets[0].changes.find((candidate) => candidate.id === change.id)!;
    const op = resolveAcceptOp(live, sets, current);
    if (op) current = applyPatchToBlocks(current, [op]).blocks;
    sets = [
      {
        ...sets[0],
        changes: sets[0].changes.map((candidate) =>
          candidate.id === change.id ? { ...candidate, status: 'accepted' as const } : candidate,
        ),
      },
    ];
  }
  return ids(current);
}

const CASES: Array<{ name: string; ops: ToolOperation[] }> = [
  {
    name: 'three paragraphs appended to the end',
    ops: [
      { op: 'append_block', block: para('X') },
      { op: 'append_block', block: para('Y') },
      { op: 'append_block', block: para('Z') },
    ],
  },
  {
    name: 'three paragraphs inserted at the start',
    ops: [
      { op: 'insert_block_at_start', block: para('X') },
      { op: 'insert_block_at_start', block: para('Y') },
      { op: 'insert_block_at_start', block: para('Z') },
    ],
  },
  {
    name: 'three paragraphs after the same block',
    ops: [
      { op: 'insert_block_after', referenceId: 'A', block: para('X') },
      { op: 'insert_block_after', referenceId: 'A', block: para('Y') },
      { op: 'insert_block_after', referenceId: 'A', block: para('Z') },
    ],
  },
  {
    name: 'three paragraphs before the same block',
    ops: [
      { op: 'insert_block_before', referenceId: 'B', block: para('X') },
      { op: 'insert_block_before', referenceId: 'B', block: para('Y') },
      { op: 'insert_block_before', referenceId: 'B', block: para('Z') },
    ],
  },
  {
    name: 'inserts spread across four different slots',
    ops: [
      { op: 'insert_block_after', referenceId: 'A', block: para('W') },
      { op: 'insert_block_before', referenceId: 'C', block: para('X') },
      { op: 'append_block', block: para('Y') },
      { op: 'insert_block_at_start', block: para('Z') },
    ],
  },
  {
    name: 'both sides of one anchor, interleaved',
    ops: [
      { op: 'insert_block_after', referenceId: 'A', block: para('W') },
      { op: 'insert_block_before', referenceId: 'A', block: para('X') },
      { op: 'insert_block_after', referenceId: 'A', block: para('Y') },
      { op: 'insert_block_before', referenceId: 'A', block: para('Z') },
    ],
  },
  {
    name: 'an append and a trailing insert competing for the tail',
    ops: [
      { op: 'append_block', block: para('X') },
      { op: 'insert_block_after', referenceId: 'C', block: para('Y') },
      { op: 'append_block', block: para('Z') },
    ],
  },
];

describe('accepting changes is order-independent', () => {
  for (const { name, ops } of CASES) {
    it(`${name}: every click order matches Accept all`, () => {
      const set = batch(ops);

      for (const chosen of subsets(set.changes)) {
        if (chosen.length === 0) continue;
        const expected = acceptAll(doc, set, chosen);

        for (const order of permutations(chosen)) {
          expect(
            acceptOneByOne(doc, set, order),
            `accepting ${order.map((c) => c.producesBlockId ?? c.id).join(' then ')}`,
          ).toBe(expected);
        }
      }
    });
  }

  it('is the property the old accept path failed', () => {
    // The regression this suite locks down: applying the raw operation against
    // the live document, which is what `settle` used to do.
    const set = batch([
      { op: 'append_block', block: para('X') },
      { op: 'append_block', block: para('Y') },
      { op: 'append_block', block: para('Z') },
    ]);
    const [x, y, z] = set.changes;

    const naive = [z, x, y].reduce(
      (blocks, change) => applyPatchToBlocks(blocks, [change.op]).blocks,
      doc,
    );
    expect(ids(naive)).toBe('A,B,C,Z,X,Y');

    expect(acceptOneByOne(doc, set, [z, x, y])).toBe('A,B,C,X,Y,Z');
    expect(acceptAll(doc, set, [x, y, z])).toBe('A,B,C,X,Y,Z');
  });
});

describe('the preview is the outcome', () => {
  for (const { name, ops } of CASES) {
    it(`${name}: rows read in the order Accept all produces`, () => {
      const set = batch(ops);
      const { rows, orphans } = projectDocument(doc, [set]);

      expect(orphans).toEqual([]);

      const previewed = rows.map((row) =>
        row.kind === 'block' ? row.block.id : row.change.producesBlockId,
      );
      expect(previewed.join(',')).toBe(acceptAll(doc, set, set.changes));
    });
  }
});

describe('chained inserts', () => {
  const chained = () =>
    batch([
      { op: 'insert_block_after', referenceId: 'A', block: para('X') },
      { op: 'insert_block_after', referenceId: 'X', block: para('Y') },
      { op: 'insert_block_after', referenceId: 'Y', block: para('Z') },
    ]);

  it('render in place rather than as orphans at the end of the document', () => {
    const { rows, orphans } = projectDocument(doc, [chained()]);

    // Every one of these used to be an orphan: `X` does not exist in the
    // document yet, so the two changes anchored to it and to `Y` had no row.
    expect(orphans).toEqual([]);
    expect(
      rows.map((row) => (row.kind === 'block' ? row.block.id : row.change.producesBlockId)).join(','),
    ).toBe('A,X,Y,Z,B,C');
  });

  it('land in the same place once accepted in dependency order', () => {
    const set = chained();
    expect(acceptOneByOne(doc, set, set.changes)).toBe('A,X,Y,Z,B,C');
  });
});

describe('changes spread across several batches', () => {
  // One operation per batch is the ordinary shape of a conversation: the
  // author asks for one thing, then another, and both are still open.
  const twoBatches = () => [
    batch([{ op: 'append_block', block: para('X') }], { toolCallId: 'call_1' }),
    batch([{ op: 'append_block', block: para('Y') }], { toolCallId: 'call_2' }),
  ];

  function acceptAcross(sets: ChangeSet[], order: Array<[number, number]>): string {
    let current = doc;
    let live = sets;
    for (const [setIndex, changeIndex] of order) {
      const target = live[setIndex].changes[changeIndex];
      const op = resolveAcceptOp(target, live, current);
      if (op) current = applyPatchToBlocks(current, [op]).blocks;
      live = live
        .map((set) => ({
          ...set,
          changes: set.changes.map((candidate) =>
            candidate.id === target.id
              ? { ...candidate, status: 'accepted' as const }
              : candidate,
          ),
        }))
        // The retention rule under test: a batch is only dropped once the whole
        // review is finished. Dropping it as soon as its own changes were all
        // decided erased the sibling the next batch positions itself against.
        .filter(() =>
          live.some((set) => set.changes.some((change) => change.status === 'pending')),
        );
    }
    return ids(current);
  }

  it('land in authoring order however the batches are accepted', () => {
    expect(acceptAcross(twoBatches(), [[0, 0], [1, 0]])).toBe('A,B,C,X,Y');
    expect(acceptAcross(twoBatches(), [[1, 0], [0, 0]])).toBe('A,B,C,X,Y');
  });
});

/**
 * Inserts are made to commute by re-anchoring them. Deletions and moves cannot
 * be — a delete removes the anchor others are addressed to, and a reorder's
 * index means different things in two different documents — so they are
 * serialised instead, and the review refuses to offer the out-of-order accept.
 */
describe('changes that cannot be commuted are gated instead', () => {
  /** Every order the review would actually permit, accepting everything. */
  function permissibleOutcomes(set: ChangeSet): Set<string> {
    const outcomes = new Set<string>();

    const walk = (sets: ChangeSet[], current: Block[]) => {
      const precedence = linkPrecedence(sets);
      const open = sets[0].changes.filter((change) => change.status === 'pending');
      if (open.length === 0) {
        outcomes.add(ids(current));
        return;
      }

      const offered = open.filter((change) => isReady(change, sets, current, precedence));
      if (offered.length === 0) {
        // Nothing left the author is allowed to accept; whatever remains can
        // only be rejected, so this is a terminal document.
        outcomes.add(ids(current));
        return;
      }

      for (const change of offered) {
        const op = resolveAcceptOp(change, sets, current);
        const next = op ? applyPatchToBlocks(current, [op]).blocks : current;
        walk(
          [
            {
              ...sets[0],
              changes: sets[0].changes.map((candidate) =>
                candidate.id === change.id
                  ? { ...candidate, status: 'accepted' as const }
                  : candidate,
              ),
            },
          ],
          next,
        );
      }
    };

    walk([set], doc);
    return outcomes;
  }

  const GATED: Array<{ name: string; ops: ToolOperation[] }> = [
    {
      name: 'an insert anchored to a block the same batch deletes',
      ops: [
        { op: 'insert_block_after', referenceId: 'A', block: para('X') },
        { op: 'delete_block', blockId: 'A' },
      ],
    },
    {
      name: 'a delete followed by an insert against the same block',
      ops: [
        { op: 'delete_block', blockId: 'B' },
        { op: 'insert_block_after', referenceId: 'B', block: para('X') },
      ],
    },
    {
      name: 'an insert and a move competing over absolute indexes',
      ops: [
        { op: 'insert_block_at_start', block: para('X') },
        { op: 'reorder_block', blockId: 'A', toIndex: 2 },
      ],
    },
    {
      name: 'a move followed by an insert against the moved block',
      ops: [
        { op: 'reorder_block', blockId: 'C', toIndex: 0 },
        { op: 'insert_block_after', referenceId: 'C', block: para('X') },
      ],
    },
  ];

  for (const { name, ops } of GATED) {
    it(`${name}: every order the review permits gives one document`, () => {
      const set = batch(ops);
      const outcomes = permissibleOutcomes(set);
      const expected = acceptAll(doc, set, set.changes);

      expect([...outcomes]).toEqual([expected]);
    });
  }
});

describe('a change whose block really is gone', () => {
  it('is still reported as an orphan', () => {
    const set = batch([
      { op: 'replace_block', blockId: 'deleted', block: { html: 'new' } },
      { op: 'insert_block_after', referenceId: 'deleted', block: para('X') },
    ]);
    const { orphans } = projectDocument(doc, [set]);
    // Both of them: the rewrite of the missing block as well as the insert
    // anchored to it. The rewrite used to be dropped from the projection while
    // the review bar went on counting it, so the author was told there was a
    // change to review and given no way to reach it.
    expect(orphans.map((change) => change.kind)).toEqual(['replace', 'insert']);
  });

  it('cannot be accepted, and says so rather than guessing', () => {
    const set = batch([{ op: 'insert_block_after', referenceId: 'deleted', block: para('X') }]);
    expect(resolveAcceptOp(set.changes[0], [set], doc)).toBeNull();
  });
});
