import { act, cleanup } from '@testing-library/react';
import { renderHookWithQueryClient as renderHook } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, queryOf, respond, server } from '@/__tests__/server';
import { makeCollection, makeCollectionDetail } from '@/data/__tests__/resourceFixtures';
import type {
  CollectionDetail,
  CollectionGrantState,
  CollectionItem,
  CollectionListResponse,
  PdfGrant,
  PdfGrantState,
} from '@/data/resources';

import { useCollectionBrowse } from '../useCollectionBrowse';

/**
 * The server's collection and grant routes, by what each request names: a
 * level by its query, a collection by its id (and body), a page's grants by
 * the page, a grant by both ids.
 */
const mocks = {
  tree: vi.fn(),
  detail: vi.fn(),
  grants: vi.fn(),
  update: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
};

function page(collections: CollectionItem[]): CollectionListResponse {
  return { items: collections, next_cursor: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** This page uses the collection itself. */
const used = (id: number): CollectionGrantState => ({
  direct: true,
  effective: true,
  via_collection_id: id,
  via_collection_name: 'Thesis',
});

const grantChange = (id: number, direct: boolean): PdfGrantState => ({
  collection_id: id,
  direct,
  effective: direct,
  via_collection_id: direct ? id : null,
  via_collection_name: direct ? 'Thesis' : null,
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.tree.mockReset().mockResolvedValue(page([]));
  mocks.detail.mockReset();
  mocks.grants.mockReset().mockResolvedValue([]);
  mocks.update.mockReset();
  mocks.attach.mockReset();
  mocks.detach.mockReset();
  const collections = '/workspaces/{workspace_id}/collections';
  const grants = '/workspaces/{workspace_id}/documents/{document_id}/pdf-grants';
  server.use(
    http.get(collections, ({ request, response }) =>
      respond(() => mocks.tree(queryOf(request)), (body) => response(200).json(body))),
    http.get(`${collections}/{collection_id}`, ({ params, response }) =>
      respond(() => mocks.detail(Number(params.collection_id)), (body) => response(200).json(body))),
    http.patch(`${collections}/{collection_id}`, async ({ params, request, response }) => {
      const body = await request.json();
      return respond(() => mocks.update(Number(params.collection_id), body), (collection) => response(200).json(collection));
    }),
    http.get(grants, ({ params, response }) =>
      respond(() => mocks.grants(params.document_id), (items) => response(200).json({ items }))),
    http.put(`${grants}/{collection_id}`, ({ params, response }) =>
      respond(() => mocks.attach(Number(params.collection_id), params.document_id), (state) => response(200).json(state))),
    http.delete(`${grants}/{collection_id}`, ({ params, response }) =>
      respond(() => mocks.detach(Number(params.collection_id), params.document_id), (state) => response(200).json(state))),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useCollectionBrowse', () => {
  it('lists a level with this page’s grant state, and keeps the place on a page switch', async () => {
    const thesis = makeCollection({ id: 1, name: 'Thesis' });
    mocks.tree.mockImplementation(async ({ grant_state_for }: { grant_state_for: string }) =>
      page([{ ...thesis, grant_state: grant_state_for === 'doc-1' ? used(1) : null }]),
    );

    const { result, rerender } = renderHook(
      ({ documentId }: { documentId: string }) => useCollectionBrowse(null, documentId),
      { initialProps: { documentId: 'doc-1' } },
    );
    await flush();
    expect(mocks.tree).toHaveBeenCalledWith({ parent_id: 'root', grant_state_for: 'doc-1', limit: '50' });
    expect(result.current.collections[0]?.grant_state?.direct).toBe(true);

    const pending = deferred<CollectionListResponse>();
    mocks.tree.mockReturnValueOnce(pending.promise);
    rerender({ documentId: 'doc-2' });
    await flush();
    // The rows stay on screen while the new page's grant state is read (C-15).
    expect(result.current.loading).toBe(false);
    expect(result.current.collections.map((item) => item.name)).toEqual(['Thesis']);

    await act(async () => {
      pending.resolve(page([thesis]));
      await pending.promise;
    });
    expect(result.current.collections[0]?.grant_state).toBeNull();
  });

  it('reads the open collection’s path and ignores an answer for a level the author left', async () => {
    const stale = deferred<CollectionDetail>();
    mocks.detail.mockImplementation((id: number) =>
      id === 7 ? stale.promise : Promise.resolve(makeCollectionDetail({ id: 8, name: 'Results' })),
    );

    const { result, rerender } = renderHook(({ id }: { id: number }) => useCollectionBrowse(id, 'doc-1'), {
      initialProps: { id: 7 },
    });
    await flush();
    expect(mocks.detail).toHaveBeenCalledWith(7);

    rerender({ id: 8 });
    await flush();
    await act(async () => {
      stale.resolve(makeCollectionDetail({
        id: 7,
        name: 'Methods',
        parent_id: 1,
        depth: 2,
        path: [{ id: 1, name: 'Thesis' }, { id: 7, name: 'Methods' }],
      }));
      await stale.promise;
    });

    expect(result.current.detail?.name).toBe('Results');
    expect(result.current.detail?.path.map((crumb) => crumb.name)).toEqual(['Results']);
  });

  it('works out the page’s grant on the open collection from the page’s grants and its path', async () => {
    mocks.detail.mockResolvedValue(makeCollectionDetail({
      id: 7,
      name: 'Methods',
      parent_id: 1,
      depth: 2,
      path: [{ id: 1, name: 'Thesis' }, { id: 7, name: 'Methods' }],
    }));
    const thesis: PdfGrant = { collection_id: 1, name: 'Thesis', origin: 'manual', path: [{ id: 1, name: 'Thesis' }] };
    mocks.grants.mockResolvedValue([thesis]);

    const { result } = renderHook(() => useCollectionBrowse(7, 'doc-1'));
    await flush();
    await flush();

    expect(mocks.grants).toHaveBeenCalledWith('doc-1');
    expect(result.current.grant).toEqual({
      direct: false,
      effective: true,
      via_collection_id: 1,
      via_collection_name: 'Thesis',
    });
  });

  it('runs mutations one at a time and reads the level again after them', async () => {
    const first = deferred<CollectionDetail>();
    mocks.update.mockReturnValueOnce(first.promise).mockResolvedValueOnce(makeCollectionDetail({ id: 1, name: 'Second' }));

    const { result } = renderHook(() => useCollectionBrowse(null, 'doc-1'));
    await flush();
    mocks.tree.mockClear();

    let a!: Promise<CollectionDetail>;
    let b!: Promise<CollectionDetail>;
    act(() => {
      a = result.current.rename(makeCollection({ id: 1 }), { name: 'First' });
      b = result.current.rename(makeCollection({ id: 1 }), { name: 'Second' });
    });
    await flush();
    expect(mocks.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(makeCollectionDetail({ id: 1, name: 'First' }));
      await Promise.all([a, b]);
    });
    expect(mocks.update.mock.calls.map((call) => call[1])).toEqual([{ name: 'First' }, { name: 'Second' }]);
    expect(mocks.tree).toHaveBeenCalledTimes(2);
  });

  it('starts and stops using a collection on the given page', async () => {
    mocks.attach.mockResolvedValue(grantChange(3, true));
    mocks.detach.mockResolvedValue(grantChange(3, false));
    const { result } = renderHook(() => useCollectionBrowse(null, null));
    await flush();

    await act(async () => {
      await result.current.setUsed(3, true, 'doc-new');
    });
    await act(async () => {
      await result.current.setUsed(3, false, 'doc-new');
    });

    expect(mocks.attach).toHaveBeenCalledWith(3, 'doc-new');
    expect(mocks.detach).toHaveBeenCalledWith(3, 'doc-new');
  });

  it('asks for nothing while it is not shown', async () => {
    renderHook(() => useCollectionBrowse(null, 'doc-1', { enabled: false }));
    await flush();
    expect(mocks.tree).not.toHaveBeenCalled();
  });
});
