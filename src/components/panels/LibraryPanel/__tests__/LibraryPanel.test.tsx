import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { makeCollection, makeResource } from '@/services/__tests__/resourceFixtures';
import type {
  CollectionItem,
  ResourceItem,
  ResourceSearchResponse,
} from '@/services/resources';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  search: vi.fn(),
  read: vi.fn(),
  upload: vi.fn(),
  extract: vi.fn(),
  remove: vi.fn(),
  attach: vi.fn(),
  collectionTree: vi.fn(),
  collectionDetail: vi.fn(),
  createCollection: vi.fn(),
  createChildCollection: vi.fn(),
  updateCollection: vi.fn(),
  moveCollection: vi.fn(),
  previewCollection: vi.fn(),
  deleteCollection: vi.fn(),
  attachCollection: vi.fn(),
  detachCollection: vi.fn(),
  documentId: 'doc-1' as string | null,
}));

// The editor context is stubbed rather than mounted: the panel uses it only
// to learn which document is open, and a real EditorProvider would drag the
// whole document-loading stack into a test about a file list.
vi.mock('@/editor', () => ({ useEditor: () => ({ documentId: mocks.documentId }) }));

vi.mock('@/services/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/resources')>();
  return {
    ...actual,
    listResources: mocks.list,
    getResource: mocks.get,
    searchResources: mocks.search,
    readResourceMarkdown: mocks.read,
    uploadResource: mocks.upload,
    extractResource: mocks.extract,
    deleteResource: mocks.remove,
    attachResource: mocks.attach,
    listCollectionTree: mocks.collectionTree,
    getCollectionDetail: mocks.collectionDetail,
    createCollection: mocks.createCollection,
    createChildCollection: mocks.createChildCollection,
    updateCollection: mocks.updateCollection,
    moveCollectionParent: mocks.moveCollection,
    previewCollectionDelete: mocks.previewCollection,
    deleteCollectionRecursive: mocks.deleteCollection,
    attachCollectionDocument: mocks.attachCollection,
    detachCollectionDocument: mocks.detachCollection,
  };
});

import { LibraryPanel } from '../LibraryPanel';

function listing(resources: ResourceItem[], scope = 'context') {
  return { resources, count: resources.length, scope, limit: 50, offset: 0 };
}

function collectionPage(parentId: number | null, collections: CollectionItem[]) {
  return {
    collections,
    count: collections.length,
    parent_id: parentId,
    limit: 50,
    offset: 0,
    next_offset: null,
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderPanel() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <LibraryPanel />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

/**
 * The full-text box, whichever scope it is currently describing.
 *
 * Its accessible name tracks the scope ("Search inside your PDFs" at the top
 * level, "Search this folder and its subfolders" inside one), so matching the
 * prefix is what keeps this stable. The name filter is also a searchbox, but it
 * is called "Filter the list by file name".
 */
function searchBox(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: /^Search/ }) as HTMLInputElement;
}

/** Type into the full-text box and submit it. */
async function runSearch(term: string) {
  fireEvent.change(searchBox(), { target: { value: term } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
  });
}

beforeEach(() => {
  mocks.documentId = 'doc-1';
  mocks.list.mockReset().mockResolvedValue(listing([]));
  mocks.get.mockReset().mockImplementation(async (id: number) => makeResource({ id }));
  mocks.search.mockReset();
  // Any resource that reaches `ready` is read immediately by the detail view,
  // including one that only got there by being retried — so this needs a
  // default rather than a per-test value.
  mocks.read.mockReset().mockResolvedValue({
    resource: makeResource(),
    text: '',
    offset: 0,
    returned_chars: 0,
    total_chars: 0,
    next_offset: null,
    truncated: false,
  });
  mocks.upload.mockReset();
  mocks.extract.mockReset();
  mocks.remove.mockReset();
  mocks.attach.mockReset();
  mocks.collectionTree.mockReset().mockImplementation(
    async ({ parentId }: { parentId?: number | null }) => collectionPage(parentId ?? null, []),
  );
  mocks.collectionDetail.mockReset();
  mocks.createCollection.mockReset();
  mocks.createChildCollection.mockReset();
  mocks.updateCollection.mockReset();
  mocks.moveCollection.mockReset();
  mocks.previewCollection.mockReset();
  mocks.deleteCollection.mockReset();
  mocks.attachCollection.mockReset();
  mocks.detachCollection.mockReset();
});

