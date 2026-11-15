import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { http, server } from '@/__tests__/server';

const mocks = vi.hoisted(() => ({
  arxiv: vi.fn(),
  colpali: vi.fn(),
  /** Any request for the account's PDFs: a list or a search, by its query. */
  resources: vi.fn(),
}));

vi.mock('@/data/arxiv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/arxiv')>()),
  searchArxiv: mocks.arxiv,
}));
vi.mock('@/data/colpali', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/colpali')>()),
  searchColpaliArxiv: mocks.colpali,
}));
vi.mock('@/components/preferences', () => ({
  useAgentTools: () => ({ isSourceEnabled: () => true, switchedOffBy: () => null }),
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
  mocks.resources.mockReset();
  const queryOf = (request: Request) => Object.fromEntries(new URL(request.url).searchParams);
  server.use(
    http.get('/workspaces/{workspace_id}/resources', ({ request, response }) => {
      mocks.resources(queryOf(request));
      return response(200).json({ items: [], next_cursor: null });
    }),
    http.get('/workspaces/{workspace_id}/resources/search', ({ request, query, response }) => {
      mocks.resources(queryOf(request));
      return response(200).json({
        query: query.get('query') ?? '', scope: 'library', items: [], next_cursor: null,
        resources_searched: 0, resources_skipped: [], truncated: false,
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ResearchPanel', () => {
  it('keeps each source’s results while another source is searched', async () => {
    renderPanel();
    search('Search arXiv papers…', 'sparse experts');
    await screen.findByText('Switch Transformers');
    expect(mocks.arxiv).toHaveBeenCalledWith({ query: 'sparse experts', limit: 20, lite_search: true });

    fireEvent.click(screen.getByRole('radio', { name: 'Paper pages' }));
    // One query box: what was typed carries over to the next source.
    expect((screen.getByPlaceholderText('Find paper pages that answer a question…') as HTMLInputElement).value).toBe(
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
    for (const name of ['arXiv', 'Semantic Scholar', 'Paper pages', 'Inside my PDFs']) {
      expect(screen.getByRole('radio', { name })).toBeTruthy();
    }
    expect(screen.getByRole('radio', { name: 'Find papers' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Check a claim' }));
    expect(screen.getByRole('textbox', { name: 'Claim to check' })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Inside my PDFs' }));
    expect(screen.queryByRole('radiogroup', { name: 'Semantic Scholar mode' })).toBeNull();
    // Nothing to filter in a PDF search, but the button's slot is kept.
    expect(screen.queryByRole('button', { name: 'Search filters' })).toBeNull();
  });

  it('hands “Search inside my PDFs” to the Library instead of searching here', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Inside my PDFs' }));
    expect(screen.getByRole('button', { name: 'Open Library' })).toBeTruthy();
    search('Search inside my PDFs…', ' router ');

    // One PDF search, in the Library: Research neither queries nor lists PDFs.
    expect(mocks.resources).not.toHaveBeenCalled();
    expect(handle.current!.activeTool).toBe('library');
    expect(handle.current!.intent).toMatchObject({ tab: 'library', query: 'router' });
  });

  it('opens the Library from the PDF source', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Inside my PDFs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Library' }));
    expect(handle.current!.activeTool).toBe('library');
    expect(handle.current!.isOpen).toBe(true);
  });
});
