import { createRef, useImperativeHandle } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemAt } from '@/lib/itemAt';
import { ProposalsProvider } from '../ProposalsContext';
import { FakeEditorProviders, type EditorProbe } from './editorHarness';
import { useProposals, type ProposalsContextValue } from '../proposalsContextState';
import { applyOperations } from '../docOps';
import type { Block, Doc, ToolAction, ToolOperation } from '../types';

/**
 * Auto mode in the review layer (D18, 11 §5): a set the server stored as
 * `apply_policy: "auto"` is applied by the editor at once, as one undo step,
 * through the accept path, with its decisions sent as `origin: "auto"`.
 * Anything else waits for the author.
 */

const getChangeSet = vi.fn();
const listPendingChangeSets = vi.fn();
const decideChangeSetOperations = vi.fn();

vi.mock('@/data/documentHistory', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/data/documentHistory')),
  getChangeSet: (_workspaceId: unknown, ...args: unknown[]) => getChangeSet(...(args as [])),
  listPendingChangeSets: (_workspaceId: unknown, ...args: unknown[]) => listPendingChangeSets(...(args as [])),
  decideChangeSetOperations: (_workspaceId: unknown, ...args: unknown[]) => decideChangeSetOperations(...(args as [])),
  rejectChangeSet: vi.fn(),
}));

const para = (id: string, html = id, extra: Partial<Block> = {}): Block =>
  ({ id, type: 'paragraph', html, children: [], columns: 1, ...extra }) as Block;

const captureRef = createRef<ProposalsContextValue>();
function review(): ProposalsContextValue {
  if (!captureRef.current) throw new Error('not mounted');
  return captureRef.current;
}

/**
 * The editor, reduced to what the review layer drives: a page, `applyPatch`,
 * and an undo journal that takes one entry per edit and one per `batch`, as
 * `EditorContext` does.
 */
function mountEditor(blocks: Block[], { activeId = null }: { activeId?: string | null } = {}) {
  const live = {
    doc: { version: 1, name: 'Page', blocks } as Doc,
    journal: [] as Doc[],
    activeId,
  };
  let batching = false;
  const commit = (next: Doc) => {
    if (!batching) live.journal.push(live.doc);
    live.doc = next;
  };
  const applyPatch = vi.fn((ops: ToolOperation[], options?: { persist?: boolean; base?: Block[] }) => {
    if (options?.base !== undefined && options.base !== live.doc.blocks) {
      return { blocks: live.doc.blocks, doc: live.doc, desynced: ops, touched: [], stale: true };
    }
    // As `EditorContext` does: the blocks, then the page's name, style and library.
    const outcome = applyOperations(live.doc, ops);
    commit(outcome.doc);
    return outcome;
  });
  const batch = vi.fn(<T,>(run: () => T): T => {
    if (batching) return run();
    const before = live.doc;
    batching = true;
    try {
      return run();
    } finally {
      batching = false;
      if (live.doc !== before) live.journal.push(before);
    }
  });
  const undo = vi.fn(() => {
    const previous = live.journal.pop();
    if (previous) live.doc = previous;
  });
  /** The author edits a block, as typing does: an edit of its own. */
  const type = (id: string, html: string) => {
    commit({ ...live.doc, blocks: live.doc.blocks.map((block) => (block.id === id ? { ...block, html } : block)) });
  };

  function Capture() {
    const value = useProposals();
    useImperativeHandle(captureRef, () => value, [value]);
    return null;
  }
  const Tree = () => {
    const value = {
      documentId: 'doc-1',
      get doc() { return live.doc; },
      get blocks() { return live.doc.blocks; },
      get activeId() { return live.activeId; },
      applyPatch,
      batch,
      undo,
      markRecentlyChanged: vi.fn(),
      restoreEpoch: 0,
    } as unknown as EditorProbe;
    return (
      <FakeEditorProviders value={value}>
        <ProposalsProvider>
          <Capture />
        </ProposalsProvider>
      </FakeEditorProviders>
    );
  };
  const view = render(<Tree />);
  return {
    live,
    applyPatch,
    batch,
    undo,
    type: (id: string, html: string) => { type(id, html); view.rerender(<Tree />); },
    rerender: () => view.rerender(<Tree />),
  };
}

