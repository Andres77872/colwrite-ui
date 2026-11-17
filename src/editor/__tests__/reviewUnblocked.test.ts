import { itemAt } from '@/lib/itemAt';
import { describe, expect, it } from 'vitest';
import type { Block, ToolOperation } from '../types';
import { applyPatchToBlocks } from '../docOps';
import { append, deleteBlocks, moveBlock, rewrite, writeAfter, writeBefore } from './operations';
import {
  acceptBlocker,
  buildChangeSet,
  isReady,
  linkAcrossSets,
  linkPrecedence,
  markChanges,
  projectDocument,
  rejectChange,
  resolveAcceptOp,
  type ChangeSet,
} from '../proposals';

/**
 * When the review offers Accept, and when it does not.
 *
 * A change is held back only by what it really depends on: an addition it
 * builds on (in its own batch or an earlier one of the run), or a change that
 * names one of the same blocks and gives a different page in the other
 * order. A move used to be ordered against every positional change on the
 * page, so one change the author could not accept held back everything after
 * it, and the review offered nothing but Reject.
 */

const block = (id: string, html = id): Block => ({ id, type: 'paragraph', html, children: [], columns: 1 });
const para = (id: string, html = id): Record<string, unknown> => ({ id, type: 'paragraph', html, children: [], columns: 1 });
const page: Block[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => block(id));
const ids = (blocks: Block[]) => blocks.map((candidate) => candidate.id).join(',');

function stage(actions: ToolOperation[], blocks: Block[], changeSetId = 'cs-1'): ChangeSet {
  return buildChangeSet({ toolCallId: changeSetId, documentId: 'doc-1', status: 'proposed', actions, changeSetId }, blocks);
}

/** Every page the review lets the author reach by accepting everything, one change at a time. */
function permittedOutcomes(set: ChangeSet, start: Block[]): Set<string> {
  const outcomes = new Set<string>();
  const walk = (sets: ChangeSet[], current: Block[]) => {
    const precedence = linkPrecedence(sets);
    const open = itemAt(sets, 0).changes.filter((change) => change.status === 'pending');
    const offered = open.filter((change) => isReady(change, sets, current, precedence));
    if (offered.length === 0) {
      outcomes.add(ids(current));
      return;
    }
    for (const change of offered) {
      const op = resolveAcceptOp(change, sets, current);
      const next = op ? applyPatchToBlocks(current, [op]).blocks : current;
      walk(markChanges(sets, new Set([change.id]), 'accepted'), next);
    }
  };
  walk([set], start);
  return outcomes;
}

describe('changes that name no block in common', () => {
  it('are not held back by a deletion the author can no longer accept', () => {
    const set = stage([
      deleteBlocks('B'),
      moveBlock('E', 'before', 'A'),
      writeAfter('C', para('X')),
      append(para('Z')),
    ], page);
    // The author edits the paragraph the deletion was written for.
    const edited = page.map((candidate) => (candidate.id === 'B' ? block('B', 'B, edited') : candidate));
    const precedence = linkPrecedence([set]);
    const offered = set.changes.map((change) => isReady(change, [set], edited, precedence));

    expect(offered).toEqual([false, true, true, true]);
    expect(acceptBlocker(itemAt(set.changes, 0), [set], edited, precedence)).toEqual({ reason: 'stale' });
  });

  const MIXED: Array<{ name: string; ops: ToolOperation[] }> = [
    {
      name: 'a move, a deletion, inserts and an append in different places',
      ops: [
        writeAfter('A', para('X')),
        moveBlock('E', 'after', 'C'),
        deleteBlocks('F'),
        writeBefore('B', para('Y')),
        append(para('Z')),
      ],
    },
    {
      name: 'two moves and an insert, one move next to the insert',
      ops: [
        moveBlock('B', 'after', 'D'),
        writeAfter('A', para('X')),
        moveBlock('A', 'before', 'F'),
        deleteBlocks('C'),
      ],
    },
    {
      name: 'a rewrite written as two blocks, and a move of its block',
      ops: [
        rewrite('B', para('B', 'b, rewritten'), para('B2')),
        moveBlock('B', 'after', 'E'),
        writeAfter('D', para('X')),
      ],
    },
    {
      name: 'two moves next to the same block, an insert there, and a deletion elsewhere',
      ops: [
        writeAfter('A', para('X')),
        moveBlock('C', 'after', 'A'),
        moveBlock('D', 'after', 'A'),
        deleteBlocks('F'),
      ],
    },
    {
      name: 'moves to either side of an insert slot',
      ops: [
        writeAfter('B', para('X')),
        moveBlock('E', 'before', 'C'),
        moveBlock('F', 'after', 'A'),
        writeBefore('C', para('Y')),
      ],
    },
  ];

  for (const { name, ops } of MIXED) {
    it(`${name}: every order the review permits gives the page the assistant wrote`, () => {
      const set = stage(ops, page);
      const expected = ids(applyPatchToBlocks(page, ops).blocks);
      expect([...permittedOutcomes(set, page)]).toEqual([expected]);
    });
  }

  it('still names the change that must be decided first when two touch the same block', () => {
    const set = stage([writeAfter('A', para('X')), moveBlock('C', 'after', 'A')], page);
    const blocker = acceptBlocker(itemAt(set.changes, 1), [set], page, linkPrecedence([set]));
    expect(blocker).toEqual({ reason: 'after', change: itemAt(set.changes, 0) });
  });
});

