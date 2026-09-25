import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  search: vi.fn(),
  graph: vi.fn(),
  recommendations: vi.fn(),
  assessment: vi.fn(),
}));

vi.mock('@/services/semanticScholar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/semanticScholar')>();
  return {
    ...actual,
    searchSemanticScholar: serviceMocks.search,
    getSemanticScholarGraph: serviceMocks.graph,
    getSemanticScholarRecommendations: serviceMocks.recommendations,
    assessSemanticScholarClaim: serviceMocks.assessment,
  };
});

vi.mock('@/components/preferences', () => ({
  useAgentTools: () => ({ isSourceEnabled: () => true }),
}));

// Only the open document's id is read here; a real EditorProvider would drag
// the whole document-loading stack into a test about a search panel.
vi.mock('@/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/editor')>()),
  useEditor: () => ({ documentId: null }),
}));

import type { ClaimAssessment, ClaimVerdict } from '@/services/semanticScholar';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PanelsProvider } from '../panelsContext';
import { ResearchPanel } from '../ResearchPanel';
import { TOOLS } from '../toolsConfig';

const paper = {
  provider: 'semantic_scholar' as const,
  paper_id: 's2-paper',
  corpus_id: 1,
  external_ids: { DOI: '10.1000/panel' },
  title: 'Semantic evidence',
  abstract: null,
  url: 'https://www.semanticscholar.org/paper/s2-paper',
  pdf_url: null,
  authors: [],
  year: null,
  publication_date: null,
  venue: null,
  citation_count: 12,
  influential_citation_count: null,
  reference_count: null,
  is_open_access: false,
  open_access_pdf: null,
  tldr: 'Fallback summary when the abstract is unavailable.',
  publication_types: [],
  fields_of_study: [],
};

function claimAssessment(overrides: Partial<ClaimAssessment> = {}): ClaimAssessment {
  return {
    claim: 'The intervention improves outcomes.',
    verdict: 'supported',
    confidence: 0.82,
    rationale: 'The selected excerpt directly reports improved outcomes.',
    evidence: [
      {
        evidence_id: 'E1',
        stance: 'supports',
        explanation: 'The result directly addresses the assessed outcome.',
        excerpt: 'Participants receiving the intervention improved significantly.',
        kind: 'body',
        paper_id: 'evidence-paper',
        corpus_id: 42,
        title: 'Outcome study',
        authors: 'A. Researcher',
        year: 2024,
        url: 'https://www.semanticscholar.org/paper/evidence-paper',
        score: 0.93,
        license: 'CC-BY-4.0',
        open_access_status: 'GOLD',
        disclaimer: 'Verify source access and reuse terms.',
        provenance: [
          {
            provider: 'semantic_scholar',
            endpoint: '/graph/v1/snippet/search',
            provider_id: 'CorpusId:42',
          },
        ],
      },
    ],
    limitations: ['Only one directly relevant excerpt was retrieved.'],
    provider: 'semantic_scholar',
    disclaimer: 'Assessment is limited to retrieved excerpts.',
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <ToastProvider>
      <TooltipProvider>
        <PanelsProvider>
          <ResearchPanel />
        </PanelsProvider>
      </TooltipProvider>
    </ToastProvider>,
  );
}

/** Radix menus open on pointer down, not click. */
function openMenu(title: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: `More actions for ${title}` }), {
    button: 0,
    ctrlKey: false,
  });
}

