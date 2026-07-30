import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';

const createDocument = vi.fn(async (_document: unknown) => ({
  document_id: 'created-doc',
  version: 1,
}));
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
const deleteDocument = vi.fn(async (_id: string) => ({ status: 'ok', message: '' }));
const listDocuments = vi.fn(async () => ({
  documents: [],
  count: 1,
  page: 1,
  limit: 10,
  totalPages: 1,
  sortBy: 'updated_at' as const,
  sortOrder: 'desc' as const,
  status: 'ok',
  message: '',
}));

vi.mock('@/services', () => ({
  createDocument: (document: unknown) => createDocument(document),
  saveDocument: (id: string, document: unknown) => saveDocument(id, document),
  loadDocument: (id: string) => loadDocument(id),
  deleteDocument: (id: string) => deleteDocument(id),
  listDocuments: () => listDocuments(),
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

async function mountRemoteDocument() {
  localStorage.setItem('colwrite:lastDocId', 'doc-1');
  render(
    <EditorProvider>
      <CaptureEditor />
    </EditorProvider>,
  );
  await waitFor(() => expect(loadDocument).toHaveBeenCalledWith('doc-1'));
  await waitFor(() => expect(currentEditor().doc.version).toBe(3));
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
    await mountRemoteDocument();
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

  it('does not PUT when switching away from a clean document', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();
    loadDocument.mockClear();

    await act(async () => currentEditor().switchTo('doc-2'));

    expect(saveDocument).not.toHaveBeenCalled();
    expect(loadDocument).toHaveBeenCalledWith('doc-2');
  });

  it('flushes exactly once before switching away from a dirty document', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();
    loadDocument.mockClear();

    act(() => currentEditor().setDocName('Dirty title'));
    await act(async () => currentEditor().switchTo('doc-2'));

    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(saveDocument.mock.calls[0][0]).toBe('doc-1');
    expect(saveDocument.mock.calls[0][1]).toMatchObject({ name: 'Dirty title' });
    expect(loadDocument).toHaveBeenCalledWith('doc-2');
    expect(saveDocument.mock.invocationCallOrder[0]).toBeLessThan(
      loadDocument.mock.invocationCallOrder[0],
    );
  });

  it('does not save again on switch after the dirty revision was autosaved', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();
    vi.useFakeTimers();

    act(() => currentEditor().setDocName('Autosaved title'));
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(saveDocument).toHaveBeenCalledTimes(1);

    await act(async () => currentEditor().switchTo('doc-2'));
    expect(saveDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps an edit made during an in-flight save dirty', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();

    let resolveFirst:
      | ((value: { status: string; message: string; version: number }) => void)
      | undefined;
    saveDocument
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ status: 'ok', message: '', version: 5 });

    act(() => currentEditor().setDocName('First edit'));
    let firstSave!: Promise<void>;
    act(() => {
      firstSave = currentEditor().saveRemote();
    });
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));

    act(() => currentEditor().setDocName('Second edit'));
    await act(async () => {
      resolveFirst?.({ status: 'ok', message: '', version: 4 });
      await firstSave;
    });

    await act(async () => currentEditor().switchTo('doc-2'));

    expect(saveDocument).toHaveBeenCalledTimes(2);
    expect(saveDocument.mock.calls[1][1]).toMatchObject({
      version: 4,
      name: 'Second edit',
    });
  });

  it('treats a clean manual save as a local no-op', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();

    await act(async () => currentEditor().saveRemote());

    expect(saveDocument).not.toHaveBeenCalled();
    expect(currentEditor().lastSaveSource).toBe('manual');
  });
});

describe('atomic document transitions', () => {
  it('creates and adopts the requested document instead of retaining the old body', async () => {
    await mountRemoteDocument();
    createDocument.mockClear();

    await act(async () => {
      await currentEditor().createAndSwitch({
        version: 1,
        name: 'Blank document',
        blocks: [],
      });
    });

    expect(createDocument).toHaveBeenCalledWith({
      version: 1,
      name: 'Blank document',
      blocks: [],
    });
    expect(currentEditor().documentId).toBe('created-doc');
    expect(currentEditor().doc).toMatchObject({
      version: 1,
      name: 'Blank document',
      blocks: [],
    });
  });

  it('resets editor identity and content after deleting the active document', async () => {
    await mountRemoteDocument();
    deleteDocument.mockClear();

    await act(async () => currentEditor().deleteRemote('doc-1'));

    expect(deleteDocument).toHaveBeenCalledWith('doc-1');
    expect(currentEditor().documentId).toBeNull();
    expect(currentEditor().doc.name).toBe('Untitled document');
    expect(currentEditor().doc.blocks.length).toBeGreaterThan(0);
  });
});
