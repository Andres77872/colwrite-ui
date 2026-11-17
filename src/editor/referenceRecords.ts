import type { CslItem, CslName, ReferenceRecord, ReferenceNotice } from './types';

/* ----------------------------------------
   One reference, read and built in one place (P2.UI-1)

   Every entry point — a reply's sources, a paper search, the citation
   picker, the resolver, the Sources panel — holds the same
   `ReferenceRecord` the API sends, and the page's library keeps it as it
   is. This module reads a record for display (title, byline, link), says
   what its state and flags mean (09 §5), and builds the two records the
   client makes itself: a library entry from a record, and an entry the
   author typed.
   ---------------------------------------- */

/** A record as the page's library keeps it: the record itself, with `csl.id` its key. */
export function libraryEntry(record: ReferenceRecord): ReferenceRecord {
  return record.csl.id === record.key ? record : { ...record, csl: { ...record.csl, id: record.key } };
}

/**
 * An entry the author typed or edited: `manual` and `unchecked`, since
 * nothing confirmed it. Flags a registry reported stay with the work.
 */
export function manualRecord(key: string, csl: Omit<CslItem, 'id'>, kind: ReferenceRecord['kind'] = 'other', flags: ReferenceRecord['flags'] = []): ReferenceRecord {
  return { key, kind, provider: 'manual', state: 'unchecked', flags, csl: { ...csl, id: key } };
}

/* ----------------------------------------
   Identifiers
   ---------------------------------------- */

/**
 * A DOI reduced to its bare, lower-cased `10.x/y` form, or nothing if it is
 * not one. DOIs are case-insensitive, so this is an identity function.
 */
export function canonicalDoi(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const normalized = raw
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[)\].,;]+$/, '')
    .replace(/\/+$/, '');
  return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized.toLowerCase() : undefined;
}

/** An arXiv id (either scheme) without its host, version or `.pdf`. */
export function canonicalArxivId(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const normalized = raw
    .trim()
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/^arxiv:\s*/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.pdf$/i, '')
    .trim()
    .toLowerCase();
  return /^(?:[a-z-]+(?:\.[a-z-]+)?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/.test(normalized)
    ? normalized.replace(/v\d+$/, '')
    : undefined;
}

/** Schemes a reference key or a paper route's `key` carries. */
const KEY_SCHEME = /^(?:doi|arxiv|pmid|pmcid|openalex|s2|corpusid):\S/i;

/**
 * An identifier the author pasted, as a reference key with its scheme
 * (`doi:10.…`, `arxiv:2103.00020`), or `null` when it is not one the
 * resolver reads.
 */
export function identifierKey(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const doi = canonicalDoi(value);
  if (doi) return `doi:${doi}`;
  const arxiv = canonicalArxivId(value);
  if (arxiv) return `arxiv:${arxiv}`;
  if (/^pmid:\s*\d+$/i.test(value)) return `pmid:${value.replace(/^pmid:\s*/i, '')}`;
  if (KEY_SCHEME.test(value)) return value.replace(/^([a-z]+):/i, (_, scheme: string) => `${scheme.toLowerCase()}:`);
  return null;
}

/* ----------------------------------------
   Reading a record
   ---------------------------------------- */

function nameText(name: CslName, familyOnly = false): string | null {
  if (name.literal?.trim()) return name.literal.trim();
  const family = [name['non-dropping-particle'], name.family].map((part) => part?.trim()).filter(Boolean).join(' ');
  if (!family) return null;
  if (familyOnly) return family;
  const given = name.given?.trim();
  return given ? `${given} ${family}` : family;
}

export function referenceTitle(record: Pick<ReferenceRecord, 'csl' | 'key'> | null | undefined, fallback = ''): string {
  return record?.csl.title?.trim() || fallback || record?.key || '';
}

/** The people named for the work: its authors, else its editors. */
export function referenceNames(record: Pick<ReferenceRecord, 'csl'>, familyOnly = false): string[] {
  const people = record.csl.author?.length ? record.csl.author : record.csl.editor ?? [];
  return people.map((name) => nameText(name, familyOnly)).filter((name): name is string => Boolean(name));
}

/** "Ashish Vaswani, Noam Shazeer", shortened to three and "et al." */
export function referenceAuthors(record: Pick<ReferenceRecord, 'csl'>): string | undefined {
  const names = referenceNames(record);
  if (names.length === 0) return undefined;
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ');
}

