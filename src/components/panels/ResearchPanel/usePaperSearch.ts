import { useCallback, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

export type PaperSearch<T> = {
  results: T[];
  /** What was actually searched, not whatever has since been typed. */
  submittedQuery: string;
  loading: boolean;
  error: string | null;
  search: (query: string, limit: number) => Promise<void>;
};

/**
 * One provider's results, kept for as long as the Research tab is.
 *
 * Each provider panel used to own this state, and the panel was unmounted on
 * every switch, so going arXiv → Sources → arXiv threw the results away.
 * Each search is a query keyed by what it asked, so a slow first search can
 * never land over the answer to a later one; the last answer stays on screen
 * while the next is on its way.
 */
export function usePaperSearch<T>(
  provider: string,
  run: (query: string, limit: number) => Promise<T[]>,
): PaperSearch<T> {
  const [submitted, setSubmitted] = useState<{ query: string; limit: number } | null>(null);
  const read = useQuery({
    queryKey: ['research', provider, submitted],
    queryFn: () => (submitted ? run(submitted.query, submitted.limit) : Promise.resolve([])),
    enabled: submitted !== null,
    placeholderData: keepPreviousData,
  });

  // The query the results on screen answer.
  const [answered, setAnswered] = useState('');
  if (submitted && read.isSuccess && !read.isPlaceholderData && answered !== submitted.query) {
    setAnswered(submitted.query);
  }

  const refetch = read.refetch;
  const search = useCallback(
    async (query: string, limit: number) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      // The same search run again asks again.
      if (submitted?.query === trimmed && submitted.limit === limit) await refetch();
      else setSubmitted({ query: trimmed, limit });
    },
    [refetch, submitted],
  );

  return {
    results: read.isError ? [] : (read.data ?? []),
    submittedQuery: answered,
    loading: read.isFetching,
    error: read.isError ? (read.error instanceof Error ? read.error.message : 'Search failed') : null,
    search,
  };
}
