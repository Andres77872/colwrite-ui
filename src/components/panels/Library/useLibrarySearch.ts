import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { errorMessage } from '@/api/errors';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import {
  resourceLocationKey,
  resourceScopeOptions,
  resourceSearchQuery,
  searchResultOf,
  type ResourceLibraryLocation,
  type ResourceSearchResponse,
} from '@/data/resources';

export type LibrarySearch = {
  result: ResourceSearchResponse | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** Search inside the PDFs at the current location. An empty term clears. */
  search: (term: string) => Promise<void>;
  loadMore: () => Promise<void>;
  clear: () => void;
};

/** A collection is searched with everything inside it. */
function searchScope(location: ResourceLibraryLocation) {
  return resourceScopeOptions(
    location.kind === 'collection' ? { ...location, recursive: true } : location,
  );
}

/**
 * The one search inside PDFs. The Library runs it over whatever it is showing,
 * and Research's "Search inside my PDFs" hands its query to the Library rather
 * than keeping a second controller and a second result list.
 *
 * A search answers the query that was run at the place it was run: moving to
 * another location shows nothing until a search is run there, so an answer
 * never lands under a scope it was not asked for.
 */
export function useLibrarySearch(location: ResourceLibraryLocation): LibrarySearch {
  const workspaceId = useWorkspaceId();
  const key = resourceLocationKey(location);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scope = useMemo(() => searchScope(location), [key]);
  const [ran, setRan] = useState<{ key: string; query: string } | null>(null);
  const current = ran?.key === key ? ran : null;

  const search = useInfiniteQuery({
    ...resourceSearchQuery(workspaceId, scope, current?.query ?? ''),
    enabled: current !== null,
  });

  const { refetch, fetchNextPage, hasNextPage, isFetching } = search;
  const run = useCallback(
    async (term: string) => {
      const query = term.trim();
      if (!query) {
        setRan(null);
        return;
      }
      // The same search run again asks the server again.
      if (current?.query === query) {
        await refetch();
        return;
      }
      setRan({ key, query });
    },
    [current, key, refetch],
  );

  const loadMore = useCallback(async () => {
    if (!current || !hasNextPage || isFetching) return;
    await fetchNextPage();
  }, [current, fetchNextPage, hasNextPage, isFetching]);

  const clear = useCallback(() => setRan(null), []);

  const result = current ? searchResultOf(search.data) : null;
  const error = !current
    ? null
    : search.isFetchNextPageError
      ? errorMessage(search.error, 'Could not search more PDFs')
      : search.isError
        ? errorMessage(search.error, 'Search failed')
        : null;

  return {
    // A failed search shows its error, not the answer before it.
    result: search.isError && !search.isFetchNextPageError ? null : result,
    loading: current !== null && search.isFetching && !search.isFetchingNextPage,
    loadingMore: search.isFetchingNextPage,
    error,
    search: run,
    loadMore,
    clear,
  };
}
