import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Doc } from '@/editor/types';

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

/** Resolves the current run when the test says so, after one token. */
let finishRun: (() => void) | null = null;
/** The running request's handlers, to drive its progress events. */
let runHandlers: import('@/services/streamParser').SSEEventHandlers | null = null;
vi.mock('@/services/agentChat', () => ({
  streamAgentChat: vi.fn(
    (_params: unknown, handlers: import('@/services/streamParser').SSEEventHandlers) =>
      new Promise((resolve) => {
        runHandlers = handlers;
        finishRun = () => {
          handlers.onToken?.('A shorter paragraph.');
          resolve({ terminal: 'done' });
        };
      }),
  ),
}));

const { EditorProvider } = await import('@/editor');
const { AskAiPanel } = await import('./AskAi');

function mount() {
  const doc: Doc = {
    version: 1,
    name: 'Ask AI test',
    blocks: [{ id: 'p1', type: 'paragraph', html: 'A long paragraph.', children: [], columns: 1 }],
  };
  localStorage.setItem('colwrite:doc:local', JSON.stringify({ documentId: 'doc-1', doc }));
  const onClose = vi.fn();
  render(
    <EditorProvider>
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
        onClose={onClose}
      />
    </EditorProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  localStorage.clear();
  finishRun = null;
  runHandlers = null;
});

afterEach(cleanup);

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
