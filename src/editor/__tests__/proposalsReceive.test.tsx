import { itemAt, takeItems } from '@/lib/itemAt';
import { createRef, useImperativeHandle } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProposalsProvider } from '../ProposalsContext';
import { FakeEditorProviders, type EditorProbe } from './editorHarness';
import { useProposals, type ProposalsContextValue } from '../proposalsContextState';
import { pendingInDocumentOrder } from '../proposals';
import { applyPatchToBlocks } from '../docOps';
import { ApiError } from '@/api/errors';
import type { Block, ToolAction, ToolOperation } from '../types';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

/**
 * What the review layer accepts from the wire, and what it tells the caller it
 * did with it. The chat transcript prints those numbers, so a wrong one is a
 * reply describing edits the document does not have.
 */

const getChangeSet = vi.fn();
const listPendingChangeSets = vi.fn();
const rejectChangeSet = vi.fn();
const decideChangeSetOperations = vi.fn();

vi.mock('@/data/documentHistory', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/data/documentHistory')),
  getChangeSet: (_workspaceId: unknown, ...args: unknown[]) => getChangeSet(...(args as [])),
  listPendingChangeSets: (_workspaceId: unknown, ...args: unknown[]) => listPendingChangeSets(...(args as [])),
  rejectChangeSet: (_workspaceId: unknown, ...args: unknown[]) => rejectChangeSet(...(args as [])),
  decideChangeSetOperations: (_workspaceId: unknown, ...args: unknown[]) => decideChangeSetOperations(...(args as [])),
}));

const captureRef = createRef<ProposalsContextValue>();

const blocks: Block[] = [
  { id: 'A', type: 'paragraph', html: 'first', children: [], columns: 1 },
  { id: 'B', type: 'paragraph', html: 'second', children: [], columns: 1 },
];

const applyPatch = vi.fn(() => ({ blocks, desynced: [], touched: [] }));
const adoptRestoredDocument = vi.fn();
const markRecentlyChanged = vi.fn();

function Capture() {
  const review = useProposals();
  useImperativeHandle(captureRef, () => review, [review]);
  return null;
}

function mount(documentId: string | null = 'doc-1') {
  const tree = (restoreEpoch: number, restoreReason: 'restore' | 'newer-version' = 'restore') => {
    const value = {
      documentId,
      blocks,
      applyPatch,
      adoptRestoredDocument,
      markRecentlyChanged,
      restoreEpoch,
      restoreReason,
    } as unknown as EditorProbe;
    return (
      // The fake carries every slice, so it feeds every editor context.
      <FakeEditorProviders value={value}>
        <ProposalsProvider>
          <Capture />
        </ProposalsProvider>
      </FakeEditorProviders>
    );
  };
  const result = render(tree(0));
  return {
    ...result,
    /** Simulate a restore moving the document to another tree version. */
    setRestoreEpoch: (epoch: number) => result.rerender(tree(epoch)),
    /** Simulate the author opening the server's newer version after a refused save. */
    openNewerVersion: (epoch: number) => result.rerender(tree(epoch, 'newer-version')),
  };
}

function review(): ProposalsContextValue {
  if (!captureRef.current) throw new Error('not mounted');
  return captureRef.current;
}

/** A `tool_action` as the stream sends it, with no change set of its own. */
function toolAction(overrides: Partial<ToolAction> = {}): ToolAction {
  return {
    tool: 'doc_edit',
    toolCallId: 'call_1',
    documentId: 'doc-1',
    status: 'proposed',
    actions: [],
    ...overrides,
  };
}

/** A pending change set as `getChangeSet` reads it. */
function storedSet(over: Record<string, unknown> = {}) {
  return {
    changeSetId: 'cs-1',
    documentId: 'doc-1',
    status: 'pending',
    operations: [] as ToolOperation[],
    unmappableOperations: [] as string[],
    baseEtag: 'cw:2',
    toolCallId: 'call_1',
    summary: null,
    expiresAt: '2026-11-20T00:00:00Z',
    proposedAt: '2026-11-14T10:00:00Z',
    dependsOnChangeSetId: null,
    applyPolicy: 'review',
    autoBlockedReason: null,
    operationDecisions: [],
    operationTargets: null,
    ...over,
  };
}

/** The change sets the server holds, by id. */
const storedSets = new Map<string, ReturnType<typeof storedSet>>();

/**
 * The server stores a change set with these operations, and the stream
 * announces it: its id and size, and none of its operations.
 */
function proposal(operations: ToolOperation[], overrides: Partial<ToolAction> = {}): ToolAction {
  const changeSetId = overrides.changeSetId ?? `cs-${storedSets.size + 1}`;
  storedSets.set(changeSetId, storedSet({ changeSetId, operations, toolCallId: overrides.toolCallId ?? 'call_1' }));
  return toolAction({ changeSetId, proposalOperationCount: operations.length, ...overrides });
}

/** Take a `tool_action`, and let the review layer read the change set it names. */
async function receive(action: ToolAction): Promise<ReturnType<ProposalsContextValue['receive']>> {
  let result!: ReturnType<ProposalsContextValue['receive']>;
  await act(async () => {
    result = review().receive(action);
  });
  return result;
}

const divider = (id: string): ToolOperation => ({ op: 'append_block', block: { id, type: 'divider' } });

beforeEach(() => {
  vi.clearAllMocks();
  // Decisions on durable batches are remembered in this browser; one test's
  // record must not resume another test's review.
  localStorage.clear();
  // `clearAllMocks` keeps implementations: a pending list one test set up
  // would otherwise be staged again by every later mount.
  listPendingChangeSets.mockResolvedValue([]);
  decideChangeSetOperations.mockResolvedValue({});
  storedSets.clear();
  getChangeSet.mockReset().mockImplementation(async (_documentId: string, changeSetId: string) => {
    const stored = storedSets.get(changeSetId);
    if (!stored) throw new ApiError('Change set not found', 404, { code: 'change_set_not_found' });
    return stored;
  });
});
afterEach(() => cleanup());

