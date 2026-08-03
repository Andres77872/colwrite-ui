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

const fetchReferenceReadiness = vi.fn(async (_id: string) => ({
  ready: true,
  readinessStatus: 'ready',
  expectedHeadSeq: 4 as number | null,
  appliedHeadSeq: 4 as number | null,
  retryable: false,
  retryAfterSeconds: 0,
}));

vi.mock('@/services', () => ({
  createDocument: (document: unknown) => createDocument(document),
  saveDocument: (id: string, document: unknown) => saveDocument(id, document),
  loadDocument: (id: string, init?: { signal?: AbortSignal }) => loadDocument(id, init),
  deleteDocument: (id: string) => deleteDocument(id),
  listDocuments: () => listDocuments(),
  fetchReferenceReadiness: (id: string) => fetchReferenceReadiness(id),
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
  fetchReferenceReadiness.mockReset().mockResolvedValue({
    ready: true,
    readinessStatus: 'ready',
    expectedHeadSeq: 4,
    appliedHeadSeq: 4,
    retryable: false,
    retryAfterSeconds: 0,
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

describe('waitForReady', () => {
  it('flushes pending edits first and reports ready from the probe', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();

    act(() => currentEditor().setDocName('Edited before asking'));
    expect(currentEditor().hasPendingEdits()).toBe(true);

    let result: { ready: boolean; status: string } | undefined;
    await act(async () => {
      result = await currentEditor().waitForReady();
    });

    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(fetchReferenceReadiness).toHaveBeenCalledWith('doc-1');
    expect(result).toEqual({ ready: true, status: 'ready' });
    // The save adopted the server's returned version as the new head seq.
    expect(currentEditor().savedHeadSeq()).toBe(4);
  });

  it('memoizes readiness per head seq and skips the probe next time', async () => {
    await mountRemoteDocument();

    await act(async () => {
      await currentEditor().waitForReady();
    });
    fetchReferenceReadiness.mockClear();

    let result: { ready: boolean; status: string } | undefined;
    await act(async () => {
      result = await currentEditor().waitForReady();
    });

    expect(fetchReferenceReadiness).not.toHaveBeenCalled();
    expect(result).toEqual({ ready: true, status: 'ready' });
  });

  it('stops immediately on a terminal projection status', async () => {
    await mountRemoteDocument();
    fetchReferenceReadiness.mockResolvedValue({
      ready: false,
      readinessStatus: 'deleted',
      expectedHeadSeq: 3,
      appliedHeadSeq: null,
      retryable: false,
      retryAfterSeconds: 0,
    });

    let result: { ready: boolean; status: string } | undefined;
    await act(async () => {
      result = await currentEditor().waitForReady();
    });

    expect(fetchReferenceReadiness).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ready: false, status: 'deleted' });
  });

  it('degrades to not-ready instead of throwing when the probe fails', async () => {
    await mountRemoteDocument();
    fetchReferenceReadiness.mockRejectedValue(new Error('network down'));

    let result: { ready: boolean; status: string } | undefined;
    await act(async () => {
      result = await currentEditor().waitForReady();
    });

    expect(result).toEqual({ ready: false, status: 'unavailable' });
  });

  it('reports save_failed instead of probing when the flush fails', async () => {
    await mountRemoteDocument();
    saveDocument.mockRejectedValueOnce(new Error('offline'));

    act(() => currentEditor().setDocName('Edited before asking'));

    let result: { ready: boolean; status: string } | undefined;
    await act(async () => {
      result = await currentEditor().waitForReady();
    });

    expect(result).toEqual({ ready: false, status: 'save_failed' });
    expect(fetchReferenceReadiness).not.toHaveBeenCalled();
  });

  it('shares one probe between callers asking about the same head', async () => {
    await mountRemoteDocument();
    const pending = deferred<Awaited<ReturnType<typeof fetchReferenceReadiness>>>();
    fetchReferenceReadiness.mockReturnValueOnce(pending.promise);

    let both: Array<{ ready: boolean; status: string }> | undefined;
    await act(async () => {
      const first = currentEditor().waitForReady({ save: false });
      const second = currentEditor().waitForReady({ save: false });
      pending.resolve({
        ready: true,
        readinessStatus: 'ready',
        expectedHeadSeq: 3,
        appliedHeadSeq: 3,
        retryable: false,
        retryAfterSeconds: 0,
      });
      both = await Promise.all([first, second]);
    });

    expect(fetchReferenceReadiness).toHaveBeenCalledTimes(1);
    expect(both).toEqual([
      { ready: true, status: 'ready' },
      { ready: true, status: 'ready' },
    ]);
  });

  it('does not answer a caller past a newer save with the older head verdict', async () => {
    await mountRemoteDocument();
    const stale = deferred<Awaited<ReturnType<typeof fetchReferenceReadiness>>>();
    fetchReferenceReadiness.mockReturnValueOnce(stale.promise);

    await act(async () => {
      // In flight for head 3, and deliberately left unresolved.
      void currentEditor().waitForReady({ save: false });
      // A save lands; the next caller is asking about head 5, not head 3.
      currentEditor().adoptServerVersion(5);
      await currentEditor().waitForReady({ save: false });
    });

    expect(fetchReferenceReadiness).toHaveBeenCalledTimes(2);
    stale.resolve({
      ready: true,
      readinessStatus: 'ready',
      expectedHeadSeq: 3,
      appliedHeadSeq: 3,
      retryable: false,
      retryAfterSeconds: 0,
    });
  });

  it('rides out a single probe hiccup rather than reporting it as an answer', async () => {
    await mountRemoteDocument();
    fetchReferenceReadiness
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce({
        ready: true,
        readinessStatus: 'ready',
        expectedHeadSeq: 3,
        appliedHeadSeq: 3,
        retryable: false,
        retryAfterSeconds: 0,
      });

    let result: { ready: boolean; status: string } | undefined;
    await act(async () => {
      result = await currentEditor().waitForReady({ save: false });
    });

    expect(fetchReferenceReadiness).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ready: true, status: 'ready' });
  });

  it.each(['deleting', 'scope_mismatch', 'conflicting'])(
    'stops on the %s projection status too',
    async (readinessStatus) => {
      await mountRemoteDocument();
      fetchReferenceReadiness.mockResolvedValue({
        ready: false,
        readinessStatus,
        expectedHeadSeq: 3,
        appliedHeadSeq: null,
        retryable: false,
        retryAfterSeconds: 0,
      });

      let result: { ready: boolean; status: string } | undefined;
      await act(async () => {
        result = await currentEditor().waitForReady({ save: false });
      });

      expect(fetchReferenceReadiness).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ready: false, status: readinessStatus });
    },
  );

  it('answers no_document for a draft that has never been saved', async () => {
    localStorage.setItem('colwrite:hasRemoteDocs', 'false');
    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );
    await waitFor(() => expect(editorRef.current).not.toBeNull());

    let result: { ready: boolean; status: string } | undefined;
    await act(async () => {
      result = await currentEditor().waitForReady({ save: false });
    });

    expect(result).toEqual({ ready: false, status: 'no_document' });
    expect(fetchReferenceReadiness).not.toHaveBeenCalled();
  });
});
