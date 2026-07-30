import { useId, useRef, useState } from 'react';
import { BookOpen, FileText, Folder, GripVertical, SearchX, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/text';
import { PDF_ACCEPT } from '@/lib/fileDrop';
import { useFileDropZone } from '@/hooks/useFileDropZone';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import type {
  CollectionItem,
  ResourceItem,
  ResourceSearchResponse,
} from '@/services/resources';
import { ExtractionBadge } from '@/components/common/ExtractionStatus';
import { CollectionAttachmentLabel } from './CollectionAttachmentLabel';
import { Highlighted } from './Highlighted';
import {
  hasInternalLibraryDrag,
  isExternalFileDrag,
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
  'group rounded-lg border border-border bg-card transition-colors hover:bg-accent has-focus-visible:bg-accent';

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

export function UploadDropZone({
  compact,
  uploading,
  targetLabel,
  onFiles,
}: {
  compact: boolean;
  uploading: boolean;
  targetLabel: string;
  onFiles: (files: FileList | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // `isExternalFileDrag` rather than the default: the panel drags its own rows
  // around, and those must not light up the upload target.
  const { dragOver, dropHandlers } = useFileDropZone({
    onFiles,
    accepts: isExternalFileDrag,
  });

  const chooser = (
    <Button
      variant="outline"
      size="sm"
      disabled={uploading}
      onClick={() => inputRef.current?.click()}
    >
      {uploading && <Spinner />}
      {uploading ? 'Uploading…' : 'Choose files'}
    </Button>
  );

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={PDF_ACCEPT}
      multiple
      className="sr-only"
      aria-label="Add PDFs to your library"
      onChange={(event) => {
        onFiles(event.target.files);
        event.target.value = '';
      }}
    />
  );

  // Two deliberate layouts rather than one shrunk down. The compact form is a
  // single fixed-height row, so the zone no longer changes height as the list
  // it sits above gains and loses items.
  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border-2 border-dashed px-2.5 py-2 transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border',
        )}
        {...dropHandlers}
      >
        <Upload aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
          Drop PDFs to add to <span className="font-medium text-foreground">{targetLabel}</span>
        </p>
        {chooser}
        {input}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border-2 border-dashed p-5 text-center transition-colors',
        dragOver ? 'border-primary bg-primary/5' : 'border-border',
      )}
      {...dropHandlers}
    >
      <Upload aria-hidden="true" className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
      <p className="text-sm font-medium">Drop PDFs here</p>
      <p className="text-2xs text-muted-foreground">Upload to {targetLabel}</p>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">
        Stored on your account, converted to text, and readable by the assistant
      </p>
      {chooser}
      {input}
    </div>
  );
}

export function CollectionChildren({
  collections,
  parentEffective,
  onOpen,
  onDrop,
}: {
  collections: CollectionItem[];
  parentEffective: boolean;
  onOpen: (collectionId: number) => void;
  onDrop: (payload: LibraryDragPayload, targetCollectionId: number) => void | Promise<void>;
}) {
  const [dropId, setDropId] = useState<number | null>(null);
  // Generated rather than hard-coded: a hard-coded id collides the moment this
  // panel is mounted twice, and nothing prevents that.
  const headingId = useId();
  if (collections.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-1">
      {/* "Subfolders", not "Folders" — the folder tree above this is also
          headed "Folders", and two different sections with the same name in one
          panel is not a heading, it is a coin flip. */}
      <h3
        id={headingId}
        className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Subfolders
      </h3>
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
                  {collection.child_count.toLocaleString()} folders ·{' '}
                  {collection.resource_count.toLocaleString()} PDFs
                </span>
              </span>
              <CollectionAttachmentLabel
                attachment={collection.attachment}
                inheritedFromAncestor={parentEffective}
                compact
              />
            </button>
            <DragHandle
              label={collection.name}
              payload={{ kind: 'collection', id: collection.id }}
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
  onOpen,
}: {
  resources: ResourceItem[];
  filter: string;
  emptyTitle: string;
  emptyDescription: string;
  onOpen: (resource: ResourceItem) => void;
}) {
  const needle = filter.trim().toLowerCase();
  const filtered = needle
    ? resources.filter(
        (item) =>
          item.filename.toLowerCase().includes(needle) ||
          (item.title ?? '').toLowerCase().includes(needle),
      )
    : resources;

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
          // "No file matches", not "no file name contains": the filter also
          // looks at the title, so the narrower wording was a lie whenever a
          // title matched and a filename did not.
          description={`No file matches “${filter.trim()}”.`}
        />
      )}
    </>
  );
}

function ResourceRow({ resource, onOpen }: { resource: ResourceItem; onOpen: () => void }) {
  const context = [
    formatBytes(resource.byte_size),
    resource.extraction_pages ? `${resource.extraction_pages}p` : null,
    resource.document_name,
    resource.collection_name,
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
              status={resource.extraction_status}
              error={resource.extraction_error}
            />
            <span className="truncate text-2xs text-muted-foreground">{context.join(' · ')}</span>
          </span>
        </span>
      </button>
      <DragHandle
        label={resource.filename}
        payload={{ kind: 'resource', id: resource.id }}
        className="h-8 w-6"
      />
    </div>
  );
}

export function SearchResults({
  result,
  onClear,
  onOpen,
  onOpenResource,
  onLoadMore,
  loadingMore = false,
}: {
  result: ResourceSearchResponse;
  onClear?: () => void;
  onOpen: (resourceId: number, offset: number, term: string) => void;
  onOpenResource: (resourceId: number) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  const skipped = result.resources_skipped ?? [];

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs text-muted-foreground">
          {result.match_count === 0
            ? 'No matches'
            : `${result.match_count}${result.truncated ? '+' : ''} match${result.match_count === 1 ? '' : 'es'}`}{' '}
          across {result.resources_searched}{' '}
          {result.resources_searched === 1 ? 'file' : 'files'}
        </p>
        {onClear && (
          <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear the search">
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {skipped.length > 0 && (
        <Alert variant="warning" role="status" className="text-xs">
          <p className="font-medium">
            {skipped.length} {skipped.length === 1 ? 'file was' : 'files were'} not searched
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

      <ul className="space-y-1.5">
        {result.matches.map((match, index) => (
          <li key={`${match.resource_id}-${match.offset}-${index}`}>
            <button
              type="button"
              data-library-resource-id={match.resource_id}
              onClick={() => onOpen(match.resource_id, match.offset, result.query)}
              className="w-full rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block truncate text-2xs font-medium text-muted-foreground">
                {match.title || match.filename}
              </span>
              {/* Marked here as well as in the detail view. Scanning a list of
                  excerpts for the term you just typed, unmarked, is the work
                  the search was supposed to do. */}
              <span className="mt-1 block text-xs leading-relaxed text-foreground/90">
                <Highlighted text={match.excerpt} needle={result.query} />
              </span>
            </button>
          </li>
        ))}
      </ul>

      {result.next_offset !== null && onLoadMore && (
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

      {result.match_count === 0 && skipped.length === 0 && result.next_offset === null && (
        <EmptyState
          icon={SearchX}
          title="Nothing found"
          description={`No file contains “${result.query}”. Matching is literal, so try a shorter phrase.`}
        />
      )}
    </div>
  );
}
