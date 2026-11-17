import { useId } from 'react';
import { CircleCheck, CircleDashed, CircleMinus, CircleX, FileQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { referenceAuthors, referenceTitle, referenceYear, type ReferenceRecord } from '@/editor';
import { ReferenceStatus, SourceActions } from '@/components/editor/References';
import type { ClaimEvidenceLevel, ClaimStance, ClaimVerdict } from '@/data/claims';

/* ----------------------------------------
   The claim card (13 §7, 09 §6)

   A claim check's verdict, shown with the passages it rests on: each
   passage's work with its evidence level, what the judge made of it, and
   Cite and Add to sources (`SourceActions`). The verdict advises; the card
   acts on nothing. On abstracts and snippets alone the honest answer is
   "Cannot assess without the full text", with how to get it.

   The same card shows a reply's `claim` event, whose passages are handles
   of the conversation's evidence store with no text (TD34), and the
   Research panel's check, whose passages carry their text and record.
   ---------------------------------------- */

export type ClaimCardPassage = {
  /** `S3.2` in a conversation, `P1` from the Research panel. */
  id: string;
  level: ClaimEvidenceLevel;
  stance: ClaimStance;
  /** The work's reference; `null` for a passage whose source the reply did not receive. */
  record: ReferenceRecord | null;
  /** The passage's words, where they were sent (the Research panel). */
  text?: string;
  section?: string | null;
  page?: number | null;
};

export type ClaimCardProps = {
  /** The claim's words, where the card has them (the Research panel's own). */
  claim?: string;
  verdict: ClaimVerdict;
  evidenceLevel: ClaimEvidenceLevel | null;
  cannotAssess: boolean;
  /** The judge's summary and note, where they were sent. */
  summary?: string;
  note?: string | null;
  howToGet?: string | null;
  passages: readonly ClaimCardPassage[];
  /** Sources named that no paper source knew, or held no text of. */
  notFound?: readonly string[];
  className?: string;
};

const VERDICTS: Record<ClaimVerdict, { label: string; detail: string; tone: string; Icon: typeof CircleCheck }> = {
  supported: {
    label: 'Supported',
    detail: 'A passage bears the claim out.',
    tone: 'bg-tint-green text-tint-green-fg',
    Icon: CircleCheck,
  },
  partly: {
    label: 'Partly supported',
    detail: 'The source’s scope is narrower than the claim.',
    tone: 'bg-tint-yellow text-tint-yellow-fg',
    Icon: CircleMinus,
  },
  contradicted: {
    label: 'Contradicted',
    detail: 'A passage says otherwise.',
    tone: 'bg-tint-red text-tint-red-fg',
    Icon: CircleX,
  },
  insufficient: {
    label: 'Not settled',
    detail: 'These passages do not settle it either way.',
    tone: 'bg-subtle text-muted-foreground',
    Icon: CircleDashed,
  },
};

const LEVELS: Record<ClaimEvidenceLevel, string> = {
  full_text: 'Full text',
  abstract: 'Abstract only',
  snippet: 'A snippet',
  metadata: 'Metadata only',
};

const STANCES: Record<ClaimStance, { label: string; tone: string }> = {
  supports: { label: 'Supports', tone: 'text-tint-green-fg' },
  limits: { label: 'Narrows the claim', tone: 'text-tint-yellow-fg' },
  contradicts: { label: 'Contradicts', tone: 'text-tint-red-fg' },
  unrelated: { label: 'Unrelated', tone: 'text-muted-foreground' },
};

/** How to read a check that could not assess, when the result says nothing of it (a reply's). */
const HOW_TO_GET =
  'Upload the paper’s PDF and attach it, or find an open-access copy, then check again against the full text.';

function verdictLabel(verdict: ClaimVerdict, cannotAssess: boolean): string {
  return cannotAssess ? 'Cannot assess without the full text' : VERDICTS[verdict].label;
}

export function ClaimCard({
  claim,
  verdict,
  evidenceLevel,
  cannotAssess,
  summary,
  note,
  howToGet,
  passages,
  notFound = [],
  className,
}: ClaimCardProps) {
  const headingId = useId();
  const shown = cannotAssess
    ? { ...VERDICTS.insufficient, label: verdictLabel(verdict, true), Icon: FileQuestion, detail: howToGet || HOW_TO_GET }
    : VERDICTS[verdict];
  const { Icon } = shown;
  return (
    <section
      aria-labelledby={headingId}
      data-claim-verdict={cannotAssess ? 'cannot_assess' : verdict}
      className={cn('rounded-lg border border-border bg-card px-3 py-2.5 text-sm', className)}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={headingId} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Claim check
        </h3>
        <span className={cn('inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-xs font-medium', shown.tone)}>
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          {shown.label}
        </span>
        {evidenceLevel && (
          <span className="text-xs text-muted-foreground">
            Judged on: {LEVELS[evidenceLevel].toLowerCase()}
          </span>
        )}
      </header>
      {claim && <blockquote className="mt-2 border-l-2 border-border pl-2 text-foreground">{claim}</blockquote>}
      <p className="mt-1.5 text-[13px] text-muted-foreground">{summary || shown.detail}</p>
      {cannotAssess && summary && <p className="mt-1 text-[13px] text-muted-foreground">{howToGet || HOW_TO_GET}</p>}
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}

      {passages.length > 0 ? (
        <ul className="mt-2 space-y-2" aria-label="Passages it was judged against">
          {passages.map((passage) => (
            <ClaimPassageRow key={passage.id} passage={passage} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No passage was found to judge it against.</p>
      )}
      {notFound.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Not found, or no text held: {notFound.join(', ')}
        </p>
      )}
    </section>
  );
}

function ClaimPassageRow({ passage }: { passage: ClaimCardPassage }) {
  const { record } = passage;
  const stance = STANCES[passage.stance];
  const where = [passage.section, passage.page ? `p. ${passage.page}` : null].filter(Boolean).join(', ');
  const byline = record ? [referenceAuthors(record), referenceYear(record)].filter(Boolean).join(' · ') : '';
  return (
    <li data-passage-id={passage.id} className="rounded-md bg-subtle/60 px-2 py-1.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <span className={cn('font-medium', stance.tone)}>{stance.label}</span>
        <span className="text-muted-foreground">{LEVELS[passage.level]}</span>
        {where && <span className="text-muted-foreground">{where}</span>}
      </p>
      {passage.text && <p className="mt-1 line-clamp-4 text-[13px] text-foreground">“{passage.text}”</p>}
      {record ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium" title={referenceTitle(record)}>{referenceTitle(record)}</span>
            {byline && <span className="block truncate text-xs text-muted-foreground">{byline}</span>}
          </span>
          <ReferenceStatus record={record} />
          <span className="flex items-center gap-0.5">
            <SourceActions record={record} />
          </span>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Passage {passage.id}: its source was not received.</p>
      )}
    </li>
  );
}
