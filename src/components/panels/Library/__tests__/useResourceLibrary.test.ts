import { act, cleanup } from '@testing-library/react';
import { renderHookWithQueryClient as renderHook } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, queryOf, respond, server } from '@/__tests__/server';
import { inCollection, makeResource } from '@/data/__tests__/resourceFixtures';
import {
  useTrashResource,
  type ResourceItem,
  type ResourceLibraryLocation,
  type ResourceScope,
} from '@/data/resources';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

import { RESOURCE_PAGE_SIZE, useResourceLibrary } from '../useResourceLibrary';

/** The Library's list beside the one action that takes a PDF out of it: the Trash. */
function useListAndTrash(location: ResourceLibraryLocation) {
  return { library: useResourceLibrary(location), trash: useTrashResource(TEST_WORKSPACE_ID) };
}

/**
 * The server's resource routes: the list by its query, one resource by its id
 * (with the move's body or the extraction's query). Each answers the
 * resource or listing the route returns.
 */
const mocks = {
  list: vi.fn(),
  get: vi.fn(),
  trash: vi.fn(),
  move: vi.fn(),
  extract: vi.fn(),
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** One page of a list; a next cursor says there is more. */
function listing(resources: ResourceItem[], nextCursor: string | null = null) {
  return { items: resources, next_cursor: nextCursor };
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function flush() {
  await tick(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.list.mockReset().mockResolvedValue(listing([]));
  mocks.get.mockReset().mockResolvedValue(makeResource());
  mocks.trash.mockReset().mockImplementation(async (id: number) => ({ id, trashed_at: '2026-11-15T10:00:00Z', purge_after: '2026-12-15T10:00:00Z' }));
  mocks.move.mockReset().mockImplementation(async (id: number) => makeResource({ id }));
  mocks.extract.mockReset().mockImplementation(async (id: number) => makeResource({ id }));
  server.use(
    http.get('/workspaces/{workspace_id}/resources', ({ request, response }) =>
      respond(() => mocks.list(queryOf(request)), (body) => response(200).json(body))),
    http.get('/workspaces/{workspace_id}/resources/{resource_id}', ({ params, response }) =>
      respond(() => mocks.get(Number(params.resource_id)), (resource) => response(200).json(resource))),
    http.post('/workspaces/{workspace_id}/resources/{resource_id}/trash', ({ params, response }) =>
      respond(() => mocks.trash(Number(params.resource_id)), (body) => response(200).json(body))),
    http.put('/workspaces/{workspace_id}/resources/{resource_id}/location', async ({ params, request, response }) => {
      const body = await request.json();
      return respond(() => mocks.move(Number(params.resource_id), body), (resource) => response(200).json(resource));
    }),
    http.post('/workspaces/{workspace_id}/resources/{resource_id}/extract', ({ params, request, response }) =>
      respond(() => mocks.extract(Number(params.resource_id), queryOf(request)), (resource) => response(200).json(resource))),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useResourceLibrary locations and paging', () => {
  it('lists nothing and asks for nothing without a location', async () => {
    const { result } = renderHook(() => useResourceLibrary(null));
    await flush();

    expect(mocks.list).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.resources).toEqual([]);
  });

  it('puts PDFs that were just uploaded at the top without dropping the rest', async () => {
    mocks.list.mockResolvedValue(listing([makeResource({ id: 1, filename: 'old.pdf' })]));
    const { result } = renderHook(() => useResourceLibrary({ kind: 'unfiled' }));
    await flush();

    await act(async () => result.current.addUploaded([makeResource({ id: 2, filename: 'new.pdf' })]));

    expect(result.current.resources.map((resource) => resource.filename)).toEqual(['new.pdf', 'old.pdf']);
  });

  it('loads an exact folder from a discriminated location', async () => {
    renderHook(() => useResourceLibrary({ kind: 'collection', collectionId: 7 }));
    await flush();

    expect(mocks.list).toHaveBeenCalledWith({
      scope: 'collection',
      collection_id: '7',
      limit: String(RESOURCE_PAGE_SIZE),
    });
  });

  it('loads recursive folders and Unfiled with their exact scopes', async () => {
    const initialProps: { location: ResourceLibraryLocation } = {
      location: { kind: 'collection', collectionId: 4, recursive: true },
    };
    const { rerender } = renderHook(
      ({ location }: { location: ResourceLibraryLocation }) => useResourceLibrary(location),
      { initialProps },
    );
    await flush();
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: 'collection_recursive', collection_id: '4' }),
    );

    rerender({ location: { kind: 'unfiled' } });
    await flush();
    expect(mocks.list).toHaveBeenLastCalledWith(
      { scope: 'unfiled', limit: String(RESOURCE_PAGE_SIZE) },
    );
  });

  it('follows the next cursor to load more', async () => {
    const firstPage = Array.from({ length: RESOURCE_PAGE_SIZE }, (_, index) =>
      makeResource({ id: index + 1 }),
    );
    mocks.list
      .mockResolvedValueOnce(listing(firstPage, 'cursor-2'))
      .mockResolvedValueOnce(listing([makeResource({ id: 51 })]));

    const { result } = renderHook(() =>
      useResourceLibrary({ kind: 'smart', scope: 'library' }),
    );
    await flush();

    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-2', limit: String(RESOURCE_PAGE_SIZE) }),
    );
    expect(result.current.resources).toHaveLength(51);
    expect(result.current.hasMore).toBe(false);
  });

  it('selects a resource outside the loaded pages without inserting it into the page', async () => {
    mocks.list.mockResolvedValue(listing([makeResource({ id: 1 })]));
    mocks.get.mockResolvedValue(makeResource({ id: 99, filename: 'outside.pdf' }));
    const { result } = renderHook(() =>
      useResourceLibrary({ kind: 'smart', scope: 'library' }),
    );
    await flush();

    await act(async () => {
      await result.current.select(99);
    });

    expect(mocks.get).toHaveBeenCalledWith(99);
    expect(result.current.selected?.filename).toBe('outside.pdf');
    expect(result.current.resources.map((resource) => resource.id)).toEqual([1]);
  });
});

