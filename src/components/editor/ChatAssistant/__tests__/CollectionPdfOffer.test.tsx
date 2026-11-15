import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient, renderWithQueryClient as render } from '@/__tests__/queryClient';
import { recordRequests } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { ToastProvider } from '@/components/ui/toast';
import { setPagePlacement } from '@/data/documents';
import { TREE, TREE_PAGES, fixtures } from '@/dev/msw/fixtures';

const mocks = vi.hoisted(() => ({ documentId: null as string | null }));

vi.mock('@/editor', () => ({
  useDocumentId: () => mocks.documentId,
}));

const { CollectionPdfOffer } = await import('../CollectionPdfOffer');

const WS = TEST_WORKSPACE_ID;

/** The editor's read put the open page in `collectionId`. */
function openPageIn(collectionId: number | null) {
  const queryClient = createTestQueryClient();
  setPagePlacement(queryClient, WS, {
    documentId: TREE_PAGES.methods, collectionId, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null,
  });
  return render(<ToastProvider><CollectionPdfOffer /></ToastProvider>, { queryClient });
}

beforeEach(() => {
  localStorage.clear();
  mocks.documentId = TREE_PAGES.methods;
});

afterEach(cleanup);

describe('Use this collection’s PDFs on this page', () => {
  it('is offered for a page in a collection with PDFs, and accepting adds exactly one grant', async () => {
    openPageIn(TREE.chapter2);
    const sent = recordRequests();

    expect(await screen.findByText('Use this collection’s PDFs on this page?', { exact: false })).toBeTruthy();
    expect(screen.getByText(/Chapter 2 holds 1 PDF/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use on this page' }));
    });

    expect(await screen.findByText('This page now uses Chapter 2')).toBeTruthy();
    const grants = sent.filter((request) => request.method === 'PUT' && request.url.includes('/pdf-grants/'));
    expect(grants).toHaveLength(1);
    expect(fixtures.collections.get(TREE.chapter2)?.grants.get(TREE_PAGES.methods)).toBe('manual');
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Use this collection’s PDFs on this page' })).toBeNull());
  });

  it('remembers "Not now" for that page', async () => {
    openPageIn(TREE.chapter2);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('group', { name: 'Use this collection’s PDFs on this page' })).toBeNull();
    expect(localStorage.getItem(`colwrite:ws:${WS}:pdf-offer:${TREE_PAGES.methods}`)).toBe('1');

    cleanup();
    openPageIn(TREE.chapter2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('group', { name: 'Use this collection’s PDFs on this page' })).toBeNull();
  });

  it('is not offered at the top level, in a collection without PDFs, or once the page can read them', async () => {
    openPageIn(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('group')).toBeNull();
    cleanup();

    openPageIn(TREE.chapter1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('group')).toBeNull();
    cleanup();

    // "Pages here can use these PDFs" already gave it a grant.
    fixtures.collections.get(TREE.thesis)?.grants.set(TREE_PAGES.methods, 'setting');
    openPageIn(TREE.chapter2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('group')).toBeNull();
  });
});
