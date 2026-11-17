import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient, renderHookWithQueryClient as renderHook } from '@/__tests__/queryClient';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { setPagePlacement } from '@/data/documents';

const mocks = vi.hoisted(() => ({
  createAndSwitch: vi.fn(),
  toast: vi.fn(),
  state: { creatingDocument: false, loadingDocumentId: null as string | null, documentId: null as string | null },
}));

vi.mock('@/editor', () => ({
  DEFAULT_DOCUMENT_TITLE: 'Untitled page',
  focusPageTitle: () => true,
  useDocumentActions: () => ({ createAndSwitch: mocks.createAndSwitch }),
  useDocumentSession: () => mocks.state,
}));

vi.mock('@/components/ui/toastContext', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { useNewPage } from './useNewPage';

const BLANK = { name: 'Untitled page', blocks: [] };

describe('useNewPage', () => {
  beforeEach(() => {
    mocks.createAndSwitch.mockReset();
    mocks.toast.mockReset();
    mocks.state.creatingDocument = false;
    mocks.state.loadingDocumentId = null;
    mocks.state.documentId = null;
  });

  it('creates a blank page at the top level when no page is open', async () => {
    mocks.createAndSwitch.mockResolvedValue('doc-1');
    const { result } = renderHook(() => useNewPage());
    await expect(result.current.newPage()).resolves.toBe('doc-1');
    expect(mocks.createAndSwitch).toHaveBeenCalledWith(BLANK, { collectionId: null });
  });

  it('creates the page "here": in the open page’s collection', async () => {
    mocks.createAndSwitch.mockResolvedValue('doc-2');
    mocks.state.documentId = 'doc-open';
    const queryClient = createTestQueryClient();
    setPagePlacement(queryClient, TEST_WORKSPACE_ID, {
      documentId: 'doc-open', collectionId: 4, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null,
    });
    const { result } = renderHook(() => useNewPage(), { queryClient });
    await result.current.newPage();
    expect(mocks.createAndSwitch).toHaveBeenCalledWith(BLANK, { collectionId: 4 });
  });

  it('creates where it is told to: a collection’s "+", or the top level', async () => {
    mocks.createAndSwitch.mockResolvedValue('doc-3');
    mocks.state.documentId = 'doc-open';
    const queryClient = createTestQueryClient();
    setPagePlacement(queryClient, TEST_WORKSPACE_ID, {
      documentId: 'doc-open', collectionId: 4, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null,
    });
    const { result } = renderHook(() => useNewPage(), { queryClient });
    await result.current.newPage(undefined, { collectionId: 9 });
    await result.current.newPage(undefined, { collectionId: null });
    expect(mocks.createAndSwitch.mock.calls.map((call) => call[1])).toEqual([{ collectionId: 9 }, { collectionId: null }]);
  });

  it('reports one failure once, even when two controls share the creation', async () => {
    // The editor hands a second caller the creation already in flight.
    const creation = Promise.reject(new Error('Quota reached'));
    creation.catch(() => undefined);
    mocks.createAndSwitch.mockReturnValue(creation);
    const first = renderHook(() => useNewPage());
    const second = renderHook(() => useNewPage());
    let results: Array<string | null> = [];
    await act(async () => {
      results = await Promise.all([first.result.current.newPage(), second.result.current.newPage()]);
    });
    expect(results).toEqual([null, null]);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Could not create the page',
      description: 'Quota reached',
      variant: 'error',
    });
  });

  it('is disabled while a page is being created or opened', () => {
    mocks.state.creatingDocument = true;
    const { result, rerender } = renderHook(() => useNewPage());
    expect(result.current.disabled).toBe(true);
    mocks.state.creatingDocument = false;
    mocks.state.loadingDocumentId = 'doc-2';
    rerender();
    expect(result.current.disabled).toBe(true);
  });
});
