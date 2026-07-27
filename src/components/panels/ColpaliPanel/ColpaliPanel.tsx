import { useMemo, useState } from 'react';
import { searchColpaliArxiv, type ColpaliArxivResult } from '@/services/colpali';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { PageBadge, PaperCard, ResultsSkeleton, SearchForm, useExpandable } from '../shared';
import { formatDate } from '@/lib/text';
import { ScanSearch, SearchX } from 'lucide-react';

export function ColpaliPanel() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState<ColpaliArxivResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const { isExpanded, toggle, reset } = useExpandable();

  const sources = useMemo(() => {
    const hosts = new Set<string>();
    for (const result of results) {
      if (!result.url) continue;
      try {
        hosts.add(new URL(result.url).hostname.replace(/^www\./, ''));
      } catch {
        /* malformed URLs simply do not contribute a source */
      }
    }
    return Array.from(hosts);
  }, [results]);

  async function onSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    reset();
    try {
      const res = await searchColpaliArxiv({ query: trimmed, limit });
      setResults(res);
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
        placeholder="Search arXiv with ColPali…"
        label="ColPali results"
      />

      {error && (
        <Alert>{error}</Alert>
      )}

      {hasResults && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {results.length} page{results.length === 1 ? '' : 's'}
          {sources.length > 0 && <> · {sources.join(', ')}</>}
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
          const key = `${result.id}-${result.page}-${index}`;
          return (
            <PaperCard
              key={key}
              index={index + 1}
              title={result.title}
              url={result.url}
              authors={result.authors}
              meta={[formatDate(result.date), result.version ? `v${result.version}` : null]}
              abstract={result.abstract}
              badge={<PageBadge page={result.page} />}
              thumbnailUrl={result.page_image}
              pdfUrl={result.id ? `https://arxiv.org/pdf/${result.id}.pdf` : null}
              doi={result.doi}
              primaryLinkLabel="arXiv"
              expanded={isExpanded(key)}
              onToggleExpanded={() => toggle(key)}
              abstractPreviewChars={240}
            />
          );
        })}

        {!loading && !hasResults && !error && submittedQuery && (
          <EmptyState
            icon={SearchX}
            title="No pages found"
            description={`Nothing matched “${submittedQuery}”. Try rephrasing the query.`}
          />
        )}

        {!loading && !hasResults && !error && !submittedQuery && (
          <EmptyState
            icon={ScanSearch}
            title="ColPali semantic search"
            description="Find the specific pages of arXiv papers that answer your question."
          />
        )}
      </div>
    </div>
  );
}
