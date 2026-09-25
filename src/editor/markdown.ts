import { uid } from '@/lib/uid';
import { safeHttpUrl, sanitizeEditableHtml } from '@/export/sanitize';
import { listNumbers } from './blockKinds';
import type {
  Block,
  CitationChild,
  EquationChild,
  ParagraphBlock,
  ParagraphChild,
  TableAlign,
  TableChild,
} from './types';
import { MAX_BLOCK_INDENT } from './types';

/**
 * Markdown and pasted html ↔ ColWrite blocks.
 *
 * Three jobs share this module: pasting structured text (a markdown list,
 * paragraphs copied from a web page) as blocks rather than one paragraph of
 * line breaks; inserting an assistant answer — which the model writes in
 * markdown — into the document as real headings, lists, tables and
 * equations; and copying blocks out as markdown. The mapping is the same in
 * both directions, so a round trip keeps its shape.
 *
 * Math uses the forms models and papers actually write: `$…$`, `\(…\)`,
 * `$$…$$` and `\[…\]`. Tables are GitHub pipe tables. Both become the
 * editor's own widgets, not text that looks like them.
 */

// ── Inline markdown → html ────────────────────────────────────────────────

const PROTECT_OPEN = '\uE010';
const PROTECT_CLOSE = '\uE011';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function placeholder(id: string): string {
  return `<span data-child-id="${id}" contenteditable="false"></span>`;
}

export type InlineConversion = { html: string; children: ParagraphChild[] };

export type MarkdownOptions = {
  /**
   * Citations that may be written back as widgets, by key. A `[@key]` marker
   * becomes a citation only when every key in it is here — the citations the
   * text carried when it was sent to the model. A key the model made up stays
   * visible text: an invented reference must never look like a real one.
   */
  citations?: ReadonlyMap<string, CitationChild>;
};

const CITATION_MARKER_RE = /\[([^[\]\n]*?@[^[\]\n]+?)\]/g;

function citationFromMarker(
  body: string,
  known: ReadonlyMap<string, CitationChild>,
): CitationChild | null {
  const keys = Array.from(body.matchAll(/@([^\s;,\]]+)/g), (match) => match[1]);
  if (keys.length === 0 || keys.some((key) => !known.has(key))) return null;
  const first = known.get(keys[0])!;
  const sources = keys.flatMap((key) =>
    (known.get(key)?.sources ?? []).filter((source) => source.key === key),
  );
  const prefix = body.slice(0, body.indexOf('@')).trim();
  const tail = body.slice(body.lastIndexOf('@')).replace(/^@[^\s;,\]]+/, '').replace(/^[,\s]+/, '').trim();
  return {
    id: uid(),
    type: 'citation',
    keys,
    ...(first.style ? { style: first.style } : {}),
    ...(prefix ? { prefix } : {}),
    ...(tail ? { locator: tail } : {}),
    ...(sources.length ? { sources } : {}),
  };
}

/** Every citation child in `blocks`, by key — the lookup `MarkdownOptions` takes. */
export function citationLookup(blocks: readonly Block[]): Map<string, CitationChild> {
  const lookup = new Map<string, CitationChild>();
  for (const block of blocks) {
    if (block.type !== 'paragraph') continue;
    for (const child of block.children ?? []) {
      if (child.type !== 'citation') continue;
      for (const key of child.keys) if (!lookup.has(key)) lookup.set(key, child);
    }
  }
  return lookup;
}

/**
 * Inline markdown as editor html. With `math`, `$x$` and `\(x\)` become
 * inline equation widgets; without it (headings, which hold no widgets) the
 * dollar signs stay as text.
 */
