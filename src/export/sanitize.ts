import { parseFragment } from 'parse5';

type ParseAttribute = { name: string; value: string };
type ParseNode = {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: ParseAttribute[];
  childNodes?: ParseNode[];
};

export type SanitizedFragment = {
  html: string;
  placeholderIds: string[];
};

const ALLOWED_TAGS = new Set([
  'a',
  'b',
  'br',
  'code',
  'del',
  'em',
  'i',
  'kbd',
  'mark',
  's',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'u',
]);
const DROP_WITH_CONTENT = new Set([
  'applet',
  'audio',
  'canvas',
  'embed',
  'form',
  'iframe',
  'math',
  'noscript',
  'object',
  'script',
  'style',
  'svg',
  'template',
  'video',
]);
const LEGACY_BLOCKS = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const VOID_TAGS = new Set(['br']);

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}

export function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function safeChartColors(colors: string[] | undefined): string[] | undefined {
  if (!colors) return undefined;
  const safe = colors.map((value) => {
    const color = value.trim();
    if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
    if (/^(?:rgb|hsl)a?\([\d.%+\-\s,]+\)$/i.test(color)) return color;
    return '';
  });
  return safe.some(Boolean) ? safe : undefined;
}

function attributes(node: ParseNode): Map<string, string> {
  return new Map((node.attrs ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
}

/**
 * Sanitize authored inline HTML and replace child portals with inert internal
 * markers. The parser accepts both quote styles and attribute orders; stale
 * React portal internals are discarded with the placeholder node's children.
 */
export function sanitizeInlineFragment(input: string): SanitizedFragment {
  const fragment = parseFragment(input) as unknown as ParseNode;
  const placeholderIds: string[] = [];

  const renderChildren = (node: ParseNode): string =>
    (node.childNodes ?? []).map(renderNode).join('');

  const renderNode = (node: ParseNode): string => {
    if (node.nodeName === '#text') {
      // Reserve the private-use marker characters so authored text cannot
      // synthesize one of the renderer's internal placeholders.
      return escapeText((node.value ?? '').replace(/[\uE000\uE001]/g, '\uFFFD'));
    }
    if (node.nodeName === '#comment' || node.nodeName === '#documentType') return '';

    const tag = (node.tagName ?? node.nodeName).toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) return '';

    if (LEGACY_BLOCKS.has(tag)) {
      return `<span class="legacy-block">${renderChildren(node)}</span>`;
    }

    if (!ALLOWED_TAGS.has(tag)) return renderChildren(node);

    const attrs = attributes(node);
    if (tag === 'span' && attrs.has('data-child-id')) {
      const childId = (attrs.get('data-child-id') ?? '').trim();
      if (!childId || childId.length > 128) return '';
      const index = placeholderIds.push(childId) - 1;
      return `\uE000${index}\uE001`;
    }

    const outputAttributes: string[] = [];
    if (tag === 'a') {
      const href = safeHttpUrl(attrs.get('href'));
      if (href) {
        outputAttributes.push(`href="${escapeAttribute(href)}"`);
        outputAttributes.push('rel="noopener noreferrer"');
      }
      const title = attrs.get('title');
      if (title) outputAttributes.push(`title="${escapeAttribute(title.slice(0, 1000))}"`);
    }

    const opening = outputAttributes.length
      ? `<${tag} ${outputAttributes.join(' ')}>`
      : `<${tag}>`;
    if (VOID_TAGS.has(tag)) return opening;
    return `${opening}${renderChildren(node)}</${tag}>`;
  };

  return {
    html: renderChildren(fragment),
    placeholderIds,
  };
}

export type MaterializedPart =
  | { kind: 'html'; html: string }
  | { kind: 'child'; childId: string };

export function materializedParts(fragment: SanitizedFragment): MaterializedPart[] {
  const parts: MaterializedPart[] = [];
  const marker = /\uE000(\d+)\uE001/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(fragment.html)) !== null) {
    if (match.index > cursor) {
      parts.push({ kind: 'html', html: fragment.html.slice(cursor, match.index) });
    }
    const index = Number(match[1]);
    const childId = fragment.placeholderIds[index];
    if (childId !== undefined) parts.push({ kind: 'child', childId });
    cursor = match.index + match[0].length;
  }
  if (cursor < fragment.html.length) {
    parts.push({ kind: 'html', html: fragment.html.slice(cursor) });
  }
  return parts;
}
