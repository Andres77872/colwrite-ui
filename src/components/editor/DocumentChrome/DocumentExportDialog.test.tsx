import { itemAt } from '@/lib/itemAt';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getExportSnapshot: vi.fn(),
  saveRemote: vi.fn(),
  ensureRemoteDocument: vi.fn(),
  documentId: 'doc-1' as string | null,
  renderStandaloneHtml: vi.fn(),
  printStandaloneHtml: vi.fn(),
  downloadBlob: vi.fn(),
  documentToMarkdown: vi.fn(),
  exportDocumentLatex: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/editor', () => ({
  useEditorActions: () => ({ getExportSnapshot: mocks.getExportSnapshot }),
  useDocumentId: () => mocks.documentId,
  useDocumentActions: () => ({
    saveRemote: mocks.saveRemote,
    ensureRemoteDocument: mocks.ensureRemoteDocument,
  }),
}));

vi.mock('@/export/markdown', () => ({
  documentToMarkdown: mocks.documentToMarkdown,
}));

vi.mock('@/data/documentExport', async () => {
  const actual = await vi.importActual<typeof import('@/data/documentExport')>('@/data/documentExport');
  return { ...actual, exportDocumentLatex: mocks.exportDocumentLatex };
});

vi.mock('@/export/renderStandaloneHtml', () => ({
  renderStandaloneHtml: mocks.renderStandaloneHtml,
}));

vi.mock('@/export/print', () => ({
  printStandaloneHtml: mocks.printStandaloneHtml,
}));

vi.mock('@/export/download', () => ({
  downloadBlob: mocks.downloadBlob,
  exportFilename: (name: string | undefined, extension: string) => `${name ?? 'Untitled page'}.${extension}`,
}));

