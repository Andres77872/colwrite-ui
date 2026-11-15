import { coerceBlock, withoutOrphanChildren } from '@/editor/docOps';
import { DEFAULT_DOCUMENT_TITLE, type Block, type CitationSource, type Doc, type ParagraphChild } from '@/editor/types';
import { isUnknownRecord } from '@/lib/json';
import type {
  CitationSource as WireCitationSource,
  DocumentContentInput,
  DocumentContentOutput,
  ParagraphBlockInput,
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

const CITATION_STYLES: ReadonlySet<string> = new Set(['numeric', 'author-year', 'ieee']);
type CitationStyle = NonNullable<Doc['citationStyle']>;

function citationStyle(value: unknown): CitationStyle | null {
  return typeof value === 'string' && CITATION_STYLES.has(value) ? (value as CitationStyle) : null;
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

/**
 * A library entry as the editor reads it: absent rather than null, and `year`
 * as text. Also what the source resolver's record becomes.
 */
export function toEditorSource(source: WireCitationSource): CitationSource {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    out[key] = key === 'year' ? String(value) : value;
  }
  return out as CitationSource;
}

/**
 * The library as the canonical model accepts it: one entry per non-empty
 * key, and `null` rather than an empty list, which would change the stored
 * document's content hash for nothing.
 */
function wireLibrary(sources: readonly CitationSource[] | undefined): CitationSource[] | null {
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

function wireChild(child: ParagraphChild): WireChild {
  switch (child.type) {
    case 'aiBeat':
      return { collapsed: false, ...child };
    case 'table':
      return { header: false, ...child };
    case 'equation':
      return { display: false, numbered: false, ...child };
    case 'citation':
      return { style: 'numeric', ...child };
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
  }
}

/** A page's stored content as the editor's `Doc`. */
export function toEditorDoc(content: DocumentContentOutput): Doc {
  const doc: Doc = { blocks: editorBlocks(content.blocks ?? []) };
  if (content.name) doc.name = content.name;
  const sources = content.sources?.map(toEditorSource);
  if (sources?.length) doc.sources = sources;
  const style = citationStyle(content.citationStyle);
  if (style) doc.citationStyle = style;
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
  };
}
