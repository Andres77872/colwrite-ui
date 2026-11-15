import { itemAt } from '@/lib/itemAt';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { http, jsonOf, multipartFields, pathOf, problem, queryOf, recordRequests, respond, server } from '@/__tests__/server';
import { TestWorkspace } from '@/__tests__/workspace';
import { inCollection, makeCollection, makeCollectionDetail, makeResource, onPage } from '@/data/__tests__/resourceFixtures';
import type {
  CollectionDetail,
  CollectionItem,
  PdfGrant,
  PdfGrantState,
  ResourceItem,
  ResourceSearchResponse,
} from '@/data/resources';
import { PanelsContext, type PanelsContextValue, type SidebarIntent } from '../../panelsContextState';
import { setLibraryDragPayload } from '../collectionDnd';

/*
 * The server's resource, collection and PDF-grant routes, by what each
 * request names: a list or search by its query, a resource or collection by
 * its id (and the body or query it sends), a page's grants by the page, a
 * grant by both ids, an upload by its form fields.
 */
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  search: vi.fn(),
  read: vi.fn(),
  upload: vi.fn(),
  extract: vi.fn(),
  rename: vi.fn(),
  trash: vi.fn(),
  restore: vi.fn(),
  attach: vi.fn(),
  collectionTree: vi.fn(),
  collectionDetail: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  moveCollection: vi.fn(),
  previewCollection: vi.fn(),
  trashCollection: vi.fn(),
  grants: vi.fn(),
  attachCollection: vi.fn(),
  detachCollection: vi.fn(),
  ensure: vi.fn(),
  switchTo: vi.fn(async () => true),
  documentId: 'doc-1' as string | null,
}));

// The editor is stubbed rather than mounted: the Library only needs to know
// which page is open and how to save it when it has never been saved.
vi.mock('@/editor', () => ({
  useDocumentId: () => mocks.documentId,
  useDocumentActions: () => ({ ensureRemoteDocument: mocks.ensure, switchTo: mocks.switchTo }),
  useDocumentSession: () => ({ documentId: mocks.documentId, loadingDocumentId: null }),
}));


import { LibraryPanel } from '../LibraryPanel';

function listing(resources: ResourceItem[]) {
  return { items: resources, next_cursor: null };
}

function collectionPage(collections: CollectionItem[]) {
  return { items: collections, next_cursor: null };
}

function searchResult(overrides: Partial<ResourceSearchResponse> = {}): ResourceSearchResponse {
  return {
    query: 'term',
    scope: 'context',
    items: [],
    resources_searched: 0,
    resources_skipped: [],
    truncated: false,
    next_cursor: null,
    ...overrides,
  };
}

/** A collection's detail, its path ending at itself. */
function detailOf(
  collection: CollectionItem,
  path: Array<{ id: number; name: string }> = [{ id: collection.id, name: collection.name }],
): CollectionDetail {
  return makeCollectionDetail({ id: collection.id, name: collection.name, parent_id: collection.parent_id, depth: path.length, path });
}

/** A collection a page uses, as `GET …/pdf-grants` lists it. */
function grantOf(path: Array<{ id: number; name: string }>): PdfGrant {
  const own = itemAt(path, path.length - 1);
  return { collection_id: own.id, name: own.name, origin: 'manual', path };
}

/** A page's grant state for one collection, as a grant change answers it. */
function grantState(collectionId: number, via: { id: number; name: string } | null): PdfGrantState {
  return {
    collection_id: collectionId,
    direct: via?.id === collectionId,
    effective: via !== null,
    via_collection_id: via?.id ?? null,
    via_collection_name: via?.name ?? null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function dataTransfer(files: File[] = []) {
  const values = new Map<string, string>();
  return {
    files: Object.assign([...files], { item: (index: number) => files[index] ?? null }) as unknown as FileList,
    get types() {
      return [...values.keys(), ...(files.length > 0 ? ['Files'] : [])];
    },
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
  } as unknown as DataTransfer;
}

function Providers({ children, intent = null }: { children: ReactNode; intent?: (SidebarIntent & { id: number }) | null }) {
  return (
    <TestWorkspace>
      <ToastProvider>
        <TooltipProvider>
          <ConfirmProvider>
            <PanelsContext.Provider value={{ intent } as PanelsContextValue}>{children}</PanelsContext.Provider>
          </ConfirmProvider>
        </TooltipProvider>
      </ToastProvider>
    </TestWorkspace>
  );
}

function renderPanel(intent: (SidebarIntent & { id: number }) | null = null) {
  return render(
    <Providers intent={intent}>
      <LibraryPanel />
    </Providers>,
  );
}

const searchBox = () => screen.getByRole('searchbox') as HTMLInputElement;
const pdf = (name: string) => new File(['%PDF-1.7'], name, { type: 'application/pdf' });

async function chooseFiles(files: File[]) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/^Choose PDFs to upload to/), { target: { files } });
  });
}

