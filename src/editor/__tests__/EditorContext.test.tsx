import { itemAt } from '@/lib/itemAt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { createRef, useImperativeHandle } from 'react';
import type { Doc } from '../types';
import { ApiError } from '@/api/errors';
import { documentList, mockDocumentList } from '@/data/__tests__/documentFixtures';
import { TEST_WORKSPACE_ID as WS } from '@/__tests__/workspace';

/** A page as the server answers it: its body, with the ETag of its head. */
type Remote = Doc & { updatedAt?: string; etag?: string };

/** Where a page lives: the top level, for every page here. */
const placementOf = (documentId: string) => ({ documentId, collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null });

/** The ETag of head `seq`; the editor only ever compares them. */
const etagOf = (seq: number) => `"cw:canonical-json-v1:1:${seq}:test"`;

const createDocument = vi.fn(async (_document: Doc) => ({ id: 'created-doc', etag: etagOf(1) }));
const saveDocument = vi.fn(async (_id: string, _document: Doc, _etag: string) => ({ etag: etagOf(4) }));
const readDocument = vi.fn<(
  _id: string,
  _init?: { signal?: AbortSignal },
) => Promise<Remote>>(async (_id: string) => remoteDoc('Remote document'));
/** The server's page list: the sidebar reads it. */
const listDocuments = documentList();

/** Every page request the session makes, against the test workspace. */
vi.mock('@/data/documents', async () => ({
  ...(await vi.importActual<typeof import('@/data/documents')>('@/data/documents')),
  createDocument: async (workspaceId: string, document: Doc) => {
    expect(workspaceId).toBe(WS);
    const created = await createDocument(document);
    return { ...created, doc: document, updatedAt: null, placement: placementOf(created.id) };
  },
  saveDocument: async (workspaceId: string, id: string, document: Doc, etag: string) => {
    expect(workspaceId).toBe(WS);
    return { updatedAt: null, ...(await saveDocument(id, document, etag)) };
  },
  getDocument: async (workspaceId: string, id: string, init?: { signal?: AbortSignal }) => {
    expect(workspaceId).toBe(WS);
    const { updatedAt = null, etag = etagOf(3), ...doc } = await readDocument(id, init);
    return { doc, etag, updatedAt, placement: placementOf(id) };
  },
}));

/** This workspace's key for `name`, as `src/lib/storageKeys.ts` declares it. */
const key = (name: string) => `colwrite:ws:${WS}:${name}`;

const { EditorProvider } = await import('@/editor');
const { PagesTree } = await import('@/components/layout/Sidebar/PagesTree/PagesTree');
const { ToastProvider } = await import('@/components/ui/toast');
const { ConfirmProvider } = await import('@/components/ui/confirm-dialog');
const { useEditorProbe } = await import('./editorHarness');
const { endPendingSaves, flushPendingSaves } = await import('@/lib/pendingSaves');

const editorRef = createRef<ReturnType<typeof useEditorProbe>>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pageDoc(name: string): Doc {
  return {
    name,
    blocks: [{ id: `${name}-p`, type: 'paragraph', html: name, children: [] }],
  };
}

/** A page the server holds at head `seq`. */
function remoteDoc(name: string, seq = 3): Remote {
  return { ...pageDoc(name), etag: etagOf(seq) };
}

function CaptureEditor() {
  const editor = useEditorProbe();
  useImperativeHandle(editorRef, () => editor, [editor]);
  return null;
}

function currentEditor() {
  if (!editorRef.current) throw new Error('Editor harness is not mounted');
  return editorRef.current;
}

