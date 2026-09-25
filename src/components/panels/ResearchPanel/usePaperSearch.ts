import { useCallback, useRef, useState } from 'react';

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
 * Only the newest request may land: a slow first search must not overwrite
 * the answer to a later one.
 */
export function usePaperSearch<T>(
  run: (query: string, limit: number) => Promise<T[]>,
): PaperSearch<T> {
  const [results, setResults] = useState<T[]>([]);
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const search = useCallback(
    async (query: string, limit: number) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      const request = ++sequence.current;
      setLoading(true);
      setError(null);
      try {
        const next = await run(trimmed, limit);
        if (request !== sequence.current) return;
        setResults(next);
        setSubmittedQuery(trimmed);
      } catch (caught) {
        if (request !== sequence.current) return;
        setError(caught instanceof Error ? caught.message : 'Search failed');
        setResults([]);
      } finally {
        if (request === sequence.current) setLoading(false);
      }
    },
    [run],
  );

  return { results, submittedQuery, loading, error, search };
}
