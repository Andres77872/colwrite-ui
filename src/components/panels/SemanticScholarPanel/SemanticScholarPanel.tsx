import { useRef, useState } from 'react';
import {
  assessSemanticScholarClaim,
  getSemanticScholarGraph,
  getSemanticScholarRecommendations,
  researchAuthorsLabel,
  researchExternalId,
  searchSemanticScholar,
  type CitationGraphDirection,
  type ClaimAssessment,
  type ClaimEvidenceFinding,
  type ClaimVerdict,
  type ResearchGraphEntry,
  type ResearchPaper,
  type SemanticScholarSearchParams,
} from '@/services/semanticScholar';
import semanticScholarMark from '@/assets/semantic-scholar-mark.svg';
import { AlertCircle, ExternalLink, Network, SearchX, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { safeExternalHttpUrl } from '@/lib/url';
import { PaperCard, SearchForm, useExpandable } from '../shared';

type ExplorationMode = CitationGraphDirection | 'recommendations';

type ExplorationItem = {
  paper: ResearchPaper;
  contexts: string[];
  intents: string[];
  isInfluential: boolean;
};

type Exploration = {
  source: ResearchPaper;
  mode: ExplorationMode;
  items: ExplorationItem[];
  nextOffset: number | null;
  loading: boolean;
  error: string | null;
};

type Assessment = {
  claim: string;
  result: ClaimAssessment | null;
  loading: boolean;
  error: string | null;
};

const VERDICT_LABELS: Record<ClaimVerdict, string> = {
  supported: 'Supported',
  contradicted: 'Contradicted',
  mixed: 'Mixed',
  insufficient: 'Insufficient evidence',
};

const VERDICT_VARIANTS: Record<
  ClaimVerdict,
  'success' | 'destructive' | 'warning' | 'secondary'
> = {
  supported: 'success',
  contradicted: 'destructive',
  mixed: 'warning',
  insufficient: 'secondary',
};

const STANCE_LABELS: Record<ClaimEvidenceFinding['stance'], string> = {
  supports: 'Supports',
  contradicts: 'Contradicts',
  context: 'Context',
};

const STANCE_VARIANTS: Record<
  ClaimEvidenceFinding['stance'],
  'success' | 'destructive' | 'secondary'
> = {
  supports: 'success',
  contradicts: 'destructive',
  context: 'secondary',
};

function modeLabel(mode: ExplorationMode): string {
  if (mode === 'citations') return 'Papers that cite this work';
  if (mode === 'references') return 'References used by this work';
  return 'Recommended related papers';
}

function graphItem(entry: ResearchGraphEntry): ExplorationItem {
  return {
    paper: entry.paper,
    contexts: entry.contexts,
    intents: entry.intents,
    isInfluential: entry.is_influential,
  };
}

function paperMeta(paper: ResearchPaper): Array<string | null> {
  const date = paper.publication_date ?? (paper.year === null ? null : String(paper.year));
  const citations =
    paper.citation_count === null ? null : `${paper.citation_count.toLocaleString()} citations`;
  return [date, paper.venue, citations];
}

function paperSummary(paper: ResearchPaper): string | null {
  if (paper.abstract) return `Abstract: ${paper.abstract}`;
  if (paper.tldr) return `Semantic Scholar TLDR: ${paper.tldr}`;
  return null;
}

function paperIdentity(paper: ResearchPaper): string {
  return `${paper.provider}:${paper.paper_id}`;
}

function deduplicatePapers(papers: ResearchPaper[]): ResearchPaper[] {
  const seen = new Set<string>();
  return papers.filter((paper) => {
    const identity = paperIdentity(paper);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function commaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function evidenceScoreLabel(score: number): string {
  return score.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function CitationContexts({
  contexts,
  paperTitle,
}: {
  contexts: string[];
  paperTitle: string;
}) {
  if (contexts.length === 0) return null;
  return (
    <details className="mt-1 text-[11px]">
      <summary
        className="cursor-pointer rounded-sm font-medium text-foreground/80"
        aria-label={`Show ${contexts.length} citation context${contexts.length === 1 ? '' : 's'} for ${paperTitle}`}
      >
        Citation contexts ({contexts.length})
      </summary>
      <ol className="mt-1 max-h-32 list-decimal space-y-1 overflow-y-auto pl-5 pr-1 text-foreground/80">
        {contexts.map((context, index) => (
          <li key={`${index}:${context}`}>
            <blockquote className="leading-relaxed">
              Evidence candidate: “{context}”
            </blockquote>
          </li>
        ))}
      </ol>
    </details>
  );
}

function PaperProviderBadge({ paper }: { paper: ResearchPaper }) {
  if (!paper.is_open_access && paper.citation_count === null) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {paper.is_open_access && <Badge variant="secondary">Open access</Badge>}
      {paper.citation_count !== null && (
        <Badge variant="secondary" className="tabular-nums">
          {paper.citation_count.toLocaleString()} cited
        </Badge>
      )}
    </div>
  );
}

function openAccessNotice(paper: ResearchPaper) {
  const license = paper.open_access_pdf?.license;
  const disclaimer = paper.open_access_pdf?.disclaimer;
  if (!license && !disclaimer) return null;
  return (
    <p aria-label="Open-access terms">
      {license && <span>Open-access license: {license}. </span>}
      {disclaimer && <span>{disclaimer}</span>}
    </p>
  );
}

function EvidenceFinding({ finding }: { finding: ClaimEvidenceFinding }) {
  const sourceLabel =
    finding.title ?? finding.paper_id ?? finding.corpus_id?.toString() ?? finding.evidence_id;
  const sourceUrl = safeExternalHttpUrl(finding.url);
  const metadata = [
    finding.authors,
    finding.year === null ? null : String(finding.year),
    finding.kind.replaceAll('_', ' '),
  ].filter(Boolean);

  return (
    <li className="space-y-1.5 rounded-md border border-border/70 bg-background/60 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-xs font-medium">
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex max-w-full items-center gap-1 rounded-sm text-primary hover:underline"
              aria-label={`Open evidence source: ${sourceLabel}`}
            >
              <span className="truncate">{sourceLabel}</span>
              <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            sourceLabel
          )}
        </div>
        <Badge variant={STANCE_VARIANTS[finding.stance]} className="shrink-0">
          {STANCE_LABELS[finding.stance]}
        </Badge>
      </div>
      {metadata.length > 0 && (
        <p className="text-[10px] capitalize text-muted-foreground">
          {metadata.join(' · ')}
        </p>
      )}
      {finding.score !== null && (
        <p
          aria-label="Evidence relevance score"
          className="text-[10px] tabular-nums text-muted-foreground"
        >
          Retrieval relevance: {evidenceScoreLabel(finding.score)} (not claim confidence)
        </p>
      )}
      <blockquote className="border-l-2 border-primary/30 pl-2 text-xs leading-relaxed text-foreground/85">
        “{finding.excerpt}”
      </blockquote>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {finding.explanation}
      </p>
      {finding.provenance.length > 0 && (
        <details className="text-[10px] text-muted-foreground">
          <summary className="cursor-pointer rounded-sm font-medium">
            Provenance ({finding.provenance.length})
          </summary>
          <ul
            className="mt-1 max-h-24 space-y-1 overflow-y-auto pl-3"
            aria-label="Evidence provenance"
          >
            {finding.provenance.map((source, index) => (
              <li
                key={`${source.provider}:${source.endpoint}:${source.provider_id ?? ''}:${index}`}
                className="break-words"
              >
                {source.provider} · {source.endpoint}
                {source.provider_id ? ` · ${source.provider_id}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {(finding.license || finding.open_access_status || finding.disclaimer) && (
        <p aria-label="Evidence source terms" className="text-[10px] leading-relaxed text-muted-foreground">
          {finding.open_access_status && (
            <span>Open-access status: {finding.open_access_status}. </span>
          )}
          {finding.license && <span>License: {finding.license}. </span>}
          {finding.disclaimer}
        </p>
      )}
    </li>
  );
}

function ClaimAssessmentResult({ assessment }: { assessment: ClaimAssessment }) {
  const confidence = Math.round(assessment.confidence * 100);
  return (
    <section
      className="space-y-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3"
      aria-label="Claim assessment"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant={VERDICT_VARIANTS[assessment.verdict]}>
          {VERDICT_LABELS[assessment.verdict]}
        </Badge>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          Assessment confidence: {confidence}%
        </span>
      </div>
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Claim assessed
        </p>
        <p className="mt-0.5 text-xs leading-relaxed">{assessment.claim}</p>
      </div>
      <p className="text-xs leading-relaxed text-foreground/85">{assessment.rationale}</p>

      <div>
        <h3 className="mb-1.5 text-xs font-semibold">Retrieved evidence</h3>
        {assessment.evidence.length > 0 ? (
          <ol className="space-y-2">
            {assessment.evidence.map((finding) => (
              <EvidenceFinding key={finding.evidence_id} finding={finding} />
            ))}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground">
            No source excerpt was selected for this assessment.
          </p>
        )}
      </div>

      {assessment.limitations.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold">Limitations</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
            {assessment.limitations.map((limitation, index) => (
              <li key={`${index}:${limitation}`}>{limitation}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-border/70 pt-2 text-[10px] leading-relaxed text-muted-foreground">
        {assessment.disclaimer}
      </p>
    </section>
  );
}

export function SemanticScholarPanel() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState<ResearchPaper[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [limit, setLimit] = useState(20);
  const [year, setYear] = useState('');
  const [openAccessOnly, setOpenAccessOnly] = useState(false);
  const [minCitationCount, setMinCitationCount] = useState('');
  const [fieldsOfStudy, setFieldsOfStudy] = useState('');
  const [claimYear, setClaimYear] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exploration, setExploration] = useState<Exploration | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const requestSequence = useRef(0);
  const activeSearch = useRef<SemanticScholarSearchParams | null>(null);
  const explorationSequence = useRef(0);
  const assessmentSequence = useRef(0);
  const { isExpanded, toggle, reset } = useExpandable();

  async function onSearch() {
    const trimmed = query.trim();
    if (!trimmed || loading) return;
    const parsedMinimum = Number.parseInt(minCitationCount, 10);
    const selectedFields = commaSeparatedValues(fieldsOfStudy);
    const params: SemanticScholarSearchParams = {
      query: trimmed,
      limit,
      ...(year.trim() ? { year: year.trim() } : {}),
      ...(openAccessOnly ? { openAccessOnly: true } : {}),
      ...(minCitationCount.trim() && Number.isFinite(parsedMinimum)
        ? { minCitationCount: Math.max(0, parsedMinimum) }
        : {}),
      ...(selectedFields.length ? { fieldsOfStudy: selectedFields } : {}),
    };
    const sequence = ++requestSequence.current;
    activeSearch.current = params;
    setLoading(true);
    setLoadingMore(false);
    setNextOffset(null);
    setError(null);
    explorationSequence.current += 1;
    setExploration(null);
    reset();
    try {
      const response = await searchSemanticScholar(params);
      if (requestSequence.current !== sequence) return;
      setResults(deduplicatePapers(response.data));
      setTotal(response.total);
      setNextOffset(response.next_offset);
      setSubmittedQuery(trimmed);
    } catch (err) {
      if (requestSequence.current !== sequence) return;
      activeSearch.current = null;
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
      setTotal(0);
      setNextOffset(null);
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  }

  async function onLoadMore() {
    const params = activeSearch.current;
    const offset = nextOffset;
    if (!params || offset === null || loading || loadingMore) return;
    const sequence = ++requestSequence.current;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await searchSemanticScholar({ ...params, offset });
      if (requestSequence.current !== sequence) return;
      setResults((current) => deduplicatePapers([...current, ...response.data]));
      setTotal(response.total);
      setNextOffset(response.next_offset);
    } catch (err) {
      if (requestSequence.current !== sequence) return;
      setError(err instanceof Error ? err.message : 'Could not load more papers');
    } finally {
      if (requestSequence.current === sequence) setLoadingMore(false);
    }
  }

  async function explore(
    source: ResearchPaper,
    mode: ExplorationMode,
    append = false,
  ) {
    const sequence = ++explorationSequence.current;
    const current =
      exploration?.source.paper_id === source.paper_id && exploration.mode === mode
        ? exploration
        : null;
    const offset = append ? current?.nextOffset : 0;
    if (append && offset === null) return;

    setExploration({
      source,
      mode,
      items: append ? current?.items ?? [] : [],
      nextOffset: append ? current?.nextOffset ?? null : null,
      loading: true,
      error: null,
    });

    try {
      if (mode === 'recommendations') {
        const response = await getSemanticScholarRecommendations({
          paperId: source.paper_id,
          limit,
        });
        if (explorationSequence.current !== sequence) return;
        setExploration({
          source,
          mode,
          items: response.data.map((paper) => ({
            paper,
            contexts: [],
            intents: [],
            isInfluential: false,
          })),
          nextOffset: null,
          loading: false,
          error: null,
        });
        return;
      }

      const response = await getSemanticScholarGraph({
        paperId: source.paper_id,
        direction: mode,
        limit,
        offset: offset ?? 0,
      });
      if (explorationSequence.current !== sequence) return;
      setExploration({
        source,
        mode,
        items: [
          ...(append ? current?.items ?? [] : []),
          ...response.data.map(graphItem),
        ],
        nextOffset: response.next_offset,
        loading: false,
        error: null,
      });
    } catch (err) {
      if (explorationSequence.current !== sequence) return;
      setExploration({
        source,
        mode,
        items: append ? current?.items ?? [] : [],
        nextOffset: append ? current?.nextOffset ?? null : null,
        loading: false,
        error: err instanceof Error ? err.message : 'Could not load the paper graph',
      });
    }
  }

  async function onAssessClaim() {
    const claim = query.trim();
    if (!claim) return;
    const sequence = ++assessmentSequence.current;
    setAssessment({ claim, result: null, loading: true, error: null });
    try {
      const result = await assessSemanticScholarClaim({
        claim,
        limit: Math.min(limit, 12),
        ...(claimYear.trim() ? { year: claimYear.trim() } : {}),
      });
      if (assessmentSequence.current !== sequence) return;
      setAssessment({ claim, result, loading: false, error: null });
    } catch (err) {
      if (assessmentSequence.current !== sequence) return;
      setAssessment({
        claim,
        result: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Claim assessment failed',
      });
    }
  }

  const hasResults = results.length > 0;
  const activeFilterCount = [
    Boolean(year.trim()),
    openAccessOnly,
    Boolean(minCitationCount.trim()),
    Boolean(fieldsOfStudy.trim()),
  ].filter(Boolean).length;

  return (
    <div className="flex h-full flex-col gap-3" aria-busy={loading || loadingMore}>
      <SearchForm
        query={query}
        onQueryChange={setQuery}
        limit={limit}
        onLimitChange={setLimit}
        onSubmit={onSearch}
        loading={loading}
        placeholder="Search Semantic Scholar…"
        label="Semantic Scholar results"
      />

      <details className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5">
        <summary className="cursor-pointer rounded-sm text-xs font-medium">
          Search filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-2 tabular-nums">
              {activeFilterCount} active
            </Badge>
          )}
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="space-y-1 text-[10px] font-medium text-muted-foreground">
            <span>Year or range</span>
            <Input
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="2020-2026"
              maxLength={64}
              disabled={loading}
              aria-label="Publication year filter"
              className="h-8 text-xs"
            />
          </label>
          <label className="space-y-1 text-[10px] font-medium text-muted-foreground">
            <span>Minimum citations</span>
            <Input
              type="number"
              min={0}
              max={100_000_000}
              step={1}
              value={minCitationCount}
              onChange={(event) => setMinCitationCount(event.target.value)}
              placeholder="0"
              disabled={loading}
              aria-label="Minimum citation count"
              className="h-8 text-xs"
            />
          </label>
          <label className="col-span-2 space-y-1 text-[10px] font-medium text-muted-foreground">
            <span>Fields of study (comma-separated)</span>
            <Input
              value={fieldsOfStudy}
              onChange={(event) => setFieldsOfStudy(event.target.value)}
              placeholder="Medicine, Computer Science"
              disabled={loading}
              aria-label="Fields of study filter"
              className="h-8 text-xs"
            />
          </label>
          <label className="col-span-2 flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={openAccessOnly}
              onCheckedChange={(checked) => setOpenAccessOnly(checked === true)}
              disabled={loading}
              aria-label="Open-access papers only"
            />
            Open-access papers only
          </label>
        </div>
      </details>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Enter one precise claim to assess it against retrieved source excerpts.
          </p>
          <label className="mt-1 block max-w-36 space-y-1 text-[10px] font-medium text-muted-foreground">
            <span>Claim year (optional)</span>
            <Input
              value={claimYear}
              onChange={(event) => setClaimYear(event.target.value)}
              placeholder="2020-2026"
              maxLength={64}
              aria-label="Claim assessment year"
              className="h-8 text-xs"
            />
          </label>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void onAssessClaim()}
          disabled={!query.trim()}
          aria-label="Assess entered text as a claim"
          aria-busy={assessment?.loading || undefined}
        >
          {assessment?.loading && <Spinner />}
          {assessment?.loading ? 'Assessing…' : 'Assess claim'}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {hasResults && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Showing {results.length} of {total.toLocaleString()} paper{total === 1 ? '' : 's'}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {assessment?.loading && (
          <div
            className="flex items-center justify-center gap-2 rounded-lg border border-border py-5 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <Spinner />
            Assessing “{assessment.claim}”…
          </div>
        )}

        {assessment?.error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{assessment.error}</span>
          </div>
        )}

        {assessment?.result && <ClaimAssessmentResult assessment={assessment.result} />}

        {results.map((paper, index) => {
          const key = `semantic-scholar:${paper.paper_id}`;
          const doi = researchExternalId(paper, 'DOI');
          return (
            <PaperCard
              key={key}
              index={index + 1}
              title={paper.title}
              url={paper.url}
              primaryLinkLabel="Semantic Scholar"
              authors={researchAuthorsLabel(paper)}
              meta={paperMeta(paper)}
              abstract={paperSummary(paper)}
              badge={<PaperProviderBadge paper={paper} />}
              notice={openAccessNotice(paper)}
              pdfUrl={paper.pdf_url}
              doi={doi}
              expanded={isExpanded(key)}
              onToggleExpanded={() => toggle(key)}
              actions={
                <>
                  <button
                    type="button"
                    className="rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => void explore(paper, 'citations')}
                    aria-label={`Show citations for ${paper.title}`}
                  >
                    Citations
                  </button>
                  <button
                    type="button"
                    className="rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => void explore(paper, 'references')}
                    aria-label={`Show references for ${paper.title}`}
                  >
                    References
                  </button>
                  <button
                    type="button"
                    className="rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => void explore(paper, 'recommendations')}
                    aria-label={`Show related papers for ${paper.title}`}
                  >
                    Related
                  </button>
                </>
              }
            />
          );
        })}

        {hasResults && nextOffset !== null && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => void onLoadMore()}
            disabled={loading || loadingMore}
            aria-busy={loadingMore || undefined}
          >
            {loadingMore && <Spinner />}
            {loadingMore ? 'Loading more papers…' : 'Load more papers'}
          </Button>
        )}

        {exploration && (
          <section
            className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5"
            aria-label={modeLabel(exploration.mode)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-xs font-semibold">{modeLabel(exploration.mode)}</h3>
                <p className="truncate text-[11px] text-muted-foreground">
                  {exploration.source.title}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  explorationSequence.current += 1;
                  setExploration(null);
                }}
                aria-label={`Close ${modeLabel(exploration.mode)} for ${exploration.source.title}`}
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            </div>

            {exploration.error && (
              <p role="alert" className="text-xs text-destructive">
                {exploration.error}
              </p>
            )}

            {exploration.items.map((entry, index) => {
              const paper = entry.paper;
              const key = `graph:${exploration.mode}:${paper.paper_id}:${index}`;
              return (
                <div key={key} className="space-y-1">
                  <PaperCard
                    index={index + 1}
                    title={paper.title}
                    url={paper.url}
                    primaryLinkLabel="Semantic Scholar"
                    authors={researchAuthorsLabel(paper)}
                    meta={paperMeta(paper)}
                    abstract={paperSummary(paper)}
                    badge={
                      entry.isInfluential ? <Badge variant="secondary">Influential</Badge> : null
                    }
                    notice={openAccessNotice(paper)}
                    pdfUrl={paper.pdf_url}
                    doi={researchExternalId(paper, 'DOI')}
                    expanded={isExpanded(key)}
                    onToggleExpanded={() => toggle(key)}
                  />
                  {(entry.intents.length > 0 || entry.contexts.length > 0) && (
                    <div className="rounded-md border border-border/60 bg-background/50 px-2 py-1.5">
                      {entry.intents.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          Citation intent: {entry.intents.join(', ')}
                        </p>
                      )}
                      <CitationContexts
                        contexts={entry.contexts}
                        paperTitle={paper.title}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {exploration.loading && (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                <Spinner />
                Loading graph…
              </div>
            )}

            {!exploration.loading &&
              !exploration.error &&
              exploration.items.length === 0 && (
                <p className="py-3 text-center text-xs text-muted-foreground">
                  No papers were returned for this graph.
                </p>
              )}

            {!exploration.loading && exploration.nextOffset !== null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void explore(exploration.source, exploration.mode, true)}
              >
                Load more
              </Button>
            )}
          </section>
        )}

        {!loading && !hasResults && !error && submittedQuery && (
          <EmptyState
            icon={SearchX}
            title="No papers found"
            description={`Nothing matched “${submittedQuery}”. Try broader keywords.`}
          />
        )}

        {!loading && !hasResults && !error && !submittedQuery && (
          <EmptyState
            icon={Network}
            title="Search Semantic Scholar"
            description="Find papers, inspect citation links, and discover related work."
          />
        )}
      </div>

      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <img
          src={semanticScholarMark}
          alt=""
          aria-hidden="true"
          className="h-3.5 w-auto shrink-0"
        />
        Metadata and citation graph provided by{' '}
        <a
          href="https://www.semanticscholar.org/?utm_source=api"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Provider attribution"
          className="rounded-sm underline-offset-2 hover:underline"
        >
          Semantic Scholar
        </a>
        .
      </p>
    </div>
  );
}
