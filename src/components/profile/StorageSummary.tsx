import { Button } from '@/components/ui/button';
import { formatBytes, formatCompact } from '@/lib/text';
import type { UsageSummary } from '@/data/userProfile';
import { BookOpen } from 'lucide-react';

function plural(count: number, one: string, many: string): string {
  return `${formatCompact(count)} ${count === 1 ? one : many}`;
}

/**
 * StorageSummary: how much the Library holds, with the way to it.
 *
 * Only the totals. The PDFs themselves are listed, uploaded and deleted in
 * the Library, so Settings no longer keeps a second PDF list of its own.
 */
export function StorageSummary({
  summary,
  onOpenLibrary,
}: {
  summary: UsageSummary;
  onOpenLibrary: () => void;
}) {
  const pdfs = summary.resources_active;
  const details =
    pdfs === 0
      ? 'Upload PDFs in the Library to use them on your pages.'
      : [
          `${formatCompact(summary.resources_extracted)} of ${formatCompact(pdfs)} converted to text`,
          plural(summary.collections_active, 'collection', 'collections'),
        ].join(' · ');

  return (
    <section className="border-t border-border pt-6" aria-labelledby="usage-storage">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="usage-storage" className="text-md font-semibold">
            Storage
          </h2>
          <p className="mt-1 text-sm">
            <span className="font-medium">{plural(pdfs, 'PDF', 'PDFs')}</span>
            <span className="text-muted-foreground"> · {formatBytes(summary.resources_bytes)}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{details}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onOpenLibrary}>
          <BookOpen aria-hidden="true" />
          Open Library
        </Button>
      </div>
    </section>
  );
}
