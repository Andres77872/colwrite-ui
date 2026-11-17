import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { http, queryOf, recordRequests, server } from '@/__tests__/server';
import { fixtures } from '@/dev/msw/fixtures';
import { FEDUS, ZOPH } from '@/dev/fixtureReferences';

const mocks = vi.hoisted(() => ({
  /** Any request for the account's PDFs: a list or a search, by its query. */
  resources: vi.fn(),
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

/** The query of each paper search sent, in order. */
function paperSearches(requests: Request[]): Record<string, string>[] {
  return requests
    .filter((request) => new URL(request.url).pathname.endsWith('/papers/search'))
    .map(queryOf);
}

function search(placeholder: string, query: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

beforeEach(() => {
  localStorage.clear();
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

const SWITCH = /^Switch Transformers: Scaling/;

describe('ResearchPanel', () => {
  it('searches papers through the API’s paper route, and keeps its results while PDFs are picked', async () => {
    const requests = recordRequests();
    renderPanel();
    search('Search papers…', 'routing experts');
    await screen.findByText(SWITCH);
    expect(paperSearches(requests)).toEqual([expect.objectContaining({ query: 'routing experts', limit: '20' })]);
    // One row per work, read from its record, with who found it.
    const row = screen.getByText(SWITCH).closest('article');
    expect(row?.textContent).toContain('William Fedus, Barret Zoph, Noam Shazeer');
    expect(row?.textContent).toContain('2022 · Journal of Machine Learning Research');
    expect(row?.textContent).toContain('Found by OpenAlex, Semantic Scholar');
    // A source whose data is shown is credited as it asks.
    expect(screen.getByText('Data from Semantic Scholar (semanticscholar.org).')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Inside my PDFs' }));
    // One query box: what was typed carries over to the next source.
    expect((screen.getByPlaceholderText('Search inside my PDFs…') as HTMLInputElement).value).toBe('routing experts');
    fireEvent.click(screen.getByRole('radio', { name: 'Papers' }));
    expect(screen.getByText(SWITCH)).toBeTruthy();
  });

  it('shows a result’s flags where they matter: a preprint says so', async () => {
    renderPanel();
    search('Search papers…', 'stable sparse expert models');
    const row = (await screen.findByText(/^ST-MoE/)).closest('article');
    expect(row?.querySelector('[data-mark="preprint"]')?.textContent).toBe('Preprint');
  });

  it('runs a query handed over from elsewhere on the current source', async () => {
    const requests = recordRequests();
    renderPanel();

    act(() => handle.current!.openSidebar('research', { tab: 'research', query: 'trillion parameter models' }));

    await screen.findByText(SWITCH);
    expect((screen.getByPlaceholderText('Search papers…') as HTMLInputElement).value).toBe('trillion parameter models');
    expect(paperSearches(requests)).toEqual([expect.objectContaining({ query: 'trillion parameter models' })]);
  });

  it('sends the filters chosen, as the paper route takes them', async () => {
    const requests = recordRequests();
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Search filters' }));
    fireEvent.change(screen.getByLabelText('Number of results to return'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Published from year'), { target: { value: '2021' } });
    fireEvent.change(screen.getByLabelText('Order of results'), { target: { value: 'cited' } });
    fireEvent.change(screen.getByLabelText('Kind of work'), { target: { value: 'preprint' } });
    search('Search papers…', 'routing');

    await screen.findByText(SWITCH);
    expect(paperSearches(requests)).toEqual([
      { query: 'routing', limit: '40', year_from: '2021', sort: 'cited', kind: 'preprint' },
    ]);
  });

  it('follows a paper’s citation graph from its menu, and comes back', async () => {
    const requests = recordRequests();
    renderPanel();
    search('Search papers…', 'trillion parameter models');
    await screen.findByText(SWITCH);
    fireEvent.pointerDown(screen.getByRole('button', { name: /^More actions for Switch Transformers/ }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Papers citing this' }));

    const graph = await screen.findByRole('region', { name: 'Papers that cite this work' });
    expect(graph.textContent).toContain('ST-MoE');
    const sent = requests.find((request) => new URL(request.url).pathname.endsWith('/graph'));
    expect(decodeURIComponent(new URL(sent?.url ?? 'http://x').pathname)).toMatch(/\/papers\/arxiv:2101\.03961\/graph$/);
    expect(queryOf(sent as Request)).toMatchObject({ relation: 'citations' });

    fireEvent.click(screen.getByRole('button', { name: /^Close Papers that cite this work/ }));
    expect(await screen.findByText(SWITCH)).toBeTruthy();
  });

  it('makes no request to a host other than the API', async () => {
    const requests = recordRequests();
    renderPanel();
    search('Search papers…', 'routing');
    await screen.findByText(SWITCH);
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) expect(new URL(request.url).origin).toBe(window.location.origin);
  });

  it('keeps its sources in one row, with nothing to filter in a PDF search', () => {
    renderPanel();
    for (const name of ['Papers', 'Check a claim', 'Inside my PDFs']) expect(screen.getByRole('radio', { name })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search filters' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Inside my PDFs' }));
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
    expect(handle.current!.activePanel).toBe('library');
    expect(handle.current!.intent).toMatchObject({ tab: 'library', query: 'router' });
  });

  it('opens the Library from the PDF source', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Inside my PDFs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Library' }));
    expect(handle.current!.activePanel).toBe('library');
    expect(handle.current!.isOpen).toBe(true);
  });

  it('checks a claim as a job and shows the verdict with each passage, its level and its work (P2.UI-3)', async () => {
    fixtures.jobDurationMs = 0;
    const sent = recordRequests();
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Check a claim' }));
    // Nothing to filter in a claim check.
    expect(screen.queryByRole('button', { name: 'Search filters' })).toBeNull();
    search('A claim to check…', 'Top-1 routing keeps per-token compute constant.');

    const card = await screen.findByRole('region', { name: 'Claim check' }, { timeout: 5_000 });
    expect(card.getAttribute('data-claim-verdict')).toBe('partly');
    expect(within(card).getByText('Partly supported')).toBeTruthy();
    expect(within(card).getByText('Judged on: full text')).toBeTruthy();
    expect(within(card).getByText('Top-1 routing keeps per-token compute constant.')).toBeTruthy();
    const passages = within(card).getAllByRole('listitem');
    expect(passages.map((item) => within(item).getByText(/^(Supports|Narrows the claim)$/).textContent)).toEqual(['Supports', 'Narrows the claim']);
    expect(passages[0]?.textContent).toContain(FEDUS.csl.title);
    expect(passages[0]?.textContent).toContain('“We simplify the MoE routing algorithm');
    const posted = sent.find((request) => request.method === 'POST' && request.url.includes('/claims/check'));
    expect(await posted?.clone().json()).toEqual({ claim: 'Top-1 routing keeps per-token compute constant.', sources: [] });
  });

  it('checks a claim handed over from the toolbar, and says when it cannot be assessed', async () => {
    fixtures.jobDurationMs = 0;
    renderPanel();
    act(() => handle.current!.openSidebar('research', { tab: 'research', claim: 'Router z-loss removes all instability.', sources: [ZOPH.key] }));
    const card = await screen.findByRole('region', { name: 'Claim check' }, { timeout: 5_000 });
    expect(card.getAttribute('data-claim-verdict')).toBe('cannot_assess');
    expect(within(card).getByText('Cannot assess without the full text')).toBeTruthy();
    expect(card.textContent).toContain('Upload the paper’s PDF');
    expect(screen.getByRole('radio', { name: 'Check a claim' }).getAttribute('aria-checked')).toBe('true');
  });
});