describe('receive', () => {
  it('stages only a change set the server stored: operations on the stream are not a proposal', async () => {
    mount();
    const result = await receive(toolAction({ actions: [divider('X')] }));

    expect(result.changes).toBe(0);
    expect(getChangeSet).not.toHaveBeenCalled();
    expect(review().pendingCount).toBe(0);
  });

  it('does not offer a failed batch for acceptance', async () => {
    mount();
    await receive(toolAction({ status: 'error', message: 'The tool failed' }));

    expect(review().pendingCount).toBe(0);
    expect(review().error).toBe('The tool failed');
  });

  it('accepts a change set that names no document as belonging to this one', async () => {
    // The request was addressed to this document; a payload that omits the id
    // is answering it. Requiring an exact match dropped it silently.
    mount();
    await receive(proposal([divider('X')], { documentId: '' }));
    expect(review().pendingCount).toBe(1);
  });

  it('still refuses a change set belonging to a different document', async () => {
    mount();
    await receive(proposal([divider('X')], { documentId: 'doc-other' }));
    expect(getChangeSet).not.toHaveBeenCalled();
    expect(review().pendingCount).toBe(0);
  });

  it('never writes an `applied` action into the page: only a stored set can be applied', async () => {
    // `doc_edit` always stores a change set (D18); an action that claims to
    // have committed block operations is not one the editor replays.
    mount();
    const result = await receive(toolAction({ status: 'applied', actions: [divider('X')] }));

    expect(result.changes).toBe(0);
    expect(review().pendingCount).toBe(0);
    expect(applyPatch).not.toHaveBeenCalled();
  });
});

describe('reject', () => {
  it('clears a change that could never be applied', async () => {
    mount();
    await receive(proposal([{ op: 'replace_block', blockId: 'gone', block: { html: 'x' } }]));
    expect(review().pendingCount).toBe(1);

    act(() => review().reject(itemAt(review().pending, 0).id));
    expect(review().pendingCount).toBe(0);
  });
});

/**
 * The provider driven the way the author drives it: a real block list that the
 * accepted operations actually mutate.
 */
describe('accepting through the provider', () => {
  function mountStateful(initial: Block[]) {
    const live = { blocks: initial };
    const patch = vi.fn((ops: Parameters<EditorProbe['applyPatch']>[0]) => {
      const outcome = applyPatchToBlocks(live.blocks, ops);
      live.blocks = outcome.blocks;
      return outcome;
    });

    function Host() {
      const review = useProposals();
      useImperativeHandle(captureRef, () => review, [review]);
      return null;
    }

    const Tree = () => {
      const value = {
        documentId: 'doc-1',
        // Read on every render, so each accept positions itself against the
        // document the previous one produced.
        get blocks() {
          return live.blocks;
        },
        applyPatch: patch,
        markRecentlyChanged,
      } as unknown as EditorProbe;
      // The fake carries every slice, so it feeds every editor context.
      return (
        <FakeEditorProviders value={value}>
          <ProposalsProvider>
            <Host />
          </ProposalsProvider>
        </FakeEditorProviders>
      );
    };

    const view = render(<Tree />);
    return { live, rerender: () => view.rerender(<Tree />) };
  }

  const appendBatch = (callId: string, blockId: string): ToolAction =>
    proposal([divider(blockId)], { toolCallId: callId });

  it.each([
    ['in the order they arrived', [0, 1]],
    ['in the reverse order', [1, 0]],
  ])('puts one-operation batches in authoring order, accepted %s', async (_name, clicks) => {
    const { live, rerender } = mountStateful([{ id: 'A', type: 'divider' }]);

    await receive(appendBatch('call_1', 'X'));
    await receive(appendBatch('call_2', 'Y'));
    rerender();

    const staged = review().pending.map((change) => change.id);
    expect(staged).toHaveLength(2);

    for (const index of clicks as number[]) {
      act(() => review().accept(itemAt(staged, index)));
      rerender();
    }

    // The document the agent authored, whichever order the author clicked in.
    // Accepting the second batch first used to append the first one after it,
    // because the settled batch had been dropped and could no longer say where
    // its block had gone.
    expect(live.blocks.map((block) => block.id)).toEqual(['A', 'X', 'Y']);
    expect(review().pendingCount).toBe(0);
  });
});

describe('pendingInDocumentOrder', () => {
  it('walks the page rather than the order batches arrived in', async () => {
    mount();
    // Authored against the end of the document, then the start.
    await receive(proposal([
      { op: 'replace_block', blockId: 'B', block: { html: 'later' } },
      { op: 'replace_block', blockId: 'A', block: { html: 'earlier' } },
    ], { toolCallId: 'call_late' }));

    const arrival = review().pending.map((change) => change.anchorBlockId);
    const reading = pendingInDocumentOrder(blocks, review().sets).map(
      (change) => change.anchorBlockId,
    );

    expect(arrival).toEqual(['B', 'A']);
    expect(reading).toEqual(['A', 'B']);
  });
});

