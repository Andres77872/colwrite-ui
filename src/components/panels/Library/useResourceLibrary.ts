import { useCallback, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  addUploadedResources,
  isSettling,
  patchResource,
  resourceListQuery,
  resourceLocationKey,
  resourceQuery,
  resourceScopeOptions,
  resourcesOf,
  useExtractResource,
  useMoveResource,
  useRenameResource,
  type ResourceAttachmentTarget,
  type ResourceItem,
  type ResourceLibraryLocation,
  type ResourceListResponse,
} from '@/data/resources';
import { describeApiError } from '@/api/errors';
import { settlingPollInterval } from '@/lib/pollSchedule';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';

export const RESOURCE_PAGE_SIZE = 50;

export type LibraryState = {
  resources: ResourceItem[];
  loading: boolean;
  loadingMore: boolean;
  /** A refresh the author asked for; distinct from loading so the list does not blink. */
  refreshing: boolean;
  error: string | null;
  /** The list holds no total; a next cursor means there is more. */
  hasMore: boolean;
};

export type ResourceLibraryController = LibraryState & {
  location: ResourceLibraryLocation | null;
  settling: boolean;
  selected: ResourceItem | null;
  selectedId: number | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  select: (resource: ResourceItem | number | null) => Promise<ResourceItem | null>;
  /**
   * Show PDFs that were just uploaded (through `useUploadPdfs`) at the top of
   * this list. Upload responses are authoritative rows, so a new PDF never
   * disappears behind a refresh that has not seen it yet.
   */
  addUploaded: (resources: ResourceItem[]) => void;
  move: (resourceId: number, target?: ResourceAttachmentTarget) => Promise<ResourceItem>;
  replace: (resource: ResourceItem) => void;
  retry: (
    resource: ResourceItem,
    options?: { force?: boolean },
  ) => Promise<ResourceItem>;
  /** Give a PDF a new file name; it shows at once. */
  rename: (resource: ResourceItem, filename: string) => Promise<ResourceItem>;
};

/** Nothing to list. The key is never read: the query is off without a location. */
const NO_SCOPE = { scope: 'library' } as const;

/**
 * Keep reading while something is still converting, backing off from 1.5 s
 * to 15 s and stopping after four minutes (`settlingPollInterval`). The
 * schedule starts again once nothing is converting.
 */
function useSettlingPoll<T>(settling: (data: T | undefined) => boolean) {
  const since = useRef<number | null>(null);
  return useCallback(
    (query: { state: { data: T | undefined; dataUpdatedAt: number } }): number | false => {
      if (!settling(query.state.data)) {
        since.current = null;
        return false;
      }
      // Measured between reads, so the interval holds still between them.
      const at = query.state.dataUpdatedAt;
      since.current ??= at;
      return settlingPollInterval(at - since.current);
    },
    [settling],
  );
}

/**
 * One list of PDFs at a location, kept fresh while their text is converting.
 * A `null` location lists nothing and makes no request.
 */
export function useResourceLibrary(location: ResourceLibraryLocation | null): ResourceLibraryController {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceId();
  const locationKey = location ? resourceLocationKey(location) : null;
  // One scope per place, whatever object the caller described it with.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scope = useMemo(() => (location ? resourceScopeOptions(location) : null), [locationKey]);
  const listOptions = resourceListQuery(workspaceId, scope ?? NO_SCOPE, RESOURCE_PAGE_SIZE);
  const listPoll = useSettlingPoll(
    useCallback((data: InfiniteData<ResourceListResponse> | undefined) => resourcesOf(data).some(isSettling), []),
  );
  const list = useInfiniteQuery({
    ...listOptions,
    enabled: scope !== null,
    refetchInterval: listPoll,
  });

  const resources = useMemo(() => (scope ? resourcesOf(list.data) : []), [list.data, scope]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const listedSelection = selectedId === null ? undefined : resources.find((resource) => resource.id === selectedId);
  // A PDF outside the loaded pages is read on its own, and kept fresh the same way.
  const detailPoll = useSettlingPoll(useCallback((data: ResourceItem | undefined) => Boolean(data && isSettling(data)), []));
  const detail = useQuery({
    ...resourceQuery(workspaceId, selectedId ?? 0),
    enabled: selectedId !== null && listedSelection === undefined,
    refetchInterval: detailPoll,
  });
  const selected = selectedId === null ? null : (listedSelection ?? detail.data ?? null);

  const [refreshing, setRefreshing] = useState(false);
  const refetchList = list.refetch;
  const refresh = useCallback(async () => {
    if (!scope) return;
    setRefreshing(true);
    try {
      await refetchList();
    } finally {
      setRefreshing(false);
    }
  }, [refetchList, scope]);

  const { fetchNextPage, hasNextPage, isFetching } = list;
  const loadMore = useCallback(async () => {
    if (!hasNextPage || isFetching) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetching]);

  const select = useCallback(
    async (resource: ResourceItem | number | null): Promise<ResourceItem | null> => {
      if (resource === null) {
        setSelectedId(null);
        return null;
      }
      if (typeof resource !== 'number') {
        queryClient.setQueryData(resourceQuery(workspaceId, resource.id).queryKey, resource);
        setSelectedId(resource.id);
        return resource;
      }
      setSelectedId(resource);
      const listed = resources.find((item) => item.id === resource);
      return listed ?? queryClient.fetchQuery(resourceQuery(workspaceId, resource));
    },
    [queryClient, resources, workspaceId],
  );

  const replace = useCallback(
    (resource: ResourceItem) => patchResource(queryClient, workspaceId, resource),
    [queryClient, workspaceId],
  );

  const addUploaded = useCallback(
    (uploaded: ResourceItem[]) =>
      addUploadedResources(
        queryClient,
        uploaded,
        scope ? resourceListQuery(workspaceId, scope, RESOURCE_PAGE_SIZE).queryKey : null,
      ),
    [queryClient, scope, workspaceId],
  );

  const moveResource = useMoveResource(workspaceId).mutateAsync;
  const extract = useExtractResource(workspaceId).mutateAsync;
  const renameResource = useRenameResource(workspaceId).mutateAsync;

  const move = useCallback(
    (resourceId: number, target: ResourceAttachmentTarget = {}) => moveResource({ resourceId, target }),
    [moveResource],
  );
  const retry = useCallback(
    (resource: ResourceItem, { force = false }: { force?: boolean } = {}) => extract({ resource, force }),
    [extract],
  );
  const rename = useCallback(
    (resource: ResourceItem, filename: string) => renameResource({ resource, filename }),
    [renameResource],
  );

  const error = list.isFetchNextPageError
    ? describeApiError(list.error, 'Could not load more PDFs')
    : list.isError
      ? describeApiError(list.error, 'Could not load your Library')
      : detail.isError && listedSelection === undefined
        ? describeApiError(detail.error, 'Could not load that PDF')
        : null;

  return {
    resources,
    loading: scope !== null && list.isPending,
    loadingMore: list.isFetchingNextPage,
    refreshing,
    error,
    hasMore: scope !== null && list.hasNextPage,
    location,
    settling: resources.some(isSettling) || Boolean(selected && isSettling(selected)),
    selected,
    selectedId: selected?.id ?? null,
    refresh,
    loadMore,
    select,
    addUploaded,
    move,
    replace,
    retry,
    rename,
  };
}
