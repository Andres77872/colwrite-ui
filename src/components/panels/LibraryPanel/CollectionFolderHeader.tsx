import type { RefObject } from 'react';
import { FolderInput, FolderPlus, Link2, Link2Off, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton, Spinner } from '@/components/ui/spinner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
  CollectionAttachmentState,
  CollectionBreadcrumbItem,
  CollectionItem,
} from '@/services/resources';
import { CollectionAttachmentLabel } from './CollectionAttachmentLabel';
import { CollectionBreadcrumbs } from './CollectionBreadcrumbs';

export function CollectionFolderHeader({
  view,
  collection,
  loading,
  path,
  attachment,
  inheritedFromAncestor,
  attachmentBusy,
  attachmentDisabledReason,
  actionButtonRef,
  onSelectRoot,
  onSelectCollection,
  onCreateChild,
  onEdit,
  onMove,
  onDelete,
  onToggleAttachment,
}: {
  /**
   * Which view this heads.
   *
   * Passed explicitly rather than inferred from `collection === null`, which is
   * the bug this prop exists to kill: a folder whose detail was still in flight
   * had no `collection` yet, so the header rendered Unfiled's description and
   * an empty breadcrumb trail before snapping to the real folder.
   */
  view: 'unfiled' | 'collection';
  collection: CollectionItem | null;
  loading: boolean;
  path: CollectionBreadcrumbItem[];
  attachment: CollectionAttachmentState | null;
  inheritedFromAncestor: boolean;
  attachmentBusy: boolean;
  /** Why the attachment toggle is unavailable, or null when it is available. */
  attachmentDisabledReason: string | null;
  actionButtonRef: RefObject<HTMLButtonElement | null>;
  onSelectRoot: () => void;
  onSelectCollection: (collectionId: number) => void;
  onCreateChild: () => void;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
  onToggleAttachment: () => void;
}) {
  const attached = Boolean(attachment?.direct);

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-2.5">
      <CollectionBreadcrumbs
        path={path}
        onSelectRoot={onSelectRoot}
        onSelectCollection={onSelectCollection}
      />

      {view === 'unfiled' && (
        <p className="text-2xs text-muted-foreground">
          Top-level folders and PDFs that are not in a folder or attached to a document.
        </p>
      )}

      {view === 'collection' && !collection && (
        <div className="space-y-1.5" aria-busy={loading}>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      )}

      {view === 'collection' && collection && (
        <>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold">{collection.name}</h3>
              {collection.description && (
                <p className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">
                  {collection.description}
                </p>
              )}
            </div>
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
                  <FolderPlus aria-hidden="true" /> Create a folder inside this one
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil aria-hidden="true" /> Rename or edit description
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onMove}>
                  <FolderInput aria-hidden="true" /> Move to another folder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={onDelete}
                >
                  {/* Not "Delete recursively" — that describes the traversal,
                      not the consequence the author needs to weigh. */}
                  <Trash2 aria-hidden="true" /> Delete folder and everything in it
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <CollectionAttachmentLabel
              attachment={attachment}
              inheritedFromAncestor={inheritedFromAncestor}
            />
            <Button
              variant="outline"
              size="xs"
              className="h-7"
              disabled={attachmentBusy || attachmentDisabledReason !== null}
              // A disabled button's `title` is not announced, so the reason goes
              // in the accessible name instead of being mouse-only trivia.
              aria-label={
                attachmentDisabledReason
                  ? `${attached ? 'Remove from this document' : 'Attach to this document'} — ${attachmentDisabledReason}`
                  : undefined
              }
              title={attachmentDisabledReason ?? undefined}
              onClick={onToggleAttachment}
            >
              {attachmentBusy ? (
                <Spinner />
              ) : attached ? (
                <Link2Off aria-hidden="true" />
              ) : (
                <Link2 aria-hidden="true" />
              )}
              {attached ? 'Remove from this document' : 'Attach to this document'}
            </Button>
          </div>
          {attachmentDisabledReason && (
            <p className="text-2xs text-muted-foreground">{attachmentDisabledReason}</p>
          )}
        </>
      )}
    </div>
  );
}
