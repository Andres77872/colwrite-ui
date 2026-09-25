import type { Block } from '@/editor';
import { kindLabel } from '@/editor';
import { blockText } from '@/editor/proposals';

export type ChatRefTag = {
  kind: 'document' | 'block';
  start: number;
  end: number;
  refText: string;
  docId?: string;
  blockId?: string;
  source?: 'this' | 'doc';
};

export function parseRefs(text: string): { parts: Array<string | ChatRefTag> } {
  const parts: Array<string | ChatRefTag> = [];
  if (!text) return { parts: [''] };

  const pattern = /#doc\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)|#this\/([A-Za-z0-9_-]+)|#doc\/([A-Za-z0-9_-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const matchStart = match.index;
    const matchText = match[0];
    const matchEnd = matchStart + matchText.length;
    if (matchStart > lastIndex) parts.push(text.slice(lastIndex, matchStart));

    if (match[1] && match[2]) {
      parts.push({
        kind: 'block',
        start: matchStart,
        end: matchEnd,
        refText: matchText,
        docId: match[1],
        blockId: match[2],
        source: 'doc',
      });
    } else if (match[3]) {
      parts.push({
        kind: 'block',
        start: matchStart,
        end: matchEnd,
        refText: matchText,
        blockId: match[3],
        source: 'this',
      });
    } else if (match[4]) {
      parts.push({
        kind: 'document',
        start: matchStart,
        end: matchEnd,
        refText: matchText,
        docId: match[4],
      });
    }
    lastIndex = matchEnd;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return { parts };
}

export function extractRefSpans(text: string): ChatRefTag[] {
  return parseRefs(text).parts.filter((part): part is ChatRefTag => typeof part !== 'string');
}

function shorten(id: string, max = 10): string {
  if (!id) return '';
  if (id.length <= max) return id;
  return id.slice(0, Math.ceil(max / 2)) + '…' + id.slice(-Math.floor(max / 2));
}

/** A block by what it says — a heading's text, a paragraph's opening words. */
function blockRefLabel(blocks: readonly Block[], blockId: string): string {
  const index = blocks.findIndex((b) => b.id === blockId);
  const block = index >= 0 ? blocks[index] : null;
  if (!block) return `Block ${shorten(blockId)}`;
  if (block.type === 'divider') return 'Divider';
  // blockText strips tags by regex: assigning block html to a detached div's
  // innerHTML would fire event handlers (`img onerror`) even off-document.
  const text = blockText(block).trim();
  if (text) return text.length > 40 ? `${text.slice(0, 39)}…` : text;
  return block.type === 'heading' ? `Heading ${block.level}` : `${kindLabel(block)} ${index + 1}`;
}

/**
 * What a reference chip says, in the composer and in the sent message alike —
 * the two used to disagree ('Block' while writing, 'Block: Heading 2' once
 * sent).
 */
export function refLabel(ref: ChatRefTag, blocks: readonly Block[]): string {
  if (ref.kind === 'document') return `Doc ${shorten(ref.docId ?? '')}`;
  if (ref.source === 'this') return blockRefLabel(blocks, ref.blockId ?? '');
  return `Block ${shorten(ref.blockId ?? '')} · Doc ${shorten(ref.docId ?? '')}`;
}