export function inlineMarkdownToHtml(
  text: string,
  options: { math?: boolean } & MarkdownOptions = {},
): InlineConversion {
  const protectedParts: string[] = [];
  const children: ParagraphChild[] = [];
  const protect = (html: string) => `${PROTECT_OPEN}${protectedParts.push(html) - 1}${PROTECT_CLOSE}`;

  let working = text.replace(/[\uE010\uE011]/g, '');
  // Code spans first: nothing inside them is markdown.
  working = working.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _ticks, body: string) =>
    protect(`<code>${escapeHtml(body.trim())}</code>`),
  );
  if (options.citations && options.citations.size > 0) {
    const known = options.citations;
    working = working.replace(CITATION_MARKER_RE, (marker, body: string) => {
      const child = citationFromMarker(body, known);
      if (!child) return marker;
      children.push(child);
      return protect(placeholder(child.id));
    });
  }
  if (options.math) {
    const equation = (latex: string) => {
      const id = uid();
      const child: EquationChild = { id, type: 'equation', latex: latex.trim() };
      children.push(child);
      return protect(placeholder(id));
    };
    working = working.replace(/\\\(([\s\S]+?)\\\)/g, (_m, latex: string) => equation(latex));
    // `$5 and $10` is money, not maths: no space just inside the dollars and
    // no digit straight after the closing one.
    working = working.replace(/(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\d$])/g, (_m, latex: string) =>
      equation(latex),
    );
  }

  let html = escapeHtml(working);
  html = html.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label: string, href: string) => {
    const safe = safeHttpUrl(href.replace(/&amp;/g, '&'));
    return safe ? `<a href="${safe.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${label}</a>` : match;
  });
  html = html.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
  html = html.replace(/(?<![*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, '<em>$1</em>');
  html = html.replace(/(?<![_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, '<em>$1</em>');
  html = html.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>');
  html = html.replace(new RegExp(`${PROTECT_OPEN}(\\d+)${PROTECT_CLOSE}`, 'g'), (_m, index: string) => protectedParts[Number(index)] ?? '');
  return { html, children };
}

// ── Block markdown → blocks ───────────────────────────────────────────────

function paragraph(html: string, children: ParagraphChild[] = [], role: Partial<ParagraphBlock> = {}): ParagraphBlock {
  return { id: uid(), type: 'paragraph', html, children, columns: 1, ...role };
}

let activeOptions: MarkdownOptions = {};

function inlineParagraph(text: string, role: Partial<ParagraphBlock> = {}): ParagraphBlock {
  const { html, children } = inlineMarkdownToHtml(text, { math: true, ...activeOptions });
  return paragraph(html, children, role);
}

function displayEquation(latex: string): ParagraphBlock {
  const id = uid();
  return paragraph(placeholder(id), [{ id, type: 'equation', latex: latex.trim(), display: true }]);
}

const FENCE_RE = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_RE = /^(\s*)([-*+•]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const CALLOUT_RE = /^\[!(note|tip|important|warning|caution|info)\]\s*(.*)$/i;
const LANGUAGE_RE = /^[A-Za-z0-9][A-Za-z0-9+#._-]{0,39}$/;

function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function tableBlock(lines: string[]): ParagraphBlock {
  const header = splitTableRow(lines[0]);
  const alignRow = splitTableRow(lines[1]);
  const body = lines.slice(2).map(splitTableRow);
  const cols = Math.max(header.length, ...body.map((row) => row.length));
  const pad = (row: string[]) => Array.from({ length: cols }, (_, index) => row[index] ?? '');
  const align: TableAlign[] = Array.from({ length: cols }, (_, index) => {
    const spec = alignRow[index] ?? '';
    if (spec.startsWith(':') && spec.endsWith(':')) return 'center';
    if (spec.endsWith(':')) return 'right';
    return 'left';
  });
  const data = [pad(header), ...body.map(pad)].map((row) =>
    row.map((cell) => cell.replace(/\*\*|__|`/g, '')),
  );
  const id = uid();
  const table: TableChild = {
    id,
    type: 'table',
    rows: data.length,
    cols,
    data,
    header: true,
    ...(align.some((value) => value !== 'left') ? { align } : {}),
  };
  return paragraph(placeholder(id), [table]);
}

function isBlockStart(line: string, next: string | undefined): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    RULE_RE.test(line) ||
    LIST_RE.test(line) ||
    QUOTE_RE.test(line) ||
    /^\s*(\$\$|\\\[)/.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_SEPARATOR_RE.test(next))
  );
}

/** Blocks for a markdown document. Always returns at least one block for non-blank input. */
export function markdownToBlocks(markdown: string, options: MarkdownOptions = {}): Block[] {
  const previous = activeOptions;
  activeOptions = options;
  try {
    return parseMarkdownBlocks(markdown);
  } finally {
    activeOptions = previous;
  }
}

function parseMarkdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  // Leading-space widths of the open list levels, outermost first.
  let listIndents: number[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const next = lines[index + 1];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(marker)) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      const language = fence[2] && LANGUAGE_RE.test(fence[2]) ? fence[2] : undefined;
      blocks.push({ id: uid(), type: 'code', text: body.join('\n'), ...(language ? { language } : {}) });
      listIndents = [];
      continue;
    }

    const display = /^\s*(\$\$|\\\[)(.*)$/.exec(line);
    if (display) {
      const close = display[1] === '$$' ? '$$' : '\\]';
      let rest = display[2];
      const body: string[] = [];
      if (rest.trimEnd().endsWith(close) && rest.trim().length >= close.length) {
        body.push(rest.trimEnd().slice(0, -close.length));
        index += 1;
      } else {
        if (rest.trim()) body.push(rest);
        index += 1;
        while (index < lines.length) {
          rest = lines[index];
          index += 1;
          if (rest.trimEnd().endsWith(close)) {
            body.push(rest.trimEnd().slice(0, -close.length));
            break;
          }
          body.push(rest);
        }
      }
      const latex = body.join('\n').trim();
      if (latex) blocks.push(displayEquation(latex));
      listIndents = [];
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ id: uid(), type: 'heading', level, html: inlineMarkdownToHtml(heading[2]).html });
      listIndents = [];
      index += 1;
      continue;
    }

    // Checked before list items: `- - -` is a rule, not a nested bullet.
    if (RULE_RE.test(line)) {
      blocks.push({ id: uid(), type: 'divider' });
      listIndents = [];
      index += 1;
      continue;
    }

    if (line.includes('|') && next !== undefined && TABLE_SEPARATOR_RE.test(next)) {
      const rows = [line, next];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(lines[index]);
        index += 1;
      }
      blocks.push(tableBlock(rows));
      listIndents = [];
      continue;
    }

    const item = LIST_RE.exec(line);
    if (item) {
      const lead = item[1].replace(/\t/g, '    ').length;
      while (listIndents.length > 0 && listIndents[listIndents.length - 1] > lead) listIndents.pop();
      if (listIndents.length === 0 || listIndents[listIndents.length - 1] < lead) listIndents.push(lead);
      const depth = Math.min(MAX_BLOCK_INDENT, listIndents.length - 1);
      let text = item[3];
      // Lazy continuation lines belong to the item.
      index += 1;
      while (
        index < lines.length &&
        lines[index].trim() &&
        !isBlockStart(lines[index], lines[index + 1]) &&
        /^\s+/.test(lines[index])
      ) {
        text += ` ${lines[index].trim()}`;
        index += 1;
      }
      const todo = /^\[( |x|X)\]\s+(.*)$/.exec(text);
      const numbered = /\d/.test(item[2]);
      const role: Partial<ParagraphBlock> = todo
        ? { variant: 'todo', checked: todo[1].toLowerCase() === 'x' }
        : { variant: numbered ? 'numbered' : 'bullet' };
      if (depth > 0) role.indent = depth;
      blocks.push(inlineParagraph(todo ? todo[2] : text, role));
      continue;
    }
    listIndents = [];

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      const group: string[] = [];
      while (index < lines.length) {
        const match = QUOTE_RE.exec(lines[index]);
        if (!match) break;
        group.push(match[1]);
        index += 1;
      }
      const callout = CALLOUT_RE.exec(group[0]?.trim() ?? '');
      const body = callout ? [callout[2], ...group.slice(1)] : group;
      // Blank quote lines separate paragraphs of the quotation.
      const paragraphs: string[][] = [[]];
      for (const part of body) {
        if (!part.trim()) paragraphs.push([]);
        else paragraphs[paragraphs.length - 1].push(part.trim());
      }
      for (const lines_ of paragraphs.filter((p) => p.length > 0)) {
        blocks.push(inlineParagraph(lines_.join(' '), { variant: callout ? 'callout' : 'quote' }));
      }
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    const text: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index], lines[index + 1])) {
      text.push(lines[index].trim());
      index += 1;
    }
    blocks.push(inlineParagraph(text.join(' ')));
  }

  return blocks;
}

/**
 * Whether plain text has enough structure to paste as blocks: more than one
 * paragraph, or a line that starts a list, heading, quote, fence or table.
 */
export function looksLikeMarkdownBlocks(text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nonEmpty = lines.filter((line) => line.trim());
  if (nonEmpty.length === 0) return false;
  if (lines.some((line, index) => isBlockStart(line, lines[index + 1]))) return true;
  return /\n\s*\n/.test(text.trim());
}

// ── Pasted html → blocks ──────────────────────────────────────────────────

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li',
  'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
]);

function hasBlockChildren(element: Element): boolean {
  return Array.from(element.children).some((child) => BLOCK_TAGS.has(child.tagName.toLowerCase()));
}

function inlineHtml(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('ul, ol, input').forEach((node) => node.remove());
  return sanitizeEditableHtml(clone.innerHTML, { placeholders: 'drop' })
    .replace(/<\/?(?:div|p|h[1-6])>/g, '')
    .trim();
}

/**
 * Blocks for pasted html (a web page, Google Docs, Word, another editor).
 * Returns an empty array when the html is only inline content — a phrase
 * copied out of one paragraph — which pastes into the current block instead.
 */
export function htmlToBlocks(html: string): Block[] {
  if (typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: Block[] = [];
  let structural = false;

  const walkList = (list: Element, depth: number) => {
    structural = true;
    const numbered = list.tagName.toLowerCase() === 'ol';
    for (const li of Array.from(list.children)) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      const checkbox = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]') as HTMLInputElement | null;
      const role: Partial<ParagraphBlock> = checkbox
        ? { variant: 'todo', checked: checkbox.checked || checkbox.hasAttribute('checked') }
        : { variant: numbered ? 'numbered' : 'bullet' };
      if (depth > 0) role.indent = Math.min(MAX_BLOCK_INDENT, depth);
      blocks.push(paragraph(inlineHtml(li), [], role));
      for (const nested of Array.from(li.querySelectorAll(':scope > ul, :scope > ol'))) {
        walkList(nested, depth + 1);
      }
    }
  };

  const walk = (element: Element) => {
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text) blocks.push(paragraph(sanitizeEditableHtml(escapeHtml(text))));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const child = node as Element;
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        structural = true;
        const level = Math.min(3, Number(tag[1])) as 1 | 2 | 3;
        blocks.push({ id: uid(), type: 'heading', level, html: inlineHtml(child) });
      } else if (tag === 'ul' || tag === 'ol') {
        walkList(child, 0);
      } else if (tag === 'blockquote') {
        structural = true;
        const parts = hasBlockChildren(child) ? Array.from(child.children) : [child];
        for (const part of parts) {
          const inner = inlineHtml(part);
          if (inner) blocks.push(paragraph(inner, [], { variant: 'quote' }));
        }
      } else if (tag === 'pre') {
        structural = true;
        // The language rides on `<code class="language-x">` (ours, and most
        // renderers') or GitHub's `<pre lang="x">`.
        const named =
          child.getAttribute('lang') ??
          /(?:^|\s)language-(\S+)/.exec(child.querySelector('code')?.className ?? '')?.[1];
        const language = named && LANGUAGE_RE.test(named) ? named : undefined;
        blocks.push({ id: uid(), type: 'code', text: child.textContent ?? '', ...(language ? { language } : {}) });
      } else if (tag === 'hr') {
        structural = true;
        blocks.push({ id: uid(), type: 'divider' });
      } else if (tag === 'table') {
        structural = true;
        const rows = Array.from(child.querySelectorAll('tr')).map((tr) =>
          Array.from(tr.children).map((cell) => (cell.textContent ?? '').trim()),
        );
        const cols = Math.max(0, ...rows.map((row) => row.length));
        if (rows.length > 0 && cols > 0) {
          const id = uid();
          const data = rows.map((row) => Array.from({ length: cols }, (_, i) => row[i] ?? ''));
          const header = child.querySelector('th') !== null;
          blocks.push(paragraph(placeholder(id), [{ id, type: 'table', rows: data.length, cols, data, header }]));
        }
      } else if (BLOCK_TAGS.has(tag) || hasBlockChildren(child)) {
        if (hasBlockChildren(child)) {
          walk(child);
        } else {
          if (tag === 'p') structural = true;
          const inner = inlineHtml(child);
          if (inner) blocks.push(paragraph(inner));
        }
      } else {
        // Inline run directly in a container: gather consecutive inline
        // siblings into one paragraph.
        const inner = sanitizeEditableHtml(child.outerHTML, { placeholders: 'drop' });
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'paragraph' && !last.variant && last.id === lastInlineId) {
          last.html += inner;
        } else {
          const block = paragraph(inner);
          lastInlineId = block.id;
          blocks.push(block);
        }
        continue;
      }
      lastInlineId = null;
    }
  };
  let lastInlineId: string | null = null;

  walk(doc.body);
  const meaningful = blocks.filter((block) => block.type !== 'paragraph' || block.html.replace(/<[^>]*>/g, '').trim() || (block.children ?? []).length);
  if (!structural || meaningful.length < 2) return [];
  return meaningful;
}

// ── Blocks → markdown ─────────────────────────────────────────────────────

function citationMarkdown(child: CitationChild): string {
  const keys = child.keys.map((key) => `@${key}`).join('; ');
  const locator = child.locator ? `, ${child.locator}` : '';
  const prefix = child.prefix ? `${child.prefix} ` : '';
  return `[${prefix}${keys}${locator}]`;
}

function tableMarkdown(table: TableChild): string {
  const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const rows = table.data.map((row) => `| ${row.map(cell).join(' | ')} |`);
  const align = Array.from({ length: table.cols }, (_, index) => {
    const value = table.align?.[index];
    return value === 'center' ? ':---:' : value === 'right' ? '---:' : '---';
  });
  const separator = `| ${align.join(' | ')} |`;
  if (table.header !== false && rows.length > 0) return [rows[0], separator, ...rows.slice(1)].join('\n');
  return [`| ${Array.from({ length: table.cols }, () => ' ').join(' | ')} |`, separator, ...rows].join('\n');
}

/** Markdown for a paragraph's inline html and widgets. */
export function inlineHtmlToMarkdown(html: string, children: readonly ParagraphChild[] = []): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, '');
  const byId = new Map(children.map((child) => [child.id, child]));
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

  const render = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    const inner = () => Array.from(element.childNodes).map(render).join('');
    const childId = element.getAttribute('data-child-id');
    if (childId) {
      const child = byId.get(childId);
      if (!child) return '';
      switch (child.type) {
        case 'equation':
          return child.display ? `\n\n$$\n${child.latex}\n$$\n\n` : `$${child.latex}$`;
        case 'citation':
          return citationMarkdown(child);
        case 'table':
          return `\n\n${tableMarkdown(child)}\n\n`;
        case 'graph':
          return `*[Figure${child.title ? `: ${child.title}` : ''}]*`;
        case 'aiBeat':
          return child.output ?? '';
      }
    }
    switch (tag) {
      case 'strong':
      case 'b':
        return `**${inner()}**`;
      case 'em':
      case 'i':
        return `*${inner()}*`;
      case 'code':
        return `\`${inner()}\``;
      case 's':
      case 'del':
      case 'strike':
        return `~~${inner()}~~`;
      case 'a': {
        const href = element.getAttribute('href');
        return href ? `[${inner()}](${href})` : inner();
      }
      case 'br':
        return '\n';
      case 'div':
      case 'p':
        return `\n${inner()}`;
      default:
        return inner();
    }
  };

  return Array.from(doc.body.childNodes).map(render).join('').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
}

/** Markdown for a list of blocks, numbering numbered lists the way the canvas does. */
export function blocksToMarkdown(blocks: readonly Block[]): string {
  const numbers = listNumbers(blocks);
  const parts: string[] = [];
  let previousWasItem = false;

  for (const block of blocks) {
    let text: string;
    let isItem = false;
    switch (block.type) {
      case 'heading':
        text = `${'#'.repeat(block.level)} ${inlineHtmlToMarkdown(block.html)}`;
        break;
      case 'divider':
        text = '---';
        break;
      case 'code':
        text = `\`\`\`${block.language ?? ''}\n${block.text}\n\`\`\``;
        break;
      case 'paragraph': {
        const body = inlineHtmlToMarkdown(block.html, block.children ?? []);
        const pad = '  '.repeat(block.indent ?? 0);
        switch (block.variant) {
          case 'bullet':
            text = `${pad}- ${body}`;
            isItem = true;
            break;
          case 'numbered':
            text = `${pad}${numbers.get(block.id) ?? 1}. ${body}`;
            isItem = true;
            break;
          case 'todo':
            text = `${pad}- [${block.checked ? 'x' : ' '}] ${body}`;
            isItem = true;
            break;
          case 'quote':
            text = body.split('\n').map((line) => `> ${line}`).join('\n');
            break;
          case 'callout':
            text = `> [!NOTE]\n${body.split('\n').map((line) => `> ${line}`).join('\n')}`;
            break;
          default:
            text = body;
        }
        break;
      }
    }
    parts.push(parts.length === 0 ? text : isItem && previousWasItem ? `\n${text}` : `\n\n${text}`);
    previousWasItem = isItem;
  }
  return parts.join('');
}

/** Plain text of blocks, one block per line — for the plain-text clipboard flavour. */
export function blocksToPlainText(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'code') return block.text;
      if (block.type === 'divider') return '';
      return inlineHtmlToMarkdown(block.html, block.type === 'paragraph' ? block.children ?? [] : [])
        .replace(/\*\*|~~|`/g, '')
        .replace(/(?<!\w)\*(?!\s)|(?<!\s)\*(?!\w)/g, '');
    })
    .join('\n');
}

// ── Blocks → semantic html (clipboard flavour for rich editors) ───────────

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline html with widgets written out as text, for pasting elsewhere. */
function portableInline(block: ParagraphBlock | { html: string; children?: undefined }): string {
  const children = block.children ?? [];
  const byId = new Map(children.map((child) => [child.id, child]));
  return sanitizeEditableHtml(block.html, { placeholders: 'preserve' }).replace(
    /<span data-child-id="([^"]+)"[^>]*><\/span>/g,
    (_m, id: string) => {
      const child = byId.get(id);
      if (!child) return '';
      switch (child.type) {
        case 'equation':
          return escapeText(child.display ? `$$${child.latex}$$` : `$${child.latex}$`);
        case 'citation':
          return escapeText(citationMarkdown(child));
        case 'table':
          return `<table>${child.data
            .map((row, index) => `<tr>${row
              .map((cell) => (index === 0 && child.header !== false ? `<th>${escapeText(cell)}</th>` : `<td>${escapeText(cell)}</td>`))
              .join('')}</tr>`)
            .join('')}</table>`;
        case 'graph':
          return escapeText(`[Figure${child.title ? `: ${child.title}` : ''}]`);
        case 'aiBeat':
          return escapeText(child.output ?? '');
      }
    },
  );
}

/**
 * Semantic html for blocks: headings, nested lists, quotes, code. What a
 * word processor or another editor expects on the clipboard.
 */
export function blocksToHtml(blocks: readonly Block[]): string {
  const out: string[] = [];
  // Open list tags, outermost first.
  const open: string[] = [];
  const closeTo = (depth: number) => {
    while (open.length > depth) out.push(`</li></${open.pop()}>`);
  };

  for (const block of blocks) {
    const listTag =
      block.type === 'paragraph' && (block.variant === 'bullet' || block.variant === 'todo')
        ? 'ul'
        : block.type === 'paragraph' && block.variant === 'numbered'
          ? 'ol'
          : null;
    if (!listTag || block.type !== 'paragraph') {
      closeTo(0);
    } else {
      const depth = (block.indent ?? 0) + 1;
      closeTo(depth);
      if (open.length === depth && open[depth - 1] !== listTag) closeTo(depth - 1);
      if (open.length === depth) {
        out.push('</li><li>');
      } else {
        while (open.length < depth) {
          out.push(`<${listTag}><li>`);
          open.push(listTag);
        }
      }
      const box = block.variant === 'todo' ? `${block.checked ? '☑' : '☐'} ` : '';
      out.push(`${box}${portableInline(block)}`);
      continue;
    }
    switch (block.type) {
      case 'heading':
        out.push(`<h${block.level}>${sanitizeEditableHtml(block.html, { placeholders: 'drop' })}</h${block.level}>`);
        break;
      case 'divider':
        out.push('<hr>');
        break;
      case 'code':
        // `language-*` is the class other editors read the fence language
        // from — a pasted diagram stays a mermaid block wherever it lands.
        out.push(
          `<pre><code${block.language ? ` class="language-${escapeText(block.language)}"` : ''}>${escapeText(block.text)}</code></pre>`,
        );
        break;
      case 'paragraph':
        if (block.variant === 'quote') out.push(`<blockquote>${portableInline(block)}</blockquote>`);
        else if (block.variant === 'callout') out.push(`<blockquote><p>${portableInline(block)}</p></blockquote>`);
        else out.push(`<p>${portableInline(block)}</p>`);
        break;
    }
  }
  closeTo(0);
  return out.join('');
}
