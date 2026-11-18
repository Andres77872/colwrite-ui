import { useId, useState, type ReactNode } from 'react';
import { BookOpen, ExternalLink, FileText, Folder, FolderInput, GripVertical, SearchX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { formatBytes } from '@/lib/text';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import {
  resourceContentUrl,
  type CollectionItem,
  type ResourceItem,
  type ResourceSearchResponse,
} from '@/data/resources';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ExtractionBadge } from '@/components/common/ExtractionStatus';
import { matchesName } from './libraryGroups';
import { CollectionAttachmentLabel } from './CollectionAttachmentLabel';
import { useWorkspaceAccess } from '@/components/workspace/workspaceAccess';
import { Highlighted } from './Highlighted';
import {
  hasInternalLibraryDrag,
  readLibraryDragPayload,
  setLibraryDragPayload,
  type LibraryDragPayload,
} from './collectionDnd';

/**
 * The row tint has to live on the element that also carries `group`, and react
 * to both hover and inner focus. It used to be `hover:bg-accent` on a wrapper
 * whose only focusable child was a nested button, so the mouse lit up one
 * rectangle and the keyboard lit up a different, smaller one.
 */
const ROW_SURFACE =
  'group rounded-md transition-colors duration-150 hover:bg-hover has-focus-visible:bg-hover';

/**
 * A pointer-only drag handle.
 *
 * `aria-hidden` and not focusable on purpose. These were `<button>` elements
 * with an `aria-label`, which put them in the tab order while Enter and Space
 * did nothing at all — the keyboard route for moving something is the row's
 * actions menu or the detail view's Move button. Revealed on hover *and* on
 * focus within the row, so keyboard users can still see what the mouse gets.
 */
function DragHandle({
  label,
  payload,
  className,
}: {
  label: string;
  payload: LibraryDragPayload;
  className?: string;
}) {
  // A viewer moves nothing (D6): no handle to drag.
  const { canEdit } = useWorkspaceAccess();
  if (!canEdit) return null;
  return (
    <span
      aria-hidden="true"
      draggable
      title={`Drag ${label}`}
      className={cn(
        'grid shrink-0 cursor-grab place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-background group-hover:opacity-100 group-focus-within:opacity-100 active:cursor-grabbing',
        className,
      )}
      onDragStart={(event) => setLibraryDragPayload(event.dataTransfer, payload)}
    >
      <GripVertical className="h-4 w-4" />
    </span>
  );
}

/**
 * Collections in Browse: the top-level ones at the root, or the ones inside
 * the open collection. A row opens it; a PDF or collection dragged onto a row
 * moves there, and every drag has the "Move to…" menu as its keyboard twin.
 */
