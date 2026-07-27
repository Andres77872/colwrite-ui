import { useMemo, useState } from 'react';
import { searchArxiv, type ArxivResult } from '@/services/arxiv';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { PaperCard, ResultsSkeleton, ScoreBadge, SearchForm, useExpandable } from '../shared';
import { formatDate } from '@/lib/text';
import { Search, SearchX } from 'lucide-react';

export function ArxivPanel() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState<ArxivResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const { isExpanded, toggle, reset } = useExpandable();

  const averageScore = useMemo(() => {
    const scored = results.map((r) => r.score).filter((s): s is number => typeof s === 'number');
    if (scored.length === 0) return null;
    return Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100);
  }, [results]);

  async function onSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    reset();
    try {
      const res = await searchArxiv({ query: trimmed, limit, lite_search: true });
      setResults(res);
      // Tracked separately from `query` so the empty state describes what was
      // actually searched, not whatever has since been typed into the box.
      setSubmittedQuery(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  const hasResults = results.length > 0;

  return (
    <div className="flex h-full flex-col gap-3" aria-busy={loading}>
      <SearchForm
        query={query}
        onQueryChange={setQuery}
        limit={limit}
        onLimitChange={setLimit}
        onSubmit={onSearch}
        loading={loading}
        placeholder="Search arXiv papers…"
        label="arXiv results"
      />

      {error && (
        <Alert>{error}</Alert>
      )}

      {hasResults && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {results.length} paper{results.length === 1 ? '' : 's'}
          {averageScore !== null && <> · {averageScore}% average relevance</>}
        </p>
      )}

      {/* Stale results used to sit at full strength while a new search ran,
          reading as the answer to the query already in the box. */}
      <div
        className={cn(
          'min-h-0 flex-1 space-y-3 overflow-y-auto',
          loading && hasResults && 'pointer-events-none opacity-50 transition-opacity',
        )}
      >
        {loading && !hasResults && <ResultsSkeleton />}

        {results.map((result, index) => {
          const key = `${result.id}-${index}`;
          return (
            <PaperCard
              key={key}
              index={index + 1}
              title={result.title}
              url={result.url}
              authors={result.authors}
              meta={[formatDate(result.date)]}
              abstract={result.abstract}
              badge={<ScoreBadge score={result.score} />}
              pdfUrl={result.pdfUrl}
              doi={result.doi}
              primaryLinkLabel="arXiv"
              expanded={isExpanded(key)}
              onToggleExpanded={() => toggle(key)}
            />
          );
        })}

        {!loading && !hasResults && !error && submittedQuery && (
          <EmptyState
            icon={SearchX}
            title="No papers found"
            description={`Nothing matched “${submittedQuery}”. Try broader keywords.`}
          />
        )}

        {!loading && !hasResults && !error && !submittedQuery && (
          <EmptyState
            icon={Search}
            title="Search arXiv"
            description="Find research papers and references to cite in your document."
          />
        )}
      </div>
    </div>
  );
}
