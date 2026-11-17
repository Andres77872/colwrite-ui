import { blocksToHtml, markdownToBlocks } from '@/editor/markdown';
import type { AgentSource } from '@/api/assistant/streamParser';
import { formatReferences } from '@/editor/citations';
import { markupHasLink, markupHtml, markupText } from '@/editor/csl/markup';
import { referenceLink } from '@/editor/referenceRecords';
import { escapeHtml } from '@/lib/clipboard';
import { replaceSourceMarkers } from '@/lib/sourceHandles';
import { citedOrder } from './answerSourceMarkers';

/**
 * An answer as the reader saw it, ready to paste anywhere.
 *
 * The model writes `[S1]` handles that mean nothing outside this chat; they
 * become the numbers the answer shows, and a numbered Sources list follows so
 * the numbers still point somewhere. `html` carries the same content with
 * headings, lists, emphasis and links for editors that read rich text.
 */
export function answerForClipboard(
  text: string,
  sources: readonly AgentSource[],
): { plain: string; html: string } {
  const cited = citedOrder(text, sources);
  const numbers = new Map(cited.map((id, index) => [id, index + 1]));
  const body = replaceSourceMarkers(text, (handles) => {
    const known = handles
      .map((id) => numbers.get(id))
      .filter((number): number is number => number !== undefined);
    return known.length > 0 ? `[${known.join(', ')}]` : null;
  });

  const byHandle = new Map(sources.map((source) => [source.handle, source]));
  const citedSources = cited
    .map((handle) => byHandle.get(handle))
    .filter((source): source is AgentSource => Boolean(source));
  // Each reference as the reference list prints it, from its record.
  const formatted = formatReferences(citedSources.map((source) => source.record));
  const entries = citedSources.map((source, index) => {
    const markup = formatted.get(source.record.key) ?? [source.record.csl.title];
    const text = markupText(markup);
    // A style that printed no DOI or URL still gets the link, after the entry.
    const href = markupHasLink(markup) ? undefined : referenceLink(source.record)?.href;
    return { number: index + 1, text, html: markupHtml(markup), href };
  });

  const plainSources = entries.map(
    (entry) => `[${entry.number}] ${entry.text}${entry.href ? ` ${entry.href}` : ''}`,
  );
  const plain = entries.length > 0 ? `${body.trimEnd()}\n\nSources\n${plainSources.join('\n')}` : body;

  const htmlSources = entries
    .map((entry) => {
      const link = entry.href
        ? ` <a href="${escapeHtml(entry.href)}">${escapeHtml(entry.href)}</a>`
        : '';
      return `<p>[${entry.number}] ${entry.html}${link}</p>`;
    })
    .join('');
  const html =
    blocksToHtml(markdownToBlocks(body)) +
    (entries.length > 0 ? `<p><strong>Sources</strong></p>${htmlSources}` : '');

  return { plain, html };
}
