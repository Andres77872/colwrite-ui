import { countWords } from '@/lib/text';
import type { Block } from '@/editor';

export type DocumentStats = { words: number; characters: number };

/** Word and character counts of the text blocks, as the page menu shows them. */
export function documentStats(blocks: readonly Block[]): DocumentStats {
  let words = 0;
  let characters = 0;
  for (const block of blocks) {
    if (!('html' in block)) continue;
    const text = block.html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim();
    words += countWords(block.html);
    characters += text.replace(/\s+/g, ' ').length;
  }
  return { words, characters };
}

export function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}