export function CollectionChildren({
  collections,
  heading,
  action,
  emptyText,
  parentEffective,
  onOpen,
  onDrop,
}: {
  collections: CollectionItem[];
  heading: string;
  /** Shown beside the heading, e.g. "New collection". */
  action?: ReactNode;
  /** Shown when there are no collections; without it the section is hidden. */
  emptyText?: string;
  parentEffective: boolean;
  onOpen: (collectionId: number) => void;
  onDrop: (payload: LibraryDragPayload, targetCollectionId: number) => void | Promise<void>;
}) {
  const [dropId, setDropId] = useState<number | null>(null);
  // Generated rather than hard-coded: a hard-coded id collides the moment this
  // panel is mounted twice, and nothing prevents that.
  const headingId = useId();
  if (collections.length === 0 && !emptyText) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-1">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3
          id={headingId}
          className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {heading}
        </h3>
        {action}
      </div>
      {collections.length === 0 && <p className="text-2xs text-muted-foreground">{emptyText}</p>}
      <ul className="space-y-1">
        {collections.map((collection) => (
          <li
            key={collection.id}
            className={cn(
              ROW_SURFACE,
              'flex min-w-0 items-center gap-2 p-2',
              dropId === collection.id && 'border-primary bg-primary/10 ring-1 ring-primary',
            )}
            onDragEnter={(event) => {
              if (!hasInternalLibraryDrag(event.dataTransfer)) return;
              event.preventDefault();
              setDropId(collection.id);
            }}
            onDragOver={(event) => {
              if (!hasInternalLibraryDrag(event.dataTransfer)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropId(collection.id);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setDropId((current) => (current === collection.id ? null : current));
            }}
            onDrop={(event) => {
              if (!hasInternalLibraryDrag(event.dataTransfer)) return;
              event.preventDefault();
              event.stopPropagation();
              setDropId(null);
              const payload = readLibraryDragPayload(event.dataTransfer);
              if (payload) void onDrop(payload, collection.id);
            }}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpen(collection.id)}
            >
              <Folder aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{collection.name}</span>
                <span className="block text-2xs text-muted-foreground">
                  {collection.child_collection_count.toLocaleString()} collections ·{' '}
                  {collection.pdf_count.toLocaleString()} PDFs
                </span>
              </span>
              <CollectionAttachmentLabel
                attachment={collection.grant_state}
                inheritedFromAncestor={parentEffective}
                compact
              />
            </button>
            <DragHandle
              label={collection.name}
              payload={{ kind: 'collection', id: collection.id, etag: collection.etag }}
              className="h-7 w-6"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ResourceList({
  resources,
  filter,
  emptyTitle,
  emptyDescription,
  filterHint,
  onOpen,
}: {
  resources: ResourceItem[];
  filter: string;
  /** Added to "No matches", e.g. how to search inside the PDFs instead. */
  filterHint?: string;
  emptyTitle: string;
  emptyDescription: string;
  onOpen: (resource: ResourceItem) => void;
}) {
  const filtered = resources.filter((item) => matchesName(item, filter));

  return (
    <>
      <ul className="space-y-1.5">
        {filtered.map((resource) => (
          <li key={resource.id}>
            <ResourceRow resource={resource} onOpen={() => onOpen(resource)} />
          </li>
        ))}
      </ul>
      {resources.length === 0 && (
        <EmptyState icon={BookOpen} title={emptyTitle} description={emptyDescription} />
      )}
      {resources.length > 0 && filtered.length === 0 && (
        <EmptyState
          icon={SearchX}
          title="No matches"
          // "No PDF name matches": the filter also looks at the title, so a
          // narrower wording would be wrong whenever only a title matched.
          description={`No PDF name matches “${filter.trim()}”.${filterHint ? ` ${filterHint}` : ''}`}
        />
      )}
    </>
  );
}

export function ResourceRow({ resource, onOpen, draggable = true }: { resource: ResourceItem; onOpen: () => void; draggable?: boolean }) {
  const context = [
    formatBytes(resource.byte_size),
    resource.extraction.pages ? `${resource.extraction.pages}p` : null,
    resource.location.kind === 'document' ? resource.location.document_name : null,
    resource.location.kind === 'collection' ? resource.location.collection_name : null,
  ].filter(Boolean);

  return (
    <div className={cn(ROW_SURFACE, 'flex w-full min-w-0 items-start gap-1 p-1.5')}>
      <button
        type="button"
        data-library-resource-id={resource.id}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-2 p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {resource.title || resource.filename}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {/* No `describe` here: this badge is inside the row button, so the
                hint would be read as part of the row's accessible name. */}
            <ExtractionBadge
              status={resource.extraction.status}
              error={resource.extraction.error}
            />
            <span className="truncate text-2xs text-muted-foreground">{context.join(' · ')}</span>
          </span>
        </span>
      </button>
      {draggable && <DragHandle
        label={resource.filename}
        payload={{ kind: 'resource', id: resource.id }}
        className="h-8 w-6"
      />}
    </div>
  );
}

export function SearchResults({
  result,
  onOpen,
  onAttach,
  onOpenResource,
  onLoadMore,
  loadingMore = false,
}: {
  result: ResourceSearchResponse;
  onOpen: (resourceId: number, offset: number, term: string) => void;
  /** Move the PDF onto the open page; offered on hover when given. */
  onAttach?: (resourceId: number) => void;
  onOpenResource: (resourceId: number) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  const workspaceId = useWorkspaceId();
  const skipped = result.resources_skipped;
  const matchCount = result.items.length;
  const hasMore = result.next_cursor !== null;

  return (
    // Widened by the rows' inset (-mx-2 px-2) so the scroll box, which clips,
    // does not cut the hover fill the rows draw outside the text column.
    <div className="-mx-2 min-h-0 flex-1 space-y-2 overflow-y-auto px-2">
      {/* No clear button here: the query box above clears the search. */}
      <p className="px-0.5 text-xs text-muted-foreground">
        {matchCount === 0
          ? 'No matches'
          : `${matchCount}${result.truncated || hasMore ? '+' : ''} match${matchCount === 1 ? '' : 'es'}`}{' '}
        across {result.resources_searched}{' '}
        {result.resources_searched === 1 ? 'PDF' : 'PDFs'}
      </p>

      {skipped.length > 0 && (
        <Alert variant="warning" role="status" className="text-xs">
          <p className="font-medium">
            {skipped.length} {skipped.length === 1 ? 'PDF was' : 'PDFs were'} not searched
          </p>
          <ul className="mt-1 space-y-0.5">
            {skipped.map((item) => (
              <li key={item.resource_id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-library-resource-id={item.resource_id}
                  className="min-w-0 truncate underline-offset-2 hover:underline"
                  onClick={() => onOpenResource(item.resource_id)}
                >
                  {item.filename}
                </button>
                <ExtractionBadge status={item.extraction_status} describe />
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <ul className="-mx-2">
        {result.items.map((match, index) => {
          const name = match.title || match.filename;
          return (
            <li
              key={`${match.resource_id}-${match.offset}-${index}`}
              // The same shell as a paper row: padded hover fill, actions on
              // the title line that reveal on hover or focus.
              className="group relative rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-hover has-focus-visible:bg-hover"
            >
              <button
                type="button"
                data-library-resource-id={match.resource_id}
                onClick={() => onOpen(match.resource_id, match.offset, result.query)}
                className="block w-full rounded-xs text-left focus-visible:outline-none"
              >
                <span
                  className={cn(
                    'block truncate text-sm font-medium leading-snug text-foreground',
                    // Room for the actions: on hover or focus with a mouse, and
                    // always on touch, where they are always shown.
                    onAttach
                      ? 'pointer-fine:group-hover:pr-16 pointer-fine:group-focus-within:pr-16 pointer-coarse:pr-16'
                      : 'pointer-fine:group-hover:pr-8 pointer-fine:group-focus-within:pr-8 pointer-coarse:pr-8',
                  )}
                  title={name}
                >
                  {name}
                </span>
                {/* Marked here as well as in the detail view. Scanning a list of
                    excerpts for the term you just typed, unmarked, is the work
                    the search was supposed to do. */}
                <span className="mt-1 line-clamp-3 block text-xs leading-5 text-muted-foreground">
                  <Highlighted text={match.excerpt} needle={result.query} />
                </span>
              </button>
              <div className="absolute right-1.5 top-2 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="icon" size="icon-xs" asChild>
                      <a
                        href={resourceContentUrl(workspaceId, match.resource_id)}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`Open ${name} (PDF, new tab)`}
                      >
                        <ExternalLink aria-hidden="true" />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open PDF</TooltipContent>
                </Tooltip>
                {onAttach && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="icon"
                        size="icon-xs"
                        aria-label={`Move ${name} to this page`}
                        onClick={() => onAttach(match.resource_id)}
                      >
                        <FolderInput aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Move to this page</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {hasMore && onLoadMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore && <Spinner />}
          {loadingMore ? 'Searching…' : 'Show more matches'}
        </Button>
      )}

      {matchCount === 0 && skipped.length === 0 && !hasMore && (
        <EmptyState
          icon={SearchX}
          title="Nothing found"
          description={`No PDF contains “${result.query}”. Matching is literal, so try a shorter phrase.`}
        />
      )}
    </div>
  );
}
