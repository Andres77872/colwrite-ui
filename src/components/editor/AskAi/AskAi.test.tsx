import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { useState } from 'react';
import type { Doc } from '@/editor/types';
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

/** Resolves the current run when the test says so, after one token. */
let finishRun: (() => void) | null = null;
/** The running request's handlers, to drive its progress events. */
let runHandlers: import('@/api/assistant/streamParser').AgentEventHandlers | null = null;
let runSignal: AbortSignal | undefined;
vi.mock('@/api/assistant/agentChat', () => ({
  runAgentTurn: vi.fn(
    (_params: unknown, handlers: import('@/api/assistant/streamParser').AgentEventHandlers, options?: { signal?: AbortSignal }) =>
      new Promise((resolve) => {
        runHandlers = handlers;
        runSignal = options?.signal;
        finishRun = () => {
          handlers.onToken?.('A shorter paragraph.');
          resolve({ terminal: 'done' });
        };
      }),
  ),
}));

const { EditorProvider, useEditorActions } = await import('@/editor');
const { AskAiPanel } = await import('./AskAi');

function PanelHarness({ onClose }: { onClose: () => void }) {
  const { registerEditable } = useEditorActions();
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className="canvas">
        <div
          ref={(element) => registerEditable('p1', element)}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Document text"
        >
          A long paragraph.
        </div>
        {open && (
          <AskAiPanel
            target={{
              key: 't1',
              kind: 'block',
              blockIds: ['p1'],
              anchorId: 'p1',
              markdown: 'A long paragraph.',
              text: 'A long paragraph.',
              locked: false,
              citations: new Map(),
            }}
            onClose={() => {
              setOpen(false);
              onClose();
            }}
          />
        )}
      </div>
      <button type="button">Outside action</button>
    </>
  );
}

