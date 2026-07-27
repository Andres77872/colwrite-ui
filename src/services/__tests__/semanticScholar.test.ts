import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assessSemanticScholarClaim,
  getSemanticScholarGraph,
  getSemanticScholarPaper,
  getSemanticScholarRecommendations,
  normalizeClaimAssessment,
  normalizeResearchPaper,
  searchSemanticScholar,
} from '../semanticScholar';

const fetchMock = vi.fn();

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const paper = {
  provider: 'semantic_scholar',
  paper_id: 'abc123',
  corpus_id: 42,
  external_ids: { DOI: '10.1000/Example', ArXiv: '2401.00001', Empty: null },
  title: 'A useful paper',
  abstract: null,
  url: 'https://www.semanticscholar.org/paper/abc123',
  pdf_url: null,
  authors: [
    { author_id: 'author-1', name: 'Ada Lovelace' },
    { author_id: null, name: 'Grace Hopper' },
    { author_id: 'bad', name: null },
  ],
  year: 2025,
  publication_date: '2025-02-03',
  venue: 'TestConf',
  citation_count: 17,
  influential_citation_count: 3,
  reference_count: 9,
  is_open_access: true,
  open_access_pdf: {
    url: 'https://example.test/paper.pdf',
    status: 'GREEN',
    license: null,
    disclaimer: 'Use is subject to the source license.',
  },
  tldr: { model: 'tldr@v2', text: 'A compact summary.' },
  publication_types: ['JournalArticle', null],
  fields_of_study: ['Computer Science'],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeResearchPaper', () => {
  it('normalizes snake_case DTOs and tolerates nullable/invalid optional fields', () => {
    const normalized = normalizeResearchPaper(paper);

    expect(normalized).toMatchObject({
      provider: 'semantic_scholar',
      paper_id: 'abc123',
      corpus_id: 42,
      title: 'A useful paper',
      abstract: null,
      pdf_url: 'https://example.test/paper.pdf',
      authors: [
        { author_id: 'author-1', name: 'Ada Lovelace' },
        { author_id: null, name: 'Grace Hopper' },
      ],
      tldr: 'A compact summary.',
      publication_types: ['JournalArticle'],
      fields_of_study: ['Computer Science'],
    });
    expect(normalized?.external_ids).toEqual({
      DOI: '10.1000/Example',
      ArXiv: '2401.00001',
    });
  });

  it('rejects entries without stable identity and title', () => {
    expect(normalizeResearchPaper({ title: 'Missing id' })).toBeNull();
    expect(normalizeResearchPaper({ paper_id: 'id', title: null })).toBeNull();
    expect(normalizeResearchPaper(null)).toBeNull();
  });
});

describe('normalizeClaimAssessment', () => {
  const assessment = {
    claim: 'The treatment improves recovery.',
    verdict: 'mixed',
    confidence: 0.74,
    rationale: 'The retrieved studies disagree.',
    evidence: [
      {
        evidence_id: 'E1',
        stance: 'supports',
        explanation: 'The trial reported faster recovery.',
        excerpt: 'Recovery was faster in the treatment group.',
        kind: 'body',
        paper_id: 'paper-1',
        corpus_id: 101,
        title: 'Treatment Trial',
        authors: 'Ada Author, Grace Researcher',
        year: 2024,
        url: 'https://example.test/paper-1',
        score: 0.91,
        license: 'CC-BY-4.0',
        open_access_status: 'GOLD',
        disclaimer: 'Verify source access and reuse terms.',
        provenance: [
          {
            provider: 'semantic_scholar',
            endpoint: '/graph/v1/snippet/search',
            provider_id: 'CorpusId:101',
          },
          { provider: null, endpoint: null },
        ],
      },
      {
        evidence_id: 'E2',
        stance: 'contradicts',
        explanation: 'The replication found no improvement.',
        excerpt: 'No statistically significant difference was observed.',
        kind: 'abstract',
        paper_id: null,
        corpus_id: null,
        title: null,
        authors: null,
        year: null,
        url: null,
        score: null,
        license: null,
        open_access_status: null,
        disclaimer: null,
        provenance: [],
      },
    ],
    limitations: ['Only retrieved excerpts were assessed.', null],
    provider: 'semantic_scholar',
    disclaimer: 'Read the source papers before relying on this assessment.',
  };

  it('normalizes the strict snake_case assessment and evidence DTOs', () => {
    expect(normalizeClaimAssessment(assessment)).toEqual({
      ...assessment,
      evidence: [
        {
          ...assessment.evidence[0],
          provenance: [
            {
              provider: 'semantic_scholar',
              endpoint: '/graph/v1/snippet/search',
              provider_id: 'CorpusId:101',
            },
          ],
        },
        assessment.evidence[1],
      ],
      limitations: ['Only retrieved excerpts were assessed.'],
    });
  });

  it('drops malformed evidence and optional metadata without weakening the verdict contract', () => {
    const normalized = normalizeClaimAssessment({
      ...assessment,
      evidence: [
        assessment.evidence[0],
        { ...assessment.evidence[1], stance: 'unknown' },
        {
          ...assessment.evidence[1],
          evidence_id: 'E3',
          year: 10_000,
          corpus_id: -1,
          score: Number.POSITIVE_INFINITY,
        },
      ],
    });

    expect(normalized?.evidence).toHaveLength(2);
    expect(normalized?.evidence[1]).toMatchObject({
      evidence_id: 'E3',
      corpus_id: null,
      year: null,
      score: null,
    });
    expect(normalizeClaimAssessment({ ...assessment, verdict: 'probably' })).toBeNull();
    expect(normalizeClaimAssessment({ ...assessment, confidence: 2 })).toBeNull();
    expect(normalizeClaimAssessment(null)).toBeNull();
  });
});