const stored = (over: Record<string, unknown> = {}) => ({
  changeSetId: 'cs-1',
  documentId: 'doc-1',
  status: 'pending',
  operations: [
    { op: 'write_blocks', position: 'replace', blockId: 'A', blocks: [para('A', 'A, rewritten')] },
    { op: 'write_blocks', position: 'append', blockId: null, blocks: [para('N1', 'new')] },
  ] as ToolOperation[],
  unmappableOperations: [] as string[],
  baseEtag: 'cw:1',
  toolCallId: 'call_1',
  summary: null,
  expiresAt: '2026-11-20T00:00:00Z',
  proposedAt: '2026-11-14T10:00:00Z',
  dependsOnChangeSetId: null,
  applyPolicy: 'auto',
  autoBlockedReason: null,
  operationDecisions: [],
  operationTargets: null,
  groups: [],
  ...over,
});

const announced = (over: Partial<ToolAction> = {}): ToolAction => ({
  tool: 'doc_edit',
  toolCallId: 'call_1',
  documentId: 'doc-1',
  status: 'proposed',
  actions: [],
  changeSetId: 'cs-1',
  proposalOperationCount: 2,
  applyPolicy: 'auto',
  ...over,
});

const settle = () => act(async () => {});
const sent = () => decideChangeSetOperations.mock.calls.map((call) => [call[2], call[3]]);
const ids = (editor: { live: { doc: Doc } }) =>
  editor.live.doc.blocks.map((block) => `${block.id}:${'html' in block ? block.html : ''}`);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listPendingChangeSets.mockResolvedValue([]);
  decideChangeSetOperations.mockResolvedValue({});
});
afterEach(() => cleanup());

describe('an Auto set that arrives while Auto is on', () => {
  it('is applied at once, as one undo step, and its decisions say so', async () => {
    getChangeSet.mockResolvedValue(stored());
    const editor = mountEditor([para('A'), para('B')]);

    act(() => void review().receive(announced(), { autoApply: () => true }));
    await settle();
    editor.rerender();

    expect(ids(editor)).toEqual(['A:A, rewritten', 'B:B', 'N1:new']);
    expect(review().pendingCount).toBe(0);
    // One batch, one journal entry, for both operations.
    expect(editor.batch).toHaveBeenCalledOnce();
    expect(editor.live.journal).toHaveLength(1);
    expect(sent()).toEqual([[[{ opIndex: 0, decision: 'accepted' }, { opIndex: 1, decision: 'accepted' }], 'auto']]);
    expect(review().autoApplied).toEqual([
      expect.objectContaining({ changeSetId: 'cs-1', applied: 2, heldIds: [], canUndo: true, undone: false }),
    ]);

    // Undo takes the whole set back in one step.
    const applied = editor.live.doc;
    act(() => void review().undoAutoApplied(itemAt(review().autoApplied, 0).id));
    editor.rerender();
    expect(editor.undo).toHaveBeenCalledOnce();
    expect(ids(editor)).toEqual(['A:A', 'B:B']);
    expect(itemAt(review().autoApplied, 0)).toMatchObject({ undone: true, canUndo: false });

    // Redone in the editor: the line says so again.
    editor.live.doc = applied;
    editor.rerender();
    expect(itemAt(review().autoApplied, 0)).toMatchObject({ undone: false, canUndo: true });
  });

  it('leaves a stale operation, the block with the caret and a locked block for review', async () => {
    getChangeSet.mockResolvedValue(stored({
      operations: [
        { op: 'write_blocks', position: 'replace', blockId: 'A', blocks: [para('A', 'A, rewritten')] },
        { op: 'write_blocks', position: 'replace', blockId: 'B', blocks: [para('B', 'B, rewritten')] },
        { op: 'write_blocks', position: 'replace', blockId: 'C', blocks: [para('C', 'C, rewritten')] },
        { op: 'write_blocks', position: 'append', blockId: null, blocks: [para('N1', 'new')] },
      ],
      // The saved A is not the A the assistant read.
      operationTargets: [
        [{ blockId: 'A', fingerprint: 'a-0', headFingerprint: 'a-edited' }],
        [{ blockId: 'B', fingerprint: 'b-0', headFingerprint: 'b-0' }],
        [{ blockId: 'C', fingerprint: 'c-0', headFingerprint: 'c-0' }],
        [],
      ],
    }));
    const editor = mountEditor([para('A'), para('B'), para('C', 'C', { locked: true })], { activeId: 'B' });

    act(() => void review().receive(announced(), { autoApply: () => true }));
    await settle();
    editor.rerender();

    expect(ids(editor)).toEqual(['A:A', 'B:B', 'C:C', 'N1:new']);
    expect(review().pending.map((change) => change.anchorBlockId)).toEqual(['A', 'B', 'C']);
    expect(sent()).toEqual([[[{ opIndex: 3, decision: 'accepted' }], 'auto']]);
    expect(itemAt(review().autoApplied, 0)).toMatchObject({ applied: 1 });
    expect(itemAt(review().autoApplied, 0).heldIds).toHaveLength(3);
  });

  it('cannot be undone from the chat once the author has edited since', async () => {
    getChangeSet.mockResolvedValue(stored());
    const editor = mountEditor([para('A'), para('B')]);
    act(() => void review().receive(announced(), { autoApply: () => true }));
    await settle();
    editor.rerender();

    editor.type('B', 'B, typed');
    expect(itemAt(review().autoApplied, 0).canUndo).toBe(false);
    let undone = true;
    act(() => { undone = review().undoAutoApplied(itemAt(review().autoApplied, 0).id); });
    expect(undone).toBe(false);
    expect(editor.undo).not.toHaveBeenCalled();
  });
});

