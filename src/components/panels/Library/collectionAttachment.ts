import type { CollectionGrantState } from '@/data/resources';

/**
 * Whether this page's assistant can read this collection, in the fewest words
 * that still tell the three cases apart.
 *
 * These land in a badge inside a 380px panel, so the label is short and the
 * hint carries the explanation. "Used here" means the author chose "Use on
 * this page" for this collection; "Used via …" means they chose it for a
 * collection this one is inside.
 */
export function collectionAttachmentLabel(
  attachment: CollectionGrantState | null,
  inheritedFromAncestor = false,
): string | null {
  if (!attachment?.effective) return null;
  if (attachment.direct && inheritedFromAncestor) return 'Used here and via a parent';
  if (attachment.direct) return 'Used here';
  return `Used via ${attachment.via_collection_name ?? 'a parent collection'}`;
}

/** The same three cases, spelled out for a tooltip or an accessible name. */
export function collectionAttachmentHint(
  attachment: CollectionGrantState | null,
  inheritedFromAncestor = false,
): string | null {
  if (!attachment?.effective) return null;
  if (attachment.direct && inheritedFromAncestor) {
    return 'This page uses this collection, and also a collection that contains it.';
  }
  if (attachment.direct) return USE_ON_THIS_PAGE_HINT;
  const name = attachment.via_collection_name;
  return name
    ? `This page uses ${name}, which contains this collection.`
    : 'This page uses a collection that contains this one.';
}

/** What "Use on this page" does, for its tooltip. */
export const USE_ON_THIS_PAGE_HINT =
  'The assistant on this page can read the PDFs in this collection and the collections inside it.';
