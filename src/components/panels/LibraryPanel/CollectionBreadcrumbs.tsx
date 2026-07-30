import { ChevronRight } from 'lucide-react';
import type { CollectionBreadcrumbItem } from '@/services/resources';

/**
 * How many crumbs to show before collapsing the middle.
 *
 * Folders nest up to 32 deep. Every crumb sharing a 380px panel meant each one
 * truncated toward a single character, so a deep path showed the shape of a
 * trail and none of its names. Keeping the root, the parent and the current
 * folder is what a reader actually navigates by.
 */
const VISIBLE_TAIL = 2;

export function CollectionBreadcrumbs({
  path,
  onSelectRoot,
  onSelectCollection,
}: {
  path: CollectionBreadcrumbItem[];
  onSelectRoot: () => void;
  onSelectCollection: (collectionId: number) => void;
}) {
  const collapsed = path.length > VISIBLE_TAIL + 1;
  const hidden = collapsed ? path.slice(0, path.length - VISIBLE_TAIL) : [];
  const shown = collapsed ? path.slice(path.length - VISIBLE_TAIL) : path;

  return (
    <nav aria-label="Folder breadcrumbs" className="min-w-0 overflow-x-auto pb-1">
      <ol className="flex w-max min-w-full items-center gap-0.5 text-xs text-muted-foreground">
        <li className="min-w-0">
          {path.length === 0 ? (
            <span aria-current="page" className="font-medium text-foreground">
              Unfiled
            </span>
          ) : (
            <button
              type="button"
              className="rounded-sm px-1 py-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onSelectRoot}
            >
              Unfiled
            </button>
          )}
        </li>

        {collapsed && (
          <li className="flex shrink-0 items-center gap-0.5">
            <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" />
            {/* The skipped levels stay reachable: this jumps to the nearest one
                rather than being decoration. */}
            <button
              type="button"
              className="rounded-sm px-1 py-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={hidden.map((item) => item.name).join(' › ')}
              aria-label={`Show ${hidden.length} skipped ${hidden.length === 1 ? 'folder' : 'folders'}: ${hidden.map((item) => item.name).join(', ')}`}
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
          const current = index === shown.length - 1;
          return (
            <li key={item.id} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" />
              {current ? (
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
                  className="max-w-32 truncate rounded-sm px-1 py-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={item.name}
                  onClick={() => onSelectCollection(item.id)}
                >
                  {item.name}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