describe('a change Auto held because the caret was in its block', () => {
  const holding = () => stored({
    operations: [
      { op: 'write_blocks', position: 'replace', blockId: 'A', blocks: [para('A', 'A, rewritten')] },
      { op: 'write_blocks', position: 'replace', blockId: 'B', blocks: [para('B', 'B, rewritten')] },
      { op: 'write_blocks', position: 'append', blockId: null, blocks: [para('N1', 'new')] },
    ],
  });
  const announcedHolding = () => announced({ proposalOperationCount: 3 });

  it('is applied once the caret leaves the block, as a step of its own, while Auto is on', async () => {
    getChangeSet.mockResolvedValue(holding());
    const editor = mountEditor([para('A'), para('B')], { activeId: 'B' });

    act(() => void review().receive(announcedHolding(), { autoApply: () => true }));
    await settle();
    editor.rerender();

    expect(ids(editor)).toEqual(['A:A, rewritten', 'B:B', 'N1:new']);
    expect(review().pending.map((change) => change.anchorBlockId)).toEqual(['B']);
    expect(itemAt(review().autoApplied, 0)).toMatchObject({ applied: 2 });
    expect(itemAt(review().autoApplied, 0).heldIds).toHaveLength(1);

    // The caret moves on to another paragraph.
    editor.live.activeId = 'A';
    editor.rerender();
    await settle();
    editor.rerender();

    expect(ids(editor)).toEqual(['A:A, rewritten', 'B:B, rewritten', 'N1:new']);
    expect(review().pendingCount).toBe(0);
    // One batch per application, each its own undo step.
    expect(editor.batch).toHaveBeenCalledTimes(2);
    expect(editor.live.journal).toHaveLength(2);
    expect(sent()).toEqual([
      [[{ opIndex: 0, decision: 'accepted' }, { opIndex: 2, decision: 'accepted' }], 'auto'],
      [[{ opIndex: 1, decision: 'accepted' }], 'auto'],
    ]);
    // The chat lists both steps; only the newest can be undone from there,
    // and nothing is left for the author.
    expect(review().autoApplied).toEqual([
      expect.objectContaining({ changeSetId: 'cs-1', applied: 2, heldIds: [], canUndo: false }),
      expect.objectContaining({ changeSetId: 'cs-1', applied: 1, heldIds: [], canUndo: true }),
    ]);
    act(() => void review().undoAutoApplied(itemAt(review().autoApplied, 1).id));
    editor.rerender();
    expect(ids(editor)).toEqual(['A:A, rewritten', 'B:B', 'N1:new']);
  });

  it('stays in review when Auto was turned off before the caret left', async () => {
    getChangeSet.mockResolvedValue(holding());
    let auto = true;
    const editor = mountEditor([para('A'), para('B')], { activeId: 'B' });
    act(() => void review().receive(announcedHolding(), { autoApply: () => auto }));
    await settle();
    editor.rerender();

    auto = false;
    editor.live.activeId = null;
    editor.rerender();
    await settle();
    editor.rerender();

    expect(ids(editor)).toEqual(['A:A, rewritten', 'B:B', 'N1:new']);
    expect(review().pending.map((change) => change.anchorBlockId)).toEqual(['B']);
    expect(editor.batch).toHaveBeenCalledOnce();
    expect(decideChangeSetOperations).toHaveBeenCalledOnce();

    // Turning Auto on again later does not reach it: it is the author's now.
    auto = true;
    editor.live.activeId = 'B';
    editor.rerender();
    editor.live.activeId = null;
    editor.rerender();
    await settle();
    expect(editor.batch).toHaveBeenCalledOnce();
  });

  it('stays in review when the author changed the block before leaving it', async () => {
    getChangeSet.mockResolvedValue(holding());
    const editor = mountEditor([para('A'), para('B')], { activeId: 'B' });
    act(() => void review().receive(announcedHolding(), { autoApply: () => true }));
    await settle();
    editor.rerender();

    editor.type('B', 'B, typed');
    editor.live.activeId = null;
    editor.rerender();
    await settle();
    editor.rerender();

    expect(ids(editor)).toEqual(['A:A, rewritten', 'B:B, typed', 'N1:new']);
    expect(review().pending.map((change) => change.anchorBlockId)).toEqual(['B']);
    expect(decideChangeSetOperations).toHaveBeenCalledOnce();
  });
});

