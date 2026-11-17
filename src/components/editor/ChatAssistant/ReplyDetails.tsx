import { Fragment } from 'react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { replyDetails, replyNotes, replySummary, type ReplyMeta } from './replyMeta';

/**
 * When a reply was written, how long it took and what it used, in one quiet
 * line under it; the full account (tokens in and out, first words, tools,
 * engine) opens from it. A popover rather than a tooltip, so it opens with a
 * tap or the keyboard too.
 */
export function ReplyDetails({ meta, className }: { meta: ReplyMeta; className?: string }) {
  const summary = replySummary(meta);
  if (summary.length === 0) return null;
  const details = replyDetails(meta);
  const notes = replyNotes(meta);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs tabular-nums text-muted-foreground outline-none transition-[color,background-color,opacity] duration-120 hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-hover data-[state=open]:text-foreground',
            className,
          )}
        >
          <span className="sr-only">Reply details:</span>
          {summary.map((part, index) => (
            <Fragment key={part.key}>
              {index > 0 && <span aria-hidden="true">·</span>}
              <span>
                <span className="sr-only">{`${index > 0 ? ', ' : ' '}${part.spoken} `}</span>
                {part.dateTime ? <time dateTime={part.dateTime}>{part.text}</time> : part.text}
              </span>
            </Fragment>
          ))}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Reply details</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
          {details.map((row) => (
            <Fragment key={row.label}>
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="break-words text-right tabular-nums text-foreground">{row.value}</dd>
            </Fragment>
          ))}
        </dl>
        {notes.map((note) => (
          <p key={note} className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
            {note}
          </p>
        ))}
      </PopoverContent>
    </Popover>
  );
}
