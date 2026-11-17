import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { panelKey } from '@/lib/storageKeys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastProvider } from '@/components/ui/toast';
import { fixtures } from '@/dev/msw/fixtures';
import { pathOf, recordRequests } from '@/__tests__/server';

vi.mock('@/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/editor')>()),
  useDocumentId: () => null,
  useEditorDoc: () => ({ doc: { sources: [] }, blocks: [] }),
}));

// The other tabs have their own tests; here they only need to exist.
vi.mock('@/components/editor/ChatAssistant', () => ({ ChatAssistant: () => <p>Assistant body</p> }));
vi.mock('./Library', () => ({ LibraryPanel: () => <p>Library body</p> }));
vi.mock('./SourcesPanel', () => ({ SourcesPanel: () => <p>Sources body</p> }));
vi.mock('./HistoryPanel', () => ({ HistoryPanel: () => <p>History body</p> }));
vi.mock('./JsonPanel', () => ({ JsonPanel: () => <p>JSON body</p> }));

const { PanelsProvider } = await import('./panelsContext');
const { PanelsAside } = await import('./panelsAside/PanelsAside');

function renderSidebar() {
  return render(
    <ToastProvider>
      <TooltipProvider>
        <PanelsProvider>
          <PanelsAside />
        </PanelsProvider>
      </TooltipProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  // The account turned Papers off: the catalog says paper search is off.
  fixtures.assistant = { switches: { papers: false }, sources: {} };
});

afterEach(cleanup);

describe('right sidebar', () => {
  it('always shows a tab, starting on the assistant', () => {
    renderSidebar();

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['AI', 'Research', 'Review', 'Library', 'Sources', 'History']);
    expect(screen.getByRole('tab', { name: 'AI' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Assistant body')).toBeTruthy();
    expect(screen.queryByText(/No tool selected/)).toBeNull();
    // Not "Close sidebar": that is the left sidebar's button.
    expect(screen.getByRole('button', { name: 'Close right sidebar' })).toBeTruthy();
  });

  it('opens the Library straight onto its own tab', () => {
    localStorage.setItem(panelKey('tab'), JSON.stringify('library'));
    renderSidebar();

    expect(screen.getByRole('tab', { name: 'Library' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Library body')).toBeTruthy();
  });

  it('keeps a visited tab mounted, hidden, while another shows', () => {
    renderSidebar();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Sources' }));
    expect(screen.getByText('Sources body')).toBeTruthy();
    expect(screen.getByText('Assistant body').closest('[role="tabpanel"]')?.getAttribute('data-state')).toBe(
      'inactive',
    );
    // Never visited, never mounted: History fetches revisions on mount.
    expect(screen.queryByText('History body')).toBeNull();
  });
});

describe('workspace paper-source enforcement', () => {
  it('does not offer paper search in Research where Papers is off', () => {
    localStorage.setItem(panelKey('tab'), JSON.stringify('research'));
    renderSidebar();

    const papers = screen.getByRole('radio', { name: 'Papers' }) as HTMLButtonElement;
    expect(papers.disabled).toBe(true);
    // Why, in the catalog's words.
    expect(document.getElementById(papers.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Papers: Papers is switched off in your settings.');
    expect((screen.getByRole('radio', { name: 'Inside my PDFs' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not open or query a persisted paper search while it is off', () => {
    localStorage.setItem(panelKey('tab'), JSON.stringify('research'));
    localStorage.setItem(panelKey('researchSource'), JSON.stringify('papers'));
    const sent = recordRequests();
    renderSidebar();

    expect(screen.getByRole('radio', { name: 'Inside my PDFs' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.change(screen.getByPlaceholderText('Search inside my PDFs…'), { target: { value: 'routing' } });
    expect(sent.some((request) => pathOf(request).includes('/papers/'))).toBe(false);
  });

  it('opens paper search once the account turns Papers on', async () => {
    fixtures.assistant = { switches: {}, sources: {} };
    localStorage.setItem(panelKey('tab'), JSON.stringify('research'));
    localStorage.setItem(panelKey('researchSource'), JSON.stringify('papers'));
    renderSidebar();

    expect((await screen.findByRole('radio', { name: 'Papers' })).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByPlaceholderText('Search papers…')).toBeTruthy();
  });
});
