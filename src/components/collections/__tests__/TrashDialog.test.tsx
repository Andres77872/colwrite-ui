import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { ToastProvider } from '@/components/ui/toast';
import { FakeEditorProviders } from '@/editor/__tests__/editorHarness';
import { WorkspaceContext, type WorkspaceContextValue } from '@/components/workspace/workspaceContextState';
import { resetModuleState } from '@/lib/moduleState';
import {
  LAB_DOCUMENT_ID,
  LAB_WORKSPACE_ID,
  TRASHED,
  TREE,
  TREE_PAGES,
  PREVIEW_USER_ID,
  fixtures,
  trashPage,
} from '@/dev/msw/fixtures';
import { TrashDialog } from '../TrashDialog';

const editor = {
  documentId: null,
  switchTo: vi.fn(async () => true),
  markPageRestored: vi.fn(),
  markPageTrashed: vi.fn(),
  flushPendingSave: vi.fn(async () => true),
  newLocal: vi.fn(),
};

function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <FakeEditorProviders value={editor}>{children}</FakeEditorProviders>
    </ToastProvider>
  );
}

function renderTrash(wrap: (ui: ReactNode) => ReactNode = (ui) => ui) {
  return render(<Providers>{wrap(<TrashDialog open onOpenChange={() => undefined} />)}</Providers>);
}

/** The Lab workspace, where the account is an editor, not an admin. */
function inLab(ui: ReactNode) {
  const lab = { id: LAB_WORKSPACE_ID, name: 'Lab workspace', kind: 'shared', role: 'editor', icon: null, last_opened_at: null, member_count: 3 } as const;
  const value: WorkspaceContextValue = { workspaces: [lab], deleted: [], workspace: lab, multiWorkspace: true, switchWorkspace: async () => {} };
  return <WorkspaceContext.Provider value={value}>{ui}</WorkspaceContext.Provider>;
}

const itemNamed = async (name: string) => (await screen.findByText(name)).closest('li') as HTMLElement;

afterEach(() => {
  cleanup();
  resetModuleState();
  vi.clearAllMocks();
});

