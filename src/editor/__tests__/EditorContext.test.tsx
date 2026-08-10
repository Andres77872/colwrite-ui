import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import type { Doc } from '../types';

const createDocument = vi.fn(async (_document: unknown) => ({
  document_id: 'created-doc',
  version: 1,
}));
const saveDocument = vi.fn(async (_id: string, _document: unknown) => ({
  status: 'ok',
  message: '',
  version: 4,
}));
const loadDocument = vi.fn<(
  _id: string,
  _init?: { signal?: AbortSignal },
) => Promise<Doc>>(async (_id: string) => ({
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
  loadDocument: (id: string, init?: { signal?: AbortSignal }) => loadDocument(id, init),
  deleteDocument: (id: string) => deleteDocument(id),
  listDocuments: () => listDocuments(),
}));

const { EditorProvider, useEditor } = await import('@/editor');

const editorRef = createRef<ReturnType<typeof useEditor>>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function remoteDoc(name: string, version = 3): Doc {
  return {
    version,
    name,
    blocks: [{ id: `${name}-p`, type: 'paragraph', html: name, children: [] }],
  };
}

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
  await waitFor(() => expect(loadDocument).toHaveBeenCalledWith(
    'doc-1',
    { signal: expect.any(AbortSignal) },
  ));
  await waitFor(() => expect(currentEditor().doc.version).toBe(3));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  createDocument.mockReset().mockResolvedValue({
    document_id: 'created-doc',
    version: 1,
  });
  saveDocument.mockReset().mockResolvedValue({
    status: 'ok',
    message: '',
    version: 4,
  });
  loadDocument.mockReset().mockResolvedValue(remoteDoc('Remote document'));
  deleteDocument.mockReset().mockResolvedValue({ status: 'ok', message: '' });
  listDocuments.mockReset().mockResolvedValue({
    documents: [],
    count: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
    sortBy: 'updated_at',
    sortOrder: 'desc',
    status: 'ok',
    message: '',
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.history.replaceState(null, '', '/');
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
    expect(loadDocument).toHaveBeenCalledWith('doc-2', { signal: expect.any(AbortSignal) });
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
    expect(loadDocument).toHaveBeenCalledWith('doc-2', { signal: expect.any(AbortSignal) });
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

  it('retries a failed autosave with backoff instead of waiting for the next keystroke', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();
    saveDocument
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({ status: 'ok', message: '', version: 4 });
    vi.useFakeTimers();

    act(() => currentEditor().setDocName('Needs a retry'));
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(currentEditor().saveError).toMatch(/could not be saved/i);

    // No new edit: the retry fires on the backoff schedule by itself.
    await act(async () => {
      vi.advanceTimersByTime(15000);
      await Promise.resolve();
    });
    expect(saveDocument).toHaveBeenCalledTimes(2);
    expect(currentEditor().saveError).toBeNull();

    // Success stops the backoff — no third call appears later.
    await act(async () => {
      vi.advanceTimersByTime(120000);
      await Promise.resolve();
    });
    expect(saveDocument).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed autosave once the edits are persisted elsewhere', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();
    saveDocument.mockRejectedValueOnce(new Error('network down'));
    vi.useFakeTimers();

    act(() => currentEditor().setDocName('Transient'));
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(saveDocument).toHaveBeenCalledTimes(1);

    // A restore adopts a new baseline, so nothing is dirty any more.
    act(() => currentEditor().adoptRestoredDocument(remoteDoc('Restored', 6), 6));
    await act(async () => {
      vi.advanceTimersByTime(120000);
      await Promise.resolve();
    });
    expect(saveDocument).toHaveBeenCalledTimes(1);
  });

  // M8: a draft that had not reached the server yet used to be silently
  // abandoned when the author opened another document.
  it('creates an edited local draft remotely before switching away from it', async () => {
    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );
    await waitFor(() => expect(editorRef.current).not.toBeNull());
    expect(currentEditor().documentId).toBeNull();

    act(() => currentEditor().setDocName('Unsaved draft'));
    await act(async () => currentEditor().switchTo('doc-2'));

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument.mock.calls[0][0]).toMatchObject({ name: 'Unsaved draft' });
    expect(loadDocument).toHaveBeenCalledWith('doc-2', { signal: expect.any(AbortSignal) });
    expect(currentEditor().documentId).toBe('doc-2');
  });

  it('does not create anything when switching away from a pristine local draft', async () => {
    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );
    await waitFor(() => expect(editorRef.current).not.toBeNull());

    await act(async () => currentEditor().switchTo('doc-2'));

    expect(createDocument).not.toHaveBeenCalled();
    expect(loadDocument).toHaveBeenCalledWith('doc-2', { signal: expect.any(AbortSignal) });
  });
});