describe('durable change sets', () => {
  const durableAction = (overrides: Partial<ToolAction> = {}): ToolAction =>
    toolAction({
      changeSetId: 'cs-1',
      proposalOperationCount: 3,
      ...overrides,
    });

  const fetchedSet = (over: Record<string, unknown> = {}) => ({
    changeSetId: 'cs-1',
    documentId: 'doc-1',
    status: 'pending',
    operations: [
      { op: 'replace_block', blockId: 'A', block: { html: 'rewritten' } },
      { op: 'append_block', block: { id: 'N1', type: 'divider' } },
    ],
    unmappableOperations: [] as string[],
    baseEtag: 'cw:2',
    toolCallId: 'call_1',
    summary: null,
    expiresAt: '2026-08-03T12:00:00Z',
    proposedAt: '2026-08-02T12:00:00Z',
    dependsOnChangeSetId: null,
    operationDecisions: [],
    operationTargets: null,
    ...over,
  });

  /** The decisions sent to the server, one request each. */
  const sentDecisions = () => decideChangeSetOperations.mock.calls.map((call) => call[2] as unknown[]);

  it('fetches the redacted batch by id and stages it for review', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    mount();

    let result!: ReturnType<ProposalsContextValue['receive']>;
    act(() => {
      result = review().receive(durableAction());
    });

    // Reported synchronously from the server-counted preview.
    expect(result.changes).toBe(3);

    await act(async () => {});
    expect(getChangeSet).toHaveBeenCalledWith('doc-1', 'cs-1');
    expect(review().pendingCount).toBe(2);
    expect(review().sets[0]?.changeSetId).toBe('cs-1');
  });

  it('delivers the same change set once', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});
    let second!: ReturnType<ProposalsContextValue['receive']>;
    act(() => {
      second = review().receive(durableAction());
    });

    expect(second.changes).toBe(0);
    expect(getChangeSet).toHaveBeenCalledTimes(1);
    expect(review().pendingCount).toBe(2);
  });

  it('a restore discards the staged review and retires the record as superseded', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    const { setRestoreEpoch } = mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});
    expect(review().pendingCount).toBe(2);

    act(() => setRestoreEpoch(1));

    // The staged changes describe a version the document no longer sits on.
    expect(review().pendingCount).toBe(0);
    expect(review().sets).toEqual([]);
    // Left pending server-side, the batch would re-stage on the next load.
    await act(async () => {});
    expect(rejectChangeSet).toHaveBeenCalledWith(
      'doc-1',
      'cs-1',
      'Superseded: the page was restored to another version',
    );
  });

  it('opening the newer version after a refused save stages the pending batch again', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    const { openNewerVersion } = mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});
    expect(review().pendingCount).toBe(2);

    // The server still holds the batch, and lists it for the newer content.
    listPendingChangeSets.mockResolvedValue([fetchedSet()]);
    act(() => openNewerVersion(1));
    expect(review().sets).toEqual([]);

    await act(async () => {});
    // Same line of history: nothing is retired, the review comes back.
    expect(rejectChangeSet).not.toHaveBeenCalled();
    expect(review().sets.map((set) => set.changeSetId)).toEqual(['cs-1']);
    expect(review().pendingCount).toBe(2);
  });

  it('a batch fetched across a restore is not staged onto the new version', async () => {
    let resolveFetch!: (value: unknown) => void;
    getChangeSet.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { setRestoreEpoch } = mount();

    act(() => void review().receive(durableAction()));
    act(() => setRestoreEpoch(1));
    await act(async () => {
      resolveFetch(fetchedSet());
    });

    expect(review().pendingCount).toBe(0);
    expect(review().sets).toEqual([]);
  });

  it('accepts one specific change locally, like any other batch', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});
    const changeId = itemAt(review().pending, 0).id;
    await act(async () => {
      review().accept(changeId);
    });

    // Per-change review is local: the operation lands in the editor and the
    // sibling stays pending. Nothing is decided wholesale on the server.
    expect(applyPatch).toHaveBeenCalledTimes(1);
    expect(rejectChangeSet).not.toHaveBeenCalled();
    expect(review().pendingCount).toBe(1);
  });

  it('records each decision on the server, which retires the set on the last one', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});
    await act(async () => {
      review().accept(itemAt(review().pending, 0).id);
    });
    await act(async () => {
      review().reject(itemAt(review().pending, 0).id);
    });

    // Accepted ops were applied as author edits; the record keeps both
    // decisions, and nothing is rejected wholesale.
    expect(sentDecisions()).toEqual([[{ opIndex: 0, decision: 'accepted' }], [{ opIndex: 1, decision: 'rejected' }]]);
    expect(rejectChangeSet).not.toHaveBeenCalled();
    expect(review().pendingCount).toBe(0);
  });

  it('rejecting everything records every operation as rejected', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});
    await act(async () => {
      review().rejectAll();
    });

    expect(applyPatch).not.toHaveBeenCalled();
    expect(sentDecisions()).toEqual([[{ opIndex: 0, decision: 'rejected' }, { opIndex: 1, decision: 'rejected' }]]);
    expect(rejectChangeSet).not.toHaveBeenCalled();
    expect(review().pendingCount).toBe(0);
  });

  it('accept-all applies locally and records every operation as accepted', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});
    await act(async () => {
      review().acceptAll();
    });

    expect(applyPatch).toHaveBeenCalled();
    expect(sentDecisions()).toEqual([[{ opIndex: 0, decision: 'accepted' }, { opIndex: 1, decision: 'accepted' }]]);
    expect(rejectChangeSet).not.toHaveBeenCalled();
    expect(review().pendingCount).toBe(0);
  });

  it('a decision that cannot be sent never blocks the author', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    decideChangeSetOperations.mockRejectedValue(new Error('offline'));
    mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});
    await act(async () => {
      review().rejectAll();
    });

    // The decision stands locally; the stale record can be re-rejected later.
    expect(review().pendingCount).toBe(0);
    expect(review().error).toBeNull();
  });

  it('refuses to stage a batch that uses an operation this version cannot map', async () => {
    getChangeSet.mockResolvedValue(fetchedSet({ unmappableOperations: ['move_block'] }));
    mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});

    // Staging the mappable subset would let the author unknowingly retire the
    // whole server record when the last visible change is decided. Nothing is
    // staged and the record stays pending — no reject goes out.
    expect(review().pendingCount).toBe(0);
    expect(review().sets).toEqual([]);
    expect(review().error).toContain('can’t review');
    expect(rejectChangeSet).not.toHaveBeenCalled();
  });

  it('refuses to re-stage an unmappable batch found pending on load', async () => {
    listPendingChangeSets.mockResolvedValueOnce([
      fetchedSet({ changeSetId: 'cs-load', unmappableOperations: ['move_block'] }),
    ]);
    mount();
    await act(async () => {});

    expect(review().pendingCount).toBe(0);
    expect(review().sets).toEqual([]);
    expect(review().error).toContain('can’t review');
    expect(rejectChangeSet).not.toHaveBeenCalled();
  });
});

