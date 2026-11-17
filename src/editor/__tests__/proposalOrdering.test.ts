import { itemAt, takeItems } from '@/lib/itemAt';
import { describe, it, expect } from 'vitest';
import type { Block, ToolAction, ToolOperation } from '../types';
import { applyPatchToBlocks } from '../docOps';
import { append, deleteBlocks, moveBlock, rewrite, writeAfter, writeBefore } from './operations';
import {
  buildChangeSet,
  isReady,
  linkPrecedence,
  planRejection,
  projectDocument,
  rejectChange,
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
    changeSetId: 'cs-1',
    ...overrides,
  } as ToolAction & { changeSetId: string });
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
    for (const tail of permutations(rest)) out.push([itemAt(items, i), ...tail]);
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
    const live = itemAt(sets, 0).changes.find((candidate) => candidate.id === change.id)!;
    const op = resolveAcceptOp(live, sets, current);
    if (op) current = applyPatchToBlocks(current, [op]).blocks;
    sets = [
      {
        ...itemAt(sets, 0),
        changes: itemAt(sets, 0).changes.map((candidate) =>
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
      append(para('X')),
      append(para('Y')),
      append(para('Z')),
    ],
  },
  {
    name: 'two writes of two paragraphs each after the same block',
    ops: [
      writeAfter('A', para('X1'), para('X2')),
      writeAfter('A', para('Y1'), para('Y2')),
    ],
  },
  {
    name: 'three paragraphs written before the first block',
    ops: [
      writeBefore('A', para('X')),
      writeBefore('A', para('Y')),
      writeBefore('A', para('Z')),
    ],
  },
  {
    name: 'three paragraphs after the same block',
    ops: [
      writeAfter('A', para('X')),
      writeAfter('A', para('Y')),
      writeAfter('A', para('Z')),
    ],
  },
  {
    name: 'three paragraphs before the same block',
    ops: [
      writeBefore('B', para('X')),
      writeBefore('B', para('Y')),
      writeBefore('B', para('Z')),
    ],
  },
  {
    name: 'inserts spread across four different slots',
    ops: [
      writeAfter('A', para('W')),
      writeBefore('C', para('X')),
      append(para('Y')),
      writeBefore('A', para('Z')),
    ],
  },
  {
    name: 'both sides of one anchor, interleaved',
    ops: [
      writeAfter('A', para('W')),
      writeBefore('A', para('X')),
      writeAfter('A', para('Y')),
      writeBefore('A', para('Z')),
    ],
  },
  {
    name: 'an append and a trailing insert competing for the tail',
    ops: [
      append(para('X')),
      writeAfter('C', para('Y')),
      append(para('Z')),
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
            `accepting ${order.map((c) => c.producesBlockIds[0] ?? c.id).join(' then ')}`,
          ).toBe(expected);
        }
      }
    });
  }

  it('is the property the old accept path failed', () => {
    // The regression this suite locks down: applying the raw operation against
    // the live document, which is what `settle` used to do.
    const set = batch([
      append(para('X')),
      append(para('Y')),
      append(para('Z')),
    ]);
    const [x, y, z] = takeItems(set.changes, 3);

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
        row.kind === 'block' ? row.block.id : row.change.producesBlockIds.join(','),
      );
      expect(previewed.join(',')).toBe(acceptAll(doc, set, set.changes));
    });
  }
});

