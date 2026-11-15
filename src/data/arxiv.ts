import { postExternalForm } from '@/api/external';
import { isUnknownRecord } from '@/lib/json';

// Standalone client for the external arXiv search API (separate from our app API)
// Base can be overridden via Vite env var VITE_ARZ_API
export const ARZ_API_BASE = import.meta.env.VITE_ARZ_API ?? 'https://llm.arz.ai';

export type ArxivSearchParams = {
  query: string;
  limit?: number;
  lite_search?: boolean;
};

export type ArxivResult = {
  id: string;
  title: string;
  authors?: string;
  date?: string;
  abstract?: string;
  doi?: string | null;
  score?: number;
  // Derived convenience links
  url?: string;
  pdfUrl?: string;
};

export async function searchArxiv(params: ArxivSearchParams): Promise<ArxivResult[]> {
  const { query, limit = 20, lite_search = true } = params;
  const form = new FormData();
  form.set('query', String(query ?? ''));
  form.set('limit', String(limit));
  form.set('lite_search', String(lite_search));

  const base = ARZ_API_BASE.replace(/\/$/, '');
  const results = await postExternalForm(`${base}/rag/source/arxiv`, form);

  // Normalize and enrich results with commonly used fields
  return (Array.isArray(results) ? results : []).filter(isUnknownRecord).map((result) => {
    const id = String(result.id ?? '');
    const url = id ? `https://arxiv.org/abs/${id}` : undefined;
    const pdfUrl = id ? `https://arxiv.org/pdf/${id}.pdf` : undefined;
    return {
      id,
      title: String(result.title ?? ''),
      authors: result.authors ? String(result.authors) : undefined,
      date: result.date ? String(result.date) : undefined,
      abstract: result.abstract ? String(result.abstract) : undefined,
      doi: typeof result.doi === 'string' ? result.doi : null,
      score: typeof result.score === 'number' ? result.score : undefined,
      url,
      pdfUrl,
    };
  });
}
