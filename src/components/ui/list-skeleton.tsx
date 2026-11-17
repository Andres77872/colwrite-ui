import { cn } from '@/lib/utils';
import { Skeleton } from './spinner';

/**
 * ListSkeleton: the first load of any list, in the shape of its rows.
 *
 * Rows of an icon and a line of text that gets shorter down the list, so the
 * page does not jump when the real rows arrive. Hidden from assistive tech;
 * the list carries `aria-busy` instead.
 */
export function ListSkeleton({
  rows = 4,
  dense = false,
  className,
}: {
  rows?: number;
  /** Sidebar rows (30 px) rather than panel rows. */
  dense?: boolean;
  className?: string;
}) {
  return (
    <ul aria-hidden="true" className={cn('flex flex-col', dense ? 'gap-px' : 'gap-1.5', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className={cn('flex items-center gap-2 px-2', dense ? 'h-[30px]' : 'h-10')}>
          <Skeleton className={dense ? 'h-4 w-4' : 'h-6 w-6'} />
          <Skeleton className="h-3 flex-1" style={{ maxWidth: `${Math.max(30, 80 - index * 12)}%` }} />
        </li>
      ))}
    </ul>
  );
}
