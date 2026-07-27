import { Skeleton } from '@/components/ui/spinner';

/**
 * Placeholder cards for a search that has not returned yet.
 *
 * The research panels previously showed nothing at all on a first search —
 * only the submit button's label changed to "Searching…" — so the panel looked
 * idle while a request was in flight.
 */
export function ResultsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="space-y-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-lg border border-border p-3">
          <Skeleton className="mb-2 h-4 w-4/5" />
          <Skeleton className="mb-2 h-3 w-2/5" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}