async function openBrowse() {
  await act(async () => {
    fireEvent.click(screen.getByRole('radio', { name: 'Browse' }));
  });
}

async function openCollectionRow(name: RegExp) {
  const row = await screen.findByRole('button', { name });
  await act(async () => {
    fireEvent.click(row);
  });
}

async function searchInside(term: string) {
  fireEvent.change(searchBox(), { target: { value: term } });
  await act(async () => {
    fireEvent.click(screen.getByRole('radio', { name: 'Inside PDFs' }));
  });
}

beforeEach(() => {
  mocks.documentId = 'doc-1';
  mocks.ensure.mockReset().mockImplementation(async () => mocks.documentId ?? 'doc-new');
  mocks.list.mockReset().mockResolvedValue(listing([]));
  mocks.get.mockReset().mockImplementation(async (id: number) => makeResource({ id }));
  mocks.search.mockReset().mockResolvedValue(searchResult());
  // A PDF that reaches `ready` is read at once by the detail view.
  mocks.read.mockReset().mockResolvedValue({
    resource: makeResource(),
    text: '',
    offset: 0,
    returned_chars: 0,
    total_chars: 0,
    next_offset: null,
    truncated: false,
  });
  mocks.upload.mockReset().mockImplementation(async () => makeResource({ id: 50, filename: 'uploaded.pdf' }));
  mocks.extract.mockReset();
  mocks.rename.mockReset();
  mocks.trash.mockReset();
  mocks.restore.mockReset();
  mocks.attach.mockReset();
  mocks.collectionTree.mockReset().mockResolvedValue(collectionPage([]));
  mocks.collectionDetail.mockReset();
  mocks.createCollection.mockReset();
  mocks.updateCollection.mockReset();
  mocks.moveCollection.mockReset();
  mocks.previewCollection.mockReset();
  mocks.trashCollection.mockReset();
  mocks.grants.mockReset().mockResolvedValue([]);
  mocks.attachCollection.mockReset();
  mocks.detachCollection.mockReset();
  const id = (value: string | undefined) => Number(value);
  const resources = '/workspaces/{workspace_id}/resources';
  const collections = '/workspaces/{workspace_id}/collections';
  const grants = '/workspaces/{workspace_id}/documents/{document_id}/pdf-grants';
  server.use(
    http.get(resources, ({ request, response }) => respond(() => mocks.list(queryOf(request)), (body) => response(200).json(body))),
    http.get(`${resources}/search`, ({ request, response }) => respond(() => mocks.search(queryOf(request)), (body) => response(200).json(body))),
    http.get(`${resources}/{resource_id}`, ({ params, response }) =>
      respond(() => mocks.get(id(params.resource_id)), (resource) => response(200).json(resource))),
    http.get(`${resources}/{resource_id}/markdown`, ({ params, request, response }) =>
      respond(() => mocks.read(id(params.resource_id), queryOf(request)), (body) => response(200).json(body))),
    http.post(resources, async ({ request, response }) => {
      // Under jsdom a file loses its name on the way into a `Request`; the target is what is left.
      const { file: _file, ...target } = await multipartFields(request);
      return respond(() => mocks.upload(target), (resource) => response(201).json(resource));
    }),
    http.post(`${resources}/{resource_id}/extract`, ({ params, request, response }) =>
      respond(() => mocks.extract(id(params.resource_id), queryOf(request)), (resource) => response(200).json(resource))),
    http.patch(`${resources}/{resource_id}`, async ({ params, request, response }) => {
      const body = await request.json();
      return respond(() => mocks.rename(id(params.resource_id), body), (resource) => response(200).json(resource));
    }),
    http.post(`${resources}/{resource_id}/trash`, ({ params, response }) =>
      respond(() => mocks.trash(id(params.resource_id)), (body) => response(200).json(body))),
    http.post(`${resources}/{resource_id}/restore`, ({ params, response }) =>
      respond(() => mocks.restore(id(params.resource_id)), (body) => response(200).json(body))),
    http.put(`${resources}/{resource_id}/location`, async ({ params, request, response }) => {
      const body = await request.json();
      return respond(() => mocks.attach(id(params.resource_id), body), (resource) => response(200).json(resource));
    }),
    http.get(collections, ({ request, response }) =>
      respond(() => mocks.collectionTree(queryOf(request)), (body) => response(200).json(body))),
    http.get(`${collections}/{collection_id}`, ({ params, response }) =>
      respond(() => mocks.collectionDetail(id(params.collection_id)), (body) => response(200).json(body))),
    http.post(collections, async ({ request, response }) => {
      const body = await request.json();
      return respond(() => mocks.createCollection(body), (collection) => response(201).json(collection));
    }),
    http.patch(`${collections}/{collection_id}`, async ({ params, request, response }) => {
      const body = await request.json();
      return respond(() => mocks.updateCollection(id(params.collection_id), body), (collection) => response(200).json(collection));
    }),
    http.post(`${collections}/{collection_id}/move`, async ({ params, request, response }) => {
      const body = await request.json();
      return respond(() => mocks.moveCollection(id(params.collection_id), body), (collection) => response(200).json(collection));
    }),
    http.get(`${collections}/{collection_id}/trash-preview`, ({ params, response }) =>
      respond(() => mocks.previewCollection(id(params.collection_id)), (preview) => response(200).json(preview))),
    http.post(`${collections}/{collection_id}/trash`, async ({ params, request, response }) => {
      const body = await request.json();
      return respond(() => mocks.trashCollection(id(params.collection_id), body), (result) => response(200).json(result));
    }),
    http.get(grants, ({ params, response }) =>
      respond(() => mocks.grants(params.document_id), (items) => response(200).json({ items }))),
    http.put(`${grants}/{collection_id}`, ({ params, response }) =>
      respond(() => mocks.attachCollection(id(params.collection_id), params.document_id), (state) => response(200).json(state))),
    http.delete(`${grants}/{collection_id}`, ({ params, response }) =>
      respond(() => mocks.detachCollection(id(params.collection_id), params.document_id), (state) => response(200).json(state))),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Library: Used by this page', () => {
  it('opens on what this page’s assistant can read', async () => {
    renderPanel();

    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ scope: 'context', document_id: 'doc-1' }));
    expect(screen.getByRole('radio', { name: 'Used by this page' }).getAttribute('aria-checked')).toBe('true');
    // Browse is not loaded until it is shown.
    expect(mocks.collectionTree).not.toHaveBeenCalled();
  });

  it('groups the PDFs by why they can be read, and stops using a collection', async () => {
    const reading = makeCollection({ id: 7, name: 'Reading', parent_id: 3 });
    let used = true;
    mocks.list.mockImplementation(async () =>
      listing([
        makeResource({ id: 1, filename: 'mine.pdf', location: onPage('doc-1', 'Draft') }),
        ...(used ? [makeResource({ id: 2, filename: 'shared.pdf', location: inCollection(7, 'Reading') })] : []),
        makeResource({ id: 3, filename: 'loose.pdf' }),
      ]),
    );
    mocks.collectionDetail.mockResolvedValue(detailOf(reading, [{ id: 3, name: 'Thesis' }, { id: 7, name: 'Reading' }]));
    mocks.grants.mockImplementation(async () => (used ? [grantOf([{ id: 3, name: 'Thesis' }])] : []));
    mocks.detachCollection.mockImplementation(async () => {
      used = false;
      return grantState(3, null);
    });

    renderPanel();

    const pageGroup = await screen.findByRole('region', { name: 'On this page' });
    expect(within(pageGroup).getByText('mine.pdf')).toBeTruthy();
    const viaGrant = await screen.findByRole('region', { name: 'From Thesis' });
    expect(within(viaGrant).getByText('shared.pdf')).toBeTruthy();
    expect(mocks.collectionDetail).toHaveBeenCalledWith(7);
    expect(mocks.grants).toHaveBeenCalledWith('doc-1');
    const unfiled = screen.getByRole('region', { name: 'Unfiled' });
    expect(within(unfiled).getByText('loose.pdf')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop using Thesis on this page' }));
    });
    expect(mocks.detachCollection).toHaveBeenCalledWith(3, 'doc-1');
    expect(await screen.findByText('This page no longer uses Thesis')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('shared.pdf')).toBeNull());
  });

  it('adds a collection for this page to use through the picker', async () => {
    const reading = makeCollection({ id: 7, name: 'Reading' });
    mocks.collectionTree.mockResolvedValue(collectionPage([reading]));
    mocks.attachCollection.mockResolvedValue(grantState(7, { id: 7, name: 'Reading' }));

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Use PDFs from a collection…' }));
    fireEvent.click(await screen.findByRole('treeitem', { name: /Reading/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use on this page' }));
    });

    expect(mocks.attachCollection).toHaveBeenCalledWith(7, 'doc-1');
    expect(await screen.findByText('This page now uses Reading')).toBeTruthy();
  });

  it('reports a failed load instead of showing an empty Library', async () => {
    mocks.list.mockRejectedValue(new Error('Network unreachable'));

    renderPanel();

    expect(await screen.findByText('Network unreachable')).toBeTruthy();
    expect(screen.queryByText(/no PDFs for this page yet/i)).toBeNull();
  });

  it('shows each PDF with whether the assistant can read it', async () => {
    mocks.list.mockResolvedValue(
      listing([
        makeResource({ id: 1, filename: 'ready.pdf' }),
        makeResource({
          id: 2,
          filename: 'scan.pdf',
          extraction: { status: 'unsupported', error: 'no text layer', pages: null },
        }),
      ]),
    );

    renderPanel();

    expect(await screen.findByText('ready.pdf')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('No text')).toBeTruthy();
  });
});

