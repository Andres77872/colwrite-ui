import { useMemo, useState } from 'react';
import type { ColpaliArxivResult } from '../../../services/colpali';
import { searchColpaliArxiv } from '../../../services/colpali';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

function PageBadge({ page }: { page?: number }) {
  if (typeof page !== 'number') return null;
  return <Badge variant="secondary" className="text-xs">p.{page}</Badge>;
}

export function ColpaliPanel() {
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<ColpaliArxivResult[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [limit, setLimit] = useState<number>(20);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const hasResults = results.length > 0;

  function toggleExpanded(key: string) {
    setExpanded(prev => {
      const next = new Set(Array.from(prev));
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const r of results) {
      if (r.url) {
        try {
          const u = new URL(r.url);
          set.add(u.hostname.replace(/^www\./, ''));
        } catch {}
      }
    }
    return Array.from(set);
  }, [results]);

  async function onSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    try {
      setLoading(true);
      setError(null);
      setExpanded(new Set());
      const res = await searchColpaliArxiv({ query, limit });
      setResults(res);
    } catch (err: any) {
      setError(err?.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 h-full" aria-busy={loading}>
      {/* Status */}
      <div className="text-xs text-muted-foreground">
        {loading ? 'Searching…' : hasResults ? `${results.length} hits` : 'Semantic search'}
      </div>

      <form className="flex items-center gap-2" onSubmit={onSearch}>
        <Input
          className="flex-1"
          placeholder="Search arXiv with ColPali..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />
        <select 
          className="h-9 px-2 text-sm border border-input rounded-md bg-background"
          value={limit} 
          onChange={(e) => setLimit(Number(e.target.value))}
          disabled={loading}
        >
          {[10, 20, 30, 40, 50].map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={loading || !query.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {error && <div className="text-sm text-destructive" role="alert" aria-live="polite">{error}</div>}

      {hasResults && domains.length > 0 && (
        <div className="text-sm">
          <span className="text-muted-foreground">Sources: </span>
          <span>{domains.join(', ')}</span>
        </div>
      )}

      <div className="space-y-3 overflow-auto">
        {results.map((r, idx) => {
          const key = `${r.id}-${r.page}-${idx}`;
          const isExpanded = expanded.has(key);
          const abstract = r.abstract?.trim() || '';
          const short = abstract.length > 240 ? `${abstract.slice(0, 240).trim()}…` : abstract;
          const img = r.page_image || '';
          const hasImg = Boolean(img);
          return (
            <div className="bg-card border border-border rounded-lg p-3" key={key}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                <PageBadge page={r.page} />
              </div>
              <h3 className="text-sm font-medium mb-1">
                {r.url ? (
                  <a className="text-primary hover:underline" href={r.url} target="_blank" rel="noreferrer">
                    {r.title || '(untitled)'}
                  </a>
                ) : (
                  r.title || '(untitled)'
                )}
              </h3>
              <div className="text-xs text-muted-foreground mb-2">
                {r.authors && <span>{r.authors}</span>}
                {r.date && <span> · {new Date(r.date).toLocaleDateString()}</span>}
                {r.version && <span> · v{r.version}</span>}
              </div>

              <div className="flex gap-3">
                {hasImg && (
                  <div className="w-20 h-28 shrink-0 bg-muted rounded overflow-hidden">
                    <img src={img} alt="page preview" loading="lazy" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {abstract && (
                    <div className="text-xs text-foreground/80">
                      {isExpanded ? abstract : short}
                    </div>
                  )}
                  {abstract.length > 240 && (
                    <button 
                      className="text-xs text-primary hover:underline mt-1" 
                      onClick={() => toggleExpanded(key)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs mt-2">
                {r.url && (
                  <a className="text-muted-foreground hover:text-foreground" href={r.url} target="_blank" rel="noreferrer">📄 arXiv</a>
                )}
                {typeof r.id === 'string' && (
                  <a className="text-muted-foreground hover:text-foreground" href={`https://arxiv.org/pdf/${r.id}.pdf`} target="_blank" rel="noreferrer">📥 PDF</a>
                )}
                {r.doi && (
                  <a className="text-muted-foreground hover:text-foreground" href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">🔗 DOI</a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!loading && !hasResults && !error && query.trim() && (
        <div className="text-center py-8">
          <div className="text-3xl mb-2">🔍</div>
          <div className="font-medium">No hits found</div>
          <div className="text-sm text-muted-foreground">Try broadening the query or rephrasing.</div>
        </div>
      )}

      {!loading && !hasResults && !error && !query.trim() && (
        <div className="text-center py-8">
          <div className="text-3xl mb-2">🤖</div>
          <div className="font-medium">ColPali semantic search</div>
          <div className="text-sm text-muted-foreground">Find relevant pages from arXiv papers.</div>
        </div>
      )}
    </div>
  );
}


