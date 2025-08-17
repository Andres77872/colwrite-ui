import { useMemo, useState } from 'react';
import './ColpaliPanel.css';
import type { ColpaliArxivResult } from '../../../services/colpali';
import { searchColpaliArxiv } from '../../../services/colpali';

function PageBadge({ page }: { page?: number }) {
  if (typeof page !== 'number') return null;
  return <span className="badge">p.{page}</span>;
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
    <div className="colpali-panel" aria-busy={loading}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong>ColPali Search</strong>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="muted">
            {loading ? 'Searching…' : hasResults ? `${results.length} hits` : 'Semantic search over arXiv (ColPali)'}
          </span>
        </div>
      </div>

      <form className="search" onSubmit={onSearch}>
        <input
          className="input grow"
          placeholder="Search arXiv with ColPali (e.g., 'ai on education')"
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

      {hasResults && domains.length > 0 && (
        <div className="summary">
          <span className="muted">Sources: </span>
          <span>{domains.join(', ')}</span>
        </div>
      )}

      <div className="results">
        {results.map((r, idx) => {
          const key = `${r.id}-${r.page}-${idx}`;
          const isExpanded = expanded.has(key);
          const abstract = r.abstract?.trim() || '';
          const short = abstract.length > 240 ? `${abstract.slice(0, 240).trim()}…` : abstract;
          const img = r.page_image || '';
          const hasImg = Boolean(img);
          return (
            <div className="result card" key={key}>
              <div className="result-header">
                <div className="rank">#{idx + 1}</div>
                <PageBadge page={r.page} />
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
                {r.version && <span className="date"> · v{r.version}</span>}
              </div>

              <div className="content">
                {hasImg && (
                  <div className="thumb">
                    {/* note: API returns .png; service normalizes to .jpg */}
                    <img src={img} alt="page preview" loading="lazy" />
                  </div>
                )}
                <div className="abstract-wrapper">
                  {abstract && (
                    <div className={`abstract ${isExpanded ? 'expanded' : 'collapsed'}`}>
                      {isExpanded ? abstract : short}
                    </div>
                  )}
                  {abstract.length > 240 && (
                    <button 
                      className="expand-btn" 
                      onClick={() => toggleExpanded(key)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>
              </div>

              <div className="actions">
                {r.url && (
                  <a className="action-link" href={r.url} target="_blank" rel="noreferrer">📄 arXiv</a>
                )}
                {typeof r.id === 'string' && (
                  <a className="action-link" href={`https://arxiv.org/pdf/${r.id}.pdf`} target="_blank" rel="noreferrer">📥 PDF</a>
                )}
                {r.doi && (
                  <a className="action-link" href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">🔗 DOI</a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!loading && !hasResults && !error && query.trim() && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">No hits found</div>
          <div className="empty-text muted">Try broadening the query or rephrasing.</div>
        </div>
      )}

      {!loading && !hasResults && !error && !query.trim() && (
        <div className="empty-state">
          <div className="empty-icon">🤖</div>
          <div className="empty-title">ColPali semantic search</div>
          <div className="empty-text muted">Find relevant pages from arXiv papers. Thumbnails are optimized (.jpg).</div>
        </div>
      )}
    </div>
  );
}


