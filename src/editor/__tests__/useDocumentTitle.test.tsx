import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const editor = vi.hoisted(() => ({
  doc: { version: 1, name: 'Untitled document', blocks: [] } as { version: number; name?: string; blocks: [] },
  setDocName: vi.fn(),
  saveRemote: vi.fn(async () => {}),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('../editorContextState', () => ({ useEditor: () => editor }));
vi.mock('@/components/ui/toastContext', () => ({ useToast: () => ({ toast }) }));

const { useDocumentTitle, focusPageTitle } = await import('../useDocumentTitle');

beforeEach(() => {
  vi.clearAllMocks();
  editor.doc = { version: 1, name: 'Untitled document', blocks: [] };
});
afterEach(cleanup);

describe('useDocumentTitle', () => {
  it('treats the default name as no name, so the page shows its placeholder', () => {
    const { result } = renderHook(() => useDocumentTitle());
    expect(result.current.title).toBe('Untitled document');
    expect(result.current.draftTitle).toBe('');
    expect(result.current.isUntitled).toBe(true);
  });

  it('renames and saves with the new name', async () => {
    const { result } = renderHook(() => useDocumentTitle());
    await act(() => result.current.rename('  Sparse   routing '));

    expect(editor.setDocName).toHaveBeenCalledWith('Sparse routing');
    expect(editor.saveRemote).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sparse routing' }));
  });

  it('does nothing when the name is unchanged or blank on an untitled page', async () => {
    editor.doc = { version: 1, name: 'Paper', blocks: [] };
    const { result } = renderHook(() => useDocumentTitle());
    await act(() => result.current.rename('Paper'));
    expect(editor.saveRemote).not.toHaveBeenCalled();

    editor.doc = { version: 1, name: 'Untitled document', blocks: [] };
    const untitled = renderHook(() => useDocumentTitle());
    await act(() => untitled.result.current.rename('   '));
    expect(editor.saveRemote).not.toHaveBeenCalled();
  });

  it('keeps the local rename and says so when the save fails', async () => {
    editor.saveRemote.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useDocumentTitle());
    await act(() => result.current.rename('Draft'));

    expect(editor.setDocName).toHaveBeenCalledWith('Draft');
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Renamed locally, but the save failed', description: 'offline' }),
    );
  });
});

describe('focusPageTitle', () => {
  it('moves focus into the mounted page title', () => {
    const field = document.createElement('span');
    field.setAttribute('data-page-title', '');
    field.tabIndex = 0;
    field.textContent = 'Paper';
    field.scrollIntoView = vi.fn();
    document.body.append(field);

    expect(focusPageTitle()).toBe(true);
    expect(document.activeElement).toBe(field);
    field.remove();
    expect(focusPageTitle()).toBe(false);
  });
});
