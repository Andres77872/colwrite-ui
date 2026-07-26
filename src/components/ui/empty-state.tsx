import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: ElementType;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** `panel` suits narrow side panels; `page` suits the main canvas. */
  size?: 'panel' | 'page';
  className?: string;
}

/**
 * EmptyState — the single "nothing here yet" treatment.
 *
 * Every panel used to hand-roll this with a decorative emoji, which read
 * inconsistently and was announced as meaningless text by screen readers.
 * The icon here is presentational and hidden from the a11y tree; the title
 * and description carry the meaning.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'panel',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'panel' ? 'gap-2 px-4 py-10' : 'gap-3 px-6 py-16',
        className,
      )}
    >
      {Icon && (
        <div
          aria-hidden="true"
          className={cn(
            'grid place-items-center rounded-xl border border-border/50 bg-muted/30 text-muted-foreground/70',
            size === 'panel' ? 'mb-1 h-10 w-10' : 'mb-1 h-12 w-12',
          )}
        >
          <Icon className={size === 'panel' ? 'h-4.5 w-4.5' : 'h-5 w-5'} />
        </div>
      )}
      <p className={cn('font-medium text-foreground/90', size === 'page' && 'text-lg')}>{title}</p>
      {description && (
        <p className="max-w-[38ch] text-sm text-muted-foreground text-balance">{description}</p>
      )}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
