/**
 * Put the document caret straight after an inline widget, the way Notion
 * leaves you after closing an inline equation: the next keystroke continues
 * the sentence instead of landing on the chip (or nowhere).
 *
 * `from` is any element inside the widget (its trigger). Returns false when
 * there is no editable text to return to — a locked block, a widget rendered
 * outside a paragraph — so the caller can fall back to the trigger.
 */
export function placeCaretAfterWidget(from: HTMLElement | null): boolean {
  const widget = from?.closest<HTMLElement>('[data-child-id]');
  const editable = widget?.parentElement?.closest<HTMLElement>('[contenteditable="true"]');
  if (!widget || !editable || !widget.isConnected) return false;
  editable.focus({ preventScroll: true });
  const range = document.createRange();
  const next = widget.nextSibling;
  if (next && next.nodeType === Node.TEXT_NODE) {
    const text = next.textContent ?? '';
    // The trailing spacer `insertInlineChild` writes is the gap after the
    // widget; land beyond it so the next word is not glued on. Mid-sentence,
    // land immediately after the widget.
    const isTrailingSpacer = text.trim() === '' && !next.nextSibling;
    range.setStart(next, isTrailingSpacer ? text.length : 0);
  } else {
    range.setStartAfter(widget);
  }
  range.collapse(true);
  const selection = document.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