describe('what Auto never applies', () => {
  it('a set the server stored for review, whatever the switch says', async () => {
    getChangeSet.mockResolvedValue(stored({ applyPolicy: 'review', autoBlockedReason: 'policy' }));
    const editor = mountEditor([para('A'), para('B')]);

    act(() => void review().receive(announced({ applyPolicy: 'review', autoBlockedReason: 'policy' }), { autoApply: () => true }));
    await settle();
    editor.rerender();

    expect(editor.applyPatch).not.toHaveBeenCalled();
    expect(review().pendingCount).toBe(2);
    expect(review().waiting).toEqual([]);
    expect(review().autoApplied).toEqual([]);
    expect(decideChangeSetOperations).not.toHaveBeenCalled();
  });

  it('an Auto set that arrives after Auto was turned off: it waits', async () => {
    getChangeSet.mockResolvedValue(stored());
    let auto = true;
    const editor = mountEditor([para('A'), para('B')]);

    act(() => void review().receive(announced(), { autoApply: () => auto }));
    // Turned off while the set was being read.
    auto = false;
    await settle();
    editor.rerender();

    expect(editor.applyPatch).not.toHaveBeenCalled();
    expect(review().waiting).toHaveLength(2);
  });
});

describe('Auto sets found on opening the page', () => {
  it('are not applied: they wait under the note, and Apply all is one undo step', async () => {
    listPendingChangeSets.mockResolvedValue([stored()]);
    const editor = mountEditor([para('A'), para('B')]);
    await settle();
    editor.rerender();

    expect(editor.applyPatch).not.toHaveBeenCalled();
    expect(review().waiting).toHaveLength(2);
    expect(review().pendingCount).toBe(2);

    await act(async () => review().applyWaiting());
    editor.rerender();

    expect(ids(editor)).toEqual(['A:A, rewritten', 'B:B', 'N1:new']);
    expect(editor.batch).toHaveBeenCalledOnce();
    expect(editor.live.journal).toHaveLength(1);
    expect(review().waiting).toEqual([]);
    // The author pressed Apply all: their own decision.
    expect(sent()).toEqual([[[{ opIndex: 0, decision: 'accepted' }, { opIndex: 1, decision: 'accepted' }], 'manual']]);
  });
});

