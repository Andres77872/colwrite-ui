import { blocksToHtml, markdownToBlocks } from '@/editor/markdown';
import type { AgentSource } from '@/services/streamParser';
import { citedOrder } from './answerSourceMarkers';

const MARKER = /\[(S\d{1,5}(?:\s*[,;]\s*S\d{1,5})*)\](?!\()/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "William Fedus, Barret Zoph, Noam Shazeer" → "Fedus, Zoph, Shazeer". */
function surnames(authors: string | undefined): string {
  if (!authors) return '';
  const names = authors
    .split(/\s*(?:,|;|\band\b|&)\s*/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => name.split(/\s+/).pop() ?? name);
  if (names.length === 0) return '';
  return names.length > 3 ? `${names[0]} et al.` : names.join(', ');
}

function linkOf(source: AgentSource): string | undefined {
  const href = source.url ?? (source.doi ? `https://doi.org/${source.doi}` : undefined);
  return href && /^https?:\/\//.test(href) ? href : undefined;
}

/** One bibliography line: "Fedus, Zoph, Shazeer. Switch Transformers. JMLR 2021." */
function reference(source: AgentSource): { text: string; href?: string } {
  const who = surnames(source.authors);
  const title = (source.title || source.key).replace(/\.$/, '');
  const where = [source.venue, source.year].filter(Boolean).join(' ');
  const text = [who, title, where].filter(Boolean).join('. ');
  return { text: `${text}.`, href: linkOf(source) };
}

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
  const body = text.replace(MARKER, (marker, list: string) => {
    const known = list
      .split(/\s*[,;]\s*/)
      .map((id) => numbers.get(id))
      .filter((number): number is number => number !== undefined);
    return known.length > 0 ? `[${known.join(', ')}]` : marker;
  });

  const byId = new Map(sources.map((source) => [source.id, source]));
  const entries = cited
    .map((id) => byId.get(id))
    .filter((source): source is AgentSource => Boolean(source))
    .map((source, index) => ({ number: index + 1, ...reference(source) }));

  const plainSources = entries.map(
    (entry) => `[${entry.number}] ${entry.text}${entry.href ? ` ${entry.href}` : ''}`,
  );
  const plain = entries.length > 0 ? `${body.trimEnd()}\n\nSources\n${plainSources.join('\n')}` : body;

  const htmlSources = entries
    .map((entry) => {
      const link = entry.href
        ? ` <a href="${escapeHtml(entry.href)}">${escapeHtml(entry.href)}</a>`
        : '';
      return `<p>[${entry.number}] ${escapeHtml(entry.text)}${link}</p>`;
    })
    .join('');
  const html =
    blocksToHtml(markdownToBlocks(body)) +
    (entries.length > 0 ? `<p><strong>Sources</strong></p>${htmlSources}` : '');

  return { plain, html };
}

/** Rich text where the browser allows it, plain text where it does not. */
export async function copyAnswer(text: string, sources: readonly AgentSource[]): Promise<void> {
  const { plain, html } = answerForClipboard(text, sources);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      /* fall through to plain text */
    }
  }
  await navigator.clipboard.writeText(plain);
}
