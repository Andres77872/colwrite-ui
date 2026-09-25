import type { Block, CitationChild, CitationSource } from './types';

/* ----------------------------------------
   The citation model

   One module owns the answer to "what does this citation print, and what does
   it point at". It used to be answered in two places — `CitationInline` for the
   screen and `renderStandaloneHtml` for the export — with two different
   `firstAuthorSurname` implementations, so the same document could show
   "(John, 2020)" in the editor and "(Doe, 2020)" in the PDF.

   Everything here is derived from the blocks. Nothing is stored: numbering is a
   property of the document, not of a citation, and a stored number is a number
   that goes stale the moment a paragraph moves.
   ---------------------------------------- */

export type CitationStyle = NonNullable<CitationChild['style']>;

/** One place a source is cited from. */
export type CitationUsage = {
  blockId: string;
  childId: string;
  /** 1-based position among this entry's usages — what a back-link reads as. */
  ordinal: number;
};

export type BibliographyEntry = {
  /** Canonical identity: what two spellings of one paper both reduce to. */
  key: string;
  /**
   * The key as the document first spelled it.
   *
   * Printed wherever an entry has nothing else to show, so that canonicalising
   * `Smith2020` into a lower-cased identity never silently rewrites what the
   * author sees on the page.
   */
  displayKey: string;
  /** 1-based position in the reference list; what `[n]` prints. */
  number: number;
  /** Best metadata found across every citation that uses this key. */
  source: CitationSource;
  /**
   * Letter that separates two sources sharing an author and year, so
   * author–year citations of "Smith 2020" stay distinguishable: `2020a`,
   * `2020b`. Empty when there is nothing to disambiguate.
   */
  yearSuffix: string;
  /** Nothing beyond the bare key was ever attached — the entry cannot be read. */
  unresolved: boolean;
  /**
   * The metadata came from a record — a paper index, a DOI registry, a page
   * the assistant read, one of the author's PDFs — rather than being typed.
   * Hallucinated references are a desk-reject criterion at major venues, so
   * the difference is shown wherever a source is.
   */
  verified: boolean;
  usages: CitationUsage[];
};

export type BibliographyOptions = {
  /**
   * The document's source library. An entry's metadata wins over the copies
   * citations carry: the library is where the author corrects a source once
   * for every place it is cited.
   */
  library?: readonly CitationSource[];
  /** The document's chosen style; overrides the per-citation majority. */
  style?: CitationStyle | null;
};

/** Whether a source's metadata came from a record rather than from typing. */
export function isVerifiedSource(source: CitationSource | undefined): boolean {
  return Boolean(source?.provider && source.provider !== 'manual' && source.title);
}

export type Bibliography = {
  entries: readonly BibliographyEntry[];
  byKey: ReadonlyMap<string, BibliographyEntry>;
  /** The document's prevailing style: the most used one, ties to the first. */
  style: CitationStyle;
  /**
   * The style the author chose for the whole document, when they chose one.
   * It overrides every citation's own `style`, so switching the document to
   * author–year relabels every citation at once.
   */
  documentStyle: CitationStyle | null;
};

export const EMPTY_BIBLIOGRAPHY: Bibliography = {
  entries: [],
  byKey: new Map(),
  style: 'numeric',
  documentStyle: null,
};

/* ----------------------------------------
   Identifier canonicalisation
   ---------------------------------------- */

/**
 * A DOI reduced to its bare `10.x/y` form, or nothing if it is not one.
 *
 * Lower-cased because DOIs are case-insensitive, which makes this the identity
 * function for deduplication: the same paper found through arXiv and through
 * Semantic Scholar has to collapse to one bibliography entry.
 */
export function canonicalDoi(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const normalized = raw
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[)\].,;]+$/, '')
    // A trailing slash is never part of a DOI, and `doi.org/10.1/x/` is a
    // normal way to write one.
    .replace(/\/+$/, '');
  // Locale-independent casing: this is an identity function, and a DOI that
  // canonicalises one way in a Turkish locale and another elsewhere breaks
  // dedup. (Display sorting is the only place locale casing belongs.)
  return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized.toLowerCase() : undefined;
}

/** An arXiv id without its host, version suffix or `.pdf` extension. */
export function canonicalArxivId(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const normalized = raw
    .trim()
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/^arxiv:\s*/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.pdf$/i, '')
    .replace(/v\d+$/i, '')
    .trim()
    .toLowerCase();
  return normalized || undefined;
}

