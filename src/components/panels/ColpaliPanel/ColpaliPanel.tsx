import { useMemo, useState } from 'react';
import { searchColpaliArxiv, type ColpaliArxivResult } from '@/services/colpali';
import { EmptyState } from '@/components/ui/empty-state';
import { PageBadge, PaperCard, SearchForm, useExpandable } from '../shared';
import { formatDate } from '@/lib/text';
import { AlertCircle, ScanSearch, SearchX } from 'lucide-react';

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
          {results.length} page{results.length === 1 ? '' : 's'}
          {sources.length > 0 && <> · {sources.join(', ')}</>}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
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