async function mountRemoteDocument() {
  localStorage.setItem(key('lastDocId'), 'doc-1');
  render(
    <EditorProvider>
      <CaptureEditor />
    </EditorProvider>,
  );
  await waitFor(() => expect(readDocument).toHaveBeenCalledWith(
    'doc-1',
    { signal: expect.any(AbortSignal) },
  ));
  await waitFor(() => expect(currentEditor().doc.name).toBe('Remote document'));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  createDocument.mockReset().mockResolvedValue({ id: 'created-doc', etag: etagOf(1) });
  saveDocument.mockReset().mockResolvedValue({ etag: etagOf(4) });
  readDocument.mockReset().mockResolvedValue(remoteDoc('Remote document'));
  listDocuments.mockReset().mockResolvedValue({});
  mockDocumentList(listDocuments);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('remote autosave', () => {
  it('waits five seconds after the latest edit and saves over the head it read', async () => {
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
    expect(saveDocument.mock.calls[0]?.[1]).toMatchObject({ name: 'Edited title' });
    expect(saveDocument.mock.calls[0]?.[1]).not.toHaveProperty('version');
    expect(saveDocument.mock.calls[0]?.[2]).toBe(etagOf(3));
  });

  it('knows when an opened page was last saved, from the server, without keeping it in the page', async () => {
    await mountRemoteDocument();
    readDocument.mockResolvedValueOnce({ ...remoteDoc('Older page'), updatedAt: '2026-01-15T10:00:00Z' });

    await act(async () => currentEditor().switchTo('doc-2'));

    expect(currentEditor().lastSavedAt).toBe(Date.parse('2026-01-15T10:00:00Z'));
    expect(currentEditor().doc).not.toHaveProperty('updatedAt');
  });

  it('sends only saves while the author types for a minute, and the sidebar row follows them', async () => {
    localStorage.setItem(key('lastDocId'), 'doc-1');
    listDocuments.mockResolvedValue({
      documents: [{ id: 'doc-1', name: 'Remote document', tags: [], createdAt: '', updatedAt: '' }],
    });
    render(
      <ToastProvider>
        <ConfirmProvider>
          <EditorProvider>
            <CaptureEditor />
            <PagesTree />
          </EditorProvider>
        </ConfirmProvider>
      </ToastProvider>,
    );
    await waitFor(() => expect(currentEditor().doc.name).toBe('Remote document'));
    await screen.findByText('Remote document');
    // The sidebar tree's pages at the top level, once; there is no first-run probe.
    expect(listDocuments).toHaveBeenCalledTimes(1);
    for (const request of [listDocuments, readDocument, saveDocument, createDocument]) request.mockClear();

    vi.useFakeTimers();
    // A burst of typing every six seconds: each pause is long enough for an autosave.
    for (let second = 6; second <= 60; second += 6) {
      act(() => currentEditor().setDocName(`Draft at ${second}s`));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
    }

    expect(saveDocument).toHaveBeenCalledTimes(10);
    expect(listDocuments).not.toHaveBeenCalled();
    expect(readDocument).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
    // The open page's row is patched in place from the editor.
    expect(screen.getByText('Draft at 60s')).toBeTruthy();
  });

  it('does not PUT when switching away from a clean document', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();
    readDocument.mockClear();

    await act(async () => currentEditor().switchTo('doc-2'));

    expect(saveDocument).not.toHaveBeenCalled();
    expect(readDocument).toHaveBeenCalledWith('doc-2', { signal: expect.any(AbortSignal) });
  });

  it('flushes exactly once before switching away from a dirty document', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();
    readDocument.mockClear();

    act(() => currentEditor().setDocName('Dirty title'));
    await act(async () => currentEditor().switchTo('doc-2'));

    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(saveDocument.mock.calls[0]?.[0]).toBe('doc-1');
    expect(saveDocument.mock.calls[0]?.[1]).toMatchObject({ name: 'Dirty title' });
    expect(readDocument).toHaveBeenCalledWith('doc-2', { signal: expect.any(AbortSignal) });
    expect(saveDocument.mock.invocationCallOrder[0]).toBeLessThan(
      itemAt(readDocument.mock.invocationCallOrder, 0),
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

    let resolveFirst: ((value: { etag: string }) => void) | undefined;
    saveDocument
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ etag: etagOf(5) });

    act(() => currentEditor().setDocName('First edit'));
    let firstSave!: Promise<void>;
    act(() => {
      firstSave = currentEditor().saveRemote();
    });
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));

    act(() => currentEditor().setDocName('Second edit'));
    await act(async () => {
      resolveFirst?.({ etag: etagOf(4) });
      await firstSave;
    });

    await act(async () => currentEditor().switchTo('doc-2'));

    expect(saveDocument).toHaveBeenCalledTimes(2);
    expect(saveDocument.mock.calls[1]?.[1]).toMatchObject({ name: 'Second edit' });
    // Over the head the first save made.
    expect(saveDocument.mock.calls[1]?.[2]).toBe(etagOf(4));
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
      .mockResolvedValue({ etag: etagOf(4) });
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
    act(() => currentEditor().adoptRestoredDocument(pageDoc('Restored'), etagOf(6)));
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
    expect(createDocument.mock.calls[0]?.[0]).toMatchObject({ name: 'Unsaved draft' });
    expect(readDocument).toHaveBeenCalledWith('doc-2', { signal: expect.any(AbortSignal) });
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
    expect(readDocument).toHaveBeenCalledWith('doc-2', { signal: expect.any(AbortSignal) });
  });
});

