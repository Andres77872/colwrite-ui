import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { ToastProvider } from '@/components/ui/toast';
import { agentSource } from '@/__tests__/agentSource';

vi.mock('@/data/documents', async () => ({
  ...(await vi.importActual<typeof import('@/data/documents')>('@/data/documents')),
  createDocument: vi.fn(),
  saveDocument: vi.fn(async () => ({ etag: 'cw:2', updatedAt: null })),
  getDocument: vi.fn(),
}));

const { EditorProvider } = await import('@/editor');
const { SourceHoverCard } = await import('../AnswerSources');

const SOURCE = agentSource('S1', { key: 'doi:10.1000/a', title: 'Paper A', authors: 'Ada Lovelace', year: 2020, provider: 'crossref', doi: '10.1000/a' });

function mount() {
  return render(
    <ToastProvider>
      <EditorProvider>
        <p>
          A claim
          <SourceHoverCard source={SOURCE} number={1}>
            <button type="button" aria-label="Source 1: Paper A">1</button>
          </SourceHoverCard>
        </p>
      </EditorProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockDocumentList();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a source marker’s card from the keyboard (U-18)', () => {
  it('opens on Enter with its actions in the tab order, and Escape returns to the marker', async () => {
    mount();
    const marker = screen.getByRole('button', { name: 'Source 1: Paper A' });
    act(() => marker.focus());
    fireEvent.keyDown(marker, { key: 'Enter' });

    const card = await screen.findByRole('dialog', { name: 'Source 1: Paper A' });
    await waitFor(() => expect(card.contains(document.activeElement)).toBe(true));
    expect(screen.getByRole('button', { name: 'Cite' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add to sources' })).toBeTruthy();

    fireEvent.keyDown(document.activeElement ?? card, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Source 1: Paper A' })).toBeNull());
    expect(document.activeElement).toBe(marker);
  });
});