function switchToClaims() {
  fireEvent.click(screen.getByRole('radio', { name: 'Check a claim' }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('panels.researchSource', JSON.stringify('semantic-scholar'));
  serviceMocks.search.mockReset();
  serviceMocks.graph.mockReset();
  serviceMocks.recommendations.mockReset();
  serviceMocks.assessment.mockReset();
  serviceMocks.search.mockResolvedValue({
    provider: 'semantic_scholar',
    total: 1,
    offset: 0,
    next_offset: null,
    data: [paper],
  });
  serviceMocks.graph.mockResolvedValue({
    provider: 'semantic_scholar',
    direction: 'citations',
    paper_id: paper.paper_id,
    offset: 0,
    next_offset: null,
    data: [
      {
        contexts: [
          'A candidate passage, not an adjudicated verdict.',
          'A second source-provided citation context.',
        ],
        intents: ['background'],
        is_influential: true,
        paper: { ...paper, paper_id: 'citing-paper', title: 'Citing work' },
      },
    ],
  });
  serviceMocks.recommendations.mockResolvedValue({
    provider: 'semantic_scholar',
    paper_id: paper.paper_id,
    data: [{ ...paper, paper_id: 'related-paper', title: 'Related work' }],
  });
  serviceMocks.assessment.mockResolvedValue(claimAssessment());
});

afterEach(cleanup);

async function runSearch() {
  renderPanel();
  fireEvent.change(screen.getByPlaceholderText('Search Semantic Scholar…'), {
    target: { value: 'evidence retrieval' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByText('Semantic evidence');
}

async function runAssessment(claim = 'The intervention improves outcomes.') {
  renderPanel();
  switchToClaims();
  fireEvent.change(screen.getByPlaceholderText('State one claim to check…'), {
    target: { value: claim },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Check claim' }));
  await screen.findByRole('region', { name: 'Claim assessment' });
}

describe('Research on Semantic Scholar', () => {
  it('is registered as a first-class tool', () => {
    expect(TOOLS.find((tool) => tool.id === 'semantic-scholar')).toMatchObject({
      label: 'Semantic Scholar',
    });
  });

  it('uses a bundled provider mark and the required attributed backlink', () => {
    const { container } = renderPanel();

    expect(
      screen.getByRole('link', { name: 'Provider attribution' }).getAttribute('href'),
    ).toBe('https://www.semanticscholar.org/?utm_source=api');
    const mark = container.querySelector<HTMLImageElement>('img[aria-hidden="true"]');
    expect(mark?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(mark?.getAttribute('src')).not.toMatch(/^https?:/);
  });

  it('renders nullable paper metadata with provider-neutral source links', async () => {
    await runSearch();

    expect(serviceMocks.search).toHaveBeenCalledWith({
      query: 'evidence retrieval',
      limit: 20,
    });
    expect(
      screen.getByText(
        'Semantic Scholar TLDR: Fallback summary when the abstract is unavailable.',
      ),
    ).toBeTruthy();
    // Links out of the app live behind the row's "…" menu.
    openMenu('Semantic evidence');
    expect(
      screen.getByRole('menuitem', { name: /Open on Semantic Scholar/ }).getAttribute('href'),
    ).toBe(paper.url);
    expect(screen.getByRole('menuitem', { name: /DOI/ }).getAttribute('href')).toBe(
      'https://doi.org/10.1000/panel',
    );
  });

  it('sends compact search filters through the typed service contract', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Search filters' }));
    fireEvent.change(screen.getByLabelText('Publication year filter'), {
      target: { value: '2020-2026' },
    });
    fireEvent.change(screen.getByLabelText('Minimum citation count'), {
      target: { value: '7' },
    });
    fireEvent.change(screen.getByLabelText('Fields of study filter'), {
      target: { value: 'Medicine, Computer Science' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Open-access papers only' }));
    fireEvent.change(screen.getByPlaceholderText('Search Semantic Scholar…'), {
      target: { value: 'filtered evidence' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('Semantic evidence');
    expect(serviceMocks.search).toHaveBeenCalledWith({
      query: 'filtered evidence',
      limit: 20,
      year: '2020-2026',
      openAccessOnly: true,
      minCitationCount: 7,
      fieldsOfStudy: ['Medicine', 'Computer Science'],
    });
  });

  it('loads citation graph evidence and recommendations from paper actions', async () => {
    await runSearch();

    openMenu('Semantic evidence');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Papers citing this' }));
    await screen.findByText('Citing work');
    expect(serviceMocks.graph).toHaveBeenCalledWith({
      paperId: paper.paper_id,
      direction: 'citations',
      limit: 20,
      offset: 0,
    });
    fireEvent.click(
      screen.getByText('Citation contexts (2)'),
    );
    expect(screen.getByText(/Evidence candidate:.*candidate passage/)).toBeTruthy();
    expect(screen.getByText(/Evidence candidate:.*second source-provided/)).toBeTruthy();

    // The graph is a drill-in: back to the results, then on to related work.
    fireEvent.click(
      screen.getByRole('button', { name: 'Close Papers that cite this work for Semantic evidence' }),
    );
    openMenu('Semantic evidence');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Related papers' }));
    await screen.findByText('Related work');
    expect(serviceMocks.recommendations).toHaveBeenCalledWith({
      paperId: paper.paper_id,
      limit: 20,
    });
  });

  it('appends search pages, deduplicates papers, and uses the returned next offset', async () => {
    const secondPaper = {
      ...paper,
      paper_id: 's2-paper-2',
      title: 'Additional evidence',
    };
    serviceMocks.search
      .mockResolvedValueOnce({
        provider: 'semantic_scholar',
        total: 3,
        offset: 0,
        next_offset: 20,
        data: [paper],
      })
      .mockResolvedValueOnce({
        provider: 'semantic_scholar',
        total: 3,
        offset: 20,
        next_offset: null,
        data: [paper, secondPaper],
      });

    await runSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Load more papers' }));
    await screen.findByText('Additional evidence');

    expect(serviceMocks.search).toHaveBeenNthCalledWith(2, {
      query: 'evidence retrieval',
      limit: 20,
      offset: 20,
    });
    expect(screen.getAllByText('Semantic evidence')).toHaveLength(1);
    expect(screen.getByText('Showing 2 of 3 papers')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more papers' })).toBeNull();
  });

  it('ignores a stale appended page after a newer search completes', async () => {
    let resolveAppend: (value: {
      provider: 'semantic_scholar';
      total: number;
      offset: number;
      next_offset: null;
      data: typeof paper[];
    }) => void = () => {};
    serviceMocks.search
      .mockResolvedValueOnce({
        provider: 'semantic_scholar',
        total: 2,
        offset: 0,
        next_offset: 20,
        data: [paper],
      })
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveAppend = resolve;
        }),
      )
      .mockResolvedValueOnce({
        provider: 'semantic_scholar',
        total: 1,
        offset: 0,
        next_offset: null,
        data: [{ ...paper, paper_id: 'new-result', title: 'Newest result' }],
      });

    await runSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Load more papers' }));
    fireEvent.change(screen.getByPlaceholderText('Search Semantic Scholar…'), {
      target: { value: 'new query' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Newest result');

    await act(async () => {
      resolveAppend({
        provider: 'semantic_scholar',
        total: 2,
        offset: 20,
        next_offset: null,
        data: [{ ...paper, paper_id: 'stale-result', title: 'Stale appended result' }],
      });
    });
    expect(screen.queryByText('Stale appended result')).toBeNull();
    expect(screen.getByText('Newest result')).toBeTruthy();
  });

  it('reports graph failures without discarding search results', async () => {
    serviceMocks.graph.mockRejectedValueOnce(new Error('Graph rate limited'));
    await runSearch();

    openMenu('Semantic evidence');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Its references' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Graph rate limited'));
    expect(screen.getAllByText('Semantic evidence').length).toBeGreaterThan(0);
  });

  it('assesses the entered claim and renders calibrated source-backed evidence', async () => {
    await runAssessment();

    expect(serviceMocks.assessment).toHaveBeenCalledWith({
      claim: 'The intervention improves outcomes.',
      limit: 12,
    });
    expect(screen.getByText('Supported')).toBeTruthy();
    expect(screen.getByText('Assessment confidence: 82%')).toBeTruthy();
    expect(
      screen.getByText('The selected excerpt directly reports improved outcomes.'),
    ).toBeTruthy();
    expect(
      screen.getByText('“Participants receiving the intervention improved significantly.”'),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open evidence source: Outcome study' })
        .getAttribute('href'),
    ).toBe('https://www.semanticscholar.org/paper/evidence-paper');
    expect(screen.getByText('Only one directly relevant excerpt was retrieved.')).toBeTruthy();
    expect(
      screen.getByLabelText('Evidence source terms').textContent,
    ).toContain(
      'Open-access status: GOLD. License: CC-BY-4.0. Verify source access and reuse terms.',
    );
    expect(screen.getByLabelText('Evidence relevance score').textContent).toContain(
      'Retrieval relevance: 0.93 (not claim confidence)',
    );
    // Provenance is behind a disclosure now, so open it the way a reader would.
    fireEvent.click(screen.getByRole('button', { name: /Provenance \(1\)/ }));
    expect(screen.getByLabelText('Evidence provenance').textContent).toContain(
      'semantic_scholar · /graph/v1/snippet/search · CorpusId:42',
    );
    expect(screen.getByText('Assessment is limited to retrieved excerpts.')).toBeTruthy();
  });

  it('does not turn a provider API URL into a browser navigation link', async () => {
    const [evidence] = claimAssessment().evidence;
    serviceMocks.assessment.mockResolvedValueOnce(
      claimAssessment({
        evidence: [
          {
            ...evidence,
            url: `https://${['api', 'semanticscholar', 'org'].join('.')}/graph/v1/paper/evidence-paper`,
          },
        ],
      }),
    );

    await runAssessment();

    expect(
      screen.queryByRole('link', { name: 'Open evidence source: Outcome study' }),
    ).toBeNull();
    expect(screen.getByText('Outcome study')).toBeTruthy();
  });

  it('uses a separate optional year filter for claim assessment', async () => {
    renderPanel();
    switchToClaims();
    fireEvent.change(screen.getByPlaceholderText('State one claim to check…'), {
      target: { value: 'A time-bounded claim' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search filters' }));
    fireEvent.change(screen.getByLabelText('Limit claim sources to year'), {
      target: { value: '2021-2025' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check claim' }));
    await screen.findByRole('region', { name: 'Claim assessment' });

    expect(serviceMocks.assessment).toHaveBeenCalledWith({
      claim: 'A time-bounded claim',
      limit: 12,
      year: '2021-2025',
    });
  });

  it.each<[ClaimVerdict, string]>([
    ['contradicted', 'Contradicted'],
    ['mixed', 'Mixed'],
    ['insufficient', 'Insufficient evidence'],
  ])('renders the %s claim verdict without collapsing it to a binary result', async (
    verdict,
    label,
  ) => {
    serviceMocks.assessment.mockResolvedValueOnce(
      claimAssessment({
        verdict,
        confidence: 0.35,
        evidence: [],
        rationale: `${label} rationale.`,
      }),
    );

    await runAssessment();
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText(`${label} rationale.`)).toBeTruthy();
    expect(screen.getByText('No source excerpt was selected for this assessment.')).toBeTruthy();
  });

  it('keeps only the newest claim assessment when requests resolve out of order', async () => {
    let resolveFirst: (assessment: ClaimAssessment) => void = () => {};
    let resolveSecond: (assessment: ClaimAssessment) => void = () => {};
    serviceMocks.assessment
      .mockImplementationOnce(
        () => new Promise<ClaimAssessment>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockImplementationOnce(
        () => new Promise<ClaimAssessment>((resolve) => {
          resolveSecond = resolve;
        }),
      );

    renderPanel();
    switchToClaims();
    const field = screen.getByPlaceholderText('State one claim to check…');
    const assess = screen.getByRole('button', { name: 'Check claim' });
    fireEvent.change(field, { target: { value: 'First claim' } });
    fireEvent.click(assess);
    fireEvent.change(field, { target: { value: 'Second claim' } });
    fireEvent.click(assess);

    await act(async () => {
      resolveSecond(claimAssessment({ claim: 'Second claim', rationale: 'Newest rationale.' }));
    });
    await screen.findByText('Newest rationale.');

    await act(async () => {
      resolveFirst(claimAssessment({ claim: 'First claim', rationale: 'Stale rationale.' }));
    });
    expect(screen.queryByText('Stale rationale.')).toBeNull();
    // The claim box is a textarea now, and holds the same words.
    expect(screen.getByText('Second claim', { ignore: 'script, style, textarea' })).toBeTruthy();
  });

  it('shows claim-assessment failures without discarding paper search controls', async () => {
    serviceMocks.assessment.mockRejectedValueOnce(new Error('Assessment provider unavailable'));
    renderPanel();
    switchToClaims();
    fireEvent.change(screen.getByPlaceholderText('State one claim to check…'), {
      target: { value: 'A precise claim' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check claim' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Assessment provider unavailable',
    );
    // Paper search is one switch away, with the claim still in the box.
    fireEvent.click(screen.getByRole('radio', { name: 'Find papers' }));
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
    expect((screen.getByPlaceholderText('Search Semantic Scholar…') as HTMLInputElement).value).toBe(
      'A precise claim',
    );
  });

  it('shows open-access license and disclaimer on paper cards', async () => {
    serviceMocks.search.mockResolvedValueOnce({
      provider: 'semantic_scholar',
      total: 1,
      offset: 0,
      next_offset: null,
      data: [
        {
          ...paper,
          is_open_access: true,
          open_access_pdf: {
            url: 'https://example.test/open.pdf',
            status: 'GREEN',
            license: 'CC-BY-4.0',
            disclaimer: 'Verify reuse terms with the publisher.',
          },
        },
      ],
    });
    await runSearch();

    expect(screen.getByLabelText('Open-access terms').textContent).toContain('CC-BY-4.0');
    expect(screen.getByLabelText('Open-access terms').textContent).toContain(
      'Verify reuse terms with the publisher.',
    );
  });
});
