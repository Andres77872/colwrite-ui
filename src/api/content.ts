import { coerceBlock, withoutOrphanChildren } from '@/editor/docOps';
import { DEFAULT_CITATION_STYLE, isCitationStyle } from '@/editor/csl/styles';
import {
  DEFAULT_DOCUMENT_TITLE,
  type Block,
  type CitationStyle,
  type CslItem,
  type Doc,
  type ParagraphChild,
  type ReferenceRecord,
} from '@/editor/types';
import { isUnknownRecord } from '@/lib/json';
import type {
  DocumentContentInput,
  DocumentContentOutput,
  ParagraphBlockInput,
  ReferenceRecordOutput,
} from './schema';

/**
 * The only conversions between a page as the API stores it
 * (`DocumentContent`) and the editor's `Doc` (`docs/workspace_collection/15`
 * §6.4). The editor's model is its own: it leaves default-valued fields
 * out, and the ETag a save is locked on stays with the editor session.
 * `src/api/__tests__/content.test.ts` fails at the type level when the two
 * drift apart.
 */

type WireBlock = NonNullable<DocumentContentInput['blocks']>[number];
type WireChild = NonNullable<ParagraphBlockInput['children']>[number];

function citationStyle(value: unknown): CitationStyle | null {
  return isCitationStyle(value) ? value : null;
}

/** A JSON value with every `null` member left out, as the editor holds absent fields. */
function withoutNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutNulls) as T;
  if (!isUnknownRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && item !== undefined) out[key] = withoutNulls(item);
  }
  return out as T;
}

/**
 * A reference from the API (the library, a citation's copy, the resolver, a
 * paper route) as the editor holds it: the same record, absent rather than
 * `null`.
 */
export function toEditorRecord(record: ReferenceRecordOutput): ReferenceRecord {
  return withoutNulls(record) as ReferenceRecord;
}

const KINDS = new Set<ReferenceRecord['kind']>(['paper', 'preprint', 'book', 'web', 'pdf', 'page', 'dataset', 'other']);
const PROVIDERS = new Set<ReferenceRecord['provider']>([
  'openalex', 'semantic_scholar', 'arxiv_index', 'crossref', 'doi_org', 'arxiv', 'web', 'resource', 'page', 'manual',
]);
const STATES = new Set<ReferenceRecord['state']>(['verified', 'needs_review', 'not_found', 'unchecked']);
const FLAGS = new Set<ReferenceRecord['flags'][number]>(['retracted', 'corrected', 'concern', 'has_published_version', 'preprint', 'uncited']);
const NOTICE_TYPES = new Set(['retraction', 'correction', 'expression_of_concern', 'withdrawal']);
const CSL_TEXT = [
  'title-short', 'container-title', 'collection-title', 'event-title', 'publisher', 'publisher-place', 'volume',
  'issue', 'page', 'number', 'edition', 'genre', 'medium', 'language', 'note', 'DOI', 'URL', 'ISBN', 'ISSN', 'PMID', 'PMCID',
] as const;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item)) : []);

function cslNames(value: unknown): CslItem['author'] {
  if (!Array.isArray(value)) return undefined;
  const names = value.flatMap((entry) => {
    if (!isUnknownRecord(entry)) return [];
    const name: NonNullable<CslItem['author']>[number] = {};
    for (const field of ['family', 'given', 'literal', 'suffix', 'dropping-particle', 'non-dropping-particle'] as const) {
      const part = text(entry[field]);
      if (part) name[field] = part;
    }
    return name.family || name.literal ? [name] : [];
  });
  return names.length ? names : undefined;
}

function cslDate(value: unknown): CslItem['issued'] {
  if (!isUnknownRecord(value)) return undefined;
  const date: NonNullable<CslItem['issued']> = {};
  const parts = value['date-parts'];
  if (Array.isArray(parts)) {
    const valid = parts.filter((part): part is number[] => Array.isArray(part) && part.length > 0 && part.every((n) => Number.isInteger(n)));
    if (valid.length) date['date-parts'] = valid;
  }
  if (text(value.literal)) date.literal = text(value.literal);
  if (text(value.raw)) date.raw = text(value.raw);
  return Object.keys(date).length ? date : undefined;
}

