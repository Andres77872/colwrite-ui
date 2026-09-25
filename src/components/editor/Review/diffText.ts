import type { Block, ParagraphChild } from '@/editor/types';
import { buildBibliography, type Bibliography, type BibliographyOptions } from '@/editor/citations';

/**
 * Diffable text for a block, with its inline widgets kept as widgets.
 *
 * `blockText()` flattens every equation and citation to a short stand-in
 * (`[ref]`, the latex), which is fine for a one-line summary and useless in a
 * diff: the author could not see what was being removed. Here each widget
 * becomes one private-use token, so the word diff treats it as a word and the
 * renderer can draw it as the page does.
 *
 * Tokens are keyed by what the widget says (the latex, the cited keys), not by
 * its id: a rewrite returns fresh ids for the same equation, and matching by id
 * would show every unchanged equation as deleted and re-added.
 */

const OPEN = '\uE000';
const CLOSE = '\uE001';
/**
 * Word boundary around a token that is not a visible space. `\s` matches
 * U+FEFF, so the tokenizer splits on it, while the renderer drops it: a
 * citation glued to a word ("compute[1].") stays glued instead of gaining a
 * stray space on each side.
 */
const JOIN = '\uFEFF';

export const WIDGET_TOKEN = /\uE000(\d+)\uE001/;
const WIDGET_SPLIT = /(\uE000\d+\uE001)/;

export type WidgetTable = {
  widgets: ParagraphChild[];
  bySignature: Map<string, number>;
};

export function createWidgetTable(): WidgetTable {
  return { widgets: [], bySignature: new Map() };
}

function signature(child: ParagraphChild): string {
  switch (child.type) {
    case 'equation':
      return `eq:${child.latex.trim()}`;
    case 'citation':
      return `cite:${[...(child.keys ?? [])].map((key) => key.trim().toLowerCase()).sort().join(',')}`;
    default:
      return `${child.type}:${child.id}`;
  }
}

function tokenFor(table: WidgetTable, child: ParagraphChild): string {
  const sig = signature(child);
  let index = table.bySignature.get(sig);
  if (index === undefined) {
    index = table.widgets.length;
    table.widgets.push(child);
    table.bySignature.set(sig, index);
  }
  return `${JOIN}${OPEN}${index}${CLOSE}${JOIN}`;
}

/** Plain text of a block for diffing, widgets as tokens registered in `table`. */
export function diffableText(block: Block | null | undefined, table: WidgetTable): string {
  if (block?.type === 'code') return block.text.trim();
  if (!block || !('html' in block)) return '';
  const children = block.type === 'paragraph' ? block.children ?? [] : [];
  const byId = new Map(children.map((child) => [child.id, child]));
  return block.html
    .replace(/<span[^>]*data-child-id=["']([^"']*)["'][^>]*><\/span>/g, (_match, id: string) => {
      const child = byId.get(id);
      return child ? tokenFor(table, child) : ' ';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export type DiffPiece = { kind: 'text'; text: string } | { kind: 'widget'; child: ParagraphChild };

/** A diff segment's value, split back into text and the widgets it carries. */
export function diffPieces(value: string, table: WidgetTable): DiffPiece[] {
  const pieces: DiffPiece[] = [];
  for (const part of value.split(WIDGET_SPLIT)) {
    if (!part) continue;
    const match = WIDGET_TOKEN.exec(part);
    const child = match ? table.widgets[Number(match[1])] : undefined;
    if (child) {
      pieces.push({ kind: 'widget', child });
      continue;
    }
    const text = part.split(JOIN).join('');
    if (text) pieces.push({ kind: 'text', text });
  }
  return pieces;
}

/** Whether a segment value ends or starts with visible whitespace. */
export function edgeIsSpace(value: string, edge: 'start' | 'end'): boolean {
  const text = value.split(JOIN).join('');
  if (!text) return true;
  return /\s/.test(edge === 'start' ? text[0] : text[text.length - 1]);
}

/* ----------------------------------------
   Numbering citations a preview introduces
   ---------------------------------------- */

/** Where the preview goes: in place of some blocks, or after one (null: the top). */
type Placement = { replace: string[] } | { after: string | null };

function hasCitation(blocks: ReadonlyArray<Block | null>): boolean {
  return blocks.some(
    (block) => block?.type === 'paragraph' && (block.children ?? []).some((child) => child.type === 'citation'),
  );
}

/**
 * The bibliography as it would be with `preview` in the document.
 *
 * A citation the assistant adds is not numbered yet, so the page's own
 * bibliography prints it as "[?]", while the same citation once inserted reads
 * "[1]". Numbering the preview in place is what makes it read as the page.
 * Returns null when the preview cites nothing, so callers fall back to the
 * document's bibliography without a rebuild.
 */
export function previewBibliography(
  blocks: readonly Block[],
  preview: ReadonlyArray<Block | null>,
  placement: Placement,
  options: BibliographyOptions,
): Bibliography | null {
  const added = preview.filter((block): block is Block => block !== null);
  if (!hasCitation(added)) return null;
  let next: Block[];
  if ('replace' in placement) {
    const first = blocks.findIndex((block) => placement.replace.includes(block.id));
    const kept = blocks.filter((block) => !placement.replace.includes(block.id));
    const at = first === -1 ? kept.length : first;
    next = [...kept.slice(0, at), ...added, ...kept.slice(at)];
  } else {
    const index = placement.after === null ? -1 : blocks.findIndex((block) => block.id === placement.after);
    const at = placement.after !== null && index === -1 ? blocks.length : index + 1;
    next = [...blocks.slice(0, at), ...added, ...blocks.slice(at)];
  }
  return buildBibliography(next, options);
}
