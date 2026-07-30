import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  attachResource,
  deleteResource,
  extractResource,
  getResource,
  isSettling,
  listResources,
  resourceLocationKey,
  resourceScopeOptions,
  uploadResource,
  type ResourceAttachmentTarget,
  type ResourceItem,
  type ResourceLibraryLocation,
  type SmartResourceScope,
} from '@/services/resources';
import { errorMessage } from '@/services/contracts';
import { createPollSchedule } from '@/lib/pollSchedule';

export const RESOURCE_PAGE_SIZE = 50;

export type LibraryState = {
  resources: ResourceItem[];
  loading: boolean;
  loadingMore: boolean;
  /** A background authoritative refresh; distinct from loading so the list does not blink. */
  refreshing: boolean;
  error: string | null;
  uploading: boolean;
  /** The resource envelope has no total; this is inferred from a full page. */
  hasMore: boolean;
  nextOffset: number | null;
};

export type ResourceLibraryController = LibraryState & {
  location: ResourceLibraryLocation;
  settling: boolean;
  selected: ResourceItem | null;
  selectedId: number | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  select: (resource: ResourceItem | number | null) => Promise<ResourceItem | null>;
  upload: (
    files: File[],
    target?: ResourceAttachmentTarget,
  ) => Promise<{ stored: ResourceItem[]; failures: string[] }>;
  remove: (resourceId: number) => Promise<void>;
  move: (resourceId: number, target?: ResourceAttachmentTarget) => Promise<ResourceItem>;
  replace: (resource: ResourceItem) => void;
  retry: (
    resource: ResourceItem,
    options?: { force?: boolean },
  ) => Promise<ResourceItem>;
};

const INITIAL_STATE: LibraryState = {
  resources: [],
  loading: true,
  loadingMore: false,
  refreshing: false,
  error: null,
  uploading: false,
  hasMore: false,
  nextOffset: null,
};

function legacyLocation(
  scope: SmartResourceScope,
  documentId: string | null,
): ResourceLibraryLocation {
  if (scope === 'library' || documentId === null) return { kind: 'smart', scope: 'library' };
  return { kind: 'smart', scope, documentId };
}

function mergeResources(current: ResourceItem[], incoming: ResourceItem[]): ResourceItem[] {
  const merged = [...current];
  const positions = new Map(current.map((resource, index) => [resource.id, index]));
  for (const resource of incoming) {
    const index = positions.get(resource.id);
    if (index === undefined) {
      positions.set(resource.id, merged.length);
      merged.push(resource);
    } else {
      merged[index] = resource;
    }
  }
  return merged;
}