describe('useResourceLibrary stale request guards', () => {
  it('ignores a stale location load that resolves after the new location', async () => {
    const oldLoad = deferred<ReturnType<typeof listing>>();
    const newLoad = deferred<ReturnType<typeof listing>>();
    mocks.list.mockReturnValueOnce(oldLoad.promise).mockReturnValueOnce(newLoad.promise);

    const initialProps: { location: ResourceLibraryLocation } = {
      location: { kind: 'smart', scope: 'library' },
    };
    const { result, rerender } = renderHook(
      ({ location }: { location: ResourceLibraryLocation }) => useResourceLibrary(location),
      { initialProps },
    );
    await flush();

    rerender({ location: { kind: 'unfiled' } });
    await flush();
    newLoad.resolve(listing([makeResource({ id: 2, filename: 'unfiled.pdf' })]));
    await flush();

    oldLoad.resolve(listing([makeResource({ id: 1, filename: 'old.pdf' })]));
    await flush();

    expect(result.current.resources.map((resource) => resource.filename)).toEqual([
      'unfiled.pdf',
    ]);
  });

  it('invalidates an older initial load when a mutation starts', async () => {
    const staleLoad = deferred<ReturnType<typeof listing>>();
    mocks.list
      .mockReturnValueOnce(staleLoad.promise)
      .mockResolvedValueOnce(listing([]));

    const { result } = renderHook(() => useListAndTrash({ kind: 'smart', scope: 'library' }));
    await flush();

    await act(async () => {
      await result.current.trash.mutateAsync(5);
    });
    staleLoad.resolve(listing([makeResource({ id: 5, filename: 'trashed.pdf' })]));
    await flush();

    expect(result.current.library.resources).toEqual([]);
  });

  it('does not let an in-flight poll bring back a PDF moved to the Trash', async () => {
    const polling = deferred<ReturnType<typeof listing>>();
    const pending = makeResource({ id: 5, extraction: { status: 'pending' } });
    mocks.list
      .mockResolvedValueOnce(listing([pending]))
      .mockReturnValueOnce(polling.promise)
      .mockResolvedValue(listing([]));

    const { result } = renderHook(() => useListAndTrash({ kind: 'smart', scope: 'library' }));
    await flush();
    await tick(1_500);
    expect(mocks.list).toHaveBeenCalledTimes(2);

    await act(async () => {
      await result.current.trash.mutateAsync(5);
    });
    expect(mocks.trash).toHaveBeenCalledWith(5);
    polling.resolve(listing([pending]));
    await flush();

    expect(result.current.library.resources).toEqual([]);
  });

  it('shows what the server lists after a change, not a slower answer from before', async () => {
    const extraction = deferred<ResourceItem>();
    const original = makeResource({ id: 3, extraction: { status: 'failed' } });
    mocks.list.mockImplementation(async ({ scope }: { scope: ResourceScope }) =>
      scope === 'unfiled'
        ? listing([makeResource({ id: 3, filename: 'unfiled.pdf', extraction: { status: 'pending' } })])
        : listing([original]),
    );
    mocks.extract.mockReturnValueOnce(extraction.promise);

    const initialProps: { location: ResourceLibraryLocation } = {
      location: { kind: 'smart', scope: 'library' },
    };
    const { result, rerender } = renderHook(
      ({ location }: { location: ResourceLibraryLocation }) => useResourceLibrary(location),
      { initialProps },
    );
    await flush();

    let retry!: Promise<ResourceItem>;
    act(() => {
      retry = result.current.retry(original);
    });
    await flush();
    rerender({ location: { kind: 'unfiled' } });
    await flush();

    extraction.resolve(makeResource({ id: 3, filename: 'old-ready.pdf' }));
    await act(async () => {
      await retry;
    });

    expect(result.current.resources[0]?.filename).toBe('unfiled.pdf');
    expect(result.current.resources[0]?.extraction.status).toBe('pending');
  });
});

