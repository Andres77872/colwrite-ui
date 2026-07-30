import { useCallback, useEffect, useRef, useState } from 'react';
import {
  attachCollectionDocument,
  createChildCollection,
  createCollection,
  deleteCollectionRecursive,
  detachCollectionDocument,
  getCollectionDetail,
  listCollectionTree,
  moveCollectionParent,
  previewCollectionDelete,
  updateCollection,
  type CollectionAttachmentState,
  type CollectionBreadcrumbItem,
  type CollectionDeletePreview,
  type CollectionDetailResponse,
  type CollectionItem,
  type CollectionRecursiveDeleteResponse,
  type CollectionTreeResponse,
} from '@/services/resources';
import { errorMessage } from '@/services/contracts';

export const COLLECTION_TREE_PAGE_SIZE = 50;
const ROOT_BRANCH_KEY = 'root';

export type CollectionTreeBranch = {
  parentId: number | null;
  /** Exact backend pages retained so next_offset remains authoritative. */
  pages: CollectionTreeResponse[];
  /** De-duplicated immediate children across the cached pages. */
  collections: CollectionItem[];
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextOffset: number | null;
};

export type UseCollectionTreeOptions = {
  documentId?: string | null;
  pageSize?: number;
};

export type CollectionTreeController = {
  branches: Readonly<Record<string, CollectionTreeBranch>>;
  roots: CollectionItem[];
  expandedIds: ReadonlySet<number>;
  selectedId: number | null;
  selectedCollection: CollectionItem | null;
  selectedParentId: number | null;
  path: CollectionBreadcrumbItem[];
  attachment: CollectionAttachmentState | null;
  selecting: boolean;
  selectionError: string | null;
  childrenOf: (parentId: number | null) => CollectionItem[];
  loadChildren: (parentId: number | null, options?: { force?: boolean }) => Promise<void>;
  loadMore: (parentId: number | null) => Promise<void>;
  setExpanded: (collectionId: number, expanded: boolean) => Promise<void>;
  toggleExpanded: (collectionId: number) => Promise<void>;
  selectCollection: (collectionId: number | null) => Promise<CollectionDetailResponse | null>;
  refreshSelected: () => Promise<CollectionDetailResponse | null>;
  /** Refresh every branch the user has actually opened, preserving pagination depth. */
  refreshLoaded: () => Promise<void>;
  createFolder: (input: {
    name: string;
    description?: string | null;
    parentId?: number | null;
  }) => Promise<CollectionItem>;
  renameFolder: (
    collectionId: number,
    changes: { name?: string; description?: string | null },
  ) => Promise<CollectionItem>;
  moveFolder: (collectionId: number, parentId: number | null) => Promise<CollectionItem>;
  previewDelete: (collectionId: number) => Promise<CollectionDeletePreview>;
  deleteFolder: (
    collectionId: number,
    expected: CollectionDeletePreview,
  ) => Promise<CollectionRecursiveDeleteResponse>;
  attachDocument: (collectionId: number, documentId?: string) => Promise<CollectionAttachmentState | null>;
  detachDocument: (collectionId: number, documentId?: string) => Promise<CollectionAttachmentState | null>;
};

function branchKey(parentId: number | null): string {
  return parentId === null ? ROOT_BRANCH_KEY : String(parentId);
}

function emptyBranch(parentId: number | null): CollectionTreeBranch {
  return {
    parentId,
    pages: [],
    collections: [],
    loaded: false,
    loading: false,
    loadingMore: false,
    error: null,
    nextOffset: null,
  };
}

function mergeCollections(current: CollectionItem[], incoming: CollectionItem[]): CollectionItem[] {
  const merged = [...current];
  const positions = new Map(current.map((collection, index) => [collection.id, index]));
  for (const collection of incoming) {
    const index = positions.get(collection.id);
    if (index === undefined) {
      positions.set(collection.id, merged.length);
      merged.push(collection);
    } else {
      merged[index] = collection;
    }
  }
  return merged;
}

function findCollection(
  branches: Readonly<Record<string, CollectionTreeBranch>>,
  collectionId: number,
): CollectionItem | null {
  for (const branch of Object.values(branches)) {
    const found = branch.collections.find((collection) => collection.id === collectionId);
    if (found) return found;
  }
  return null;
}