describe('atomic document transitions', () => {
  it('keeps an uncached startup target pending without committing or caching its id', async () => {
    const hydration = deferred<Doc>();
    loadDocument.mockReturnValue(hydration.promise);
    localStorage.setItem('colwrite:lastDocId', 'uncached-doc');
    window.history.replaceState(null, '', '/?doc=uncached-doc');

    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );

    expect(currentEditor().loadingDocumentId).toBe('uncached-doc');
    expect(currentEditor().documentId).toBeNull();
    await waitFor(() => expect(loadDocument).toHaveBeenCalledWith(
      'uncached-doc',
      { signal: expect.any(AbortSignal) },
    ));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(localStorage.getItem('colwrite:doc:uncached-doc')).toBeNull();

    await act(async () => {
      hydration.resolve(remoteDoc('Hydrated document'));
      await hydration.promise;
    });
    await waitFor(() => expect(currentEditor().loadingDocumentId).toBeNull());
    expect(currentEditor().documentId).toBe('uncached-doc');
  });

  it('hydrates the URL document instead of reopening the cached document', async () => {
    localStorage.setItem('colwrite:lastDocId', 'cached-doc');
    window.history.replaceState(null, '', '/?doc=url-doc');

    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );

    await waitFor(() => expect(currentEditor().documentId).toBe('url-doc'));
    await waitFor(() => expect(currentEditor().doc.name).toBe('Remote document'));
    expect(loadDocument).toHaveBeenCalledTimes(1);
    expect(loadDocument).toHaveBeenCalledWith('url-doc', { signal: expect.any(AbortSignal) });
  });

  it('does not associate an empty document with a linked id that fails to load', async () => {
    const cached = remoteDoc('Cached fallback', 4);
    localStorage.setItem('colwrite:lastDocId', 'cached-doc');
    localStorage.setItem(
      'colwrite:doc:cached-doc',
      JSON.stringify({ documentId: 'cached-doc', doc: cached }),
    );
    window.history.replaceState(null, '', '/?doc=missing-doc');
    loadDocument.mockRejectedValue(new Error('Not found'));

    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );

    await waitFor(() => expect(loadDocument).toHaveBeenCalledWith(
      'missing-doc',
      { signal: expect.any(AbortSignal) },
    ));
    await waitFor(() => expect(currentEditor().documentId).toBe('cached-doc'));
    expect(currentEditor().doc.name).toBe('Cached fallback');
    expect(currentEditor().saveError).toBeNull();
    expect(currentEditor().documentLoadNotice?.description).toMatch(/showing your local copy/i);
  });

  it('does not let deferred mount hydration overwrite a newer selection', async () => {
    const hydration = deferred<Doc>();
    const selected = deferred<Doc>();
    loadDocument.mockImplementation((id: string) => (
      id === 'doc-1' ? hydration.promise : selected.promise
    ));

    localStorage.setItem('colwrite:lastDocId', 'doc-1');
    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );
    await waitFor(() => expect(loadDocument).toHaveBeenCalledWith(
      'doc-1',
      { signal: expect.any(AbortSignal) },
    ));

    let switchPromise!: Promise<boolean>;
    act(() => {
      switchPromise = currentEditor().switchTo('doc-2');
    });
    await waitFor(() => expect(loadDocument).toHaveBeenCalledWith(
      'doc-2',
      { signal: expect.any(AbortSignal) },
    ));

    await act(async () => {
      selected.resolve(remoteDoc('Selected document', 8));
      await switchPromise;
    });
    expect(currentEditor().documentId).toBe('doc-2');
    expect(currentEditor().doc.name).toBe('Selected document');

    await act(async () => {
      hydration.resolve(remoteDoc('Stale cached document', 2));
      await hydration.promise;
      await Promise.resolve();
    });
    expect(currentEditor().documentId).toBe('doc-2');
    expect(currentEditor().doc.name).toBe('Selected document');
  });

  it('ignores a superseded load failure instead of surfacing it', async () => {
    await mountRemoteDocument();
    const older = deferred<Doc>();
    const newer = deferred<Doc>();
    loadDocument.mockImplementation((id: string) => (
      id === 'doc-2' ? older.promise : newer.promise
    ));

    let olderSwitch!: Promise<boolean>;
    let newerSwitch!: Promise<boolean>;
    act(() => {
      olderSwitch = currentEditor().switchTo('doc-2');
      newerSwitch = currentEditor().switchTo('doc-3');
    });
    await waitFor(() => expect(loadDocument).toHaveBeenCalledWith(
      'doc-3',
      { signal: expect.any(AbortSignal) },
    ));
    const olderSignal = loadDocument.mock.calls.find(([id]) => id === 'doc-2')?.[1]?.signal;
    expect(olderSignal?.aborted).toBe(true);

    await act(async () => {
      older.reject(new Error('stale failure'));
      await olderSwitch;
    });
    expect(currentEditor().loadingDocumentId).toBe('doc-3');
    expect(currentEditor().documentId).toBe('doc-1');

    await act(async () => {
      newer.resolve(remoteDoc('Newest document', 9));
      await newerSwitch;
    });

    expect(currentEditor().documentId).toBe('doc-3');
    expect(currentEditor().doc.name).toBe('Newest document');
    expect(currentEditor().saveError).toBeNull();
  });

  it('marks a switch pending before flushing edits and starts GET only after the save settles', async () => {
    await mountRemoteDocument();
    const saving = deferred<{ status: string; message: string; version: number }>();
    const loading = deferred<Doc>();
    saveDocument.mockReturnValueOnce(saving.promise);
    loadDocument.mockImplementation((id) => (
      id === 'doc-2' ? loading.promise : Promise.resolve(remoteDoc('Unexpected'))
    ));
    loadDocument.mockClear();

    act(() => currentEditor().setDocName('Dirty before switch'));
    let switching!: Promise<boolean>;
    act(() => {
      switching = currentEditor().switchTo('doc-2');
    });

    expect(currentEditor().loadingDocumentId).toBe('doc-2');
    await waitFor(() => expect(saveDocument).toHaveBeenCalled());
    expect(loadDocument).not.toHaveBeenCalled();

    await act(async () => {
      saving.resolve({ status: 'ok', message: '', version: 4 });
      await saving.promise;
    });
    await waitFor(() => expect(loadDocument).toHaveBeenCalledWith(
      'doc-2',
      { signal: expect.any(AbortSignal) },
    ));
    expect(currentEditor().loadingDocumentId).toBe('doc-2');

    await act(async () => {
      loading.resolve(remoteDoc('Loaded after save', 5));
      await switching;
    });
    expect(currentEditor().loadingDocumentId).toBeNull();
    expect(currentEditor().documentId).toBe('doc-2');
  });

  it('retains the committed document and reports a load notice after a failed switch', async () => {
    await mountRemoteDocument();
    const previous = currentEditor().doc;
    loadDocument.mockRejectedValueOnce(new Error('Forbidden'));

    await act(async () => {
      await expect(currentEditor().switchTo('doc-2')).rejects.toThrow('Forbidden');
    });

    expect(currentEditor().loadingDocumentId).toBeNull();
    expect(currentEditor().documentId).toBe('doc-1');
    expect(currentEditor().doc).toBe(previous);
    expect(currentEditor().saveError).toBeNull();
    expect(currentEditor().documentLoadNotice).toMatchObject({
      title: 'Could not open document',
      description: expect.stringMatching(/current document remains open/i),
    });
  });

  it('commits a valid intentionally empty document', async () => {
    await mountRemoteDocument();
    loadDocument.mockResolvedValueOnce({ version: 2, name: 'Blank', blocks: [] });

    await act(async () => {
      await currentEditor().switchTo('blank-doc');
    });

    expect(currentEditor().documentId).toBe('blank-doc');
    expect(currentEditor().doc).toEqual({ version: 2, name: 'Blank', blocks: [] });
  });

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

