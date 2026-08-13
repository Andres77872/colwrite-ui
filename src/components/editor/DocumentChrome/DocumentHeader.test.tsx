import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  toast: vi.fn(),
  editor: {
    doc: {
      version: 1,
      name: 'A document title that should keep useful room on a phone',
      blocks: [],
    },
    setDocName: vi.fn(),
    saveRemote: vi.fn(),
    deleteRemote: vi.fn(),
    newLocal: vi.fn(),
    documentId: 'doc-1' as string | null,
    lastSavedAt: null as number | null,
    isAutoSaving: false,
    lastSaveSource: null as 'auto' | 'manual' | null,
    saveError: null as string | null,
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
    hasPendingEdits: vi.fn(),
  },
}));

vi.mock('@/editor', () => ({
  useEditor: () => mocks.editor,
}));

vi.mock('@/components/ui/confirmContext', () => ({
  useConfirm: () => mocks.confirm,
}));

vi.mock('@/components/ui/toastContext', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('./DocumentExportDialog', () => ({
  DocumentExportDialog: () => null,
}));

import { DocumentHeader } from './DocumentHeader';

beforeEach(() => {
  mocks.confirm.mockReset().mockResolvedValue(false);
  mocks.toast.mockReset();
  mocks.editor.setDocName.mockReset();
  mocks.editor.saveRemote.mockReset().mockResolvedValue(undefined);
  mocks.editor.deleteRemote.mockReset().mockResolvedValue(undefined);
  mocks.editor.newLocal.mockReset();
  mocks.editor.documentId = 'doc-1';
  mocks.editor.lastSavedAt = null;
  mocks.editor.isAutoSaving = false;
  mocks.editor.lastSaveSource = null;
  mocks.editor.saveError = null;
  mocks.editor.canUndo = false;
  mocks.editor.canRedo = false;
  mocks.editor.undo.mockReset();
  mocks.editor.redo.mockReset();
  mocks.editor.hasPendingEdits.mockReset().mockReturnValue(false);
});

afterEach(() => {
  cleanup();
});

describe('DocumentHeader', () => {
  it('wraps title and compact save context before actions can squeeze them', () => {
    render(<DocumentHeader />);

    const title = screen.getByRole('button', { name: /A document title/ });
    const titleRow = title.parentElement;
    const header = titleRow?.parentElement;
    expect(header?.className).toContain('flex-wrap');
    expect(titleRow?.className).toContain('min-w-64');
    expect(title.className).toContain('flex-1');

    const compactStatus = screen.getAllByText('Synced').find(
      element => element.className.includes('sm:hidden'),
    )!;
    expect(compactStatus.className).toContain('sm:hidden');

    const save = screen.getByRole('button', { name: 'Save document' });
    expect(save.className).toContain('h-10');
    expect(save.className).toContain('w-10');
  });

  it('exposes touch controls for undo and redo with accurate disabled states', () => {
    const { rerender } = render(<DocumentHeader />);

    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);

    mocks.editor.canUndo = true;
    mocks.editor.canRedo = true;
    rerender(<DocumentHeader />);

    expect(undo.disabled).toBe(false);
    expect(redo.disabled).toBe(false);
    fireEvent.click(undo);
    fireEvent.click(redo);
    expect(mocks.editor.undo).toHaveBeenCalledTimes(1);
    expect(mocks.editor.redo).toHaveBeenCalledTimes(1);
  });

  it('starts a new document immediately when no local edits are pending', () => {
    render(<DocumentHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'New document' }));

    expect(mocks.editor.hasPendingEdits).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.editor.newLocal).toHaveBeenCalledTimes(1);
  });

  it('confirms before discarding pending local edits', async () => {
    mocks.editor.hasPendingEdits.mockReturnValue(true);
    mocks.confirm.mockResolvedValueOnce(true);
    render(<DocumentHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'New document' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith({
      title: 'Start a new document?',
      description: 'Unsaved changes to the current document will be lost.',
      confirmLabel: 'Start new',
    }));
    expect(mocks.editor.newLocal).toHaveBeenCalledTimes(1);
  });
});