describe('Library: one rule for unsaved pages', () => {
  it('works on a new page: lists what it will read and saves it before uploading to it', async () => {
    mocks.documentId = null;
    mocks.ensure.mockResolvedValue('doc-new');

    renderPanel();

    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ scope: 'unfiled' })));
    expect(document.body.textContent).not.toMatch(/save this page/i);
    expect(screen.getByRole('button', { name: 'Upload to: this page' })).toBeTruthy();

    await chooseFiles([pdf('new.pdf')]);

    expect(mocks.ensure).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith({ location: 'document', document_id: 'doc-new' }));
    expect(await screen.findByText('Uploaded 1 PDF to this page')).toBeTruthy();
  });

  it('says so, and uploads nothing, when the page cannot be saved', async () => {
    mocks.documentId = null;
    mocks.ensure.mockResolvedValue(null);

    renderPanel();
    await chooseFiles([pdf('new.pdf')]);

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(await screen.findByText('Could not upload to this page')).toBeTruthy();
  });

  it('saves a new page before using a collection on it', async () => {
    mocks.documentId = null;
    mocks.ensure.mockResolvedValue('doc-new');
    const methods = makeCollection({ id: 7, name: 'Methods' });
    mocks.collectionTree.mockResolvedValue(collectionPage([methods]));
    mocks.collectionDetail.mockResolvedValue(detailOf(methods));
    mocks.attachCollection.mockResolvedValue(grantState(7, { id: 7, name: 'Methods' }));

    renderPanel();
    await openBrowse();
    await openCollectionRow(/Methods/);
    const toggle = await screen.findByRole('button', { name: 'Use on this page' });
    expect(toggle.hasAttribute('disabled')).toBe(false);
    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(mocks.ensure).toHaveBeenCalled();
    expect(mocks.attachCollection).toHaveBeenCalledWith(7, 'doc-new');
  });

  it('saves a new page before moving a PDF onto it', async () => {
    mocks.documentId = null;
    mocks.ensure.mockResolvedValue('doc-new');
    mocks.list.mockResolvedValue(listing([makeResource({ id: 41, filename: 'loose.pdf' })]));
    mocks.attach.mockResolvedValue(makeResource({ id: 41, filename: 'loose.pdf', location: onPage('doc-new') }));

    renderPanel();
    const row = await screen.findByText('loose.pdf');
    await act(async () => {
      fireEvent.click(row);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move to this page' }));
    });

    expect(mocks.attach).toHaveBeenCalledWith(41, { kind: 'document', document_id: 'doc-new' });
    expect(await screen.findByText('Moved loose.pdf to this page')).toBeTruthy();
  });
});