/** Loaded descendants whose branch caches are affected by subtree mutations. */
function loadedSubtreeIds(
  branches: Readonly<Record<string, CollectionTreeBranch>>,
  collectionId: number,
): Set<number> {
  const ids = new Set<number>([collectionId]);
  const queue = [collectionId];
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (parentId === undefined) break;
    const branch = branches[branchKey(parentId)];
    if (!branch?.loaded) continue;
    for (const child of branch.collections) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

function replaceCollectionEverywhere(
  branches: Readonly<Record<string, CollectionTreeBranch>>,
  collection: CollectionItem,
): Record<string, CollectionTreeBranch> {
  const next: Record<string, CollectionTreeBranch> = {};
  for (const [key, branch] of Object.entries(branches)) {
    next[key] = {
      ...branch,
      collections: branch.collections.map((item) =>
        item.id === collection.id
          ? {
              ...collection,
              // Mutation/detail envelopes do not carry document-specific
              // attachment state. Preserve the branch value until an
              // attachment-aware tree refresh replaces it canonically.
              attachment: collection.attachment ?? item.attachment,
            }
          : item,
      ),
      pages: branch.pages.map((page) => ({
        ...page,
        collections: page.collections.map((item) =>
          item.id === collection.id
            ? { ...collection, attachment: collection.attachment ?? item.attachment }
            : item,
        ),
      })),
    };
  }
  return next;
}

export function useCollectionTree(
  options: UseCollectionTreeOptions = {},
): CollectionTreeController {
  const documentId = options.documentId ?? null;
  const pageSize = options.pageSize ?? COLLECTION_TREE_PAGE_SIZE;

  const [branches, setBranches] = useState<Record<string, CollectionTreeBranch>>({});
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<CollectionItem | null>(null);
  const [path, setPath] = useState<CollectionBreadcrumbItem[]>([]);
  const [attachment, setAttachment] = useState<CollectionAttachmentState | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const branchesRef = useRef(branches);
  const expandedRef = useRef(expandedIds);
  const selectedIdRef = useRef(selectedId);
  const documentIdRef = useRef(documentId);
  branchesRef.current = branches;
  expandedRef.current = expandedIds;
  selectedIdRef.current = selectedId;
  documentIdRef.current = documentId;

  const mountedRef = useRef(true);
  const epochRef = useRef(0);
  const branchRequestsRef = useRef(new Map<string, number>());
  const selectionRequestRef = useRef(0);
  const mutationTailRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    mountedRef.current = true;
    const branchRequests = branchRequestsRef.current;
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
      selectionRequestRef.current += 1;
      branchRequests.clear();
    };
  }, []);

  const nextBranchRequest = useCallback((key: string) => {
    const next = (branchRequestsRef.current.get(key) ?? 0) + 1;
    branchRequestsRef.current.set(key, next);
    return next;
  }, []);

  const invalidateBranches = useCallback(
    (parentIds: Iterable<number | null>) => {
      const keys = new Set<string>();
      for (const parentId of parentIds) {
        const key = branchKey(parentId);
        keys.add(key);
        nextBranchRequest(key);
      }
      if (keys.size === 0) return;
      setBranches((previous) => {
        const next = { ...previous };
        for (const key of keys) {
          const branch = next[key];
          if (branch) {
            next[key] = { ...branch, loading: false, loadingMore: false };
          }
        }
        return next;
      });
    },
    [nextBranchRequest],
  );

  const requestBranch = useCallback(
    async (
      parentId: number | null,
      mode: 'replace' | 'append',
      targetCount = pageSize,
    ) => {
      const key = branchKey(parentId);
      const snapshot = branchesRef.current[key] ?? emptyBranch(parentId);
      if (mode === 'append' && (snapshot.loadingMore || snapshot.nextOffset === null)) return;
      if (mode === 'replace' && snapshot.loading) return;

      const request = nextBranchRequest(key);
      const epoch = epochRef.current;
      const startOffset = mode === 'append' ? snapshot.nextOffset : 0;
      if (startOffset === null) return;

      setBranches((previous) => {
        const current = previous[key] ?? emptyBranch(parentId);
        return {
          ...previous,
          [key]: {
            ...current,
            loading: mode === 'replace',
            loadingMore: mode === 'append',
            error: null,
          },
        };
      });

      try {
        const fetchedPages: CollectionTreeResponse[] = [];
        let offset = startOffset;
        let fetchedCount = 0;
        let nextOffset: number | null = startOffset;

        do {
          const page = await listCollectionTree({
            parentId,
            documentId: documentIdRef.current,
            limit: pageSize,
            offset,
          });
          if (
            !mountedRef.current ||
            epoch !== epochRef.current ||
            request !== branchRequestsRef.current.get(key)
          ) {
            return;
          }
          fetchedPages.push(page);
          fetchedCount += page.count;
          nextOffset = page.next_offset;
          if (nextOffset !== null) offset = nextOffset;
        } while (mode === 'replace' && nextOffset !== null && fetchedCount < targetCount);

        setBranches((previous) => {
          const current = previous[key] ?? emptyBranch(parentId);
          const pages = mode === 'append' ? [...current.pages, ...fetchedPages] : fetchedPages;
          const collections =
            mode === 'append'
              ? mergeCollections(
                  current.collections,
                  fetchedPages.flatMap((page) => page.collections),
                )
              : fetchedPages.flatMap((page) => page.collections);
          return {
            ...previous,
            [key]: {
              parentId,
              pages,
              collections,
              loaded: true,
              loading: false,
              loadingMore: false,
              error: null,
              nextOffset,
            },
          };
        });
      } catch (error) {
        if (
          !mountedRef.current ||
          epoch !== epochRef.current ||
          request !== branchRequestsRef.current.get(key)
        ) {
          return;
        }
        setBranches((previous) => {
          const current = previous[key] ?? emptyBranch(parentId);
          return {
            ...previous,
            [key]: {
              ...current,
              loading: false,
              loadingMore: false,
              error: errorMessage(error, 'Could not load folders'),
            },
          };
        });
      }
    },
    [nextBranchRequest, pageSize],
  );

  useEffect(() => {
    epochRef.current += 1;
    selectionRequestRef.current += 1;
    branchRequestsRef.current.clear();
    branchesRef.current = {};
    setBranches({});
    setExpandedIds(new Set());
    setSelectedId(null);
    setSelectedCollection(null);
    setPath([]);
    setAttachment(null);
    setSelecting(false);
    setSelectionError(null);
    void requestBranch(null, 'replace');
  }, [documentId, pageSize, requestBranch]);

  const loadChildren = useCallback(
    async (parentId: number | null, { force = false }: { force?: boolean } = {}) => {
      const branch = branchesRef.current[branchKey(parentId)];
      if (branch?.loaded && !force) return;
      await requestBranch(
        parentId,
        'replace',
        force ? Math.max(pageSize, branch?.collections.length ?? 0) : pageSize,
      );
    },
    [pageSize, requestBranch],
  );

  const loadMore = useCallback(
    async (parentId: number | null) => {
      await requestBranch(parentId, 'append');
    },
    [requestBranch],
  );

  const setExpanded = useCallback(
    async (collectionId: number, expanded: boolean) => {
      setExpandedIds((previous) => {
        const next = new Set(previous);
        if (expanded) next.add(collectionId);
        else next.delete(collectionId);
        return next;
      });
      if (expanded) await loadChildren(collectionId);
    },
    [loadChildren],
  );

  const toggleExpanded = useCallback(
    async (collectionId: number) => {
      await setExpanded(collectionId, !expandedRef.current.has(collectionId));
    },
    [setExpanded],
  );

  const selectCollection = useCallback(
    async (collectionId: number | null): Promise<CollectionDetailResponse | null> => {
      const request = ++selectionRequestRef.current;
      if (collectionId === null) {
        setSelectedId(null);
        setSelectedCollection(null);
        setPath([]);
        setAttachment(null);
        setSelecting(false);
        setSelectionError(null);
        return null;
      }

      const epoch = epochRef.current;
      setSelectedId(collectionId);
      setSelecting(true);
      setSelectionError(null);
      try {
        const detail = await getCollectionDetail(collectionId, {
          documentId: documentIdRef.current,
        });
        if (
          !mountedRef.current ||
          epoch !== epochRef.current ||
          request !== selectionRequestRef.current
        ) {
          return null;
        }
        const collection =
          documentIdRef.current === null
            ? detail.collection
            : { ...detail.collection, attachment: detail.attachment };
        setSelectedCollection(collection);
        setPath(detail.path);
        setAttachment(detail.attachment);
        setSelecting(false);
        setBranches((previous) => replaceCollectionEverywhere(previous, collection));
        return { ...detail, collection };
      } catch (error) {
        if (
          !mountedRef.current ||
          epoch !== epochRef.current ||
          request !== selectionRequestRef.current
        ) {
          return null;
        }
        setSelecting(false);
        setSelectionError(errorMessage(error, 'Could not load that folder'));
        throw error;
      }
    },
    [],
  );

  const refreshSelected = useCallback(async () => {
    return selectCollection(selectedIdRef.current);
  }, [selectCollection]);

  const enqueueMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const run = mutationTailRef.current.then(operation);
    mutationTailRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const refreshKnownBranches = useCallback(
    async (parentIds: Iterable<number | null>) => {
      const requests: Promise<void>[] = [];
      const seen = new Set<string>();
      for (const parentId of parentIds) {
        const key = branchKey(parentId);
        if (seen.has(key)) continue;
        seen.add(key);
        const branch = branchesRef.current[key];
        if (parentId !== null && !branch?.loaded) continue;
        requests.push(
          requestBranch(
            parentId,
            'replace',
            Math.max(pageSize, branch?.collections.length ?? 0),
          ),
        );
      }
      await Promise.all(requests);
    },
    [pageSize, requestBranch],
  );

  const refreshLoaded = useCallback(async () => {
    const loadedParentIds = Object.values(branchesRef.current)
      .filter((branch) => branch.loaded)
      .map((branch) => branch.parentId);
    await refreshKnownBranches(loadedParentIds);
  }, [refreshKnownBranches]);

  const parentRefreshTargets = useCallback((collectionId: number): Array<number | null> => {
    const current = findCollection(branchesRef.current, collectionId);
    const parent = current?.parent_id ?? null;
    const parentItem = parent === null ? null : findCollection(branchesRef.current, parent);
    return [parent, parentItem?.parent_id ?? null];
  }, []);

  const createFolder = useCallback(
    (input: { name: string; description?: string | null; parentId?: number | null }) =>
      enqueueMutation(async () => {
        const parentId = input.parentId ?? null;
        const parentItem =
          parentId === null ? null : findCollection(branchesRef.current, parentId);
        const affected = [parentId, parentItem?.parent_id ?? null];
        invalidateBranches(affected);
        try {
          const created =
            parentId === null
              ? await createCollection(input.name, input.description, null)
              : await createChildCollection(parentId, input.name, input.description);
          await refreshKnownBranches(affected);
          if (selectedIdRef.current === parentId) await refreshSelected();
          return created;
        } catch (error) {
          await refreshKnownBranches(affected);
          throw error;
        }
      }),
    [enqueueMutation, invalidateBranches, refreshKnownBranches, refreshSelected],
  );

  const renameFolder = useCallback(
    (collectionId: number, changes: { name?: string; description?: string | null }) =>
      enqueueMutation(async () => {
        const affected = parentRefreshTargets(collectionId);
        invalidateBranches(affected);
        try {
          const updated = await updateCollection(collectionId, changes);
          if (mountedRef.current) {
            setBranches((previous) => replaceCollectionEverywhere(previous, updated));
            setSelectedCollection((previous) =>
              previous?.id === collectionId
                ? { ...updated, attachment: updated.attachment ?? previous.attachment }
                : previous,
            );
            setPath((previous) =>
              previous.map((crumb) =>
                crumb.id === collectionId ? { ...crumb, name: updated.name } : crumb,
              ),
            );
          }
          await refreshKnownBranches(affected);
          return updated;
        } catch (error) {
          await refreshKnownBranches(affected);
          throw error;
        }
      }),
    [enqueueMutation, invalidateBranches, parentRefreshTargets, refreshKnownBranches],
  );

  const moveFolder = useCallback(
    (collectionId: number, parentId: number | null) =>
      enqueueMutation(async () => {
        const snapshot = branchesRef.current;
        const current = findCollection(snapshot, collectionId);
        const oldParent = current?.parent_id ?? null;
        const oldParentItem = oldParent === null ? null : findCollection(snapshot, oldParent);
        const newParentItem = parentId === null ? null : findCollection(snapshot, parentId);
        const subtree = loadedSubtreeIds(snapshot, collectionId);
        const affected = new Set<number | null>([
          oldParent,
          parentId,
          oldParentItem?.parent_id ?? null,
          newParentItem?.parent_id ?? null,
          ...subtree,
        ]);
        invalidateBranches(affected);
        const selected = selectedIdRef.current;
        const selectionAffected =
          selected !== null &&
          (selected === collectionId ||
            subtree.has(selected) ||
            path.some((crumb) => crumb.id === collectionId));
        if (selectionAffected) {
          // A detail request started before the move can carry the old path,
          // depth, and parent. Invalidate it before the server mutation.
          selectionRequestRef.current += 1;
          setSelecting(false);
        }
        try {
          const moved = await moveCollectionParent(collectionId, parentId);
          if (mountedRef.current) {
            setBranches((previous) => replaceCollectionEverywhere(previous, moved));
          }
          await refreshKnownBranches(affected);
          if (selectionAffected || selectedIdRef.current === collectionId) {
            await refreshSelected();
          }
          return moved;
        } catch (error) {
          await refreshKnownBranches(affected);
          if (selectionAffected) await refreshSelected();
          throw error;
        }
      }),
    [enqueueMutation, invalidateBranches, path, refreshKnownBranches, refreshSelected],
  );

  const previewDelete = useCallback(
    (collectionId: number) => previewCollectionDelete(collectionId),
    [],
  );

  const deleteFolder = useCallback(
    (collectionId: number, expected: CollectionDeletePreview) =>
      enqueueMutation(async () => {
        const snapshot = branchesRef.current;
        const current = findCollection(snapshot, collectionId);
        const parentId = current?.parent_id ?? null;
        const parentItem = parentId === null ? null : findCollection(snapshot, parentId);
        const subtree = loadedSubtreeIds(snapshot, collectionId);
        const affected = new Set<number | null>([
          parentId,
          parentItem?.parent_id ?? null,
          ...subtree,
        ]);
        invalidateBranches(affected);
        try {
          const result = await deleteCollectionRecursive(collectionId, expected);
          if (mountedRef.current) {
            setBranches((previous) => {
              const next: Record<string, CollectionTreeBranch> = {};
              for (const [key, branch] of Object.entries(previous)) {
                if (key !== ROOT_BRANCH_KEY && subtree.has(Number(key))) continue;
                next[key] = {
                  ...branch,
                  collections: branch.collections.filter((item) => !subtree.has(item.id)),
                  pages: branch.pages.map((page) => ({
                    ...page,
                    collections: page.collections.filter((item) => !subtree.has(item.id)),
                  })),
                };
              }
              return next;
            });
            setExpandedIds((previous) => {
              const next = new Set(previous);
              for (const id of subtree) next.delete(id);
              return next;
            });
          }
          if (
            selectedIdRef.current !== null &&
            (subtree.has(selectedIdRef.current) || path.some((crumb) => crumb.id === collectionId))
          ) {
            await selectCollection(null);
          }
          await refreshKnownBranches([parentId, parentItem?.parent_id ?? null]);
          return result;
        } catch (error) {
          await refreshKnownBranches(affected);
          throw error;
        }
      }),
    [
      enqueueMutation,
      invalidateBranches,
      path,
      refreshKnownBranches,
      selectCollection,
    ],
  );

  const changeAttachment = useCallback(
    (
      collectionId: number,
      direct: boolean,
      explicitDocumentId?: string,
    ): Promise<CollectionAttachmentState | null> =>
      enqueueMutation(async () => {
        const targetDocumentId = explicitDocumentId ?? documentIdRef.current;
        if (!targetDocumentId) {
          throw new Error('A saved document is required to change folder attachment');
        }
        const snapshot = branchesRef.current;
        const current = findCollection(snapshot, collectionId);
        const subtree = loadedSubtreeIds(snapshot, collectionId);
        const affected = new Set<number | null>([current?.parent_id ?? null, ...subtree]);
        invalidateBranches(affected);
        const selectionAffected = path.some((crumb) => crumb.id === collectionId);
        try {
          const state = direct
            ? await attachCollectionDocument(collectionId, targetDocumentId)
            : await detachCollectionDocument(collectionId, targetDocumentId);
          if (mountedRef.current && state) {
            setBranches((previous) => {
              const item = findCollection(previous, collectionId);
              return item
                ? replaceCollectionEverywhere(previous, { ...item, attachment: state })
                : { ...previous };
            });
            if (selectedIdRef.current === collectionId) setAttachment(state);
          }
          await refreshKnownBranches(affected);
          if (selectionAffected || selectedIdRef.current === collectionId) {
            await refreshSelected();
          }
          return state;
        } catch (error) {
          await refreshKnownBranches(affected);
          throw error;
        }
      }),
    [
      enqueueMutation,
      invalidateBranches,
      path,
      refreshKnownBranches,
      refreshSelected,
    ],
  );

  const attachDocument = useCallback(
    (collectionId: number, explicitDocumentId?: string) =>
      changeAttachment(collectionId, true, explicitDocumentId),
    [changeAttachment],
  );

  const detachDocument = useCallback(
    (collectionId: number, explicitDocumentId?: string) =>
      changeAttachment(collectionId, false, explicitDocumentId),
    [changeAttachment],
  );

  return {
    branches,
    roots: branches[ROOT_BRANCH_KEY]?.collections ?? [],
    expandedIds,
    selectedId,
    selectedCollection,
    selectedParentId: selectedCollection?.parent_id ?? null,
    path,
    attachment,
    selecting,
    selectionError,
    childrenOf: (parentId) => branches[branchKey(parentId)]?.collections ?? [],
    loadChildren,
    loadMore,
    setExpanded,
    toggleExpanded,
    selectCollection,
    refreshSelected,
    refreshLoaded,
    createFolder,
    renameFolder,
    moveFolder,
    previewDelete,
    deleteFolder,
    attachDocument,
    detachDocument,
  };
}
