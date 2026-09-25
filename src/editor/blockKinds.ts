import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Lightbulb,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Shapes,
  TextQuote,
  Type,
  Workflow,
} from 'lucide-react';
import type { ElementType } from 'react';
import { MERMAID_LANGUAGE } from '@/lib/mermaid';
import { FIGURE_LANGUAGE } from '@/lib/figure/constants';
import { MAX_BLOCK_INDENT, type Block, type ParagraphVariant } from './types';

/**
 * What a block *is* from the author's point of view.
 *
 * The stored model has four block types, but a writer thinks in thirteen: a
 * bulleted item and a quote are both paragraphs underneath, a diagram is a
 * code block whose language is `mermaid`, and a structured figure one whose
 * language is `figure`. Every surface that
 * offers "make this a …" — Turn into, the slash menu, markdown shortcuts, the
 * gutter labels — speaks in kinds, and `convertBlock` maps a kind back onto
 * the canonical shape. One registry, so a new kind appears everywhere at once.
 */
export type BlockKindId =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'callout'
  | 'code'
  | 'diagram'
  | 'figure'
  | 'divider';

export type BlockKind = {
  id: BlockKindId;
  label: string;
  description: string;
  icon: ElementType;
  /** Extra words the command filters match. */
  keywords: readonly string[];
  /** What to type at the start of an empty line to get this kind. */
  markdown?: string;
};

export const BLOCK_KINDS: readonly BlockKind[] = [
  { id: 'text', label: 'Text', description: 'Plain body text', icon: Type, keywords: ['paragraph', 'body', 'plain', 'p'] },
  { id: 'h1', label: 'Heading 1', description: 'Top-level section', icon: Heading1, keywords: ['title', 'section', 'h1'], markdown: '#' },
  { id: 'h2', label: 'Heading 2', description: 'Section heading', icon: Heading2, keywords: ['subtitle', 'section', 'h2'], markdown: '##' },
  { id: 'h3', label: 'Heading 3', description: 'Subsection heading', icon: Heading3, keywords: ['subsection', 'h3'], markdown: '###' },
  { id: 'bullet', label: 'Bulleted list', description: 'A simple bulleted list', icon: List, keywords: ['ul', 'unordered', 'points', 'list'], markdown: '-' },
  { id: 'numbered', label: 'Numbered list', description: 'A list with numbering', icon: ListOrdered, keywords: ['ol', 'ordered', 'steps', 'list', 'enumerate'], markdown: '1.' },
  { id: 'todo', label: 'To-do list', description: 'Track tasks with a checkbox', icon: ListTodo, keywords: ['checkbox', 'task', 'check', 'todo'], markdown: '[]' },
  { id: 'quote', label: 'Quote', description: 'Capture a quotation', icon: TextQuote, keywords: ['blockquote', 'citation', 'excerpt'], markdown: '"' },
  { id: 'callout', label: 'Callout', description: 'Make a note stand out', icon: Lightbulb, keywords: ['note', 'info', 'warning', 'tip', 'box', 'aside'] },
  { id: 'code', label: 'Code', description: 'Code or preformatted text', icon: Code2, keywords: ['snippet', 'pre', 'monospace', 'algorithm', 'pseudocode'], markdown: '```' },
  { id: 'diagram', label: 'Diagram', description: 'Mermaid flowchart or sequence', icon: Workflow, keywords: ['mermaid', 'flowchart', 'sequence', 'uml', 'class', 'state', 'er', 'gantt', 'mindmap', 'timeline', 'pie', 'graph', 'chart'] },
  { id: 'figure', label: 'Figure', description: 'Architecture, mechanism or pipeline figure', icon: Shapes, keywords: ['figure', 'architecture', 'model', 'network', 'attention', 'transformer', 'layer', 'block', 'pipeline', 'workflow', 'tensor', 'panel', 'tikz', 'diagram', 'structure', 'illustration'] },
  { id: 'divider', label: 'Divider', description: 'Separate sections with a rule', icon: Minus, keywords: ['hr', 'rule', 'separator', 'line'], markdown: '---' },
] as const;

const KIND_BY_ID = new Map(BLOCK_KINDS.map((kind) => [kind.id, kind]));

export function blockKind(id: BlockKindId): BlockKind {
  return KIND_BY_ID.get(id) ?? BLOCK_KINDS[0];
}

/** Kinds a text block can be turned into in place. */
export const TURN_INTO_KINDS: readonly BlockKind[] = BLOCK_KINDS.filter((kind) => kind.id !== 'divider');

/**
 * Whether a block is a Mermaid diagram.
 *
 * Not a separate stored type: the canonical model's code block already holds
 * plain text with a language tag, which is exactly what a diagram's source
 * is. The API, the agent's `doc_edit`, markdown import/export and the LaTeX
 * export all carry it unchanged, and an editor that predates diagrams still
 * shows its source.
 */
