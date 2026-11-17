import { EmptyState } from '@/components/ui/empty-state';
import { displayTitle, isUntitledName } from '@/components/layout/displayTitle';
import { formatCompact } from '@/lib/text';
import { cn } from '@/lib/utils';
import type { UserDocument } from '@/data/userProfile';
import { FileText } from 'lucide-react';

const COLUMNS = [
  { key: 'saves', label: 'Saves' },
  { key: 'chats', label: 'Chats' },
  { key: 'assistant_runs', label: 'Assistant runs' },
] as const;

/**
 * PageActivityTable: the saves, chats and assistant runs recorded for each
 * page, the one thing Settings' old page list showed that the sidebar cannot.
 *
 * It is usage, not a way to reach a page: the names are plain text, with no
 * Open action and no save counter ("v3" is not a version). Pages are opened
 * and managed in the sidebar.
 */
export function PageActivityTable({
  pages,
  totalPages,
}: {
  /** Most recently edited first, as the API returns them. */
  pages: UserDocument[];
  /** Every active page, to say when the table shows only the latest ones. */
  totalPages: number;
}) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="text-md font-semibold">Activity by page</h2>
      <p className="text-xs text-muted-foreground">Most recently edited first</p>

      {pages.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No pages yet"
          description="Saves, chats and assistant runs are counted here for each page."
        />
      ) : (
        <>
          <table className="mt-3 w-full table-fixed text-left text-xs">
            <caption className="sr-only">Saves, chats and assistant runs for each page</caption>
            <thead className="text-muted-foreground">
              <tr>
                {/* Fixed layout: the counts keep their width and the name
                    takes the rest, truncating instead of pushing them off. */}
                <th scope="col" className="py-1.5 pr-2 font-medium">
                  Page
                </th>
                {COLUMNS.map((column) => (
                  <th key={column.key} scope="col" className="w-24 py-1.5 pl-2 text-right font-medium max-sm:w-16">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => {
                const name = displayTitle(page.name);
                return (
                  <tr key={page.id} className="border-t border-border">
                    <th
                      scope="row"
                      className={cn(
                        'truncate py-1.5 pr-2 font-normal',
                        isUntitledName(page.name) && 'text-muted-foreground',
                      )}
                      title={name}
                    >
                      {name}
                    </th>
                    {COLUMNS.map((column) => (
                      <td key={column.key} className="py-1.5 pl-2 text-right tabular-nums">
                        {formatCompact(page[column.key])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > pages.length && (
            <p className="mt-2 text-2xs text-muted-foreground">
              The {pages.length} most recently edited of {formatCompact(totalPages)} pages.
            </p>
          )}
        </>
      )}
    </section>
  );
}
