import { cn } from '@/lib/utils';
import { badgeVariants } from '@/components/ui/badgeVariants';
import type { ExtractionStatus } from '@/services/resources';
import { describeExtraction } from './extractionStatus';

/**
 * ExtractionBadge — whether the assistant can read this file yet.
 *
 * Styled with `badgeVariants` on a `<span>` rather than rendered through
 * `<Badge>`, which is a `<div>`: this sits inside `<p>` and `<span>` in the
 * list rows and the dashboard, and flow content there is not merely invalid —
 * the parser closes the paragraph early and the row falls apart.
 *
 * The provider's own error is appended to the accessible description rather
 * than shown inline: it is upstream text of unbounded length and it belongs to
 * the one file, not to the list. The detail view prints it in full.
 */
export function ExtractionBadge({
  status,
  error,
  describe = false,
  className,
}: {
  status: ExtractionStatus | null;
  error?: string | null;
  /**
   * Add the hint to the accessible name.
   *
   * Off by default because one of these badges sits *inside* the row button in
   * the library list, where the hint would be read as part of the row's name —
   * "paper.pdf, Ready, the assistant can read and quote this file, 1.2 MB" is
   * worse than the label alone. Turn it on wherever the badge stands on its
   * own, so the explanation is not trapped in a mouse-only `title`.
   */
  describe?: boolean;
  className?: string;
}) {
  const meta = describeExtraction(status);
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        badgeVariants({ variant: meta.variant }),
        'gap-1 px-1.5 py-0 text-2xs font-medium',
        className,
      )}
      title={error ? `${meta.hint} — ${error}` : meta.hint}
    >
      <Icon aria-hidden="true" className={cn('h-3 w-3', meta.spin && 'animate-spin')} />
      {meta.label}
      {describe && <span className="sr-only">. {meta.hint}</span>}
    </span>
  );
}
