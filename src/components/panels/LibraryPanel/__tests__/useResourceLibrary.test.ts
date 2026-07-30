import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeResource } from '@/services/__tests__/resourceFixtures';
import type {
  ResourceItem,
  ResourceLibraryLocation,
  ResourceScope,
} from '@/services/resources';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  move: vi.fn(),
  extract: vi.fn(),
}));

vi.mock('@/services/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/resources')>();
  return {
    ...actual,
    listResources: mocks.list,
    getResource: mocks.get,
    uploadResource: mocks.upload,
    deleteResource: mocks.remove,
    attachResource: mocks.move,
    extractResource: mocks.extract,
  };
});

import { RESOURCE_PAGE_SIZE, useResourceLibrary } from '../useResourceLibrary';

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

function listing(
  resources: ResourceItem[],
  scope: ResourceScope = 'library',
  offset = 0,
  limit = RESOURCE_PAGE_SIZE,
) {
  return { resources, count: resources.length, scope, limit, offset };
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
  mocks.upload.mockReset();
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.move.mockReset().mockImplementation(async (id: number) => makeResource({ id }));
  mocks.extract.mockReset().mockImplementation(async (id: number) => makeResource({ id }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useResourceLibrary locations and paging', () => {
  it('loads an exact folder from a discriminated location', async () => {
    renderHook(() => useResourceLibrary({ kind: 'collection', collectionId: 7 }));
    await flush();

    expect(mocks.list).toHaveBeenCalledWith({
      scope: 'collection',
      collectionId: 7,
      limit: RESOURCE_PAGE_SIZE,
      offset: 0,
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
      expect.objectContaining({ scope: 'collection_recursive', collectionId: 4 }),
    );

    rerender({ location: { kind: 'unfiled' } });
    await flush();
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: 'unfiled', offset: 0 }),
    );
  });

  it('uses the page count and envelope offset to load more', async () => {
    const firstPage = Array.from({ length: RESOURCE_PAGE_SIZE }, (_, index) =>
      makeResource({ id: index + 1 }),
    );
    mocks.list
      .mockResolvedValueOnce(listing(firstPage))
      .mockResolvedValueOnce(listing([makeResource({ id: 51 })], 'library', RESOURCE_PAGE_SIZE));

    const { result } = renderHook(() =>
      useResourceLibrary({ kind: 'smart', scope: 'library' }),
    );
    await flush();

    expect(result.current.hasMore).toBe(true);
    expect(result.current.nextOffset).toBe(RESOURCE_PAGE_SIZE);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: RESOURCE_PAGE_SIZE, limit: RESOURCE_PAGE_SIZE }),
    );
    expect(result.current.resources).toHaveLength(51);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.nextOffset).toBeNull();
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
    newLoad.resolve(listing([makeResource({ id: 2, filename: 'unfiled.pdf' })], 'unfiled'));
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
      .mockResolvedValueOnce(listing([], 'library'));

    const { result } = renderHook(() =>
      useResourceLibrary({ kind: 'smart', scope: 'library' }),
    );
    await flush();

    await act(async () => {
      await result.current.remove(5);
    });
    staleLoad.resolve(listing([makeResource({ id: 5, filename: 'deleted.pdf' })]));
    await flush();

    expect(result.current.resources).toEqual([]);
  });

  it('does not let an in-flight poll resurrect a deleted resource', async () => {
    const polling = deferred<ResourceItem>();
    mocks.list
      .mockResolvedValueOnce(
        listing([makeResource({ id: 5, extraction_status: 'pending' })]),
      )
      .mockResolvedValueOnce(listing([]));
    mocks.get.mockReturnValueOnce(polling.promise);

    const { result } = renderHook(() =>
      useResourceLibrary({ kind: 'smart', scope: 'library' }),
    );
    await flush();
    await tick(1_500);
    expect(mocks.get).toHaveBeenCalledWith(5);

    await act(async () => {
      await result.current.remove(5);
    });
    polling.resolve(makeResource({ id: 5, extraction_status: 'ready' }));
    await flush();

    expect(result.current.resources).toEqual([]);
  });

  it('ignores a mutation response from the location it has left', async () => {
    const extraction = deferred<ResourceItem>();
    const original = makeResource({ id: 3, extraction_status: 'failed' });
    mocks.list
      .mockResolvedValueOnce(listing([original]))
      .mockResolvedValueOnce(
        listing([makeResource({ id: 3, filename: 'unfiled.pdf', extraction_status: 'pending' })], 'unfiled'),
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
    expect(result.current.resources[0]?.extraction_status).toBe('pending');
  });
});

describe('useResourceLibrary polling and mutations', () => {
  it('polls settling rows by id and stops after they become ready', async () => {
    const polling = deferred<ResourceItem>();
    mocks.list.mockResolvedValue(
      listing([makeResource({ id: 9, extraction_status: 'pending' })]),
    );
    mocks.get.mockReturnValueOnce(polling.promise);

    const { result } = renderHook(() =>
      useResourceLibrary({ kind: 'smart', scope: 'library' }),
    );
    await flush();
    await tick(1_500);
    expect(mocks.get).toHaveBeenCalledWith(9);

    polling.resolve(makeResource({ id: 9, extraction_status: 'ready' }));
    await flush();
    const callsAfterReady = mocks.get.mock.calls.length;
    await tick(120_000);

    expect(result.current.settling).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(callsAfterReady);
  });

  it('does not poll failed, unsupported, or ready resources', async () => {
    for (const status of ['failed', 'unsupported', 'ready'] as const) {
      mocks.list.mockReset().mockResolvedValue(
        listing([makeResource({ extraction_status: status })]),
      );
      const { unmount } = renderHook(() =>
        useResourceLibrary({ kind: 'smart', scope: 'library' }),
      );
      await flush();
      await tick(120_000);
      expect(mocks.get).not.toHaveBeenCalled();
      unmount();
      mocks.get.mockClear();
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
    expect(result.current.resources[0]?.collection_id).toBeNull();
  });

  it('sequences mutations instead of applying out-of-order responses', async () => {
    const firstResponse = deferred<ResourceItem>();
    mocks.list.mockResolvedValue(listing([makeResource({ id: 1 })]));
    mocks.move
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(makeResource({ id: 1, collection_id: 9 }));

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

    firstResponse.resolve(makeResource({ id: 1, collection_id: 8 }));
    await flush();
    expect(mocks.move).toHaveBeenCalledTimes(2);

    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(mocks.move.mock.calls.map((call) => call[1])).toEqual([
      { collectionId: 8 },
      { collectionId: 9 },
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