vi.mock('@/components/ui/toastContext', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { recordRequests } from '@/__tests__/server';
import { DocumentExportDialog } from './DocumentExportDialog';
import { ApiError } from '@/api/errors';
import { renderInWorkspace } from '@/__tests__/renderInWorkspace';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

const documentSnapshot = {
  document: { name: 'Current draft', blocks: [] },
  localRevision: 12,
  dirty: true,
};

beforeEach(() => {
  mocks.getExportSnapshot.mockReset().mockReturnValue(documentSnapshot);
  mocks.renderStandaloneHtml.mockReset().mockReturnValue('<!doctype html><title>Current draft</title>');
  mocks.printStandaloneHtml.mockReset().mockResolvedValue(undefined);
  mocks.downloadBlob.mockReset();
  mocks.toast.mockReset();
  mocks.documentId = 'doc-1';
  mocks.saveRemote.mockReset().mockResolvedValue(undefined);
  mocks.ensureRemoteDocument.mockReset().mockResolvedValue('doc-1');
  mocks.documentToMarkdown.mockReset().mockReturnValue('# Current draft\n');
  mocks.exportDocumentLatex
    .mockReset()
    .mockResolvedValue({ source: '\\documentclass{article}', filename: 'Current draft.tex' });
});

afterEach(() => {
  cleanup();
});

describe('DocumentExportDialog', () => {
  it('renders once in the browser and opens print preview without calling the API', async () => {
    const sent = recordRequests();
    const onOpenChange = vi.fn();
    renderInWorkspace(<DocumentExportDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Print / Save PDF' }));

    await waitFor(() => expect(mocks.printStandaloneHtml).toHaveBeenCalledOnce());
    expect(mocks.renderStandaloneHtml).toHaveBeenCalledOnce();
    expect(mocks.renderStandaloneHtml).toHaveBeenCalledWith(
      documentSnapshot.document,
      {
        profile: 'paper',
        page_size: 'A4',
        orientation: 'portrait',
        include_title: false,
        ai_beat: 'omit',
        include_references: true,
      },
      { local_revision: 12, dirty: true },
      new Map(),
    );
    expect(mocks.printStandaloneHtml).toHaveBeenCalledWith(
      '<!doctype html><title>Current draft</title>',
    );
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Print dialog opened',
      variant: 'success',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('downloads standalone HTML locally and never opens print preview', async () => {
    const onOpenChange = vi.fn();
    renderInWorkspace(<DocumentExportDialog open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'html' } });

    fireEvent.click(screen.getByRole('button', { name: 'Export HTML' }));

    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledOnce());
    expect(mocks.renderStandaloneHtml).toHaveBeenCalledOnce();
    expect(mocks.printStandaloneHtml).not.toHaveBeenCalled();
    const [blob, filename] = mocks.downloadBlob.mock.calls[0] as [Blob, string];
    expect(blob.type).toBe('text/html;charset=utf-8');
    expect(filename).toBe('Current draft.html');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reports renderer failures inline, with a retry, without printing or downloading', async () => {
    mocks.renderStandaloneHtml.mockImplementationOnce(() => {
      throw new Error('Invalid document');
    });
    const onOpenChange = vi.fn();
    renderInWorkspace(<DocumentExportDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Print / Save PDF' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Invalid document');
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.printStandaloneHtml).not.toHaveBeenCalled();
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.printStandaloneHtml).toHaveBeenCalledOnce());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('downloads the whole document as Markdown, built in the browser', async () => {
    const sent = recordRequests();
    const onOpenChange = vi.fn();
    renderInWorkspace(<DocumentExportDialog open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'markdown' } });
    expect(screen.getByText(/Pandoc keys/)).toBeTruthy();
    // Page layout does not apply to a text file.
    expect(screen.queryByLabelText('Page size')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }));

    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledOnce());
    expect(mocks.documentToMarkdown).toHaveBeenCalledWith(documentSnapshot.document, {
      includeTitle: false,
      includeReferences: true,
      aiBeat: 'omit',
    });
    const [blob, filename] = mocks.downloadBlob.mock.calls[0] as [Blob, string];
    expect(blob.type).toBe('text/markdown;charset=utf-8');
    expect(filename).toBe('Current draft.md');
    expect(mocks.renderStandaloneHtml).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('saves pending edits, then downloads the server’s LaTeX under its file name', async () => {
    const onOpenChange = vi.fn();
    renderInWorkspace(<DocumentExportDialog open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'latex' } });
    expect(screen.getByText(/Copy TikZ/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Export LaTeX' }));

    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledOnce());
    // The snapshot is dirty: the server must have it before it renders it.
    expect(mocks.saveRemote).toHaveBeenCalledOnce();
    expect(mocks.saveRemote.mock.invocationCallOrder[0]).toBeLessThan(
      itemAt(mocks.exportDocumentLatex.mock.invocationCallOrder, 0),
    );
    expect(mocks.exportDocumentLatex).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'doc-1');
    const [blob, filename] = mocks.downloadBlob.mock.calls[0] as [Blob, string];
    expect(blob.type).toBe('application/x-tex;charset=utf-8');
    expect(await blob.text()).toBe('\\documentclass{article}');
    expect(filename).toBe('Current draft.tex');
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'LaTeX exported', variant: 'success' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('explains a LaTeX rejection inline and retries on request', async () => {
    mocks.getExportSnapshot.mockReturnValue({ ...documentSnapshot, dirty: false });
    mocks.exportDocumentLatex.mockRejectedValueOnce(
      new ApiError('Document could not be exported', 422, { code: 'export_failed', detail: 'Document could not be exported', retryable: false }),
    );
    const onOpenChange = vi.fn();
    renderInWorkspace(<DocumentExportDialog open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'latex' } });

    fireEvent.click(screen.getByRole('button', { name: 'Export LaTeX' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Inline code, strikethrough');
    expect(mocks.saveRemote).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not export an older copy when the save before a LaTeX export fails', async () => {
    mocks.saveRemote.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderInWorkspace(<DocumentExportDialog open onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'latex' } });

    fireEvent.click(screen.getByRole('button', { name: 'Export LaTeX' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be saved');
    expect(alert.textContent).not.toContain('Failed to fetch');
    expect(mocks.exportDocumentLatex).not.toHaveBeenCalled();
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });
});
