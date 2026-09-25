import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookmarkPlus, BookOpen, Check, ChevronRight, FileText, Globe, Library, Quote } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentSource } from '@/services/streamParser';
import { useEditorActions } from '@/editor';
import { useCiteAtCursor } from '@/components/editor/References';
import { useToast } from '@/components/ui/toastContext';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { anchorId, useSourceMarkers } from './answerSourceMarkers';

function originOf(source: AgentSource): { label: string; icon: typeof Globe } {
  if (source.provider === 'web') return { label: 'Web', icon: Globe };
  if (source.provider === 'resource') return { label: 'Your PDF', icon: Library };
  if (source.provider === 'semantic_scholar') return { label: 'Semantic Scholar', icon: BookOpen };
  if (source.provider === 'arxiv') return { label: 'arXiv', icon: BookOpen };
  return { label: 'Source', icon: FileText };
}

function linkOf(source: AgentSource): string | undefined {
  const href = source.url ?? (source.doi ? `https://doi.org/${source.doi}` : undefined);
  return href && /^https?:\/\//.test(href) ? href : undefined;
}

/** The record without the answer-local handle, as the library keeps it. */
function recordOf({ id: _id, origin: _origin, ...record }: AgentSource) {
  return record;
}

/**
 * Cite at the caret, or keep in the document's library — with the record's
 * metadata, never anything the answer said about it.
 */
function useSourceActions(source: AgentSource) {
  const cite = useCiteAtCursor();
  const { upsertSources } = useEditorActions();
  const { toast } = useToast();
  const [saved, setSaved] = useState(false);
  return {
    saved,
    cite: () => {
      if (cite([recordOf(source)])) toast({ title: 'Citation inserted', description: source.title });
    },
    save: () => {
      upsertSources([recordOf(source)]);
      setSaved(true);
    },
  };
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
  const href = linkOf(source);
  const byline = [source.authors, source.year].filter(Boolean).join(' · ');
  const actions = useSourceActions(source);
  const title = source.title || source.key;

  return (
    <li
      id={anchorId(messageId, source.id)}
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
      </div>
      {/* On hover or keyboard focus with a pointer; always on touch, where
          there is no hover to reveal them. */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/source:opacity-100 group-hover/source:opacity-100 [@media(hover:none)]:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={actions.cite}
              aria-label={`Cite “${title}” at the cursor`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Quote aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Cite at cursor</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={actions.save}
              aria-pressed={actions.saved}
              aria-label={actions.saved ? `“${title}” is in sources` : `Add “${title}” to sources`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {actions.saved ? (
                <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" />
              ) : (
                <BookmarkPlus aria-hidden="true" className="h-3.5 w-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{actions.saved ? 'In sources' : 'Add to sources'}</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
}

/**
 * The sources behind an answer.
 *
 * Every source the assistant's research tools returned in the turn arrives
 * from the server with its metadata; the ones the answer cites (`[S3]`) are
 * listed first, numbered as the markers read, and the rest — consulted but
 * not cited — fold away beneath them.
 */
export function AnswerSources({
  messageId,
  text,
  sources,
}: {
  messageId: string;
  text: string;
  sources: readonly AgentSource[];
}) {
  const { cited, numbers } = useSourceMarkers(messageId, text, sources);
  const [showAll, setShowAll] = useState(false);
  const citedSet = new Set(cited);
  const citedSources = cited
    .map((id) => sources.find((source) => source.id === id))
    .filter((source): source is AgentSource => Boolean(source));
  const others = sources.filter((source) => !citedSet.has(source.id));
  if (sources.length === 0) return null;

  return (
    <section aria-label="Sources" className="-mx-1.5 mt-1">
      {citedSources.length > 0 && (
        <>
          <h4 className="px-1.5 pb-0.5 text-xs font-medium text-muted-foreground">Sources</h4>
          <ol>
            {citedSources.map((source) => (
              <SourceItem key={source.id} messageId={messageId} source={source} number={numbers.get(source.id)} />
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
                <SourceItem key={source.id} messageId={messageId} source={source} />
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actions = useSourceActions(source);
  const origin = originOf(source);
  const href = linkOf(source);
  const byline = [source.authors, source.year, source.venue].filter(Boolean).join(' · ');

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const schedule = (next: boolean, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          className="inline-flex"
          onPointerEnter={() => schedule(true, OPEN_DELAY_MS)}
          onPointerLeave={() => schedule(false, CLOSE_DELAY_MS)}
          onFocus={() => schedule(true, 0)}
          onBlur={() => schedule(false, CLOSE_DELAY_MS)}
        >
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        // Off the panel's edge: flush against the viewport it read as clipped.
        collisionPadding={12}
        className="w-72 max-w-[calc(100vw-24px)] p-3"
        // A preview, not a dialog: focus stays on the marker.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={() => schedule(true, 0)}
        onPointerLeave={() => schedule(false, CLOSE_DELAY_MS)}
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
            {source.title || source.key}
          </a>
        ) : (
          <p className="mt-1.5 line-clamp-3 text-sm font-medium text-foreground">{source.title || source.key}</p>
        )}
        {byline && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{byline}</p>}
        <div className="-mx-1 mt-2 flex items-center gap-1">
          <button
            type="button"
            onClick={actions.cite}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-foreground hover:bg-hover"
          >
            <Quote aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
            Cite
          </button>
          <button
            type="button"
            onClick={actions.save}
            aria-pressed={actions.saved}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-foreground hover:bg-hover"
          >
            {actions.saved ? (
              <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" />
            ) : (
              <BookmarkPlus aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {actions.saved ? 'In sources' : 'Add to sources'}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
