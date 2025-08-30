import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { ColpaliArxivResult } from '../../../services/colpali';
import { searchColpaliArxiv } from '../../../services/colpali';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

function PageBadge({ page }: { page?: number }) {
  if (typeof page !== 'number') return null;
  return (
    <span className="px-2 py-1 rounded-full border border-border text-xs font-semibold bg-accent/10 text-accent">
      p.{page}
    </span>
  );
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

  async function onSearch(e?: FormEvent) {
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
    <div className={`h-full flex flex-col gap-3 overflow-hidden ${loading ? 'opacity-80' : ''}`} aria-busy={loading}>
      <div className="flex items-center justify-between gap-2">
        <strong>ColPali Search</strong>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            {loading ? 'Searching…' : hasResults ? `${results.length} hits` : 'Semantic search over arXiv (ColPali)'}
          </span>
        </div>
      </div>

      <form className="flex items-center gap-2" onSubmit={onSearch}>
        <Input
          className="flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
          placeholder="Search arXiv with ColPali (e.g., 'ai on education')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />
        <select
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          disabled={loading}
        >
          {[10, 20, 30, 40, 50].map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <Button type="submit" disabled={loading || !query.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {error && (
        <div
          className="text-[var(--color-danger)] bg-[color-mix(in oklch, var(--color-danger) 12%, transparent)] p-2.5 rounded-sm border border-[color-mix(in oklch, var(--color-danger) 20%, transparent)] text-sm"
          role="alert"
          aria-live="polite"
        >
          {error}
        </div>
      )}

      {hasResults && domains.length > 0 && (
        <div className="text-sm py-2 border-b border-border">
          <span className="text-muted-foreground">Sources: </span>
          <span>{domains.join(', ')}</span>
        </div>
      )}

      <div className="flex flex-col gap-3 overflow-y-auto flex-1">
        {results.map((r, idx) => {
          const key = `${r.id}-${r.page}-${idx}`;
          const isExpanded = expanded.has(key);
          const abstract = r.abstract?.trim() || '';
          const short = abstract.length > 240 ? `${abstract.slice(0, 240).trim()}…` : abstract;
          const img = r.page_image || '';
          const hasImg = Boolean(img);
          const hasAbstract = Boolean(abstract);
          const needsTruncation = abstract.length > 240;
          const displayAbstract = isExpanded ? abstract : short;
          return (
            <Card className="p-4 relative" key={key}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-sm grid place-items-center bg-elev border border-border font-bold text-sm text-muted-foreground">#{idx + 1}</div>
                <PageBadge page={r.page} />
              </div>
              <h3 className="font-semibold text-lg leading-snug mb-2">
                {r.url ? (
                  <a className="text-current no-underline hover:text-accent hover:underline" href={r.url} target="_blank" rel="noreferrer">
                    {r.title || '(untitled)'}
                  </a>
                ) : (
                  r.title || '(untitled)'
                )}
              </h3>
              <div className="text-sm mb-3 leading-snug text-muted-foreground">
                {r.authors && <span className="authors">{r.authors}</span>}
                {r.date && <span className="opacity-80"> · {new Date(r.date).toLocaleDateString()}</span>}
                {r.version && <span className="opacity-80"> · v{r.version}</span>}
              </div>

              <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                {hasImg && (
                  <div className="w-[140px] h-[180px] rounded-sm overflow-hidden bg-elev border border-border grid place-items-center">
                    {/* note: API returns .png; service normalizes to .jpg */}
                    <img src={img} alt="page preview" loading="lazy" className="w-full h-full object-cover block" />
                  </div>
                )}
                <div className="mb-3">
                  {hasAbstract && (
                    <div className={`text-base leading-relaxed ${isExpanded ? '' : 'line-clamp-4'}`}>
                      {displayAbstract}
                    </div>
                  )}
                  {needsTruncation && (
                    <button 
                      className="bg-transparent text-accent text-sm font-medium cursor-pointer py-1 mt-1 hover:underline" 
                      onClick={() => toggleExpanded(key)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex gap-3 flex-wrap">
                {r.url && (
                  <a className="text-accent no-underline text-sm font-medium py-1 px-2 rounded-sm border border-transparent hover:bg-accent/10 hover:border-border" href={r.url} target="_blank" rel="noreferrer">📄 arXiv</a>
                )}
                {typeof r.id === 'string' && (
                  <a className="text-accent no-underline text-sm font-medium py-1 px-2 rounded-sm border border-transparent hover:bg-accent/10 hover:border-border" href={`https://arxiv.org/pdf/${r.id}.pdf`} target="_blank" rel="noreferrer">📥 PDF</a>
                )}
                {r.doi && (
                  <a className="text-accent no-underline text-sm font-medium py-1 px-2 rounded-sm border border-transparent hover:bg-accent/10 hover:border-border" href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">🔗 DOI</a>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {!loading && !hasResults && !error && query.trim() && (
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center flex-1">
          <div className="text-[48px] mb-3 opacity-50">🔍</div>
          <div className="font-semibold text-lg mb-2">No hits found</div>
          <div className="text-sm leading-relaxed max-w-[280px] text-muted-foreground">Try broadening the query or rephrasing.</div>
        </div>
      )}

      {!loading && !hasResults && !error && !query.trim() && (
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center flex-1">
          <div className="text-[48px] mb-3 opacity-50">🤖</div>
          <div className="font-semibold text-lg mb-2">ColPali semantic search</div>
          <div className="text-sm leading-relaxed max-w-[280px] text-muted-foreground">Find relevant pages from arXiv papers. Thumbnails are optimized (.jpg).</div>
        </div>
      )}
    </div>
  );
}



