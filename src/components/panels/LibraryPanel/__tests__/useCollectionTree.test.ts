import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCollection } from '@/services/__tests__/resourceFixtures';
import type {
  CollectionAttachmentState,
  CollectionDetailResponse,
  CollectionItem,
  CollectionTreeResponse,
} from '@/services/resources';

const mocks = vi.hoisted(() => ({
  tree: vi.fn(),
  detail: vi.fn(),
  createRoot: vi.fn(),
  createChild: vi.fn(),
  update: vi.fn(),
  move: vi.fn(),
  preview: vi.fn(),
  remove: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
}));

vi.mock('@/services/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/resources')>();
  return {
    ...actual,
    listCollectionTree: mocks.tree,
    getCollectionDetail: mocks.detail,
    createCollection: mocks.createRoot,
    createChildCollection: mocks.createChild,
    updateCollection: mocks.update,
    moveCollectionParent: mocks.move,
    previewCollectionDelete: mocks.preview,
    deleteCollectionRecursive: mocks.remove,
    attachCollectionDocument: mocks.attach,
    detachCollectionDocument: mocks.detach,
  };
});

import { useCollectionTree } from '../useCollectionTree';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function page(
  parentId: number | null,
  collections: CollectionItem[],
  options: { offset?: number; limit?: number; nextOffset?: number | null } = {},
): CollectionTreeResponse {
  return {
    collections,
    count: collections.length,
    parent_id: parentId,
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    next_offset: options.nextOffset ?? null,
  };
}

function detail(
  collection: CollectionItem,
  attachment: CollectionAttachmentState | null = null,
): CollectionDetailResponse {
  const root = makeCollection({ id: 1, name: 'Root', parent_id: null, depth: 1 });
  return {
    collection,
    path:
      collection.id === root.id
        ? [{ id: root.id, parent_id: null, name: root.name, depth: 1 }]
        : [
            { id: root.id, parent_id: null, name: root.name, depth: 1 },
            {
              id: collection.id,
              parent_id: collection.parent_id,
              name: collection.name,
              depth: collection.depth ?? 2,
            },
          ],
    attachment,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.tree.mockReset().mockResolvedValue(page(null, []));
  mocks.detail.mockReset();
  mocks.createRoot.mockReset();
  mocks.createChild.mockReset();
  mocks.update.mockReset();
  mocks.move.mockReset();
  mocks.preview.mockReset();
  mocks.remove.mockReset().mockResolvedValue({
    status: 'success',
    message: 'Collection subtree deleted',
    collection_count: 1,
    membership_count: 0,
    resource_count: 0,
    resource_bytes: 0,
    cleanup_pending_count: 0,
  });
  mocks.attach.mockReset();
  mocks.detach.mockReset();
});

afterEach(cleanup);