/**
 * The provider against a block list that accepted operations really change,
 * mounted again to stand for a reload or a return to the document.
 */
function mountLive(live: { blocks: Block[] }, { cards = false }: { cards?: boolean } = {}) {
  const patch = vi.fn((ops: Parameters<EditorProbe['applyPatch']>[0]) => {
    const outcome = applyPatchToBlocks(live.blocks, ops);
    live.blocks = outcome.blocks;
    return outcome;
  });

  /** The canvas, reduced to what focus can land on: block text and review cards. */
  function Page() {
    const current = useProposals();
    useImperativeHandle(captureRef, () => current, [current]);
    if (!cards) return null;
    return (
      <>
        {live.blocks.map((block) => (
          <div key={block.id} className="block-row" data-block-id={block.id}>
            <div contentEditable="true" tabIndex={0} suppressContentEditableWarning />
          </div>
        ))}
        {pendingInDocumentOrder(live.blocks, current.sets).map((change) => (
          <div key={change.id} data-change-id={change.id} tabIndex={-1} />
        ))}
      </>
    );
  }

  const Tree = () => {
    const value = {
      documentId: 'doc-1',
      get blocks() {
        return live.blocks;
      },
      applyPatch: patch,
      markRecentlyChanged,
      restoreEpoch: 0,
    } as unknown as EditorProbe;
    return (
      <FakeEditorProviders value={value}>
        <ProposalsProvider>
          <Page />
        </ProposalsProvider>
      </FakeEditorProviders>
    );
  };

  const view = render(<Tree />);
  return { patch, rerender: () => view.rerender(<Tree />), unmount: view.unmount };
}

const para = (id: string, html = id): Block => ({ id, type: 'paragraph', html, children: [], columns: 1 });

/** A change set stored before the server recorded targets: staleness comes from this browser's fingerprints. */
describe('a durable batch reviewed in part', () => {
  type Decision = { opIndex: number; decision: 'accepted' | 'rejected' };

  const stored = (over: Record<string, unknown> = {}) => ({
    changeSetId: 'cs-1',
    documentId: 'doc-1',
    status: 'pending',
    operations: [
      { op: 'replace_block', blockId: 'A', block: { html: 'A, rewritten' } },
      { op: 'insert_block_after', referenceId: 'A', block: para('N1', 'new one') },
      { op: 'append_block', block: para('N2', 'new two') },
    ],
    unmappableOperations: [] as string[],
    baseEtag: 'cw:2',
    toolCallId: 'call_1',
    summary: null,
    expiresAt: '2026-11-10T10:00:00Z',
    proposedAt: '2026-11-09T10:00:00Z',
    dependsOnChangeSetId: null,
    operationDecisions: [] as Decision[],
    operationTargets: null,
    ...over,
  });

  const byProduces = (id: string) => review().pending.find((change) => change.producesBlockId === id)!;
  const byAnchor = (id: string) =>
    review().pending.find((change) => change.anchorBlockId === id && change.kind !== 'insert')!;
  const sent = () => decideChangeSetOperations.mock.calls.map((call) => call[2] as Decision[]);

  it('comes back after a reload with only the undecided changes', async () => {
    listPendingChangeSets.mockResolvedValue([stored()]);
    const live = { blocks: [para('A'), para('B')] };
    const first = mountLive(live);
    await act(async () => {});
    expect(review().pendingCount).toBe(3);

    act(() => review().accept(byProduces('N1').id));
    first.rerender();
    act(() => review().reject(byAnchor('A').id));
    first.rerender();
    expect(review().pendingCount).toBe(1);
    expect(live.blocks.map((block) => block.id)).toEqual(['A', 'N1', 'B']);
    await act(async () => {});
    expect(sent()).toEqual([[{ opIndex: 1, decision: 'accepted' }], [{ opIndex: 0, decision: 'rejected' }]]);

    // The reload: the server hands back all three operations, and the two
    // decisions it recorded.
    first.unmount();
    listPendingChangeSets.mockResolvedValue([stored({
      operationDecisions: [{ opIndex: 1, decision: 'accepted' }, { opIndex: 0, decision: 'rejected' }],
    })]);
    const second = mountLive(live);
    await act(async () => {});

    // Only the append is left. The accepted insert used to come back as
    // pending (and fail on Accept as a duplicate), and the rejected rewrite
    // came back as if it had never been decided.
    expect(review().pending.map((change) => change.producesBlockId)).toEqual(['N2']);

    await act(async () => {
      review().accept(review().pending[0]!.id);
    });
    second.rerender();
    expect(live.blocks.map((block) => block.id)).toEqual(['A', 'N1', 'B', 'N2']);
    // The last decision retires the set on the server; nothing is rejected by hand.
    expect(sent().at(-1)).toEqual([{ opIndex: 2, decision: 'accepted' }]);
    expect(rejectChangeSet).not.toHaveBeenCalled();
  });

  it('does not offer an insert again when its block is already in the document', async () => {
    // Decided in another browser that could not send it.
    listPendingChangeSets.mockResolvedValue([stored()]);
    const live = { blocks: [para('A'), para('N1', 'new one'), para('B')] };
    mountLive(live);
    await act(async () => {});

    expect(review().pending.map((change) => change.kind)).toEqual(['replace', 'insert']);
    expect(review().pending.some((change) => change.producesBlockId === 'N1')).toBe(false);
    // What the document already holds is recorded as accepted.
    expect(sent()).toEqual([[{ opIndex: 1, decision: 'accepted' }]]);
  });

  it('does not stage a batch this browser decided in full but could not send, and sends it again', async () => {
    listPendingChangeSets.mockResolvedValue([stored()]);
    const live = { blocks: [para('A'), para('B')] };
    const first = mountLive(live);
    await act(async () => {});
    // The network drops while the decisions are sent.
    decideChangeSetOperations.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async () => {
      review().rejectAll();
    });
    first.rerender();
    expect(decideChangeSetOperations).toHaveBeenCalledTimes(1);
    first.unmount();

    mountLive(live);
    await act(async () => {});
    expect(review().pendingCount).toBe(0);
    expect(sent().at(-1)).toEqual([
      { opIndex: 0, decision: 'rejected' },
      { opIndex: 1, decision: 'rejected' },
      { opIndex: 2, decision: 'rejected' },
    ]);
    expect(rejectChangeSet).not.toHaveBeenCalled();
  });
});

