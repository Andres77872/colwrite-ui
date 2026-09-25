import type { Block } from '@/editor/types';
import { coerceBlock } from '@/editor/docOps';
import { uid } from '@/lib/uid';
import { htmlToBlocks, looksLikeMarkdownBlocks, markdownToBlocks } from '@/editor/markdown';
import { serializeEditableHtml } from './editableHtml';
import { isEditableEmpty, restoreCaretOffset } from './caret';

/** Clipboard flavour carrying blocks verbatim within ColWrite (see useBlockSelection). */
export const BLOCKS_MIME = 'application/x-colwrite-blocks';

/** Blocks copied from ColWrite itself, widgets and citations intact. */
function copiedBlocks(json: string): Block[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => coerceBlock({ ...(value as object), id: uid() }))
      .filter((block): block is Block => block !== null)
      .map(withFreshChildIds);
  } catch {
    return [];
  }
}

/**
 * Block and widget ids are unique across a whole document, and a copy is
 * pasted beside its original: every widget gets a new id (placeholders
 * rewritten) and an equation's cross-reference label is dropped.
 */
function withFreshChildIds(block: Block): Block {
  if (block.type !== 'paragraph' || !block.children?.length) return block;
  let html = block.html;
  const children = block.children.map((child) => {
    const id = uid();
    html = html.split(`data-child-id="${child.id}"`).join(`data-child-id="${id}"`);
    const next = { ...child, id };
    if (next.type === 'equation') delete next.labelId;
    return next;
  });
  return { ...block, html, children };
}

type PasteContext = {
  el: HTMLDivElement;
  blockId: string;
  html: string;
  text: string;
  /** The ColWrite blocks flavour, when the copy came from this editor. */
  blocksJson?: string;
  getBlock: (id: string) => Block | undefined;
  splitBlock: (id: string, beforeHtml: string, afterHtml: string) => string;
  insertBlocksAfter: (
    afterId: string | null,
    blocks: readonly Block[],
    options?: { replaceAnchor?: boolean },
  ) => string[];
  commit: (el: HTMLDivElement) => string;
  focusLater: (id: string, place: (el: HTMLElement) => void) => void;
};

/**
 * Paste clipboard content as blocks when it has block structure.
 *
 * Returns false — leaving the caller to paste inline — for anything that is
 * really one run of text: a phrase, a sentence, a single line. Otherwise the
 * block is split at the caret, the pasted blocks go between the halves, and
 * a blank line that was pasted into is replaced rather than left behind.
 */
export function pasteAsBlocks(context: PasteContext): boolean {
  const { el, blockId, html, text } = context;
  const block = context.getBlock(blockId);
  // Headings hold one line of text and no widgets; code has its own paste.
  if (!block || block.type !== 'paragraph') return false;

  let blocks: Block[] = copiedBlocks(context.blocksJson ?? '');
  if (blocks.length === 0 && html) blocks = htmlToBlocks(html);
  if (blocks.length === 0 && text && looksLikeMarkdownBlocks(text)) blocks = markdownToBlocks(text);
  if (blocks.length === 0) return false;
  if (blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].variant && !(blocks[0].children ?? []).length) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) range.deleteContents();

  const afterRange = document.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.setEnd(el, el.childNodes.length);
  const holder = document.createElement('div');
  holder.appendChild(afterRange.extractContents());
  const beforeEmpty = isEditableEmpty(el);
  const afterEmpty = isEditableEmpty(holder);

  if (!afterEmpty) {
    const beforeHtml = serializeEditableHtml(el);
    el.setAttribute('data-serialized', beforeHtml);
    context.splitBlock(blockId, beforeHtml, serializeEditableHtml(holder));
  } else {
    context.commit(el);
  }

  const ids = context.insertBlocksAfter(blockId, blocks, { replaceAnchor: beforeEmpty });
  const last = ids[ids.length - 1];
  if (last) context.focusLater(last, (target) => restoreCaretOffset(target, Number.MAX_SAFE_INTEGER));
  return true;
}
