import { act, cleanup, waitFor } from '@testing-library/react';
import { renderHookWithQueryClient as renderHook } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, problem, queryOf, recordRequests, respond, server } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { makeCollection } from '@/data/__tests__/resourceFixtures';
import type { CollectionItem, CollectionListResponse } from '@/data/resources';
import { noteOwnTreeChange, workspaceKeys } from '@/data/workspaces';
import { TREE, TREE_PAGES, moveElsewhere } from '@/dev/msw/fixtures';
import { useWorkspaceTree } from '../useWorkspaceTree';

const WS = TEST_WORKSPACE_ID;

/** The server's `GET /workspaces/{w}/collections`, by its query. */
const mocks = { tree: vi.fn() };

function page(collections: CollectionItem[], nextCursor: string | null = null): CollectionListResponse {
  return { items: collections, next_cursor: nextCursor };
}

/** Answer the collection lists with `mocks.tree`, for the destination picker's tree. */
function standIn() {
  mocks.tree.mockReset().mockResolvedValue(page([]));
  server.use(http.get('/workspaces/{workspace_id}/collections', ({ request, response }) =>
    respond(() => mocks.tree(queryOf(request)), (body) => response(200).json(body))));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useWorkspaceTree, collections only (the destination picker)', () => {
  beforeEach(standIn);

  it('loads the top level at once and children lazily, without asking about any page', async () => {
    const root = makeCollection({ id: 1, name: 'Root', child_collection_count: 1 });
    const child = makeCollection({ id: 2, name: 'Child', parent_id: 1 });
    mocks.tree.mockResolvedValueOnce(page([root])).mockResolvedValueOnce(page([child]));

    const { result } = renderHook(() => useWorkspaceTree({ pages: false }));
    await waitFor(() => expect(result.current.branch(null)?.collections).toEqual([root]));
    expect(mocks.tree).toHaveBeenCalledTimes(1);

    act(() => result.current.setExpanded(1, true));
    await waitFor(() => expect(result.current.branch(1)?.collections).toEqual([child]));

    expect(result.current.isExpanded(1)).toBe(true);
    // The tree is not tied to the open page (C-15): no grant state is asked for.
    expect(mocks.tree).toHaveBeenNthCalledWith(1, { parent_id: 'root', limit: '50' });
    expect(mocks.tree).toHaveBeenLastCalledWith({ parent_id: '1', limit: '50' });
  });

  it('keeps the pages of rows it read and follows the server’s next cursor', async () => {
    mocks.tree
      .mockResolvedValueOnce(page([makeCollection({ id: 1 }), makeCollection({ id: 2 })], 'cursor-2'))
      .mockResolvedValueOnce(page([makeCollection({ id: 3 })]));

    const { result } = renderHook(() => useWorkspaceTree({ pages: false, pageSize: 2 }));
    await waitFor(() => expect(result.current.branch(null)?.moreCollections).toBe(true));

    await act(async () => {
      await result.current.loadMore(null, 'collections');
    });

    expect(result.current.branch(null)?.collections.map((collection) => collection.id)).toEqual([1, 2, 3]);
    expect(result.current.branch(null)?.moreCollections).toBe(false);
    expect(mocks.tree).toHaveBeenLastCalledWith({ parent_id: 'root', limit: '2', cursor: 'cursor-2' });
  });

  it('collapses without reading again, and reports a branch that failed', async () => {
    mocks.tree
      .mockResolvedValueOnce(page([makeCollection({ id: 1, name: 'Root', child_collection_count: 1 })]))
      .mockRejectedValueOnce(new Error('Collections unavailable'));

    const { result } = renderHook(() => useWorkspaceTree({ pages: false }));
    await waitFor(() => expect(result.current.branch(null)?.loaded).toBe(true));
    act(() => result.current.setExpanded(1, true));

    await waitFor(() => expect(result.current.branch(1)?.error).toBe('Collections unavailable'));
    act(() => result.current.setExpanded(1, false));
    expect(result.current.isExpanded(1)).toBe(false);
    expect(mocks.tree).toHaveBeenCalledTimes(2);
  });
});

