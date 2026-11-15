import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRef, useImperativeHandle } from 'react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { recordRequests } from '@/__tests__/server';
import { TEST_WORKSPACE_ID as WS } from '@/__tests__/workspace';
import { ToastProvider } from '@/components/ui/toast';
import { EditorProvider } from '@/editor';
import { useEditorProbe } from '@/editor/__tests__/editorHarness';
import { documentKeys } from '@/data/documents';
import { lastPageKey, writeItem } from '@/lib/storageKeys';
import { FIXTURE_DOCUMENT_ID, TREE, TREE_PAGES, fixtures, trashCollectionTree, trashElsewhere } from '@/dev/msw/fixtures';
import { TrashedPageBar } from '../TrashedPageBar';

/**
 * The open page goes to the Trash elsewhere (another tab, or with its
 * collection): the editor finds out when it reads where the page lives
 * again, or when a save is refused, and says so with Restore. Against the
 * mock API, with the real editor session.
 */

const probe = createRef<ReturnType<typeof useEditorProbe>>();

function Probe() {
  const editor = useEditorProbe();
  useImperativeHandle(probe, () => editor, [editor]);
  return null;
}

function renderPage(documentId: string) {
  writeItem(lastPageKey(WS), documentId);
  return render(
    <ToastProvider>
      <EditorProvider>
        <Probe />
        <TrashedPageBar />
      </EditorProvider>
    </ToastProvider>,
  );
}

const editor = () => {
  if (!probe.current) throw new Error('The editor is not mounted');
  return probe.current;
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('a page in the Trash', () => {
  it('shows the bar once a read finds the page trashed elsewhere, and Restore brings it back', async () => {
    const { queryClient } = renderPage(FIXTURE_DOCUMENT_ID);
    await waitFor(() => expect(editor().documentId).toBe(FIXTURE_DOCUMENT_ID));
    await waitFor(() => expect(editor().loadingDocumentId).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();

    trashElsewhere(FIXTURE_DOCUMENT_ID);
    // The tree reads where the open page lives again when `tree_version` moved.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: documentKeys.placements(WS) });
    });

    expect((await screen.findByRole('alert')).textContent).toContain('This page is in the Trash.');
    expect(editor().inTrash?.trashRoot).toEqual({ kind: 'document', id: FIXTURE_DOCUMENT_ID });

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fixtures.documents.get(FIXTURE_DOCUMENT_ID)?.deleted_at).toBeNull();
    expect(editor().inTrash).toBeNull();
  });

  it('stops saving when a save is refused because the page is in the Trash, and saves after the restore', async () => {
    renderPage(FIXTURE_DOCUMENT_ID);
    await waitFor(() => expect(editor().loadingDocumentId).toBeNull());
    await waitFor(() => expect(editor().documentId).toBe(FIXTURE_DOCUMENT_ID));
    trashElsewhere(FIXTURE_DOCUMENT_ID);
    const sent = recordRequests();

    act(() => editor().setDocName('Written while it was in the Trash'));
    act(() => editor().save());

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(editor().saveError).toBeNull();
    const puts = () => sent.filter((request) => request.method === 'PUT');
    expect(puts()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    act(() => editor().save());
    await waitFor(() => expect(fixtures.documents.get(FIXTURE_DOCUMENT_ID)?.name).toBe('Written while it was in the Trash'));
    expect(puts()).toHaveLength(2);
  });

  it('names the collection it went with, and Restore brings the collection back', async () => {
    renderPage(TREE_PAGES.methods);
    await waitFor(() => expect(editor().documentId).toBe(TREE_PAGES.methods));
    await waitFor(() => expect(editor().loadingDocumentId).toBeNull());
    const chapter2 = fixtures.collections.get(TREE.chapter2)!;
    trashCollectionTree(chapter2);

    act(() => editor().setDocName('Methods, revised'));
    act(() => editor().save());

    const bar = await screen.findByRole('alert');
    expect(bar.textContent).toContain('It went there with');
    fireEvent.click(screen.getByRole('button', { name: /^Restore/ }));
    await waitFor(() => expect(fixtures.collections.get(TREE.chapter2)?.trashed_at).toBeNull());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
