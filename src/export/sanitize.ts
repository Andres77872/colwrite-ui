import { Tokenizer, TokenizerMode, type Token } from 'parse5';

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
/**
 * Elements whose content Python's `HTMLParser` (3.13) reads as text up to
 * their end tag: raw, or with character references decoded (`RCDATA`).
 * `plaintext` makes the rest of the input text.
 */
const RAWTEXT_ELEMENTS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes']);
const RCDATA_ELEMENTS = new Set(['textarea', 'title']);
/** The API's `MAX_ID_CHARS`, counted in characters as Python counts them. */
const MAX_CHILD_ID_CHARS = 200;
const MAX_TITLE_CHARS = 1000;

/** Python's `html.escape(value, quote=False)`. */
function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Python's `html.escape(value, quote=True)`. */
function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
}

/**
 * Whether any character is one Python's `str.isspace` counts, which is not
 * JavaScript's `\s`: the C0 separators U+001C–U+001F and U+0085 are, U+FEFF
 * is not.
 */
function hasPythonSpace(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code >= 0x1c && code <= 0x1f) || code === 0x85) return true;
    if (code !== 0xfeff && /\s/u.test(character)) return true;
  }
  return false;
}
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;

/**
 * A link target the API keeps, exactly as written, or `null`
 * (`_safe_href` in `ColWrite-api/src/documents/domain/validation.py`, with
 * Python's `urlsplit`): no whitespace, an http(s) scheme, a host, and no user
 * name or password. Unlike `safeHttpUrl` it never rewrites the URL: a page
 * holds the link as the server stores it.
 *
 * Where `urlsplit` raises (an unmatched `[` or `]` in the host, a host that
 * NFKC turns into a delimiter), the server refuses the whole page; here the
 * link is dropped instead.
 */
