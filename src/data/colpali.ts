import { postExternalForm } from '@/api/external';
import { isUnknownRecord } from '@/lib/json';

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

const COLPALI_BASE = import.meta.env.VITE_COLPALI_BASE ?? 'https://llm.arz.ai';

export async function searchColpaliArxiv(params: { query: string; limit?: number }): Promise<ColpaliArxivResult[]> {
  const { query, limit = 20 } = params;
  const endpoint = `${COLPALI_BASE.replace(/\/$/, '')}/rag/colpali/arxiv`;
  const body = new URLSearchParams();
  body.set('query', query);
  body.set('limit', String(limit));

  const data = await postExternalForm(endpoint, body);

  // Normalize page_image from .png to .jpg (optimized variant)
  const rawResults = isUnknownRecord(data) && Array.isArray(data.data)
    ? data.data.filter(isColpaliArxivResult)
    : [];
  const results = rawResults.map((r) => ({
    ...r,
    page_image: typeof r.page_image === 'string' ? r.page_image.replace(/\.png(\?.*)?$/i, '.jpg$1') : r.page_image,
  }));

  return results;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isColpaliArxivResult(value: unknown): value is ColpaliArxivResult {
  if (!isUnknownRecord(value)) return false;
  return (
    typeof value.page === 'number' &&
    typeof value.id === 'string' &&
    isNullableString(value.doi) &&
    isNullableString(value.date) &&
    isNullableString(value.title) &&
    isNullableString(value.authors) &&
    isNullableString(value.abstract) &&
    isNullableString(value.url) &&
    isNullableString(value.version) &&
    isNullableString(value.page_image)
  );
}