describe('stored intent groups and manual bulk decisions', () => {
  it('accepts only unflagged wording, batches undo, and records exactly those operation indexes', async () => {
    const operations: ToolOperation[] = [
      { op: 'write_blocks', position: 'replace', blockId: 'A', blocks: [para('A', 'Clear wording')], newInformation: false },
      { op: 'write_blocks', position: 'replace', blockId: 'B', blocks: [para('B', 'A new claim: 97%')], newInformation: true },
      { op: 'set_meta', name: 'Clear title', newInformation: false },
      { op: 'write_blocks', position: 'append', blockId: null, blocks: [para('N', 'Another section')], newInformation: false },
    ];
    getChangeSet.mockResolvedValue(stored({
      applyPolicy: 'review', operations,
      groups: [
        { kind: 'wording', label: 'Wording', operations: [0, 1, 2] },
        { kind: 'new_content', label: 'New content', operations: [3] },
      ],
    }));
    const editor = mountEditor([para('A'), para('B')]);
    act(() => void review().receive(announced()));
    await settle();
    editor.rerender();
    expect(review().sets[0]?.groups).toEqual([
      { kind: 'wording', label: 'Wording', operations: [0, 1, 2] },
      { kind: 'new_content', label: 'New content', operations: [3] },
    ]);

    await act(async () => review().acceptWording());
    editor.rerender();
    expect(ids(editor)).toEqual(['A:Clear wording', 'B:B']);
    expect(editor.live.doc.name).toBe('Clear title');
    expect(review().pending.map((change) => change.opIndex)).toEqual([1, 3]);
    expect(sent()).toEqual([[[{ opIndex: 0, decision: 'accepted' }, { opIndex: 2, decision: 'accepted' }], 'manual']]);
    expect(editor.batch).toHaveBeenCalledOnce();
    expect(editor.live.journal).toHaveLength(1);
    act(() => editor.undo());
    editor.rerender();
    expect(ids(editor)).toEqual(['A:A', 'B:B']);
    expect(editor.live.doc.name).toBe('Page');
  });

  it('never bulk-accepts new information in Apply waiting or Accept all', async () => {
    const operations: ToolOperation[] = [
      { op: 'write_blocks', position: 'append', blockId: null, blocks: [para('N', 'new')], newInformation: true },
      { op: 'write_blocks', position: 'replace', blockId: 'A', blocks: [para('A', 'reworded')], newInformation: false },
    ];
    listPendingChangeSets.mockResolvedValue([stored({ operations })]);
    const editor = mountEditor([para('A'), para('B')]);
    await settle();
    editor.rerender();
    await act(async () => review().applyWaiting());
    editor.rerender();
    expect(ids(editor)).toEqual(['A:reworded', 'B:B']);
    expect(review().pending.map((change) => change.opIndex)).toEqual([0]);
    expect(sent()).toEqual([[[{ opIndex: 1, decision: 'accepted' }], 'manual']]);
    await act(async () => review().acceptAll());
    expect(sent()).toHaveLength(1);
  });

  it('leaves flagged prerequisites, pending precedence, and locked or stale targets undecided', async () => {
    const operations: ToolOperation[] = [
      { op: 'write_blocks', position: 'append', blockId: null, blocks: [para('N', 'New fact')], newInformation: true },
      { op: 'write_blocks', position: 'replace', blockId: 'N', blocks: [para('N', 'Reworded fact')], newInformation: false },
      { op: 'move_block', blockId: 'B', position: 'before', targetBlockId: 'A', newInformation: true },
      { op: 'write_blocks', position: 'after', blockId: 'A', blocks: [para('X', 'Insert here')], newInformation: false },
      { op: 'write_blocks', position: 'replace', blockId: 'C', blocks: [para('C', 'Locked rewrite')], newInformation: false },
      { op: 'write_blocks', position: 'replace', blockId: 'D', blocks: [para('D', 'Old rewrite')], newInformation: false },
      { op: 'write_blocks', position: 'replace', blockId: 'E', blocks: [para('E', 'Safe rewrite')], newInformation: false },
    ];
    getChangeSet.mockResolvedValue(stored({
      applyPolicy: 'review', operations,
      groups: [{ kind: 'wording', label: 'Wording', operations: [1, 3, 4, 5, 6] }],
    }));
    const editor = mountEditor([para('A'), para('B'), { ...para('C'), locked: true }, para('D'), para('E')]);
    act(() => void review().receive(announced()));
    await settle();
    editor.rerender();
    editor.type('D', 'The author changed this');
    await act(async () => review().acceptWording());
    editor.rerender();
    expect(ids(editor)).toEqual(['A:A', 'B:B', 'C:C', 'D:The author changed this', 'E:Safe rewrite']);
    expect(review().pending.map((change) => change.opIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sent()).toEqual([[[{ opIndex: 6, decision: 'accepted' }], 'manual']]);
  });

  it('accepts a stored group without reclassifying it and rejects another through per-operation decisions', async () => {
    getChangeSet.mockResolvedValue(stored({
      applyPolicy: 'review',
      groups: [
        { kind: 'wording', label: 'Wording', operations: [1] },
        { kind: 'structure', label: 'Structure', operations: [0] },
      ],
    }));
    const editor = mountEditor([para('A'), para('B')]);
    act(() => void review().receive(announced()));
    await settle();
    editor.rerender();
    const setId = review().sets[0]?.id;
    if (!setId) throw new Error('Missing stored set');
    await act(async () => review().acceptGroup(setId, 'wording'));
    editor.rerender();
    expect(ids(editor)).toEqual(['A:A', 'B:B', 'N1:new']);
    await act(async () => review().rejectGroup(setId, 'structure'));
    expect(sent()).toEqual([
      [[{ opIndex: 1, decision: 'accepted' }], 'manual'],
      [[{ opIndex: 0, decision: 'rejected' }], 'manual'],
    ]);
  });
});