describe('Library: uploads say where they go', () => {
  it('follows the view, and uploads into the collection being browsed', async () => {
    const methods = makeCollection({ id: 7, name: 'Methods' });
    mocks.collectionTree.mockResolvedValue(collectionPage([methods]));
    mocks.collectionDetail.mockResolvedValue(detailOf(methods));

    renderPanel();
    expect(screen.getByRole('button', { name: 'Upload to: this page' })).toBeTruthy();
    await openBrowse();
    expect(screen.getByRole('button', { name: 'Upload to: Unfiled' })).toBeTruthy();
    await openCollectionRow(/Methods/);
    expect(await screen.findByRole('button', { name: 'Upload to: Methods' })).toBeTruthy();

    await chooseFiles([pdf('methods.pdf')]);

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith({ location: 'collection', collection_id: '7' }));
    expect(await screen.findByText('Uploaded 1 PDF to Methods')).toBeTruthy();
  });

  it('lets the author pick another destination before uploading', async () => {
    renderPanel();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Change where PDFs upload' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Unfiled' }));
    expect(await screen.findByRole('button', { name: 'Upload to: Unfiled' })).toBeTruthy();

    await chooseFiles([pdf('loose.pdf')]);
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith({ location: 'unfiled' }));
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('uploads PDFs dropped on the panel, but not its own rows dragged over it', async () => {
    renderPanel();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    const panel = screen.getByRole('radiogroup', { name: 'Library view' }).closest('.relative') as HTMLElement;

    const internal = dataTransfer([pdf('row.pdf')]);
    setLibraryDragPayload(internal, { kind: 'resource', id: 3 });
    await act(async () => {
      fireEvent.drop(panel, { dataTransfer: internal });
    });
    expect(mocks.upload).not.toHaveBeenCalled();

    const external = dataTransfer([pdf('dropped.pdf')]);
    await act(async () => {
      fireEvent.drop(panel, { dataTransfer: external });
    });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith({ location: 'document', document_id: 'doc-1' }));
  });
});

