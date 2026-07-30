import type { CollectionAttachmentState } from '@/services/resources';

/**
 * How this folder reaches the assistant, in the fewest words that still
 * distinguish the three cases.
 *
 * These land in a badge inside a 380px panel, so the label is short and the
 * hint below carries the explanation. "Attached" means the author attached
 * this folder to the open document; "Via …" means they attached an ancestor
 * and this folder came along.
 */
export function collectionAttachmentLabel(
  attachment: CollectionAttachmentState | null,
  inheritedFromAncestor = false,
): string | null {
  if (!attachment?.effective) return null;
  if (attachment.direct && inheritedFromAncestor) return 'Attached + inherited';
  if (attachment.direct) return 'Attached';
  return `Via ${attachment.nearest_direct_collection_name ?? 'a parent folder'}`;
}

/** The same three cases, spelled out for a tooltip or an accessible name. */
export function collectionAttachmentHint(
  attachment: CollectionAttachmentState | null,
  inheritedFromAncestor = false,
): string | null {
  if (!attachment?.effective) return null;
  if (attachment.direct && inheritedFromAncestor) {
    return 'Attached to this document, and also reached through a parent folder.';
  }
  if (attachment.direct) return 'Attached to this document.';
  const name = attachment.nearest_direct_collection_name;
  return name
    ? `Reached through ${name}, which is attached to this document.`
    : 'Reached through a parent folder that is attached to this document.';
}
