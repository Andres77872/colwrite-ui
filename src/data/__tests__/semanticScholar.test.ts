import { describe, expect, it } from 'vitest';
import { HttpResponse, http, problem, recordRequests, server } from '@/__tests__/server';
import {
  assessSemanticScholarClaim,
  getSemanticScholarGraph,
  getSemanticScholarRecommendations,
  normalizeClaimAssessment,
  normalizeResearchPaper,
  searchSemanticScholar,
} from '../semanticScholar';

/** Path and query parameters of a recorded request. */
function read(request: Request | undefined): { path: string; query: Array<[string, string]>; request: Request } {
  if (!request) throw new Error('No such request was sent');
  const url = new URL(request.url);
  return { path: url.pathname, query: [...url.searchParams.entries()], request };
}

/**
 * A body as sent, which may be off the contract: these tests feed the
 * normalizers what an older or broken server could send.
 */
const raw = (body: unknown) => HttpResponse.json(body as Record<string, unknown>);

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
  it('normalizes search pagination and drops papers it cannot show', async () => {
    const sent = recordRequests();
    server.use(http.get('/research/semantic-scholar/search', ({ response }) => response.untyped(raw({
      provider: 'semantic_scholar',
      total: 101,
      offset: 10,
      next_offset: 20,
      data: [paper, { ...paper, paper_id: 'blank', title: '   ' }],
    }))));

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
    expect(read(sent[0]).path).toBe('/api/research/semantic-scholar/search');
    expect(read(sent[0]).query).toEqual([['query', 'graph evidence'], ['limit', '10'], ['offset', '10']]);
    expect(sent[0]?.method).toBe('GET');
    expect(sent[0]?.credentials).toBe('include');
  });

  it('maps the complete search filter contract to backend query parameters', async () => {
    const sent = recordRequests();
    server.use(http.get('/research/semantic-scholar/search', ({ response }) => response(200).json({
      provider: 'semantic_scholar',
      total: 0,
      offset: 0,
      next_offset: null,
      data: [],
    })));

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

    expect(read(sent[0]).query).toEqual([
      ['query', 'filtered evidence'],
      ['limit', '20'],
      ['offset', '0'],
      ['year', '2020-2026'],
      ['publication_date_or_year', '2024-01-01:2025-12-31'],
      ['publication_types', 'JournalArticle,Review'],
      ['open_access_only', 'true'],
      ['min_citation_count', '5'],
      ['venues', 'Nature,Science'],
      ['fields_of_study', 'Medicine,Computer Science'],
    ]);
  });

  it('uses query parameters for paper ids on the graph routes', async () => {
    const sent = recordRequests();
    server.use(
      http.get('/research/semantic-scholar/graph', ({ response }) => response.untyped(raw({
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
      }))),
      http.get('/research/semantic-scholar/recommendations', ({ response }) => response.untyped(raw({
        provider: 'semantic_scholar',
        paper_id: 'DOI:10.1000/example',
        data: [paper],
        seed_paper_ids: ['DOI:10.1000/example'],
      }))),
    );

    const graph = await getSemanticScholarGraph({
      paperId: 'DOI:10.1000/example',
      direction: 'citations',
      limit: 5,
    });
    const recommendations = await getSemanticScholarRecommendations({
      paperId: 'DOI:10.1000/example',
      limit: 7,
    });

    expect([read(sent[0]).path, read(sent[1]).path]).toEqual([
      '/api/research/semantic-scholar/graph',
      '/api/research/semantic-scholar/recommendations',
    ]);
    expect(read(sent[0]).query).toEqual([['paper_id', 'DOI:10.1000/example'], ['direction', 'citations'], ['limit', '5'], ['offset', '0']]);
    expect(read(sent[1]).query).toEqual([['paper_id', 'DOI:10.1000/example'], ['limit', '7']]);
    expect(graph.data[0]).toMatchObject({
      contexts: ['Evidence candidate context.'],
      intents: ['background'],
      is_influential: true,
    });
    expect(recommendations.data[0]?.paper_id).toBe('abc123');
    for (const request of sent) {
      expect(request.credentials).toBe('include');
    }
  });

  it('posts a normalized claim-assessment request and returns source-backed evidence', async () => {
    const sent = recordRequests();
    server.use(http.post('/research/semantic-scholar/claim-assessment', ({ response }) => response(200).json({
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
      })));

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
    expect(read(sent[0]).path).toBe('/api/research/semantic-scholar/claim-assessment');
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.credentials).toBe('include');
    expect(await sent[0]?.json()).toEqual({
      claim: 'The treatment improves recovery.',
      limit: 12,
      year: '2020-2026',
    });
  });

  it('rejects with the problem the API names, its detail as the message', async () => {
    server.use(http.get('/research/semantic-scholar/search', () =>
      problem('paper_source_disabled', 'Semantic Scholar is turned off for this account.', { source: 'semantic_scholar' })));

    const error = await searchSemanticScholar({ query: 'evidence' }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 403,
      message: 'Semantic Scholar is turned off for this account.',
      data: { code: 'paper_source_disabled', source: 'semantic_scholar' },
    });
  });

  it('uses request defaults and rejects invalid claims or assessment payloads', async () => {
    const sent = recordRequests();
    server.use(
      http.post('/research/semantic-scholar/claim-assessment', ({ response }) => response.untyped(raw({ invalid: true })), { once: true }),
      http.post('/research/semantic-scholar/claim-assessment', ({ response }) => response(200).json({
        claim: 'Valid claim',
        verdict: 'insufficient',
        confidence: 0,
        rationale: 'No directly inspectable evidence was retrieved.',
        evidence: [],
        limitations: [],
        provider: 'semantic_scholar',
        disclaimer: 'This assessment is limited to retrieved excerpts.',
      })),
    );

    await expect(assessSemanticScholarClaim({ claim: 'Valid claim' }))
      .rejects.toThrow('invalid claim assessment');
    await assessSemanticScholarClaim({ claim: 'Valid claim', year: '   ' });

    expect(await sent[1]?.json()).toEqual({
      claim: 'Valid claim',
      limit: 8,
    });
    await expect(assessSemanticScholarClaim({ claim: '   ' }))
      .rejects.toThrow('Claim is required');
    await expect(assessSemanticScholarClaim({ claim: 'x'.repeat(2_001) }))
      .rejects.toThrow('2,000 characters or fewer');
    expect(sent).toHaveLength(2);
  });
});
