import type { RefObject } from 'react';
import { Check, FolderInput, FolderPlus, Link2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton, Spinner } from '@/components/ui/spinner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CollectionGrantState, CollectionRef } from '@/data/resources';
import { CollectionAttachmentLabel } from './CollectionAttachmentLabel';
import { USE_ON_THIS_PAGE_HINT } from './collectionAttachment';

/**
 * The open collection in Browse: its name, its actions, and whether this page
 * uses it. The breadcrumb above it is Browse's own.
 */
export function CollectionFolderHeader({
  collection,
  loading,
  attachment,
  inheritedFromAncestor,
  attachmentBusy,
  actionButtonRef,
  onCreateChild,
  onEdit,
  onMove,
  onTrash,
  onToggleAttachment,
  readOnly = false,
}: {
  collection: CollectionRef | null;
  loading: boolean;
  attachment: CollectionGrantState | null;
  inheritedFromAncestor: boolean;
  attachmentBusy: boolean;
  actionButtonRef: RefObject<HTMLButtonElement | null>;
  onCreateChild: () => void;
  onEdit: () => void;
  onMove: () => void;
  onTrash: () => void;
  onToggleAttachment: () => void;
  /** A viewer (D6): what the collection is and whether this page uses it, and no actions. */
  readOnly?: boolean;
}) {
  const attached = Boolean(attachment?.direct);

  if (!collection) {
    return (
      <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-2.5" aria-busy={loading}>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{collection.name}</h3>
          {collection.description && (
            <p className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">{collection.description}</p>
          )}
        </div>
        {!readOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={actionButtonRef}
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${collection.name}`}
            >
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onCreateChild}>
              <FolderPlus aria-hidden="true" /> New sub-collection
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil aria-hidden="true" /> Rename…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onMove}>
              <FolderInput aria-hidden="true" /> Move to…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onTrash}>
              <Trash2 aria-hidden="true" /> Move to Trash…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <CollectionAttachmentLabel attachment={attachment} inheritedFromAncestor={inheritedFromAncestor} />
        {/* A toggle: pressed while this page uses the collection. The badge
            beside it says "Used here" or "Used via …". A page that was never
            saved is saved first, so this is never unavailable. */}
        {!readOnly && (
        <Button
          variant={attached ? 'secondary' : 'outline'}
          size="xs"
          className="h-7"
          aria-pressed={attached}
          disabled={attachmentBusy}
          title={USE_ON_THIS_PAGE_HINT}
          onClick={onToggleAttachment}
        >
          {attachmentBusy ? <Spinner /> : attached ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
          Use on this page
        </Button>
        )}
      </div>
    </div>
  );
}