/** An arXiv id in either scheme, with or without a version. */
const ARXIV_ID = /^(?:[a-z-]+(?:\.[a-z-]+)?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/;

/**
 * One key per work, whatever form the identifier arrived in.
 *
 * The reference list groups by key, and `buildBibliography` used to group by
 * the raw string — so `10.1234/ABC`, `10.1234/abc` and
 * `https://doi.org/10.1234/abc` printed the same paper three times. Citing a
 * paper from two different search results is the ordinary way to reach that.
 *
 * Case is folded only once the value has been *recognised* as a DOI or an
 * arXiv id, both of which are case-insensitive. Anything else — a Semantic
 * Scholar `S2:` id, a key the author typed — is opaque and returned as
 * written, because lower-casing it silently edits what they see.
 *
 * Mirrors `canonical_citation_key` in the API's `citation_identifiers`.
 */
export function canonicalCitationKey(raw?: string | null): string {
  const candidate = raw?.trim();
  if (!candidate) return '';

  // `canonicalDoi` already recognises the bare, `doi:` and `doi.org` forms.
  const doi = canonicalDoi(candidate);
  if (doi) return doi;

  const stripped = candidate
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/^arxiv:\s*/i, '')
    .replace(/\.pdf$/i, '')
    .toLowerCase();

  // Gated on the whole value looking like an arXiv id: a key of `Smith2020v2`
  // must not lose its suffix to the version strip.
  return ARXIV_ID.test(stripped) ? stripped.replace(/v\d+$/, '') : candidate;
}

/* ----------------------------------------
   Names
   ---------------------------------------- */

/** Lower-cased nobiliary particles that belong to the surname, not before it. */
const PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'della', 'der', 'den', 'di', 'da', 'do', 'dos',
  'du', 'la', 'le', 'lo', 'ten', 'ter', 'bin', 'ibn', 'al', 'af', 'av',
]);

/**
 * Surname of the first author, which is what an author–year citation shows.
 *
 * Author strings arrive from three providers in at least three shapes, and the
 * separator is genuinely ambiguous: the comma in "Smith, John" divides one
 * name, the comma in "J. Smith, A. Doe" divides two. The rule that resolves
 * both is positional — text before the first comma is a surname only when it is
 * a single word, because "Family, Given" never puts a given name first.
 */
export function firstAuthorSurname(authors?: string): string | undefined {
  const list = authors?.trim();
  if (!list) return undefined;

  // `;` and `and` always separate whole authors, so they bind loosest.
  const first = list.split(/\s*(?:;|\band\b|&)\s*/i)[0]?.trim();
  if (!first) return undefined;

  const beforeComma = first.split(',')[0]?.trim();
  if (!beforeComma) return undefined;

  const words = beforeComma.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  if (words.length === 1) return words[0].replace(/\.$/, '') || undefined;

  // "Given Family": walk back over particles so "van der Berg" survives whole.
  // Locale-independent casing: which words count as particles feeds grouping
  // and labels, so it must not shift with the user's locale.
  let start = words.length - 1;
  while (start > 0 && PARTICLES.has(words[start - 1].toLowerCase())) start -= 1;
  return words.slice(start).join(' ') || undefined;
}

/**
 * A stored year as text, whatever shape it arrived in.
 *
 * `CitationSource.year` is typed as a string, but the agent's `doc_edit` schema
 * accepts a provider-style integer and nothing coerces it before it reaches the
 * document. A number reaching `formatReference` used to throw on `.trim()` and
 * take the whole reference list — and so the canvas — down with it. This is the
 * boundary that keeps the declared type honest for everything behind it.
 */
export function citationYear(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : undefined;
  }
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

/** The four-digit year in a date-ish string. */
export function yearOf(value?: unknown): string | undefined {
  return citationYear(value)?.match(/\d{4}/)?.[0];
}

/* ----------------------------------------
   Building the bibliography
   ---------------------------------------- */

/**
 * Fold every citation of one key into a single source record.
 *
 * The same paper cited in five paragraphs stores five copies of its metadata,
 * and they drift: attach a source in one place after another was added by hand
 * and only one of them has a title. First non-empty value wins per field, so
 * the earliest usage leads and later ones fill its gaps.
 */
