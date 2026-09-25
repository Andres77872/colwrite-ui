import { Skeleton } from '@/components/ui/spinner';

/**
 * Placeholder rows for a search that has not returned yet, so a first search
 * does not look idle while the request is in flight.
 */
export function ResultsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="space-y-1">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="px-2 py-2.5">
          <Skeleton className="mb-2 h-4 w-4/5" />
          <Skeleton className="mb-2 h-3 w-2/5" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}