describe('a durable batch whose decisions the server records', () => {
  type Decision = { opIndex: number; decision: 'accepted' | 'rejected' };

  /** A pending change set as an API with per-operation review returns it. */
  const stored = (over: Record<string, unknown> = {}) => ({
    changeSetId: 'cs-1',
    documentId: 'doc-1',
    status: 'pending',
    operations: [
      { op: 'replace_block', blockId: 'A', block: { html: 'A, rewritten' } },
      { op: 'insert_block_after', referenceId: 'A', block: para('N1', 'new one') },
      { op: 'append_block', block: para('N2', 'new two') },
    ],
    unmappableOperations: [] as string[],
    baseEtag: 'cw:2',
    toolCallId: 'call_1',
    summary: null,
    expiresAt: null,
    proposedAt: '2026-11-09T10:00:00Z',
    dependsOnChangeSetId: null,
    operationDecisions: [] as Decision[],
    operationTargets: [{ blockId: 'A', fingerprint: 'a-0', headFingerprint: 'a-0' }, null, null],
    ...over,
  });

  const byProduces = (id: string) => review().pending.find((change) => change.producesBlockId === id)!;
  const rewriteOf = (id: string) =>
    review().pending.find((change) => change.anchorBlockId === id && change.kind === 'replace')!;
  const sent = () => decideChangeSetOperations.mock.calls.map((call) => call[2] as Decision[]);
  const records = () => Object.keys(localStorage).filter((key) => key.includes('cs-1'));
  const settle = () => act(async () => {});

  it('records each decision on the server as it is made, and nothing in this browser', async () => {
    listPendingChangeSets.mockResolvedValue([stored()]);
    const live = { blocks: [para('A'), para('B')] };
    const view = mountLive(live);
    await settle();
    expect(review().pendingCount).toBe(3);
    expect(decideChangeSetOperations).not.toHaveBeenCalled();

    await act(async () => review().accept(byProduces('N1').id));
    view.rerender();
    await act(async () => review().reject(rewriteOf('A').id));
    view.rerender();

    expect(decideChangeSetOperations).toHaveBeenCalledTimes(2);
    // The author's own decisions.
    expect(decideChangeSetOperations).toHaveBeenNthCalledWith(1, 'doc-1', 'cs-1', [
      { opIndex: 1, decision: 'accepted' },
    ], 'manual');
    expect(decideChangeSetOperations).toHaveBeenNthCalledWith(2, 'doc-1', 'cs-1', [
      { opIndex: 0, decision: 'rejected' },
    ], 'manual');
    expect(review().pending.map((change) => change.producesBlockId)).toEqual(['N2']);
    // The accepted insert is an ordinary edit; the set is not decided wholesale.
    expect(live.blocks.map((block) => block.id)).toEqual(['A', 'N1', 'B']);
    expect(rejectChangeSet).not.toHaveBeenCalled();
    expect(records()).toEqual([]);
  });

  it('comes back after a reload with only the undecided changes, from the server’s record', async () => {
    // Decided on another device: this browser has no record of its own.
    listPendingChangeSets.mockResolvedValue([
      stored({
        operationDecisions: [
          { opIndex: 1, decision: 'accepted' },
          { opIndex: 0, decision: 'rejected' },
        ],
      }),
    ]);
    const live = { blocks: [para('A'), para('N1', 'new one'), para('B')] };
    mountLive(live);
    await settle();

    expect(review().pending.map((change) => change.producesBlockId)).toEqual(['N2']);
    // Nothing new was learned by staging it, so nothing is sent.
    expect(decideChangeSetOperations).not.toHaveBeenCalled();
    expect(records()).toEqual([]);
  });

  it('the last decision resolves the set on the server, with no reject call', async () => {
    listPendingChangeSets.mockResolvedValue([
      stored({
        operationDecisions: [
          { opIndex: 1, decision: 'accepted' },
          { opIndex: 0, decision: 'rejected' },
        ],
      }),
    ]);
    const live = { blocks: [para('A'), para('N1', 'new one'), para('B')] };
    const view = mountLive(live);
    await settle();

    await act(async () => review().accept(byProduces('N2').id));
    view.rerender();

    expect(live.blocks.map((block) => block.id)).toEqual(['A', 'N1', 'B', 'N2']);
    expect(review().pendingCount).toBe(0);
    expect(sent()).toEqual([[{ opIndex: 2, decision: 'accepted' }]]);
    // The server takes the set out of `pending` itself when it records the
    // last decision. Rejecting it as well was the stopgap.
    expect(rejectChangeSet).not.toHaveBeenCalled();
  });

  it('sends Accept all and Reject all as one request each', async () => {
    listPendingChangeSets.mockResolvedValue([stored()]);
    const live = { blocks: [para('A'), para('B')] };
    const view = mountLive(live);
    await settle();

    await act(async () => review().reject(rewriteOf('A').id));
    view.rerender();
    await act(async () => review().acceptAll());
    view.rerender();

    expect(sent()).toEqual([
      [{ opIndex: 0, decision: 'rejected' }],
      [
        { opIndex: 1, decision: 'accepted' },
        { opIndex: 2, decision: 'accepted' },
      ],
    ]);
    expect(rejectChangeSet).not.toHaveBeenCalled();

    view.unmount();
    decideChangeSetOperations.mockClear();
    listPendingChangeSets.mockResolvedValue([stored({ changeSetId: 'cs-2' })]);
    const again = mountLive({ blocks: [para('A'), para('B')] });
    await settle();
    await act(async () => review().rejectAll());
    again.rerender();

    expect(decideChangeSetOperations).toHaveBeenCalledWith('doc-1', 'cs-2', [
      { opIndex: 0, decision: 'rejected' },
      { opIndex: 1, decision: 'rejected' },
      { opIndex: 2, decision: 'rejected' },
    ], 'manual');
    expect(rejectChangeSet).not.toHaveBeenCalled();
  });

  it('sends decisions one request at a time, in the order they were made', async () => {
    listPendingChangeSets.mockResolvedValue([stored()]);
    const view = mountLive({ blocks: [para('A'), para('B')] });
    await settle();
    let finishFirst!: () => void;
    decideChangeSetOperations.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishFirst = resolve;
      }),
    );

    await act(async () => review().reject(byProduces('N2').id));
    view.rerender();
    await act(async () => review().reject(rewriteOf('A').id));
    view.rerender();

    // The second waits: a reload replays rejections in the recorded order.
    expect(sent()).toEqual([[{ opIndex: 2, decision: 'rejected' }]]);
    await act(async () => finishFirst());
    expect(sent()).toEqual([
      [{ opIndex: 2, decision: 'rejected' }],
      [{ opIndex: 0, decision: 'rejected' }],
    ]);
  });

  it('records an operation the document already holds, found on opening it', async () => {
    // Accepted and saved on another device, whose decision never arrived.
    listPendingChangeSets.mockResolvedValue([stored()]);
    mountLive({ blocks: [para('A'), para('N1', 'new one'), para('B')] });
    await settle();

    expect(review().pending.some((change) => change.producesBlockId === 'N1')).toBe(false);
    expect(sent()).toEqual([[{ opIndex: 1, decision: 'accepted' }]]);
    expect(records()).toEqual([]);
  });

  it('keeps a decision that could not be sent, and sends it when the document is next opened', async () => {
    listPendingChangeSets.mockResolvedValue([stored()]);
    const live = { blocks: [para('A'), para('B')] };
    const first = mountLive(live);
    await settle();
    decideChangeSetOperations.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await act(async () => review().reject(rewriteOf('A').id));
    first.rerender();
    expect(review().pendingCount).toBe(2);
    expect(records()).toHaveLength(1);
    first.unmount();

    // The server never heard of it: the set comes back whole.
    decideChangeSetOperations.mockClear();
    mountLive(live);
    await settle();

    expect(review().pending.map((change) => change.kind)).toEqual(['insert', 'insert']);
    expect(sent()).toEqual([[{ opIndex: 0, decision: 'rejected' }]]);
    expect(records()).toEqual([]);
  });

  it('lets the server’s record win over one made here that it never received', async () => {
    // This browser rejected the rewrite while offline; another device accepted it.
    localStorage.setItem(
      `colwrite:ws:${TEST_WORKSPACE_ID}:review:doc-1:cs-1`,
      JSON.stringify({
        documentId: 'doc-1',
        changeSetId: 'cs-1',
        at: Date.now(),
        decisions: [[0, 'rejected'], [2, 'rejected']],
        bases: {},
      }),
    );
    listPendingChangeSets.mockResolvedValue([
      stored({ operationDecisions: [{ opIndex: 0, decision: 'accepted' }] }),
    ]);
    mountLive({ blocks: [para('A', 'A, rewritten'), para('B')] });
    await settle();

    expect(review().pending.map((change) => change.producesBlockId)).toEqual(['N1']);
    // Only the decision the server does not have is sent.
    expect(sent()).toEqual([[{ opIndex: 2, decision: 'rejected' }]]);
    expect(records()).toEqual([]);
  });

  it('sends the rest again when one decision was already made the other way elsewhere', async () => {
    listPendingChangeSets.mockResolvedValue([stored()]);
    const view = mountLive({ blocks: [para('A'), para('B')] });
    await settle();
    decideChangeSetOperations.mockRejectedValueOnce(
      new ApiError('That operation was already decided differently', 409, {
        code: 'change_set_conflict',
        retryable: false,
        conflict_reason: 'operation_already_decided',
        operation_index: 1,
      }),
    );

    await act(async () => review().rejectAll());
    view.rerender();

    expect(sent()).toEqual([
      [
        { opIndex: 0, decision: 'rejected' },
        { opIndex: 1, decision: 'rejected' },
        { opIndex: 2, decision: 'rejected' },
      ],
      [
        { opIndex: 0, decision: 'rejected' },
        { opIndex: 2, decision: 'rejected' },
      ],
    ]);
    expect(records()).toEqual([]);
  });

  it('drops a decision the server refuses for good instead of sending it on every load', async () => {
    listPendingChangeSets.mockResolvedValue([stored()]);
    const view = mountLive({ blocks: [para('A'), para('B')] });
    await settle();
    // Decided in full on another device a moment ago.
    decideChangeSetOperations.mockRejectedValueOnce(
      new ApiError('Only a pending change set can be decided', 409, {
        code: 'change_set_conflict',
        retryable: false,
        conflict_reason: 'terminal_state',
      }),
    );

    await act(async () => review().reject(rewriteOf('A').id));
    view.rerender();

    expect(decideChangeSetOperations).toHaveBeenCalledTimes(1);
    expect(records()).toEqual([]);
    expect(review().error).toBeNull();
  });

  it('a restore still retires what is left of a partly decided set, with its note', async () => {
    getChangeSet.mockResolvedValue(stored());
    const { setRestoreEpoch } = mount();
    act(() => void review().receive(toolAction({ changeSetId: 'cs-1' })));
    await settle();
    expect(review().pendingCount).toBe(3);

    act(() => setRestoreEpoch(1));
    await settle();

    expect(rejectChangeSet).toHaveBeenCalledWith(
      'doc-1',
      'cs-1',
      'Superseded: the page was restored to another version',
    );
  });

  describe('and a target that changed since the proposal', () => {
    const edited = () =>
      stored({
        operationTargets: [{ blockId: 'A', fingerprint: 'a-0', headFingerprint: 'a-edited' }, null, null],
      });

    it('is not applied over the author’s text, although nothing changed since it was staged', async () => {
      // The author rewrote A after the assistant read it, then reloaded: the
      // block on screen is the block that was staged against.
      listPendingChangeSets.mockResolvedValue([edited()]);
      const live = { blocks: [para('A', 'rewritten by the author'), para('B')] };
      const view = mountLive(live);
      await settle();

      const change = rewriteOf('A');
      expect(review().ready(change)).toBe(false);
      await act(async () => review().accept(change.id));
      view.rerender();

      expect(view.patch).not.toHaveBeenCalled();
      expect(live.blocks[0]).toMatchObject({ html: 'rewritten by the author' });
      expect(review().error).toMatch(/changed after the assistant suggested this/);
      expect(review().pendingCount).toBe(3);
      expect(decideChangeSetOperations).not.toHaveBeenCalled();

      // It can still be turned down, and that is recorded.
      await act(async () => review().reject(change.id));
      view.rerender();
      expect(sent()).toEqual([[{ opIndex: 0, decision: 'rejected' }]]);
    });

    it('is left out of Accept all, which says so', async () => {
      listPendingChangeSets.mockResolvedValue([edited()]);
      const live = { blocks: [para('A', 'rewritten by the author'), para('B')] };
      const view = mountLive(live);
      await settle();

      await act(async () => review().acceptAll());
      view.rerender();

      expect(live.blocks.map((block) => block.id)).toEqual(['A', 'N1', 'B', 'N2']);
      expect(live.blocks[0]).toMatchObject({ html: 'rewritten by the author' });
      expect(review().pending.map((change) => change.anchorBlockId)).toEqual(['A']);
      expect(review().error).toMatch(/1 suggestion was not applied because its text changed/);
      expect(sent()).toEqual([
        [
          { opIndex: 1, decision: 'accepted' },
          { opIndex: 2, decision: 'accepted' },
        ],
      ]);
    });

    it('is offered as usual when the saved block is the one it was written for', async () => {
      listPendingChangeSets.mockResolvedValue([stored()]);
      const live = { blocks: [para('A'), para('B')] };
      const view = mountLive(live);
      await settle();

      await act(async () => review().accept(rewriteOf('A').id));
      view.rerender();
      expect(live.blocks[0]).toMatchObject({ html: 'A, rewritten' });
    });

    it('reads a later batch of the run as current while the block is as the earlier batch found it', async () => {
      // The first batch rewrote A and was rejected in full, so the server no
      // longer lists it. The second was written on top of it.
      const second = stored({
        changeSetId: 'cs-2',
        dependsOnChangeSetId: 'cs-1',
        operations: [{ op: 'replace_block', blockId: 'A', block: { html: 'A, second pass' } }],
        operationTargets: [{ blockId: 'A', fingerprint: 'a-1', headFingerprint: 'a-0' }],
      });
      listPendingChangeSets.mockResolvedValue([second]);
      getChangeSet.mockResolvedValue(stored({ status: 'rejected' }));
      const live = { blocks: [para('A'), para('B')] };
      const view = mountLive(live);
      await settle();

      expect(getChangeSet).toHaveBeenCalledWith('doc-1', 'cs-1');
      const change = rewriteOf('A');
      expect(review().ready(change)).toBe(true);
      await act(async () => review().accept(change.id));
      view.rerender();
      expect(live.blocks[0]).toMatchObject({ html: 'A, second pass' });
    });

    it('does not ask for the earlier batch when it is listed, or when nothing differs', async () => {
      const second = stored({
        changeSetId: 'cs-2',
        dependsOnChangeSetId: 'cs-1',
        proposedAt: '2026-11-09T10:01:00Z',
        operations: [{ op: 'replace_block', blockId: 'A', block: { html: 'A, second pass' } }],
        operationTargets: [{ blockId: 'A', fingerprint: 'a-1', headFingerprint: 'a-0' }],
      });
      listPendingChangeSets.mockResolvedValue([stored(), second]);
      mountLive({ blocks: [para('A'), para('B')] });
      await settle();

      expect(getChangeSet).not.toHaveBeenCalled();
      expect(review().sets.map((set) => set.changeSetId)).toEqual(['cs-1', 'cs-2']);
      expect(review().pending.filter((change) => change.outdated)).toEqual([]);
    });

    it('reads it as changed when the earlier batch cannot be read', async () => {
      const second = stored({
        changeSetId: 'cs-2',
        dependsOnChangeSetId: 'cs-1',
        operations: [{ op: 'replace_block', blockId: 'A', block: { html: 'A, second pass' } }],
        operationTargets: [{ blockId: 'A', fingerprint: 'a-1', headFingerprint: 'a-0' }],
      });
      listPendingChangeSets.mockResolvedValue([second]);
      getChangeSet.mockRejectedValue(new Error('offline'));
      mountLive({ blocks: [para('A'), para('B')] });
      await settle();

      // The safe reading: it can be rejected, not applied.
      expect(review().ready(rewriteOf('A'))).toBe(false);
    });
  });
});