describe('Library: one search, Names or Inside PDFs', () => {
  it('matches names as the author types and searches the text only when asked', async () => {
    mocks.list.mockResolvedValue(
      listing([makeResource({ id: 1, filename: 'attention.pdf' }), makeResource({ id: 2, filename: 'routing.pdf' })]),
    );
    mocks.search.mockResolvedValue(
      searchResult({
        query: 'expert',
        items: [{ resource_id: 2, filename: 'routing.pdf', title: null, offset: 3, excerpt: 'each expert is chosen' }],
        resources_searched: 2,
      }),
    );

    renderPanel();
    await screen.findByText('attention.pdf');
    expect(screen.getByRole('radio', { name: 'Names' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.change(searchBox(), { target: { value: 'atten' } });
    expect(screen.getByText('attention.pdf')).toBeTruthy();
    expect(screen.queryByText('routing.pdf')).toBeNull();
    expect(mocks.search).not.toHaveBeenCalled();

    await searchInside('expert');
    expect(mocks.search).toHaveBeenCalledWith({
      query: 'expert',
      scope: 'context',
      document_id: 'doc-1',
      max_matches: '12',
    });
    expect(await screen.findByRole('button', { name: /each expert is chosen/ })).toBeTruthy();
  });

  it('searches a collection with everything inside it', async () => {
    const methods = makeCollection({ id: 7, name: 'Methods' });
    mocks.collectionTree.mockResolvedValue(collectionPage([methods]));
    mocks.collectionDetail.mockResolvedValue(detailOf(methods));

    renderPanel();
    await openBrowse();
    await openCollectionRow(/Methods/);
    await searchInside('sampling');

    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'sampling', scope: 'collection_recursive', collection_id: '7' }),
    );
  });

  it('searches every PDF for a query handed over from Research', async () => {
    renderPanel({ tab: 'library', query: 'router', id: 1 });

    await waitFor(() =>
      expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ query: 'router', scope: 'library' })),
    );
    expect(searchBox().value).toBe('router');
    expect(screen.getByRole('radio', { name: 'Inside PDFs' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Browse' }).getAttribute('aria-checked')).toBe('true');
  });

  it('drops a search answer for a place the author has left', async () => {
    const stale = deferred<ResourceSearchResponse>();
    mocks.search.mockReturnValue(stale.promise);

    renderPanel();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await searchInside('old place');
    await openBrowse();

    await act(async () => {
      stale.resolve(
        searchResult({
          query: 'old place',
          items: [{ resource_id: 91, filename: 'stale.pdf', title: null, offset: 0, excerpt: 'stale result' }],
        }),
      );
      await stale.promise;
    });

    expect(screen.queryByText(/stale result/)).toBeNull();
  });

  it('names the PDFs a search could not read', async () => {
    mocks.search.mockResolvedValue(
      searchResult({
        query: 'transformer',
        resources_skipped: [{ resource_id: 9, filename: 'queued.pdf', extraction_status: 'pending' }],
      }),
    );

    renderPanel();
    await searchInside('transformer');

    const notice = await screen.findByText(/1 PDF was not searched/i);
    const alert = notice.closest('[role="status"]') as HTMLElement;
    expect(within(alert).getByText('queued.pdf')).toBeTruthy();
    expect(within(alert).getByText('Queued')).toBeTruthy();
  });

  it('continues a search past its first page of PDFs', async () => {
    mocks.search
      .mockResolvedValueOnce(searchResult({ query: 'oldest', resources_searched: 25, next_cursor: 'cursor-25' }))
      .mockResolvedValueOnce(
        searchResult({
          query: 'oldest',
          items: [{ resource_id: 26, filename: 'oldest.pdf', title: null, offset: 7, excerpt: 'the oldest matching phrase' }],
          resources_searched: 1,
        }),
      );

    renderPanel();
    await searchInside('oldest');
    const more = await screen.findByRole('button', { name: 'Show more matches' });
    await act(async () => {
      fireEvent.click(more);
    });

    expect(mocks.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'oldest', cursor: 'cursor-25', scope: 'context' }),
    );
    expect(await screen.findByRole('button', { name: /the oldest matching phrase/i })).toBeTruthy();
  });

  it('opens a match with a lead-in and the term marked', async () => {
    mocks.search.mockResolvedValue(
      searchResult({
        query: 'gradient',
        items: [{ resource_id: 3, filename: 'paper.pdf', title: null, offset: 5_000, excerpt: '…the gradient descends…' }],
        resources_searched: 1,
      }),
    );
    mocks.get.mockResolvedValue(makeResource({ id: 3, filename: 'paper.pdf' }));
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
    await searchInside('gradient');
    const match = await screen.findByRole('button', { name: /the gradient descends/i });
    await act(async () => {
      fireEvent.click(match);
    });

    await waitFor(() => expect(mocks.read).toHaveBeenCalled());
    const [, options] = mocks.read.mock.calls.at(-1) as [number, { offset: string }];
    expect(Number(options.offset)).toBeLessThan(5_000);
    expect(Number(options.offset)).toBeGreaterThan(0);
    await waitFor(() => expect(document.querySelectorAll('mark').length).toBe(1));
    expect(document.querySelector('mark')?.textContent).toBe('gradient');
  });
});