/**
 * Everything the assistant does is addressed by document id, so a draft that
 * exists only in this browser has to acquire one before it can be worked on.
 * The distinction that matters is that acquiring an id is not navigation.
 */
describe('attaching a draft to a document id', () => {
  async function mountLocalDraft() {
    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );
    await waitFor(() => expect(listDocuments).toHaveBeenCalled());
    expect(currentEditor().documentId).toBeNull();
  }

  it('creates the document once, however many callers ask at the same time', async () => {
    await mountLocalDraft();
    createDocument.mockClear();

    let ids: Array<string | null> = [];
    await act(async () => {
      ids = await Promise.all([
        currentEditor().ensureRemoteDocument(),
        currentEditor().ensureRemoteDocument(),
      ]);
    });

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(ids).toEqual(['created-doc', 'created-doc']);
    expect(currentEditor().documentId).toBe('created-doc');
  });

  it('returns the existing id without creating anything', async () => {
    await mountRemoteDocument();
    createDocument.mockClear();

    let id: string | null = null;
    await act(async () => {
      id = await currentEditor().ensureRemoteDocument();
    });

    expect(id).toBe('doc-1');
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('reports failure rather than throwing at whatever the author was doing', async () => {
    await mountLocalDraft();
    createDocument.mockRejectedValueOnce(new Error('nope'));

    let id: string | null = 'unset';
    await act(async () => {
      id = await currentEditor().ensureRemoteDocument();
    });

    expect(id).toBeNull();
    expect(currentEditor().documentId).toBeNull();
    expect(currentEditor().saveError).toMatch(/nope/);
  });

  it('keeps the document session, because this is the same document', async () => {
    await mountLocalDraft();
    const before = currentEditor().documentSessionId;

    await act(async () => {
      await currentEditor().ensureRemoteDocument();
    });

    // State that belongs to the open document rather than to its stored
    // identity — the assistant's transcript, above all — keys on this.
    expect(currentEditor().documentSessionId).toBe(before);
  });

  it('starts a new session when the author actually navigates', async () => {
    await mountRemoteDocument();
    const before = currentEditor().documentSessionId;

    await act(async () => {
      await currentEditor().switchTo('doc-2');
    });
    expect(currentEditor().documentSessionId).not.toBe(before);

    const afterSwitch = currentEditor().documentSessionId;
    act(() => currentEditor().newLocal());
    expect(currentEditor().documentSessionId).not.toBe(afterSwitch);
  });
});

describe('save integrity', () => {
  // C3: Ctrl+S used to write only the local cache while the header reported
  // "Saved". The shortcut now performs the real remote save.
  it('save() persists to the server, not just the local cache', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();

    act(() => currentEditor().setDocName('Saved via shortcut'));
    await act(async () => currentEditor().save());

    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(saveDocument.mock.calls[0][0]).toBe('doc-1');
    expect(saveDocument.mock.calls[0][1]).toMatchObject({
      version: 3,
      name: 'Saved via shortcut',
    });
    expect(currentEditor().lastSaveSource).toBe('manual');
  });

  it('save() on a clean remote document reports manual without a redundant PUT', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();

    await act(async () => currentEditor().save());

    expect(saveDocument).not.toHaveBeenCalled();
    expect(currentEditor().lastSaveSource).toBe('manual');
    expect(currentEditor().lastSavedAt).not.toBeNull();
  });

  // C4: a response to a save that was in flight during a restore carried an
  // older version; adopting it dragged versionRef below the server head and
  // every later save failed the optimistic lock.
  it('ignores a stale version from a save that was in flight during a restore', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();

    let resolveFirst:
      | ((value: { status: string; message: string; version: number }) => void)
      | undefined;
    saveDocument.mockImplementationOnce(
      () => new Promise(resolve => {
        resolveFirst = resolve;
      }),
    );

    act(() => currentEditor().setDocName('Before restore'));
    let firstSave!: Promise<void>;
    act(() => {
      firstSave = currentEditor().saveRemote();
    });
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));

    // The server restores to a newer version while the save is in flight.
    act(() => currentEditor().adoptRestoredDocument(remoteDoc('Restored', 6), 6));
    expect(currentEditor().doc.version).toBe(6);

    await act(async () => {
      resolveFirst?.({ status: 'ok', message: '', version: 4 });
      await firstSave;
    });

    // The stale response must not regress the version…
    expect(currentEditor().doc.version).toBe(6);

    // …and the next save must lock on the restored head, not the stale one.
    act(() => currentEditor().setDocName('After restore'));
    await act(async () => currentEditor().saveRemote());
    expect(saveDocument).toHaveBeenCalledTimes(2);
    expect(saveDocument.mock.calls[1][1]).toMatchObject({ version: 6 });
  });

  // M9: an override is a body snapshot of the document open at call time. If
  // the workspace moved on while a queued save was awaited, the PUT must not
  // land on the newly active document.
  it('does not PUT an override body after the workspace moved to another document', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();

    // An in-flight save the override save has to queue behind.
    let resolveFirst:
      | ((value: { status: string; message: string; version: number }) => void)
      | undefined;
    saveDocument
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveFirst = resolve;
        }),
      )
      // The override PUT, if it happens at all, must be observable.
      .mockResolvedValue({ status: 'ok', message: '', version: 7 });

    act(() => currentEditor().setDocName('First edit'));
    let firstSave!: Promise<void>;
    act(() => {
      firstSave = currentEditor().saveRemote();
    });
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));

    const docAtCallTime = currentEditor().doc;
    let overrideSave!: Promise<void>;
    act(() => {
      overrideSave = currentEditor().saveRemote({ ...docAtCallTime, name: 'Renamed' });
    });

    // Move the workspace while the override save is queued. The document is
    // dirty, so the switch flushes first; keep that flush pending too, so the
    // override save can only resume after the switch committed doc-2.
    let resolveFlush:
      | ((value: { status: string; message: string; version: number }) => void)
      | undefined;
    saveDocument.mockImplementationOnce(
      () => new Promise(resolve => {
        resolveFlush = resolve;
      }),
    );
    let switched!: Promise<boolean>;
    await act(async () => {
      resolveFirst?.({ status: 'ok', message: '', version: 4 });
      await firstSave;
      switched = currentEditor().switchTo('doc-2');
    });
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveFlush?.({ status: 'ok', message: '', version: 5 });
      await switched;
      await overrideSave;
    });

    expect(currentEditor().documentId).toBe('doc-2');
    const overridePut = saveDocument.mock.calls.find(
      ([, body]) => (body as { name?: string }).name === 'Renamed',
    );
    // If the override PUT happened at all, it must have gone to doc-1 — never
    // to the document the workspace moved to.
    expect(overridePut?.[0]).not.toBe('doc-2');
    for (const [target] of saveDocument.mock.calls) {
      expect(target).not.toBe('doc-2');
    }
  });
});