// A plain boolean, not a type predicate: a predicate's false branch would
// narrow every code block out of the caller's union, diagram or not.
export function isDiagramBlock(block: Block | undefined): boolean {
  return block?.type === 'code' && block.language?.toLowerCase() === MERMAID_LANGUAGE;
}

/**
 * Whether a block is a structured figure: a JSON spec the editor lays out and
 * draws (`src/lib/figure`). Stored, like a diagram, as a plain code block, so
 * everything that carries code carries it unchanged.
 */
export function isFigureBlock(block: Block | undefined): boolean {
  return block?.type === 'code' && block.language?.toLowerCase() === FIGURE_LANGUAGE;
}

/**
 * Numbers for the captioned figures, by block id, in document order — what a
 * printed paper prints as "Figure 3". A figure without a caption is not
 * numbered, the way `figure` without `\caption` is not in LaTeX.
 */
export function figureNumbers(
  blocks: readonly Block[],
  captionOf: (source: string) => string | null,
): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const block of blocks) {
    if (block.type !== 'code' || !isFigureBlock(block)) continue;
    if (captionOf(block.text)) numbers.set(block.id, numbers.size + 1);
  }
  return numbers;
}

/** The kind of an existing block. */
export function kindOf(block: Block): BlockKindId {
  switch (block.type) {
    case 'heading':
      return block.level === 1 ? 'h1' : block.level === 3 ? 'h3' : 'h2';
    case 'divider':
      return 'divider';
    case 'code':
      return isDiagramBlock(block) ? 'diagram' : isFigureBlock(block) ? 'figure' : 'code';
    case 'paragraph':
      return block.variant ?? 'text';
  }
}

export function kindLabel(block: Block): string {
  return blockKind(kindOf(block)).label;
}

export function kindIcon(block: Block): ElementType {
  return blockKind(kindOf(block)).icon;
}

/** Whether a paragraph is an item of a list (bulleted, numbered or to-do). */
export function isListItem(block: Block | undefined): boolean {
  return (
    block?.type === 'paragraph' &&
    (block.variant === 'bullet' || block.variant === 'numbered' || block.variant === 'todo')
  );
}

const PARAGRAPH_VARIANTS: Record<string, ParagraphVariant | undefined> = {
  text: undefined,
  bullet: 'bullet',
  numbered: 'numbered',
  todo: 'todo',
  quote: 'quote',
  callout: 'callout',
};

const HEADING_LEVELS: Record<string, 1 | 2 | 3> = { h1: 1, h2: 2, h3: 3 };

const META_FIELDS = ['aiHidden', 'locked', 'collapsed'] as const;

function keepMeta(block: Block): Partial<Block> {
  const meta: Record<string, unknown> = {};
  for (const field of META_FIELDS) {
    if (block[field] !== undefined) meta[field] = block[field];
  }
  return meta as Partial<Block>;
}

/** Html-escape plain text for a contenteditable, keeping line breaks. */
export function textToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/**
 * Visible text of inline html, `<br>` as a newline and widget placeholders
 * skipped. Mirrors the API's `_html_to_plain_text`, so a conversion made here
 * and one the assistant makes produce the same text.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<span[^>]*data-child-id[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p)>\s*<(?:div|p)[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The block turned into `kind`, keeping its id, text and author flags.
 *
 * Only the fields the target type owns survive — the canonical model rejects
 * a heading that still carries a paragraph's `children`, and one stray field
 * fails the save of the whole document. Content crosses types the way the
 * API's `convert_block_type` carries it, so the author and the assistant get
 * the same result for the same conversion.
 */
export function convertBlock(block: Block, kind: BlockKindId): Block {
  const meta = keepMeta(block);
  const sourceHtml = block.type === 'paragraph' || block.type === 'heading' ? block.html : '';
  const sourceText = block.type === 'code' ? block.text : htmlToText(sourceHtml);

  if (kind === 'divider') return { ...meta, id: block.id, type: 'divider' };

  if (kind === 'diagram') {
    return { ...meta, id: block.id, type: 'code', text: sourceText, language: MERMAID_LANGUAGE };
  }

  if (kind === 'figure') {
    // Prose is not a spec, but it is usually a description of the figure:
    // it becomes the caption of an empty spec, which the block offers to
    // draw with the assistant — nothing the author wrote is lost.
    const prose = sourceText.trim();
    const text =
      block.type === 'code' ? block.text : prose ? JSON.stringify({ caption: prose, nodes: [] }, null, 2) : '';
    return { ...meta, id: block.id, type: 'code', text, language: FIGURE_LANGUAGE };
  }

  if (kind === 'code') {
    // A diagram or figure turned into code shows its source as plain text;
    // keeping the tag would leave it drawn.
    const language =
      block.type === 'code' && !isDiagramBlock(block) && !isFigureBlock(block) ? block.language : undefined;
    return {
      ...meta,
      id: block.id,
      type: 'code',
      text: sourceText,
      ...(language ? { language } : {}),
    };
  }

  const html = block.type === 'code' ? textToHtml(block.text) : sourceHtml;

  if (kind in HEADING_LEVELS) {
    // A heading renders no widgets, so a paragraph that holds some keeps its
    // words but not the widgets.
    const hasWidgets = block.type === 'paragraph' && (block.children ?? []).length > 0;
    return {
      ...meta,
      id: block.id,
      type: 'heading',
      level: HEADING_LEVELS[kind],
      html: hasWidgets ? textToHtml(htmlToText(html).replace(/\n/g, ' ')) : html,
    };
  }

  const variant = PARAGRAPH_VARIANTS[kind];
  const previous = block.type === 'paragraph' ? block : undefined;
  const next: Block = {
    ...meta,
    id: block.id,
    type: 'paragraph',
    html,
    children: previous?.children ?? [],
    columns: previous?.columns ?? 1,
  };
  if (variant) next.variant = variant;
  // Lists keep their depth when switching between list kinds; a quote or body
  // text is never indented.
  if (variant && variant !== 'quote' && variant !== 'callout' && previous?.indent) {
    next.indent = previous.indent;
  }
  if (variant === 'todo') next.checked = previous?.variant === 'todo' ? previous.checked === true : false;
  return next;
}