export function referenceYear(record: Pick<ReferenceRecord, 'csl'>): string | undefined {
  const issued = record.csl.issued;
  const year = issued?.['date-parts']?.[0]?.[0];
  if (typeof year === 'number') return String(year);
  return (issued?.literal ?? issued?.raw)?.match(/\d{4}/)?.[0];
}

export function referenceVenue(record: Pick<ReferenceRecord, 'csl'>): string | undefined {
  return record.csl['container-title']?.trim() || record.csl.publisher?.trim() || undefined;
}

/** Authors · year · venue, the line under a title. */
export function referenceByline(record: Pick<ReferenceRecord, 'csl'>): string {
  return [referenceAuthors(record), referenceYear(record), referenceVenue(record)].filter(Boolean).join(' · ');
}

function httpsUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The one link a reference offers, best identifier first; DOIs as Crossref shows them. */
export function referenceLink(record: Pick<ReferenceRecord, 'csl' | 'key'>): { href: string; label: string } | null {
  const doi = canonicalDoi(record.csl.DOI) ?? (record.key.startsWith('doi:') ? canonicalDoi(record.key.slice(4)) : undefined);
  if (doi) return { href: `https://doi.org/${doi}`, label: `https://doi.org/${doi}` };
  const url = httpsUrl(record.csl.URL);
  if (url) return { href: url, label: url.replace(/^https?:\/\//, '') };
  const arxiv = record.key.startsWith('arxiv:') ? canonicalArxivId(record.key.slice(6)) : undefined;
  if (arxiv) return { href: `https://arxiv.org/abs/${arxiv}`, label: `arXiv:${arxiv}` };
  return null;
}

/* ----------------------------------------
   States and flags (09 §5, 13 §7)

   `verified` is quiet, and so is `unchecked` until an audit runs. What a
   reference should be read for is said where it is shown: a review with the
   fields that differ, a retraction with its notice, a preprint with its
   published version.
   ---------------------------------------- */

export type ReferenceMark = {
  kind: 'needs_review' | 'not_found' | 'retracted' | 'corrected' | 'concern' | 'published_version' | 'preprint';
  /** A word or two, for a badge. */
  label: string;
  /** The sentence that says why. */
  detail: string;
  tone: 'warning' | 'destructive' | 'neutral';
  /** Where the notice or the published version is. */
  href?: string;
};

/** CSL variable names as an author reads them. */
const FIELD_NAMES: Record<string, string> = {
  title: 'title',
  author: 'authors',
  editor: 'editors',
  issued: 'year',
  'container-title': 'venue',
  publisher: 'publisher',
  volume: 'volume',
  issue: 'issue',
  page: 'pages',
  DOI: 'DOI',
  URL: 'URL',
  type: 'type',
};

export function differingFields(record: Pick<ReferenceRecord, 'differs'>): string[] {
  return (record.differs ?? []).map((field) => FIELD_NAMES[field] ?? field);
}

const NOTICE_NAMES: Record<ReferenceNotice['type'], string> = {
  retraction: 'Retraction',
  withdrawal: 'Withdrawal',
  correction: 'Correction',
  expression_of_concern: 'Expression of concern',
};

function noticeOf(record: ReferenceRecord, types: ReadonlyArray<ReferenceNotice['type']>): ReferenceNotice | undefined {
  return record.notices?.find((notice) => types.includes(notice.type));
}

function noticeHref(notice: ReferenceNotice | undefined): string | undefined {
  if (!notice) return undefined;
  const doi = canonicalDoi(notice.doi);
  return doi ? `https://doi.org/${doi}` : httpsUrl(notice.url);
}

function noticeSentence(notice: ReferenceNotice | undefined, fallback: string): string {
  if (!notice) return fallback;
  const name = NOTICE_NAMES[notice.type];
  const date = notice.date ? ` on ${notice.date}` : '';
  const by = notice.source ? ` (reported by ${notice.source === 'crossref' ? 'Crossref' : notice.source === 'openalex' ? 'OpenAlex' : notice.source})` : '';
  return `${name} published${date}${by}.`;
}

/** What a reference should be read for, most serious first; empty for the quiet cases. */
export function referenceMarks(record: ReferenceRecord | null | undefined): ReferenceMark[] {
  if (!record) return [];
  const marks: ReferenceMark[] = [];
  const flags = new Set(record.flags);
  if (flags.has('retracted')) {
    const notice = noticeOf(record, ['retraction', 'withdrawal']);
    marks.push({
      kind: 'retracted',
      label: notice?.type === 'withdrawal' ? 'Withdrawn' : 'Retracted',
      detail: noticeSentence(notice, 'A registry reports this work as retracted.'),
      tone: 'destructive',
      href: noticeHref(notice),
    });
  }
  if (flags.has('concern')) {
    const notice = noticeOf(record, ['expression_of_concern']);
    marks.push({ kind: 'concern', label: 'Expression of concern', detail: noticeSentence(notice, 'The publisher has issued an expression of concern.'), tone: 'warning', href: noticeHref(notice) });
  }
  if (record.state === 'needs_review') {
    const fields = differingFields(record);
    marks.push({
      kind: 'needs_review',
      label: 'Needs review',
      detail: fields.length
        ? `Sources disagree on its ${joinWords(fields)}. Check the details against the work.`
        : 'Only one registry has this work. Check the details against the work.',
      tone: 'warning',
    });
  }
  if (record.state === 'not_found') {
    marks.push({ kind: 'not_found', label: 'Not found', detail: 'No registry returned this work. Check that it exists and its details are right.', tone: 'warning' });
  }
  if (flags.has('corrected')) {
    const notice = noticeOf(record, ['correction']);
    marks.push({ kind: 'corrected', label: 'Corrected', detail: noticeSentence(notice, 'A correction to this work was published.'), tone: 'neutral', href: noticeHref(notice) });
  }
  if (flags.has('has_published_version')) {
    const doi = canonicalDoi(record.published_doi);
    marks.push({
      kind: 'published_version',
      label: 'Published version',
      detail: doi ? `A preprint. Its published version is doi:${doi}.` : 'A preprint. A published version exists.',
      tone: 'neutral',
      href: doi ? `https://doi.org/${doi}` : undefined,
    });
  } else if (flags.has('preprint')) {
    marks.push({ kind: 'preprint', label: 'Preprint', detail: 'A preprint, not peer reviewed.', tone: 'neutral' });
  }
  return marks;
}

function joinWords(words: readonly string[]): string {
  if (words.length < 2) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** Whether a record came from a registry or a source rather than from typing. */
export function isRecordedReference(record: ReferenceRecord | null | undefined): boolean {
  return Boolean(record && record.provider !== 'manual');
}

/* ----------------------------------------
   What a refresh changes (`update_sources`)
   ---------------------------------------- */

const STATE_WORDS: Record<ReferenceRecord['state'], string> = {
  verified: 'verified',
  needs_review: 'needs review',
  not_found: 'not found',
  unchecked: 'not checked',
};

const FLAG_WORDS: Record<ReferenceRecord['flags'][number], string> = {
  retracted: 'retracted',
  corrected: 'corrected',
  concern: 'expression of concern',
  has_published_version: 'published version',
  preprint: 'preprint',
  uncited: 'uncited',
};

export type ReferenceChange = { field: 'title' | 'authors' | 'year' | 'state' | 'flags'; from: string; to: string };

/**
 * What replacing a library record with a newer one changes, as an author
 * reads it: its title, authors, year, state and flags. An absent value
 * reads as "none".
 */
export function referenceChanges(before: ReferenceRecord | null | undefined, after: ReferenceRecord): ReferenceChange[] {
  const flags = (record: ReferenceRecord | null | undefined) => (record?.flags ?? []).map((flag) => FLAG_WORDS[flag]).join(', ') || 'none';
  const pairs: Array<[ReferenceChange['field'], string, string]> = [
    ['title', before?.csl.title ?? 'none', after.csl.title],
    ['authors', (before && referenceAuthors(before)) ?? 'none', referenceAuthors(after) ?? 'none'],
    ['year', (before && referenceYear(before)) ?? 'none', referenceYear(after) ?? 'none'],
    ['state', before ? STATE_WORDS[before.state] : 'none', STATE_WORDS[after.state]],
    ['flags', flags(before), flags(after)],
  ];
  return pairs.filter(([, from, to]) => from !== to).map(([field, from, to]) => ({ field, from, to }));
}
