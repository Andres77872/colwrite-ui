import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({
  arxiv: vi.fn(),
  colpali: vi.fn(),
  resources: vi.fn(),
  getResource: vi.fn(),
}));

vi.mock('@/services/arxiv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/arxiv')>()),
  searchArxiv: mocks.arxiv,
}));
vi.mock('@/services/colpali', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/colpali')>()),
  searchColpaliArxiv: mocks.colpali,
}));
vi.mock('@/services/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/resources')>()),
  searchResources: mocks.resources,
  listResources: vi.fn().mockResolvedValue({ resources: [], count: 0 }),
}));
// The file manager is covered by its own tests; here it only has to open,
// and hand back through the way out it draws in its own header.
vi.mock('../LibraryPanel/LibraryPanel', () => ({
  LibraryPanel: ({
    initialResource,
    onExit,
  }: {
    initialResource: { resourceId: number } | null;
    onExit: () => void;
  }) => (
    <>
      <button type="button" onClick={onExit}>
        Back to search
      </button>
      <p>File manager{initialResource ? ` on ${initialResource.resourceId}` : ''}</p>
    </>
  ),
}));
vi.mock('@/components/preferences', () => ({
  useAgentTools: () => ({ isSourceEnabled: () => true }),
}));
vi.mock('@/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/editor')>()),
  useEditor: () => ({ documentId: null }),
}));

import { PanelsProvider } from '../panelsContext';
import { usePanels, type PanelsContextValue } from '../panelsContextState';
import { ResearchPanel } from './ResearchPanel';

const handle: { current: PanelsContextValue | null } = { current: null };

function Handle() {
  const panels = usePanels();
  useEffect(() => {
    handle.current = panels;
  });
  return null;
}

function renderPanel() {
  return render(
    <ToastProvider>
      <TooltipProvider>
        <PanelsProvider>
          <Handle />
          <ResearchPanel />
        </PanelsProvider>
      </TooltipProvider>
    </ToastProvider>,
  );
}

function search(placeholder: string, query: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

beforeEach(() => {
  localStorage.clear();
  mocks.arxiv.mockReset().mockResolvedValue([
    { id: '2101.03961', title: 'Switch Transformers', authors: 'William Fedus', date: '2021-01-11', score: 0.9 },
  ]);
  mocks.colpali.mockReset().mockResolvedValue([
    {
      page: 3, id: '2202.08906', doi: null, date: '2022-02-17', title: 'ST-MoE', authors: 'Barret Zoph',
      abstract: null, url: 'https://arxiv.org/abs/2202.08906', version: 'v2', page_image: null,
    },
  ]);
  mocks.resources.mockReset().mockResolvedValue({
    query: 'router', scope: 'library', resources_searched: 1, resources_skipped: [], truncated: false,
    next_offset: null, match_count: 1,
    matches: [{ resource_id: 41, filename: 'moe.pdf', title: 'MoE notes', offset: 120, excerpt: 'the router picks' }],
  });
});

afterEach(cleanup);

describe('ResearchPanel', () => {
  it('keeps each source’s results while another source is searched', async () => {
    renderPanel();
    search('Search arXiv papers…', 'sparse experts');
    await screen.findByText('Switch Transformers');
    expect(mocks.arxiv).toHaveBeenCalledWith({ query: 'sparse experts', limit: 20, lite_search: true });

    fireEvent.click(screen.getByRole('radio', { name: 'Pages' }));
    // One query box: what was typed carries over to the next source.
    expect((screen.getByPlaceholderText('Find pages that answer a question…') as HTMLInputElement).value).toBe(
      'sparse experts',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('ST-MoE');
    expect(screen.getByText(/2022 · v2/)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'arXiv' }));
    expect(screen.getByText('Switch Transformers')).toBeTruthy();
    expect(mocks.arxiv).toHaveBeenCalledTimes(1);
  });

  it('runs a query handed over from elsewhere on the current source', async () => {
    renderPanel();

    act(() => handle.current!.openSidebar('research', { tab: 'research', query: 'load balancing' }));

    await screen.findByText('Switch Transformers');
    expect((screen.getByPlaceholderText('Search arXiv papers…') as HTMLInputElement).value).toBe('load balancing');
    expect(mocks.arxiv).toHaveBeenCalledWith({ query: 'load balancing', limit: 20, lite_search: true });
  });

  it('sends the result limit chosen under Filters', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Search filters' }));
    fireEvent.change(screen.getByLabelText('Number of results to return'), { target: { value: '40' } });
    search('Search arXiv papers…', 'routing');

    await screen.findByText('Switch Transformers');
    expect(mocks.arxiv).toHaveBeenCalledWith({ query: 'routing', limit: 40, lite_search: true });
  });

  it('offers Semantic Scholar’s modes in their own row, without relabelling the sources', async () => {
    renderPanel();
    expect(screen.queryByRole('radiogroup', { name: 'Semantic Scholar mode' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Semantic Scholar' }));
    // Every source keeps its name; the modes are spelled out, not icons.
    for (const name of ['arXiv', 'Semantic Scholar', 'Pages', 'My PDFs']) {
      expect(screen.getByRole('radio', { name })).toBeTruthy();
    }
    expect(screen.getByRole('radio', { name: 'Find papers' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Check a claim' }));
    expect(screen.getByRole('textbox', { name: 'Claim to check' })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'My PDFs' }));
    expect(screen.queryByRole('radiogroup', { name: 'Semantic Scholar mode' })).toBeNull();
    // Nothing to filter in My PDFs, but the button's slot is kept.
    expect(screen.queryByRole('button', { name: 'Search filters' })).toBeNull();
  });

  it('searches inside My PDFs and opens a match in the file manager', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'My PDFs' }));
    search('Search inside your PDFs…', 'router');

    fireEvent.click(await screen.findByText('MoE notes'));
    expect(mocks.resources).toHaveBeenCalledWith({ query: 'router', scope: 'library' });
    expect(screen.getByText('File manager on 41')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to search' }));
    // The search is still there to go back to.
    expect(screen.getByText('MoE notes')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Manage files' }));
    expect(screen.getByText('File manager')).toBeTruthy();
  });
});
