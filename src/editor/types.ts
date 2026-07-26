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
};

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

export type ParagraphBlock = { id: string; type: 'paragraph'; html: string; children?: ParagraphChild[]; columns?: number } & BlockMeta;
export type HeadingBlock = { id: string; type: 'heading'; level: 1 | 2 | 3; html: string } & BlockMeta;
export type DividerBlock = { id: string; type: 'divider' } & BlockMeta;

export type Block = ParagraphBlock | HeadingBlock | DividerBlock;
export type BlockType = Block['type'];
export type Doc = { version: number; blocks: Block[]; name?: string };

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

export type ToolAction = {
  tool: string;
  toolCallId: string;
  actions: ToolOperation[];
  documentId: string;
  version: number;
  /**
   * `proposed` — staged for the author to accept in the editor; storage is
   * unchanged and `version` is still the stored one. This is the default the
   * server runs in.
   * `applied` — already committed server-side, so the client replays it.
   */
  status: 'proposed' | 'applied' | 'skipped' | 'error';
  message?: string;
};
