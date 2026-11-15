import type { ChangeSetResponse, ToolActionData } from '@/api/schema';

// Inline child components that can live inside a paragraph's HTML
export type AiBeatChild = {
  id: string;
  type: 'aiBeat';
  message: string;
  prompt: string;
  output: string;
  collapsed?: boolean;
};

export type TableAlign = 'left' | 'center' | 'right';

export type TableChild = {
  id: string;
  type: 'table';
  rows: number;
  cols: number;
  data: string[][]; // rows x cols
  header?: boolean; // first row as header
  /** Per-column alignment; a missing entry means left. */
  align?: TableAlign[];
  /** Figure caption rendered under the table. */
  caption?: string;
};

/** Enough about a source to render a citation as something other than a key. */
export type CitationSource = {
  key: string;
  title?: string;
  authors?: string;
  year?: string;
  venue?: string;
  url?: string;
  /**
   * Where the metadata came from. `manual` is typed by the author and never
   * verified; every other value names the record it was copied from — a paper
   * index, the DOI registry (`crossref`), a page the assistant read (`web`),
   * or one of the author's PDFs (`resource`).
   */
  provider?: 'arxiv' | 'semantic_scholar' | 'crossref' | 'manual' | 'web' | 'resource';
  /** Stable identifier in the provider's own namespace. */
  providerId?: string;
  doi?: string;
  externalIds?: Record<string, string>;
  pdfUrl?: string;
  citationCount?: number;
  influentialCitationCount?: number;
  referenceCount?: number;
  isOpenAccess?: boolean;
  kind?: SourceKind;
  /** When a web page was read (ISO date) — what a web citation prints as "accessed". */
  accessed?: string;
};

export type SourceKind =
  | 'article'
  | 'preprint'
  | 'conference'
  | 'book'
  | 'chapter'
  | 'thesis'
  | 'report'
  | 'web'
  | 'dataset'
  | 'software'
  | 'other';

export type CitationChild = {
  id: string;
  type: 'citation';
  keys: string[];                    // citation keys/DOIs/arXiv IDs
  style?: 'numeric' | 'author-year' | 'ieee';
  prefix?: string;                   // e.g., 'see', 'cf.'
  suffix?: string;                   // e.g., 'ch. 2', 'pp. 21–24'
  locator?: string;                  // page/section locator
  /** Resolved bibliographic detail, keyed by entries in `keys`. */
  sources?: CitationSource[];
};

export type EquationChild = {
  id: string;
  type: 'equation';
  latex: string;               // LaTeX math without $ delimiters
  /** Render on its own centred line rather than in the run of text. */
  display?: boolean;
  numbered?: boolean;          // display equations only
  labelId?: string;            // optional anchor for cross-references
};

// Inline graph widget for small charts embedded in text
export type GraphChild = {
  id: string;
  type: 'graph';
  kind: 'bar' | 'line' | 'area' | 'pie';
  data: {
    values: number[];
    labels?: string[];
    colors?: string[];
  };
  title?: string;
  caption?: string;
  xLabel?: string;
  yLabel?: string;
};

export type ParagraphChild = AiBeatChild | TableChild | CitationChild | EquationChild | GraphChild;

// Common optional metadata for AI/UI behavior
type BlockMeta = {
  aiHidden?: boolean; // If true, hide this block from AI assistant
  locked?: boolean;   // If true, assistant should not modify this block
  collapsed?: boolean; // If true, collapse this block in the editor UI
};

/**
 * How a paragraph presents its text. Absent is plain body text.
 *
 * A role, not a separate block type: a list item or a quote is still prose
 * that can hold citations and equations, so every one of them keeps the
 * paragraph's html/children machinery and differs only in how it is drawn
 * and exported. Mirrors `ParagraphVariant` in the API's canonical model.
 */
export type ParagraphVariant = 'bullet' | 'numbered' | 'todo' | 'quote' | 'callout';

/** The name a page gets when it has none, here and on the server. Lists and exports show it. */
export const DEFAULT_DOCUMENT_TITLE = 'Untitled page';