/**
 * A run's later batch is written on top of its earlier ones while they are
 * pending (`depends_on_change_set_id`), so it can name a block an earlier
 * batch adds. It used to read as a change whose block had been deleted.
 */
describe('a batch that builds on an earlier batch of the run', () => {
  const start: Block[] = [block('A'), block('B')];
  const first = () => stage([writeAfter('A', para('X', 'drafted'))], start, 'cs-1');
  const second = (earlier: ChangeSet[]) => linkAcrossSets(stage([
    rewrite('X', para('X', 'drafted, tightened')),
    writeAfter('X', para('Y')),
  ], start, 'cs-2'), earlier);

  it('waits for the addition it builds on, and says which', () => {
    const one = first();
    const two = second([one]);
    const sets = [one, two];
    const precedence = linkPrecedence(sets);
    const added = itemAt(one.changes, 0);

    for (const change of two.changes) {
      expect(acceptBlocker(change, sets, start, precedence)).toEqual({ reason: 'needs', change: added });
    }

    // Once the addition is accepted, both can be.
    const accepted = markChanges(sets, new Set([added.id]), 'accepted');
    const landed = applyPatchToBlocks(start, [added.op]).blocks;
    const after = itemAt(accepted, 1).changes.map((change) => isReady(change, accepted, landed, linkPrecedence(accepted)));
    expect(after).toEqual([true, true]);
  });

  it('is shown after the addition, not as a change with no place on the page', () => {
    const one = first();
    const two = second([one]);
    const { rows, orphans } = projectDocument(start, [one, two]);

    expect(orphans).toEqual([]);
    expect(rows.map((row) => (row.kind === 'block' ? row.block.id : `${row.kind}:${row.change.kind}`)))
      .toEqual(['A', 'insert:insert', 'dependent:replace', 'insert:insert', 'B']);
  });

  it('rejecting the addition takes the rewrite of its block along, and moves what continues it onto its place', () => {
    const one = first();
    const two = second([one]);
    const added = itemAt(one.changes, 0);
    const [rewriteOfX, continuation] = two.changes;

    const { sets, rejected, reanchored } = rejectChange([one, two], added.id);

    expect(rejected).toEqual([added.id, rewriteOfX!.id]);
    expect(reanchored).toEqual([continuation!.id]);
    const moved = itemAt(itemAt(sets, 1).changes, 1);
    expect(moved).toMatchObject({ status: 'pending', anchorBlockId: 'A', placement: 'after', dependsOn: [] });
    expect(isReady(moved, sets, start, linkPrecedence(sets))).toBe(true);
  });

  it('a continuation of an addition already rejected takes its place when it arrives', () => {
    const one = first();
    const rejected = rejectChange([one], itemAt(one.changes, 0).id).sets;
    const two = second(rejected);

    const continuation = itemAt(two.changes, 1);
    expect(continuation).toMatchObject({ anchorBlockId: 'A', placement: 'after', dependsOn: [] });
    expect(continuation.op).toMatchObject({ op: 'write_blocks', position: 'after', blockId: 'A' });
    // The rewrite of the block that will never exist can only be rejected, and says why.
    expect(acceptBlocker(itemAt(two.changes, 0), [...rejected, two], start, linkPrecedence([...rejected, two])))
      .toMatchObject({ reason: 'needs-rejected' });
  });
});
