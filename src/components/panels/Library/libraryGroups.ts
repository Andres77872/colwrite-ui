import type { ResourceItem } from '@/data/resources';
import type { GrantSource } from './useGrantSources';

/** Whether a PDF's title or filename contains the typed name filter. */
export function matchesName(resource: ResourceItem, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return (
    resource.filename.toLowerCase().includes(needle) ||
    (resource.title ?? '').toLowerCase().includes(needle)
  );
}

export type ReasonGroup = {
  key: string;
  title: string;
  hint?: string;
  /** The collection this page uses, when the group is one; ✕ stops using it. */
  grant?: { id: number; name: string };
  resources: ResourceItem[];
};

/**
 * Sort the PDFs this page's assistant can read by why it can read them: they
 * are on the page, in a collection the page uses, or Unfiled (which every
 * page reads).
 */
export function groupByReason(
  resources: readonly ResourceItem[],
  documentId: string | null,
  sourceOf: (collectionId: number) => GrantSource | null | undefined,
): ReasonGroup[] {
  const onPage: ResourceItem[] = [];
  const unfiled: ResourceItem[] = [];
  const viaGrant = new Map<string, ReasonGroup>();

  for (const resource of resources) {
    const { location } = resource;
    if (location.kind === 'document' && documentId && location.document_id === documentId) {
      onPage.push(resource);
      continue;
    }
    if (location.kind !== 'collection') {
      unfiled.push(resource);
      continue;
    }
    const source = sourceOf(location.collection_id);
    const key = source ? `grant:${source.grantId}` : `collection:${location.collection_id}`;
    let group = viaGrant.get(key);
    if (!group) {
      group = source
        ? {
            key,
            // A grant the collection's setting added says where it comes from:
            // the page lives there, and it goes when the page leaves.
            title: source.origin === 'setting' ? `Used via ${source.grantName}` : `From ${source.path.join(' › ')}`,
            ...(source.origin === 'setting'
              ? { hint: `Pages in ${source.grantName} can use its PDFs while they are there.` }
              : {}),
            grant: { id: source.grantId, name: source.grantName },
            resources: [],
          }
        : { key, title: `In ${location.collection_name ?? 'a collection'}`, resources: [] };
      viaGrant.set(key, group);
    }
    group.resources.push(resource);
  }

  const groups: ReasonGroup[] = [];
  if (onPage.length > 0) groups.push({ key: 'page', title: 'On this page', resources: onPage });
  groups.push(...[...viaGrant.values()].sort((a, b) => a.title.localeCompare(b.title)));
  if (unfiled.length > 0) {
    groups.push({
      key: 'unfiled',
      title: 'Unfiled',
      hint: 'Every page’s assistant can read these.',
      resources: unfiled,
    });
  }
  return groups;
}


/** "1 PDF", "12 PDFs". */
export const pdfCount = (count: number) => `${count.toLocaleString()} PDF${count === 1 ? '' : 's'}`;
