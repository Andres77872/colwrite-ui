import { useMemo } from 'react';
import { scrollBehavior } from '@/lib/motion';
import type { AgentSource } from '@/services/streamParser';
import type { SourceMarkers } from './ChatMarkdown/ChatMarkdown';

const MARKER = /\[(S\d{1,5}(?:\s*[,;]\s*S\d{1,5})*)\](?!\()/g;

/** Source ids in the order an answer first cites them. */
export function citedOrder(text: string, sources: readonly AgentSource[]): string[] {
  const known = new Set(sources.map((source) => source.id));
  const order: string[] = [];
  for (const match of text.matchAll(MARKER)) {
    for (const id of match[1].split(/\s*[,;]\s*/)) {
      if (known.has(id) && !order.includes(id)) order.push(id);
    }
  }
  return order;
}

export function anchorId(messageId: string, sourceId: string): string {
  return `answer-${messageId}-source-${sourceId}`;
}

/** Markers for `ChatMarkdown`, numbered by first citation in the answer. */
export function useSourceMarkers(messageId: string, text: string, sources: readonly AgentSource[] | undefined) {
  return useMemo(() => {
    const list = sources ?? [];
    const cited = citedOrder(text, list);
    const numbers = new Map(cited.map((id, index) => [id, index + 1]));
    const byId = new Map(list.map((source) => [source.id, source]));
    const markers: SourceMarkers = {
      numberOf: (id) => numbers.get(id),
      describe: (id) => {
        const source = byId.get(id);
        if (!source) return undefined;
        return [source.title, source.authors, source.year].filter(Boolean).join(' · ');
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