describe('TrashDialog', () => {
  it('lists what is in the Trash, newest first, with where it was, what it holds and when it goes', async () => {
    renderTrash();

    const page = await itemNamed('Discarded abstract');
    const collection = await itemNamed('Old drafts');
    const rows = within(screen.getByRole('list', { name: 'In the Trash' })).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('p')?.textContent)).toEqual(['Discarded abstract', 'Old drafts']);
    expect(page.textContent).toContain('in Thesis');
    expect(page.textContent).toContain('Deleted forever in 29 days');
    expect(collection.textContent).toContain('Top level · 1 collection · 2 pages · 1 PDF');
    expect(collection.textContent).toContain('Deleted forever in 27 days');
  });

  it('restores a page where it was, and says so', async () => {
    renderTrash();

    fireEvent.click(within(await itemNamed('Discarded abstract')).getByRole('button', { name: 'Restore Discarded abstract' }));

    expect(await screen.findByText('Restored Discarded abstract')).toBeTruthy();
    expect(fixtures.documents.get(TRASHED.page)).toMatchObject({ deleted_at: null, collection_id: TREE.thesis });
    expect(editor.markPageRestored).toHaveBeenCalledWith(TRASHED.page);
    await waitFor(() => expect(screen.queryByText('Discarded abstract')).toBeNull());
  });

  it('deletes forever only after the name is typed, with the server’s counts, and shows the job', async () => {
    renderTrash();

    fireEvent.click(within(await itemNamed('Old drafts')).getByRole('button', { name: 'Delete Old drafts forever' }));
    const confirm = await screen.findByRole('dialog', { name: 'Permanently delete Old drafts?' });
    expect(within(confirm).getByText(/^This removes Old drafts, 1 collection, 2 pages and 1 PDF \(.+ of PDFs\)\. It can't be undone\.$/)).toBeTruthy();
    const remove = within(confirm).getByRole('button', { name: 'Delete forever' });
    expect(remove.hasAttribute('disabled')).toBe(true);

    fireEvent.change(within(confirm).getByLabelText(/Type Old drafts to confirm/), { target: { value: 'old drafts' } });
    expect(remove.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(confirm).getByLabelText(/Type Old drafts to confirm/), { target: { value: 'Old drafts' } });
    await act(async () => {
      fireEvent.click(remove);
    });

    expect(fixtures.collections.has(TRASHED.collection)).toBe(false);
    // The purge runs as a job; its progress shows until it is done.
    expect(await screen.findByText('Deleting Old drafts forever…')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Old drafts')).toBeNull());
  });

  it('shows the new counts when the collection holds something else now, and asks for the name again', async () => {
    renderTrash();
    fireEvent.click(within(await itemNamed('Old drafts')).getByRole('button', { name: 'Delete Old drafts forever' }));
    const confirm = await screen.findByRole('dialog', { name: 'Permanently delete Old drafts?' });
    // Meanwhile a page goes to the Trash with it.
    const methods = fixtures.documents.get(TREE_PAGES.methods)!;
    fixtures.documents.set(methods._id, {
      ...methods, collection_id: TRASHED.collection, deleted_at: new Date().toISOString(),
      trash_root: { kind: 'collection', id: String(TRASHED.collection) },
    });

    fireEvent.change(within(confirm).getByLabelText(/Type Old drafts to confirm/), { target: { value: 'Old drafts' } });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Delete forever' }));
    });

    expect(await within(confirm).findByText(/^This removes Old drafts, 1 collection, 3 pages and 1 PDF/)).toBeTruthy();
    expect(within(confirm).getByText('It holds something else now. Check what goes, then type its name again.')).toBeTruthy();
    expect((within(confirm).getByLabelText(/Type Old drafts to confirm/) as HTMLInputElement).value).toBe('');
    expect(fixtures.collections.has(TRASHED.collection)).toBe(true);
  });

  it('empties the Trash after the workspace’s name is typed', async () => {
    renderTrash();
    await itemNamed('Old drafts');

    fireEvent.click(screen.getByRole('button', { name: 'Empty Trash…' }));
    const confirm = await screen.findByRole('dialog', { name: 'Empty the Trash?' });
    fireEvent.change(within(confirm).getByLabelText(/Type Personal to confirm/), { target: { value: 'Personal' } });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Empty Trash' }));
    });

    expect(await screen.findByText('The Trash is empty')).toBeTruthy();
    expect(fixtures.documents.has(TRASHED.page)).toBe(false);
  });

  it('offers editors Restore only, and says when only who trashed it, or an admin, can restore it', async () => {
    trashPage(fixtures.documents.get(LAB_DOCUMENT_ID)!, 'u-another-member');
    renderTrash(inLab);

    const row = await itemNamed('Lab meeting notes');
    expect(within(row).queryByRole('button', { name: /forever/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Empty Trash…' })).toBeNull();

    // Someone else's trash: Restore says in advance that it is not this editor's (M6).
    const restore = within(row).getByRole('button', { name: 'Restore Lab meeting notes' }) as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    expect(restore.getAttribute('title')).toBe('Only an admin, or the person who moved it here, can restore it.');
    // Who moved it, from the member list: someone who is not a member any more.
    expect(await within(row).findByText(/moved by a former member/)).toBeTruthy();
  });

  it('names who moved each item there from the member list', async () => {
    trashPage(fixtures.documents.get(LAB_DOCUMENT_ID)!, 'u-grace');
    renderTrash(inLab);
    const row = await itemNamed('Lab meeting notes');
    expect(await within(row).findByText(/moved by Grace Hopper/)).toBeTruthy();
    expect((within(row).getByRole('button', { name: 'Restore Lab meeting notes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets an editor restore what they moved there themselves', async () => {
    trashPage(fixtures.documents.get(LAB_DOCUMENT_ID)!, PREVIEW_USER_ID);
    renderTrash(inLab);
    const row = await itemNamed('Lab meeting notes');
    expect(await within(row).findByText(/moved by you/)).toBeTruthy();
    expect((within(row).getByRole('button', { name: 'Restore Lab meeting notes' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
