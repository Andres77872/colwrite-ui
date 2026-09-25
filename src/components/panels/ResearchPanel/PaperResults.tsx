import { useMemo } from 'react';
import { ScanSearch, Search, SearchX } from 'lucide-react';
import type { ArxivResult } from '@/services/arxiv';
import type { ColpaliArxivResult } from '@/services/colpali';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { yearOf } from '@/editor';
import { cn } from '@/lib/utils';
import { PaperRow, ResultsSkeleton, sourceFromArxiv, sourceFromColpali } from '../shared';
import type { PaperSearch } from './usePaperSearch';

/**
 * The list under the query row, shared by every provider: a stale list fades
 * while a new search runs instead of reading as the answer to the new query.
 */
export function ResultList({
  loading,
  count,
  summary,
  children,
}: {
  loading: boolean;
  count: number;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div aria-busy={loading} className="flex flex-col gap-1">
      {count > 0 && (
        <p className="px-2 text-xs text-muted-foreground" aria-live="polite">
          {summary}
        </p>
      )}
      {loading && count === 0 && <ResultsSkeleton />}
      <div className={cn('flex flex-col', loading && count > 0 && 'pointer-events-none opacity-50 transition-opacity')}>
        {children}
      </div>
    </div>
  );
}

export function ArxivResults({ state }: { state: PaperSearch<ArxivResult> }) {
  const { results, loading, error, submittedQuery } = state;
  const averageScore = useMemo(() => {
    const scored = results.map((r) => r.score).filter((s): s is number => typeof s === 'number');
    if (scored.length === 0) return null;
    return Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100);
  }, [results]);

  return (
    <>
      {error && <Alert className="mx-2">{error}</Alert>}
      <ResultList
        loading={loading}
        count={results.length}
        summary={
          <>
            {results.length} paper{results.length === 1 ? '' : 's'}
            {averageScore !== null && <> · {averageScore}% average relevance</>}
          </>
        }
      >
        {results.map((result, index) => (
          <PaperRow
            key={`${result.id}-${index}`}
            title={result.title}
            authors={result.authors}
            meta={[yearOf(result.date)]}
            tag={typeof result.score === 'number' ? `${Math.round(result.score * 100)}% match` : null}
            summary={result.abstract}
            source={sourceFromArxiv(result)}
            links={[
              { label: 'Open on arXiv', href: result.url },
              { label: 'Open PDF', href: result.pdfUrl },
              { label: 'Open DOI', href: result.doi ? `https://doi.org/${result.doi}` : null },
            ]}
          />
        ))}
      </ResultList>
      {!loading && results.length === 0 && !error && (
        submittedQuery ? (
          <EmptyState
            icon={SearchX}
            title="No papers found"
            description={`Nothing matched “${submittedQuery}”. Try broader keywords.`}
          />
        ) : (
          <EmptyState
            icon={Search}
            title="Search arXiv"
            description="Find papers to read and cite. Cite puts a citation where your cursor was."
          />
        )
      )}
    </>
  );
}

export function ColpaliResults({ state }: { state: PaperSearch<ColpaliArxivResult> }) {
  const { results, loading, error, submittedQuery } = state;
  const hosts = useMemo(() => {
    const found = new Set<string>();
    for (const result of results) {
      if (!result.url) continue;
      try {
        found.add(new URL(result.url).hostname.replace(/^www\./, ''));
      } catch {
        /* malformed URLs simply do not contribute a host */
      }
    }
    return Array.from(found);
  }, [results]);

  return (
    <>
      {error && <Alert className="mx-2">{error}</Alert>}
      <ResultList
        loading={loading}
        count={results.length}
        summary={
          <>
            {results.length} page{results.length === 1 ? '' : 's'}
            {hosts.length > 0 && <> · {hosts.join(', ')}</>}
          </>
        }
      >
        {results.map((result, index) => (
          <PaperRow
            key={`${result.id}-${result.page}-${index}`}
            title={result.title}
            authors={result.authors}
            meta={[yearOf(result.date), result.version && `v${result.version.replace(/^v/i, '')}`]}
            tag={`Page ${result.page}`}
            summary={result.abstract}
            thumbnailUrl={result.page_image}
            source={sourceFromColpali(result)}
            links={[
              { label: 'Open on arXiv', href: result.url },
              { label: 'Open PDF', href: result.id ? `https://arxiv.org/pdf/${result.id}.pdf` : null },
              { label: 'Open DOI', href: result.doi ? `https://doi.org/${result.doi}` : null },
            ]}
          />
        ))}
      </ResultList>
      {!loading && results.length === 0 && !error && (
        submittedQuery ? (
          <EmptyState
            icon={SearchX}
            title="No pages found"
            description={`Nothing matched “${submittedQuery}”. Try rephrasing the question.`}
          />
        ) : (
          <EmptyState
            icon={ScanSearch}
            title="Search inside papers"
            description="Ask a question and find the exact arXiv pages that answer it."
          />
        )
      )}
    </>
  );
}