describe('Library: Browse', () => {
  it('walks collections with a breadcrumb and one scroll box, not a second tree', async () => {
    const thesis = makeCollection({ id: 3, name: 'Thesis', child_collection_count: 1 });
    const chapter = makeCollection({ id: 7, name: 'Chapter 2', parent_id: 3 });
    mocks.collectionTree.mockImplementation(async ({ parent_id }: { parent_id?: string }) =>
      collectionPage(parent_id === 'root' ? [thesis] : parent_id === '3' ? [chapter] : []),
    );
    mocks.collectionDetail.mockImplementation(async (id: number) =>
      id === 3 ? detailOf(thesis) : detailOf(chapter, [{ id: 3, name: 'Thesis' }, { id: 7, name: 'Chapter 2' }]),
    );

    const view = renderPanel();
    await openBrowse();
    expect(await screen.findByRole('button', { name: /Thesis/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Unfiled/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^All PDFs/ })).toBeTruthy();

    await openCollectionRow(/Thesis/);
    await openCollectionRow(/Chapter 2/);
    const crumbs = await screen.findByRole('navigation', { name: 'Collection breadcrumbs' });
    await waitFor(() => expect(within(crumbs).getByText('Chapter 2').getAttribute('aria-current')).toBe('page'));
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'collection', collection_id: '7' }));

    // No tree in the Library, and no nested fixed-height scroll box.
    expect(screen.queryByRole('tree')).toBeNull();
    expect(view.container.querySelector('.max-h-44')).toBeNull();
    expect(view.container.querySelectorAll('.overflow-y-auto')).toHaveLength(1);

    await act(async () => {
      fireEvent.click(within(crumbs).getByRole('button', { name: 'Library' }));
    });
    expect(await screen.findByRole('button', { name: /^Unfiled/ })).toBeTruthy();
  });

  it('opens Browse at the collection a tree row’s PDF count names, with its pages, collections and PDFs', async () => {
    const chapter = makeCollection({ id: 4, name: 'Chapter 2', parent_id: 1 });
    mocks.collectionTree.mockResolvedValue(collectionPage([]));
    mocks.collectionDetail.mockResolvedValue(detailOf(chapter, [{ id: 1, name: 'Thesis' }, { id: 4, name: 'Chapter 2' }]));
    mocks.list.mockResolvedValue(listing([makeResource({ id: 64, filename: 'routing-survey.pdf', location: inCollection(4, 'Chapter 2') })]));

    renderPanel({ tab: 'library', collectionId: 4, id: 1 });

    const crumbs = await screen.findByRole('navigation', { name: 'Collection breadcrumbs' });
    await waitFor(() => expect(within(crumbs).getByText('Chapter 2').getAttribute('aria-current')).toBe('page'));
    expect(screen.getByRole('radio', { name: 'Browse' }).getAttribute('aria-checked')).toBe('true');
    // The pages that live there, as the sidebar tree lists them.
    const pages = await screen.findByRole('region', { name: 'Pages in this collection' });
    expect(within(pages).getAllByRole('button').map((button) => button.textContent)).toEqual(['Methods', 'Results']);
    expect(await screen.findByText('routing-survey.pdf')).toBeTruthy();

    fireEvent.click(within(pages).getByRole('button', { name: /Results/ }));
    expect(mocks.switchTo).toHaveBeenCalledWith('66f0c0ffee0000000000e004', { source: 'selection' });
  });

  it('says a grant the collection’s setting added is "Used via" that collection', async () => {
    const thesis = makeCollection({ id: 3, name: 'Thesis' });
    mocks.list.mockResolvedValue(listing([makeResource({ id: 2, filename: 'shared.pdf', location: inCollection(3, 'Thesis') })]));
    mocks.collectionDetail.mockResolvedValue(detailOf(thesis));
    mocks.grants.mockResolvedValue([{ ...grantOf([{ id: 3, name: 'Thesis' }]), origin: 'setting' }]);

    renderPanel();

    const group = await screen.findByRole('region', { name: 'Used via Thesis' });
    expect(within(group).getByText('shared.pdf')).toBeTruthy();
    expect(within(group).getByText('Pages in Thesis can use its PDFs while they are there.')).toBeTruthy();
  });

  it('keeps its place when the author switches pages, and reads the new page’s grants', async () => {
    const methods = makeCollection({ id: 7, name: 'Methods' });
    mocks.collectionTree.mockResolvedValue(collectionPage([methods]));
    mocks.collectionDetail.mockResolvedValue(detailOf(methods));

    const view = renderPanel();
    await openBrowse();
    await openCollectionRow(/Methods/);
    expect(await screen.findByRole('heading', { name: 'Methods' })).toBeTruthy();

    mocks.documentId = 'doc-2';
    view.rerender(
      <Providers>
        <LibraryPanel />
      </Providers>,
    );

    await waitFor(() => expect(mocks.grants).toHaveBeenCalledWith('doc-2'));
    expect(screen.getByRole('heading', { name: 'Methods' })).toBeTruthy();
  });

  it('moves a collection to the Trash after showing what it takes, and confirms again when that changed', async () => {
    const doomed = makeCollection({ id: 7, name: 'Old notes' });
    const first = { collection_count: 1, page_count: 0, pdf_count: 1, pdf_bytes: 1024 };
    const now = { collection_count: 2, page_count: 3, pdf_count: 1, pdf_bytes: 1024 };
    mocks.collectionTree.mockResolvedValue(collectionPage([doomed]));
    mocks.collectionDetail.mockResolvedValue(detailOf(doomed));
    mocks.previewCollection.mockResolvedValueOnce(first).mockResolvedValue(now);
    mocks.trashCollection.mockResolvedValue({
      collection_id: 7, trashed_at: '2026-11-15T10:00:00Z', purge_after: '2026-12-15T10:00:00Z',
      ...now, tree_version: 4, job: null,
    });
    // The first confirmation finds it holding something else.
    server.use(http.post('/workspaces/{workspace_id}/collections/{collection_id}/trash', () =>
      problem('preview_changed', 'The collection changed since the preview'), { once: true }));
    const sent = recordRequests();

    renderPanel();
    await openBrowse();
    await openCollectionRow(/Old notes/);
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Actions for Old notes' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Move Old notes to Trash?' });
    expect(await within(dialog).findByText('Moves Old notes and 1 PDF to Trash. You can restore them for 30 days.')).toBeTruthy();
    // No typed name: the Trash gives it back.
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));
    });
    const firstTrash = sent.find((request) => request.method === 'POST' && pathOf(request).endsWith('/collections/7/trash'));
    expect(await jsonOf(firstTrash)).toEqual({
      expected_collection_count: 1, expected_page_count: 0, expected_pdf_count: 1, expected_pdf_bytes: 1024,
    });
    expect(mocks.trashCollection).not.toHaveBeenCalled();

    // It changed under the preview: the new counts, and the author confirms again.
    expect(await within(dialog).findByText('Moves Old notes, 1 collection, 3 pages and 1 PDF to Trash. You can restore them for 30 days.')).toBeTruthy();
    expect(within(dialog).getByText(/This collection changed since you opened this/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));
    });
    expect(mocks.trashCollection).toHaveBeenLastCalledWith(7, {
      expected_collection_count: 2, expected_page_count: 3, expected_pdf_count: 1, expected_pdf_bytes: 1024,
    });
    expect(await screen.findByText('Moved Old notes to Trash')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Library: one PDF', () => {
  it('opens a PDF, shows the text the assistant gets, and returns focus to its row', async () => {
    mocks.list.mockResolvedValue(listing([makeResource({ id: 5, filename: 'paper.pdf', title: 'Attention' })]));
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
    const back = screen.getByRole('button', { name: 'Back to the PDF list' });
    await waitFor(() => expect(document.activeElement).toBe(back));
    await act(async () => {
      fireEvent.click(back);
    });
    const restored = await screen.findByText('Attention');
    await waitFor(() => expect(document.activeElement).toBe(restored.closest('button')));
  });

  it('moves a PDF with the picker and returns focus to Move to…', async () => {
    const target = makeCollection({ id: 7, name: 'Target collection' });
    const resource = makeResource({ id: 41, filename: 'movable.pdf' });
    const moved = { ...resource, location: inCollection(7, 'Target collection') };
    let didMove = false;
    mocks.list.mockImplementation(async () => listing([didMove ? moved : resource]));
    mocks.collectionTree.mockResolvedValue(collectionPage([target]));
    mocks.collectionDetail.mockResolvedValue(detailOf(target));
    mocks.attach.mockImplementation(async () => {
      didMove = true;
      return moved;
    });

    renderPanel();
    const row = await screen.findByText('movable.pdf');
    await act(async () => {
      fireEvent.click(row);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move to…' }));
    fireEvent.click(await screen.findByRole('treeitem', { name: /Target collection/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
    });

    expect(mocks.attach).toHaveBeenCalledWith(41, { kind: 'collection', collection_id: 7 });
    const moveButton = await screen.findByRole('button', { name: 'Move to…' });
    await waitFor(() => expect(document.activeElement).toBe(moveButton));
    expect(screen.getByText('Target collection')).toBeTruthy();
  });

  it('renames a PDF from its actions menu', async () => {
    let filename = 'scan-0042.pdf';
    mocks.list.mockImplementation(async () => listing([makeResource({ id: 12, filename })]));
    mocks.rename.mockImplementation(async (id: number, body: { filename: string }) => {
      filename = body.filename;
      return makeResource({ id, filename });
    });

    renderPanel();
    await act(async () => {
      fireEvent.click(await screen.findByText('scan-0042.pdf'));
    });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions for scan-0042.pdf' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const field = await screen.findByRole('textbox', { name: 'File name' });
    fireEvent.change(field, { target: { value: '  Switch Transformers.pdf ' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });

    expect(mocks.rename).toHaveBeenCalledExactlyOnceWith(12, { filename: 'Switch Transformers.pdf' });
    expect(await screen.findByText('Renamed to Switch Transformers.pdf')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Switch Transformers.pdf' })).toBeTruthy();
  });

  it('moves a PDF to the Trash at once from its actions menu, and Undo brings it back', async () => {
    let trashed = false;
    const paper = makeResource({ id: 12, filename: 'scan-0042.pdf' });
    mocks.list.mockImplementation(async () => listing(trashed ? [] : [paper]));
    mocks.trash.mockImplementation(async (id: number) => {
      trashed = true;
      return { id, trashed_at: '2026-11-15T10:00:00Z', purge_after: '2026-12-15T10:00:00Z' };
    });
    mocks.restore.mockImplementation(async () => {
      trashed = false;
      return paper;
    });

    renderPanel();
    await act(async () => {
      fireEvent.click(await screen.findByText('scan-0042.pdf'));
    });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions for scan-0042.pdf' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));

    // No confirmation: the Trash gives it back.
    expect(await screen.findByText('Moved scan-0042.pdf to Trash')).toBeTruthy();
    expect(mocks.trash).toHaveBeenCalledExactlyOnceWith(12);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'scan-0042.pdf' })).toBeNull());
    await waitFor(() => expect(screen.queryByText('scan-0042.pdf')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith(12));
    expect(await screen.findByText('scan-0042.pdf')).toBeTruthy();
  });

  it('retries a failed conversion without forcing it, and forces an unsupported one', async () => {
    mocks.list.mockResolvedValue(
      listing([
        makeResource({ id: 8, filename: 'timeout.pdf', extraction: { status: 'failed', error: 'Jina Reader timed out' } }),
        makeResource({ id: 9, filename: 'scan.pdf', extraction: { status: 'unsupported', error: 'needs OCR' } }),
      ]),
    );
    mocks.extract.mockImplementation(async (id: number) => makeResource({ id, extraction: { status: 'unsupported' } }));

    renderPanel();
    const row = await screen.findByText('timeout.pdf');
    await act(async () => {
      fireEvent.click(row);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /convert now/i }));
    });
    expect(mocks.extract).toHaveBeenCalledWith(8, {});

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to the PDF list' }));
    });
    const scan = await screen.findByText('scan.pdf');
    await act(async () => {
      fireEvent.click(scan);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /try converting anyway/i }));
    });
    expect(mocks.extract).toHaveBeenCalledWith(9, { force: 'true' });
  });
});
