/**
 * Turn what someone typed or pasted into the link field into an href.
 *
 * The field used to store its text verbatim, so `arxiv.org/abs/2101.03961`
 * became a relative link that resolved against the app's own origin — broken
 * in the page and in every export. A bare host or path gets `https://`; an
 * email address gets `mailto:`; `#section` anchors and the web, mail and
 * phone schemes pass through; anything else that names a scheme
 * (`javascript:`, `data:`, `file:` …) is refused rather than stored.
 */
export type LinkHref = { ok: true; href: string } | { ok: false; reason: string };

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const EMAIL = /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/;
const DOMAIN = /^([\p{L}\p{N}-]+\.)+[\p{L}]{2,}$/u;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** `scheme:` — but not `host:8080`, where the colon starts a port. */
const SCHEME = /^([a-z][a-z0-9+.-]*):(?!\d)/i;

export function normalizeHref(raw: string): LinkHref {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter a link.' };
  if (/\s/.test(value)) return { ok: false, reason: 'A link cannot contain spaces.' };

  if (value.startsWith('#')) return { ok: true, href: value };

  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  if (scheme) {
    if (!ALLOWED_SCHEMES.has(scheme)) {
      return { ok: false, reason: `${scheme}: links are not allowed.` };
    }
    if ((scheme === 'http' || scheme === 'https') && !/^https?:\/\/[^/]/i.test(value)) {
      return { ok: false, reason: 'Enter a full web address, like example.com.' };
    }
    return { ok: true, href: value };
  }

  if (value.startsWith('//')) return { ok: true, href: `https:${value}` };
  if (EMAIL.test(value)) return { ok: true, href: `mailto:${value}` };

  // A host — a domain name with a top-level part, an IPv4 address or
  // localhost, optionally with a port — before any path, query or fragment.
  const host = value.split(/[/?#]/, 1)[0].replace(/:\d+$/, '');
  if (DOMAIN.test(host) || IPV4.test(host) || /^localhost$/i.test(host)) {
    return { ok: true, href: `https://${value}` };
  }
  return { ok: false, reason: 'Enter a web address, like example.com.' };
}

/** What a link card shows: the site (or address) and the full target. */
export function describeHref(href: string): {
  kind: 'web' | 'mail' | 'phone' | 'anchor';
  title: string;
  url: string;
} {
  if (href.startsWith('#')) return { kind: 'anchor', title: 'Link in this page', url: href };
  if (/^mailto:/i.test(href)) {
    const address = href.slice('mailto:'.length).split('?')[0];
    return { kind: 'mail', title: decodeURIComponent(address), url: href };
  }
  if (/^tel:/i.test(href)) return { kind: 'phone', title: href.slice('tel:'.length), url: href };
  try {
    const url = new URL(href);
    return { kind: 'web', title: url.hostname.replace(/^www\./, ''), url: url.href };
  } catch {
    return { kind: 'web', title: href, url: href };
  }
}

/** Asks the selection toolbar to open its link field on the next selection. */
export const EDIT_LINK_EVENT = 'colwrite:edit-link';

/** Open a link the way a browser would in a new tab, never with an opener. */
export function openLinkInNewTab(href: string) {
  if (href.startsWith('#')) {
    document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' });
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}
