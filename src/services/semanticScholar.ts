import { get, post } from './api';
import { isUnknownRecord } from './contracts';

const SEMANTIC_SCHOLAR_BASE = '/research/semantic-scholar';

export type ResearchProvider = 'semantic_scholar';

export type ResearchAuthor = {
  author_id: string | null;
  name: string;
};

export type OpenAccessPdf = {
  url: string | null;
  status: string | null;
  license: string | null;
  disclaimer: string | null;
};

export type ResearchPaper = {
  provider: ResearchProvider;
  paper_id: string;
  corpus_id: number | null;
  external_ids: Record<string, string>;
  title: string;
  abstract: string | null;
  url: string | null;
  pdf_url: string | null;
  authors: ResearchAuthor[];
  year: number | null;
  publication_date: string | null;
  venue: string | null;
  citation_count: number | null;
  influential_citation_count: number | null;
  reference_count: number | null;
  is_open_access: boolean;
  open_access_pdf: OpenAccessPdf | null;
  tldr: string | null;
  publication_types: string[];
  fields_of_study: string[];
};

export type ResearchSearchResponse = {
  provider: ResearchProvider;
  total: number;
  offset: number;
  next_offset: number | null;
  data: ResearchPaper[];
};

export type CitationGraphDirection = 'citations' | 'references';

export type ResearchGraphEntry = {
  contexts: string[];
  intents: string[];
  is_influential: boolean;
  paper: ResearchPaper;
};

export type ResearchGraphResponse = {
  provider: ResearchProvider;
  direction: CitationGraphDirection;
  paper_id: string;
  offset: number;
  next_offset: number | null;
  data: ResearchGraphEntry[];
};

export type ResearchRecommendationsResponse = {
  provider: ResearchProvider;
  paper_id: string;
  data: ResearchPaper[];
};

export type ClaimVerdict =
  | 'supported'
  | 'contradicted'
  | 'mixed'
  | 'insufficient';

export type EvidenceStance = 'supports' | 'contradicts' | 'context';

export type EvidenceKind =
  | 'title'
  | 'abstract'
  | 'body'
  | 'citation_context';

export type ClaimEvidenceProvenance = {
  provider: string;
  endpoint: string;
  provider_id: string | null;
};

export type ClaimEvidenceFinding = {
  evidence_id: string;
  stance: EvidenceStance;
  explanation: string;
  excerpt: string;
  kind: EvidenceKind;
  paper_id: string | null;
  corpus_id: number | null;
  title: string | null;
  authors: string | null;
  year: number | null;
  url: string | null;
  score: number | null;
  license: string | null;
  open_access_status: string | null;
  disclaimer: string | null;
  provenance: ClaimEvidenceProvenance[];
};

export type ClaimAssessment = {
  claim: string;
  verdict: ClaimVerdict;
  confidence: number;
  rationale: string;
  evidence: ClaimEvidenceFinding[];
  limitations: string[];
  provider: ResearchProvider;
  disclaimer: string;
};

export type SemanticScholarSearchParams = {
  query: string;
  limit?: number;
  offset?: number;
  year?: string;
  publicationDateOrYear?: string;
  publicationTypes?: string[];
  openAccessOnly?: boolean;
  minCitationCount?: number;
  venues?: string[];
  fieldsOfStudy?: string[];
};

export type SemanticScholarGraphParams = {
  paperId: string;
  direction: CitationGraphDirection;
  limit?: number;
  offset?: number;
};

export type SemanticScholarRecommendationsParams = {
  paperId: string;
  limit?: number;
};

export type SemanticScholarClaimAssessmentParams = {
  claim: string;
  limit?: number;
  year?: string;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteIntegerOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

function integerInRangeOrNull(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= minimum && value <= maximum ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(stringOrNull)
    .filter((item): item is string => item !== null);
}

function normalizeExternalIds(value: unknown): Record<string, string> {
  if (!isUnknownRecord(value)) return {};
  const normalized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const id = stringOrNull(raw);
    if (id) normalized[key] = id;
  }
  return normalized;
}

