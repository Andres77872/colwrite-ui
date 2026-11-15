import type { QueryClient } from '@tanstack/react-query';
import { branchHome, documentKeys, pagesOf, type DocumentSummary, type PageBranchData } from '@/data/documents';
import { collectionKeys, collectionsOf, type CollectionBranchData, type CollectionItem } from '@/data/resources';

/*
 * The sidebar tree's cached branches, as the actions that change the tree
 * (moves, trash) edit them before the server answers or the branches read
 * again.
 */

/** Every cached tree branch of pages, with the home it lists. */
export function pageBranches(queryClient: QueryClient, workspaceId: string) {
  return queryClient.getQueryCache()
    .findAll({ queryKey: documentKeys.branches(workspaceId) })
    .flatMap((query) => {
      const home = branchHome(query.queryKey);
      return home === undefined ? [] : [{ key: query.queryKey, home }];
    });
}

/** Every cached tree branch of collections, with the parent it lists. */
export function collectionBranches(queryClient: QueryClient, workspaceId: string) {
  return queryClient.getQueryCache()
    .findAll({ queryKey: [...collectionKeys.all(workspaceId), 'branch'] })
    .map((query) => ({ key: query.queryKey, parentId: (query.queryKey[4] as { parentId: number | null }).parentId }));
}

/** Rewrite the rows of every cached page branch; the page boundaries become one page with the last cursor. */
export function editPages(queryClient: QueryClient, workspaceId: string, edit: (home: number | null, rows: DocumentSummary[]) => DocumentSummary[]) {
  for (const { key, home } of pageBranches(queryClient, workspaceId)) {
    queryClient.setQueryData<PageBranchData>(key, (data) => {
      if (!data) return data;
      const rows = pagesOf(data);
      const next = edit(home, rows);
      if (next === rows) return data;
      return { pages: [{ documents: next, nextCursor: data.pages.at(-1)?.nextCursor ?? null }] };
    });
  }
}

export function editCollections(queryClient: QueryClient, workspaceId: string, edit: (parentId: number | null, rows: CollectionItem[]) => CollectionItem[]) {
  for (const { key, parentId } of collectionBranches(queryClient, workspaceId)) {
    queryClient.setQueryData<CollectionBranchData>(key, (data) => {
      if (!data) return data;
      const rows = collectionsOf(data.pages);
      const next = edit(parentId, rows);
      if (next === rows) return data;
      return { pages: [{ items: next, next_cursor: data.pages.at(-1)?.next_cursor ?? null }] };
    });
  }
}

/** Take a page out of every cached branch: it went to the Trash. */
export function removePageFromTree(queryClient: QueryClient, workspaceId: string, pageId: string): void {
  editPages(queryClient, workspaceId, (_, rows) => (rows.some((row) => row.id === pageId) ? rows.filter((row) => row.id !== pageId) : rows));
}

/** Take a collection out of every cached branch: it went to the Trash with what it holds. */
export function removeCollectionFromTree(queryClient: QueryClient, workspaceId: string, collectionId: number): void {
  editCollections(queryClient, workspaceId, (_, rows) =>
    (rows.some((row) => row.id === collectionId) ? rows.filter((row) => row.id !== collectionId) : rows));
}
