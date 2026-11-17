import { parseFragment } from 'parse5';

/* ----------------------------------------
   What the citation processor prints, as data

   citeproc-js writes html: `<i>`, `<b>`, `<sup>`, `<sub>`, spans for small
   capitals and upright or regular type inside italics or bold, links for a
   DOI or URL, and `<div>`s around each reference. Its text comes from the
   records, which come from outside services, so nothing it writes reaches a
   page as html. It is read into this closed tree, and each renderer (React,
   the html export, plain text) writes the tree its own way.
   ---------------------------------------- */

export type CslMark = 'i' | 'b' | 'sup' | 'sub' | 'smallcaps' | 'upright' | 'regular' | 'underline';
export type CslNode =
  | string
  | { mark: CslMark; children: CslNode[] }
  | { link: string; children: CslNode[] };
export type CslMarkup = readonly CslNode[];

type HtmlNode = {
  nodeName: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
};

const TAG_MARKS: Record<string, CslMark> = { i: 'i', em: 'i', b: 'b', strong: 'b', sup: 'sup', sub: 'sub', u: 'underline' };

function attr(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((entry) => entry.name === name)?.value;
}

/** Only an http(s) link survives; anything else is its text. */
export function safeLink(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function spanMark(style: string): CslMark | null {
  const css = style.replace(/\s+/g, '').toLowerCase();
  if (css.includes('font-variant:small-caps')) return 'smallcaps';
  if (css.includes('font-style:normal')) return 'upright';
  if (css.includes('font-weight:normal')) return 'regular';
  if (css.includes('text-decoration:underline')) return 'underline';
  return null;
}

function convert(nodes: readonly HtmlNode[] | undefined): CslNode[] {
  const out: CslNode[] = [];
  const push = (node: CslNode) => {
    const last = out.at(-1);
    if (typeof node === 'string' && typeof last === 'string') out[out.length - 1] = last + node;
    else if (node !== '') out.push(node);
  };
  for (const node of nodes ?? []) {
    if (node.nodeName === '#text') {
      push(node.value ?? '');
      continue;
    }
    const children = convert(node.childNodes);
    const tag = node.nodeName.toLowerCase();
    let mark: CslMark | null = TAG_MARKS[tag] ?? null;
    if (tag === 'span') mark = spanMark(attr(node, 'style') ?? '');
    if (tag === 'a') {
      const link = safeLink(attr(node, 'href'));
      if (link) {
        out.push({ link, children });
        continue;
      }
    }
    if (mark) out.push({ mark, children });
    else for (const child of children) push(child);
  }
  return out;
}

/** citeproc's html as the closed tree. */
export function parseCslHtml(html: string): CslNode[] {
  return convert((parseFragment(html) as unknown as HtmlNode).childNodes);
}

/** The divs of one reference: its margin label (`[1]`, `1.`) and its body. */
export function parseCslEntry(html: string): { marker: string | null; body: CslNode[] } {
  const root = (parseFragment(html.trim()) as unknown as HtmlNode).childNodes ?? [];
  const entry = root.find((node) => node.nodeName === 'div') ?? { nodeName: 'div', childNodes: root };
  const divs = (entry.childNodes ?? []).filter((node) => node.nodeName === 'div');
  const margin = divs.find((node) => attr(node, 'class')?.includes('csl-left-margin'));
  const inline = divs.find((node) => attr(node, 'class')?.includes('csl-right-inline'));
  if (margin && inline) {
    return { marker: markupText(convert(margin.childNodes)).trim() || null, body: trim(convert(inline.childNodes)) };
  }
  return { marker: null, body: trim(convert(entry.childNodes)) };
}

/** Whitespace citeproc indents its divs with, off both ends. */
function trim(nodes: CslNode[]): CslNode[] {
  const out = [...nodes];
  if (typeof out[0] === 'string') out[0] = out[0].trimStart();
  const last = out.length - 1;
  if (typeof out[last] === 'string') out[last] = (out[last] as string).trimEnd();
  return out.filter((node) => node !== '');
}

/** Whether the style printed a link (a DOI or URL) in the markup. */
export function markupHasLink(markup: CslMarkup): boolean {
  return markup.some((node) => typeof node !== 'string' && ('link' in node || markupHasLink(node.children)));
}

export function markupText(markup: CslMarkup): string {
  return markup.map((node) => (typeof node === 'string' ? node : markupText(node.children))).join('');
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const HTML_MARKS: Record<CslMark, [string, string]> = {
  i: ['<i>', '</i>'],
  b: ['<b>', '</b>'],
  sup: ['<sup>', '</sup>'],
  sub: ['<sub>', '</sub>'],
  smallcaps: ['<span style="font-variant:small-caps">', '</span>'],
  upright: ['<span style="font-style:normal">', '</span>'],
  regular: ['<span style="font-weight:normal">', '</span>'],
  underline: ['<u>', '</u>'],
};

/** The tree as html: every text escaped, only its own tags, links only to http(s). */
export function markupHtml(markup: CslMarkup, options: { links?: boolean } = {}): string {
  return markup
    .map((node) => {
      if (typeof node === 'string') return escapeHtml(node);
      const inner = markupHtml(node.children, options);
      if ('link' in node) {
        return options.links === false ? inner : `<a href="${escapeHtml(node.link)}" rel="noopener noreferrer">${inner}</a>`;
      }
      const [open, close] = HTML_MARKS[node.mark];
      return `${open}${inner}${close}`;
    })
    .join('');
}

/** The tree as Markdown: italics and bold kept, links as `<url>` text. */
export function markupMarkdown(markup: CslMarkup): string {
  return markup
    .map((node) => {
      if (typeof node === 'string') return node.replace(/([*_`\\[\]])/g, '\\$1');
      if ('link' in node) return markupText(node.children);
      const inner = markupMarkdown(node.children);
      if (node.mark === 'i') return inner.trim() ? `*${inner}*` : inner;
      if (node.mark === 'b') return inner.trim() ? `**${inner}**` : inner;
      if (node.mark === 'sup') return `^${inner}^`;
      if (node.mark === 'sub') return `~${inner}~`;
      return inner;
    })
    .join('');
}
