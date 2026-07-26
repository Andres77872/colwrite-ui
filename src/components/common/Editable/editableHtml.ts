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

export function serializeEditableHtml(root: HTMLDivElement): string {
  const clone = root.cloneNode(true) as HTMLDivElement;
  clearChildPlaceholders(clone);
  return clone.innerHTML;
}
