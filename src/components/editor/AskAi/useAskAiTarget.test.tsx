import { itemAt } from '@/lib/itemAt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { act, cleanup, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { createRef, useImperativeHandle } from 'react';
import type { Block } from '@/editor/types';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

vi.mock('@/data/documents', async () => ({
  ...(await vi.importActual<typeof import('@/data/documents')>('@/data/documents')),
  createDocument: vi.fn(async () => ({ id: 'created-doc', doc: { blocks: [], name: 'Doc' }, etag: 'cw:1', updatedAt: null, placement: { documentId: 'created-doc', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
  saveDocument: vi.fn(async () => ({ etag: 'cw:2', updatedAt: null })),
  getDocument: vi.fn(async () => ({ doc: { blocks: [], name: 'Doc' }, etag: 'cw:1', updatedAt: null, placement: { documentId: 'doc', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
  deleteDocument: vi.fn(async () => {}),
}));

// The first-run probe reads the server's page list: there is none yet.
beforeEach(() => {
  mockDocumentList();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const runAgentTurn = vi.fn((..._args: unknown[]) => new Promise(() => {}));
vi.mock('@/api/assistant/agentChat', () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurn(...args),
}));

const { EditorProvider } = await import('@/editor');
const { useEditorProbe } = await import('@/editor/__tests__/editorHarness');
const { useAskAiTarget } = await import('./useAskAiTarget');
const { AskAiPanel } = await import('./AskAi');
const { openAskAi } = await import('./askAiEvents');

type Hook = { editor: ReturnType<typeof useEditorProbe>; askAi: ReturnType<typeof useAskAiTarget> };
const hookRef = createRef<Hook>();

function Harness() {
  const editor = useEditorProbe();
  const askAi = useAskAiTarget();
  useImperativeHandle(hookRef, () => ({ editor, askAi }), [editor, askAi]);
  return askAi.target ? <AskAiPanel key={askAi.target.key} target={askAi.target} onClose={askAi.close} /> : null;
}

function hook(): Hook {
  if (!hookRef.current) throw new Error('not mounted');
  return hookRef.current;
}

async function mount(blocks: Block[]) {
  localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:doc:local`, JSON.stringify({ documentId: null, doc: { version: 1, blocks } }));
  render(
    <EditorProvider>
      <Harness />
    </EditorProvider>,
  );
  await waitFor(() => expect(hook().editor.blocks.map((block) => block.id)).toEqual(blocks.map((block) => block.id)));
}

// An edge to a misspelt node: the compiler drops it with a "did you mean".
const FIGURE_SOURCE = '{\n  "nodes": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],\n  "edges": ["a -> bb"]\n}';
const figure: Block = { id: 'fig', type: 'code', language: 'figure', text: FIGURE_SOURCE };
const para: Block = { id: 'p', type: 'paragraph', html: 'Some text.', children: [], columns: 1 };

beforeEach(() => {
  localStorage.clear();
  runAgentTurn.mockClear();
});
afterEach(cleanup);

describe('useAskAiTarget', () => {
  it('treats one block-selected figure as the figure, with the figure presets', async () => {
    await mount([para, figure]);
    // Esc in the figure source selects the block; Mod+J then opens Ask AI on it.
    act(() => hook().editor.selectBlocks(['fig']));
    act(() => openAskAi({ blockId: 'fig' }));

    expect(hook().askAi.target).toMatchObject({ kind: 'block', blockIds: ['fig'], figure: true });
    expect(hook().askAi.target?.diffBase).toMatchObject({ id: 'fig', type: 'code' });
    expect(hook().editor.selectedBlockIds).toEqual([]);
  });

  it('keeps several selected blocks as a block selection', async () => {
    await mount([para, figure]);
    act(() => hook().editor.selectBlocks(['p', 'fig']));
    act(() => openAskAi({ blockId: 'fig' }));

    expect(hook().askAi.target).toMatchObject({ kind: 'blocks', blockIds: ['p', 'fig'] });
    expect(hook().askAi.target?.figure).toBeFalsy();
  });

  it('sends the compiler’s problems with "Fix problems" on a figure', async () => {
    await mount([para, figure]);
    act(() => hook().editor.selectBlocks(['fig']));
    act(() => openAskAi({ blockId: 'fig', actionId: 'figure-fix' }));

    await waitFor(() => expect(runAgentTurn).toHaveBeenCalled());
    const { message } = itemAt(runAgentTurn.mock.calls, 0)[0] as { message: string };
    expect(message).toContain('Fix these problems in the figure spec');
    expect(message).toMatch(/- line 3:\d+ — Edge "a -> bb": No node or group "bb"\. Did you mean "b"\?/);
  });
});
