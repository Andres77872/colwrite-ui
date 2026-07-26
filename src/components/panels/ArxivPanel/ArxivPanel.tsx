import { useMemo, useState } from 'react';
import { searchArxiv, type ArxivResult } from '@/services/arxiv';
import { EmptyState } from '@/components/ui/empty-state';
import { PaperCard, ScoreBadge, SearchForm, useExpandable } from '../shared';
import { formatDate } from '@/lib/text';
import { AlertCircle, Search, SearchX } from 'lucide-react';

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
          {results.length} paper{results.length === 1 ? '' : 's'}
          {averageScore !== null && <> · {averageScore}% average relevance</>}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
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
