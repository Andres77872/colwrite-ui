import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, ChevronRight, FileText, Globe, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentSource } from '@/api/assistant/streamParser';
import { referenceAuthors, referenceByline, referenceLink, referenceYear } from '@/editor';
import { ReferenceStatus, SourceActions } from '@/components/editor/References';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { anchorId, useSourceMarkers } from './answerSourceMarkers';

/** Where a reply's source came from, in a word or two. */
const ORIGINS: Record<string, { label: string; icon: typeof Globe }> = {
  web: { label: 'Web', icon: Globe },
  // The Library's own icon, as in the sidebar; papers found outside it get another.
  resource: { label: 'Your PDF', icon: BookOpen },
  openalex: { label: 'OpenAlex', icon: GraduationCap },
  semantic_scholar: { label: 'Semantic Scholar', icon: GraduationCap },
  arxiv_index: { label: 'arXiv index', icon: GraduationCap },
  arxiv: { label: 'arXiv', icon: GraduationCap },
  crossref: { label: 'Crossref', icon: GraduationCap },
  doi_org: { label: 'DOI registry', icon: GraduationCap },
};

function originOf(source: AgentSource): { label: string; icon: typeof Globe } {
  return ORIGINS[source.provider] ?? { label: 'Source', icon: FileText };
}

/** Where a source's record can be opened: its DOI, else its URL. */
function sourceHref(source: AgentSource): string | undefined {
  return referenceLink(source.record)?.href;
}

function SourceItem({
  messageId,
  source,
  number,
}: {
  messageId: string;
  source: AgentSource;
  number?: number;
}) {
  const origin = originOf(source);
  const href = sourceHref(source);
  const byline = [referenceAuthors(source.record), referenceYear(source.record)].filter(Boolean).join(' · ');
  const title = source.title;

  return (
    <li
      id={anchorId(messageId, source.handle)}
      tabIndex={-1}
      className="group/source relative flex items-start gap-2 rounded-md px-1.5 py-1 outline-none transition-colors duration-120 hover:bg-hover focus:bg-hover"
    >
      <span className="mt-0.5 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm bg-subtle px-1 text-[11px] font-medium tabular-nums text-muted-foreground">
        {number ?? <origin.icon aria-hidden="true" className="h-3 w-3" />}
      </span>
      <div className="min-w-0 flex-1">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            title={title}
            className="block truncate text-sm text-foreground hover:underline"
          >
            {title}
          </a>
        ) : (
          <p title={title} className="truncate text-sm text-foreground">
            {title}
          </p>
        )}
        <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <origin.icon aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span className="truncate">{byline || origin.label}</span>
        </p>
        <ReferenceStatus record={source.record} className="mt-0.5" />
      </div>
      {/* On hover or keyboard focus with a pointer; always on touch, where
          there is no hover to reveal them. */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/source:opacity-100 group-hover/source:opacity-100 [@media(hover:none)]:opacity-100">
        <SourceActions record={source.record} />
      </div>
    </li>
  );
}

/**
 * The sources behind an answer.
 *
 * The ones the answer cites (`[S3]`) are listed first, numbered as the
 * markers read, whichever turn of the conversation found them (`known`). The
 * rest of what this reply's tools found, consulted but not cited, fold away
 * beneath them.
 */
