import { cn } from '@/lib/utils';

export const APP_NAME = 'ColWrite';
export const APP_TAGLINE = 'Assistant writer for arXiv papers';

const MARK_SIZES = {
  sm: 'h-6 w-6 rounded-md text-2xs',
  md: 'h-7 w-7 rounded-md text-xs',
  lg: 'h-10 w-10 rounded-lg text-base',
  xl: 'h-12 w-12 rounded-lg text-xl',
} as const;

export type BrandSize = keyof typeof MARK_SIZES;

/**
 * BrandMark — the "CW" tile.
 *
 * Previously re-implemented in five places with three different fills and
 * two different foreground colours; the mark now has one definition so the
 * topbar, sidebar, auth dialog and landing screens stay in step.
 */
export function BrandMark({
  size = 'md',
  className,
}: {
  size?: BrandSize;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center font-bold tracking-tight',
        'bg-gradient-to-br from-primary to-accent-dark text-primary-foreground',
        MARK_SIZES[size],
        className,
      )}
    >
      CW
    </span>
  );
}

/**
 * BrandLockup — mark plus wordmark, optionally with the product tagline.
 */
export function BrandLockup({
  size = 'md',
  showTagline = false,
  className,
}: {
  size?: BrandSize;
  showTagline?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandMark size={size} />
      <span className="min-w-0">
        <span
          className={cn(
            'block font-semibold text-foreground',
            size === 'xl' || size === 'lg' ? 'text-xl' : 'text-base',
          )}
        >
          {APP_NAME}
        </span>
        {showTagline && (
          <span className="block truncate text-xs text-muted-foreground">{APP_TAGLINE}</span>
        )}
      </span>
    </span>
  );
}
