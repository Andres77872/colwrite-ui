import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  citationStyleInfo,
  referenceAnchorId,
  referenceTitle,
  useBibliography,
  type BibliographyEntry,
} from '@/editor';
import { revealCitationUsage } from './navigation';
import { CslText } from './CslText';
import { ReferenceStatus } from './ReferenceStatus';
import { findingMarks, useReferenceHealth, type ReferenceFinding } from './referenceHealth';
import { ArrowUpLeft } from 'lucide-react';

const HEADING_ID = 'document-references';

/**
 * The other half of a citation.
 *
 * `[1]` on its own is not a citation, it is a promise of one. The list is
 * derived from the blocks on every render rather than stored, for the same
 * reason numbering is, and set by the page's CSL style: its order, its
 * labels, its punctuation. A reference's state is said beside it, so a
 * retracted work is marked in the list itself (09 §5), and so is what the
 * last reference check found: a record the registries now give otherwise, a
 * duplicate, a citation with no entry in the page's sources (P2.UI-4).
 */
export function ReferencesSection() {
  const { entries, style, hangingIndent, ready } = useBibliography();
  const { findings } = useReferenceHealth();
  if (entries.length === 0) return null;
  const titleOf = (key: string) => referenceTitle(entries.find((entry) => entry.key === key)?.record, key);

  const unresolved = entries.filter((entry) => !entry.record).length;
  const info = citationStyleInfo(style);
  const order = info.order === 'citation' ? 'numbered in order of first citation' : 'sorted by author';

  return (
    // A section of the paper in the paper's own type: the heading is set like
    // the document's H2 and the entries sit in the text column.
    <section aria-labelledby={HEADING_ID} aria-busy={!ready} data-citations-ready={ready} className="references-section pb-2 pt-[2.1em]">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id={HEADING_ID}
          className="text-[1.5em] font-semibold leading-[1.3] tracking-[-0.01em]"
        >
          References
        </h2>
        <p className="text-xs text-muted-foreground">
          {entries.length} {entries.length === 1 ? 'source' : 'sources'} · {info.name}, {order}.
        </p>
        {unresolved > 0 && (
          <Badge variant="warning">
            {unresolved} without details
          </Badge>
        )}
      </div>

      <ol className="mt-2 space-y-0.5 text-[0.9375em]">
        {entries.map((entry) => (
          <ReferenceRow key={entry.key} entry={entry} hangingIndent={hangingIndent} finding={findings.get(entry.key)} titleOf={titleOf} />
        ))}
      </ol>
    </section>
  );
}

function ReferenceRow({
  entry,
  hangingIndent,
  finding,
  titleOf,
}: {
  entry: BibliographyEntry;
  hangingIndent: boolean;
  finding: ReferenceFinding | undefined;
  titleOf: (key: string) => string;
}) {
  const marks = findingMarks(finding, titleOf);
  return (
    <li
      id={referenceAnchorId(entry)}
      data-reference-key={entry.key}
      // Focusable only as a jump target: a citation followed with the keyboard
      // has to leave focus on the entry it landed on, not back in the paragraph.
      tabIndex={-1}
      className="flex rounded-sm py-1"
    >
      {/* A hanging number: wrapped lines align with the text, not the marker. */}
      {entry.marker && (
        <span className="w-9 shrink-0 pr-2 text-right tabular-nums text-muted-foreground">{entry.marker}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('leading-normal', hangingIndent && !entry.marker && 'pl-[2em] -indent-[2em]', !entry.record && 'font-mono text-xs')}>
          <CslText markup={entry.formatted} />
          <ReferenceStatus record={entry.record} inline />
          {/* What the last reference check found, said as text like the marks before it. */}
          {marks.map((mark) => (
            <span key={mark.kind} data-finding={mark.kind} className="ml-1.5 inline-flex items-center rounded-sm bg-tint-yellow px-1 text-xs text-tint-yellow-fg">
              {mark.label}.
            </span>
          ))}
        </p>
        {marks.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">{marks.map((mark) => mark.detail).join(' ')}</p>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {!entry.record && <span>No details attached</span>}
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
  const name = referenceTitle(entry.record, entry.key);
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
