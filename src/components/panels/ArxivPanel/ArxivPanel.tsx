import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import './ArxivPanel.css';
import { searchArxiv } from '../../../services/arxiv';
import type { ArxivResult } from '../../../services/arxiv';

function ScoreBadge({ score }: { score?: number }) {
  if (typeof score !== 'number') return null;
  const pct = Math.round(score * 100);
  return <span className="badge">{pct}%</span>;
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
    <div className="arxiv-panel" aria-busy={loading}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong>References</strong>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="muted">
            {loading ? 'Searching…' : results.length ? `${results.length} papers found` : 'Search arXiv papers'}
          </span>
        </div>
      </div>

      <form className="search" onSubmit={onSearch}>
        <input
          className="input grow"
          placeholder="Search arXiv papers (e.g., 'attention is all you need')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />
        <select 
          className="select" 
          value={limit} 
          onChange={(e) => setLimit(Number(e.target.value))}
          disabled={loading}
        >
          {[10, 20, 30, 40, 50].map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button className="btn" type="submit" disabled={loading || !query.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <div className="error" role="alert" aria-live="polite">{error}</div>}

      {results.length > 0 && (
        <div className="summary">
          <span className="muted">Average relevance: </span>
          <span className="score-highlight">{avgScore}</span>
        </div>
      )}

      <div className="results">
        {results.map((r, idx) => {
          const key = `${r.id}-${idx}`;
          const isExpanded = expanded.has(key);
          const displayAbstract = isExpanded ? (r.abstract ?? '') : getShortAbstract(r.abstract, 280);
          const hasAbstract = Boolean(r.abstract?.trim());
          const needsTruncation = hasAbstract && (r.abstract?.length ?? 0) > 280;
          
          return (
            <div className="result card" key={key}>
              <div className="result-header">
                <div className="rank">#{idx + 1}</div>
                <ScoreBadge score={r.score} />
              </div>
              
              <h3 className="title">
                {r.url ? (
                  <a className="title-link" href={r.url} target="_blank" rel="noreferrer">
                    {r.title || '(untitled)'}
                  </a>
                ) : (
                  r.title || '(untitled)'
                )}
              </h3>
              
              <div className="meta muted">
                {r.authors && <span className="authors">{r.authors}</span>}
                {r.date && <span className="date"> · {new Date(r.date).toLocaleDateString()}</span>}
              </div>
              
              {hasAbstract && (
                <div className="abstract-wrapper">
                  <div className={`abstract ${isExpanded ? 'expanded' : 'collapsed'}`}>
                    {displayAbstract}
                  </div>
                  {needsTruncation && (
                    <button 
                      className="expand-btn" 
                      onClick={() => toggleExpanded(key)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>
              )}
              
              <div className="actions">
                {r.url && (
                  <a className="action-link" href={r.url} target="_blank" rel="noreferrer">
                    📄 arXiv
                  </a>
                )}
                {r.pdfUrl && (
                  <a className="action-link" href={r.pdfUrl} target="_blank" rel="noreferrer">
                    📥 PDF
                  </a>
                )}
                {r.doi && (
                  <a className="action-link" href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">
                    🔗 DOI
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!loading && !results.length && !error && query.trim() && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">No papers found</div>
          <div className="empty-text muted">Try adjusting your search terms or use broader keywords.</div>
        </div>
      )}

      {!loading && !results.length && !error && !query.trim() && (
        <div className="empty-state">
          <div className="empty-icon">📚</div>
          <div className="empty-title">Search arXiv papers</div>
          <div className="empty-text muted">Find relevant research papers and references for your work.</div>
        </div>
      )}
    </div>
  );
}