function normalizeAuthors(value: unknown): ResearchAuthor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!isUnknownRecord(raw)) return [];
    const name = stringOrNull(raw.name);
    if (!name) return [];
    return [{
      author_id: stringOrNull(raw.author_id),
      name,
    }];
  });
}

function normalizeOpenAccessPdf(value: unknown): OpenAccessPdf | null {
  if (!isUnknownRecord(value)) return null;
  const normalized = {
    url: stringOrNull(value.url),
    status: stringOrNull(value.status),
    license: stringOrNull(value.license),
    disclaimer: stringOrNull(value.disclaimer),
  };
  return Object.values(normalized).some(Boolean) ? normalized : null;
}

function normalizeTldr(value: unknown): string | null {
  if (typeof value === 'string') return stringOrNull(value);
  return isUnknownRecord(value) ? stringOrNull(value.text) : null;
}

export function normalizeResearchPaper(value: unknown): ResearchPaper | null {
  if (!isUnknownRecord(value)) return null;
  const paperId = stringOrNull(value.paper_id);
  const title = stringOrNull(value.title);
  if (!paperId || !title) return null;

  const openAccessPdf = normalizeOpenAccessPdf(value.open_access_pdf);
  return {
    provider: 'semantic_scholar',
    paper_id: paperId,
    corpus_id: finiteIntegerOrNull(value.corpus_id),
    external_ids: normalizeExternalIds(value.external_ids),
    title,
    abstract: stringOrNull(value.abstract),
    url: stringOrNull(value.url),
    pdf_url: stringOrNull(value.pdf_url) ?? openAccessPdf?.url ?? null,
    authors: normalizeAuthors(value.authors),
    year: finiteIntegerOrNull(value.year),
    publication_date: stringOrNull(value.publication_date),
    venue: stringOrNull(value.venue),
    citation_count: finiteIntegerOrNull(value.citation_count),
    influential_citation_count: finiteIntegerOrNull(value.influential_citation_count),
    reference_count: finiteIntegerOrNull(value.reference_count),
    is_open_access: value.is_open_access === true,
    open_access_pdf: openAccessPdf,
    tldr: normalizeTldr(value.tldr),
    publication_types: stringArray(value.publication_types),
    fields_of_study: stringArray(value.fields_of_study),
  };
}

function normalizePapers(value: unknown): ResearchPaper[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeResearchPaper)
    .filter((paper): paper is ResearchPaper => paper !== null);
}

function normalizeClaimVerdict(value: unknown): ClaimVerdict | null {
  return value === 'supported'
    || value === 'contradicted'
    || value === 'mixed'
    || value === 'insufficient'
    ? value
    : null;
}

function normalizeEvidenceStance(value: unknown): EvidenceStance | null {
  return value === 'supports'
    || value === 'contradicts'
    || value === 'context'
    ? value
    : null;
}

function normalizeEvidenceKind(value: unknown): EvidenceKind | null {
  return value === 'title'
    || value === 'abstract'
    || value === 'body'
    || value === 'citation_context'
    ? value
    : null;
}

function normalizeClaimEvidenceProvenance(
  value: unknown,
): ClaimEvidenceProvenance | null {
  if (!isUnknownRecord(value)) return null;
  const provider = stringOrNull(value.provider);
  const endpoint = stringOrNull(value.endpoint);
  if (!provider || !endpoint) return null;
  return {
    provider,
    endpoint,
    provider_id: stringOrNull(value.provider_id),
  };
}

function normalizeClaimEvidenceProvenanceList(
  value: unknown,
): ClaimEvidenceProvenance[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeClaimEvidenceProvenance)
    .filter((item): item is ClaimEvidenceProvenance => item !== null);
}

