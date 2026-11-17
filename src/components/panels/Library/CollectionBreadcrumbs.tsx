import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CollectionPathItem } from '@/data/resources';

/**
 * How many crumbs to show before collapsing the middle.
 *
 * Collections nest up to 32 deep. Every crumb sharing a 380px panel meant each
 * one truncated toward a single character, so a deep path showed the shape of
 * a trail and none of its names. Keeping the root, the parent and the current
 * collection is what a reader actually navigates by.
 */
const VISIBLE_TAIL = 2;

const CRUMB =
  'rounded-sm px-1 py-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Library › Thesis › Chapter 2. The Library is the root; Unfiled and "All
 * PDFs" are views beside the collections, so they are a last crumb (`view`),
 * never the root that collections seem to live inside.
 *
 * The page topbar uses it too, as Workspace › … › Chapter 2 › the page: its
 * root is the workspace and its last crumb (`current`) the page itself.
 */
export function CollectionBreadcrumbs({
  path,
  view,
  current,
  root = 'Library',
  label = 'Collection breadcrumbs',
  className,
  onSelectRoot,
  onSelectCollection,
}: {
  path: CollectionPathItem[];
  /** A view that is not a collection, shown as the current crumb. */
  view?: string;
  /** The current crumb when it is not a collection: the open page, which carries its own `aria-current`. */
  current?: ReactNode;
  /** The first crumb. */
  root?: ReactNode;
  label?: string;
  className?: string;
  /** Without it the root is plain text. */
  onSelectRoot?: () => void;
  onSelectCollection: (collectionId: number) => void;
}) {
  const collapsed = path.length > VISIBLE_TAIL + 1;
  const hidden = collapsed ? path.slice(0, path.length - VISIBLE_TAIL) : [];
  const shown = collapsed ? path.slice(path.length - VISIBLE_TAIL) : path;
  const atRoot = path.length === 0 && !view && current === undefined;

  return (
    <nav aria-label={label} className={cn('min-w-0 overflow-x-auto pb-1', className)}>
      <ol className="flex w-max min-w-full items-center gap-0.5 text-xs text-muted-foreground">
        <li className="flex min-w-0 shrink-0 items-center">
          {atRoot ? (
            <span aria-current="page" className="px-1 py-0.5 font-medium text-foreground">
              {root}
            </span>
          ) : onSelectRoot ? (
            <button type="button" className={cn('flex items-center gap-1', CRUMB)} onClick={onSelectRoot}>
              {root}
            </button>
          ) : (
            <span className="flex items-center gap-1 px-1 py-0.5">{root}</span>
          )}
        </li>

        {collapsed && (
          <li className="flex shrink-0 items-center gap-0.5">
            <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" />
            {/* The skipped levels stay reachable: this jumps to the nearest one
                rather than being decoration. */}
            <button
              type="button"
              className={CRUMB}
              title={hidden.map((item) => item.name).join(' › ')}
              aria-label={`Show ${hidden.length} skipped ${hidden.length === 1 ? 'collection' : 'collections'}: ${hidden.map((item) => item.name).join(', ')}`}
              onClick={() => {
                const nearest = hidden.at(-1);
                if (nearest) onSelectCollection(nearest.id);
              }}
            >
              …
            </button>
          </li>
        )}

        {shown.map((item, index) => {
          const isCurrent = !view && current === undefined && index === shown.length - 1;
          return (
            <li key={item.id} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" />
              {isCurrent ? (
                <span
                  aria-current="page"
                  className="max-w-40 truncate px-1 py-0.5 font-medium text-foreground"
                  title={item.name}
                >
                  {item.name}
                </span>
              ) : (
                <button
                  type="button"
                  className={`max-w-32 truncate ${CRUMB}`}
                  title={item.name}
                  onClick={() => onSelectCollection(item.id)}
                >
                  {item.name}
                </button>
              )}
            </li>
          );
        })}

        {view && (
          <li className="flex min-w-0 items-center gap-0.5">
            <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span aria-current="page" className="truncate px-1 py-0.5 font-medium text-foreground">
              {view}
            </span>
          </li>
        )}

        {current !== undefined && (
          <li className="flex min-w-0 items-center gap-0.5">
            <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" />
            {current}
          </li>
        )}
      </ol>
    </nav>
  );
}