function mergeSources(key: string, sources: readonly CitationSource[]): CitationSource {
  const merged: Record<string, unknown> = { key };
  for (const source of sources) {
    for (const [field, value] of Object.entries(source)) {
      if (field === 'key' || merged[field] !== undefined) continue;
      if (value === undefined || value === null || value === '') continue;
      merged[field] = value;
    }
  }
  // The one field a provider can hand us as a number. Normalising it here means
  // `entry.source.year` is the string its type promises, for every reader.
  const year = citationYear(merged.year);
  if (year) merged.year = year;
  else delete merged.year;
  return merged as CitationSource;
}

function sortKeyFor(entry: BibliographyEntry): string {
  const surname = firstAuthorSurname(entry.source.authors) ?? '';
  const year = citationYear(entry.source.year) ?? '';
  const title = entry.source.title ?? entry.key;
  // Unattributed entries sort last rather than to the top under the empty
  // string, where a reference list would open with its least useful rows.
  return `${surname ? `0${surname.toLocaleLowerCase()}` : '1'}\u0000${year}\u0000${title.toLocaleLowerCase()}`;
}

/**
 * Everything `buildBibliography` reads, folded into one comparable string:
 * each paragraph's id and, for its citation children, the child's id, style,
 * keys and sources, in document order.
 *
 * The editor rebuilds `blocks` on every keystroke, but a citation only moves
 * when one of these fields does, so the provider compares fingerprints and
 * pays for the full bibliography scan — maps, merge, sort — only then. Keep
 * this in step with whatever `buildBibliography` reads; a field it consumes
 * that the fingerprint misses would serve a stale reference list.
 */
export function citationFingerprint(
  blocks: readonly Block[],
  options: BibliographyOptions = {},
): string {
  const parts: string[] = [options.style ?? '', JSON.stringify(options.library ?? null)];
  for (const block of blocks) {
    if (block.type !== 'paragraph') continue;
    // Order matters: numbering follows the placeholders' order in the text.
    parts.push(block.id, placeholderOrder(block.html).join(','));
    for (const child of block.children ?? []) {
      if (child.type !== 'citation') continue;
      parts.push(
        block.id,
        child.id,
        child.style ?? '',
        JSON.stringify(child.keys ?? null),
        JSON.stringify(child.sources ?? null),
      );
    }
  }
  return parts.join('\u0000');
}

/**
 * Every distinct source the document cites, in reference-list order.
 *
 * Numbering counts *sources*, not citations. It used to count citations, so
 * citing one paper in three paragraphs printed `[1] [2] [3]` and the reader had
 * no way to tell it was one paper — the single most visible thing a numeric
 * citation style is responsible for.
 */
/** Ids of a paragraph's widget placeholders, in the order they appear in its text. */
function placeholderOrder(html: string): string[] {
  return Array.from(html.matchAll(/data-child-id="([^"]+)"/g), (match) => match[1]);
}

/**
 * A paragraph's citation children in reading order.
 *
 * `children` is an array in insertion order; a citation added before an
 * existing one in the same sentence was numbered after it, so the text read
 * `[2] … [1]`. The placeholders' order in the html is the reading order.
 */