describe('useResourceLibrary polling and mutations', () => {
  it('reads the list again while a row is converting, and stops once none is', async () => {
    mocks.list
      .mockResolvedValueOnce(listing([makeResource({ id: 9, extraction: { status: 'pending' } })]))
      .mockResolvedValue(listing([makeResource({ id: 9, extraction: { status: 'ready' } })]));

    const { result } = renderHook(() =>
      useResourceLibrary({ kind: 'smart', scope: 'library' }),
    );
    await flush();
    expect(result.current.settling).toBe(true);
    await tick(1_500);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(result.current.settling).toBe(false);

    await tick(120_000);
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it('backs off while a row stays converting and stops at the ceiling', async () => {
    mocks.list.mockResolvedValue(listing([makeResource({ id: 9, extraction: { status: 'running' } })]));

    renderHook(() => useResourceLibrary({ kind: 'smart', scope: 'library' }));
    await flush();
    await tick(1_500);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    // The next wait is longer than the first.
    await tick(1_500);
    expect(mocks.list).toHaveBeenCalledTimes(2);

    await tick(10 * 60_000);
    const calls = mocks.list.mock.calls.length;
    await tick(10 * 60_000);
    expect(mocks.list).toHaveBeenCalledTimes(calls);
  });

  it('does not poll failed, unsupported, or ready resources', async () => {
    for (const status of ['failed', 'unsupported', 'ready'] as const) {
      mocks.list.mockReset().mockResolvedValue(
        listing([makeResource({ extraction: { status } })]),
      );
      const { unmount } = renderHook(() =>
        useResourceLibrary({ kind: 'smart', scope: 'library' }),
      );
      await flush();
      await tick(120_000);
      expect(mocks.list).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('authoritatively refreshes after a failed optimistic move', async () => {
    const original = makeResource({ id: 4, filename: 'paper.pdf' });
    mocks.list.mockResolvedValue(listing([original]));
    mocks.move.mockRejectedValueOnce(new Error('Move rejected'));

    const { result } = renderHook(() =>
      useResourceLibrary({ kind: 'unfiled' }),
    );
    await flush();

    await act(async () => {
      await expect(result.current.move(4, { collectionId: 8 })).rejects.toThrow(
        'Move rejected',
      );
    });

    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(result.current.resources[0]?.location).toEqual({ kind: 'unfiled' });
  });

  it('sequences mutations instead of applying out-of-order responses', async () => {
    const firstResponse = deferred<ResourceItem>();
    mocks.list.mockResolvedValue(listing([makeResource({ id: 1 })]));
    mocks.move
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(makeResource({ id: 1, location: inCollection(9) }));

    const { result } = renderHook(() =>
      useResourceLibrary({ kind: 'smart', scope: 'library' }),
    );
    await flush();

    let first!: Promise<ResourceItem>;
    let second!: Promise<ResourceItem>;
    act(() => {
      first = result.current.move(1, { collectionId: 8 });
      second = result.current.move(1, { collectionId: 9 });
    });
    await flush();
    expect(mocks.move).toHaveBeenCalledTimes(1);

    firstResponse.resolve(makeResource({ id: 1, location: inCollection(8) }));
    await flush();
    expect(mocks.move).toHaveBeenCalledTimes(2);

    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(mocks.move.mock.calls.map((call) => call[1])).toEqual([
      { kind: 'collection', collection_id: 8 },
      { kind: 'collection', collection_id: 9 },
    ]);
  });

  it('keeps a failed load visible instead of presenting an empty success', async () => {
    mocks.list.mockRejectedValue(new Error('Network unreachable'));

    const { result } = renderHook(() =>
      useResourceLibrary({ kind: 'smart', scope: 'library' }),
    );
    await flush();

    expect(result.current.error).toBe('Network unreachable');
    expect(result.current.resources).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