describe('atomic document transitions', () => {
  it('keeps an uncached startup target pending without committing or caching its id', async () => {
    const hydration = deferred<Remote>();
    readDocument.mockReturnValue(hydration.promise);
    localStorage.setItem(key('lastDocId'), 'uncached-doc');
    window.history.replaceState(null, '', '/?doc=uncached-doc');

    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );

    expect(currentEditor().loadingDocumentId).toBe('uncached-doc');
    expect(currentEditor().documentId).toBeNull();
    await waitFor(() => expect(readDocument).toHaveBeenCalledWith(
      'uncached-doc',
      { signal: expect.any(AbortSignal) },
    ));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(localStorage.getItem(key('draft:uncached-doc'))).toBeNull();

    await act(async () => {
      hydration.resolve(remoteDoc('Hydrated document'));
      await hydration.promise;
    });
    await waitFor(() => expect(currentEditor().loadingDocumentId).toBeNull());
    expect(currentEditor().documentId).toBe('uncached-doc');
  });

  it('hydrates the URL document instead of reopening the cached document', async () => {
    localStorage.setItem(key('lastDocId'), 'cached-doc');
    window.history.replaceState(null, '', '/?doc=url-doc');

    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );

    await waitFor(() => expect(currentEditor().documentId).toBe('url-doc'));
    await waitFor(() => expect(currentEditor().doc.name).toBe('Remote document'));
    expect(readDocument).toHaveBeenCalledTimes(1);
    expect(readDocument).toHaveBeenCalledWith('url-doc', { signal: expect.any(AbortSignal) });
  });

  it('does not associate an empty document with a linked id that fails to load', async () => {
    const cached = pageDoc('Cached fallback');
    localStorage.setItem(key('lastDocId'), 'cached-doc');
    localStorage.setItem(
      key('draft:cached-doc'),
      JSON.stringify({ documentId: 'cached-doc', doc: cached, etag: etagOf(4) }),
    );
    window.history.replaceState(null, '', '/?doc=missing-doc');
    readDocument.mockRejectedValue(new Error('Not found'));

    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );

    await waitFor(() => expect(readDocument).toHaveBeenCalledWith(
      'missing-doc',
      { signal: expect.any(AbortSignal) },
    ));
    await waitFor(() => expect(currentEditor().documentId).toBe('cached-doc'));
    expect(currentEditor().doc.name).toBe('Cached fallback');
    expect(currentEditor().saveError).toBeNull();
    expect(currentEditor().documentLoadNotice?.description).toMatch(/showing your local copy/i);
  });

  it('does not let deferred mount hydration overwrite a newer selection', async () => {
    const hydration = deferred<Remote>();
    const selected = deferred<Remote>();
    readDocument.mockImplementation((id: string) => (
      id === 'doc-1' ? hydration.promise : selected.promise
    ));

    localStorage.setItem(key('lastDocId'), 'doc-1');
    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );
    await waitFor(() => expect(readDocument).toHaveBeenCalledWith(
      'doc-1',
      { signal: expect.any(AbortSignal) },
    ));

    let switchPromise!: Promise<boolean>;
    act(() => {
      switchPromise = currentEditor().switchTo('doc-2');
    });
    await waitFor(() => expect(readDocument).toHaveBeenCalledWith(
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
    const older = deferred<Remote>();
    const newer = deferred<Remote>();
    readDocument.mockImplementation((id: string) => (
      id === 'doc-2' ? older.promise : newer.promise
    ));

    let olderSwitch!: Promise<boolean>;
    let newerSwitch!: Promise<boolean>;
    act(() => {
      olderSwitch = currentEditor().switchTo('doc-2');
      newerSwitch = currentEditor().switchTo('doc-3');
    });
    await waitFor(() => expect(readDocument).toHaveBeenCalledWith(
      'doc-3',
      { signal: expect.any(AbortSignal) },
    ));
    const olderSignal = readDocument.mock.calls.find(([id]) => id === 'doc-2')?.[1]?.signal;
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
    const saving = deferred<{ etag: string }>();
    const loading = deferred<Remote>();
    saveDocument.mockReturnValueOnce(saving.promise);
    readDocument.mockImplementation((id) => (
      id === 'doc-2' ? loading.promise : Promise.resolve(remoteDoc('Unexpected'))
    ));
    readDocument.mockClear();

    act(() => currentEditor().setDocName('Dirty before switch'));
    let switching!: Promise<boolean>;
    act(() => {
      switching = currentEditor().switchTo('doc-2');
    });

    expect(currentEditor().loadingDocumentId).toBe('doc-2');
    await waitFor(() => expect(saveDocument).toHaveBeenCalled());
    expect(readDocument).not.toHaveBeenCalled();

    await act(async () => {
      saving.resolve({ etag: etagOf(4) });
      await saving.promise;
    });
    await waitFor(() => expect(readDocument).toHaveBeenCalledWith(
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
    readDocument.mockRejectedValueOnce(new Error('Forbidden'));

    await act(async () => {
      await expect(currentEditor().switchTo('doc-2')).rejects.toThrow('Forbidden');
    });

    expect(currentEditor().loadingDocumentId).toBeNull();
    expect(currentEditor().documentId).toBe('doc-1');
    expect(currentEditor().doc).toBe(previous);
    expect(currentEditor().saveError).toBeNull();
    expect(currentEditor().documentLoadNotice).toMatchObject({
      title: 'Could not open page',
      description: expect.stringMatching(/current page stays open/i),
    });
  });

  it('commits a valid intentionally empty document', async () => {
    await mountRemoteDocument();
    readDocument.mockResolvedValueOnce({ name: 'Blank', blocks: [], etag: etagOf(2) });

    await act(async () => {
      await currentEditor().switchTo('blank-doc');
    });

    expect(currentEditor().documentId).toBe('blank-doc');
    expect(currentEditor().doc).toEqual({ name: 'Blank', blocks: [] });
  });

  it('creates and adopts the requested document instead of retaining the old body', async () => {
    await mountRemoteDocument();
    createDocument.mockClear();

    await act(async () => {
      await currentEditor().createAndSwitch({
        name: 'Blank document',
        blocks: [],
      });
    });

    expect(createDocument).toHaveBeenCalledWith({
      name: 'Blank document',
      blocks: [],
    });
    expect(currentEditor().documentId).toBe('created-doc');
    expect(currentEditor().doc).toEqual({
      name: 'Blank document',
      blocks: [],
    });
  });

  it('shares one creation between calls made while it is in flight', async () => {
    await mountRemoteDocument();
    createDocument.mockClear();
    let finish!: (value: { id: string; etag: string }) => void;
    createDocument.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));

    let first!: Promise<string>;
    let second!: Promise<string>;
    act(() => {
      first = currentEditor().createAndSwitch({ name: 'One', blocks: [] });
      second = currentEditor().createAndSwitch({ name: 'Two', blocks: [] });
    });
    expect(second).toBe(first);
    await waitFor(() => expect(currentEditor().creatingDocument).toBe(true));

    await act(async () => {
      finish({ id: 'created-once', etag: etagOf(1) });
      await first;
    });

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(currentEditor().documentId).toBe('created-once');
    expect(currentEditor().creatingDocument).toBe(false);
  });

});

