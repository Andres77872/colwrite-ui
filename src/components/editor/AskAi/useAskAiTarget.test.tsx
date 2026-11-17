import { itemAt } from '@/lib/itemAt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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
    const { message, preset, context } = itemAt(runAgentTurn.mock.calls, 0)[0] as {
      message: string; preset: string; context: { figure_problems: string[] };
    };
    expect(message).toBe('');
    expect(preset).toBe('figure-fix');
    expect(context.figure_problems).toEqual(expect.arrayContaining([
      expect.stringMatching(/line 3:\d+ — Edge "a -> bb": No node or group "bb"\. Did you mean "b"\?/),
    ]));
  });
});

describe('what an Ask AI request carries (P0.UI-1)', () => {
  const SECRET = 'Unpublished result: the trial failed.';
  const hiddenNote: Block = { id: 'secret', type: 'paragraph', html: SECRET, children: [], columns: 1, aiHidden: true };
  const intro: Block = { id: 'intro', type: 'paragraph', html: 'The visible introduction.', children: [], columns: 1 };
  const blank: Block = { id: 'blank', type: 'paragraph', html: '', children: [], columns: 1 };
  type Params = { message: string; context?: Record<string, unknown>; mode?: string };
  const sent = () => itemAt(runAgentTurn.mock.calls, 0)[0] as Params;

  it('sends none of a hidden block’s text, on a page that has one', async () => {
    await mount([intro, hiddenNote, blank]);
    act(() => openAskAi({ blockId: 'blank', actionId: 'continue' }));

    await waitFor(() => expect(runAgentTurn).toHaveBeenCalled());
    const request = JSON.stringify(sent());
    expect(request).not.toContain(SECRET);
    expect(request).not.toContain('trial failed');
    // The empty line's neighbours go as ids; the hidden one not even that.
    expect(sent().context).toEqual({ block_id: 'blank', block_ids: ['intro'] });
    // Nor is the visible text pasted: the server reads the page itself.
    expect(sent().message).not.toContain('The visible introduction.');
  });

  it('sends a block as its id in `context`, not as text in the message', async () => {
    await mount([intro, hiddenNote]);
    act(() => openAskAi({ blockId: 'intro', actionId: 'shorter' }));

    await waitFor(() => expect(runAgentTurn).toHaveBeenCalled());
    // A server preset: its id, no words, and the target in `context`.
    expect(sent()).toMatchObject({ profile: 'inline', preset: 'shorter', message: '', context: { block_id: 'intro', block_ids: ['intro'] } });
    expect(JSON.stringify(sent())).not.toContain(SECRET);
  });

  it('sends a selection as `context.selection`, never in the message', async () => {
    await mount([intro]);
    // The canvas would render the block's editable; here it is put in by hand.
    const el = document.createElement('div');
    el.textContent = 'The visible introduction.';
    document.body.append(el);
    act(() => hook().editor.registerEditable('intro', el as HTMLDivElement));
    const text = el.firstChild ?? el;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 11);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    act(() => openAskAi({ blockId: 'intro', actionId: 'improve' }));

    await waitFor(() => expect(runAgentTurn).toHaveBeenCalled());
    expect(sent().context).toEqual({ block_id: 'intro', selection: { block_id: 'intro', text: 'visible' } });
    expect(sent().message).not.toContain('visible');
    el.remove();
  });

  it('refuses a hidden block as its target, says why, and sends nothing', async () => {
    await mount([intro, hiddenNote]);
    act(() => openAskAi({ blockId: 'secret', actionId: 'shorter' }));

    expect(hook().askAi.target).toMatchObject({ blockIds: ['secret'], hidden: true });
    expect(screen.getByRole('alert').textContent).toBe(
      'This block is hidden from the assistant. Show it to the assistant to ask AI about it.',
    );
    expect(screen.queryByRole('combobox', { name: 'Ask AI' })).toBeNull();
    await act(async () => {});
    expect(runAgentTurn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }));
    expect(hook().askAi.target).toBeNull();
  });

  it('refuses a block selection that holds a hidden block', async () => {
    await mount([intro, hiddenNote]);
    act(() => hook().editor.selectBlocks(['intro', 'secret']));
    act(() => openAskAi({ blockId: 'intro', actionId: 'shorter' }));

    expect(screen.getByRole('alert').textContent).toContain('One of these blocks is hidden from the assistant');
    await act(async () => {});
    expect(runAgentTurn).not.toHaveBeenCalled();
  });
});
