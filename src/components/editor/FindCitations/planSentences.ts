import type { Block } from '@/editor';
import { proseText, widgetIdBefore } from '@/components/editor/References/citeAtCursor';
import { MAX_SENTENCES, citePoint, sentencesIn, skipReason, type SentenceCandidates } from './findCitations';

/**
 * The sentences of a paragraph's selection Find citations searches, read
 * from the paragraph as it is on screen when the author asks: each to
 * search, or skipped with why (too short, or a citation already after it).
 */
export function planSentences(el: HTMLElement, block: Block | undefined, start: number, end: number): SentenceCandidates[] {
  if (block?.type !== 'paragraph') return [];
  const citations = new Set((block.children ?? []).filter((child) => child.type === 'citation').map((child) => child.id));
  return sentencesIn(proseText(el), start, end)
    .slice(0, MAX_SENTENCES)
    .map((sentence) => {
      const before = widgetIdBefore(el, citePoint(sentence));
      const reason = skipReason(sentence, before !== null && citations.has(before));
      return reason
        ? { ...sentence, status: 'skipped' as const, reason, candidates: [] }
        : { ...sentence, status: 'searching' as const, candidates: [] };
    });
}