/**
 * A page in the Trash takes no save (409 `document_in_trash`): the editor
 * stops autosaving and says so, keeps what the author wrote, and saves it
 * with the ETag it holds once the page is restored, since neither a trash
 * nor a restore changes the content ETag.
 */
describe('a page in the Trash', () => {
  const inTrash = () => new ApiError('This page is in the Trash', 409, {
    code: 'document_in_trash',
    detail: 'This page is in the Trash',
    trash_root: { kind: 'document', id: 'doc-1' },
    purge_after: '2026-12-15T09:00:00Z',
  });

  it('stops autosaving when a save finds it in the Trash, and saves again once it is restored', async () => {
    await mountRemoteDocument();
    vi.useFakeTimers();
    saveDocument.mockRejectedValueOnce(inTrash());

    act(() => currentEditor().setDocName('Written after the trash'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(currentEditor().inTrash).toEqual({
      trashRoot: { kind: 'document', id: 'doc-1' },
      purgeAfter: '2026-12-15T09:00:00Z',
    });
    // Not a failure to retry: the page says why instead.
    expect(currentEditor().saveError).toBeNull();

    act(() => currentEditor().setDocName('Still writing'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(saveDocument).toHaveBeenCalledTimes(1);

    act(() => currentEditor().markPageRestored('doc-1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(currentEditor().inTrash).toBeNull();
    expect(saveDocument).toHaveBeenCalledTimes(2);
    expect(saveDocument.mock.calls[1]?.[1]).toMatchObject({ name: 'Still writing' });
    expect(saveDocument.mock.calls[1]?.[2]).toBe(etagOf(3));
  });

  it('keeps the edits on this device, rather than saving, when the author leaves a page in the Trash', async () => {
    await mountRemoteDocument();
    act(() => currentEditor().markPageTrashed('doc-1', { trashRoot: { kind: 'document', id: 'doc-1' }, purgeAfter: null }));
    act(() => currentEditor().setDocName('Kept here'));
    readDocument.mockResolvedValueOnce(remoteDoc('Another page'));

    await act(async () => currentEditor().switchTo('doc-2'));

    expect(saveDocument).not.toHaveBeenCalled();
    expect(currentEditor().documentId).toBe('doc-2');
    expect(currentEditor().inTrash).toBeNull();
    expect(JSON.parse(localStorage.getItem(key('unsaved:doc-1')) ?? 'null')).toMatchObject({ doc: { name: 'Kept here' } });
  });

  it('opens this device’s copy of a page in the Trash saying so, rather than that it failed', async () => {
    localStorage.setItem(key('lastDocId'), 'doc-1');
    readDocument.mockRejectedValue(inTrash());
    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );
    await waitFor(() => expect(readDocument).toHaveBeenCalled());
    // No copy of it on this device: the starter page stays, with the notice.
    await waitFor(() => expect(currentEditor().documentLoadNotice?.title).toBe('That page is in the Trash'));
    expect(currentEditor().inTrash).toBeNull();
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
    await waitFor(() => expect(editorRef.current).not.toBeNull());
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
    expect(saveDocument.mock.calls[0]?.[0]).toBe('doc-1');
    expect(saveDocument.mock.calls[0]?.[1]).toMatchObject({ name: 'Saved via shortcut' });
    expect(saveDocument.mock.calls[0]?.[2]).toBe(etagOf(3));
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

  // C4: a response to a save that was in flight during a restore names a head
  // the page is no longer on; adopting it would make every later save stale.
  it('ignores the ETag of a save that was in flight during a restore', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();

    let resolveFirst: ((value: { etag: string }) => void) | undefined;
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

    // The server restores to another version while the save is in flight.
    act(() => currentEditor().adoptRestoredDocument(pageDoc('Restored'), etagOf(6)));
    expect(currentEditor().doc.name).toBe('Restored');

    await act(async () => {
      resolveFirst?.({ etag: etagOf(4) });
      await firstSave;
    });

    // The next save locks on the restored head, not the stale one.
    act(() => currentEditor().setDocName('After restore'));
    await act(async () => currentEditor().saveRemote());
    expect(saveDocument).toHaveBeenCalledTimes(2);
    expect(saveDocument.mock.calls[1]?.[2]).toBe(etagOf(6));
  });

  // M9: an override is a body snapshot of the document open at call time. If
  // the workspace moved on while a queued save was awaited, the PUT must not
  // land on the newly active document.
  it('does not PUT an override body after the workspace moved to another document', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();

    // An in-flight save the override save has to queue behind.
    let resolveFirst: ((value: { etag: string }) => void) | undefined;
    saveDocument
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveFirst = resolve;
        }),
      )
      // The override PUT, if it happens at all, must be observable.
      .mockResolvedValue({ etag: etagOf(7) });

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
    let resolveFlush: ((value: { etag: string }) => void) | undefined;
    saveDocument.mockImplementationOnce(
      () => new Promise(resolve => {
        resolveFlush = resolve;
      }),
    );
    let switched!: Promise<boolean>;
    await act(async () => {
      resolveFirst?.({ etag: etagOf(4) });
      await firstSave;
      switched = currentEditor().switchTo('doc-2');
    });
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveFlush?.({ etag: etagOf(5) });
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
      key('doc:local'),
      JSON.stringify({
        documentId: null,
        etag: null,
        doc: {
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
    expect(currentEditor().canUndo).toBe(false);
    expect(currentEditor().canRedo).toBe(false);

    act(() => currentEditor().removeBlock('p2'));
    expect(currentEditor().blocks.map(b => b.id)).toEqual(['p1']);
    expect(currentEditor().canUndo).toBe(true);
    expect(currentEditor().canRedo).toBe(false);

    act(() => currentEditor().undo());
    expect(currentEditor().blocks.map(b => b.id)).toEqual(['p1', 'p2']);
    expect(currentEditor().canUndo).toBe(false);
    expect(currentEditor().canRedo).toBe(true);

    act(() => currentEditor().redo());
    expect(currentEditor().blocks.map(b => b.id)).toEqual(['p1']);
    expect(currentEditor().canUndo).toBe(true);
    expect(currentEditor().canRedo).toBe(false);
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
      { name: 'Restored', blocks: [{ id: 'r1', type: 'paragraph', html: 'Server copy', children: [] }] },
      etagOf(6),
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
    expect(saveDocument.mock.calls[0]?.[1]).toMatchObject({ name: 'Remote document' });
  });
});

describe('a save the server refuses as out of date (412 stale_head)', () => {
  const conflict = () => new ApiError('The document changed since it was read', 412, {
    code: 'stale_head', status: 412, detail: 'The document changed since it was read', retryable: false,
    expected_head: etagOf(3), current_head: etagOf(9),
  });

  async function editIntoConflict() {
    await mountRemoteDocument();
    saveDocument.mockClear();
    saveDocument.mockRejectedValue(conflict());
    vi.useFakeTimers();
    act(() => currentEditor().setDocName('My edit'));
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(currentEditor().saveConflict).toBe(true);
  }

  it('stops retrying, because the same save is refused every time', async () => {
    await editIntoConflict();
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(currentEditor().saveError).toMatch(/changed somewhere else/i);

    await act(async () => {
      vi.advanceTimersByTime(300000);
      await Promise.resolve();
    });
    expect(saveDocument).toHaveBeenCalledTimes(1);

    // Another edit does not start the refused save again either.
    act(() => currentEditor().setDocName('My second edit'));
    await act(async () => {
      vi.advanceTimersByTime(60000);
      await Promise.resolve();
    });
    expect(saveDocument).toHaveBeenCalledTimes(1);
  });

  it('writes my version over the newer one when I keep mine', async () => {
    await editIntoConflict();
    vi.useRealTimers();
    readDocument.mockResolvedValueOnce(remoteDoc('Their edit', 9));
    saveDocument.mockReset().mockResolvedValue({ etag: etagOf(10) });

    await act(async () => {
      await currentEditor().resolveSaveConflict('mine');
    });

    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(saveDocument.mock.calls[0]?.[1]).toMatchObject({ name: 'My edit' });
    // Over the newer head, which it replaces.
    expect(saveDocument.mock.calls[0]?.[2]).toBe(etagOf(9));
    expect(currentEditor().saveConflict).toBe(false);
    expect(currentEditor().saveError).toBeNull();
    expect(currentEditor().doc.name).toBe('My edit');
    expect(currentEditor().unsavedDraftAt).toBeNull();
  });

  it('leaves nothing pending once my version is saved, so the status reads "Saved"', async () => {
    await editIntoConflict();
    vi.useRealTimers();
    readDocument.mockResolvedValueOnce(remoteDoc('Their edit', 9));
    let finish!: (value: { etag: string }) => void;
    saveDocument.mockReset().mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));

    let keeping!: Promise<void>;
    act(() => {
      keeping = currentEditor().resolveSaveConflict('mine');
    });
    // The page renders while the save is in flight.
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    await act(async () => {
      finish({ etag: etagOf(10) });
      await keeping;
    });

    expect(currentEditor().saveConflict).toBe(false);
    // No autosave was armed for the edit that save carried.
    expect(currentEditor().hasPendingEdits()).toBe(false);
  });

  it('opens the newer version and keeps my edits to bring back', async () => {
    await editIntoConflict();
    vi.useRealTimers();
    readDocument.mockResolvedValueOnce(remoteDoc('Their edit', 9));
    saveDocument.mockReset().mockResolvedValue({ etag: etagOf(10) });

    await act(async () => {
      await currentEditor().resolveSaveConflict('theirs');
    });

    expect(currentEditor().doc.name).toBe('Their edit');
    expect(currentEditor().saveConflict).toBe(false);
    expect(currentEditor().hasPendingEdits()).toBe(false);
    expect(saveDocument).not.toHaveBeenCalled();
    // The same line of history, so pending suggestions are staged again
    // rather than retired as they are after a History restore.
    expect(currentEditor().restoreReason).toBe('newer-version');
    expect(currentEditor().unsavedDraftAt).toEqual(expect.any(Number));

    let restored = false;
    act(() => {
      restored = currentEditor().restoreKeptDraft();
    });
    expect(restored).toBe(true);
    expect(currentEditor().doc.name).toBe('My edit');
    expect(currentEditor().unsavedDraftAt).toBeNull();
    expect(currentEditor().hasPendingEdits()).toBe(true);
    // One step back is the newer version again.
    act(() => currentEditor().undo());
    expect(currentEditor().doc.name).toBe('Their edit');
  });

  it('asks again when someone wrote in between', async () => {
    await editIntoConflict();
    vi.useRealTimers();
    readDocument.mockResolvedValueOnce(remoteDoc('Their edit', 9));

    await act(async () => {
      await currentEditor().resolveSaveConflict('mine');
    });

    expect(currentEditor().saveConflict).toBe(true);
    expect(currentEditor().doc.name).toBe('My edit');
  });
});

describe('edits the server never received', () => {
  it('are kept when a switch could not save them, and offered when the document opens again', async () => {
    await mountRemoteDocument();
    saveDocument.mockReset().mockRejectedValue(new Error('network down'));
    act(() => currentEditor().setDocName('Written offline'));

    readDocument.mockResolvedValueOnce(remoteDoc('Other document', 1));
    await act(async () => {
      await currentEditor().switchTo('doc-2');
    });
    expect(currentEditor().doc.name).toBe('Other document');
    expect(currentEditor().unsavedDraftAt).toBeNull();

    readDocument.mockResolvedValueOnce(remoteDoc('Remote document'));
    await act(async () => {
      await currentEditor().switchTo('doc-1');
    });
    // The server copy is what opens; the kept edits are an offer.
    expect(currentEditor().doc.name).toBe('Remote document');
    expect(currentEditor().unsavedDraftAt).toEqual(expect.any(Number));

    act(() => {
      currentEditor().restoreKeptDraft();
    });
    expect(currentEditor().doc.name).toBe('Written offline');
  });

  it('are dropped for good when the author discards them', async () => {
    await mountRemoteDocument();
    saveDocument.mockReset().mockRejectedValue(new Error('network down'));
    act(() => currentEditor().setDocName('Written offline'));
    readDocument.mockResolvedValueOnce(remoteDoc('Other document', 1));
    await act(async () => {
      await currentEditor().switchTo('doc-2');
    });
    readDocument.mockResolvedValueOnce(remoteDoc('Remote document'));
    await act(async () => {
      await currentEditor().switchTo('doc-1');
    });

    act(() => currentEditor().discardKeptDraft());
    expect(currentEditor().unsavedDraftAt).toBeNull();
    expect(localStorage.getItem(key('unsaved:doc-1'))).toBeNull();
    expect(currentEditor().doc.name).toBe('Remote document');
  });

  it('are kept when the tab is put away with unsaved work', async () => {
    await mountRemoteDocument();
    act(() => currentEditor().setDocName('Closing soon'));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    const kept = JSON.parse(localStorage.getItem(key('unsaved:doc-1')) ?? 'null');
    expect(kept).toMatchObject({ documentId: 'doc-1', doc: { name: 'Closing soon' } });
  });

  it('are not kept for a document that is saved', async () => {
    await mountRemoteDocument();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(localStorage.getItem(key('unsaved:doc-1'))).toBeNull();
  });

  it('are forgotten once a later save of the document goes through', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();
    vi.useFakeTimers();
    act(() => currentEditor().setDocName('Saved in the end'));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(localStorage.getItem(key('unsaved:doc-1'))).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(key('unsaved:doc-1'))).toBeNull();
  });

  it('are not offered when the server already has the same text', async () => {
    localStorage.setItem(key('unsaved:doc-1'), JSON.stringify({
      documentId: 'doc-1',
      doc: pageDoc('Remote document'),
      savedAt: 1,
    }));
    await mountRemoteDocument();
    expect(currentEditor().unsavedDraftAt).toBeNull();
    expect(localStorage.getItem(key('unsaved:doc-1'))).toBeNull();
  });
});

/**
 * B-13: an edit inside the 5-second autosave window used to be lost when the
 * editor unmounted (a scope remount, the surface going away) or the author
 * signed out. Only `pagehide` kept it.
 */
describe('edits inside the autosave window when the editor goes away', () => {
  function storedUserKeys(): string[] {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const stored = localStorage.key(index);
      if (stored?.startsWith('colwrite:user:') || stored?.startsWith('colwrite:ws:')) keys.push(stored);
    }
    return keys;
  }

  it('are saved when the editor unmounts, and kept on this device until the save lands', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();
    const saving = deferred<{ etag: string }>();
    saveDocument.mockReturnValueOnce(saving.promise);

    act(() => currentEditor().setDocName('Typed just before leaving'));
    expect(saveDocument).not.toHaveBeenCalled();
    cleanup();

    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(saveDocument.mock.calls[0]?.[0]).toBe('doc-1');
    expect(saveDocument.mock.calls[0]?.[1]).toMatchObject({ name: 'Typed just before leaving' });
    expect(saveDocument.mock.calls[0]?.[2]).toBe(etagOf(3));
    // The save may never finish (the tab closing next), so the body is kept first.
    const kept = JSON.parse(localStorage.getItem(key('unsaved:doc-1')) ?? 'null');
    expect(kept).toMatchObject({ documentId: 'doc-1', doc: { name: 'Typed just before leaving' } });

    await act(async () => {
      saving.resolve({ etag: etagOf(4) });
      await saving.promise;
    });
    expect(localStorage.getItem(key('unsaved:doc-1'))).toBeNull();
  });

  it('are offered back when the save on unmount fails and the page opens again', async () => {
    await mountRemoteDocument();
    saveDocument.mockReset().mockRejectedValue(new Error('network down'));

    act(() => currentEditor().setDocName('Written before a remount'));
    cleanup();
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveDocument).toHaveBeenCalledTimes(1);

    readDocument.mockResolvedValueOnce(remoteDoc('Remote document'));
    render(
      <EditorProvider>
        <CaptureEditor />
      </EditorProvider>,
    );
    // The server copy opens; the edits it never received are an offer.
    await waitFor(() => expect(currentEditor().unsavedDraftAt).toEqual(expect.any(Number)));
    expect(currentEditor().doc.name).toBe('Remote document');
    act(() => {
      currentEditor().restoreKeptDraft();
    });
    expect(currentEditor().doc.name).toBe('Written before a remount');
  });

  it('are not saved on unmount when nothing was edited', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();
    cleanup();
    expect(saveDocument).not.toHaveBeenCalled();
    expect(localStorage.getItem(key('unsaved:doc-1'))).toBeNull();
  });

  it('are sent before a sign-out clears the account, and nothing is written after it', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();

    act(() => currentEditor().setDocName('Typed before signing out'));
    await act(async () => {
      await flushPendingSaves();
    });
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(saveDocument.mock.calls[0]?.[1]).toMatchObject({ name: 'Typed before signing out' });

    // What `clearLocalSession` does: end the session, clear the account's keys,
    // and the editor unmounts. A late edit must not be saved or kept.
    act(() => currentEditor().setDocName('Typed while signing out'));
    endPendingSaves();
    localStorage.clear();
    cleanup();
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(storedUserKeys()).toEqual([]);
  });

  it('are kept, without holding up a new page, when creating one cannot save them', async () => {
    await mountRemoteDocument();
    saveDocument.mockReset().mockRejectedValue(new Error('network down'));
    act(() => currentEditor().setDocName('Not saved yet'));

    await act(async () => {
      await currentEditor().createAndSwitch({ name: 'Fresh page', blocks: [] });
    });

    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(currentEditor().documentId).toBe('created-doc');
    expect(currentEditor().doc.name).toBe('Fresh page');
    const kept = JSON.parse(localStorage.getItem(key('unsaved:doc-1')) ?? 'null');
    expect(kept).toMatchObject({ documentId: 'doc-1', doc: { name: 'Not saved yet' } });
  });

  it('are saved by flushPendingSave, which reports a failure without throwing', async () => {
    await mountRemoteDocument();
    saveDocument.mockClear();
    act(() => currentEditor().setDocName('Flushed on demand'));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await currentEditor().flushPendingSave();
    });
    expect(saved).toBe(true);
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(currentEditor().hasPendingEdits()).toBe(false);

    saveDocument.mockRejectedValueOnce(new Error('network down'));
    act(() => currentEditor().setDocName('Flush that fails'));
    await act(async () => {
      saved = await currentEditor().flushPendingSave();
    });
    expect(saved).toBe(false);
    expect(currentEditor().saveError).toMatch(/could not be saved/i);
    expect(localStorage.getItem(key('unsaved:doc-1'))).not.toBeNull();
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
