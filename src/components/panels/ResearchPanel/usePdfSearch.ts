import { useCallback, useRef, useState } from 'react';
import { errorMessage } from '@/services/contracts';
import { searchResources, type ResourceSearchResponse } from '@/services/resources';

export type PdfSearch = ReturnType<typeof usePdfSearch>;

/**
 * Full-text search across every PDF on the account — the same search the file
 * manager runs, without its folders around it.
 */
export function usePdfSearch() {
  const [result, setResult] = useState<ResourceSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const search = useCallback(async (query: string) => {
    const term = query.trim();
    if (!term) return;
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const next = await searchResources({ query: term, scope: 'library' });
      if (request === sequence.current) setResult(next);
    } catch (caught) {
      if (request !== sequence.current) return;
      setResult(null);
      setError(errorMessage(caught, 'Search failed'));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!result || result.next_offset === null) return;
    const request = ++sequence.current;
    setLoadingMore(true);
    try {
      const page = await searchResources({ query: result.query, scope: 'library', offset: result.next_offset });
      if (request !== sequence.current) return;
      setResult({
        ...page,
        matches: [...result.matches, ...page.matches],
        match_count: result.match_count + page.match_count,
        resources_searched: result.resources_searched + page.resources_searched,
        resources_skipped: [...result.resources_skipped, ...page.resources_skipped].filter(
          (item, index, all) => all.findIndex((other) => other.resource_id === item.resource_id) === index,
        ),
        truncated: result.truncated || page.truncated,
      });
    } catch (caught) {
      if (request === sequence.current) setError(errorMessage(caught, 'Could not search more files'));
    } finally {
      if (request === sequence.current) setLoadingMore(false);
    }
  }, [result]);

  const clear = useCallback(() => {
    sequence.current += 1;
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  return { result, loading, loadingMore, error, search, loadMore, clear };
}
