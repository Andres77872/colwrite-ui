import { placeholderIdList } from './placeholderIds';
import type { Block, CitationChild, CitationStyle, CslItem, ReferenceRecord } from './types';
import type { CslCite, CslRendering } from './csl/engine';
import { citationProcessor, requestCitationProcessor } from './csl/processor';
import { referenceAuthors, referenceTitle, referenceYear } from './referenceRecords';
import { markupText, type CslMarkup, type CslNode } from './csl/markup';
import { DEFAULT_CITATION_STYLE, isCitationStyle } from './csl/styles';

/* ----------------------------------------
   The citation model

   One module answers "what does this citation print, and what does it point
   at", for the editor and every export alike. The page's citations and its
   reference list are rendered by the CSL processor (`csl/engine.ts`) from
   the records, in the page's CSL style: numbering, sorting, disambiguation
   ("2020a") and punctuation are the style's.

   Everything here is derived from the blocks. Nothing is stored: numbering is
   a property of the document, not of a citation, and a stored number goes
   stale the moment a paragraph moves.
   ---------------------------------------- */

export type { CitationStyle };

/** One place a source is cited from. */
export type CitationUsage = {
  blockId: string;
  childId: string;
  /** 1-based position among this entry's usages — what a back-link reads as. */
  ordinal: number;
};

export type BibliographyEntry = {
  /** The work's reference key, as the citations name it. */
  key: string;
  /** 1-based position in the reference list, in the style's order. */
  number: number;
  /**
   * The work's reference: the library's record, which wins, else the copy
   * the first citation of it carries. `null` for a key nothing describes.
   */
  record: ReferenceRecord | null;
  /** The label the style sets in the margin (`[1]`, `1.`); `null` for an author-date list. */
  marker: string | null;
  /** The entry as the style formats it. */
  formatted: CslMarkup;
  usages: CitationUsage[];
};

export type BibliographyOptions = {
  /**
   * The document's source library. An entry's record wins over the copies
   * citations carry: the library is where a source is corrected once for
   * every place it is cited.
   */
  library?: readonly ReferenceRecord[];
  /** The document's chosen style; overrides the citations' own. */
  style?: CitationStyle | null;
};

export type Bibliography = {
  entries: readonly BibliographyEntry[];
  byKey: ReadonlyMap<string, BibliographyEntry>;
  /** The style the page renders in: the document's, else the one most of its citations name. */
  style: CitationStyle;
  /** The style the author chose for the whole document, when they chose one. */
  documentStyle: CitationStyle | null;
  /** Each citation as the style prints it in the text, by the child's id. */
  labels: ReadonlyMap<string, CslMarkup>;
  /** The style sets its entries with a hanging indent. */
  hangingIndent: boolean;
  /**
   * Rendered in its CSL style. `false` while the citation processor loads:
   * the labels are numbers in order of first citation and the entries the
   * authors, title and year, in no style (`neutralRendering`).
   */
  ready: boolean;
};

export const EMPTY_BIBLIOGRAPHY: Bibliography = {
  entries: [],
  byKey: new Map(),
  style: DEFAULT_CITATION_STYLE,
  documentStyle: null,
  labels: new Map(),
  hangingIndent: false,
  ready: true,
};

/** What a citation prints when it names nothing the page can render. */
const UNKNOWN_LABEL: CslMarkup = ['[?]'];

