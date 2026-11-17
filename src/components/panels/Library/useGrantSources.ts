import { useCallback, useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  collectionDetailQuery,
  grantStateOf,
  pdfGrantsQuery,
  type CollectionDetail,
  type PdfGrant,
} from '@/data/resources';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';

/** The collection this page uses that makes another collection's PDFs reachable. */
export type GrantSource = {
  /** The collection the author chose "Use on this page" for. */
  grantId: number;
  grantName: string;
  /** Its path from the top level, for "From Thesis › Reading". */
  path: string[];
  /**
   * `setting` when the collection's "Pages here can use these PDFs" added the
   * grant (it goes when the page leaves); `manual` when the author did.
   */
  origin: PdfGrant['origin'];
};

/**
 * Which "Use on this page" grant a collection is reachable through: the
 * collection itself, or the nearest collection above it that this page uses.
 */
export function grantSourceOf(detail: CollectionDetail, grants: readonly PdfGrant[]): GrantSource | null {
  const state = grantStateOf(detail.path, grants);
  if (!state.effective || state.via_collection_id === null) return null;
  const grantId = state.via_collection_id;
  const index = detail.path.findIndex((crumb) => crumb.id === grantId);
  const path = index >= 0 ? detail.path.slice(0, index + 1).map((crumb) => crumb.name) : [];
  const grantName = state.via_collection_name ?? path.at(-1) ?? detail.name;
  const origin = grants.find((grant) => grant.collection_id === grantId)?.origin ?? 'manual';
  return { grantId, grantName, path: path.length > 0 ? path : [grantName], origin };
}

type Entry = GrantSource | null;

/**
 * The grant behind each collection that holds a PDF this page can read.
 *
 * The page's grants are one read (`GET …/documents/{d}/pdf-grants`); each
 * collection's path comes from its detail, shared with Browse. Both read
 * again whenever a grant or a move marks the collections stale. Answers stay
 * on screen while they are read again, and belong to their page alone.
 */
export function useGrantSources(documentId: string | null, collectionIds: readonly number[]) {
  const workspaceId = useWorkspaceId();
  const idsKey = [...new Set(collectionIds)].sort((a, b) => a - b).join(',');
  const ids = useMemo(() => (idsKey ? idsKey.split(',').map(Number) : []), [idsKey]);
  const grants = useQuery({ ...pdfGrantsQuery(workspaceId, documentId ?? ''), enabled: documentId !== null && ids.length > 0 });
  const grantList = grants.data;
  const grantsFailed = grants.isError;
  const combine = useCallback(
    (results: { data?: CollectionDetail; isError: boolean }[]) => {
      const next = new Map<number, Entry>();
      results.forEach((query, index) => {
        const id = ids[index];
        if (id === undefined) return;
        if (query.data && grantList) next.set(id, grantSourceOf(query.data, grantList));
        else if (query.isError || grantsFailed) next.set(id, null);
      });
      return next;
    },
    [grantList, grantsFailed, ids],
  );
  const entries = useQueries({
    queries: ids.map((id) => ({ ...collectionDetailQuery(workspaceId, id), enabled: documentId !== null })),
    combine,
  });

  /** The grant for a collection, `null` when it has none, `undefined` while unknown. */
  const sourceOf = useCallback(
    (collectionId: number): Entry | undefined => (documentId ? entries.get(collectionId) : undefined),
    [documentId, entries],
  );

  return { sourceOf };
}
