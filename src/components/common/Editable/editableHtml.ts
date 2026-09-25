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

/** Marks the whitespace after a block-level figure, hidden while it renders. */
export const FIGURE_GAP_ATTR = 'data-figure-gap';

/**
 * Hide the whitespace that directly follows a block-level figure.
 *
 * A paragraph from the API reads "… Table [figure] compares …": the space
 * after the figure is real text, and the editable's `white-space: pre-wrap`
 * rendered it as a visible indent at the start of the line under the
 * figure. It is wrapped, not removed, so text offsets and the serialized
 * html stay exactly as they were; `serializeEditableHtml` unwraps it.
 */
export function hideFigureGaps(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-child-id]').forEach((placeholder) => {
    if (!placeholder.querySelector(':scope > .inline-figure')) return;
    const next = placeholder.nextSibling;
    if (!next || next.nodeType !== Node.TEXT_NODE) return;
    const text = next as Text;
    if (!/^[ \u00a0]/.test(text.data)) return;
    if (text.data.length > 1) text.splitText(1);
    const gap = document.createElement('span');
    gap.setAttribute(FIGURE_GAP_ATTR, '');
    gap.setAttribute('contenteditable', 'false');
    text.replaceWith(gap);
    gap.appendChild(text);
  });
}

/**
 * Whether the block opens with a figure (nothing but whitespace before it).
 * The figure's top margin is then dropped, so the block handle lines up with
 * the table's top edge rather than floating over an empty first line.
 */
export function startsWithFigure(root: HTMLElement): boolean {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node as Text).data.trim() === '') continue;
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as HTMLElement;
    return element.hasAttribute('data-child-id') && Boolean(element.querySelector(':scope > .inline-figure'));
  }
  return false;
}

function unwrapFigureGaps(root: HTMLElement): void {
  root.querySelectorAll(`[${FIGURE_GAP_ATTR}]`).forEach((gap) => {
    gap.replaceWith(document.createTextNode(gap.textContent ?? ''));
  });
}

export function serializeEditableHtml(root: HTMLDivElement): string {
  const clone = root.cloneNode(true) as HTMLDivElement;
  clearChildPlaceholders(clone);
  unwrapFigureGaps(clone);
  clone.normalize();
  return clone.innerHTML;
}

/**
 * `html` as `serializeEditableHtml` would write it back: parsed by the
 * browser (attribute quoting, entities) with empty placeholders. Two strings
 * that normalize alike render the same document text.
 */
export function normalizeEditableHtml(html: string): string {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return serializeEditableHtml(holder);
}
