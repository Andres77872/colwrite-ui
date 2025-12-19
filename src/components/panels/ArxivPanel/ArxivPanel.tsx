import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { searchArxiv } from '../../../services/arxiv';
import type { ArxivResult } from '../../../services/arxiv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

function ScoreBadge({ score }: { score?: number }) {
  if (typeof score !== 'number') return null;
  const pct = Math.round(score * 100);
  return <Badge variant="secondary" className="text-xs">{pct}%</Badge>;
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
    <div className="flex flex-col gap-3 h-full" aria-busy={loading}>
      {/* Status */}
      <div className="text-xs text-muted-foreground">
        {loading ? 'Searching…' : results.length ? `${results.length} papers found` : 'Search arXiv papers'}
      </div>

      <form className="flex items-center gap-2" onSubmit={onSearch}>
        <Input
          className="flex-1"
          placeholder="Search arXiv papers..."
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
        <Button type="submit" disabled={loading || !query.trim()} size="sm">
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {error && <div className="text-sm text-destructive" role="alert" aria-live="polite">{error}</div>}

      {results.length > 0 && (
        <div className="text-sm">
          <span className="text-muted-foreground">Average relevance: </span>
          <span className="font-medium text-primary">{avgScore}</span>
        </div>
      )}

      <div className="space-y-3 overflow-auto">
        {results.map((r, idx) => {
          const key = `${r.id}-${idx}`;
          const isExpanded = expanded.has(key);
          const displayAbstract = isExpanded ? (r.abstract ?? '') : getShortAbstract(r.abstract, 280);
          const hasAbstract = Boolean(r.abstract?.trim());
          const needsTruncation = hasAbstract && (r.abstract?.length ?? 0) > 280;
          
          return (
            <div className="bg-card border border-border rounded-lg p-3" key={key}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                <ScoreBadge score={r.score} />
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
              </div>
              
              {hasAbstract && (
                <div className="mb-2">
                  <div className="text-xs text-foreground/80">
                    {displayAbstract}
                  </div>
                  {needsTruncation && (
                    <button 
                      className="text-xs text-primary hover:underline mt-1" 
                      onClick={() => toggleExpanded(key)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>
              )}
              
              <div className="flex items-center gap-3 text-xs">
                {r.url && (
                  <a className="text-muted-foreground hover:text-foreground" href={r.url} target="_blank" rel="noreferrer">
                    📄 arXiv
                  </a>
                )}
                {r.pdfUrl && (
                  <a className="text-muted-foreground hover:text-foreground" href={r.pdfUrl} target="_blank" rel="noreferrer">
                    📥 PDF
                  </a>
                )}
                {r.doi && (
                  <a className="text-muted-foreground hover:text-foreground" href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">
                    🔗 DOI
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!loading && !results.length && !error && query.trim() && (
        <div className="text-center py-8">
          <div className="text-3xl mb-2">🔍</div>
          <div className="font-medium">No papers found</div>
          <div className="text-sm text-muted-foreground">Try adjusting your search terms or use broader keywords.</div>
        </div>
      )}

      {!loading && !results.length && !error && !query.trim() && (
        <div className="text-center py-8">
          <div className="text-3xl mb-2">📚</div>
          <div className="font-medium">Search arXiv papers</div>
          <div className="text-sm text-muted-foreground">Find relevant research papers and references for your work.</div>
        </div>
      )}
    </div>
  );
}