function normalizeClaimEvidence(value: unknown): ClaimEvidenceFinding | null {
  if (!isUnknownRecord(value)) return null;
  const evidenceId = stringOrNull(value.evidence_id);
  const stance = normalizeEvidenceStance(value.stance);
  const explanation = stringOrNull(value.explanation);
  const excerpt = stringOrNull(value.excerpt);
  const kind = normalizeEvidenceKind(value.kind);
  if (!evidenceId || !stance || !explanation || !excerpt || !kind) return null;

  return {
    evidence_id: evidenceId,
    stance,
    explanation,
    excerpt,
    kind,
    paper_id: stringOrNull(value.paper_id),
    corpus_id: integerInRangeOrNull(
      value.corpus_id,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    title: stringOrNull(value.title),
    authors: stringOrNull(value.authors),
    year: integerInRangeOrNull(value.year, 0, 9_999),
    url: stringOrNull(value.url),
    score: finiteNumberOrNull(value.score),
    license: stringOrNull(value.license),
    open_access_status: stringOrNull(value.open_access_status),
    disclaimer: stringOrNull(value.disclaimer),
    provenance: normalizeClaimEvidenceProvenanceList(value.provenance),
  };
}

export function normalizeClaimAssessment(value: unknown): ClaimAssessment | null {
  if (!isUnknownRecord(value)) return null;
  const claim = stringOrNull(value.claim);
  const verdict = normalizeClaimVerdict(value.verdict);
  const confidence = finiteNumberOrNull(value.confidence);
  const rationale = stringOrNull(value.rationale);
  const disclaimer = stringOrNull(value.disclaimer);
  if (
    !claim
    || !verdict
    || confidence === null
    || confidence < 0
    || confidence > 1
    || !rationale
    || !disclaimer
  ) {
    return null;
  }

  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .map(normalizeClaimEvidence)
        .filter((finding): finding is ClaimEvidenceFinding => finding !== null)
    : [];
  return {
    claim,
    verdict,
    confidence,
    rationale,
    evidence,
    limitations: stringArray(value.limitations),
    provider: 'semantic_scholar',
    disclaimer,
  };
}

function queryString(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.toString();
}

function boundedFilter(
  value: string | undefined,
  label: string,
  maximumLength: number,
): string | undefined {
  const normalized = stringOrNull(value) ?? undefined;
  if (normalized && normalized.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength.toLocaleString()} characters or fewer`);
  }
  return normalized;
}

function csvFilter(
  values: string[] | undefined,
  label: string,
  maximumLength: number,
): string | undefined {
  if (!values) return undefined;
  const seen = new Set<string>();
  const normalized = values.flatMap((value) => {
    const item = stringOrNull(value);
    if (!item) return [];
    const identity = item.toLocaleLowerCase();
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [item];
  });
  return boundedFilter(normalized.join(','), label, maximumLength);
}

function positiveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function nonNegativeOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

export async function searchSemanticScholar(
  params: SemanticScholarSearchParams,
): Promise<ResearchSearchResponse> {
  const query = params.query.trim();
  if (!query) throw new Error('Search query is required');
  const limit = positiveLimit(params.limit, 20);
  const offset = nonNegativeOffset(params.offset);
  const year = boundedFilter(params.year, 'Year filter', 64);
  const publicationDateOrYear = boundedFilter(
    params.publicationDateOrYear,
    'Publication date or year filter',
    64,
  );
  const publicationTypes = csvFilter(
    params.publicationTypes,
    'Publication types filter',
    1_024,
  );
  const venues = csvFilter(params.venues, 'Venues filter', 2_048);
  const fieldsOfStudy = csvFilter(
    params.fieldsOfStudy,
    'Fields of study filter',
    2_048,
  );
  const minCitationCount =
    params.minCitationCount === undefined || !Number.isFinite(params.minCitationCount)
      ? undefined
      : Math.max(0, Math.min(100_000_000, Math.trunc(params.minCitationCount)));
  const payload = await get<unknown>(
    `${SEMANTIC_SCHOLAR_BASE}/search?${queryString({
      query,
      limit,
      offset,
      year,
      publication_date_or_year: publicationDateOrYear,
      publication_types: publicationTypes,
      open_access_only: params.openAccessOnly ? true : undefined,
      min_citation_count: minCitationCount,
      venues,
      fields_of_study: fieldsOfStudy,
    })}`,
  );
  const record = isUnknownRecord(payload) ? payload : {};
  return {
    provider: 'semantic_scholar',
    total: finiteIntegerOrNull(record.total) ?? 0,
    offset: finiteIntegerOrNull(record.offset) ?? offset,
    next_offset: finiteIntegerOrNull(record.next_offset),
    data: normalizePapers(record.data),
  };
}

export async function getSemanticScholarPaper(paperId: string): Promise<ResearchPaper> {
  const id = paperId.trim();
  if (!id) throw new Error('Paper id is required');
  const payload = await get<unknown>(
    `${SEMANTIC_SCHOLAR_BASE}/paper?${queryString({ paper_id: id })}`,
  );
  const candidate = isUnknownRecord(payload) && 'data' in payload ? payload.data : payload;
  const paper = normalizeResearchPaper(candidate);
  if (!paper) throw new Error('Semantic Scholar returned an invalid paper');
  return paper;
}

export async function getSemanticScholarGraph(
  params: SemanticScholarGraphParams,
): Promise<ResearchGraphResponse> {
  const paperId = params.paperId.trim();
  if (!paperId) throw new Error('Paper id is required');
  const limit = positiveLimit(params.limit, 20);
  const offset = nonNegativeOffset(params.offset);
  const payload = await get<unknown>(
    `${SEMANTIC_SCHOLAR_BASE}/graph?${queryString({
      paper_id: paperId,
      direction: params.direction,
      limit,
      offset,
    })}`,
  );
  const record = isUnknownRecord(payload) ? payload : {};
  const entries = Array.isArray(record.data)
    ? record.data.flatMap((raw): ResearchGraphEntry[] => {
        if (!isUnknownRecord(raw)) return [];
        const paper = normalizeResearchPaper(raw.paper);
        if (!paper) return [];
        return [{
          contexts: stringArray(raw.contexts),
          intents: stringArray(raw.intents),
          is_influential: raw.is_influential === true,
          paper,
        }];
      })
    : [];
  return {
    provider: 'semantic_scholar',
    direction: params.direction,
    paper_id: stringOrNull(record.paper_id) ?? paperId,
    offset: finiteIntegerOrNull(record.offset) ?? offset,
    next_offset: finiteIntegerOrNull(record.next_offset),
    data: entries,
  };
}

export async function getSemanticScholarRecommendations(
  params: SemanticScholarRecommendationsParams,
): Promise<ResearchRecommendationsResponse> {
  const paperId = params.paperId.trim();
  if (!paperId) throw new Error('Paper id is required');
  const limit = positiveLimit(params.limit, 20);
  const payload = await get<unknown>(
    `${SEMANTIC_SCHOLAR_BASE}/recommendations?${queryString({
      paper_id: paperId,
      limit,
    })}`,
  );
  const record = isUnknownRecord(payload) ? payload : {};
  return {
    provider: 'semantic_scholar',
    paper_id: stringOrNull(record.paper_id) ?? paperId,
    data: normalizePapers(record.data),
  };
}

export async function assessSemanticScholarClaim(
  params: SemanticScholarClaimAssessmentParams,
): Promise<ClaimAssessment> {
  const claim = params.claim.trim();
  if (!claim) throw new Error('Claim is required');
  if (claim.length > 2_000) throw new Error('Claim must be 2,000 characters or fewer');

  const year = stringOrNull(params.year);
  if (year && year.length > 64) {
    throw new Error('Year filter must be 64 characters or fewer');
  }
  const limit = params.limit === undefined || !Number.isFinite(params.limit)
    ? 8
    : Math.max(1, Math.min(12, Math.trunc(params.limit)));
  const payload = await post<unknown>(
    `${SEMANTIC_SCHOLAR_BASE}/claim-assessment`,
    {
      claim,
      limit,
      ...(year ? { year } : {}),
    },
  );
  const assessment = normalizeClaimAssessment(payload);
  if (!assessment) {
    throw new Error('Semantic Scholar returned an invalid claim assessment');
  }
  return assessment;
}

export function researchAuthorsLabel(paper: ResearchPaper): string | null {
  return paper.authors.length ? paper.authors.map((author) => author.name).join(', ') : null;
}

export function researchExternalId(
  paper: ResearchPaper,
  name: string,
): string | null {
  const target = name.toLocaleLowerCase();
  const entry = Object.entries(paper.external_ids).find(
    ([key]) => key.toLocaleLowerCase() === target,
  );
  return entry?.[1] ?? null;
}