/* ----------------------------------------
   Reading order
   ---------------------------------------- */

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
  const position = new Map(placeholderIdList(block.html).map((id, index) => [id, index]));
  return citations
    .map((child, index) => ({ child, index }))
    .sort(
      (a, b) =>
        (position.get(a.child.id) ?? Number.MAX_SAFE_INTEGER) -
          (position.get(b.child.id) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .map((entry) => entry.child);
}

/** A citation's distinct, non-empty keys, in the order it names them. */
export function citationKeys(child: CitationChild): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of child.keys ?? []) {
    const key = raw?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Everything `buildBibliography` reads, folded into one comparable string:
 * the style, the library, and each paragraph's placeholder order and
 * citation children (keys, records, prefix, locator, suffix, style).
 *
 * The editor rebuilds `blocks` on every keystroke, but a citation only moves
 * when one of these does, so the provider compares fingerprints and renders
 * only then. Keep this in step with whatever `buildBibliography` reads.
 */
export function citationFingerprint(
  blocks: readonly Block[],
  options: BibliographyOptions = {},
): string {
  const parts: string[] = [options.style ?? '', JSON.stringify(options.library ?? null)];
  for (const block of blocks) {
    if (block.type !== 'paragraph') continue;
    parts.push(block.id, placeholderIdList(block.html).join(','));
    for (const child of block.children ?? []) {
      if (child.type !== 'citation') continue;
      parts.push(
        block.id,
        child.id,
        child.style ?? '',
        JSON.stringify([child.keys ?? null, child.sources ?? null, child.prefix ?? '', child.locator ?? '', child.suffix ?? '']),
      );
    }
  }
  return parts.join('\u0000');
}

function dominantStyle(counts: ReadonlyMap<CitationStyle, number>, first: CitationStyle | null): CitationStyle {
  let best: CitationStyle | null = null;
  let bestCount = 0;
  for (const [style, count] of counts) {
    if (count > bestCount) {
      best = style;
      bestCount = count;
    }
  }
  // A tie: the first citation is the one the author most likely chose last.
  const tied = [...counts.values()].filter((count) => count === bestCount).length > 1;
  return (tied ? first : best) ?? first ?? DEFAULT_CITATION_STYLE;
}

/**
 * The item a key with no record goes to the processor as: the key as its
 * title. Its language is "no linguistic content", so no style title-cases
 * what the author typed.
 */
function placeholderItem(key: string): CslItem {
  return { id: key, type: 'document', title: key, language: 'zxx' };
}

/**
 * The page's citations before the processor has loaded, in no style: each
 * work numbered in order of first citation, each citation its numbers in
 * brackets, each entry its authors, title and year. Nothing here reads as a
 * style the page did not choose.
 */
function neutralRendering(items: ReadonlyMap<string, CslItem>, cites: readonly CslCite[]): CslRendering {
  const numbers = new Map<string, number>();
  for (const cite of cites) for (const item of cite.items) if (!numbers.has(item.id)) numbers.set(item.id, numbers.size + 1);
  const citations = new Map(cites.map((cite) => [
    cite.id,
    [`[${[...new Set(cite.items.map((item) => numbers.get(item.id)))].join(', ')}]`],
  ]));
  const entries = [...numbers.keys()].map((id) => {
    const csl = items.get(id) ?? placeholderItem(id);
    const record = { key: id, csl };
    const parts = [referenceAuthors(record), referenceTitle(record, id), referenceYear(record)].filter(Boolean);
    return { id, marker: `[${numbers.get(id)}]`, body: [`${parts.join('. ')}.`] };
  });
  return { citations, entries, hangingIndent: false };
}

/** What a citation's prefix, locator and suffix become around its works. */
function citeOf(child: CitationChild, keys: readonly string[]): CslCite {
  const prefix = child.prefix?.trim();
  const trailing = [child.locator, child.suffix].map((part) => part?.trim()).filter(Boolean).join(', ');
  return {
    id: child.id,
    items: keys.map((id, index) => ({
      id,
      ...(index === 0 && prefix ? { prefix: `${prefix} ` } : {}),
      ...(index === keys.length - 1 && trailing ? { suffix: `, ${trailing}` } : {}),
    })),
  };
}

/**
 * The page's bibliography: every work it cites, in the style's order, each
 * citation's label, and where each work is cited from.
 */
export function buildBibliography(
  blocks: readonly Block[],
  options: BibliographyOptions = {},
): Bibliography {
  const library = new Map<string, ReferenceRecord>();
  for (const record of options.library ?? []) {
    if (record.key && !library.has(record.key)) library.set(record.key, record);
  }

  const records = new Map<string, ReferenceRecord | null>();
  const usages = new Map<string, CitationUsage[]>();
  const cites: CslCite[] = [];
  const styleCounts = new Map<CitationStyle, number>();
  let firstStyle: CitationStyle | null = null;

  for (const block of blocks) {
    if (block.type !== 'paragraph') continue;
    for (const child of citationsInTextOrder(block)) {
      if (isCitationStyle(child.style)) {
        styleCounts.set(child.style, (styleCounts.get(child.style) ?? 0) + 1);
        firstStyle ??= child.style;
      }
      const keys = citationKeys(child);
      if (keys.length === 0) continue;
      for (const key of keys) {
        if (!records.has(key) || records.get(key) === null) {
          records.set(key, library.get(key) ?? child.sources?.find((source) => source.key === key) ?? null);
        }
        const list = usages.get(key) ?? [];
        list.push({ blockId: block.id, childId: child.id, ordinal: list.length + 1 });
        usages.set(key, list);
      }
      cites.push(citeOf(child, keys));
    }
  }

  const documentStyle = isCitationStyle(options.style) ? options.style : null;
  const style = documentStyle ?? dominantStyle(styleCounts, firstStyle);
  if (cites.length === 0) return { ...EMPTY_BIBLIOGRAPHY, style, documentStyle };

  const items = new Map<string, CslItem>();
  for (const [key, record] of records) {
    items.set(key, record ? { ...record.csl, id: key } : placeholderItem(key));
  }
  const processor = citationProcessor();
  // A page with citations is a first need: ask, and write them neutrally meanwhile.
  if (!processor) requestCitationProcessor();
  const rendered = processor ? processor.renderCitations(style, items, cites) : neutralRendering(items, cites);

  const entries: BibliographyEntry[] = rendered.entries.map((entry, index) => ({
    key: entry.id,
    number: index + 1,
    record: records.get(entry.id) ?? null,
    marker: entry.marker,
    formatted: entry.body,
    usages: usages.get(entry.id) ?? [],
  }));
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  return {
    entries, byKey, style, documentStyle, labels: rendered.citations, hangingIndent: rendered.hangingIndent, ready: processor !== null,
  };
}

/**
 * A list of references as `style` formats them, in the order given (each as
 * if cited once, in turn): what a copied answer's "Sources" list holds, so it
 * reads like a reference list and not like a byline. In the neutral form
 * until the processor has loaded (a reply with sources asks for it).
 */
export function formatReferences(
  records: readonly ReferenceRecord[],
  style: CitationStyle = DEFAULT_CITATION_STYLE,
): Map<string, CslMarkup> {
  const items = new Map(records.map((record) => [record.key, { ...record.csl, id: record.key }]));
  const cites = [...items.keys()].map((id, index) => ({ id: `ref-${index}`, items: [{ id }] }));
  const processor = citationProcessor();
  if (!processor) requestCitationProcessor();
  const rendered = processor ? processor.renderCitations(style, items, cites) : neutralRendering(items, cites);
  return new Map(rendered.entries.map((entry) => [entry.id, entry.body]));
}

/* ----------------------------------------
   Reading a bibliography
   ---------------------------------------- */

/** The entry a key names, or `null` when the page does not cite it. */
export function entryForKey(bibliography: Bibliography, key?: string | null): BibliographyEntry | null {
  const raw = key?.trim();
  return raw ? bibliography.byKey.get(raw) ?? null : null;
}

/** The entries a citation points at, in the order its keys list them. */
export function citationEntries(child: CitationChild, bibliography: Bibliography): Array<BibliographyEntry | null> {
  return citationKeys(child).map((key) => entryForKey(bibliography, key));
}

/**
 * What the citation prints in the run of text. A citation the bibliography
 * does not hold (one rendered outside its document, or with no key) prints
 * `[?]` rather than a borrowed number.
 */
export function citationLabel(child: CitationChild, bibliography: Bibliography): CslMarkup {
  return bibliography.labels.get(child.id) ?? UNKNOWN_LABEL;
}

/** The citation's printed label as plain text. */
export function citationLabelText(child: CitationChild, bibliography: Bibliography): string {
  return markupText(citationLabel(child, bibliography));
}

/** Whether a style prints its citations in parentheses, set apart from the word before. */
export function isParenthetical(label: CslMarkup): boolean {
  const first = label[0];
  const text = typeof first === 'string' ? first : first ? markupText([first as CslNode]) : '';
  return text.startsWith('(');
}

/* ----------------------------------------
   Anchors

   The link between a usage and its entry. Numbers are unique and stable
   within one render, so they make better fragment ids than slugged keys.
   ---------------------------------------- */

export function referenceAnchorId(entry: Pick<BibliographyEntry, 'number'>): string {
  return `ref-${entry.number}`;
}

export function citationAnchorId(childId: string): string {
  return `cite-${childId.replace(/[^A-Za-z0-9_.:-]/g, '-')}`;
}
