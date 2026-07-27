import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import type { ChatRefPickerHandle } from './ChatRefPicker';

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

const { EditorProvider } = await import('@/editor');
const { ChatRefPicker } = await import('./ChatRefPicker');

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function PickerHarness() {
  const [input, setInput] = useState('#');
  const [caret, setCaret] = useState(-1);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<ChatRefPickerHandle | null>(null);

  return (
    <>
      <div ref={hostRef} />
      <output aria-label="input value">{input}</output>
      <output aria-label="caret index">{caret}</output>
      <button type="button" onClick={() => pickerRef.current?.openAt(0)}>
        Open picker
      </button>
      <ChatRefPicker
        ref={pickerRef}
        getHost={() => hostRef.current}
        input={input}
        setInput={setInput}
        setCaretIndex={setCaret}
      />
    </>
  );
}

describe('ChatRefPicker callbacks', () => {
  it('inserts the selected block reference and restores the caret after it', async () => {
    localStorage.setItem(
      'colwrite:doc:local',
      JSON.stringify({
        documentId: null,
        doc: {
          version: 1,
          blocks: [{ id: 'p1', type: 'paragraph', html: 'Hello paragraph', children: [] }],
        },
      }),
    );

    render(
      <EditorProvider>
        <PickerHarness />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open picker' }));
    fireEvent.click(screen.getByRole('button', { name: /reference current document/i }));
    fireEvent.click(screen.getByRole('button', { name: /hello paragraph/i }));

    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    await waitFor(() => expect(screen.getByLabelText('input value').textContent).toBe('#this/p1 '));
    expect(screen.getByLabelText('caret index').textContent).toBe('9');
  });
});
