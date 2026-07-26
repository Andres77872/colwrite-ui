import { ApiError, isUnknownRecord } from './contracts';

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

async function handleJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    let msg = res.statusText || 'Request failed';
    if (isUnknownRecord(data) && typeof data.message === 'string') msg = data.message;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export async function searchArxiv(params: ArxivSearchParams): Promise<ArxivResult[]> {
  const { query, limit = 20, lite_search = true } = params;
  const form = new FormData();
  form.set('query', String(query ?? ''));
  form.set('limit', String(limit));
  form.set('lite_search', String(lite_search));

  const base = ARZ_API_BASE.replace(/\/$/, '');
  const res = await fetch(`${base}/rag/source/arxiv`, {
    method: 'POST',
    body: form,
  });
  const results = await handleJson<unknown>(res);

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
