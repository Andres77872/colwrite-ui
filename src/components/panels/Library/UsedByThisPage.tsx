import { useId, type RefObject } from 'react';
import { BookOpen, Plus, SearchX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import type { ResourceItem } from '@/data/resources';
import { ResourceRow } from './LibraryResources';
import { groupByReason, matchesName, pdfCount } from './libraryGroups';
import type { GrantSource } from './useGrantSources';

export function UsedByThisPage({
  resources,
  documentId,
  filter,
  sourceOf,
  stoppingGrantId,
  onOpen,
  onStopUsing,
  onAddGrant,
  addGrantRef,
  readOnly = false,
}: {
  resources: readonly ResourceItem[];
  documentId: string | null;
  /** The name filter typed in the search box. */
  filter: string;
  sourceOf: (collectionId: number) => GrantSource | null | undefined;
  stoppingGrantId: number | null;
  onOpen: (resource: ResourceItem) => void;
  onStopUsing: (grant: { id: number; name: string }) => void;
  onAddGrant: () => void;
  /** Where focus returns when the collection picker closes. */
  addGrantRef?: RefObject<HTMLButtonElement | null>;
  /** A viewer (D6): which PDFs this page reads, and no way to change it. */
  readOnly?: boolean;
}) {
  const baseId = useId();
  const filtered = resources.filter((resource) => matchesName(resource, filter));
  const groups = groupByReason(filtered, documentId, sourceOf);

  const addGrant = readOnly ? null : (
    <Button
      ref={addGrantRef}
      variant="ghost"
      size="sm"
      className="-ml-2 text-muted-foreground hover:text-foreground"
      onClick={onAddGrant}
    >
      <Plus aria-hidden="true" />
      Use PDFs from a collection…
    </Button>
  );

  if (resources.length === 0) {
    return (
      <>
        <EmptyState
          icon={BookOpen}
          title="No PDFs for this page yet"
          description="Upload a PDF to this page, or use the PDFs in a collection. The assistant reads them once conversion finishes."
        />
        {addGrant}
      </>
    );
  }

  return (
    <div className="space-y-3">
      {groups.length === 0 && (
        <EmptyState
          icon={SearchX}
          title="No matches"
          description={`No PDF name matches “${filter.trim()}”. Switch to Inside PDFs to search their text.`}
        />
      )}
      {groups.map((group) => {
        const headingId = `${baseId}-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={headingId} className="space-y-1">
            <div className="flex min-h-7 items-center gap-2 pl-1">
              <h3 id={headingId} className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={group.title}>
                {group.title}
              </h3>
              <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                {pdfCount(group.resources.length)}
              </span>
              {group.grant && !readOnly && (
                <Button
                  variant="icon"
                  size="icon-xs"
                  className="shrink-0"
                  disabled={stoppingGrantId === group.grant.id}
                  aria-label={`Stop using ${group.grant.name} on this page`}
                  title={`Stop using ${group.grant.name} on this page`}
                  onClick={() => group.grant && onStopUsing(group.grant)}
                >
                  {stoppingGrantId === group.grant.id ? <Spinner /> : <X aria-hidden="true" />}
                </Button>
              )}
            </div>
            {group.hint && <p className="pl-1 text-2xs text-muted-foreground">{group.hint}</p>}
            <ul className="space-y-1.5">
              {group.resources.map((resource) => (
                <li key={resource.id}>
                  <ResourceRow resource={resource} onOpen={() => onOpen(resource)} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {addGrant}
    </div>
  );
}
