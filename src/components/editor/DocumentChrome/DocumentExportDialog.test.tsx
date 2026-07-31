import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getExportSnapshot: vi.fn(),
  renderStandaloneHtml: vi.fn(),
  printStandaloneHtml: vi.fn(),
  downloadBlob: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/editor', () => ({
  useEditor: () => ({ getExportSnapshot: mocks.getExportSnapshot }),
}));

vi.mock('@/export/renderStandaloneHtml', () => ({
  renderStandaloneHtml: mocks.renderStandaloneHtml,
}));

vi.mock('@/export/print', () => ({
  printStandaloneHtml: mocks.printStandaloneHtml,
}));

vi.mock('@/export/download', () => ({
  downloadBlob: mocks.downloadBlob,
  exportFilename: (name: string | undefined, extension: string) => `${name ?? 'Untitled document'}.${extension}`,
}));

vi.mock('@/components/ui/toastContext', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { DocumentExportDialog } from './DocumentExportDialog';

const documentSnapshot = {
  document: { version: 4, name: 'Current draft', blocks: [] },
  baseVersion: 4,
  localRevision: 12,
  dirty: true,
};

beforeEach(() => {
  mocks.getExportSnapshot.mockReset().mockReturnValue(documentSnapshot);
  mocks.renderStandaloneHtml.mockReset().mockReturnValue('<!doctype html><title>Current draft</title>');
  mocks.printStandaloneHtml.mockReset().mockResolvedValue(undefined);
  mocks.downloadBlob.mockReset();
  mocks.toast.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('DocumentExportDialog', () => {
  it('renders once in the browser and opens print preview without calling the API', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const onOpenChange = vi.fn();
    render(<DocumentExportDialog open onOpenChange={onOpenChange} />);

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
      },
      { base_version: 4, local_revision: 12, dirty: true },
    );
    expect(mocks.printStandaloneHtml).toHaveBeenCalledWith(
      '<!doctype html><title>Current draft</title>',
    );
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Print dialog opened',
      variant: 'success',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('downloads standalone HTML locally and never opens print preview', async () => {
    const onOpenChange = vi.fn();
    render(<DocumentExportDialog open onOpenChange={onOpenChange} />);
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

  it('reports renderer failures without printing or downloading', async () => {
    mocks.renderStandaloneHtml.mockImplementation(() => {
      throw new Error('Invalid document');
    });
    render(<DocumentExportDialog open onOpenChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Print / Save PDF' }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Export failed',
      description: 'Invalid document',
      variant: 'error',
    }));
    expect(mocks.printStandaloneHtml).not.toHaveBeenCalled();
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });
});
