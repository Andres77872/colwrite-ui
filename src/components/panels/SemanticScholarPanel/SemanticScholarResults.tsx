import {
  researchAuthorsLabel,
  researchExternalId,
  type ClaimAssessment,
  type ClaimEvidenceFinding,
  type ClaimVerdict,
  type ResearchPaper,
} from '@/services/semanticScholar';
import semanticScholarMark from '@/assets/semantic-scholar-mark.svg';
import { ArrowLeft, ExternalLink, GitFork, Network, Quote, Scale, SearchX, Sparkles } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { safeExternalHttpUrl } from '@/lib/url';
import { yearOf } from '@/editor';
import { Disclosure, PaperRow, sourceFromSemanticScholar } from '../shared';
import { ResultList } from '../ResearchPanel/PaperResults';
import type { ExplorationMode, SemanticScholarState } from './useSemanticScholar';

const VERDICT_LABELS: Record<ClaimVerdict, string> = {
  supported: 'Supported',
  contradicted: 'Contradicted',
  mixed: 'Mixed',
  insufficient: 'Insufficient evidence',
};

const VERDICT_VARIANTS: Record<ClaimVerdict, 'success' | 'destructive' | 'warning' | 'secondary'> = {
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

const STANCE_VARIANTS: Record<ClaimEvidenceFinding['stance'], 'success' | 'destructive' | 'secondary'> = {
  supports: 'success',
  contradicts: 'destructive',
  context: 'secondary',
};

function modeLabel(mode: ExplorationMode): string {
  if (mode === 'citations') return 'Papers that cite this work';
  if (mode === 'references') return 'References used by this work';
  return 'Recommended related papers';
}

function paperMeta(paper: ResearchPaper): Array<string | null> {
  const date = paper.year === null ? yearOf(paper.publication_date) ?? null : String(paper.year);
  const citations =
    paper.citation_count === null ? null : `${paper.citation_count.toLocaleString()} citations`;
  return [date, paper.venue, citations];
}

function paperSummary(paper: ResearchPaper): string | null {
  if (paper.abstract) return paper.abstract;
  if (paper.tldr) return `Semantic Scholar TLDR: ${paper.tldr}`;
  return null;
}

function evidenceScoreLabel(score: number): string {
  return score.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function OpenAccessNotice({ paper }: { paper: ResearchPaper }) {
  const license = paper.open_access_pdf?.license;
  const disclaimer = paper.open_access_pdf?.disclaimer;
  if (!license && !disclaimer) return null;
  return (
    <p aria-label="Open-access terms" className="text-2xs leading-relaxed">
      {license && <span>Open-access license: {license}. </span>}
      {disclaimer && <span>{disclaimer}</span>}
    </p>
  );
}

function CitationContexts({ contexts, paperTitle }: { contexts: string[]; paperTitle: string }) {
  if (contexts.length === 0) return null;
  return (
    <Disclosure
      className="text-xs"
      triggerClassName="text-muted-foreground"
      label={`Show ${contexts.length} citation context${contexts.length === 1 ? '' : 's'} for ${paperTitle}`}
      summary={`Citation contexts (${contexts.length})`}
    >
      <ol className="mt-1 max-h-32 list-decimal space-y-1 overflow-y-auto pl-5 pr-1 text-foreground/80">
        {contexts.map((context, index) => (
          <li key={`${index}:${context}`}>
            <blockquote className="leading-relaxed">Evidence candidate: “{context}”</blockquote>
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}

/** A Semantic Scholar paper as a row, with its citation graph behind "…". */
function S2PaperRow({
  paper,
  onExplore,
  children,
}: {
  paper: ResearchPaper;
  onExplore?: (mode: ExplorationMode) => void;
  children?: React.ReactNode;
}) {
  const doi = researchExternalId(paper, 'DOI');
  return (
    <PaperRow
      title={paper.title}
      authors={researchAuthorsLabel(paper)}
      meta={paperMeta(paper)}
      tag={paper.is_open_access ? 'Open access' : null}
      summary={paperSummary(paper)}
      source={sourceFromSemanticScholar(paper)}
      links={[
        { label: 'Open on Semantic Scholar', href: paper.url },
        { label: 'Open PDF', href: paper.pdf_url },
        { label: 'Open DOI', href: doi ? `https://doi.org/${doi}` : null },
      ]}
      menuItems={
        onExplore && (
          <>
            <DropdownMenuItem onSelect={() => onExplore('citations')}>
              <Quote aria-hidden="true" />
              Papers citing this
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExplore('references')}>
              <GitFork aria-hidden="true" />
              Its references
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExplore('recommendations')}>
              <Sparkles aria-hidden="true" />
              Related papers
            </DropdownMenuItem>
          </>
        )
      }
    >
      <OpenAccessNotice paper={paper} />
      {children}
    </PaperRow>
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
    <li className="space-y-1.5 border-t border-border py-2.5 first:border-t-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm font-medium">
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex max-w-full items-center gap-1 rounded-xs text-link hover:underline"
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
        <p className="text-xs capitalize text-muted-foreground">{metadata.join(' · ')}</p>
      )}
      <blockquote className="border-l-2 border-border-strong pl-2.5 text-sm leading-relaxed text-foreground">
        “{finding.excerpt}”
      </blockquote>
      <p className="text-xs leading-relaxed text-muted-foreground">{finding.explanation}</p>
      {finding.score !== null && (
        <p aria-label="Evidence relevance score" className="text-2xs tabular-nums text-muted-foreground">
          Retrieval relevance: {evidenceScoreLabel(finding.score)} (not claim confidence)
        </p>
      )}
      {finding.provenance.length > 0 && (
        <Disclosure
          className="text-2xs text-muted-foreground"
          summary={`Provenance (${finding.provenance.length})`}
        >
          <ul className="mt-1 max-h-24 space-y-1 overflow-y-auto pl-3" aria-label="Evidence provenance">
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
        </Disclosure>
      )}
      {(finding.license || finding.open_access_status || finding.disclaimer) && (
        <p aria-label="Evidence source terms" className="text-2xs leading-relaxed text-muted-foreground">
          {finding.open_access_status && <span>Open-access status: {finding.open_access_status}. </span>}
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
    <section className="space-y-3 px-2" aria-label="Claim assessment">
      <div className="rounded-lg bg-subtle p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant={VERDICT_VARIANTS[assessment.verdict]}>{VERDICT_LABELS[assessment.verdict]}</Badge>
          <span className="text-xs tabular-nums text-muted-foreground">
            Assessment confidence: {confidence}%
          </span>
        </div>
        <p className="mt-2 text-xs font-medium text-muted-foreground">Claim assessed</p>
        <p className="mt-0.5 text-sm leading-relaxed">{assessment.claim}</p>
        <p className="mt-2 text-sm leading-relaxed text-foreground">{assessment.rationale}</p>
      </div>

      <div>
        <h3 className="text-xs font-medium text-muted-foreground">Retrieved evidence</h3>
        {assessment.evidence.length > 0 ? (
          <ol>
            {assessment.evidence.map((finding) => (
              <EvidenceFinding key={finding.evidence_id} finding={finding} />
            ))}
          </ol>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            No source excerpt was selected for this assessment.
          </p>
        )}
      </div>

      {assessment.limitations.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">Limitations</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {assessment.limitations.map((limitation, index) => (
              <li key={`${index}:${limitation}`}>{limitation}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-border pt-2 text-2xs leading-relaxed text-muted-foreground">
        {assessment.disclaimer}
      </p>
    </section>
  );
}

/** Required wherever Semantic Scholar data is shown. */
function SemanticScholarAttribution() {
  return (
    <p className="flex items-center gap-1.5 px-2 text-2xs text-muted-foreground">
      <img src={semanticScholarMark} alt="" aria-hidden="true" className="h-3.5 w-auto shrink-0" />
      <span>
        Metadata and citation graph provided by{' '}
        <a
          href="https://www.semanticscholar.org/?utm_source=api"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Provider attribution"
          className="rounded-xs underline underline-offset-2 hover:text-foreground"
        >
          Semantic Scholar
        </a>
        .
      </span>
    </p>
  );
}

/** The citation graph of one paper, as a drill-in with a way back. */
function ExplorationView({ state }: { state: SemanticScholarState }) {
  const exploration = state.exploration!;
  const label = modeLabel(exploration.mode);
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <div className="flex items-start gap-1 px-1">
        <Button
          variant="icon"
          size="icon-sm"
          onClick={state.closeExploration}
          aria-label={`Close ${label} for ${exploration.source.title}`}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div className="min-w-0 pt-1">
          <h3 className="text-sm font-medium">{label}</h3>
          <p className="truncate text-xs text-muted-foreground">{exploration.source.title}</p>
        </div>
      </div>

      {exploration.error && (
        <Alert role="alert" className="mx-2">
          {exploration.error}
        </Alert>
      )}

      {exploration.items.map((entry, index) => (
        <S2PaperRow key={`graph:${exploration.mode}:${entry.paper.paper_id}:${index}`} paper={entry.paper}>
          {entry.isInfluential && <p className="font-medium text-foreground">Influential citation</p>}
          {entry.intents.length > 0 && <p>Citation intent: {entry.intents.join(', ')}</p>}
          <CitationContexts contexts={entry.contexts} paperTitle={entry.paper.title} />
        </S2PaperRow>
      ))}

      {/* Only for the first page; paging keeps its busy state on the button. */}
      {exploration.loading && exploration.items.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
          <Spinner />
          Loading graph…
        </div>
      )}

      {!exploration.loading && !exploration.error && exploration.items.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">No papers were returned for this graph.</p>
      )}

      {exploration.nextOffset !== null && exploration.items.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="mx-2 text-muted-foreground"
          disabled={exploration.loading}
          aria-busy={exploration.loading || undefined}
          onClick={() => void state.explore(exploration.source, exploration.mode, true)}
        >
          {exploration.loading && <Spinner />}
          {exploration.loading ? 'Loading more…' : 'Load more'}
        </Button>
      )}
    </section>
  );
}

export function SemanticScholarResults({
  state,
  mode,
}: {
  state: SemanticScholarState;
  mode: 'papers' | 'claim';
}) {
  if (mode === 'claim') {
    const { assessment } = state;
    return (
      <div className="flex flex-col gap-3">
        {assessment?.loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground" aria-live="polite">
            <Spinner />
            Checking “{assessment.claim}”…
          </div>
        )}
        {assessment?.error && <Alert className="mx-2">{assessment.error}</Alert>}
        {assessment?.result && <ClaimAssessmentResult assessment={assessment.result} />}
        {!assessment && (
          <EmptyState
            icon={Scale}
            title="Check a claim"
            description="Type one precise claim above. It is checked against excerpts retrieved from Semantic Scholar."
          />
        )}
        <SemanticScholarAttribution />
      </div>
    );
  }

  if (state.exploration) {
    return (
      <div className="flex flex-col gap-3">
        <ExplorationView state={state} />
        <SemanticScholarAttribution />
      </div>
    );
  }

  const { results, total, loading, loadingMore, nextOffset, error, submittedQuery } = state;
  return (
    <div className="flex flex-col gap-2">
      {error && <Alert className="mx-2">{error}</Alert>}
      <ResultList
        loading={loading}
        count={results.length}
        summary={`Showing ${results.length} of ${total.toLocaleString()} paper${total === 1 ? '' : 's'}`}
      >
        {results.map((paper) => (
          <S2PaperRow
            key={`semantic-scholar:${paper.paper_id}`}
            paper={paper}
            onExplore={(nextMode) => void state.explore(paper, nextMode)}
          />
        ))}
      </ResultList>

      {results.length > 0 && nextOffset !== null && (
        <Button
          variant="ghost"
          size="sm"
          className="mx-2 text-muted-foreground"
          onClick={() => void state.loadMore()}
          disabled={loading || loadingMore}
          aria-busy={loadingMore || undefined}
        >
          {loadingMore && <Spinner />}
          {loadingMore ? 'Loading more papers…' : 'Load more papers'}
        </Button>
      )}

      {!loading && results.length === 0 && !error && (
        submittedQuery ? (
          <EmptyState
            icon={SearchX}
            title="No papers found"
            description={`Nothing matched “${submittedQuery}”. Try broader keywords or fewer filters.`}
          />
        ) : (
          <EmptyState
            icon={Network}
            title="Search Semantic Scholar"
            description="Find papers, follow who cites them, and discover related work."
          />
        )
      )}
      <SemanticScholarAttribution />
    </div>
  );
}