describe('useWorkspaceTree with pages (the sidebar)', () => {
  it('holds two kinds of row: a home’s collections, then its pages in the home’s order', async () => {
    const { result } = renderHook(() => useWorkspaceTree());
    act(() => result.current.setExpanded(TREE.thesis, true));

    await waitFor(() => expect(result.current.branch(TREE.thesis)?.loaded).toBe(true));
    const thesis = result.current.branch(TREE.thesis);
    expect(thesis?.sortMode).toBe('custom');
    expect(thesis?.collections.map((item) => item.name)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(thesis?.pages.map((row) => row.name)).toEqual(['Outline']);
    expect(thesis?.pages[0]).toMatchObject({ collectionId: TREE.thesis, placementEtag: '"cwp:1"' });
  });

  it('opens a whole path to reveal what is at its end', async () => {
    const { result } = renderHook(() => useWorkspaceTree());
    act(() => result.current.expandPath([TREE.thesis, TREE.chapter2]));

    await waitFor(() => expect(result.current.branch(TREE.chapter2)?.pages.map((row) => row.id)).toEqual([TREE_PAGES.methods, TREE_PAGES.results]));
    expect(result.current.isExpanded(TREE.thesis)).toBe(true);
  });

  it('remembers the open collections per workspace, and only when asked', async () => {
    const remembered = renderHook(() => useWorkspaceTree({ persist: true }));
    act(() => remembered.result.current.setExpanded(TREE.archive, true));
    expect(JSON.parse(localStorage.getItem(`colwrite:ws:${WS}:tree:expanded`) ?? '[]')).toEqual([TREE.archive]);
    remembered.unmount();

    expect(renderHook(() => useWorkspaceTree({ persist: true })).result.current.isExpanded(TREE.archive)).toBe(true);
    // The picker's tree is its own, and starts closed.
    expect(renderHook(() => useWorkspaceTree({ pages: false })).result.current.isExpanded(TREE.archive)).toBe(false);
  });

  it('reads its open branches again when tree_version moved elsewhere, and not after its own change', async () => {
    const { result, queryClient } = renderHook(() => useWorkspaceTree({ watch: true }));
    act(() => result.current.setExpanded(TREE.thesis, true));
    await waitFor(() => expect(result.current.branch(TREE.thesis)?.pages.map((row) => row.name)).toEqual(['Outline']));
    const sent = recordRequests();
    const reads = () => sent.filter((request) => request.method === 'GET' && /\/(documents|collections)$/.test(new URL(request.url).pathname));

    // Someone else moves a page: the next look at the workspace finds the tree moved.
    moveElsewhere(TREE_PAGES.outline, TREE.archive);
    await act(async () => queryClient.refetchQueries({ queryKey: workspaceKeys.detail(WS) }));
    await waitFor(() => expect(result.current.branch(TREE.thesis)?.pages).toEqual([]));
    expect(reads().length).toBeGreaterThan(0);

    // This client's own change, already shown, is not read twice.
    const seen = reads().length;
    const version = (await queryClient.fetchQuery({ queryKey: workspaceKeys.detail(WS) }) as { tree_version: number }).tree_version;
    moveElsewhere(TREE_PAGES.outline, TREE.thesis);
    noteOwnTreeChange(WS, version + 1);
    await act(async () => queryClient.refetchQueries({ queryKey: workspaceKeys.detail(WS) }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads()).toHaveLength(seen);
  });

  it('says a branch could not be read, with the server’s words for a refusal', async () => {
    server.use(http.get('/workspaces/{workspace_id}/documents', () => problem('collection_not_found', 'Collection not found')));
    const { result } = renderHook(() => useWorkspaceTree());
    await waitFor(() => expect(result.current.branch(null)?.error).toBe('Collection not found'));
  });
});