function safeHref(value: string | undefined): string | null {
  if (!value || hasPythonSpace(value)) return null;
  // `urlsplit` strips leading C0 controls and spaces.
  let start = 0;
  while (start < value.length && value.charCodeAt(start) <= 0x20) start += 1;
  let rest = value.slice(start);
  let scheme = '';
  const colon = rest.indexOf(':');
  if (colon > 0 && SCHEME.test(rest.slice(0, colon))) {
    scheme = rest.slice(0, colon).toLowerCase();
    rest = rest.slice(colon + 1);
  }
  if (scheme !== 'http' && scheme !== 'https') return null;
  if (!rest.startsWith('//')) return null;
  const ends = ['/', '?', '#'].map((delimiter) => rest.indexOf(delimiter, 2)).filter((at) => at >= 0);
  const netloc = rest.slice(2, ends.length > 0 ? Math.min(...ends) : rest.length);
  if (!netloc) return null;
  if (netloc.includes('[') !== netloc.includes(']')) return null;
  if (Array.from(netloc).some((character) => (character.codePointAt(0) ?? 0) > 0x7f)) {
    const bare = netloc.replace(/[@:#?]/g, '');
    const folded = bare.normalize('NFKC');
    if (folded !== bare && /[/?#@:]/.test(folded)) return null;
  }
  const at = netloc.lastIndexOf('@');
  if (at !== -1) {
    const userinfo = netloc.slice(0, at);
    const split = userinfo.indexOf(':');
    const username = split === -1 ? userinfo : userinfo.slice(0, split);
    const password = split === -1 ? null : userinfo.slice(split + 1);
    if (username || password) return null;
  }
  return value;
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

/**
 * A drawn diagram, accepted into an export only if it still looks like
 * Mermaid's strict-mode output.
 *
 * Mermaid already runs its SVG through DOMPurify, and the exported page's CSP
 * forbids scripts; this is the third line, and it fails closed — anything
 * that is not a lone `<svg>` or that carries a script, an event handler or a
 * `javascript:` URL is dropped, and the export prints the source instead.
 */
export function safeDiagramSvg(svg: string | undefined): string | null {
  if (!svg) return null;
  const trimmed = svg.trim();
  if (!/^<svg\b/i.test(trimmed) || !/<\/svg>$/i.test(trimmed)) return null;
  if (/<\s*(?:script|iframe|object|embed)\b/i.test(trimmed)) return null;
  // Inside a tag only: a label reading "online = true" or "javascript: the
  // good parts" is text between tags and must not reject the drawing.
  if (/<[^>]*\son[a-z]+\s*=/i.test(trimmed)) return null;
  if (/<[^>]*=\s*["']?\s*(?:java|vb)script\s*:/i.test(trimmed)) return null;
  return trimmed;
}

type PlaceholderMode = 'marker' | 'preserve' | 'drop';

/**
 * Render a fragment into the safe subset the API stores, exactly as the API
 * does: a port of `_CanonicalInlineHTMLParser` in
 * `ColWrite-api/src/documents/domain/validation.py`, method for method, on
 * parse5's tokenizer, which reads markup as Python's `HTMLParser` does. Tags
 * nest as written (no HTML tree is built, so nothing is re-nested), `div`,
 * `p` and `h1`–`h6` become `<span class="legacy-block">`, and the result is
 * the html the server would store for the same input. What the server stores
 * comes back unchanged, so loading and saving a page sends what it holds.
 *
 * Where the editor differs, it is lenient where the server refuses the whole
 * page: an invalid placeholder id, a link `urlsplit` cannot parse. The
 * placeholder modes are the editor's own (`preserve` is the server's form).
 * Two differences come from the tokenizer and stay: a repeated attribute
 * keeps its first value (Python's the last), and a carriage return is read
 * as a line feed. A browser's DOM, which every editor path serializes from,
 * holds neither.
 */
function renderSanitized(input: string, mode: PlaceholderMode): SanitizedFragment {
  const parts: string[] = [];
  const placeholderIds: string[] = [];
  const open: Array<{ source: string; rendered: string }> = [];
  const dropping: string[] = [];
  let placeholderDepth = 0;
  /** What ends the placeholder being skipped: its closing tag, or nothing. */
  let placeholderEnd = '';

  const attributes = (attrs: readonly Token.Attribute[]) =>
    new Map(attrs.map((attribute) => [attribute.name.toLowerCase(), attribute.value]));

  const startTag = (tag: string, attrs: readonly Token.Attribute[]): void => {
    if (dropping.length > 0) {
      dropping.push(tag);
      return;
    }
    if (placeholderDepth > 0) {
      if (tag === 'span') placeholderDepth += 1;
      return;
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      dropping.push(tag);
      return;
    }

    const attrsOf = attributes(attrs);
    if (tag === 'span' && attrsOf.has('data-child-id')) {
      const childId = (attrsOf.get('data-child-id') ?? '').trim();
      placeholderDepth = 1;
      placeholderEnd = '';
      // The server refuses a page with such an id; a widget nothing names
      // is dropped here instead, with whatever it held.
      if (!childId || Array.from(childId).length > MAX_CHILD_ID_CHARS || mode === 'drop') return;
      if (mode === 'preserve') {
        // Without `contenteditable="false"` a loaded placeholder was
        // editable until its paragraph was next serialized, and text typed
        // into it was then silently erased.
        parts.push(`<span data-child-id="${escapeAttribute(childId)}" contenteditable="false">`);
        placeholderEnd = '</span>';
        return;
      }
      const index = placeholderIds.push(childId) - 1;
      parts.push(`\uE000${index}\uE001`);
      return;
    }

    // Unknown wrappers are unwrapped; one with no text (an image) is gone.
    if (!ALLOWED_TAGS.has(tag) && !LEGACY_BLOCKS.has(tag)) return;

    const legacy = LEGACY_BLOCKS.has(tag);
    const rendered = legacy ? 'span' : tag;
    let renderedAttrs = legacy ? ' class="legacy-block"' : '';
    if (tag === 'a') {
      const output: string[] = [];
      const href = safeHref(attrsOf.get('href'));
      if (href !== null) {
        output.push(`href="${escapeAttribute(href)}"`);
        output.push('rel="noopener noreferrer"');
      }
      const title = attrsOf.get('title');
      if (title) output.push(`title="${escapeAttribute(Array.from(title).slice(0, MAX_TITLE_CHARS).join(''))}"`);
      if (output.length > 0) renderedAttrs = ` ${output.join(' ')}`;
    } else if (tag === 'span' && attrsOf.get('class') === 'legacy-block') {
      // What the API wrote for block markup it flattened, kept as it is.
      renderedAttrs = ' class="legacy-block"';
    }

    parts.push(`<${rendered}${renderedAttrs}>`);
    if (!VOID_TAGS.has(tag)) open.push({ source: tag, rendered });
  };

  const startEndTag = (tag: string, attrs: readonly Token.Attribute[]): void => {
    if (tag === 'span' && attributes(attrs).has('data-child-id')) {
      startTag(tag, attrs);
      placeholderDepth = 0;
      parts.push(placeholderEnd);
      placeholderEnd = '';
      return;
    }
    startTag(tag, attrs);
    const top = open.at(-1);
    if (!VOID_TAGS.has(tag) && top?.source === tag) {
      open.pop();
      parts.push(`</${top.rendered}>`);
    }
  };

  const endTag = (tag: string): void => {
    if (dropping.length > 0) {
      // Close through the matching dropped tag, so nothing it held escapes.
      if (dropping.includes(tag)) {
        while (dropping.length > 0) {
          if (dropping.pop() === tag) break;
        }
      }
      return;
    }
    if (placeholderDepth > 0) {
      if (tag === 'span') {
        placeholderDepth -= 1;
        if (placeholderDepth === 0) {
          parts.push(placeholderEnd);
          placeholderEnd = '';
        }
      }
      return;
    }
    if (!open.some((entry) => entry.source === tag)) return;
    while (open.length > 0) {
      const entry = open.pop();
      if (!entry) break;
      parts.push(`</${entry.rendered}>`);
      if (entry.source === tag) break;
    }
  };

  const text = (data: string): void => {
    if (dropping.length > 0 || placeholderDepth > 0) return;
    // Reserve the private-use marker characters so authored text cannot
    // synthesize one of the export's internal placeholders.
    parts.push(escapeText(data.replace(/[\uE000\uE001]/g, '\uFFFD')));
  };

  const onCharacter = (token: Token.CharacterToken) => text(token.chars);
  const tokenizer: Tokenizer = new Tokenizer({ sourceCodeLocationInfo: false }, {
    onStartTag: (token) => {
      if (token.selfClosing) {
        startEndTag(token.tagName, token.attrs);
        return;
      }
      startTag(token.tagName, token.attrs);
      // As Python's parser switches, whatever the tag's fate.
      if (RAWTEXT_ELEMENTS.has(token.tagName)) tokenizer.state = TokenizerMode.RAWTEXT;
      else if (RCDATA_ELEMENTS.has(token.tagName)) tokenizer.state = TokenizerMode.RCDATA;
      else if (token.tagName === 'plaintext') tokenizer.state = TokenizerMode.PLAINTEXT;
    },
    onEndTag: (token) => endTag(token.tagName),
    onCharacter,
    onWhitespaceCharacter: onCharacter,
    // The API refuses NUL outright; here it is left out.
    onNullCharacter: (token) => text(token.chars.replaceAll('\u0000', '')),
    onComment: () => {},
    onDoctype: () => {},
    onEof: () => {},
  });
  tokenizer.write(input, true);

  if (placeholderDepth > 0) {
    placeholderDepth = 0;
    parts.push(placeholderEnd);
  }
  while (open.length > 0) {
    const entry = open.pop();
    if (entry) parts.push(`</${entry.rendered}>`);
  }
  return { html: parts.join(''), placeholderIds };
}

/**
 * Sanitize authored inline HTML and replace child portals with inert internal
 * markers. The parser accepts both quote styles and attribute orders; stale
 * React portal internals are discarded with the placeholder node's children.
 */
export function sanitizeInlineFragment(input: string): SanitizedFragment {
  return renderSanitized(input, 'marker');
}

export type EditableSanitizeOptions = {
  /**
   * Widget placeholder spans travel with copied text but their `children`
   * entries do not, so a pasted placeholder would sit in the html forever as
   * an empty ghost. Paste therefore drops them; stored or agent-authored
   * document html must preserve them or the widgets vanish on load.
   */
  placeholders?: 'preserve' | 'drop';
};

/**
 * Sanitize block html at the editor-state boundary. Every path that writes
 * foreign markup into the document model — server loads, restores, JSON
 * import, agent tool ops, paste — goes through here, so no path into editor
 * state carries active markup (`onerror`, `javascript:` URLs, iframes…).
 * `Editable` renders state via `innerHTML`, which makes this the one gate
 * that matters.
 */
export function sanitizeEditableHtml(input: string, options?: EditableSanitizeOptions): string {
  return renderSanitized(input, options?.placeholders === 'drop' ? 'drop' : 'preserve').html;
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