function citationsInTextOrder(block: Block): CitationChild[] {
  if (block.type !== 'paragraph') return [];
  const citations = (block.children ?? []).filter(
    (child): child is CitationChild => child.type === 'citation',
  );
  if (citations.length < 2) return citations;
  const position = new Map(placeholderOrder(block.html).map((id, index) => [id, index]));
  return citations
    .map((child, index) => ({ child, index }))
    .sort(
      (a, b) =>
        (position.get(a.child.id) ?? Number.MAX_SAFE_INTEGER) -
          (position.get(b.child.id) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .map((entry) => entry.child);
}

export function buildBibliography(
  blocks: readonly Block[],
  options: BibliographyOptions = {},
): Bibliography {
  const library = new Map<string, CitationSource>();
  for (const source of options.library ?? []) {
    const key = canonicalCitationKey(source.key);
    if (key && !library.has(key)) library.set(key, source);
  }
  const order: string[] = [];
  const collected = new Map<
    string,
    { displayKey: string; aliases: Set<string>; sources: CitationSource[]; usages: CitationUsage[] }
  >();
  const styleCounts = new Map<CitationStyle, number>();
  let firstStyle: CitationStyle | null = null;

  for (const block of blocks) {
    if (block.type !== 'paragraph') continue;
    for (const child of citationsInTextOrder(block)) {
      const style = child.style ?? 'numeric';
      styleCounts.set(style, (styleCounts.get(style) ?? 0) + 1);
      firstStyle ??= style;

      const sources = child.sources ?? [];
      // One citation listing the same key twice is one usage of it, not two —
      // and two spellings of one key are the same key.
      const seen = new Set<string>();
      for (const rawKey of child.keys ?? []) {
        const raw = rawKey?.trim();
        if (!raw) continue;
        const key = canonicalCitationKey(raw);
        if (!key || seen.has(key)) continue;
        seen.add(key);

        let bucket = collected.get(key);
        if (!bucket) {
          bucket = { displayKey: raw, aliases: new Set(), sources: [], usages: [] };
          collected.set(key, bucket);
          order.push(key);
        }
        bucket.aliases.add(raw);
        // The source records are keyed by the spelling the citation used, so
        // they are matched canonically too.
        const source = sources.find(
          (candidate) => canonicalCitationKey(candidate.key) === key,
        );
        if (source) bucket.sources.push(source);
        bucket.usages.push({
          blockId: block.id,
          childId: child.id,
          ordinal: bucket.usages.length + 1,
        });
      }
    }
  }

  const style = options.style ?? dominantStyle(styleCounts, firstStyle);
  const documentStyle = options.style ?? null;
  if (order.length === 0) {
    return { ...EMPTY_BIBLIOGRAPHY, style, documentStyle };
  }

  const entries: BibliographyEntry[] = order.map((key) => {
    const bucket = collected.get(key)!;
    const fromLibrary = library.get(key);
    const source = mergeSources(key, fromLibrary ? [fromLibrary, ...bucket.sources] : bucket.sources);
    return {
      key,
      displayKey: bucket.displayKey,
      number: 0,
      source,
      yearSuffix: '',
      unresolved: !source.title && !source.authors,
      verified: isVerifiedSource(fromLibrary) || bucket.sources.some(isVerifiedSource),
      usages: bucket.usages,
    };
  });

  // Author–year lists are read alphabetically; numeric lists are read by the
  // number, which only means anything if it follows citation order.
  if (style === 'author-year') {
    entries.sort((a, b) => sortKeyFor(a).localeCompare(sortKeyFor(b)));
  }

  entries.forEach((entry, index) => {
    entry.number = index + 1;
  });
  assignYearSuffixes(entries);

  // Every spelling the document used resolves to the entry, so a caller
  // holding a raw key finds it without knowing the canonicalisation rule.
  const byKey = new Map<string, BibliographyEntry>();
  for (const entry of entries) {
    byKey.set(entry.key, entry);
    for (const alias of collected.get(entry.key)!.aliases) byKey.set(alias, entry);
  }
  return { entries, byKey, style, documentStyle };
}

function dominantStyle(
  counts: ReadonlyMap<CitationStyle, number>,
  fallback: CitationStyle | null,
): CitationStyle {
  let best: CitationStyle | null = null;
  let bestCount = 0;
  for (const [style, count] of counts) {
    if (count > bestCount) {
      best = style;
      bestCount = count;
    }
  }
  // A tie means the document is mid-migration between two styles; the first
  // citation is the one the author most recently chose to look at.
  const tied = [...counts.values()].filter((count) => count === bestCount).length > 1;
  return (tied ? fallback : best) ?? fallback ?? 'numeric';
}

/** `a`…`z`, then `aa`: a wrapping alphabet would hand two entries one suffix. */
function suffixLetters(index: number): string {
  let letters = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    letters = String.fromCharCode(97 + (n % 26)) + letters;
  }
  return letters;
}

/** `a`/`b`/`c` for entries an author–year citation could not otherwise tell apart. */
function assignYearSuffixes(entries: BibliographyEntry[]): void {
  const groups = new Map<string, BibliographyEntry[]>();
  for (const entry of entries) {
    const surname = firstAuthorSurname(entry.source.authors);
    const year = citationYear(entry.source.year);
    if (!surname || !year) continue;
    const id = `${surname.toLowerCase()}\u0000${year}`;
    const group = groups.get(id);
    if (group) group.push(entry);
    else groups.set(id, [entry]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.forEach((entry, index) => {
      entry.yearSuffix = suffixLetters(index);
    });
  }
}

/* ----------------------------------------
   Labels
   ---------------------------------------- */

/** Consecutive runs, so `[1,2,3,7]` can print as `1–3, 7`. */
function numberRuns(numbers: readonly number[]): Array<[number, number]> {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const value of sorted) {
    const last = runs.at(-1);
    if (last && value === last[1] + 1) last[1] = value;
    else runs.push([value, value]);
  }
  return runs;
}

/**
 * Bibliography entries this citation points at, in the order its keys list them.
 *
 * A key with no entry means the widget is being rendered outside the document
 * that owns it — a design-system preview, a detached test. It gets `null`
 * rather than a borrowed neighbouring number.
 */
export function citationEntries(
  child: CitationChild,
  bibliography: Bibliography,
): Array<BibliographyEntry | null> {
  return (child.keys ?? []).map((key) => entryForKey(bibliography, key));
}

/**
 * The entry a key names, whichever spelling of it the caller is holding.
 *
 * `byKey` already carries every alias the document used, but a key that has
 * never been cited — one the author has just typed into a citation — is only
 * findable through its canonical form.
 */
export function entryForKey(
  bibliography: Bibliography,
  key?: string | null,
): BibliographyEntry | null {
  const raw = key?.trim();
  if (!raw) return null;
  return bibliography.byKey.get(raw) ?? bibliography.byKey.get(canonicalCitationKey(raw)) ?? null;
}

/**
 * One fragment of a citation's printed label.
 *
 * The label is split rather than returned whole so that each number can carry
 * its own destination: `[1, 4]` is two links, and rendering it as one link to
 * entry 1 silently drops half of what the citation says.
 */
export type CitationLabelPart = {
  text: string;
  /** The entry this fragment names, when it names exactly one. */
  entry?: BibliographyEntry;
};

function authorYearName(entry: BibliographyEntry | null, key: string): string {
  if (!entry) return key;
  const surname = firstAuthorSurname(entry.source.authors);
  const year = citationYear(entry.source.year);
  // Falls back to the raw key rather than inventing an author: a citation
  // showing the wrong name is worse than one showing a key.
  return surname && year ? `${surname}, ${year}${entry.yearSuffix}` : key;
}

function numericParts(
  entries: Array<BibliographyEntry | null>,
  style: CitationStyle,
): CitationLabelPart[] {
  const known = entries.filter((entry): entry is BibliographyEntry => entry !== null);
  if (known.length === 0) return [{ text: '[?]' }];

  const bracketed = style === 'ieee';
  const byNumber = new Map(known.map((entry) => [entry.number, entry]));
  const number = (value: number): CitationLabelPart => ({
    text: bracketed ? `[${value}]` : String(value),
    entry: byNumber.get(value),
  });

  const parts: CitationLabelPart[] = [];
  if (!bracketed) parts.push({ text: '[' });

  numberRuns(known.map((entry) => entry.number)).forEach(([from, to], index) => {
    if (index > 0) parts.push({ text: ', ' });
    // A run of two prints both numbers: "[1]–[2]" saves no space and reads as
    // a range of more than the two things it covers.
    if (to - from >= 2) {
      parts.push(number(from), { text: '–' }, number(to));
      return;
    }
    for (let value = from; value <= to; value += 1) {
      if (value > from) parts.push({ text: ', ' });
      parts.push(number(value));
    }
  });

  if (entries.length > known.length) parts.push({ text: bracketed ? ', [?]' : ', ?' });
  if (!bracketed) parts.push({ text: ']' });
  return parts;
}

/**
 * What the citation prints in the run of text, in linkable fragments.
 *
 * Prefix, locator and suffix are plain text: they qualify the citation rather
 * than name an entry, so they are never part of a link.
 */
export function citationLabelParts(
  child: CitationChild,
  bibliography: Bibliography,
): CitationLabelPart[] {
  const keys = child.keys ?? [];
  const entries = citationEntries(child, bibliography);
  const prefix = child.prefix?.trim();
  const trailing = [child.locator, child.suffix]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ');
  const style: CitationStyle = bibliography.documentStyle ?? child.style ?? 'numeric';
  const parts: CitationLabelPart[] = [];

  if (style === 'author-year') {
    // "(see Smith, 2020, p. 12)" — every author–year convention puts the
    // signal phrase inside the parentheses, not in front of them.
    parts.push({ text: '(' });
    if (prefix) parts.push({ text: `${prefix} ` });
    if (keys.length === 0) parts.push({ text: 'citation' });
    entries.forEach((entry, index) => {
      if (index > 0) parts.push({ text: '; ' });
      parts.push({ text: authorYearName(entry, keys[index]), ...(entry ? { entry } : {}) });
    });
    if (trailing) parts.push({ text: `, ${trailing}` });
    parts.push({ text: ')' });
    return parts;
  }

  if (prefix) parts.push({ text: `${prefix} ` });
  parts.push(...(keys.length ? numericParts(entries, style) : [{ text: '[?]' }]));
  if (trailing) parts.push({ text: `, ${trailing}` });
  return parts;
}

/** The citation's printed label as one string. */
export function citationLabel(child: CitationChild, bibliography: Bibliography): string {
  return citationLabelParts(child, bibliography)
    .map((part) => part.text)
    .join('');
}

/* ----------------------------------------
   Reference-list entries
   ---------------------------------------- */

export type ReferenceParts = {
  /** The formatted entry, already punctuated, minus its link. */
  text: string;
  /** Canonical destination for the source, if it has one. */
  href?: string;
  /** How the link reads. */
  linkLabel?: string;
};

function httpsUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The one link a reference entry should offer, best identifier first. */
export function referenceLink(source: CitationSource): { href: string; label: string } | null {
  const doi = canonicalDoi(source.doi) ?? canonicalDoi(source.key);
  if (doi) return { href: `https://doi.org/${doi}`, label: `doi.org/${doi}` };
  const url = httpsUrl(source.url) ?? httpsUrl(source.pdfUrl);
  if (url) return { href: url, label: url.replace(/^https?:\/\//, '') };
  const arxivId = source.provider === 'arxiv' ? canonicalArxivId(source.providerId) : undefined;
  if (arxivId) return { href: `https://arxiv.org/abs/${arxivId}`, label: `arXiv:${arxivId}` };
  return null;
}

/**
 * One reference-list row, formatted for the document's style.
 *
 * The stored author string is printed as it was supplied. Reordering "J. Smith"
 * into "Smith, J." needs structured names, which no provider here returns, and
 * guessing at the split is how a bibliography ends up citing "A." as a surname.
 */
export function formatReference(
  entry: BibliographyEntry,
  style: CitationStyle,
): ReferenceParts {
  const { source } = entry;
  const authors = source.authors?.trim();
  const title = source.title?.trim();
  const venue = source.venue?.trim();
  const year = citationYear(source.year);
  const link = referenceLink(source);
  const parts: ReferenceParts = link
    ? { text: '', href: link.href, linkLabel: link.label }
    : { text: '' };

  if (!authors && !title && !venue && !year) {
    // Nothing was ever attached: name the key so the author can find and fix
    // it — as they spelled it, not as the grouping canonicalised it.
    parts.text = entry.displayKey;
    return parts;
  }

  if (style === 'author-year') {
    const head = authors || title || entry.displayKey;
    const dated = year ? `${head} (${year}${entry.yearSuffix})` : head;
    const rest = [head === title ? null : title, venue].filter(Boolean);
    parts.text = `${[dated, ...rest].join('. ')}.`;
    return parts;
  }

  if (style === 'ieee') {
    const segments = [authors, title ? `“${title}”` : null, venue, year].filter(Boolean);
    parts.text = `${segments.join(', ')}.`;
    return parts;
  }

  parts.text = `${[authors, title, venue, year].filter(Boolean).join('. ')}.`;
  return parts;
}

/** What precedes a reference row: `[1]` for numbered styles, nothing otherwise. */
export function referenceMarker(entry: BibliographyEntry, style: CitationStyle): string {
  return style === 'author-year' ? '' : `[${entry.number}]`;
}

/* ----------------------------------------
   Anchors

   The link between a usage and its entry. Numbers are already unique and
   already stable within one render, so they make better fragment ids than
   slugged DOIs, which can collide once punctuation is stripped.
   ---------------------------------------- */

export function referenceAnchorId(entry: Pick<BibliographyEntry, 'number'>): string {
  return `ref-${entry.number}`;
}

export function citationAnchorId(childId: string): string {
  return `cite-${childId.replace(/[^A-Za-z0-9_.:-]/g, '-')}`;
}
