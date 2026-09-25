import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastProvider } from '@/components/ui/toast';

const state = vi.hoisted(() => ({
  semanticScholar: false,
  s2Search: vi.fn(),
}));

vi.mock('@/components/preferences', () => ({
  useAgentTools: () => ({
    isSourceEnabled: (sourceId: string) => sourceId === 'arxiv' || state.semanticScholar,
  }),
}));

vi.mock('@/services/semanticScholar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/semanticScholar')>()),
  searchSemanticScholar: state.s2Search,
}));

vi.mock('@/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/editor')>()),
  useEditor: () => ({ documentId: null }),
  useEditorState: () => ({ doc: { sources: [] } }),
}));

// The other tabs have their own tests; here they only need to exist.
vi.mock('@/components/editor/ChatAssistant', () => ({ ChatAssistant: () => <p>Assistant body</p> }));
vi.mock('./SourcesPanel', () => ({ SourcesPanel: () => <p>Sources body</p> }));
vi.mock('./HistoryPanel', () => ({ HistoryPanel: () => <p>History body</p> }));
vi.mock('./JsonPanel', () => ({ JsonPanel: () => <p>JSON body</p> }));

const { PanelsProvider } = await import('./panelsContext');
const { ToolsAside } = await import('./toolsAside/ToolsAside');

function renderSidebar() {
  return render(
    <ToastProvider>
      <TooltipProvider>
        <PanelsProvider>
          <ToolsAside />
        </PanelsProvider>
      </TooltipProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  state.semanticScholar = false;
  state.s2Search.mockReset();
});

afterEach(cleanup);

describe('right sidebar', () => {
  it('always shows a tab, starting on the assistant', () => {
    renderSidebar();

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['AI', 'Research', 'Sources', 'History']);
    expect(screen.getByRole('tab', { name: 'AI' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Assistant body')).toBeTruthy();
    expect(screen.queryByText(/No tool selected/)).toBeNull();
    // Not "Close sidebar": that is the left sidebar's button.
    expect(screen.getByRole('button', { name: 'Close right sidebar' })).toBeTruthy();
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
  it('does not offer Semantic Scholar in Research before opt-in', () => {
    localStorage.setItem('panels.activeTool', JSON.stringify('research'));
    renderSidebar();

    const s2 = screen.getByRole('radio', { name: 'Semantic Scholar' }) as HTMLButtonElement;
    expect(s2.disabled).toBe(true);
    expect(s2.getAttribute('aria-describedby')).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'arXiv' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not open or query a persisted Semantic Scholar panel while disabled', () => {
    // What the old rail saved when Semantic Scholar was last open.
    localStorage.setItem('panels.activeTool', JSON.stringify('semantic-scholar'));
    renderSidebar();

    expect(screen.getByRole('radio', { name: 'arXiv' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('link', { name: 'Provider attribution' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search arXiv papers…'), { target: { value: 'routing' } });
    expect(state.s2Search).not.toHaveBeenCalled();
  });

  it('opens Semantic Scholar once the account enables it', () => {
    state.semanticScholar = true;
    localStorage.setItem('panels.activeTool', JSON.stringify('semantic-scholar'));
    renderSidebar();

    expect(screen.getByRole('radio', { name: 'Semantic Scholar' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('link', { name: 'Provider attribution' })).toBeTruthy();
  });
});