describe('useCollectionTree loading and selection', () => {
  it('loads roots immediately and children lazily when expanded', async () => {
    const root = makeCollection({ id: 1, name: 'Root', child_count: 1 });
    const child = makeCollection({ id: 2, name: 'Child', parent_id: 1, depth: 2 });
    mocks.tree
      .mockResolvedValueOnce(page(null, [root]))
      .mockResolvedValueOnce(page(1, [child]));

    const { result } = renderHook(() => useCollectionTree({ documentId: 'doc-1' }));
    await flush();

    expect(result.current.roots).toEqual([root]);
    expect(mocks.tree).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.setExpanded(1, true);
    });

    expect(result.current.expandedIds.has(1)).toBe(true);
    expect(result.current.childrenOf(1)).toEqual([child]);
    expect(mocks.tree).toHaveBeenLastCalledWith({
      parentId: 1,
      documentId: 'doc-1',
      limit: 50,
      offset: 0,
    });
  });

  it('retains exact child pages and follows backend next_offset', async () => {
    const first = [makeCollection({ id: 1 }), makeCollection({ id: 2 })];
    const second = [makeCollection({ id: 3 })];
    mocks.tree
      .mockResolvedValueOnce(page(null, first, { limit: 2, nextOffset: 2 }))
      .mockResolvedValueOnce(page(null, second, { limit: 2, offset: 2 }));

    const { result } = renderHook(() => useCollectionTree({ pageSize: 2 }));
    await flush();
    expect(result.current.branches.root?.nextOffset).toBe(2);

    await act(async () => {
      await result.current.loadMore(null);
    });

    expect(result.current.roots.map((collection) => collection.id)).toEqual([1, 2, 3]);
    expect(result.current.branches.root?.pages).toHaveLength(2);
    expect(result.current.branches.root?.nextOffset).toBeNull();
  });

  it('loads detail, parent, path, and inherited attachment for unloaded selections', async () => {
    const selected = makeCollection({ id: 9, name: 'Nested', parent_id: 1, depth: 2 });
    const inherited: CollectionAttachmentState = {
      collection_id: 9,
      direct: false,
      effective: true,
      nearest_direct_collection_id: 1,
      nearest_direct_collection_name: 'Root',
    };
    mocks.detail.mockResolvedValue(detail(selected, inherited));

    const { result } = renderHook(() => useCollectionTree({ documentId: 'doc-1' }));
    await flush();
    await act(async () => {
      await result.current.selectCollection(9);
    });

    expect(mocks.detail).toHaveBeenCalledWith(9, { documentId: 'doc-1' });
    expect(result.current.selectedCollection).toEqual({ ...selected, attachment: inherited });
    expect(result.current.selectedParentId).toBe(1);
    expect(result.current.path.map((item) => item.name)).toEqual(['Root', 'Nested']);
    expect(result.current.attachment).toEqual(inherited);
  });

  it('keeps document attachment state when detail metadata replaces a tree row', async () => {
    const attachment: CollectionAttachmentState = {
      collection_id: 1,
      direct: true,
      effective: true,
      nearest_direct_collection_id: 1,
      nearest_direct_collection_name: 'Root',
    };
    const root = makeCollection({ id: 1, name: 'Root', attachment });
    mocks.tree.mockResolvedValue(page(null, [root]));
    mocks.detail.mockResolvedValue({
      collection: { ...root, attachment: null },
      path: [{ id: 1, parent_id: null, name: 'Root', depth: 1 }],
      attachment,
    });

    const { result } = renderHook(() => useCollectionTree({ documentId: 'doc-1' }));
    await flush();
    await act(async () => {
      await result.current.selectCollection(1);
    });

    expect(result.current.roots[0]?.attachment).toEqual(attachment);
    expect(result.current.selectedCollection?.attachment).toEqual(attachment);
  });

  it('ignores a stale root page after the document context changes', async () => {
    const oldRoot = deferred<CollectionTreeResponse>();
    const newRoot = deferred<CollectionTreeResponse>();
    mocks.tree.mockReturnValueOnce(oldRoot.promise).mockReturnValueOnce(newRoot.promise);

    const initialProps = { documentId: 'doc-1' };
    const { result, rerender } = renderHook(
      ({ documentId }: { documentId: string }) => useCollectionTree({ documentId }),
      { initialProps },
    );
    await flush();

    rerender({ documentId: 'doc-2' });
    await flush();
    newRoot.resolve(page(null, [makeCollection({ id: 2, name: 'New' })]));
    await flush();
    oldRoot.resolve(page(null, [makeCollection({ id: 1, name: 'Old' })]));
    await flush();

    expect(result.current.roots.map((collection) => collection.name)).toEqual(['New']);
  });
});

