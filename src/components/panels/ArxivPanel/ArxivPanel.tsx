import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { searchArxiv } from '../../../services/arxiv';
import type { ArxivResult } from '../../../services/arxiv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

function ScoreBadge({ score }: { score?: number }) {
  if (typeof score !== 'number') return null;
  const pct = Math.round(score * 100);
  return (
    <span className="px-2 py-1 rounded-full border border-border text-xs font-semibold bg-accent/10 text-accent">
      {pct}%
    </span>
  );
}

export function ArxivPanel() {
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<ArxivResult[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [limit, setLimit] = useState<number>(20);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const avgScore = useMemo(() => {
    if (!results.length) return 0;
    const s = results.map(r => r.score ?? 0);
    const avg = s.reduce((a, b) => a + b, 0) / s.length;
    return Math.round(avg * 100) / 100;
  }, [results]);

  function getShortAbstract(text?: string, maxChars: number = 280): string {
    if (!text) return '';
    const t = text.trim();
    if (t.length <= maxChars) return t;
    const slice = t.slice(0, maxChars);
    const lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
    const cut = lastStop > 100 ? slice.slice(0, lastStop + 1) : slice;
    return `${cut.trim()}…`;
  }

  function toggleExpanded(key: string) {
    setExpanded(prev => {
      const next = new Set(Array.from(prev));
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function onSearch(e?: FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    try {
      setLoading(true);
      setError(null);
      setExpanded(new Set()); // Clear expanded state on new search
      const res = await searchArxiv({ query, limit, lite_search: true });
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
        <strong>References</strong>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            {loading ? 'Searching…' : results.length ? `${results.length} papers found` : 'Search arXiv papers'}
          </span>
        </div>
      </div>

      <form className="flex items-center gap-2" onSubmit={onSearch}>
        <Input
          className="flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
          placeholder="Search arXiv papers (e.g., 'attention is all you need')"
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

      {results.length > 0 && (
        <div className="text-sm py-2 border-b border-border">
          <span className="text-muted-foreground">Average relevance: </span>
          <span className="font-semibold text-accent">{avgScore}</span>
        </div>
      )}

      <div className="flex flex-col gap-3 overflow-y-auto flex-1">
        {results.map((r, idx) => {
          const key = `${r.id}-${idx}`;
          const isExpanded = expanded.has(key);
          const displayAbstract = isExpanded ? (r.abstract ?? '') : getShortAbstract(r.abstract, 280);
          const hasAbstract = Boolean(r.abstract?.trim());
          const needsTruncation = hasAbstract && (r.abstract?.length ?? 0) > 280;
          
          return (
            <Card className="p-4 relative" key={key}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-sm grid place-items-center bg-elev border border-border font-bold text-sm text-muted-foreground">#{idx + 1}</div>
                <ScoreBadge score={r.score} />
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
              
              <div className="text-sm mb-3 leading-snug muted">
                {r.authors && <span className="authors">{r.authors}</span>}
                {r.date && <span className="opacity-80"> · {new Date(r.date).toLocaleDateString()}</span>}
              </div>
              
              {hasAbstract && (
                <div className="mb-3">
                  <div className={`text-base leading-relaxed ${isExpanded ? '' : 'line-clamp-4'}`}>
                    {displayAbstract}
                  </div>
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
              )}
              
              <div className="flex gap-3 flex-wrap">
                {r.url && (
                  <a className="text-accent no-underline text-sm font-medium py-1 px-2 rounded-sm border border-transparent hover:bg-accent/10 hover:border-border" href={r.url} target="_blank" rel="noreferrer">
                    📄 arXiv
                  </a>
                )}
                {r.pdfUrl && (
                  <a className="text-accent no-underline text-sm font-medium py-1 px-2 rounded-sm border border-transparent hover:bg-accent/10 hover:border-border" href={r.pdfUrl} target="_blank" rel="noreferrer">
                    📥 PDF
                  </a>
                )}
                {r.doi && (
                  <a className="text-accent no-underline text-sm font-medium py-1 px-2 rounded-sm border border-transparent hover:bg-accent/10 hover:border-border" href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">
                    🔗 DOI
                  </a>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {!loading && !results.length && !error && query.trim() && (
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center flex-1">
          <div className="text-[48px] mb-3 opacity-50">🔍</div>
          <div className="font-semibold text-lg mb-2">No papers found</div>
          <div className="text-sm leading-relaxed max-w-[280px] text-muted-foreground">Try adjusting your search terms or use broader keywords.</div>
        </div>
      )}

      {!loading && !results.length && !error && !query.trim() && (
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center flex-1">
          <div className="text-[48px] mb-3 opacity-50">📚</div>
          <div className="font-semibold text-lg mb-2">Search arXiv papers</div>
          <div className="text-sm leading-relaxed max-w-[280px] text-muted-foreground">Find relevant research papers and references for your work.</div>
        </div>
      )}
    </div>
  );
}


