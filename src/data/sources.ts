import { api, unwrap } from '@/api/client';
import { toEditorSource } from '@/api/content';
import type { CitationSource } from '@/editor/types';

/**
 * Resolve a DOI, arXiv id or Semantic Scholar id into verified metadata.
 *
 * The metadata comes from the registry that owns the identifier (Crossref,
 * arXiv, Semantic Scholar for accounts that enabled it), never from what the
 * author typed. Rejects with an `ApiError` whose `code` says why:
 * `unrecognized_identifier`, `source_not_found`, `paper_source_disabled`
 * (naming the `source`), or `resolver_unavailable`, after which the
 * identifier may still be fine.
 */
export async function resolveSource(identifier: string, init?: { signal?: AbortSignal }): Promise<CitationSource> {
  const { source } = await unwrap(api.GET('/sources/resolve', {
    params: { query: { identifier: identifier.trim() } },
    signal: init?.signal,
  }));
  return toEditorSource(source);
}