export function useResourceLibrary(location: ResourceLibraryLocation): ResourceLibraryController;
/** Compatibility overload for the original smart-scope call sites. */
export function useResourceLibrary(
  scope: SmartResourceScope,
  documentId: string | null,
): ResourceLibraryController;
export function useResourceLibrary(
  locationOrScope: ResourceLibraryLocation | SmartResourceScope,
  legacyDocumentId: string | null = null,
): ResourceLibraryController {
  const location =
    typeof locationOrScope === 'string'
      ? legacyLocation(locationOrScope, legacyDocumentId)
      : locationOrScope;
  const {
    scope: resourceScope,
    documentId: scopedDocumentId,
    collectionId: scopedCollectionId,
  } = resourceScopeOptions(location);
  const locationKey = resourceLocationKey(location);

  const [state, setState] = useState<LibraryState>(INITIAL_STATE);
  const [selected, setSelected] = useState<ResourceItem | null>(null);

  const stateRef = useRef(state);
  const selectedRef = useRef(selected);
  const locationKeyRef = useRef(locationKey);
  stateRef.current = state;
  selectedRef.current = selected;
  locationKeyRef.current = locationKey;

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const selectionRequestRef = useRef(0);
  const pollRequestRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollScheduleRef = useRef(createPollSchedule());
  const mutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const refreshCurrentRef = useRef<() => Promise<void>>(async () => undefined);

  const clearPoll = useCallback(() => {
    if (pollRef.current !== null) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      selectionRequestRef.current += 1;
      pollRequestRef.current += 1;
      clearPoll();
    };
  }, [clearPoll]);

  const resetPollSchedule = useCallback(() => {
    pollScheduleRef.current.reset();
  }, []);

  const beginMutation = useCallback(() => {
    generationRef.current += 1;
    selectionRequestRef.current += 1;
    pollRequestRef.current += 1;
    clearPoll();
    return generationRef.current;
  }, [clearPoll]);

  const reload = useCallback(
    async ({ background, preservePages }: { background: boolean; preservePages: boolean }) => {
      const generation = ++generationRef.current;
      pollRequestRef.current += 1;
      clearPoll();
      const key = locationKey;
      const targetCount = preservePages
        ? Math.max(RESOURCE_PAGE_SIZE, stateRef.current.resources.length)
        : RESOURCE_PAGE_SIZE;

      setState((previous) => ({
        ...previous,
        loading: background ? previous.loading : true,
        loadingMore: false,
        refreshing: background,
        error: background ? previous.error : null,
      }));

      try {
        const resources: ResourceItem[] = [];
        let offset = 0;
        let hasMore = false;

        do {
          const response = await listResources({
            scope: resourceScope,
            documentId: scopedDocumentId,
            collectionId: scopedCollectionId,
            limit: RESOURCE_PAGE_SIZE,
            offset,
          });
          if (
            !mountedRef.current ||
            generation !== generationRef.current ||
            key !== locationKeyRef.current
          ) {
            return;
          }

          resources.push(...response.resources);
          const returned = response.count;
          offset = response.offset + returned;
          hasMore = returned === response.limit;
        } while (hasMore && resources.length < targetCount);

        setState((previous) => ({
          ...previous,
          resources,
          loading: false,
          loadingMore: false,
          refreshing: false,
          error: null,
          hasMore,
          nextOffset: hasMore ? offset : null,
        }));
        setSelected((previous) => {
          if (previous === null) return null;
          return resources.find((resource) => resource.id === previous.id) ?? previous;
        });
      } catch (error) {
        if (
          !mountedRef.current ||
          generation !== generationRef.current ||
          key !== locationKeyRef.current
        ) {
          return;
        }
        setState((previous) => ({
          ...previous,
          loading: false,
          loadingMore: false,
          refreshing: false,
          error: errorMessage(error, 'Could not load your library'),
        }));
      }
    },
    [
      clearPoll,
      locationKey,
      resourceScope,
      scopedCollectionId,
      scopedDocumentId,
    ],
  );

  useEffect(() => {
    selectionRequestRef.current += 1;
    resetPollSchedule();
    setSelected(null);
    setState(INITIAL_STATE);
    void reload({ background: false, preservePages: false });
  }, [locationKey, reload, resetPollSchedule]);

  const refresh = useCallback(async () => {
    resetPollSchedule();
    await reload({ background: true, preservePages: true });
  }, [reload, resetPollSchedule]);
  refreshCurrentRef.current = refresh;

  const loadMore = useCallback(async () => {
    const snapshot = stateRef.current;
    if (snapshot.loading || snapshot.loadingMore || snapshot.nextOffset === null) return;

    const generation = generationRef.current;
    const offset = snapshot.nextOffset;
    const key = locationKey;
    setState((previous) => ({ ...previous, loadingMore: true, error: null }));

    try {
      const response = await listResources({
        scope: resourceScope,
        documentId: scopedDocumentId,
        collectionId: scopedCollectionId,
        limit: RESOURCE_PAGE_SIZE,
        offset,
      });
      if (
        !mountedRef.current ||
        generation !== generationRef.current ||
        key !== locationKeyRef.current
      ) {
        return;
      }
      const nextOffset = response.offset + response.count;
      const hasMore = response.count === response.limit;
      setState((previous) => ({
        ...previous,
        resources: mergeResources(previous.resources, response.resources),
        loadingMore: false,
        hasMore,
        nextOffset: hasMore ? nextOffset : null,
      }));
      setSelected((previous) => {
        if (previous === null) return null;
        return response.resources.find((resource) => resource.id === previous.id) ?? previous;
      });
    } catch (error) {
      if (
        !mountedRef.current ||
        generation !== generationRef.current ||
        key !== locationKeyRef.current
      ) {
        return;
      }
      setState((previous) => ({
        ...previous,
        loadingMore: false,
        error: errorMessage(error, 'Could not load more resources'),
      }));
    }
  }, [locationKey, resourceScope, scopedCollectionId, scopedDocumentId]);

  const settlingResources = useMemo(() => {
    const byId = new Map<number, ResourceItem>();
    for (const resource of state.resources) {
      if (isSettling(resource)) byId.set(resource.id, resource);
    }
    if (selected && isSettling(selected)) byId.set(selected.id, selected);
    return [...byId.values()];
  }, [selected, state.resources]);

  useEffect(() => {
    clearPoll();
    if (settlingResources.length === 0) {
      resetPollSchedule();
      return;
    }
    const schedule = pollScheduleRef.current;
    if (schedule.exhausted()) return;

    const delay = schedule.delay();
    const ids = settlingResources.map((resource) => resource.id);
    const key = locationKey;
    pollRef.current = setTimeout(() => {
      schedule.advance();
      const generation = generationRef.current;
      const request = ++pollRequestRef.current;

      void Promise.allSettled(ids.map((resourceId) => getResource(resourceId))).then((results) => {
        if (
          !mountedRef.current ||
          generation !== generationRef.current ||
          request !== pollRequestRef.current ||
          key !== locationKeyRef.current
        ) {
          return;
        }
        const refreshed = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        );
        setState((previous) => ({
          ...previous,
          resources: mergeResources(previous.resources, refreshed).filter((resource) =>
            previous.resources.some((current) => current.id === resource.id),
          ),
        }));
        setSelected((previous) => {
          if (previous === null) return null;
          return refreshed.find((resource) => resource.id === previous.id) ?? previous;
        });
      });
    }, delay);

    return clearPoll;
  }, [clearPoll, locationKey, resetPollSchedule, settlingResources]);

  const select = useCallback(async (resource: ResourceItem | number | null) => {
    const request = ++selectionRequestRef.current;
    if (resource === null) {
      setSelected(null);
      return null;
    }
    if (typeof resource !== 'number') {
      setSelected(resource);
      return resource;
    }

    const loaded = stateRef.current.resources.find((item) => item.id === resource);
    if (loaded) {
      setSelected(loaded);
      return loaded;
    }

    const key = locationKeyRef.current;
    setState((previous) => ({ ...previous, error: null }));
    try {
      const fetched = await getResource(resource);
      if (
        !mountedRef.current ||
        request !== selectionRequestRef.current ||
        key !== locationKeyRef.current
      ) {
        return null;
      }
      setSelected(fetched);
      return fetched;
    } catch (error) {
      if (
        mountedRef.current &&
        request === selectionRequestRef.current &&
        key === locationKeyRef.current
      ) {
        setState((previous) => ({
          ...previous,
          error: errorMessage(error, 'Could not load that resource'),
        }));
      }
      throw error;
    }
  }, []);

  const replace = useCallback((resource: ResourceItem) => {
    setState((previous) => ({
      ...previous,
      resources: previous.resources.map((item) =>
        item.id === resource.id ? resource : item,
      ),
    }));
    setSelected((previous) => (previous?.id === resource.id ? resource : previous));
  }, []);

  const enqueueMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const run = mutationTailRef.current.then(operation);
    mutationTailRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const upload = useCallback(
    async (
      files: File[],
      target: ResourceAttachmentTarget = {},
    ): Promise<{ stored: ResourceItem[]; failures: string[] }> => {
      if (files.length === 0) return { stored: [], failures: [] };
      return enqueueMutation(async () => {
        beginMutation();
        setState((previous) => ({ ...previous, uploading: true }));
        const stored: ResourceItem[] = [];
        const failures: string[] = [];

        try {
          for (const file of files) {
            try {
              stored.push(await uploadResource(file, target));
            } catch (error) {
              failures.push(`${file.name}: ${errorMessage(error, 'Upload failed')}`);
            }
          }
          if (mountedRef.current) {
            setState((previous) => ({
              ...previous,
              resources:
                locationKeyRef.current === locationKey
                  ? mergeResources(stored, previous.resources)
                  : previous.resources,
            }));
          }
          // Upload responses are already authoritative rows. Keeping them avoids
          // a just-created item disappearing behind a replica/transaction lag;
          // polling refreshes only the extraction fields that are still settling.
          resetPollSchedule();
          return { stored, failures };
        } finally {
          if (mountedRef.current) {
            setState((previous) => ({ ...previous, uploading: false }));
          }
        }
      });
    },
    [beginMutation, enqueueMutation, locationKey, resetPollSchedule],
  );

  const remove = useCallback(
    (resourceId: number) =>
      enqueueMutation(async () => {
        beginMutation();
        setState((previous) => ({
          ...previous,
          resources: previous.resources.filter((item) => item.id !== resourceId),
        }));
        setSelected((previous) => (previous?.id === resourceId ? null : previous));
        try {
          await deleteResource(resourceId);
          await refreshCurrentRef.current();
        } catch (error) {
          await refreshCurrentRef.current();
          throw error;
        }
      }),
    [beginMutation, enqueueMutation],
  );

  const move = useCallback(
    (resourceId: number, target: ResourceAttachmentTarget = {}) =>
      enqueueMutation(async () => {
        beginMutation();
        const mutationLocationKey = locationKeyRef.current;
        const optimisticDocumentId = target.documentId ?? null;
        const optimisticCollectionId = target.documentId ? null : (target.collectionId ?? null);
        const optimistic = (resource: ResourceItem): ResourceItem => ({
          ...resource,
          document_id: optimisticDocumentId,
          document_name: null,
          collection_id: optimisticCollectionId,
          collection_name: null,
        });
        setState((previous) => ({
          ...previous,
          resources: previous.resources.map((resource) =>
            resource.id === resourceId ? optimistic(resource) : resource,
          ),
        }));
        setSelected((previous) =>
          previous?.id === resourceId ? optimistic(previous) : previous,
        );

        try {
          const updated = await attachResource(resourceId, target);
          if (mountedRef.current && mutationLocationKey === locationKeyRef.current) {
            replace(updated);
          }
          await refreshCurrentRef.current();
          return updated;
        } catch (error) {
          await refreshCurrentRef.current();
          throw error;
        }
      }),
    [beginMutation, enqueueMutation, replace],
  );

  const retry = useCallback(
    (resource: ResourceItem, { force = false }: { force?: boolean } = {}) =>
      enqueueMutation(async () => {
        beginMutation();
        const mutationLocationKey = locationKeyRef.current;
        replace({ ...resource, extraction_status: 'running', extraction_error: null });
        try {
          const updated = await extractResource(resource.id, { force });
          if (mountedRef.current && mutationLocationKey === locationKeyRef.current) {
            replace(updated);
          }
          resetPollSchedule();
          return updated;
        } catch (error) {
          if (mountedRef.current && mutationLocationKey === locationKeyRef.current) {
            replace(resource);
          }
          await refreshCurrentRef.current();
          throw error;
        }
      }),
    [beginMutation, enqueueMutation, replace, resetPollSchedule],
  );

  return {
    ...state,
    location,
    settling: settlingResources.length > 0,
    selected,
    selectedId: selected?.id ?? null,
    refresh,
    loadMore,
    select,
    upload,
    remove,
    move,
    replace,
    retry,
  };
}
