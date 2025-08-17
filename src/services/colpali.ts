export type ColpaliArxivResult = {
  page: number;
  id: string;
  doi: string | null;
  date: string | null;
  title: string | null;
  authors: string | null;
  abstract: string | null;
  url: string | null;
  version: string | null;
  page_image: string | null;
};

export type ColpaliArxivSearchResponse = {
  data: ColpaliArxivResult[];
};

const COLPALI_BASE: string = (import.meta as any)?.env?.VITE_COLPALI_BASE ?? 'https://llm.arz.ai';

export async function searchColpaliArxiv(params: { query: string; limit?: number }): Promise<ColpaliArxivResult[]> {
  const { query, limit = 20 } = params;
  const endpoint = `${COLPALI_BASE.replace(/\/$/, '')}/rag/colpali/arxiv`;
  const body = new URLSearchParams();
  body.set('query', query);
  body.set('limit', String(limit));

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'accept': 'application/json',
    },
    body,
    // Cross-origin to public endpoint; do not send credentials
    credentials: 'omit',
    mode: 'cors',
  });

  const text = await res.text();
  const data: ColpaliArxivSearchResponse = text ? JSON.parse(text) : { data: [] };
  if (!res.ok) {
    const message = (data as any)?.message || res.statusText || 'Search failed';
    const err = new Error(message);
    (err as any).status = res.status;
    (err as any).data = data;
    throw err;
  }

  // Normalize page_image from .png to .jpg (optimized variant)
  const results = (data?.data || []).map((r) => ({
    ...r,
    page_image: typeof r.page_image === 'string' ? r.page_image.replace(/\.png(\?.*)?$/i, '.jpg$1') : r.page_image,
  }));

  return results;
}


