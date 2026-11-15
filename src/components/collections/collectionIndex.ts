import { useQuery } from '@tanstack/react-query';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { collectionKeys, listCollections } from '@/data/resources';

/** How many collections the path search reads before it stops (D14 allows 10,000). */
export const SEARCH_CAP = 2_000;

/** Every collection of a workspace (the one shown by default) with its path, read breadth-first for the search. */
export function useCollectionIndex(enabled: boolean, workspace?: string) {
  const shownId = useWorkspaceId();
  const workspaceId = workspace ?? shownId;
  return useQuery({
    queryKey: [...collectionKeys.all(workspaceId), 'index'],
    enabled,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const found: Array<{ id: number; name: string; path: string[] }> = [];
      const queue: Array<{ id: number | null; path: string[] }> = [{ id: null, path: [] }];
      while (queue.length > 0 && found.length < SEARCH_CAP) {
        const parent = queue.shift() as { id: number | null; path: string[] };
        let cursor: string | null = null;
        do {
          const page = await listCollections(workspaceId, { parentId: parent.id, limit: 100, cursor }, { signal });
          for (const item of page.items) {
            const path = [...parent.path, item.name];
            found.push({ id: item.id, name: item.name, path });
            if (item.child_collection_count > 0) queue.push({ id: item.id, path });
          }
          cursor = page.next_cursor;
        } while (cursor !== null && found.length < SEARCH_CAP);
      }
      return { items: found, complete: queue.length === 0 };
    },
  });
}
