import { cn } from '@/lib/utils';
import { badgeVariants } from '@/components/ui/badgeVariants';
import type { CollectionAttachmentState } from '@/services/resources';
import { collectionAttachmentHint, collectionAttachmentLabel } from './collectionAttachment';

/**
 * CollectionAttachmentLabel — whether this folder reaches the assistant.
 *
 * A `<span>` styled with `badgeVariants` rather than `<Badge>`, which renders a
 * `<div>`: this sits inside a `<button>` in the folder list and inside a
 * `role="treeitem"` row in the tree, and flow content in a button is not
 * merely invalid — the parser restructures around it and the row falls apart.
 * `ExtractionBadge` documents the same constraint; this component is the other
 * half of it.
 */
export function CollectionAttachmentLabel({
  attachment,
  inheritedFromAncestor = false,
  compact = false,
}: {
  attachment: CollectionAttachmentState | null;
  inheritedFromAncestor?: boolean;
  compact?: boolean;
}) {
  const label = collectionAttachmentLabel(attachment, inheritedFromAncestor);
  if (!label) return null;
  const hint = collectionAttachmentHint(attachment, inheritedFromAncestor);

  return (
    <span
      className={cn(
        badgeVariants({ variant: attachment?.direct ? 'info' : 'secondary' }),
        compact && 'max-w-full truncate px-1.5 py-0 text-2xs font-medium',
      )}
      title={hint ?? undefined}
    >
      {label}
    </span>
  );
}