/** A new, empty block of `kind`. */
export function blankBlockOfKind(id: string, kind: BlockKindId): Block {
  return convertBlock({ id, type: 'paragraph', html: '', children: [], columns: 1 }, kind);
}

/**
 * The block that Enter creates after a list item or other block.
 *
 * A new line under a list item continues the list at the same depth — the
 * to-do starts unchecked — while any other block is followed by body text.
 */
export function continuationOf(block: Block, id: string, html: string): Block {
  if (block.type === 'paragraph' && isListItem(block)) {
    return {
      id,
      type: 'paragraph',
      html,
      children: [],
      columns: 1,
      variant: block.variant,
      ...(block.variant === 'todo' ? { checked: false } : {}),
      ...(block.indent ? { indent: block.indent } : {}),
    };
  }
  return { id, type: 'paragraph', html, children: [], columns: 1 };
}

export function clampIndent(value: number): number {
  return Math.max(0, Math.min(MAX_BLOCK_INDENT, Math.floor(value)));
}

/**
 * The markdown prefix that turns an empty line into a block kind.
 *
 * Checked when the author types a space: `#`, `-`, `1.`, `[]`, `>`, … at the
 * very start of a text block. Order matters — `###` must win over `#`.
 */
const MARKDOWN_PREFIXES: ReadonlyArray<[RegExp, BlockKindId]> = [
  [/^###$/, 'h3'],
  [/^##$/, 'h2'],
  [/^#$/, 'h1'],
  [/^[-*+•]$/, 'bullet'],
  [/^\d+[.)]$/, 'numbered'],
  [/^\[(?: |x|X)?\]$/, 'todo'],
  [/^(?:>|")$/, 'quote'],
  [/^!>$/, 'callout'],
];

export function markdownPrefixKind(prefix: string): BlockKindId | null {
  for (const [pattern, kind] of MARKDOWN_PREFIXES) {
    if (pattern.test(prefix)) return kind;
  }
  return null;
}

/**
 * Numbers for every numbered list item, by block id.
 *
 * A run of consecutive numbered items at one depth counts from 1; a deeper
 * item continues its parent run afterwards, the way an outline reads. Any
 * other block at the same or a shallower depth ends the run.
 */
export function listNumbers(blocks: readonly Block[]): Map<string, number> {
  const numbers = new Map<string, number>();
  // counters[depth] = the next number at that depth, or 0 when no run is open.
  const counters: number[] = [];
  for (const block of blocks) {
    if (!isListItem(block) || block.type !== 'paragraph') {
      counters.length = 0;
      continue;
    }
    const depth = block.indent ?? 0;
    // Returning to a shallower level closes every deeper run.
    counters.length = Math.min(counters.length, depth + 1);
    if (block.variant === 'numbered') {
      const next = (counters[depth] ?? 0) + 1;
      counters[depth] = next;
      numbers.set(block.id, next);
    } else {
      counters[depth] = 0;
    }
  }
  return numbers;
}

function toRoman(value: number): string {
  const numerals: Array<[number, string]> = [
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let rest = value;
  let out = '';
  for (const [amount, numeral] of numerals) {
    while (rest >= amount) { out += numeral; rest -= amount; }
  }
  return out;
}

function toLetters(value: number): string {
  let rest = value;
  let out = '';
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

/** `1.` at the top level, `a.` one level in, `i.` two levels in — then repeat. */
export function numberLabel(value: number, depth: number): string {
  const style = depth % 3;
  if (style === 1) return `${toLetters(value)}.`;
  if (style === 2) return `${toRoman(value)}.`;
  return `${value}.`;
}