describe('Semantic Scholar authenticated API routes', () => {
  it('normalizes search pagination and filters malformed papers', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        provider: 'semantic_scholar',
        total: 101,
        offset: 10,
        next_offset: 20,
        data: [paper, { title: 'missing id' }, null],
      }),
    );

    const result = await searchSemanticScholar({
      query: ' graph evidence ',
      limit: 10,
      offset: 10,
    });

    expect(result).toMatchObject({
      provider: 'semantic_scholar',
      total: 101,
      offset: 10,
      next_offset: 20,
    });
    expect(result.data).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/research/semantic-scholar/search?query=graph+evidence&limit=10&offset=10',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      credentials: 'include',
    });
  });

  it('maps the complete search filter contract to backend query parameters', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        provider: 'semantic_scholar',
        total: 0,
        offset: 0,
        next_offset: null,
        data: [],
      }),
    );

    await searchSemanticScholar({
      query: ' filtered evidence ',
      year: ' 2020-2026 ',
      publicationDateOrYear: '2024-01-01:2025-12-31',
      publicationTypes: [' JournalArticle ', 'Review', 'journalarticle', ''],
      openAccessOnly: true,
      minCitationCount: 5.9,
      venues: [' Nature ', 'Science'],
      fieldsOfStudy: ['Medicine', ' Computer Science '],
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/research/semantic-scholar/search?query=filtered+evidence&limit=20&offset=0'
      + '&year=2020-2026&publication_date_or_year=2024-01-01%3A2025-12-31'
      + '&publication_types=JournalArticle%2CReview&open_access_only=true'
      + '&min_citation_count=5&venues=Nature%2CScience'
      + '&fields_of_study=Medicine%2CComputer+Science',
    );
  });

  it('uses query parameters for paper ids and all graph routes', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ data: paper }))
      .mockResolvedValueOnce(
        response({
          provider: 'semantic_scholar',
          direction: 'citations',
          paper_id: 'DOI:10.1000/example',
          offset: 0,
          next_offset: null,
          data: [
            {
              contexts: ['Evidence candidate context.'],
              intents: ['background'],
              is_influential: true,
              paper,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          provider: 'semantic_scholar',
          paper_id: 'DOI:10.1000/example',
          data: [paper],
        }),
      );

    await getSemanticScholarPaper('DOI:10.1000/example');
    const graph = await getSemanticScholarGraph({
      paperId: 'DOI:10.1000/example',
      direction: 'citations',
      limit: 5,
    });
    const recommendations = await getSemanticScholarRecommendations({
      paperId: 'DOI:10.1000/example',
      limit: 7,
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/research/semantic-scholar/paper?paper_id=DOI%3A10.1000%2Fexample',
      '/api/research/semantic-scholar/graph?paper_id=DOI%3A10.1000%2Fexample&direction=citations&limit=5&offset=0',
      '/api/research/semantic-scholar/recommendations?paper_id=DOI%3A10.1000%2Fexample&limit=7',
    ]);
    expect(graph.data[0]).toMatchObject({
      contexts: ['Evidence candidate context.'],
      intents: ['background'],
      is_influential: true,
    });
    expect(recommendations.data[0].paper_id).toBe('abc123');
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ credentials: 'include' });
    }
  });

  it('posts a normalized claim-assessment request and returns source-backed evidence', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        claim: 'The treatment improves recovery.',
        verdict: 'supported',
        confidence: 0.82,
        rationale: 'The selected evidence supports the claim.',
        evidence: [
          {
            evidence_id: 'E1',
            stance: 'supports',
            explanation: 'The reported outcome supports the claim.',
            excerpt: 'Recovery time decreased by three days.',
            kind: 'citation_context',
            paper_id: 'paper-1',
            corpus_id: 42,
            title: 'Recovery Study',
            authors: 'Ada Author',
            year: 2025,
            url: 'https://example.test/recovery',
            score: 0.95,
          },
        ],
        limitations: ['Full text was unavailable for one result.'],
        provider: 'semantic_scholar',
        disclaimer: 'This assessment is limited to the retrieved excerpts.',
      }),
    );

    const result = await assessSemanticScholarClaim({
      claim: '  The treatment improves recovery.  ',
      limit: 99,
      year: '  2020-2026  ',
    });

    expect(result).toMatchObject({
      verdict: 'supported',
      confidence: 0.82,
      provider: 'semantic_scholar',
      evidence: [
        {
          evidence_id: 'E1',
          stance: 'supports',
          kind: 'citation_context',
          paper_id: 'paper-1',
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/research/semantic-scholar/claim-assessment',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          claim: 'The treatment improves recovery.',
          limit: 12,
          year: '2020-2026',
        }),
      }),
    );
  });

  it('uses request defaults and rejects invalid claims or assessment payloads', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ invalid: true }))
      .mockResolvedValueOnce(
        response({
          claim: 'Valid claim',
          verdict: 'insufficient',
          confidence: 0,
          rationale: 'No directly inspectable evidence was retrieved.',
          evidence: [],
          limitations: [],
          provider: 'semantic_scholar',
          disclaimer: 'This assessment is limited to retrieved excerpts.',
        }),
      );

    await expect(assessSemanticScholarClaim({ claim: 'Valid claim' }))
      .rejects.toThrow('invalid claim assessment');
    await assessSemanticScholarClaim({ claim: 'Valid claim', year: '   ' });

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(secondRequest.body))).toEqual({
      claim: 'Valid claim',
      limit: 8,
    });
    await expect(assessSemanticScholarClaim({ claim: '   ' }))
      .rejects.toThrow('Claim is required');
    await expect(assessSemanticScholarClaim({ claim: 'x'.repeat(2_001) }))
      .rejects.toThrow('2,000 characters or fewer');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
