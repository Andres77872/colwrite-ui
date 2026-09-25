import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { safeExternalHttpUrl } from '@/lib/url';
import {
  formatReference,
  referenceAnchorId,
  referenceMarker,
  useBibliography,
  type BibliographyEntry,
  type CitationStyle,
} from '@/editor';
import { revealCitationUsage } from './navigation';
import { ArrowUpLeft, ExternalLink } from 'lucide-react';

const HEADING_ID = 'document-references';

const STYLE_NOTE: Record<CitationStyle, string> = {
  numeric: 'Numbered in order of first citation.',
  ieee: 'IEEE — numbered in order of first citation.',
  'author-year': 'Author–year — sorted alphabetically.',
};

/**
 * The other half of a citation.
 *
 * `[1]` on its own is not a citation, it is a promise of one; until this list
 * existed the document made that promise on every page and never kept it. The
 * list is derived from the blocks on every render rather than stored, for the
 * same reason numbering is: a reference list that has to be kept in sync by
 * hand is a reference list that is wrong.
 */
export function ReferencesSection() {
  const { entries, style } = useBibliography();
  if (entries.length === 0) return null;

  const unresolved = entries.filter((entry) => entry.unresolved).length;

  return (
    // A section of the paper in the paper's own type: the heading is set like
    // the document's H2 and the entries sit in the text column.
    <section aria-labelledby={HEADING_ID} className="references-section pb-2 pt-[2.1em]">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id={HEADING_ID}
          className="text-[1.5em] font-semibold leading-[1.3] tracking-[-0.01em]"
        >
          References
        </h2>
        <p className="text-xs text-muted-foreground">
          {entries.length} {entries.length === 1 ? 'source' : 'sources'} · {STYLE_NOTE[style]}
        </p>
        {unresolved > 0 && (
          <Badge variant="warning">
            {unresolved} without details
          </Badge>
        )}
      </div>

      <ol className="mt-2 space-y-0.5 text-[0.9375em]">
        {entries.map((entry) => (
          <ReferenceRow key={entry.key} entry={entry} style={style} />
        ))}
      </ol>
    </section>
  );
}

function ReferenceRow({ entry, style }: { entry: BibliographyEntry; style: CitationStyle }) {
  const parts = formatReference(entry, style);
  const marker = referenceMarker(entry, style);
  // The href is built from provider data, so it goes through the same gate as
  // every other externally sourced link in the app.
  const href = safeExternalHttpUrl(parts.href);

  return (
    <li
      id={referenceAnchorId(entry)}
      // Focusable only as a jump target: a citation followed with the keyboard
      // has to leave focus on the entry it landed on, not back in the paragraph.
      tabIndex={-1}
      className="flex rounded-sm py-1"
    >
      {/* A hanging number: wrapped lines align with the text, not the marker. */}
      {marker && (
        <span className="w-9 shrink-0 pr-2 text-right tabular-nums text-muted-foreground">{marker}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('leading-normal', entry.unresolved && 'font-mono text-xs')}>
          {parts.text}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-w-0 items-center gap-1 hover:text-foreground"
            >
              <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
              <span className="truncate">{parts.linkLabel}</span>
            </a>
          )}
          {entry.unresolved && <span>No details attached</span>}
          <BackLinks entry={entry} />
        </div>
      </div>
    </li>
  );
}

/**
 * Where this source is cited from.
 *
 * A reference list that only points outwards leaves the reverse question — "why
 * is this in my bibliography?" — answerable only by reading the whole document.
 */
function BackLinks({ entry }: { entry: BibliographyEntry }) {
  const name = entry.source.title ?? entry.displayKey;
  const single = entry.usages.length === 1;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {!single && <span>Cited at</span>}
      {entry.usages.map((usage) => (
        <button
          key={usage.childId}
          type="button"
          onClick={() => revealCitationUsage(usage)}
          aria-label={
            single
              ? `Go to the citation of ${name}`
              : `Go to citation ${usage.ordinal} of ${entry.usages.length} for ${name}`
          }
          className="inline-flex items-center gap-0.5 rounded-xs px-1 tabular-nums transition-colors hover:bg-hover hover:text-foreground"
        >
          <ArrowUpLeft aria-hidden="true" className="h-3 w-3" />
          {single ? 'Cited once' : usage.ordinal}
        </button>
      ))}
    </span>
  );
}