describe('rejecting one paragraph of a suggested section', () => {
  it('keeps the paragraphs after it, in order, instead of rejecting them too', async () => {
    const live = { blocks: [para('A'), para('B')] };
    const { rerender } = mountLive(live);
    await receive(proposal([
      { op: 'insert_block_after', referenceId: 'A', block: para('H') },
      { op: 'insert_block_after', referenceId: 'H', block: para('P1') },
      { op: 'insert_block_after', referenceId: 'P1', block: para('P2') },
      { op: 'insert_block_after', referenceId: 'P2', block: para('P3') },
    ]));
    rerender();
    const id = (produces: string) =>
      review().pending.find((change) => change.producesBlockId === produces)!.id;

    act(() => review().reject(id('P1')));
    rerender();
    expect(review().pending.map((change) => change.producesBlockId)).toEqual(['H', 'P2', 'P3']);

    act(() => review().accept(id('H')));
    rerender();
    const next = review().pending.find((change) => change.producesBlockId === 'P2')!;
    expect(review().ready(next)).toBe(true);

    act(() => review().acceptAll());
    rerender();
    expect(live.blocks.map((block) => block.id)).toEqual(['A', 'H', 'P2', 'P3', 'B']);
  });
});

describe('a suggestion for text the author changed since', () => {
  it('is not applied over the edit, and can still be rejected', async () => {
    const live = { blocks: [para('A', 'first'), para('B', 'second')] };
    const { patch, rerender } = mountLive(live);
    await receive(proposal([{ op: 'replace_block', blockId: 'A', block: { html: 'assistant' } }]));
    // The author types into the paragraph after the suggestion arrived.
    live.blocks = [para('A', 'first, edited'), itemAt(live.blocks, 1)];
    rerender();

    const change = itemAt(review().pending, 0);
    expect(review().ready(change)).toBe(false);
    act(() => review().accept(change.id));
    expect(patch).not.toHaveBeenCalled();
    expect(review().pendingCount).toBe(1);
    expect(review().error).toMatch(/changed after the assistant suggested this/);
    expect(live.blocks[0]).toMatchObject({ html: 'first, edited' });

    act(() => review().reject(change.id));
    expect(review().pendingCount).toBe(0);
  });

  it('is left out of Accept all, which says so', async () => {
    const live = { blocks: [para('A', 'first'), para('B', 'second')] };
    const { rerender } = mountLive(live);
    await receive(proposal([
      { op: 'replace_block', blockId: 'A', block: { html: 'assistant A' } },
      { op: 'replace_block', blockId: 'B', block: { html: 'assistant B' } },
    ]));
    live.blocks = [para('A', 'first, edited'), itemAt(live.blocks, 1)];
    rerender();

    act(() => review().acceptAll());
    rerender();
    expect(live.blocks.map((block) => (block as { html: string }).html)).toEqual([
      'first, edited',
      'assistant B',
    ]);
    expect(review().pending.map((change) => change.anchorBlockId)).toEqual(['A']);
    expect(review().error).toMatch(/1 suggestion was not applied because its text changed/);
  });
});

