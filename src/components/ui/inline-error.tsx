import { cn } from '@/lib/utils';

/**
 * InlineError: a list or panel that could not load, said where it is.
 *
 * Background loads report here, never in a toast. When rows are already on
 * screen they stay, and this is the one line under them that says the
 * refresh failed; with nothing on screen it adds the reason.
 */
export function InlineError({
  title,
  detail,
  onRetry,
  retryLabel = 'Retry',
  className,
}: {
  title: string;
  detail?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('px-2 py-1.5 text-xs text-muted-foreground', className)}>
      <p className={cn('font-medium', detail ? 'text-destructive' : 'inline')}>{title}</p>
      {detail && <p className="mt-0.5 break-words">{detail}</p>}
      {onRetry && (
        <button
          type="button"
          className={cn('font-medium text-link hover:underline', detail ? 'mt-1' : 'ml-1.5')}
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
