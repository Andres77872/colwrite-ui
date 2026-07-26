import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';

const saveDocument = vi.fn(async (_id: string, _document: unknown) => ({
  status: 'ok',
  message: '',
  version: 4,
}));
const loadDocument = vi.fn(async (_id: string) => ({
  version: 3,
  name: 'Remote document',
  blocks: [{ id: 'p1', type: 'paragraph', html: 'Hello', children: [] }],
}));

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'doc-1', version: 1 })),
  saveDocument: (id: string, document: unknown) => saveDocument(id, document),
  loadDocument: (id: string) => loadDocument(id),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({
    documents: [{ _id: 'doc-1', name: 'Remote document' }],
    count: 1,
    status: 'ok',
    message: '',
  })),
}));

const { EditorProvider, useEditor } = await import('@/editor');

const editorRef = createRef<ReturnType<typeof useEditor>>();

function CaptureEditor() {
  const editor = useEditor();
  useImperativeHandle(editorRef, () => editor, [editor]);
  return null;
}

function currentEditor() {
  if (!editorRef.current) throw new Error('Editor harness is not mounted');
  return editorRef.current;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('remote autosave', () => {
  it('waits five seconds after the latest edit and sends the server version', async () => {
    localStorage.setItem('colwrite:lastDocId', 'doc-1');

    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );

    await waitFor(() => expect(loadDocument).toHaveBeenCalledWith('doc-1'));
    await waitFor(() => expect(currentEditor().doc.version).toBe(3));
    vi.useFakeTimers();

    act(() => currentEditor().setDocName('Edited title'));
    await act(async () => {
      vi.advanceTimersByTime(4999);
    });
    expect(saveDocument).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(saveDocument.mock.calls[0][1]).toMatchObject({
      version: 3,
      name: 'Edited title',
    });
  });
});
