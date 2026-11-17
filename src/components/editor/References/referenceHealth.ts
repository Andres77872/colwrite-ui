import { createContext, useContext } from 'react';
import type { AuditedReference, ReferenceAudit } from '@/data/references';

/* ----------------------------------------
   Reference health (P2.UI-4, 09 §7)

   The page's last reference audit, read once for the Sources panel, the
   reference list and the export dialog, and "Check references", which
   saves the page, arms the audit job, follows it, reads the report again
   and stages the refresh it proposed (`update_sources`) for review like any
   change set. The audit reports; it deletes, rewrites and blocks nothing.
   ---------------------------------------- */

/** What the last audit found about one key of the page. */
export type ReferenceFinding = {
  /** The registries give it otherwise now: what differs. A refresh is proposed. */
  stale: string[] | null;
  /** The other keys the page holds the same work under. */
  duplicateOf: string[];
  /** Cited, with no library entry. */
  orphan: boolean;
  /** Its identifier resolves to another work: the title it resolves to. */
  mismatch: string | null;
  /** No registry knows it. */
  notFound: boolean;
};

export type ReferenceHealth = {
  report: ReferenceAudit | null;
  findings: ReadonlyMap<string, ReferenceFinding>;
  /** Run the audit; `null` where it cannot run (a viewer, a page not yet saved). */
  check: (() => Promise<void>) | null;
  checking: boolean;
  error: string | null;
};

const NONE: ReferenceHealth = { report: null, findings: new Map(), check: null, checking: false, error: null };

export const ReferenceHealthContext = createContext<ReferenceHealth>(NONE);

/** The page's reference health; nothing outside the editor's provider. */
export function useReferenceHealth(): ReferenceHealth {
  return useContext(ReferenceHealthContext);
}

const EMPTY_FINDING: ReferenceFinding = { stale: null, duplicateOf: [], orphan: false, mismatch: null, notFound: false };

/** The audit's findings by key. */
export function findingsOf(report: ReferenceAudit | null | undefined): Map<string, ReferenceFinding> {
  const findings = new Map<string, ReferenceFinding>();
  if (!report) return findings;
  const of = (key: string) => {
    const found = findings.get(key) ?? { ...EMPTY_FINDING, duplicateOf: [] };
    findings.set(key, found);
    return found;
  };
  for (const reference of report.references) {
    const found = of(reference.key);
    if (reference.stale) found.stale = reference.changes ?? [];
    if (reference.outcome === 'mismatch') found.mismatch = reference.found_title ?? '';
    if (reference.outcome === 'not_found') found.notFound = true;
  }
  for (const duplicate of report.duplicates) {
    for (const key of duplicate.keys) of(key).duplicateOf.push(...duplicate.keys.filter((other) => other !== key));
  }
  for (const orphan of report.orphans) of(orphan.key).orphan = true;
  return findings;
}

const CHANGE_WORDS: Record<string, string> = {
  state: 'state',
  flags: 'marks',
  notices: 'notices',
  published_doi: 'published version',
  differs: 'disagreements',
  title: 'title',
  author: 'authors',
  issued: 'year',
  'container-title': 'venue',
  volume: 'volume',
  issue: 'issue',
  page: 'pages',
  DOI: 'DOI',
  publisher: 'publisher',
  type: 'type',
};

/** "its marks and notices": what an audit found changed, in words. */
export function staleWords(changes: readonly string[]): string {
  const words = [...new Set(changes.map((change) => CHANGE_WORDS[change] ?? change))];
  if (words.length === 0) return 'its details';
  return `its ${words.length < 3 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`}`;
}

/** Each finding as a short label and its sentence, as the list and the panel say them. */
export function findingMarks(
  finding: ReferenceFinding | undefined,
  titleOf: (key: string) => string,
): Array<{ kind: 'stale' | 'duplicate' | 'orphan' | 'mismatch' | 'not_found'; label: string; detail: string }> {
  if (!finding) return [];
  const marks: ReturnType<typeof findingMarks> = [];
  if (finding.stale) {
    marks.push({
      kind: 'stale',
      label: 'Out of date',
      detail: `The registries now give ${staleWords(finding.stale)} otherwise. A refresh is proposed for review.`,
    });
  }
  if (finding.duplicateOf.length) {
    marks.push({
      kind: 'duplicate',
      label: 'Duplicate',
      detail: `The same work as ${finding.duplicateOf.map((key) => `“${titleOf(key)}”`).join(', ')}: keep one of them.`,
    });
  }
  if (finding.orphan) marks.push({ kind: 'orphan', label: 'Not in sources', detail: 'Cited, but the page’s sources hold no entry for it.' });
  if (finding.mismatch !== null) {
    marks.push({
      kind: 'mismatch',
      label: 'Identifier mismatch',
      detail: finding.mismatch ? `Its identifier names another work: “${finding.mismatch}”.` : 'Its identifier names another work.',
    });
  }
  if (finding.notFound) marks.push({ kind: 'not_found', label: 'Not found', detail: 'No registry knows its identifier.' });
  return marks;
}

export type ReferenceCounts = { retracted: number; unverified: number; orphans: number };

/** The counts the export dialog says before a file is made: from the last audit. */
export function auditCounts(report: ReferenceAudit): ReferenceCounts {
  const { counts } = report;
  return { retracted: counts.retracted, unverified: counts.references - counts.verified, orphans: counts.orphans };
}

export type { AuditedReference };
