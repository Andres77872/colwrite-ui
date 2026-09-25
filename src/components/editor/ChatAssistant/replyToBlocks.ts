import type { CitationChild } from '@/editor';
import { markdownToBlocks } from '@/editor/markdown';
import { uid } from '@/lib/uid';
import type { AgentSource } from '@/services/streamParser';

const MARKER = /\[(S\d{1,5}(?:\s*[,;]\s*S\d{1,5})*)\](?!\()/g;

/**
 * The reply as document blocks.
 *
 * The answer is markdown, so it becomes real headings, lists, tables and
 * equations. Its `[S3]` markers become real citations: each is rewritten to
 * the source's key and resolved against the sources the server sent for this
 * reply, so the citation carries the record's metadata. A marker naming no
 * source the reply received stays text.
 */
export function replyToBlocks(text: string, sources: readonly AgentSource[]) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const lookup = new Map<string, CitationChild>();
  const rewritten = text.replace(MARKER, (marker, body: string) => {
    const known = body
      .split(/\s*[,;]\s*/)
      .map((id) => byId.get(id))
      .filter((source): source is AgentSource => Boolean(source));
    if (known.length === 0) return marker;
    for (const source of known) {
      if (lookup.has(source.key)) continue;
      const { id: _id, origin: _origin, ...record } = source;
      lookup.set(source.key, { id: uid(), type: 'citation', keys: [source.key], sources: [record] });
    }
    return `[${known.map((source) => `@${source.key}`).join('; ')}]`;
  });
  return markdownToBlocks(rewritten, { citations: lookup });
}