/**
 * A reference from the assistant's socket (an `evidence` event, a stored
 * reply's record), which is untrusted like any other frame: the record when
 * it is one — a key, its kind, provider and state, and a CSL item with that
 * key as its id, a type and a title — with only the fields the contract
 * names, each of its type; `null` otherwise. A flag this client does not
 * know is dropped.
 */
export function referenceRecordOf(value: unknown): ReferenceRecord | null {
  if (!isUnknownRecord(value) || !isUnknownRecord(value.csl)) return null;
  const key = text(value.key);
  const csl = value.csl;
  if (!key || csl.id !== key || typeof csl.type !== 'string' || !text(csl.title)) return null;
  if (!KINDS.has(value.kind as ReferenceRecord['kind'])) return null;
  if (!PROVIDERS.has(value.provider as ReferenceRecord['provider'])) return null;
  if (!STATES.has(value.state as ReferenceRecord['state'])) return null;
  const item: CslItem = { id: key, type: csl.type as CslItem['type'], title: csl.title as string };
  for (const field of CSL_TEXT) {
    const part = text(csl[field]);
    if (part) item[field] = part;
  }
  const author = cslNames(csl.author);
  if (author) item.author = author;
  const editor = cslNames(csl.editor);
  if (editor) item.editor = editor;
  const issued = cslDate(csl.issued);
  if (issued) item.issued = issued;
  const accessed = cslDate(csl.accessed);
  if (accessed) item.accessed = accessed;

  const record: ReferenceRecord = {
    key,
    kind: value.kind as ReferenceRecord['kind'],
    provider: value.provider as ReferenceRecord['provider'],
    state: value.state as ReferenceRecord['state'],
    flags: [...new Set(texts(value.flags).filter((flag): flag is ReferenceRecord['flags'][number] => FLAGS.has(flag as ReferenceRecord['flags'][number])))],
    csl: item,
  };
  if (text(value.checked)) record.checked = text(value.checked);
  const differs = texts(value.differs);
  if (differs.length) record.differs = differs;
  if (text(value.published_doi)) record.published_doi = text(value.published_doi);
  if (Array.isArray(value.notices)) {
    const notices = value.notices.flatMap((notice) => {
      if (!isUnknownRecord(notice) || !NOTICE_TYPES.has(notice.type as string)) return [];
      const out: NonNullable<ReferenceRecord['notices']>[number] = { type: notice.type as NonNullable<ReferenceRecord['notices']>[number]['type'] };
      for (const field of ['date', 'doi', 'url', 'source'] as const) {
        const part = text(notice[field]);
        if (part) out[field] = part;
      }
      return [out];
    });
    if (notices.length) record.notices = notices;
  }
  return record;
}

/**
 * The editor's blocks from blocks it did not write. The html lands on the
 * canvas through `innerHTML`, so every block goes through the editor's own
 * sanitizing normalizer; the common, already-clean shapes skip the slow path.
 */
function editorBlocks(value: readonly unknown[]): Block[] {
  return value.map(editorBlock).filter((block): block is Block => block !== null);
}

function editorBlock(value: unknown): Block | null {
  if (isUnknownRecord(value) && typeof value.id === 'string') {
    if (value.type === 'divider') return value as Block;
    if (value.type === 'heading' && typeof value.html === 'string' && (value.level === 1 || value.level === 2 || value.level === 3)) {
      return value as Block;
    }
    if (
      value.type === 'paragraph'
      && typeof value.html === 'string'
      && (value.children === undefined || Array.isArray(value.children))
      && (value.columns === undefined || typeof value.columns === 'number')
      // Role fields need checking against the canonical rules (a stale
      // `checked` on a bullet fails the save), so those take the slow path.
      && value.variant == null
      && value.checked == null
      && value.indent == null
    ) {
      return value as Block;
    }
  }
  return coerceBlock(value);
}

