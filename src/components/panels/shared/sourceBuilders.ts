import { canonicalArxivId, canonicalCitationKey, canonicalDoi, yearOf, type CitationSource } from '@/editor';
import type { ArxivResult } from '@/services/arxiv';
import type { ColpaliArxivResult } from '@/services/colpali';
import { researchAuthorsLabel, researchExternalId, type ResearchPaper } from '@/services/semanticScholar';

/**
 * Search results as library sources.
 *
 * Keys follow the API's portable-key rule — DOI first, then the arXiv id,
 * then the Semantic Scholar id — so a paper found in two panels, or by the
 * assistant, is one library entry. The provider names the index the record
 * came from; a provider's own name is never used as the venue.
 */

function arxivSource(fields: {
  id: string;
  title?: string | null;
  authors?: string | null;
  date?: string | null;
  doi?: string | null;
  url?: string | null;
  pdfUrl?: string | null;
}): CitationSource {
  const arxiv = canonicalArxivId(fields.id) ?? fields.id;
  const doi = canonicalDoi(fields.doi);
  const source: CitationSource = {
    key: doi ?? arxiv,
    provider: 'arxiv',
    providerId: arxiv,
    externalIds: { ArXiv: arxiv, ...(doi ? { DOI: doi } : {}) },
    kind: 'preprint',
    url: fields.url ?? `https://arxiv.org/abs/${arxiv}`,
  };
  if (fields.title) source.title = fields.title;
  if (fields.authors) source.authors = fields.authors;
  const year = yearOf(fields.date);
  if (year) source.year = year;
  if (doi) source.doi = doi;
  if (fields.pdfUrl) source.pdfUrl = fields.pdfUrl;
  return source;
}

export function sourceFromArxiv(result: ArxivResult): CitationSource {
  return arxivSource({ ...result, pdfUrl: result.pdfUrl });
}

export function sourceFromColpali(result: ColpaliArxivResult): CitationSource {
  return arxivSource({ ...result, pdfUrl: `https://arxiv.org/pdf/${result.id}` });
}

export function sourceFromSemanticScholar(paper: ResearchPaper): CitationSource {
  const doi = canonicalDoi(researchExternalId(paper, 'DOI'));
  const arxiv = researchExternalId(paper, 'ArXiv');
  const key = doi ?? (arxiv ? canonicalCitationKey(arxiv) : `S2:${paper.paper_id}`);
  const source: CitationSource = {
    key,
    title: paper.title,
    provider: 'semantic_scholar',
    providerId: paper.paper_id,
    externalIds: { ...paper.external_ids },
  };
  const authors = researchAuthorsLabel(paper);
  if (authors) source.authors = authors;
  if (paper.year) source.year = String(paper.year);
  if (paper.venue) source.venue = paper.venue;
  if (paper.url) source.url = paper.url;
  if (doi) source.doi = doi;
  if (paper.pdf_url) source.pdfUrl = paper.pdf_url;
  if (typeof paper.citation_count === 'number') source.citationCount = paper.citation_count;
  return source;
}