describe('undo/redo', () => {
  function mountLocal() {
    localStorage.setItem(
      'colwrite:doc:local',
      JSON.stringify({
        documentId: null,
        doc: {
          version: 1,
          blocks: [
            { id: 'p1', type: 'paragraph', html: 'First', children: [] },
            { id: 'p2', type: 'paragraph', html: 'Second', children: [] },
          ],
        },
      }),
    );
    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );
  }

  it('walks back and re-applies structural edits', async () => {
    mountLocal();
    await waitFor(() => expect(editorRef.current).not.toBeNull());

    act(() => currentEditor().removeBlock('p2'));
    expect(currentEditor().blocks.map(b => b.id)).toEqual(['p1']);

    act(() => currentEditor().undo());
    expect(currentEditor().blocks.map(b => b.id)).toEqual(['p1', 'p2']);

    act(() => currentEditor().redo());
    expect(currentEditor().blocks.map(b => b.id)).toEqual(['p1']);
  });

  it('coalesces a typing burst in one block into a single step', async () => {
    mountLocal();
    await waitFor(() => expect(editorRef.current).not.toBeNull());

    act(() => currentEditor().updateHtml('p1', 'First.'));
    act(() => currentEditor().updateHtml('p1', 'First. More'));
    act(() => currentEditor().updateHtml('p1', 'First. More text'));

    act(() => currentEditor().undo());
    expect(currentEditor().blocks[0]).toMatchObject({ html: 'First' });
  });

  it('starts a new step for a different block and clears redo on a new edit', async () => {
    mountLocal();
    await waitFor(() => expect(editorRef.current).not.toBeNull());

    act(() => currentEditor().updateHtml('p1', 'Changed p1'));
    act(() => currentEditor().updateHtml('p2', 'Changed p2'));

    act(() => currentEditor().undo());
    expect(currentEditor().blocks[1]).toMatchObject({ html: 'Second' });
    expect(currentEditor().blocks[0]).toMatchObject({ html: 'Changed p1' });

    // A new edit after undoing must not resurrect the discarded future.
    act(() => currentEditor().updateHtml('p2', 'Edited instead'));
    act(() => currentEditor().redo());
    expect(currentEditor().blocks[1]).toMatchObject({ html: 'Edited instead' });
  });

  it('drops history on a restore instead of resurrecting pre-restore text', async () => {
    mountLocal();
    await waitFor(() => expect(editorRef.current).not.toBeNull());

    act(() => currentEditor().updateHtml('p1', 'Before restore'));
    act(() => currentEditor().adoptRestoredDocument(
      { version: 6, name: 'Restored', blocks: [{ id: 'r1', type: 'paragraph', html: 'Server copy', children: [] }] },
      6,
    ));

    act(() => currentEditor().undo());
    expect(currentEditor().blocks.map(b => b.id)).toEqual(['r1']);
  });

  it('marks an undo dirty so autosave persists it', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();
    vi.useFakeTimers();

    act(() => currentEditor().setDocName('Before undo'));
    act(() => currentEditor().undo());
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(saveDocument.mock.calls[0][1]).toMatchObject({ name: 'Remote document' });
  });
});

describe('setFromJSON', () => {
  it('rejects a document containing a block the canvas cannot render', async () => {
    await mountRemoteDocument();
    const before = currentEditor().doc;

    expect(() =>
      act(() =>
        currentEditor().setFromJSON(
          JSON.stringify({
            version: 9,
            blocks: [
              { id: 'p1', type: 'paragraph', html: 'ok' },
              { id: 'x1', type: 'image', html: 'not a block' },
            ],
          }),
        ),
      ),
    ).toThrow(/invalid block/i);
    expect(currentEditor().doc).toBe(before);
  });

  it('accepts a valid document through the same coercion as wire data', async () => {
    await mountRemoteDocument();

    act(() =>
      currentEditor().setFromJSON(
        JSON.stringify({
          version: 9,
          name: 'Imported',
          blocks: [
            { id: 'p1', type: 'paragraph', html: 'ok <img src=x onerror="alert(1)">' },
          ],
        }),
      ),
    );

    expect(currentEditor().doc.name).toBe('Imported');
    expect(currentEditor().doc.blocks).toHaveLength(1);
    expect(currentEditor().doc.blocks[0]).toMatchObject({ id: 'p1', html: 'ok ' });
  });
});
