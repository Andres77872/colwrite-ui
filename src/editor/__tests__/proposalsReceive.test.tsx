import { createRef, useImperativeHandle } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProposalsProvider } from '../ProposalsContext';
import { EditorContext, type EditorContextValue } from '../editorContextState';
import { useProposals, type ProposalsContextValue } from '../proposalsContextState';
import { pendingInDocumentOrder } from '../proposals';
import { applyPatchToBlocks } from '../docOps';
import type { Block, ToolAction } from '../types';

/**
 * What the review layer accepts from the wire, and what it tells the caller it
 * did with it. The chat transcript prints those numbers, so a wrong one is a
 * reply describing edits the document does not have.
 */

const getChangeSet = vi.fn();
const acceptChangeSet = vi.fn();
const rejectChangeSet = vi.fn();

vi.mock('../../services', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../services')),
  getChangeSet: (...args: unknown[]) => getChangeSet(...(args as [])),
  acceptChangeSet: (...args: unknown[]) => acceptChangeSet(...(args as [])),
  rejectChangeSet: (...args: unknown[]) => rejectChangeSet(...(args as [])),
}));

const captureRef = createRef<ProposalsContextValue>();

const blocks: Block[] = [
  { id: 'A', type: 'paragraph', html: 'first', children: [], columns: 1 },
  { id: 'B', type: 'paragraph', html: 'second', children: [], columns: 1 },
];

const applyPatch = vi.fn(() => ({ blocks, desynced: [], touched: [] }));
const adoptServerVersion = vi.fn();
const adoptRestoredDocument = vi.fn();
const markRecentlyChanged = vi.fn();

function Capture() {
  const review = useProposals();
  useImperativeHandle(captureRef, () => review, [review]);
  return null;
}

function mount(documentId: string | null = 'doc-1') {
  const value = {
    documentId,
    blocks,
    applyPatch,
    adoptServerVersion,
    adoptRestoredDocument,
    markRecentlyChanged,
  } as unknown as EditorContextValue;

  return render(
    <EditorContext.Provider value={value}>
      <ProposalsProvider>
        <Capture />
      </ProposalsProvider>
    </EditorContext.Provider>,
  );
}

function review(): ProposalsContextValue {
  if (!captureRef.current) throw new Error('not mounted');
  return captureRef.current;
}

