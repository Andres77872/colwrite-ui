import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { safeExternalHttpUrl } from '@/lib/url';
import { referenceAuthors, referenceLink, referenceTitle, referenceVenue, referenceYear } from '@/editor';
import { ReferenceStatus, SourceActions, type SourceActionsProps } from '@/components/editor/References';
import { PAPER_SOURCE_NAMES, type Paper } from '@/data/papers';

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

export interface PaperRowProps {
  paper: Paper;
  /** The picker's Cite, which adds the work to the citation it edits. */
  cite?: SourceActionsProps['cite'];
  /** A shorter row, without the abstract: the citation picker's. */
  compact?: boolean;
  /** Entries for "…": the citation graph. */
  menuItems?: ReactNode;
  /** Content under the summary: how a graph result cites its seed. */
  children?: ReactNode;
}

/**
 * PaperRow — one paper result, the same row in the Research panel and the
 * citation picker (P2.UI-2). Everything on it is read from the work's
 * reference record — the one Cite and Add to sources insert — so a paper
 * reads the same here as in a reply's sources and the reference list. Its
 * state shows where it matters: retracted, a preprint with a published
 * version, needs review.
 */
export function PaperRow({ paper, cite, compact = false, menuItems, children }: PaperRowProps) {
  const { record } = paper;
  const [expanded, setExpanded] = useState(false);
  const title = referenceTitle(record, 'Untitled');
  const text = compact ? '' : paper.abstract?.trim() ?? '';
  const { ref: summaryRef, overflows } = useClampOverflow(text, expanded);
  const citations = paper.citationCount === null ? null : `${paper.citationCount.toLocaleString()} citations`;
  const details = [referenceYear(record), referenceVenue(record), compact ? null : citations].filter(Boolean).join(' · ');
  const author = referenceAuthors(record);
  const link = referenceLink(record);
  const links = [
    { label: link?.href.startsWith('https://doi.org/') ? 'Open DOI' : 'Open source', href: link?.href },
    { label: 'Open access copy', href: paper.openAccess?.pdfUrl ?? paper.openAccess?.url },
  ]
    .map((entry) => ({ label: entry.label, href: safeExternalHttpUrl(entry.href) }))
    .filter((entry): entry is { label: string; href: string } => Boolean(entry.href))
    .filter((entry, index, all) => all.findIndex((other) => other.href === entry.href) === index);
  const foundBy = paper.foundBy.map((id) => PAPER_SOURCE_NAMES[id]).join(', ');

  const hasMenu = links.length > 0 || Boolean(menuItems);
  const actions = (
    <>
      <SourceActions record={record} cite={cite} />
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="icon" size="icon-xs" aria-label={`More actions for ${title}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {menuItems}
            {menuItems && links.length > 0 && <DropdownMenuSeparator />}
            {links.map((entry) => (
              <DropdownMenuItem key={entry.href} asChild>
                <a href={entry.href} target="_blank" rel="noreferrer noopener">
                  <ExternalLink aria-hidden="true" />
                  {entry.label}
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
    <article
      data-paper-key={record.key}
      className="group relative flex gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-hover has-focus-visible:bg-hover has-[[data-state=open]]:bg-hover"
    >
      <div className="min-w-0 flex-1">
        <h3
          title={expanded ? undefined : title}
          className={cn('text-sm font-medium leading-snug text-foreground', !expanded && 'line-clamp-2')}
        >
          {title}
        </h3>
        {/* Authors give way first: the year and venue are what identify a
            paper at a glance once the list is long. The hover actions sit at
            the end of this line, so they never cover the title. */}
        <div className="relative mt-0.5">
          <p
            className={cn(
              'flex min-h-5 min-w-0 items-center text-xs text-muted-foreground',
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
          </p>
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
        </div>
        <ReferenceStatus record={record} className="mt-1" />
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
        {!compact && foundBy && <p className="mt-0.5 text-2xs text-muted-foreground">Found by {foundBy}</p>}
        {children && <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">{children}</div>}
      </div>
    </article>
  );
}
