import { uid } from '@/lib/uid';
import { markdownToBlocks } from '@/editor/markdown';
import type { Block, CitationChild, ParagraphBlock } from '@/editor';
import type { AgentSource } from '@/services/streamParser';
import { parseCitationSuggestion, stripCitationTags } from './citationTags';

/** `[S3]` and `[S1, S4]`: the handles research tools give their results. */
const SOURCE_MARKER = /\[(S\d{1,5}(?:\s*[,;]\s*S\d{1,5})*)\](?!\()/g;

/**
 * Rewrite `[S#]` handles into `[@key]` markers and register a citation for
 * each, so a result that cites what the run found carries real citations
 * instead of literal handles. A handle naming no source the run returned
 * stays as text.
 */
function resolveSourceMarkers(
  text: string,
  sources: readonly AgentSource[],
  lookup: Map<string, CitationChild>,
): string {
  if (sources.length === 0) return text;
  const byId = new Map(sources.map((source) => [source.id, source]));
  return text.replace(SOURCE_MARKER, (marker, body: string) => {
    const known = body
      .split(/\s*[,;]\s*/)
      .map((id) => byId.get(id))
      .filter((source): source is AgentSource => Boolean(source));
    if (known.length === 0) return marker;
    for (const source of known) {
      if (lookup.has(source.key)) continue;
      const { id: _id, origin: _origin, ...record } = source;
      lookup.set(source.key, { id: uid(), type: 'citation', keys: [source.key], sources: [record], style: 'numeric' });
    }
    return `[${known.map((source) => `@${source.key}`).join('; ')}]`;
  });
}

/**
 * The model's reply as document blocks.
 *
 * The citation preset answers in tagged text (`<citation … />`), everything
 * else in markdown. Either way the one thing that must never reach the
 * document is citation markup as literal text, so a reply whose tags cannot
 * be read has them stripped before it is parsed as markdown.
 */
export function resultBlocks({
  text,
  citationTags,
  citations,
  sources,
}: {
  text: string;
  /** The reply is tagged text from the citation pipeline. */
  citationTags: boolean;
  /** Citations present in the target, the only ones a result may repeat. */
  citations: ReadonlyMap<string, CitationChild>;
  /** What the run's research tools returned, for resolving `[S#]` handles. */
  sources: readonly AgentSource[];
}): Block[] {
  if (!text.trim()) return [];
  if (citationTags) {
    const parsed = parseCitationSuggestion(text);
    if (parsed) {
      let html = '';
      const children: CitationChild[] = [];
      for (const part of parsed.parts) {
        if (part.type === 'text') {
          html += part.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          continue;
        }
        const id = uid();
        html += `<span data-child-id="${id}" contenteditable="false"></span>`;
        children.push({
          id,
          type: 'citation',
          keys: [part.key],
          sources: [part.source],
          style: 'numeric',
          ...(part.locator ? { locator: part.locator } : {}),
        });
      }
      return [{ id: uid(), type: 'paragraph', html, children, columns: 1 }];
    }
  }
  const lookup = new Map(citations);
  const markdown = resolveSourceMarkers(stripCitationTags(text), sources, lookup);
  return markdownToBlocks(markdown, { citations: lookup });
}

/** Commentary goes in as callouts, so it reads as a note rather than as the author's prose. */
export function asNotes(blocks: Block[]): Block[] {
  return blocks.map((block) =>
    block.type === 'paragraph' && !block.variant ? ({ ...block, variant: 'callout' } as ParagraphBlock) : block,
  );
}
