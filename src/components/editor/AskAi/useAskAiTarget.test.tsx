import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import type { Block } from '@/editor/types';

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

const streamAgentChat = vi.fn((..._args: unknown[]) => new Promise(() => {}));
vi.mock('@/services/agentChat', () => ({
  streamAgentChat: (...args: unknown[]) => streamAgentChat(...args),
}));

const { EditorProvider, useEditor } = await import('@/editor');
const { useAskAiTarget } = await import('./useAskAiTarget');
const { AskAiPanel } = await import('./AskAi');
const { openAskAi } = await import('./askAiEvents');

type Hook = { editor: ReturnType<typeof useEditor>; askAi: ReturnType<typeof useAskAiTarget> };
const hookRef = createRef<Hook>();

function Harness() {
  const editor = useEditor();
  const askAi = useAskAiTarget();
  useImperativeHandle(hookRef, () => ({ editor, askAi }), [editor, askAi]);
  return askAi.target ? <AskAiPanel key={askAi.target.key} target={askAi.target} onClose={askAi.close} /> : null;
}

function hook(): Hook {
  if (!hookRef.current) throw new Error('not mounted');
  return hookRef.current;
}

async function mount(blocks: Block[]) {
  localStorage.setItem('colwrite:doc:local', JSON.stringify({ documentId: null, doc: { version: 1, blocks } }));
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
  streamAgentChat.mockClear();
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

    await waitFor(() => expect(streamAgentChat).toHaveBeenCalled());
    const { message } = streamAgentChat.mock.calls[0][0] as { message: string };
    expect(message).toContain('Fix these problems in the figure spec');
    expect(message).toMatch(/- line 3:\d+ — Edge "a -> bb": No node or group "bb"\. Did you mean "b"\?/);
  });
});
