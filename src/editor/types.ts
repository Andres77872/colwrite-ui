// Inline child components that can live inside a paragraph's HTML
export type AiBeatChild = {
  id: string;
  type: 'aiBeat';
  message: string;
  prompt: string;
  output: string;
  collapsed?: boolean;
};

export type TableChild = {
  id: string;
  type: 'table';
  rows: number;
  cols: number;
  data: string[][]; // rows x cols
  header?: boolean; // first row as header
};

export type CitationChild = {
  id: string;
  type: 'citation';
  keys: string[];                    // citation keys/DOIs/arXiv IDs
  style?: 'numeric' | 'author-year' | 'ieee';
  prefix?: string;                   // e.g., 'see', 'cf.'
  suffix?: string;                   // e.g., 'ch. 2', 'pp. 21–24'
  locator?: string;                  // page/section locator
};

export type EquationChild = {
  id: string;
  type: 'equation';
  latex: string;               // LaTeX math without $ delimiters
  numbered?: boolean;          // reserved; false by default for inline
  labelId?: string;            // optional anchor for cross-references
};

export type ParagraphChild = AiBeatChild | TableChild | CitationChild | EquationChild;

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