describe('chained inserts', () => {
  const chained = () =>
    batch([
      writeAfter('A', para('X')),
      writeAfter('X', para('Y')),
      writeAfter('Y', para('Z')),
    ]);

  it('render in place rather than as orphans at the end of the document', () => {
    const { rows, orphans } = projectDocument(doc, [chained()]);

    // Every one of these used to be an orphan: `X` does not exist in the
    // document yet, so the two changes anchored to it and to `Y` had no row.
    expect(orphans).toEqual([]);
    expect(
      rows.map((row) => (row.kind === 'block' ? row.block.id : row.change.producesBlockIds.join(','))).join(','),
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
    batch([append(para('X'))], { toolCallId: 'call_1' }),
    batch([append(para('Y'))], { toolCallId: 'call_2' }),
  ];

  function acceptAcross(sets: ChangeSet[], order: Array<[number, number]>): string {
    let current = doc;
    let live = sets;
    for (const [setIndex, changeIndex] of order) {
      const target = itemAt(itemAt(live, setIndex).changes, changeIndex);
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
 * be — a delete removes the anchor others are addressed to, and a move changes
 * what stands next to what — so they are serialised instead, and the review
 * refuses to offer the out-of-order accept.
 */
describe('changes that cannot be commuted are gated instead', () => {
  /** Every order the review would actually permit, accepting everything. */
  function permissibleOutcomes(set: ChangeSet): Set<string> {
    const outcomes = new Set<string>();

    const walk = (sets: ChangeSet[], current: Block[]) => {
      const precedence = linkPrecedence(sets);
      const open = itemAt(sets, 0).changes.filter((change) => change.status === 'pending');
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
              ...itemAt(sets, 0),
              changes: itemAt(sets, 0).changes.map((candidate) =>
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
        writeAfter('A', para('X')),
        deleteBlocks('A'),
      ],
    },
    {
      name: 'a delete followed by an insert against the same block',
      ops: [
        deleteBlocks('B'),
        writeAfter('B', para('X')),
      ],
    },
    {
      name: 'an insert and a move next to the same block',
      ops: [
        writeBefore('A', para('X')),
        moveBlock('C', 'before', 'A'),
      ],
    },
    {
      name: 'a move followed by an insert against the moved block',
      ops: [
        moveBlock('C', 'before', 'A'),
        writeAfter('C', para('X')),
      ],
    },
    {
      name: 'an insert anchored to one of the blocks a deletion of two removes',
      ops: [
        writeAfter('B', para('X')),
        deleteBlocks('A', 'B'),
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
      rewrite('deleted', para('deleted', 'new')),
      writeAfter('deleted', para('X')),
    ]);
    const { orphans } = projectDocument(doc, [set]);
    // Both of them: the rewrite of the missing block as well as the insert
    // anchored to it. The rewrite used to be dropped from the projection while
    // the review bar went on counting it, so the author was told there was a
    // change to review and given no way to reach it.
    expect(orphans.map((change) => change.kind)).toEqual(['replace', 'insert']);
  });

  it('cannot be accepted, and says so rather than guessing', () => {
    const set = batch([writeAfter('deleted', para('X'))]);
    expect(resolveAcceptOp(itemAt(set.changes, 0), [set], doc)).toBeNull();
  });
});

/**
 * Rejecting one paragraph of a suggested section. The paragraphs after it are
 * addressed to it, and they used to be rejected along with it. They now move
 * onto its place, and the property that matters is that the rest of the
 * section reads exactly as it did, minus the rejected block.
 */
describe('rejecting an insert that others continue from', () => {
  const projected = (sets: ChangeSet[]) =>
    projectDocument(doc, sets)
      .rows.map((row) => (row.kind === 'block' ? row.block.id : row.change.producesBlockIds.join(',')))
      .join(',');

  const CHAINS: Array<{ name: string; ops: ToolOperation[] }> = [
    {
      name: 'a heading and three paragraphs, each after the one before',
      ops: [
        writeAfter('A', para('H')),
        writeAfter('H', para('P1')),
        writeAfter('P1', para('P2')),
        writeAfter('P2', para('P3')),
      ],
    },
    {
      name: 'a continuation whose anchor shares a slot with a later sibling',
      ops: [
        writeAfter('A', para('X')),
        writeAfter('A', para('V')),
        writeAfter('X', para('Y')),
      ],
    },
    {
      name: 'continuations on both sides of the rejected block',
      ops: [
        writeAfter('A', para('X')),
        writeBefore('X', para('Q1')),
        writeBefore('X', para('Q2')),
        writeAfter('X', para('Y1')),
        writeAfter('X', para('Y2')),
      ],
    },
    {
      name: 'a chain that starts before an existing block',
      ops: [
        writeBefore('B', para('X')),
        writeAfter('X', para('Y')),
        writeAfter('Y', para('Z')),
      ],
    },
    {
      name: 'a chain before the first block, with a later write before it',
      ops: [
        writeBefore('A', para('X')),
        writeBefore('A', para('W')),
        writeAfter('X', para('Y')),
      ],
    },
    {
      name: 'a chain appended to the end',
      ops: [
        append(para('X')),
        writeAfter('X', para('Y')),
        append(para('Z')),
      ],
    },
  ];

  for (const { name, ops } of CHAINS) {
    it(`${name}: rejecting any one leaves the others where they were shown`, () => {
      const set = batch(ops);
      const before = projected([set]);

      for (const rejectedChange of set.changes) {
        const { sets, rejected } = rejectChange([set], rejectedChange.id);
        const label = `rejecting ${rejectedChange.producesBlockIds.join(',')}`;
        // Only the rejected block goes; nothing else is taken with it.
        expect(rejected, label).toEqual([rejectedChange.id]);

        const remaining = itemAt(sets, 0).changes.filter((change) => change.status === 'pending');
        expect(remaining, label).toHaveLength(set.changes.length - 1);

        const expected = before
          .split(',')
          .filter((id) => !rejectedChange.producesBlockIds.includes(id))
          .join(',');
        // The preview shows the section without the rejected paragraph…
        expect(projected(sets), label).toBe(expected);
        // …Accept all on what is left produces exactly that…
        expect(acceptAll(doc, itemAt(sets, 0), remaining), label).toBe(expected);
        // …and so does accepting the rest one by one, in any order the review
        // offers: a continuation only once what it continues from is in.
        const offered = permutations(remaining).filter((order) =>
          order.every((change, index) =>
            change.dependsOn.every((id) => order.slice(0, index).some((prior) => prior.id === id)),
          ),
        );
        expect(offered.length, label).toBeGreaterThan(0);
        for (const order of offered) {
          expect(acceptOneByOne(doc, itemAt(sets, 0), order), label).toBe(expected);
        }
      }
    });
  }

  it('makes the next paragraph acceptable straight away', () => {
    const set = batch(itemAt(CHAINS, 0).ops);
    const [heading, first, second] = takeItems(set.changes, 3);
    expect(isReady(second, [set], doc)).toBe(false);

    const { sets } = rejectChange([set], first.id);
    const moved = itemAt(sets, 0).changes.find((change) => change.id === second.id)!;
    // Now addressed to the heading, which is still to be decided.
    expect(moved).toMatchObject({ anchorBlockId: 'H', placement: 'after', dependsOn: [heading.id] });
    expect(moved.op).toMatchObject({ op: 'write_blocks', position: 'after', blockId: 'H' });

    const { sets: afterHeading } = rejectChange(sets, heading.id);
    const top = itemAt(afterHeading, 0).changes.find((change) => change.id === second.id)!;
    expect(top).toMatchObject({ anchorBlockId: 'A', dependsOn: [] });
    expect(isReady(top, afterHeading, doc)).toBe(true);
  });

  it('ends in the same document whichever of two linked paragraphs is rejected first', () => {
    const set = batch(itemAt(CHAINS, 0).ops);
    const [, first, second] = takeItems(set.changes, 3);

    const one = rejectChange(rejectChange([set], first.id).sets, second.id).sets;
    const other = rejectChange(rejectChange([set], second.id).sets, first.id).sets;
    expect(projected(one)).toBe('A,H,P3,B,C');
    expect(projected(other)).toBe('A,H,P3,B,C');
  });

  it('still rejects a change to the block that will never exist, and says so', () => {
    const set = batch([
      writeAfter('A', para('X')),
      writeAfter('X', para('Y')),
      rewrite('X', para('X', 'X, rewritten')),
    ]);
    const [insert, continuation, rewritten] = takeItems(set.changes, 3);

    // What the card asks about before rejecting.
    const plan = planRejection(insert.id, [set]);
    expect(plan.reanchored.map((change) => change.id)).toEqual([continuation.id]);
    expect(plan.cascaded.map((change) => change.id)).toEqual([rewritten.id]);

    const { sets, rejected, reanchored } = rejectChange([set], insert.id);
    expect(rejected).toEqual([insert.id, rewritten.id]);
    expect(reanchored).toEqual([continuation.id]);
    expect(sets[0]?.changes.find((change) => change.id === continuation.id)?.status).toBe('pending');
  });

  it('changes nothing for a change that is already decided or unknown', () => {
    const set = batch(itemAt(CHAINS, 0).ops);
    const decided = rejectChange([set], itemAt(set.changes, 0).id).sets;
    expect(rejectChange(decided, itemAt(set.changes, 0).id).sets).toBe(decided);
    expect(rejectChange(decided, 'missing').rejected).toEqual([]);
  });
});
