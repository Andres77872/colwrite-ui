/**
 * The one shareable link to a page: this app's address with only `?doc=`.
 * Whatever else the current URL carries (a settings view, a block anchor)
 * is left out.
 */
export function pageLink(documentId: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('doc', documentId);
  return url.toString();
}

/**
 * The page a link points to, when it is one of this app's page links (this
 * origin, with `?doc=`): a link pasted into a page opens that page where it
 * lives, not by loading the app again. Anything else is `null`.
 */
export function pageIdOf(href: string): string | null {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    const id = url.searchParams.get('doc');
    return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