afterEach(cleanup);

describe('LibraryPanel', () => {
  it('loads the context scope, not the whole library', async () => {
    // `context` is what the assistant can read for this document. Listing
    // everything the account owns would show files the agent will not see,
    // which is the confusion this panel exists to remove.
    renderPanel();

    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'context', documentId: 'doc-1' }),
    );
  });

  it('falls back to the whole library when the document is unsaved', async () => {
    mocks.documentId = null;
    renderPanel();

    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'library', documentId: null }),
    );
    expect(screen.getByText(/save this document to attach files/i)).toBeTruthy();
  });

  it('shows each file with whether the assistant can read it', async () => {
    mocks.list.mockResolvedValue(
      listing([
        makeResource({ id: 1, filename: 'ready.pdf', title: null }),
        makeResource({
          id: 2,
          filename: 'scan.pdf',
          title: null,
          extraction_status: 'unsupported',
          extraction_error: 'no text layer',
          extraction_pages: null,
        }),
      ]),
    );

    renderPanel();

    expect(await screen.findByText('ready.pdf')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    // A scan uploads perfectly and is never readable; "stored" and "usable"
    // have to be visibly different states.
    expect(screen.getByText('No text')).toBeTruthy();
  });

  it('opens a file and shows the same text the assistant gets', async () => {
    mocks.list.mockResolvedValue(
      listing([makeResource({ id: 5, filename: 'paper.pdf', title: 'Attention' })]),
    );
    mocks.read.mockResolvedValue({
      resource: makeResource({ id: 5 }),
      text: 'Scaled dot-product attention.',
      offset: 0,
      returned_chars: 29,
      total_chars: 29,
      next_offset: null,
      truncated: false,
    });

    renderPanel();
    const row = await screen.findByText('Attention');
    await act(async () => {
      fireEvent.click(row);
    });

    expect(await screen.findByText(/scaled dot-product attention/i)).toBeTruthy();
    expect(mocks.read).toHaveBeenCalledWith(5, expect.objectContaining({ offset: 0 }));
    const back = screen.getByRole('button', { name: 'Back to the file list' });
    await waitFor(() => expect(document.activeElement).toBe(back));
    await act(async () => {
      fireEvent.click(back);
    });
    const restored = await screen.findByText('Attention');
    await waitFor(() => expect(document.activeElement).toBe(restored.closest('button')));
  });

  it('names the files a search could not read', async () => {
    mocks.list.mockResolvedValue(
      listing([
        makeResource({
          id: 9,
          filename: 'queued.pdf',
          title: null,
          extraction_status: 'pending',
        }),
      ]),
    );
    mocks.search.mockResolvedValue({
      query: 'transformer',
      scope: 'context',
      matches: [],
      match_count: 0,
      resources_searched: 0,
      resources_skipped: [
        { resource_id: 9, filename: 'queued.pdf', extraction_status: 'pending' },
      ],
      truncated: false,
      next_offset: null,
    });

    renderPanel();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await runSearch('transformer');

    // Zero matches over a library that was still converting is not the same
    // answer as zero matches over one that was fully readable.
    const notice = await screen.findByText(/1 file was not searched/i);
    const alert = notice.closest('[role="status"]') as HTMLElement;
    expect(within(alert).getByText('queued.pdf')).toBeTruthy();
    expect(within(alert).getByText('Queued')).toBeTruthy();
  });

  it('ignores a search response from a location the user has left', async () => {
    const staleSearch = deferred<ResourceSearchResponse>();
    mocks.search.mockReturnValue(staleSearch.promise);

    renderPanel();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await runSearch('old location');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'All' }));
    });

    staleSearch.resolve({
      query: 'old location',
      scope: 'context',
      matches: [
        {
          resource_id: 91,
          filename: 'stale.pdf',
          title: null,
          offset: 0,
          excerpt: 'stale result from the old location',
        },
      ],
      match_count: 1,
      resources_searched: 1,
      resources_skipped: [],
      truncated: false,
      next_offset: null,
    });
    await act(async () => {
      await staleSearch.promise;
    });

    expect(screen.queryByText(/stale result from the old location/i)).toBeNull();
    expect(searchBox().value).toBe('');
  });

  it('continues a scoped search past the first twenty-five resources', async () => {
    mocks.search
      .mockResolvedValueOnce({
        query: 'oldest',
        scope: 'context',
        matches: [],
        match_count: 0,
        resources_searched: 25,
        resources_skipped: [],
        truncated: false,
        next_offset: 25,
      })
      .mockResolvedValueOnce({
        query: 'oldest',
        scope: 'context',
        matches: [
          {
            resource_id: 26,
            filename: 'oldest.pdf',
            title: null,
            offset: 7,
            excerpt: 'the oldest matching phrase',
          },
        ],
        match_count: 1,
        resources_searched: 1,
        resources_skipped: [],
        truncated: false,
        next_offset: null,
      });

    renderPanel();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await runSearch('oldest');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Show more matches' }));
    });

    expect(mocks.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'oldest', offset: 25, scope: 'context' }),
    );
    // Queried by accessible name rather than by text node: the excerpt marks
    // the search term, so its text is split across <mark> boundaries.
    expect(
      await screen.findByRole('button', { name: /the oldest matching phrase/i }),
    ).toBeTruthy();
  });

  it('opens a search result that is outside the currently loaded page', async () => {
    mocks.list.mockResolvedValue(listing([makeResource({ id: 1, filename: 'loaded.pdf' })]));
    mocks.get.mockResolvedValue(
      makeResource({ id: 99, filename: 'outside.pdf', title: 'Outside result' }),
    );
    mocks.search.mockResolvedValue({
      query: 'outside',
      scope: 'context',
      matches: [
        {
          resource_id: 99,
          filename: 'outside.pdf',
          title: 'Outside result',
          offset: 12,
          excerpt: 'outside the loaded page',
        },
      ],
      match_count: 1,
      resources_searched: 2,
      resources_skipped: [],
      truncated: false,
      next_offset: null,
    });

    renderPanel();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await runSearch('outside');
    await act(async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: /outside the loaded page/i }),
      );
    });

    expect(mocks.get).toHaveBeenCalledWith(99);
    expect(await screen.findByText('Outside result')).toBeTruthy();
  });

  it('opens a match with a lead-in and the term marked', async () => {
    mocks.list.mockResolvedValue(
      listing([makeResource({ id: 3, filename: 'paper.pdf', title: null })]),
    );
    mocks.search.mockResolvedValue({
      query: 'gradient',
      scope: 'context',
      matches: [
        {
          resource_id: 3,
          filename: 'paper.pdf',
          title: null,
          offset: 5_000,
          excerpt: '…the gradient descends…',
        },
      ],
      match_count: 1,
      resources_searched: 1,
      resources_skipped: [],
      truncated: false,
      next_offset: null,
    });
    mocks.read.mockResolvedValue({
      resource: makeResource({ id: 3 }),
      text: 'we compute the gradient of the loss',
      offset: 3_800,
      returned_chars: 35,
      total_chars: 40_000,
      next_offset: 3_835,
      truncated: false,
    });

    renderPanel();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await runSearch('gradient');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /the gradient descends/i }));
    });

    await waitFor(() => expect(mocks.read).toHaveBeenCalled());
    // Read with a lead-in rather than at the match itself: a term on the very
    // first line is the one position a quote cannot be judged from.
    const [, options] = mocks.read.mock.calls.at(-1) as [number, { offset: number }];
    expect(options.offset).toBeLessThan(5_000);
    expect(options.offset).toBeGreaterThan(0);

    await waitFor(() => expect(document.querySelectorAll('mark').length).toBe(1));
    expect(document.querySelector('mark')?.textContent).toBe('gradient');
  });

  it('retries a failed conversion without forcing it', async () => {
    mocks.list.mockResolvedValue(
      listing([
        makeResource({
          id: 8,
          filename: 'timeout.pdf',
          title: null,
          extraction_status: 'failed',
          extraction_error: 'Jina Reader timed out after 120s',
        }),
      ]),
    );
    mocks.extract.mockResolvedValue(makeResource({ id: 8 }));

    renderPanel();
    const row = await screen.findByText('timeout.pdf');
    await act(async () => {
      fireEvent.click(row);
    });

    expect(screen.getByText(/jina reader timed out/i)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /convert now/i }));
    });

    // `failed` is transient, so a plain re-extract is enough — and forcing
    // would discard text a plain retry could still find.
    expect(mocks.extract).toHaveBeenCalledWith(8, { force: false });
  });

  it('forces the retry for a file marked unsupported', async () => {
    mocks.list.mockResolvedValue(
      listing([
        makeResource({
          id: 8,
          filename: 'scan.pdf',
          title: null,
          extraction_status: 'unsupported',
          extraction_error: 'most likely a scan that needs OCR',
        }),
      ]),
    );
    mocks.extract.mockResolvedValue(
      makeResource({ id: 8, extraction_status: 'unsupported' }),
    );

    renderPanel();
    const row = await screen.findByText('scan.pdf');
    await act(async () => {
      fireEvent.click(row);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /try converting anyway/i }));
    });

    // `unsupported` is sticky by design: only an explicit forced attempt runs
    // the provider again.
    expect(mocks.extract).toHaveBeenCalledWith(8, { force: true });
  });

  it('uploads through the API rather than keeping the file in the tab', async () => {
    mocks.upload.mockResolvedValue(
      makeResource({
        id: 11,
        filename: 'new.pdf',
        title: null,
        extraction_status: 'pending',
      }),
    );

    renderPanel();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());

    const file = new File(['%PDF-1.7'], 'new.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Add PDFs to your library'), {
        target: { files: [file] },
      });
    });

    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    expect(mocks.upload.mock.calls[0][0]).toBe(file);
    // Under "Available" a new file belongs to the shared library, where every
    // one of the author's documents can reach it.
    expect(mocks.upload.mock.calls[0][1]).toEqual({ documentId: null });
    expect(await screen.findByText('new.pdf')).toBeTruthy();
  });

  it('attaches an upload to the document in the attached scope', async () => {
    mocks.upload.mockResolvedValue(makeResource({ id: 12, filename: 'new.pdf', title: null }));

    renderPanel();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Attached' }));
    });
    const file = new File(['%PDF-1.7'], 'new.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Add PDFs to your library'), {
        target: { files: [file] },
      });
    });

    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    expect(mocks.upload.mock.calls[0][1]).toEqual({ documentId: 'doc-1' });
  });

  it('uploads to Unfiled when the virtual root is selected', async () => {
    mocks.upload.mockResolvedValue(makeResource({ id: 13, filename: 'root.pdf', title: null }));

    renderPanel();
    const unfiled = await screen.findByRole('treeitem', { name: 'Unfiled' });
    await act(async () => {
      fireEvent.click(unfiled);
    });
    const file = new File(['%PDF-1.7'], 'root.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Add PDFs to your library'), {
        target: { files: [file] },
      });
    });

    expect(mocks.upload).toHaveBeenCalledWith(file, { documentId: null });
  });

  it('reloads when the scope changes', async () => {
    renderPanel();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'All' }));
    });

    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.list.mock.calls[1][0]).toMatchObject({ scope: 'library' });
  });

  it('reports a failed load instead of showing an empty library', async () => {
    mocks.list.mockRejectedValue(new Error('Network unreachable'));

    renderPanel();

    expect(await screen.findByText('Network unreachable')).toBeTruthy();
    expect(screen.queryByText(/your library is empty/i)).toBeNull();
  });

  it('does not show an old folder error over a newer successful selection', async () => {
    const folderA = makeCollection({ id: 7, name: 'Folder A' });
    const folderB = makeCollection({ id: 8, name: 'Folder B' });
    const staleA = deferred<Awaited<ReturnType<typeof mocks.collectionDetail>>>();
    mocks.collectionTree.mockImplementation(
      async ({ parentId }: { parentId?: number | null }) =>
        collectionPage(parentId ?? null, parentId == null ? [folderA, folderB] : []),
    );
    mocks.collectionDetail.mockImplementation((collectionId: number) =>
      collectionId === 7
        ? staleA.promise
        : Promise.resolve({
            collection: folderB,
            path: [{ id: 8, parent_id: null, name: 'Folder B', depth: 1 }],
            attachment: null,
          }),
    );

    renderPanel();
    const a = await screen.findByRole('treeitem', { name: /Folder A/ });
    const b = screen.getByRole('treeitem', { name: /Folder B/ });
    fireEvent.click(a);
    await act(async () => {
      fireEvent.click(b);
    });
    staleA.reject(new Error('Folder A failed late'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('heading', { name: 'Folder B' })).toBeTruthy();
    expect(screen.queryByText('Folder A failed late')).toBeNull();
  });

  it('uploads into the selected folder and searches its subtree recursively', async () => {
    const folder = makeCollection({ id: 7, name: 'Methods', resource_count: 0 });
    mocks.collectionTree.mockImplementation(
      async ({ parentId }: { parentId?: number | null }) =>
        collectionPage(parentId ?? null, parentId == null ? [folder] : []),
    );
    mocks.collectionDetail.mockResolvedValue({
      collection: folder,
      path: [{ id: 7, parent_id: null, name: 'Methods', depth: 1 }],
      attachment: null,
    });
    mocks.upload.mockResolvedValue(
      makeResource({ id: 20, filename: 'methods.pdf', collection_id: 7, collection_name: 'Methods' }),
    );
    mocks.search.mockResolvedValue({
      query: 'sampling',
      scope: 'collection_recursive',
      matches: [],
      match_count: 0,
      resources_searched: 0,
      resources_skipped: [],
      truncated: false,
      next_offset: null,
    });

    renderPanel();
    const folderRow = await screen.findByRole('treeitem', { name: /Methods/ });
    await act(async () => {
      fireEvent.click(folderRow);
    });

    const file = new File(['%PDF-1.7'], 'methods.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Add PDFs to your library'), {
        target: { files: [file] },
      });
    });
    expect(mocks.upload).toHaveBeenCalledWith(file, { collectionId: 7 });

    await runSearch('sampling');
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'sampling',
        scope: 'collection_recursive',
        collectionId: 7,
      }),
    );
  });

  it('warns when permanent folder deletion leaves storage cleanup pending', async () => {
    const folder = makeCollection({ id: 7, name: 'Delete me' });
    const preview = {
      collection_id: 7,
      status: 'ready',
      collection_count: 1,
      membership_count: 0,
      resource_count: 1,
      resource_bytes: 1024,
    };
    mocks.collectionTree.mockImplementation(
      async ({ parentId }: { parentId?: number | null }) =>
        collectionPage(parentId ?? null, parentId == null ? [folder] : []),
    );
    mocks.collectionDetail.mockResolvedValue({
      collection: folder,
      path: [{ id: 7, parent_id: null, name: 'Delete me', depth: 1 }],
      attachment: null,
    });
    mocks.previewCollection.mockResolvedValue(preview);
    mocks.deleteCollection.mockResolvedValue({
      status: 'success',
      message: 'Collection subtree deleted',
      collection_count: 1,
      membership_count: 0,
      resource_count: 1,
      resource_bytes: 1024,
      cleanup_pending_count: 1,
    });

    renderPanel();
    fireEvent.click(await screen.findByRole('treeitem', { name: /Delete me/ }));
    fireEvent.pointerDown(
      await screen.findByRole('button', { name: 'Actions for Delete me' }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete folder and everything in it' }));
    const input = await screen.findByLabelText('Type Delete me to confirm deletion');
    fireEvent.change(input, { target: { value: 'Delete me' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete folder and contents' }));
    });

    expect(mocks.deleteCollection).toHaveBeenCalledWith(7, preview);
    expect(await screen.findByText('Folder deleted; storage cleanup is still pending')).toBeTruthy();
  });

  it('keeps resource details mounted and restores focus after a picker move', async () => {
    const folder = makeCollection({ id: 7, name: 'Target folder' });
    const resource = makeResource({ id: 41, filename: 'movable.pdf', title: null });
    const moved = {
      ...resource,
      collection_id: 7,
      collection_name: 'Target folder',
    };
    let didMove = false;
    mocks.list.mockImplementation(async () => listing([didMove ? moved : resource]));
    mocks.collectionTree.mockImplementation(
      async ({ parentId }: { parentId?: number | null }) =>
        collectionPage(parentId ?? null, parentId == null ? [folder] : []),
    );
    mocks.attach.mockImplementation(async () => {
      didMove = true;
      return moved;
    });

    renderPanel();
    const row = await screen.findByText('movable.pdf');
    await act(async () => {
      fireEvent.click(row);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move…' }));
    fireEvent.click(await screen.findByRole('treeitem', { name: /Target folder/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
    });

    const moveButton = await screen.findByRole('button', { name: 'Move…' });
    await waitFor(() => expect(document.activeElement).toBe(moveButton));
    expect(screen.getByText('Target folder')).toBeTruthy();
  });

  it('clears scoped search results after moving a matching resource', async () => {
    const resource = makeResource({
      id: 30,
      filename: 'matching.pdf',
      title: null,
      document_id: 'doc-1',
      document_name: 'Draft',
    });
    mocks.list.mockResolvedValue(listing([resource]));
    mocks.search.mockResolvedValue({
      query: 'matching',
      scope: 'context',
      matches: [
        {
          resource_id: 30,
          filename: 'matching.pdf',
          title: null,
          offset: 0,
          excerpt: 'matching text in the old scope',
        },
      ],
      match_count: 1,
      resources_searched: 1,
      resources_skipped: [],
      truncated: false,
      next_offset: null,
    });
    mocks.attach.mockResolvedValue({
      ...resource,
      document_id: null,
      document_name: null,
    });

    renderPanel();
    await runSearch('matching');
    await act(async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: /matching text in the old scope/i }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Detach to Unfiled' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to the file list' }));
    });

    expect(
      screen.queryByRole('button', { name: /matching text in the old scope/i }),
    ).toBeNull();
    expect(searchBox().value).toBe('');
  });

  it('removes a stale attached row after detaching it to Unfiled', async () => {
    const resource = makeResource({
      id: 31,
      filename: 'attached.pdf',
      title: null,
      document_id: 'doc-1',
      document_name: 'Draft',
    });
    let detached = false;
    mocks.list.mockImplementation(async ({ scope }: { scope: string }) =>
      listing(scope === 'document' && detached ? [] : [resource], scope),
    );
    mocks.attach.mockImplementation(async () => {
      detached = true;
      return { ...resource, document_id: null, document_name: null };
    });

    renderPanel();
    await screen.findByText('attached.pdf');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Attached' }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText('attached.pdf'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Detach to Unfiled' }));
    });
    expect(mocks.attach).toHaveBeenCalledWith(31, {});

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to the file list' }));
    });
    await waitFor(() => expect(screen.queryByText('attached.pdf')).toBeNull());
  });
});