export function AnswerSources({
  messageId,
  text,
  sources,
  known,
}: {
  messageId: string;
  text: string;
  /** What this reply's tools found or found again. */
  sources: readonly AgentSource[];
  /** Every source the conversation holds, which its markers are read against. */
  known: readonly AgentSource[];
}) {
  const { cited, numbers } = useSourceMarkers(messageId, text, known);
  const [showAll, setShowAll] = useState(false);
  const citedSet = new Set(cited);
  const citedSources = cited
    .map((handle) => known.find((source) => source.handle === handle))
    .filter((source): source is AgentSource => Boolean(source));
  const others = sources.filter((source) => !citedSet.has(source.handle));
  if (citedSources.length === 0 && others.length === 0) return null;

  return (
    <section aria-label="Sources" className="-mx-1.5 mt-1">
      {citedSources.length > 0 && (
        <>
          <h4 className="px-1.5 pb-0.5 text-xs font-medium text-muted-foreground">Sources</h4>
          <ol>
            {citedSources.map((source) => (
              <SourceItem key={source.handle} messageId={messageId} source={source} number={numbers.get(source.handle)} />
            ))}
          </ol>
        </>
      )}
      {others.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowAll((open) => !open)}
            aria-expanded={showAll}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-xs text-muted-foreground transition-colors duration-120 hover:bg-hover hover:text-foreground"
          >
            <ChevronRight aria-hidden="true" className={cn('h-3 w-3 transition-transform', showAll && 'rotate-90')} />
            {citedSources.length > 0 ? `${others.length} more consulted` : `${others.length} sources consulted`}
          </button>
          {showAll && (
            <ul>
              {others.map((source) => (
                <SourceItem key={source.handle} messageId={messageId} source={source} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

const OPEN_DELAY_MS = 250;
const CLOSE_DELAY_MS = 150;

/**
 * A citation marker's preview: the source's title, byline and where it came
 * from, with Cite and Add to sources — opened by hovering or focusing the
 * marker, and kept open while the pointer is over it.
 *
 * From the keyboard, Enter or Space on the marker opens it as a popover with
 * focus inside, so Cite and Add to sources are in the tab order; Escape
 * closes it and returns to the marker. A click still jumps to the source's
 * row in the list under the reply.
 */
export function SourceHoverCard({
  source,
  number,
  children,
}: {
  source: AgentSource;
  number: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  /** Opened from the keyboard: focus is inside, and only Escape or a click outside closes it. */
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const origin = originOf(source);
  const href = sourceHref(source);
  const byline = referenceByline(source.record);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const schedule = (next: boolean, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  };
  const preview = (next: boolean, delay: number) => {
    if (!pinned) schedule(next, delay);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPinned(false);
      }}
    >
      <PopoverAnchor asChild>
        <span
          ref={anchorRef}
          className="inline-flex"
          onPointerEnter={() => preview(true, OPEN_DELAY_MS)}
          onPointerLeave={() => preview(false, CLOSE_DELAY_MS)}
          onFocus={() => preview(true, 0)}
          onBlur={() => preview(false, CLOSE_DELAY_MS)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            if (timer.current) clearTimeout(timer.current);
            setPinned(true);
            setOpen(true);
          }}
        >
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        // Mounted afresh when pinned, so it takes focus even when the
        // preview was already showing.
        key={pinned ? 'pinned' : 'preview'}
        side="top"
        align="start"
        sideOffset={6}
        // Off the panel's edge: flush against the viewport it read as clipped.
        collisionPadding={12}
        className="w-72 max-w-[calc(100vw-24px)] p-3"
        aria-label={`Source ${number}: ${source.title}`}
        // A preview stays a preview: focus stays on the marker. A pinned card
        // takes it, and gives it back to the marker.
        onOpenAutoFocus={(event) => {
          if (!pinned) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (pinned) anchorRef.current?.querySelector<HTMLElement>('button')?.focus();
        }}
        onPointerEnter={() => preview(true, 0)}
        onPointerLeave={() => preview(false, CLOSE_DELAY_MS)}
      >
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="flex h-4 min-w-4 items-center justify-center rounded-sm bg-subtle px-1 text-[11px] font-medium tabular-nums">
            {number}
          </span>
          <origin.icon aria-hidden="true" className="h-3 w-3" />
          {origin.label}
        </p>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1.5 line-clamp-3 block text-sm font-medium text-foreground hover:underline"
          >
            {source.title}
          </a>
        ) : (
          <p className="mt-1.5 line-clamp-3 text-sm font-medium text-foreground">{source.title}</p>
        )}
        {byline && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{byline}</p>}
        <ReferenceStatus record={source.record} className="mt-1" />
        <div className="mt-2">
          <SourceActions record={source.record} variant="buttons" />
        </div>
      </PopoverContent>
    </Popover>
  );
}
