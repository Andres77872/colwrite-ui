/**
 * Select characters [start, end) of a plain-text contenteditable and bring
 * them into view — how a problem or a clicked node takes the author to the
 * JSON that defines it.
 *
 * Offsets count text content, the same unit the figure parser's ranges use
 * (the editable holds the block's text verbatim).
 */
export function selectSourceRange(el: HTMLElement, start: number, end: number): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const length = node.data.length;
    if (!startNode && start <= offset + length) {
      startNode = node;
      startOffset = Math.max(0, start - offset);
    }
    if (startNode && end <= offset + length) {
      endNode = node;
      endOffset = Math.max(0, end - offset);
      break;
    }
    offset += length;
  }
  el.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  if (startNode && endNode) {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);

  // Scroll the editable (it scrolls on its own past a max height) so the
  // selection sits a third of the way down, then the page if needed.
  const box = el.getBoundingClientRect();
  const rect = range.getBoundingClientRect();
  if (rect.height > 0 && (rect.top < box.top || rect.bottom > box.bottom)) {
    el.scrollTop += rect.top - box.top - box.height / 3;
  }
  el.scrollIntoView?.({ block: 'nearest' });
}
