import { htmlToText } from '@/editor/blockKinds';
import type { Block } from '@/editor/types';
import type { ReviewComment } from '@/data/reviews';

const squeezed = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Same plain-text anchor as the API; never fuzzy-match a changed sentence. */
export function commentIsOutdated(comment: ReviewComment, blocks: readonly Block[]): boolean {
  if (comment.outdated) return true;
  const block = blocks.find((item) => item.id === comment.block_id);
  if (!block) return true;
  const parts = [block.type === 'code' ? block.text : 'html' in block ? htmlToText(block.html) : ''];
  if (block.type === 'paragraph') for (const child of block.children ?? []) {
    if (child.type === 'citation') continue;
    const fields = child as unknown as Record<string, unknown>;
    for (const key of ['caption', 'title', 'xLabel', 'yLabel', 'latex', 'output']) {
      if (typeof fields[key] === 'string') parts.push(fields[key]);
    }
    if (Array.isArray(fields.data)) {
      parts.push(...fields.data.flatMap((row) => Array.isArray(row) ? row.map(String) : []));
    }
  }
  return !squeezed(parts.join(' ')).includes(squeezed(comment.quote));
}

/** A presentation-only range: highlighting does not touch editable markup. */
export function exactQuoteRange(host: HTMLElement, quote: string): Range | null {
  const points: Array<{ node: Text; offset: number }> = [];
  let plain = '';
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest('[data-child-id], button, textarea, script, style, [aria-hidden="true"]')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let node = walker.nextNode();
  while (node) {
    const value = node.textContent ?? '';
    for (let offset = 0; offset < value.length; offset += 1) {
      const char = value.charAt(offset);
      if (/\s/.test(char) && (!plain || plain.endsWith(' '))) continue;
      plain += /\s/.test(char) ? ' ' : char;
      points.push({ node: node as Text, offset });
    }
    node = walker.nextNode();
  }
  const wanted = squeezed(quote);
  const at = wanted ? plain.indexOf(wanted) : -1;
  const start = points[at];
  const end = points[at + wanted.length - 1];
  if (at < 0 || !start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}
