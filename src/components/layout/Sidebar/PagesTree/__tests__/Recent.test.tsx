import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { FIXTURE_DOCUMENT_ID } from '@/dev/msw/fixtures';

const mocks = vi.hoisted(() => ({
  switchTo: vi.fn(),
  documentId: null as string | null,
}));

vi.mock('@/editor', () => ({
  useDocumentActions: () => ({ switchTo: mocks.switchTo }),
  useDocumentSession: () => ({ documentId: mocks.documentId, loadingDocumentId: null }),
  useDocumentStatus: () => ({ lastSavedAt: null }),
  useEditorDoc: () => ({ doc: { name: 'Sparse Routing for Long-Context Pretraining', blocks: [] } }),
}));

const { Recent } = await import('../Recent');

beforeEach(() => {
  localStorage.clear();
  mocks.switchTo.mockReset().mockResolvedValue(true);
  mocks.documentId = FIXTURE_DOCUMENT_ID;
});

afterEach(cleanup);

describe('Recent', () => {
  it('lists the five pages edited last, wherever they live, and marks the open one', async () => {
    render(<Recent />);

    const list = await screen.findByRole('list');
    await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(5));
    const names = within(list).getAllByRole('button').map((button) => button.textContent);
    expect(names[0]).toBe('Sparse Routing for Long-Context Pretraining');
    expect(within(list).getAllByRole('button')[0]?.getAttribute('aria-current')).toBe('page');

    fireEvent.click(within(list).getByRole('button', { name: /Rebuttal notes/ }));
    expect(mocks.switchTo).toHaveBeenCalledWith('66f0c0ffee0000000000d0c3');
  });

  it('folds away and remembers that for the workspace', async () => {
    render(<Recent />);
    const toggle = await screen.findByRole('button', { name: 'Recent' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle);
    expect(screen.queryByRole('list')).toBeNull();
    expect(localStorage.getItem(`colwrite:ws:${TEST_WORKSPACE_ID}:recent:collapsed`)).toBe('true');

    cleanup();
    render(<Recent />);
    expect(screen.getByRole('button', { name: 'Recent' }).getAttribute('aria-expanded')).toBe('false');
  });
});
