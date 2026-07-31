import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentListResult, DocumentSummary } from '@/services/contracts';

const mocks = vi.hoisted(() => ({
  listRemote: vi.fn(),
  switchTo: vi.fn(),
  createAndSwitch: vi.fn(),
  deleteRemote: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  editorState: {
    documentId: null as string | null,
    loadingDocumentId: null as string | null,
    documentListRevision: 0,
  },
}));

vi.mock('@/editor', () => ({
  useEditor: () => ({
    listRemote: mocks.listRemote,
    switchTo: mocks.switchTo,
    createAndSwitch: mocks.createAndSwitch,
    deleteRemote: mocks.deleteRemote,
    documentId: mocks.editorState.documentId,
    loadingDocumentId: mocks.editorState.loadingDocumentId,
    documentListRevision: mocks.editorState.documentListRevision,
  }),
}));

vi.mock('@/components/ui/confirmContext', () => ({
  useConfirm: () => mocks.confirm,
}));

vi.mock('@/components/ui/toastContext', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { DocumentsMenu } from './DocumentsMenu';

const updatedAt = '2026-07-28T18:30:00Z';

function documentSummary(name: string, id = name.toLowerCase().replace(/\s+/g, '-')): DocumentSummary {
  return {
    id,
    name,
    version: 2,
    tags: [],
    createdAt: '2026-07-01T12:00:00Z',
    updatedAt,
  };
}

function listResult(
  documents: DocumentSummary[] = [documentSummary('Research notes')],
  count = documents.length,
): DocumentListResult {
  return {
    documents,
    count,
    page: 1,
    limit: 10,
    totalPages: Math.ceil(count / 10),
    sortBy: 'updated_at',
    sortOrder: 'desc',
    status: 'ok',
    message: '',
  };
}

beforeEach(() => {
  mocks.editorState.documentId = null;
  mocks.editorState.loadingDocumentId = null;
  mocks.editorState.documentListRevision = 0;
  mocks.listRemote.mockReset().mockResolvedValue(listResult());
  mocks.switchTo.mockReset().mockResolvedValue(true);
  mocks.createAndSwitch.mockReset().mockResolvedValue('new-document');
  mocks.deleteRemote.mockReset().mockResolvedValue(undefined);
  mocks.confirm.mockReset().mockResolvedValue(false);
  mocks.toast.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('DocumentsMenu listing controls', () => {
  it('defaults to last-updated newest, renders all six sorts, and shows the update time', async () => {
    render(<DocumentsMenu />);

    await waitFor(() => expect(mocks.listRemote).toHaveBeenCalledTimes(1));
    expect(mocks.listRemote).toHaveBeenCalledWith(
      {
        page: 1,
        limit: 10,
        query: undefined,
        sortBy: 'updated_at',
        sortOrder: 'desc',
      },
      { signal: expect.any(AbortSignal) },
    );

    const sort = screen.getByRole('combobox', { name: 'Sort documents' });
    expect((sort as HTMLSelectElement).value).toBe('updated_at:desc');
    expect(within(sort).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Last updated — newest',
      'Last updated — oldest',
      'Date created — newest',
      'Date created — oldest',
      'Title — A–Z',
      'Title — Z–A',
    ]);

    expect(await screen.findByText('Research notes')).toBeTruthy();
    const timestamp = screen.getByText(/^Updated /);
    expect(timestamp.tagName).toBe('TIME');
    expect(timestamp.getAttribute('datetime')).toBe(updatedAt);
  });

  it('resets pagination when sort or debounced search changes', async () => {
    mocks.listRemote.mockResolvedValue(listResult([documentSummary('One')], 12));
    render(<DocumentsMenu />);

    await screen.findByText(/Page 1 of 2/);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(mocks.listRemote.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2 });
    });

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort documents' }), {
      target: { value: 'name:asc' },
    });
    await waitFor(() => {
      expect(mocks.listRemote.mock.calls.at(-1)?.[0]).toMatchObject({
        page: 1,
        sortBy: 'name',
        sortOrder: 'asc',
      });
    });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search documents' }), {
      target: { value: '  chapter  ' },
    });
    await waitFor(() => {
      expect(mocks.listRemote.mock.calls.at(-1)?.[0]).toMatchObject({
        page: 1,
        query: 'chapter',
        sortBy: 'name',
        sortOrder: 'asc',
      });
    });
  });

  it('aborts superseded requests and ignores a stale response that resolves last', async () => {
    let resolveFirst!: (result: DocumentListResult) => void;
    const firstRequest = new Promise<DocumentListResult>((resolve) => {
      resolveFirst = resolve;
    });
    mocks.listRemote
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValueOnce(listResult([documentSummary('Newest result', 'newest')]));

    render(<DocumentsMenu />);
    await waitFor(() => expect(mocks.listRemote).toHaveBeenCalledTimes(1));
    const firstSignal = mocks.listRemote.mock.calls[0][1].signal as AbortSignal;

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort documents' }), {
      target: { value: 'created_at:asc' },
    });

    expect(await screen.findByText('Newest result')).toBeTruthy();
    expect(firstSignal.aborted).toBe(true);

    await act(async () => {
      resolveFirst(listResult([documentSummary('Stale result', 'stale')]));
    });
    expect(screen.queryByText('Stale result')).toBeNull();
    expect(screen.getByText('Newest result')).toBeTruthy();
  });

  it('refreshes explicitly and reacts to a mutation revision', async () => {
    const view = render(<DocumentsMenu />);
    await screen.findByText('Research notes');
    mocks.listRemote.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh document list' }));
    await waitFor(() => expect(mocks.listRemote).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: 'Refresh document list' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    mocks.editorState.documentListRevision += 1;
    view.rerender(<DocumentsMenu />);
    await waitFor(() => expect(mocks.listRemote).toHaveBeenCalledTimes(2));
  });

  it('creates and switches atomically instead of retaining the previous editor body', async () => {
    render(<DocumentsMenu />);
    await screen.findByText('Research notes');

    fireEvent.click(screen.getByRole('button', { name: 'New document' }));

    await waitFor(() => {
      expect(mocks.createAndSwitch).toHaveBeenCalledWith({
        version: 1,
        name: 'Untitled document',
        blocks: [],
      });
    });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Document created',
      variant: 'success',
    });
  });

  it('keeps current semantics on the committed row and marks only the pending row', async () => {
    mocks.editorState.documentId = 'current';
    mocks.editorState.loadingDocumentId = 'pending';
    mocks.listRemote.mockResolvedValue(listResult([
      documentSummary('Current', 'current'),
      documentSummary('Pending', 'pending'),
      documentSummary('Other', 'other'),
    ]));

    render(<DocumentsMenu />);

    const current = (await screen.findByText('Current')).closest('button');
    const pending = screen.getByText('Pending').closest('button');
    expect(current?.getAttribute('aria-current')).toBe('true');
    expect(pending?.getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('Opening…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New document' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Delete Current' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(pending!);
    expect(mocks.switchTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Other').closest('button')!);
    expect(mocks.switchTo).toHaveBeenCalledWith('other');
  });

  it('dismisses a mobile drawer callback only after the requested document commits', async () => {
    const onDocumentCommitted = vi.fn();
    render(<DocumentsMenu onDocumentCommitted={onDocumentCommitted} />);
    const row = (await screen.findByText('Research notes')).closest('button');

    fireEvent.click(row!);
    await waitFor(() => expect(onDocumentCommitted).toHaveBeenCalledTimes(1));

    mocks.switchTo.mockRejectedValueOnce(new Error('No access'));
    fireEvent.click(row!);
    await waitFor(() => expect(mocks.switchTo).toHaveBeenCalledTimes(2));
    expect(onDocumentCommitted).toHaveBeenCalledTimes(1);
  });
});
