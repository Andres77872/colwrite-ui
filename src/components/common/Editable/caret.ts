/**
 * Caret geometry and text-offset helpers for the per-block contenteditables.
 *
 * Offsets count characters of text content — the same unit `restoreCaretOffset`
 * places the caret by — so a value captured in one block can be restored in
 * another after a merge or a remount.
 */

/** Caret position as a character offset over the element's text content. */
export function captureCaretOffset(el: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/** Restore the caret from a character offset, clamped to the content. */
export function restoreCaretOffset(el: HTMLElement, offset: number): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (remaining <= node.data.length) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
    remaining -= node.data.length;
    node = walker.nextNode() as Text | null;
  }
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Text between the start of the element and the caret. */
export function textBeforeCaret(el: HTMLElement): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString();
}

/** Delete everything between the start of the element and the caret. */
export function deleteBeforeCaret(el: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  pre.deleteContents();
  const caret = document.createRange();
  caret.setStart(el, 0);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
}

/**
 * Whether an editable holds nothing an author put there.
 *
 * `:empty` is not enough: browsers leave a `<br>` (or `<div><br></div>`)
 * behind when the last character is deleted, and the placeholder never came
 * back. A widget placeholder counts as content — it has no text but is not
 * empty.
 */
export function isEditableEmpty(el: HTMLElement): boolean {
  if (el.querySelector('[data-child-id]')) return false;
  return (el.textContent ?? '').replace(/\u200b/g, '') === '';
}

function caretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
  const rect = rects && rects.length > 0 ? rects[0] : range.getBoundingClientRect?.();
  if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0)) return null;
  return rect as DOMRect;
}

function lineHeightOf(el: HTMLElement): number {
  const value = parseFloat(window.getComputedStyle(el).lineHeight);
  return Number.isFinite(value) && value > 0 ? value : 24;
}

/**
 * Where the caret sits among the element's visual lines.
 *
 * Up and Down should leave a block from its first and last *line*, not only
 * from its first and last character, or a long paragraph traps the caret.
 * Geometry is unavailable in some states (an empty line, jsdom); callers then
 * fall back to the character-offset check.
 */
export function caretLineInfo(el: HTMLElement): { onFirstLine: boolean; onLastLine: boolean; x: number } | null {
  const rect = caretRect();
  if (!rect) return null;
  const box = el.getBoundingClientRect();
  if (box.height === 0) return null;
  const line = lineHeightOf(el);
  return {
    onFirstLine: rect.top - box.top < line * 0.8,
    onLastLine: box.bottom - rect.bottom < line * 0.8,
    x: rect.left,
  };
}

type CaretPositionDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/**
 * Put the caret in `el` on its first or last line, as close as possible to
 * the horizontal position `x` — the column the author was on in the block
 * they left. Falls back to the start or end of the block.
 */
export function placeCaretAtLine(el: HTMLElement, line: 'first' | 'last', x: number | null): void {
  const box = el.getBoundingClientRect();
  if (x !== null && box.height > 0) {
    const half = lineHeightOf(el) / 2;
    const y = line === 'first' ? box.top + half : box.bottom - half;
    const doc = document as CaretPositionDocument;
    let range: Range | null = null;
    if (typeof doc.caretPositionFromPoint === 'function') {
      const position = doc.caretPositionFromPoint(x, y);
      if (position && el.contains(position.offsetNode)) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
      }
    } else if (typeof doc.caretRangeFromPoint === 'function') {
      const found = doc.caretRangeFromPoint(x, y);
      if (found && el.contains(found.startContainer)) range = found;
    }
    if (range) {
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
  }
  restoreCaretOffset(el, line === 'first' ? 0 : Number.MAX_SAFE_INTEGER);
}