function mount() {
  const doc: Doc = {
    name: 'Ask AI test',
    blocks: [{ id: 'p1', type: 'paragraph', html: 'A long paragraph.', children: [], columns: 1 }],
  };
  localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:doc:local`, JSON.stringify({ documentId: 'doc-1', doc }));
  const onClose = vi.fn();
  render(
    <EditorProvider>
      <PanelHarness onClose={onClose} />
    </EditorProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  localStorage.clear();
  finishRun = null;
  runHandlers = null;
  runSignal = undefined;
});

afterEach(cleanup);

describe('Ask AI dismissal', () => {
  it('offers a close button and returns focus to the document without editing it', async () => {
    const { onClose } = mount();
    const paragraph = screen.getByRole('textbox', { name: 'Document text' });

    fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(paragraph));
    expect(paragraph.textContent).toBe('A long paragraph.');
  });

  it.each(['mouse', 'touch'])('dismisses the prompt with an outside %s press without taking focus back', async (pointerType) => {
    const { onClose } = mount();
    const outside = screen.getByRole('button', { name: 'Outside action' });

    fireEvent.pointerDown(outside, { pointerType });
    act(() => outside.focus());
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it('does not steal focus if another control is focused immediately after closing', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }));
    const outside = screen.getByRole('button', { name: 'Outside action' });
    act(() => outside.focus());
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(document.activeElement).toBe(outside);
  });

  it('keeps the prompt open when interacting inside it', () => {
    const { onClose } = mount();
    const field = screen.getByRole('combobox', { name: 'Ask AI' });
    fireEvent.pointerDown(field);
    const tone = screen.getByRole('option', { name: 'Change tone' });
    fireEvent.pointerDown(tone);
    fireEvent.mouseDown(tone);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'Professional' })).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.getByRole('option', { name: 'Change tone' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('leaves Enter on the close button to its native button action', () => {
    mount();
    const close = screen.getByRole('button', { name: 'Close Ask AI' });
    act(() => close.focus());

    expect(fireEvent.keyDown(close, { key: 'Enter' })).toBe(true);
    expect(runSignal).toBeUndefined();
  });

  it('handles Escape after keyboard focus moves back into the document', () => {
    const { onClose } = mount();
    const paragraph = screen.getByRole('textbox', { name: 'Document text' });
    const editorKeyDown = vi.fn();
    paragraph.addEventListener('keydown', editorKeyDown);
    act(() => paragraph.focus());

    fireEvent.keyDown(paragraph, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
    expect(editorKeyDown).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
  });

  it('leaves keys in other controls alone', () => {
    const { onClose } = mount();
    const outside = screen.getByRole('button', { name: 'Outside action' });
    act(() => outside.focus());
    fireEvent.keyDown(outside, { key: 'Escape' });
    fireEvent.keyDown(outside, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps a running reply on outside presses, but lets the close button cancel it', async () => {
    const { onClose } = mount();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Make shorter' }));
    await waitFor(() => expect(runSignal).toBeDefined());

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside action' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(runSignal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }));
    expect(runSignal?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
  });

  it('keeps a completed reply on an outside press until explicitly closed', async () => {
    const { onClose } = mount();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Make shorter' }));
    await waitFor(() => expect(finishRun).not.toBeNull());
    await act(async () => finishRun?.());

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside action' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox', { name: 'Result actions' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Ask AI keyboard focus across a run', () => {
  it('keeps focus in the panel from choosing a preset to acting on the result', async () => {
    mount();
    const field = await screen.findByRole('combobox', { name: 'Ask AI' });
    await waitFor(() => expect(document.activeElement).toBe(field));

    fireEvent.change(field, { target: { value: 'shorter' } });
    const options = screen.getAllByRole('option');
    const index = options.findIndex((option) => /Make shorter/.test(option.textContent ?? ''));
    for (let i = 0; i < index; i += 1) fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });

    // Streaming: the input gives way to Stop, and focus goes with it.
    const stop = await screen.findByRole('button', { name: /Stop/ });
    await waitFor(() => expect(document.activeElement).toBe(stop));

    await act(async () => {
      finishRun?.();
    });

    // The result: focus is back in the follow-up field, on the first action.
    const followUp = await screen.findByRole('combobox', { name: 'Ask AI' });
    await waitFor(() => expect(document.activeElement).toBe(followUp));
    const active = followUp.getAttribute('aria-activedescendant');
    expect(active && document.getElementById(active)?.textContent).toMatch(/Replace/);

    fireEvent.keyDown(followUp, { key: 'ArrowDown' });
    const next = followUp.getAttribute('aria-activedescendant');
    expect(next && document.getElementById(next)?.textContent).toMatch(/Insert below/);
  });

  it('still closes on Escape when focus has fallen to the page', async () => {
    const { onClose } = mount();
    const field = await screen.findByRole('combobox', { name: 'Ask AI' });
    await waitFor(() => expect(document.activeElement).toBe(field));

    act(() => field.blur());
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});

describe('Ask AI progress while it works', () => {
  async function runPreset() {
    mount();
    const field = await screen.findByRole('combobox', { name: 'Ask AI' });
    fireEvent.change(field, { target: { value: 'shorter' } });
    const options = screen.getAllByRole('option');
    const index = options.findIndex((option) => /Make shorter/.test(option.textContent ?? ''));
    for (let i = 0; i < index; i += 1) fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByRole('button', { name: /Stop/ });
    await waitFor(() => expect(runHandlers).not.toBeNull());
  }

  it('says it is thinking, not writing, before the first word', async () => {
    await runPreset();
    expect(screen.getByRole('status').textContent).toContain('Thinking…');
    expect(screen.queryByText(/is writing/)).toBeNull();
  });

  it('shows server steps once, without a doubled ellipsis', async () => {
    await runPreset();
    act(() => runHandlers?.onStatus?.('queued', 'Waiting to start…'));
    expect(screen.getByRole('status').textContent).toContain('Waiting to start…');
    expect(screen.getByRole('status').textContent).not.toContain('……');

    act(() => runHandlers?.onStatus?.('starting', 'Starting Codex…'));
    expect(screen.getByRole('status').textContent).toContain('Starting Codex…');

    act(() => runHandlers?.onToolCallStart?.('web_search', 'call_1', {}));
    expect(screen.getByRole('status').textContent).toContain('Searching the web…');
    expect(screen.getByRole('status').textContent).not.toContain('……');
  });
});

describe('Ask AI when the author stops a reply part-way', () => {
  it('says the text is incomplete and does not offer it as the first thing to apply', async () => {
    mount();
    const field = await screen.findByRole('combobox', { name: 'Ask AI' });
    fireEvent.change(field, { target: { value: 'shorter' } });
    const options = screen.getAllByRole('option');
    const index = options.findIndex((option) => /Make shorter/.test(option.textContent ?? ''));
    for (let i = 0; i < index; i += 1) fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    const stop = await screen.findByRole('button', { name: /Stop/ });
    await waitFor(() => expect(runHandlers).not.toBeNull());
    act(() => runHandlers?.onToken?.('A shorter para'));

    fireEvent.click(stop);

    expect(await screen.findByText('Stopped before it finished. This text is incomplete.')).toBeTruthy();
    const followUp = await screen.findByRole('combobox', { name: 'Ask AI' });
    const active = followUp.getAttribute('aria-activedescendant');
    // Enter used to replace the paragraph with the half-written text.
    expect(active && document.getElementById(active)?.textContent).toMatch(/Try again/);
    // The author can still choose to use it.
    expect(screen.getAllByRole('option').some((option) => /Replace/.test(option.textContent ?? ''))).toBe(true);
  });
});