describe('useCollectionTree targeted mutation invalidation', () => {
  it('refreshes only the created folder branch and its containing branch', async () => {
    const root = makeCollection({ id: 1, name: 'Root', child_count: 0 });
    const created = makeCollection({ id: 2, name: 'Child', parent_id: 1, depth: 2 });
    mocks.tree.mockImplementation(async ({ parentId }: { parentId: number | null }) => {
      if (parentId === 1) return page(1, mocks.createChild.mock.calls.length ? [created] : []);
      return page(null, [root]);
    });
    mocks.createChild.mockResolvedValue(created);

    const { result } = renderHook(() => useCollectionTree());
    await flush();
    await act(async () => {
      await result.current.setExpanded(1, true);
    });
    mocks.tree.mockClear();

    await act(async () => {
      await result.current.createFolder({ name: 'Child', parentId: 1 });
    });

    expect(mocks.createChild).toHaveBeenCalledWith(1, 'Child', undefined);
    expect(new Set(mocks.tree.mock.calls.map(([options]) => options.parentId))).toEqual(
      new Set([null, 1]),
    );
    expect(result.current.childrenOf(1)).toEqual([created]);
  });

  it('invalidates an in-flight child page before recursive deletion', async () => {
    const root = makeCollection({ id: 1, name: 'Root', child_count: 1 });
    const staleChildren = deferred<CollectionTreeResponse>();
    mocks.tree
      .mockResolvedValueOnce(page(null, [root]))
      .mockReturnValueOnce(staleChildren.promise)
      .mockResolvedValueOnce(page(null, []));

    const { result } = renderHook(() => useCollectionTree());
    await flush();
    let expanding!: Promise<void>;
    act(() => {
      expanding = result.current.setExpanded(1, true);
    });
    await flush();

    await act(async () => {
      await result.current.deleteFolder(1, {
        collection_id: 1,
        status: 'ready',
        collection_count: 1,
        membership_count: 0,
        resource_count: 0,
        resource_bytes: 0,
      });
    });
    staleChildren.resolve(
      page(1, [makeCollection({ id: 2, name: 'Deleted child', parent_id: 1 })]),
    );
    await act(async () => {
      await expanding;
    });

    expect(result.current.roots).toEqual([]);
    expect(result.current.branches['1']).toBeUndefined();
    expect(result.current.expandedIds.has(1)).toBe(false);
  });

  it('does not let a pre-move detail response restore the old folder path', async () => {
    const moving = makeCollection({ id: 1, name: 'Moving' });
    const target = makeCollection({ id: 9, name: 'Target' });
    const moved = { ...moving, parent_id: 9, depth: 2 };
    const staleDetail = deferred<CollectionDetailResponse>();
    let moveFinished = false;

    mocks.tree.mockImplementation(async ({ parentId }: { parentId: number | null }) =>
      page(parentId, parentId === null ? (moveFinished ? [target] : [moving, target]) : []),
    );
    mocks.detail
      .mockReturnValueOnce(staleDetail.promise)
      .mockResolvedValueOnce({
        collection: moved,
        path: [
          { id: 9, parent_id: null, name: 'Target', depth: 1 },
          { id: 1, parent_id: 9, name: 'Moving', depth: 2 },
        ],
        attachment: null,
      });
    mocks.move.mockImplementation(async () => {
      moveFinished = true;
      return moved;
    });

    const { result } = renderHook(() => useCollectionTree());
    await flush();

    let selecting!: Promise<CollectionDetailResponse | null>;
    act(() => {
      selecting = result.current.selectCollection(1);
    });
    await flush();

    await act(async () => {
      await result.current.moveFolder(1, 9);
    });
    staleDetail.resolve({
      collection: moving,
      path: [{ id: 1, parent_id: null, name: 'Moving', depth: 1 }],
      attachment: null,
    });
    await act(async () => {
      await selecting;
    });

    expect(result.current.selectedCollection?.parent_id).toBe(9);
    expect(result.current.path.map((item) => item.name)).toEqual(['Target', 'Moving']);
    expect(result.current.roots.map((item) => item.name)).toEqual(['Target']);
  });

  it('sequences deferred folder mutations so responses cannot apply out of order', async () => {
    const root = makeCollection({ id: 1, name: 'Root' });
    const firstUpdate = deferred<CollectionItem>();
    mocks.tree.mockResolvedValue(page(null, [root]));
    mocks.update
      .mockReturnValueOnce(firstUpdate.promise)
      .mockResolvedValueOnce(makeCollection({ id: 1, name: 'Second' }));

    const { result } = renderHook(() => useCollectionTree());
    await flush();

    let first!: Promise<CollectionItem>;
    let second!: Promise<CollectionItem>;
    act(() => {
      first = result.current.renameFolder(1, { name: 'First' });
      second = result.current.renameFolder(1, { name: 'Second' });
    });
    await flush();
    expect(mocks.update).toHaveBeenCalledTimes(1);

    firstUpdate.resolve(makeCollection({ id: 1, name: 'First' }));
    await flush();
    expect(mocks.update).toHaveBeenCalledTimes(2);

    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(mocks.update.mock.calls.map((call) => call[1])).toEqual([
      { name: 'First' },
      { name: 'Second' },
    ]);
  });

  it('refreshes loaded descendants after a direct attachment changes inheritance', async () => {
    const direct: CollectionAttachmentState = {
      collection_id: 1,
      direct: true,
      effective: true,
      nearest_direct_collection_id: 1,
      nearest_direct_collection_name: 'Root',
    };
    const root = makeCollection({ id: 1, name: 'Root', child_count: 1 });
    const child = makeCollection({ id: 2, name: 'Child', parent_id: 1, child_count: 0 });
    let attached = false;
    mocks.tree.mockImplementation(async ({ parentId }: { parentId: number | null }) => {
      if (parentId === 1) {
        return page(1, [
          {
            ...child,
            attachment: attached
              ? { ...direct, collection_id: 2, direct: false }
              : null,
          },
        ]);
      }
      return page(null, [{ ...root, attachment: attached ? direct : null }]);
    });
    mocks.attach.mockImplementation(async () => {
      attached = true;
      return direct;
    });

    const { result } = renderHook(() => useCollectionTree({ documentId: 'doc-1' }));
    await flush();
    await act(async () => {
      await result.current.setExpanded(1, true);
    });

    await act(async () => {
      await result.current.attachDocument(1);
    });

    expect(mocks.attach).toHaveBeenCalledWith(1, 'doc-1');
    expect(result.current.roots[0]?.attachment?.direct).toBe(true);
    expect(result.current.childrenOf(1)[0]?.attachment).toMatchObject({
      direct: false,
      effective: true,
      nearest_direct_collection_id: 1,
    });
  });
});
