/** What a copy puts on the clipboard: always text, and rich text for editors that read it. */
export type ClipboardContent = { plain: string; html?: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Put text (and, when given, its rich-text form) on the clipboard.
 *
 * The async Clipboard API exists only in a secure context, so a plain-HTTP
 * page on the network (`http://<lan-ip>:<port>`) has none, and a browser can
 * refuse it besides. Either way the copy goes through the browser's copy
 * command, which still runs from a click. Resolves whether anything was
 * copied: what to say when nothing was is the caller's.
 */
export async function copyToClipboard({ plain, html }: ClipboardContent): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (html && clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return true;
    } catch {
      /* plain text next */
    }
  }
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(plain);
      return true;
    } catch {
      /* the copy command next */
    }
  }
  return copyWithCommand(plain, html);
}

/**
 * The copy command, fed from its own `copy` event so the rich text goes too.
 * Some browsers fire that event only with something selected, so the text is
 * selected in a field nobody sees, and the reader's focus and selection are
 * put back afterwards.
 */
function copyWithCommand(plain: string, html?: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;

  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', plain);
    if (html) event.clipboardData.setData('text/html', html);
    event.preventDefault();
    // The page's own copy handlers (whole-block selection) must not rewrite it.
    event.stopImmediatePropagation();
  };

  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
    : [];

  const field = document.createElement('textarea');
  field.value = plain;
  field.readOnly = true;
  field.tabIndex = -1;
  field.setAttribute('aria-hidden', 'true');
  Object.assign(field.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(field);

  window.addEventListener('copy', onCopy, true);
  try {
    field.focus({ preventScroll: true });
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    window.removeEventListener('copy', onCopy, true);
    field.remove();
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
    focused?.focus({ preventScroll: true });
  }
}