/** A page's blocks as the server sent them, with each citation's records as the editor holds them. */
function readBlocks(value: readonly unknown[]): Block[] {
  return editorBlocks(value).map((block) => {
    if (block.type !== 'paragraph' || !block.children?.some((child) => child.type === 'citation' || child.type === 'aiBeat')) return block;
    return {
      ...block,
      children: block.children.map((child) => {
        if (child.type === 'citation') return withoutNulls(child);
        if (child.type === 'aiBeat' && child.output) return { ...child, output: withoutNulls(child.output) };
        return child;
      }),
    };
  });
}

/**
 * The library as the canonical model accepts it: one entry per non-empty
 * key, and `null` rather than an empty list, which would change the stored
 * document's content hash for nothing.
 */
function wireLibrary(sources: readonly ReferenceRecord[] | undefined): ReferenceRecord[] | null {
  if (!sources) return null;
  const seen = new Set<string>();
  const out = sources.filter((source) => {
    if (typeof source.key !== 'string' || !source.key.trim() || seen.has(source.key)) return false;
    seen.add(source.key);
    return true;
  });
  return out.length ? out : null;
}

const BLOCK_DEFAULTS = { aiHidden: false, collapsed: false, locked: false } as const;

/**
 * A widget with the defaults the server writes out
 * (`ColWrite-api/src/documents/domain/models.py`), so what a save sends is
 * the content the server stores, including the model's default-valued fields.
 */
function wireChild(child: ParagraphChild): WireChild {
  switch (child.type) {
    case 'aiBeat':
      return { collapsed: false, ...child, message: child.message ?? '', prompt: child.prompt ?? '' };
    case 'table':
      return { header: false, align: [], ...child };
    case 'equation':
      return { display: false, numbered: false, ...child };
    case 'citation':
      return { style: DEFAULT_CITATION_STYLE, sources: [], ...child };
    case 'graph':
      return child;
  }
}

/** The editor leaves default-valued fields out; the contract spells them out. */
function wireBlock(block: Block): WireBlock {
  switch (block.type) {
    case 'paragraph': {
      const { children, ...rest } = block;
      return { ...BLOCK_DEFAULTS, columns: 1, ...rest, ...(children ? { children: children.map(wireChild) } : {}) };
    }
    case 'heading':
    case 'divider':
    case 'code':
      return { ...BLOCK_DEFAULTS, ...block };
    case 'image':
      return { ...BLOCK_DEFAULTS, width: 1, ...block };
  }
}

/** A page's stored content as the editor's `Doc`. */
export function toEditorDoc(content: DocumentContentOutput): Doc {
  const doc: Doc = { blocks: readBlocks(content.blocks ?? []) };
  if (content.name) doc.name = content.name;
  const sources = content.sources?.map(toEditorRecord);
  if (sources?.length) doc.sources = sources;
  const style = citationStyle(content.citationStyle);
  if (style) doc.citationStyle = style;
  if (content.instructions) doc.instructions = content.instructions;
  if (content.documentType) doc.documentType = content.documentType;
  return doc;
}

/**
 * What a save sends for the editor's `Doc`.
 *
 * A widget entry with no placeholder in the html is refused by the server
 * (422), and one refused block stops every later save of the page. The author
 * cannot see such an entry, so it is left out. `sources` and `citationStyle`
 * are always sent (`null` clears): a save merges over the stored page, and an
 * omitted field would keep a library the author emptied. A page with no name
 * is saved under the default one, as the server names it.
 */
export function toWireContent(doc: Doc): DocumentContentInput {
  return {
    schema_version: 1,
    name: doc.name || DEFAULT_DOCUMENT_TITLE,
    blocks: editorBlocks(doc.blocks).map(withoutOrphanChildren).map(wireBlock),
    sources: wireLibrary(doc.sources),
    citationStyle: citationStyle(doc.citationStyle),
    instructions: doc.instructions ?? null,
    documentType: doc.documentType ?? null,
  };
}
