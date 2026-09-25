import { get, type ApiRequestInit } from './api';
import type { CitationSource } from '../editor/types';

/**
 * Resolve a DOI, arXiv id or Semantic Scholar id into verified metadata.
 *
 * The metadata comes from the registry that owns the identifier (Crossref,
 * arXiv, Semantic Scholar for accounts that enabled it), never from what the
 * author typed. Rejects with an `ApiError`: 400 for text that is not an
 * identifier, 404 when no record exists, 503 when the registry is
 * unreachable — the identifier may still be fine, so try again.
 */
export async function resolveSource(identifier: string, init?: ApiRequestInit): Promise<CitationSource> {
  const { source } = await get<{ source: CitationSource }>(
    `/sources/resolve?identifier=${encodeURIComponent(identifier.trim())}`,
    init,
  );
  return source;
}
