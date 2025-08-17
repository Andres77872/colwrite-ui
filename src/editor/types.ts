// Inline child components that can live inside a paragraph's HTML
export type AiBeatChild = {
  id: string;
  type: 'aiBeat';
  message: string;
  prompt: string;
  output: string;
  collapsed?: boolean;
};

export type ParagraphChild = AiBeatChild; // future: union of more child types

export type ParagraphBlock = { id: string; type: 'paragraph'; html: string; children?: ParagraphChild[] };
export type HeadingBlock = { id: string; type: 'heading'; level: 1 | 2 | 3; html: string };
export type TodoBlock = { id: string; type: 'todo'; checked: boolean; html: string };
export type DividerBlock = { id: string; type: 'divider' };

export type Block = ParagraphBlock | HeadingBlock | TodoBlock | DividerBlock;
export type BlockType = Block['type'];
export type Doc = { version: number; blocks: Block[] };