/** Deepest list nesting the canonical model accepts (0 is top level). */
export const MAX_BLOCK_INDENT = 4;

export type ParagraphBlock = {
  id: string;
  type: 'paragraph';
  html: string;
  children?: ParagraphChild[];
  columns?: number;
  variant?: ParagraphVariant;
  /** To-do state. Only valid — and only ever sent — on `variant: 'todo'`. */
  checked?: boolean;
  /** Outline depth for list items. Omitted at the top level. */
  indent?: number;
} & BlockMeta;
export type HeadingBlock = { id: string; type: 'heading'; level: 1 | 2 | 3; html: string } & BlockMeta;
export type DividerBlock = { id: string; type: 'divider' } & BlockMeta;
/**
 * Preformatted text: source code, pseudocode, program output. `text` is plain
 * text, never html — whitespace is significant and nothing in it is markup.
 */
export type CodeBlock = { id: string; type: 'code'; text: string; language?: string } & BlockMeta;

export type Block = ParagraphBlock | HeadingBlock | DividerBlock | CodeBlock;
export type BlockType = Block['type'];
export type Doc = {
  blocks: Block[];
  name?: string;
  /**
   * The document's source library: every work it cites or keeps for later,
   * one entry per key. Its metadata wins over the copies citations carry.
   * Absent on documents that have none.
   */
  sources?: CitationSource[];
  /** The document's citation style; absent means "whatever its citations use". */
  citationStyle?: 'numeric' | 'author-year' | 'ieee';
};

// ── ToolAction types for agentic document tools (Phase 3) ──

export type ToolOperation =
  | { op: 'replace_block'; blockId: string; block: Record<string, unknown> }
  | { op: 'insert_block_after'; referenceId: string; block: Record<string, unknown> }
  | { op: 'insert_block_before'; referenceId: string; block: Record<string, unknown> }
  | { op: 'insert_block_at_start'; block: Record<string, unknown> }
  | { op: 'append_block'; block: Record<string, unknown> }
  | { op: 'delete_block'; blockId: string }
  | { op: 'reorder_block'; blockId: string; toIndex: number }
  | { op: 'update_meta'; meta: { name?: string } }
  | { op: 'create_document'; documentId: string };

/** Outcome of a single operation inside a `doc_edit` call. */
export type ToolOperationResult = {
  op: string;
  status: 'applied' | 'skipped' | 'error';
  message?: string;
};

/**
 * Who accepts a stored change set (D18): `review`, the author; `auto`, the
 * open editor at once, while the author has Auto on. The server decides it
 * per run.
 */
export type ApplyPolicy = ChangeSetResponse['apply_policy'];
/** Why a run that asked for Auto was given `review`. */
export type AutoBlockedReason = NonNullable<ChangeSetResponse['auto_blocked_reason']>;

export type ToolAction = {
  tool: string;
  toolCallId: string;
  actions: ToolOperation[];
  documentId: string;
  /**
   * `proposed` — a stored change set (`changeSetId`) for the author to
   * review; storage is unchanged.
   * `applied` — a page `doc_create` made, announced by its
   * `create_document` operation. `doc_edit` never commits by itself.
   */
  status: ToolActionData['status'];
  /** The stored set's policy; `null` when the action stores no set. */
  applyPolicy?: ApplyPolicy | null;
  autoBlockedReason?: AutoBlockedReason | null;
  message?: string;
  /**
   * Per-operation outcomes from the server. A batch can succeed overall while
   * individual operations are skipped or fail; without these the assistant
   * reported such a batch as a clean success.
   */
  operationResults?: ToolOperationResult[];
  /**
   * The change set a `proposed` action stored. The stream carries no
   * operations for it: they are read by this id, and each decision is
   * recorded against it.
   */
  changeSetId?: string | null;
  /** Operation count from the redacted proposal preview, for reporting. */
  proposalOperationCount?: number;
  /**
   * Where a page `doc_create` made lives: its source page's collection, or
   * `null` for the top level. The pages tree refreshes that branch.
   */
  collectionId?: number | null;
};