function action(overrides: Partial<ToolAction> = {}): ToolAction {
  return {
    tool: 'doc_edit',
    toolCallId: 'call_1',
    documentId: 'doc-1',
    version: 2,
    status: 'proposed',
    actions: [{ op: 'append_block', block: { id: 'X', type: 'divider' } }],
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('receive', () => {
  it('stages a proposed batch and reports its change ids', () => {
    mount();
    let result!: ReturnType<ProposalsContextValue['receive']>;
    act(() => {
      result = review().receive(action());
    });

    expect(result.changes).toBe(1);
    expect(result.changeIds).toHaveLength(1);
    expect(result.applied).toBe(0);
    expect(review().pendingCount).toBe(1);
    expect(result.changeIds[0]).toBe(review().pending[0].id);
  });

  it('reports nothing for a redelivered batch', () => {
    mount();
    act(() => {
      review().receive(action());
    });

    let repeat!: ReturnType<ProposalsContextValue['receive']>;
    act(() => {
      repeat = review().receive(action());
    });

    // The batch is correctly ignored. Reporting it as new anyway made the
    // reply claim a second set of changes that were never there.
    expect(repeat.changes).toBe(0);
    expect(repeat.changeIds).toEqual([]);
    expect(review().pendingCount).toBe(1);
  });

  it('does not offer a failed batch for acceptance', () => {
    mount();
    act(() => {
      review().receive(action({ status: 'error', message: 'The tool failed' }));
    });

    expect(review().pendingCount).toBe(0);
    expect(review().error).toBe('The tool failed');
  });

  it('does not offer a skipped batch for acceptance', () => {
    mount();
    act(() => {
      review().receive(action({ status: 'skipped' }));
    });
    expect(review().pendingCount).toBe(0);
  });

  it('accepts a batch that names no document as belonging to this one', () => {
    // The request was addressed to this document; a payload that omits the id
    // is answering it. Requiring an exact match dropped it silently.
    mount();
    act(() => {
      review().receive(action({ documentId: '' }));
    });
    expect(review().pendingCount).toBe(1);
  });

  it('still refuses a batch belonging to a different document', () => {
    mount();
    act(() => {
      review().receive(action({ documentId: 'doc-other' }));
    });
    expect(review().pendingCount).toBe(0);
  });

  it('reports an auto-applied batch so the reply can mention it', () => {
    mount();
    let result!: ReturnType<ProposalsContextValue['receive']>;
    act(() => {
      result = review().receive(action({ status: 'applied' }));
    });

    expect(result.applied).toBe(1);
    expect(result.changes).toBe(0);
    expect(review().pendingCount).toBe(0);
    expect(applyPatch).toHaveBeenCalled();
  });
});

describe('reject', () => {
  it('clears a change that could never be applied', () => {
    mount();
    act(() => {
      review().receive(
        action({
          actions: [{ op: 'replace_block', blockId: 'gone', block: { html: 'x' } }],
        }),
      );
    });
    expect(review().pendingCount).toBe(1);

    act(() => review().reject(review().pending[0].id));
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
    const patch = vi.fn((ops: Parameters<EditorContextValue['applyPatch']>[0]) => {
      const outcome = applyPatchToBlocks(live.blocks, ops);
      live.blocks = outcome.blocks;
      return outcome;
    });

    function Host() {
      const review = useProposals();
      useImperativeHandle(captureRef, () => review, [review]);
      return null;
    }

    const Tree = () => (
      <EditorContext.Provider
        value={{
          documentId: 'doc-1',
          // Read on every render, so each accept positions itself against the
          // document the previous one produced.
          get blocks() {
            return live.blocks;
          },
          applyPatch: patch,
          adoptServerVersion,
          markRecentlyChanged,
        } as unknown as EditorContextValue}
      >
        <ProposalsProvider>
          <Host />
        </ProposalsProvider>
      </EditorContext.Provider>
    );

    const view = render(<Tree />);
    return { live, rerender: () => view.rerender(<Tree />) };
  }

  const appendBatch = (callId: string, blockId: string): ToolAction =>
    action({
      toolCallId: callId,
      actions: [{ op: 'append_block', block: { id: blockId, type: 'divider' } }],
    });

  it.each([
    ['in the order they arrived', [0, 1]],
    ['in the reverse order', [1, 0]],
  ])('puts one-operation batches in authoring order, accepted %s', (_name, clicks) => {
    const { live, rerender } = mountStateful([{ id: 'A', type: 'divider' }]);

    act(() => {
      review().receive(appendBatch('call_1', 'X'));
      review().receive(appendBatch('call_2', 'Y'));
    });
    rerender();

    const staged = review().pending.map((change) => change.id);
    expect(staged).toHaveLength(2);

    for (const index of clicks as number[]) {
      act(() => review().accept(staged[index]));
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
  it('walks the page rather than the order batches arrived in', () => {
    mount();
    act(() => {
      // Authored against the end of the document, then the start.
      review().receive(
        action({
          toolCallId: 'call_late',
          actions: [
            { op: 'replace_block', blockId: 'B', block: { html: 'later' } },
            { op: 'replace_block', blockId: 'A', block: { html: 'earlier' } },
          ],
        }),
      );
    });

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
    action({
      actions: [],
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
    baseHeadSeq: 2,
    baseEtag: 'cw:2',
    toolCallId: 'call_1',
    summary: null,
    expiresAt: null,
    ...over,
  });

  it('fetches the redacted batch by id and stages it for review', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    mount();

    let result!: ReturnType<ProposalsContextValue['receive']>;
    act(() => {
      result = review().receive(durableAction());
    });

    // Reported synchronously from the server-counted preview.
    expect(result.changes).toBe(3);
    expect(result.applied).toBe(0);

    await act(async () => {});
    expect(getChangeSet).toHaveBeenCalledWith('doc-1', 'cs-1');
    expect(review().pendingCount).toBe(2);
    expect(review().sets[0].changeSetId).toBe('cs-1');
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

  it('accepts one specific change locally, like any other batch', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});
    const changeId = review().pending[0].id;
    await act(async () => {
      review().accept(changeId);
    });

    // Per-change review is local: the operation lands in the editor and the
    // sibling stays pending. Nothing is decided wholesale on the server.
    expect(applyPatch).toHaveBeenCalledTimes(1);
    expect(acceptChangeSet).not.toHaveBeenCalled();
    expect(rejectChangeSet).not.toHaveBeenCalled();
    expect(review().pendingCount).toBe(1);
  });

  it('retires the server record once every change is decided', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    rejectChangeSet.mockResolvedValue(fetchedSet({ status: 'rejected' }));
    mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});
    await act(async () => {
      review().accept(review().pending[0].id);
    });
    expect(rejectChangeSet).not.toHaveBeenCalled();
    await act(async () => {
      review().reject(review().pending[0].id);
    });

    // Accepted ops were applied as author edits, so the stored change set is
    // superseded — cleared so it neither re-stages on reload nor blocks the
    // agent's next proposal.
    expect(rejectChangeSet).toHaveBeenCalledWith(
      'doc-1',
      'cs-1',
      expect.stringMatching(/Decided per change/),
    );
    expect(review().pendingCount).toBe(0);
  });

  it('rejecting everything rejects the server record as such', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    rejectChangeSet.mockResolvedValue(fetchedSet({ status: 'rejected' }));
    mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});
    await act(async () => {
      review().rejectAll();
    });

    expect(applyPatch).not.toHaveBeenCalled();
    expect(rejectChangeSet).toHaveBeenCalledWith(
      'doc-1',
      'cs-1',
      'Rejected in the editor',
    );
    expect(review().pendingCount).toBe(0);
  });

  it('accept-all applies locally and retires the record', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    rejectChangeSet.mockResolvedValue(fetchedSet({ status: 'rejected' }));
    mount();

    act(() => void review().receive(durableAction()));
    await act(async () => {});
    await act(async () => {
      review().acceptAll();
    });

    expect(applyPatch).toHaveBeenCalled();
    expect(acceptChangeSet).not.toHaveBeenCalled();
    expect(rejectChangeSet).toHaveBeenCalledWith(
      'doc-1',
      'cs-1',
      expect.stringMatching(/Decided per change/),
    );
    expect(review().pendingCount).toBe(0);
  });

  it('a failed record cleanup never blocks the author', async () => {
    getChangeSet.mockResolvedValue(fetchedSet());
    rejectChangeSet.mockRejectedValue(new Error('offline'));
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
});
