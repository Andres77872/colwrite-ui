import { canonicalArxivId, canonicalDoi, firstAuthorSurname, yearOf } from './citations';
import type { CitationSource, SourceKind } from './types';

/**
 * BibTeX in and out of the source library.
 *
 * Export is what a LaTeX workflow needs from ColWrite: every source with a
 * stable, readable cite key (`vaswani2017attention`). Import accepts the
 * `.bib` files reference managers produce (Zotero, Mendeley, Google Scholar,
 * Overleaf) and maps them onto the library's fields. Imported entries are
 * marked `manual` — they are what a file said, not what a registry
 * confirmed — until the author verifies them against their DOI or arXiv id.
 */

const TYPE_BY_KIND: Record<SourceKind, string> = {
  article: 'article',
  preprint: 'misc',
  conference: 'inproceedings',
  book: 'book',
  chapter: 'incollection',
  thesis: 'phdthesis',
  report: 'techreport',
  web: 'misc',
  dataset: 'misc',
  software: 'software',
  other: 'misc',
};

const KIND_BY_TYPE: Record<string, SourceKind> = {
  article: 'article',
  inproceedings: 'conference',
  conference: 'conference',
  proceedings: 'conference',
  book: 'book',
  inbook: 'chapter',
  incollection: 'chapter',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  thesis: 'thesis',
  techreport: 'report',
  report: 'report',
  online: 'web',
  electronic: 'web',
  www: 'web',
  dataset: 'dataset',
  software: 'software',
  unpublished: 'preprint',
};

