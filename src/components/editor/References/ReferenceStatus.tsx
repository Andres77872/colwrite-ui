import { AlertTriangle, ExternalLink, FileWarning, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { referenceMarks, type ReferenceMark, type ReferenceRecord } from '@/editor';

const TONES: Record<ReferenceMark['tone'], string> = {
  destructive: 'bg-tint-red text-tint-red-fg',
  warning: 'bg-tint-yellow text-tint-yellow-fg',
  neutral: 'bg-subtle text-muted-foreground',
};

function MarkIcon({ mark }: { mark: ReferenceMark }) {
  const Icon = mark.kind === 'retracted' ? FileWarning : mark.tone === 'neutral' ? Info : AlertTriangle;
  return <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />;
}

/**
 * A reference's state and flags where it is shown (09 §5, 13 §7): nothing
 * for a verified or unchecked work, a mark for one that needs review (what
 * differs on hover), is not found, is retracted (with its notice), or is a
 * preprint with a published version. Each mark's words are its accessible
 * name; the sentence is its description and its tooltip.
 *
 * `inline` sets them as text after a reference-list entry, where a reader
 * of the page or its export must see a retraction without hovering.
 */
export function ReferenceStatus({
  record,
  inline = false,
  className,
}: {
  record: ReferenceRecord | null | undefined;
  inline?: boolean;
  className?: string;
}) {
  const marks = referenceMarks(record);
  if (marks.length === 0) return null;
  if (inline) {
    return (
      <span className={cn('reference-status', className)}>
        {marks.map((mark) => (
          <span key={mark.kind} data-mark={mark.kind} className={cn('ml-1.5 inline-flex items-center gap-1 rounded-sm px-1 text-xs', TONES[mark.tone])}>
            <MarkIcon mark={mark} />
            {mark.label}.
            <span className="sr-only"> {mark.detail}</span>
            {mark.href && (
              <a href={mark.href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center hover:underline" aria-label={`${mark.label}: the notice`}>
                <ExternalLink aria-hidden="true" className="h-3 w-3" />
              </a>
            )}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {marks.map((mark) => (
        <Tooltip key={mark.kind}>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              data-mark={mark.kind}
              aria-label={`${mark.label}: ${mark.detail}`}
              className={cn(
                'inline-flex h-4 items-center gap-1 rounded-sm px-1 text-2xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                TONES[mark.tone],
              )}
            >
              <MarkIcon mark={mark} />
              {mark.label}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{mark.detail}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}