describe('focus after a decision', () => {
  const card = (changeId: string) =>
    document.querySelector<HTMLElement>(`[data-change-id="${changeId}"]`);

  it('moves to the next suggestion down the page, then back into the text', async () => {
    const live = { blocks: [para('A'), para('B'), para('C')] };
    const { rerender } = mountLive(live, { cards: true });
    await receive(proposal([
      { op: 'replace_block', blockId: 'B', block: { html: 'B2' } },
      { op: 'replace_block', blockId: 'A', block: { html: 'A2' } },
      { op: 'replace_block', blockId: 'C', block: { html: 'C2' } },
    ]));
    rerender();
    const [onB, onA, onC] = takeItems(review().pending.map((change) => change.id), 3);
    card(onA)!.focus();

    // Reading order is A, B, C, whatever order they were written in.
    act(() => review().accept(onA));
    rerender();
    await waitFor(() => expect(document.activeElement).toBe(card(onB)));
    expect(review().focusedChangeId).toBe(onB);

    act(() => review().reject(onB));
    rerender();
    await waitFor(() => expect(document.activeElement).toBe(card(onC)));

    // Nothing left: the caret goes back into the paragraph just changed,
    // rather than focus falling to the page body.
    act(() => review().accept(onC));
    rerender();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector('[data-block-id="C"] [contenteditable="true"]'),
      ),
    );
  });

  it('goes to the nearest one above when the last one down the page is decided', async () => {
    const live = { blocks: [para('A'), para('B')] };
    const { rerender } = mountLive(live, { cards: true });
    await receive(proposal([
      { op: 'replace_block', blockId: 'A', block: { html: 'A2' } },
      { op: 'replace_block', blockId: 'B', block: { html: 'B2' } },
    ]));
    rerender();
    const [onA, onB] = takeItems(review().pending.map((change) => change.id), 2);

    act(() => review().reject(onB));
    rerender();
    await waitFor(() => expect(document.activeElement).toBe(card(onA)));
  });

  it('stays on the card when an accept is refused', async () => {
    const live = { blocks: [para('A')] };
    const { rerender } = mountLive(live, { cards: true });
    await receive(proposal([{ op: 'replace_block', blockId: 'A', block: { html: 'A2' } }]));
    live.blocks = [para('A', 'edited')];
    rerender();
    const only = itemAt(review().pending, 0).id;
    card(only)!.focus();

    act(() => review().accept(only));
    rerender();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(document.activeElement).toBe(card(only));
  });
});
