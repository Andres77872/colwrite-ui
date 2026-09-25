/** A link that opens this document scrolled to this block (`#block-<id>`). */
export function blockLink(blockId: string): string {
  const url = new URL(window.location.href);
  url.hash = `block-${blockId}`;
  return url.toString();
}
