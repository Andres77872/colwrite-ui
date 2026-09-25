import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BookmarkCheck, BookmarkPlus, ExternalLink, MoreHorizontal, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toastContext';
import { cn } from '@/lib/utils';
import { safeExternalHttpUrl } from '@/lib/url';
import {
  canonicalCitationKey,
  useBibliography,
  useEditorActions,
  useOptionalEditorActions,
  type CitationSource,
} from '@/editor';
import { useCiteAtCursor } from '@/components/editor/References';

/** An external link offered from a row's "…" menu. */
export type PaperLink = { label: string; href: string | null | undefined };

export interface PaperRowProps {
  title: string | null;
  authors?: string | null;
  /** Pre-formatted fragments after the authors, e.g. year, venue, citations. */
  meta?: Array<string | null | undefined>;
  /** Abstract or TL;DR, clamped to two lines until the row is expanded. */
  summary?: string | null;
  /** A quiet marker after the meta line, e.g. relevance or page number. */
  tag?: ReactNode;
  thumbnailUrl?: string | null;
  /** What Cite and Add to sources insert. Rows without one only link out. */
  source?: CitationSource;
  links?: PaperLink[];
  /** Provider-specific menu entries, e.g. the citation graph. */
  menuItems?: ReactNode;
  /** Content under the summary: citation contexts, licence terms. */
  children?: ReactNode;
}

/**
 * Whether a clamped paragraph actually hides text. Counting characters was
 * wrong both ways: a 170-character abstract overflows two lines in a 340px
 * sidebar, and a 190-character one fits in a wide one.
 */
function useClampOverflow(text: string, expanded: boolean) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);
  return { ref, overflows };
}

/**
 * PaperRow — one research result, as a calm list row.
 *
 * Replaces a bordered card whose title linked out of the app and whose row of
 * eight same-weight text links buried Cite, the action that matters while
 * writing. Cite and Add to sources float in on hover or focus; everything
 * that leaves the app sits behind "…".
 */
export function PaperRow({
  title,
  authors,
  meta = [],
  summary,
  tag,
  thumbnailUrl,
  source,
  links = [],
  menuItems,
  children,
}: PaperRowProps) {
  const [expanded, setExpanded] = useState(false);
  const displayTitle = title?.trim() || 'Untitled';
  const text = summary?.trim() ?? '';
  const { ref: summaryRef, overflows } = useClampOverflow(text, expanded);
  const details = meta.map((part) => part?.trim()).filter(Boolean).join(' · ');
  const author = authors?.trim();
  const preview = safeExternalHttpUrl(thumbnailUrl);
  const safeLinks = links
    .map((link) => ({ label: link.label, href: safeExternalHttpUrl(link.href) }))
    .filter((link): link is { label: string; href: string } => Boolean(link.href));

  const hasMenu = safeLinks.length > 0 || Boolean(menuItems);
  const hasActions = Boolean(source) || hasMenu;
  const actions = (
    <>
      {source && <CiteButtons source={source} title={displayTitle} />}
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="icon" size="icon-xs" aria-label={`More actions for ${displayTitle}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {menuItems}
            {menuItems && safeLinks.length > 0 && <DropdownMenuSeparator />}
            {safeLinks.map((link) => (
              <DropdownMenuItem key={link.label} asChild>
                <a href={link.href} target="_blank" rel="noreferrer noopener">
                  <ExternalLink aria-hidden="true" />
                  {link.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );

  return (
    <article className="group relative flex gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-hover has-focus-visible:bg-hover has-[[data-state=open]]:bg-hover">
      {preview && (
        <img
          src={preview}
          alt={`Matching page of “${displayTitle}”`}
          loading="lazy"
          className="h-16 w-12 shrink-0 rounded-sm bg-subtle object-cover ring-1 ring-border"
        />
      )}
      <div className="min-w-0 flex-1">
        <h3
          title={expanded ? undefined : displayTitle}
          className={cn('text-sm font-medium leading-snug text-foreground', !expanded && 'line-clamp-2')}
        >
          {displayTitle}
        </h3>
        {/* Authors give way first: the year and venue are what identify a
            paper at a glance once the list is long. The hover actions take
            the tag's place at the end of this line, so they never cover the
            title of the paper about to be cited. */}
        <div className="relative mt-0.5">
          <p
            className={cn(
              'flex min-h-5 min-w-0 items-center text-xs text-muted-foreground',
              // The row's own menu takes focus into a portal, so "open"
              // counts as hovered too: actions stay, the tag stays hidden.
              hasActions &&
                'pointer-fine:group-hover:pr-28 pointer-fine:group-focus-within:pr-28 pointer-fine:group-has-[[data-state=open]]:pr-28',
            )}
          >
            {author && <span className="min-w-0 truncate">{author}</span>}
            {details && (
              <span className="min-w-0 max-w-[65%] shrink-0 truncate">
                {author && <span aria-hidden="true">&nbsp;·&nbsp;</span>}
                {details}
              </span>
            )}
            {tag && (
              <span
                className={cn(
                  'ml-auto shrink-0 pl-2 tabular-nums',
                  hasActions &&
                    'pointer-fine:group-hover:hidden pointer-fine:group-focus-within:hidden pointer-fine:group-has-[[data-state=open]]:hidden',
                )}
              >
                {tag}
              </span>
            )}
          </p>
          {hasActions && (
            <div
              className={cn(
                'absolute -right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5',
                'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100',
                // Touch screens have no hover: there the actions sit in the
                // row, under the meta line, where they cover nothing.
                'pointer-coarse:static pointer-coarse:-ml-1.5 pointer-coarse:mt-1 pointer-coarse:w-fit pointer-coarse:translate-y-0 pointer-coarse:opacity-100',
              )}
            >
              {actions}
            </div>
          )}
        </div>
        {text && (
          <p
            ref={summaryRef}
            className={cn('mt-1 text-xs leading-5 text-muted-foreground', !expanded && 'line-clamp-2')}
          >
            {text}
          </p>
        )}
        {(overflows || expanded) && (
          <button
            type="button"
            className="mt-0.5 rounded-xs text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
        {children && <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">{children}</div>}
      </div>
    </article>
  );
}

/** Cite and Add to sources — only inside an editor, where there is a caret. */
function CiteButtons({ source, title }: { source: CitationSource; title: string }) {
  if (!useOptionalEditorActions()) return null;
  return <EditorCiteButtons source={source} title={title} />;
}

function EditorCiteButtons({ source, title }: { source: CitationSource; title: string }) {
  const cite = useCiteAtCursor();
  const { upsertSources } = useEditorActions();
  const bibliography = useBibliography();
  const { toast } = useToast();
  const [added, setAdded] = useState(false);
  const inSources = added || bibliography.byKey.has(canonicalCitationKey(source.key));

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        aria-label={`Cite ${title} at the cursor`}
        onClick={() => {
          if (cite([source])) toast({ title: 'Citation inserted', description: source.title });
        }}
      >
        <Quote aria-hidden="true" />
        Cite
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="icon"
            size="icon-xs"
            aria-label={inSources ? `${title} is in sources` : `Add ${title} to sources`}
            aria-pressed={inSources}
            onClick={() => {
              upsertSources([source]);
              setAdded(true);
              if (!inSources) toast({ title: 'Added to sources', description: source.title });
            }}
          >
            {inSources ? (
              <BookmarkCheck aria-hidden="true" className="text-primary" />
            ) : (
              <BookmarkPlus aria-hidden="true" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{inSources ? 'In sources' : 'Add to sources'}</TooltipContent>
      </Tooltip>
    </>
  );
}
