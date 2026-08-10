/**
 * Remove React-rendered inline-widget internals before persisting editable
 * markup. Only the placeholder spans belong in the document model.
 */
export function clearChildPlaceholders(clone: HTMLElement): void {
  clone.querySelectorAll('[data-child-id]').forEach((element) => {
    const placeholder = element as HTMLElement;
    placeholder.setAttribute('contenteditable', 'false');
    while (placeholder.firstChild) placeholder.removeChild(placeholder.firstChild);
  });
}

/**
 * Persist as if no AI suggestion were pending.
 *
 * The floating toolbar builds its suggestion UI — struck-through original,
 * streaming text, ✓/✕/■ buttons — as raw DOM inside the contenteditable, so
 * serializing while a suggestion is live stored the buttons in the document.
 * Until the author accepts, the committed text is the original. Same rule as
 * the toolbar's own persist, kept here because every keystroke elsewhere in
 * the paragraph serializes through this function.
 */
function clearAiSuggestions(clone: HTMLElement): void {
  clone.querySelectorAll('.ai-suggest').forEach((node) => {
    const original = node.querySelector('.ai-original');
    node.replaceWith(...Array.from(original?.childNodes ?? []));
  });
}

export function serializeEditableHtml(root: HTMLDivElement): string {
  const clone = root.cloneNode(true) as HTMLDivElement;
  clearChildPlaceholders(clone);
  clearAiSuggestions(clone);
  return clone.innerHTML;
}