/** Escape the characters BibTeX treats specially inside a braced value. */
function escapeValue(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}])/g, '\\$1')
    .replace(/([&%$#_])/g, '\\$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "A. Smith, B. Jones" → "A. Smith and B. Jones", keeping "et al." as "others". */
function bibtexAuthors(authors: string): string {
  const names = authors
    .split(/\s*(?:;|\band\b|,(?=\s*[A-Z][^,]*\s[A-Z]))\s*/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => (/^et al\.?$/i.test(name) ? 'others' : name));
  return names.join(' and ');
}

function slug(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'on', 'of', 'in', 'for', 'and', 'to', 'with', 'towards', 'toward']);

/** A readable cite key, `surname` + `year` + first significant title word. */
export function bibtexKey(source: CitationSource): string {
  const surname = slug(firstAuthorSurname(source.authors)?.split(/\s+/).pop());
  const year = yearOf(source.year) ?? '';
  const word = (source.title ?? '')
    .split(/\s+/)
    .map(slug)
    .find((candidate) => candidate && !STOP_WORDS.has(candidate)) ?? '';
  const key = `${surname}${year}${word}`;
  return key || slug(source.key) || 'source';
}

/** One `.bib` document for *sources*, with unique cite keys. */
export function toBibtex(sources: readonly CitationSource[]): string {
  const used = new Map<string, number>();
  const entries = sources.map((source) => {
    let key = bibtexKey(source);
    const count = used.get(key) ?? 0;
    used.set(key, count + 1);
    if (count > 0) key = `${key}${String.fromCharCode(96 + count + 1)}`;

    const arxivKey = /^\d{4}\.\d{4,5}$/.test(canonicalArxivId(source.key) ?? '');
    const kind = source.kind ?? (arxivKey ? 'preprint' : undefined);
    const type = kind ? TYPE_BY_KIND[kind] : source.venue ? 'article' : 'misc';
    const fields: Array<[string, string]> = [];
    // Double braces keep a title's capitalisation from being lowered by styles.
    if (source.title) fields.push(['title', `{${escapeValue(source.title)}}`]);
    if (source.authors) fields.push(['author', escapeValue(bibtexAuthors(source.authors))]);
    const year = yearOf(source.year);
    if (year) fields.push(['year', year]);
    if (source.venue && source.venue !== 'arXiv') {
      const venueField = type === 'inproceedings' || type === 'incollection' ? 'booktitle' : type === 'article' ? 'journal' : 'howpublished';
      fields.push([venueField, escapeValue(source.venue)]);
    }
    const doi = canonicalDoi(source.doi ?? source.key);
    if (doi) fields.push(['doi', doi]);
    const arxiv = source.externalIds?.ArXiv ?? (/^\d{4}\.\d{4,5}$/.test(source.key) ? source.key : undefined);
    if (arxiv) {
      fields.push(['eprint', arxiv]);
      fields.push(['archiveprefix', 'arXiv']);
    }
    if (source.url) fields.push(['url', source.url]);
    if (source.accessed) fields.push(['urldate', source.accessed]);
    const body = fields.map(([name, value]) => `  ${name} = {${value}}`);
    return `@${type}{${key},\n${body.join(',\n')}\n}`;
  });
  return `${entries.join('\n\n')}\n`;
}

// ── Import ────────────────────────────────────────────────────────────────

/** Read one braced or quoted value starting at `index`; returns it and the index after it. */
function readValue(text: string, index: number): [string, number] {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  const open = text[cursor];
  if (open === '{') {
    let depth = 0;
    const start = cursor + 1;
    for (; cursor < text.length; cursor += 1) {
      if (text[cursor] === '\\') {
        cursor += 1;
        continue;
      }
      if (text[cursor] === '{') depth += 1;
      else if (text[cursor] === '}') {
        depth -= 1;
        if (depth === 0) return [text.slice(start, cursor), cursor + 1];
      }
    }
    return [text.slice(start), text.length];
  }
  if (open === '"') {
    const start = cursor + 1;
    cursor = start;
    let depth = 0;
    for (; cursor < text.length; cursor += 1) {
      if (text[cursor] === '{') depth += 1;
      else if (text[cursor] === '}') depth -= 1;
      else if (text[cursor] === '"' && depth === 0) return [text.slice(start, cursor), cursor + 1];
    }
    return [text.slice(start), text.length];
  }
  const match = /^[^,}\s]+/.exec(text.slice(cursor));
  return [match?.[0] ?? '', cursor + (match?.[0].length ?? 0)];
}

/** LaTeX-ish BibTeX text to plain text: braces and simple accents removed. */
function plain(value: string): string {
  return value
    .replace(/\\[`'^"~=.uvHcdbtk]\{?([A-Za-z])\}?/g, '$1')
    .replace(/\\(?:textbackslash|&|%|\$|#|_)\{?\}?/g, (match) => match.replace(/\\|\{|\}/g, '').replace('textbackslash', '\\'))
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Smith, John and Doe, Jane" → "John Smith, Jane Doe". */
function readAuthors(value: string): string {
  return plain(value)
    .split(/\s+and\s+/i)
    .map((name) => {
      if (/^others$/i.test(name)) return 'et al.';
      const [family, given] = name.split(/\s*,\s*/, 2);
      return given ? `${given} ${family}` : name;
    })
    .join(', ');
}

export type BibtexImport = { sources: CitationSource[]; skipped: number };

/** Library entries for the entries in a `.bib` document. */
export function parseBibtex(text: string): BibtexImport {
  const sources: CitationSource[] = [];
  let skipped = 0;
  const entryStart = /@\s*([A-Za-z]+)\s*[{(]/g;
  let match: RegExpExecArray | null;
  while ((match = entryStart.exec(text))) {
    const type = match[1].toLowerCase();
    if (type === 'comment' || type === 'preamble' || type === 'string') continue;
    let cursor = entryStart.lastIndex;
    const keyEnd = text.indexOf(',', cursor);
    if (keyEnd === -1) break;
    const citeKey = text.slice(cursor, keyEnd).trim();
    cursor = keyEnd + 1;
    const fields: Record<string, string> = {};
    while (cursor < text.length) {
      const fieldMatch = /^\s*([A-Za-z][\w-]*)\s*=\s*/.exec(text.slice(cursor));
      if (!fieldMatch) break;
      cursor += fieldMatch[0].length;
      const [value, next] = readValue(text, cursor);
      fields[fieldMatch[1].toLowerCase()] = value;
      cursor = next;
      const separator = /^\s*,?/.exec(text.slice(cursor));
      cursor += separator?.[0].length ?? 0;
      if (/^\s*[})]/.test(text.slice(cursor))) break;
    }
    entryStart.lastIndex = cursor;

    const title = fields.title ? plain(fields.title) : '';
    if (!title) {
      skipped += 1;
      continue;
    }
    const doi = canonicalDoi(fields.doi);
    const arxiv = fields.eprint && /arxiv/i.test(fields.archiveprefix ?? fields.eprinttype ?? 'arxiv')
      ? canonicalArxivId(fields.eprint)
      : undefined;
    const source: CitationSource = {
      key: doi ?? arxiv ?? citeKey,
      title,
      provider: 'manual',
    };
    if (fields.author) source.authors = readAuthors(fields.author);
    const year = yearOf(fields.year ?? fields.date);
    if (year) source.year = year;
    const venue = fields.journal ?? fields.journaltitle ?? fields.booktitle ?? fields.publisher ?? fields.howpublished;
    if (venue) source.venue = plain(venue);
    if (doi) source.doi = doi;
    if (fields.url) source.url = plain(fields.url);
    if (arxiv) source.externalIds = { ArXiv: arxiv };
    const kind = KIND_BY_TYPE[type] ?? (arxiv ? 'preprint' : undefined);
    if (kind) source.kind = kind;
    if (fields.urldate) source.accessed = plain(fields.urldate);
    sources.push(source);
  }
  return { sources, skipped };
}
