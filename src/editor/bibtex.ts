import { canonicalArxivId, canonicalDoi, manualRecord, referenceNames, referenceYear } from './referenceRecords';
import type { CslItem, CslName, CslType, ReferenceRecord } from './types';

/**
 * BibTeX in and out of the source library.
 *
 * Export is what a LaTeX workflow needs from ColWrite: every reference with a
 * stable, readable cite key (`vaswani2017attention`), from its CSL item.
 * Import accepts the `.bib` files reference managers produce (Zotero,
 * Mendeley, Google Scholar, Overleaf) as CSL items. Imported entries are
 * `manual` and `unchecked` — they are what a file said, not what a registry
 * confirmed — until the author checks them against the registries.
 */

/** The BibTeX entry type for a CSL item type. */
const TYPE_BY_CSL: Partial<Record<CslType, string>> = {
  'article-journal': 'article',
  'article-magazine': 'article',
  'article-newspaper': 'article',
  'paper-conference': 'inproceedings',
  book: 'book',
  chapter: 'incollection',
  thesis: 'phdthesis',
  report: 'techreport',
  software: 'software',
};

/** The CSL item type and the reference kind for a BibTeX entry type. */
const CSL_BY_TYPE: Record<string, { type: CslType; kind: ReferenceRecord['kind'] }> = {
  article: { type: 'article-journal', kind: 'paper' },
  inproceedings: { type: 'paper-conference', kind: 'paper' },
  conference: { type: 'paper-conference', kind: 'paper' },
  proceedings: { type: 'book', kind: 'book' },
  book: { type: 'book', kind: 'book' },
  inbook: { type: 'chapter', kind: 'book' },
  incollection: { type: 'chapter', kind: 'book' },
  phdthesis: { type: 'thesis', kind: 'other' },
  mastersthesis: { type: 'thesis', kind: 'other' },
  thesis: { type: 'thesis', kind: 'other' },
  techreport: { type: 'report', kind: 'other' },
  report: { type: 'report', kind: 'other' },
  online: { type: 'webpage', kind: 'web' },
  electronic: { type: 'webpage', kind: 'web' },
  www: { type: 'webpage', kind: 'web' },
  dataset: { type: 'dataset', kind: 'dataset' },
  software: { type: 'software', kind: 'other' },
  unpublished: { type: 'manuscript', kind: 'preprint' },
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

/** CSL names → "Smith, John and Doe, Jane"; an organisation braced, so BibTeX keeps it whole. */
function bibtexNames(names: readonly CslName[]): string {
  return names
    .map((name) => {
      if (name.literal) return `{${escapeValue(name.literal)}}`;
      const family = [name['non-dropping-particle'], name.family].filter(Boolean).join(' ');
      return escapeValue(name.given ? `${family}, ${name.given}` : family);
    })
    .join(' and ');
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
export function bibtexKey(record: ReferenceRecord): string {
  const surname = slug(referenceNames(record, true)[0]?.split(/\s+/).pop());
  const year = referenceYear(record) ?? '';
  const word = record.csl.title
    .split(/\s+/)
    .map(slug)
    .find((candidate) => candidate && !STOP_WORDS.has(candidate)) ?? '';
  const key = `${surname}${year}${word}`;
  return key || slug(record.key) || 'source';
}

/** One `.bib` document for *records*, with unique cite keys. */
export function toBibtex(records: readonly ReferenceRecord[]): string {
  const used = new Map<string, number>();
  const entries = records.map((record) => {
    const { csl } = record;
    let key = bibtexKey(record);
    const count = used.get(key) ?? 0;
    used.set(key, count + 1);
    if (count > 0) key = `${key}${String.fromCharCode(96 + count + 1)}`;

    const type = TYPE_BY_CSL[csl.type] ?? 'misc';
    const fields: Array<[string, string]> = [];
    // Double braces keep a title's capitalisation from being lowered by styles.
    fields.push(['title', `{${escapeValue(csl.title)}}`]);
    if (csl.author?.length) fields.push(['author', bibtexNames(csl.author)]);
    if (csl.editor?.length) fields.push(['editor', bibtexNames(csl.editor)]);
    const year = referenceYear(record);
    if (year) fields.push(['year', year]);
    const venue = csl['container-title'];
    if (venue) {
      const venueField = type === 'inproceedings' || type === 'incollection' ? 'booktitle' : type === 'article' ? 'journal' : 'howpublished';
      fields.push([venueField, escapeValue(venue)]);
    }
    if (csl.publisher) fields.push(['publisher', escapeValue(csl.publisher)]);
    if (csl.volume) fields.push(['volume', escapeValue(csl.volume)]);
    if (csl.issue) fields.push(['number', escapeValue(csl.issue)]);
    if (csl.page) fields.push(['pages', escapeValue(csl.page.replace(/[–—-]+/g, '--'))]);
    const doi = canonicalDoi(csl.DOI);
    if (doi) fields.push(['doi', doi]);
    const arxiv = record.key.startsWith('arxiv:') ? canonicalArxivId(record.key.slice(6)) : undefined;
    if (arxiv) {
      fields.push(['eprint', arxiv]);
      fields.push(['archiveprefix', 'arXiv']);
    }
    if (csl.URL) fields.push(['url', csl.URL]);
    const accessed = csl.accessed?.['date-parts']?.[0];
    if (accessed) fields.push(['urldate', accessed.map((part) => String(part).padStart(2, '0')).join('-')]);
    const body = fields.map(([name, value]) => `  ${name} = {${value}}`);
    return `@${type}{${key},\n${body.join(',\n')}\n}`;
  });
  return `${entries.join('\n\n')}\n`;
}

// ── Import ────────────────────────────────────────────────────────────────

/** Read one braced or quoted value starting at `index`; returns it and the index after it. */
function readValue(text: string, index: number): [string, number] {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text.charAt(cursor))) cursor += 1;
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

/** "Smith, John and Doe, Jane" → CSL names; a braced name is an organisation. */
function readNames(value: string): CslName[] {
  return value
    .split(/\s+and\s+/i)
    .map((raw) => raw.trim())
    .filter((raw) => raw && !/^others$/i.test(raw))
    .map((raw): CslName => {
      if (/^\{.*\}$/.test(raw)) return { literal: plain(raw) };
      const name = plain(raw);
      const [family, given] = name.split(/\s*,\s*/, 2);
      if (given !== undefined) return { family: family ?? name, given };
      const words = name.split(/\s+/);
      return words.length > 1 ? { family: words.at(-1) ?? name, given: words.slice(0, -1).join(' ') } : { family: name };
    });
}

export type BibtexImport = { sources: ReferenceRecord[]; skipped: number };

/** Library entries for the entries in a `.bib` document. */
export function parseBibtex(text: string): BibtexImport {
  const sources: ReferenceRecord[] = [];
  let skipped = 0;
  const entryStart = /@\s*([A-Za-z]+)\s*[{(]/g;
  let match: RegExpExecArray | null;
  while ((match = entryStart.exec(text))) {
    const type = (match[1] ?? '').toLowerCase();
    if (type === 'comment' || type === 'preamble' || type === 'string') continue;
    let cursor = entryStart.lastIndex;
    const keyEnd = text.indexOf(',', cursor);
    if (keyEnd === -1) break;
    const citeKey = text.slice(cursor, keyEnd).trim();
    cursor = keyEnd + 1;
    const fields: Record<string, string> = {};
    while (cursor < text.length) {
      const fieldMatch = /^\s*([A-Za-z][\w-]*)\s*=\s*/.exec(text.slice(cursor));
      const name = fieldMatch?.[1];
      if (!fieldMatch || !name) break;
      cursor += fieldMatch[0].length;
      const [value, next] = readValue(text, cursor);
      fields[name.toLowerCase()] = value;
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
    const mapped = CSL_BY_TYPE[type] ?? (arxiv ? { type: 'article' as const, kind: 'preprint' as const } : { type: 'document' as const, kind: 'other' as const });
    const csl: Omit<CslItem, 'id'> = { type: mapped.type, title };
    if (fields.author) {
      const author = readNames(fields.author);
      if (author.length) csl.author = author;
    }
    if (fields.editor) {
      const editor = readNames(fields.editor);
      if (editor.length) csl.editor = editor;
    }
    const year = (fields.year ?? fields.date)?.match(/\d{4}/)?.[0];
    if (year) csl.issued = { 'date-parts': [[Number(year)]] };
    const venue = fields.journal ?? fields.journaltitle ?? fields.booktitle ?? fields.howpublished;
    if (venue) csl['container-title'] = plain(venue);
    if (fields.publisher) csl.publisher = plain(fields.publisher);
    if (fields.volume) csl.volume = plain(fields.volume);
    if (fields.number) csl.issue = plain(fields.number);
    if (fields.pages) csl.page = plain(fields.pages).replace(/-{1,2}/g, '–');
    if (doi) csl.DOI = doi;
    if (fields.url) csl.URL = plain(fields.url);
    if (arxiv) csl.number = `arXiv:${arxiv}`;
    const accessed = fields.urldate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (accessed) csl.accessed = { 'date-parts': [[Number(accessed[1]), Number(accessed[2]), Number(accessed[3])]] };
    const key = doi ? `doi:${doi}` : arxiv ? `arxiv:${arxiv}` : citeKey;
    sources.push(manualRecord(key, csl, mapped.kind, mapped.kind === 'preprint' ? ['preprint'] : []));
  }
  return { sources, skipped };
}
