import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Spinner — one busy indicator for the whole app.
 * Always paired with visible text, so it is hidden from assistive tech;
 * announce loading state with `aria-busy` on the surrounding region.
 */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden="true" className={cn('h-3.5 w-3.5 animate-spin', className)} />;
}

/**
 * Skeleton — placeholder block for content that is still loading.
 * Preferable to a bare "Loading…" string: it preserves layout and avoids
 * the jump that happens when real rows arrive.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-shimmer rounded-md bg-muted', className)}
      style={style}
    />
  );
}
