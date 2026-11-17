import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { useRef, useState } from 'react';
import { documentList, mockDocumentList } from '@/data/__tests__/documentFixtures';
import type { ChatRefPickerHandle } from './ChatRefPicker';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

const listDocuments = documentList();
vi.mock('@/data/documents', async () => ({
  ...(await vi.importActual<typeof import('@/data/documents')>('@/data/documents')),
  createDocument: vi.fn(async () => ({ id: 'created-doc', doc: { blocks: [], name: 'Doc' }, etag: 'cw:1', updatedAt: null, placement: { documentId: 'created-doc', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
  saveDocument: vi.fn(async () => ({ etag: 'cw:2', updatedAt: null })),
  getDocument: vi.fn(async () => ({ doc: { blocks: [], name: 'Doc' }, etag: 'cw:1', updatedAt: null, placement: { documentId: 'doc', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
  deleteDocument: vi.fn(async () => {}),
}));

const { EditorProvider } = await import('@/editor');
const { ChatRefPicker } = await import('./ChatRefPicker');

beforeEach(() => {
  mockDocumentList(listDocuments);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
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
      <button type="button" onClick={() => setInput((value) => `${value}${'hel'}`)}>
        Type hel
      </button>
      <button type="button" onClick={() => setInput((value) => `${value}${'zzz'}`)}>
        Type zzz
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
      `colwrite:ws:${TEST_WORKSPACE_ID}:doc:local`,
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
    // The picker is a listbox, not a menu: focus stays in the composer and the
    // highlight is virtual, so its entries are options.
    fireEvent.click(screen.getByRole('option', { name: /this page/i }));
    fireEvent.click(screen.getByRole('option', { name: /hello paragraph/i }));

    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    await waitFor(() => expect(screen.getByLabelText('input value').textContent).toBe('#this/p1 '));
    expect(screen.getByLabelText('caret index').textContent).toBe('9');
  });

  it('filters this page by what is typed after the #, and picks with Enter', async () => {
    localStorage.setItem(
      `colwrite:ws:${TEST_WORKSPACE_ID}:doc:local`,
      JSON.stringify({
        documentId: null,
        doc: {
          version: 1,
          blocks: [
            { id: 'h1', type: 'heading', level: 1, html: 'Introduction', children: [] },
            { id: 'p1', type: 'paragraph', html: 'Hello paragraph', children: [] },
            { id: 'p2', type: 'paragraph', html: 'Another one', children: [] },
          ],
        },
      }),
    );
    render(
      <EditorProvider>
        <PickerHarness />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open picker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Type hel' }));

    // One flat list of matches: typing did not close the picker.
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Hello paragraphText']);
    expect(screen.getByText('This page')).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Enter' });
      await new Promise(requestAnimationFrame);
    });
    // The reference replaces the `#` and the query typed after it.
    await waitFor(() => expect(screen.getByLabelText('input value').textContent).toBe('#this/p1 '));
  });

  it('asks the server for matching pages, so any page can be referenced', async () => {
    const old = { id: 'old-page', name: 'Helium notes', version: 1, tags: [], createdAt: '', updatedAt: '' };
    listDocuments.mockImplementation(async (body) => ({
      documents: body.query === 'hel' ? [old] : [],
    }));
    render(
      <EditorProvider>
        <PickerHarness />
      </EditorProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open picker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Type hel' }));

    expect(await screen.findByRole('option', { name: /Helium notes/ })).toBeTruthy();
    expect(listDocuments).toHaveBeenCalledWith(expect.objectContaining({ query: 'hel' }), expect.any(Request));
    listDocuments.mockReset().mockResolvedValue({});
  });

  it('lets go when nothing matches, so the text stays ordinary', async () => {
    render(
      <EditorProvider>
        <PickerHarness />
      </EditorProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open picker' }));
    expect(screen.getByRole('option', { name: /this page/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Type zzz' }));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByLabelText('input value').textContent).toBe('#zzz');
  });
});
