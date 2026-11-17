import { useMemo } from 'react';
import { scrollBehavior } from '@/lib/motion';
import type { AgentSource } from '@/api/assistant/streamParser';
import { sourceMarkers } from '@/lib/sourceHandles';
import { referenceAuthors, referenceYear } from '@/editor/referenceRecords';
import type { SourceMarkers } from './ChatMarkdown/ChatMarkdown';

/**
 * The handles an answer cites, in the order it first cites them, among the
 * sources it can name. A marker naming a handle never received is not a
 * source.
 */
export function citedOrder(text: string, sources: readonly AgentSource[]): string[] {
  const known = new Set(sources.map((source) => source.handle));
  const order: string[] = [];
  for (const handles of sourceMarkers(text)) {
    for (const handle of handles) {
      if (known.has(handle) && !order.includes(handle)) order.push(handle);
    }
  }
  return order;
}

export function anchorId(messageId: string, handle: string): string {
  return `answer-${messageId}-source-${handle}`;
}

/**
 * Markers for `ChatMarkdown`, numbered by first citation in the answer,
 * read against `sources`: for a chat reply the conversation's, so a handle
 * an earlier turn registered resolves too.
 */
export function useSourceMarkers(messageId: string, text: string, sources: readonly AgentSource[] | undefined) {
  return useMemo(() => {
    const list = sources ?? [];
    const cited = citedOrder(text, list);
    const numbers = new Map(cited.map((handle, index) => [handle, index + 1]));
    const byHandle = new Map(list.map((source) => [source.handle, source]));
    const markers: SourceMarkers = {
      numberOf: (handle) => numbers.get(handle),
      describe: (handle) => {
        const source = byHandle.get(handle);
        if (!source) return undefined;
        return [source.title, referenceAuthors(source.record), referenceYear(source.record)].filter(Boolean).join(' · ');
      },
      onActivate: (id) => {
        const target = document.getElementById(anchorId(messageId, id));
        target?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
        target?.focus({ preventScroll: true });
      },
    };
    return { markers, cited, numbers };
  }, [messageId, text, sources]);
}

