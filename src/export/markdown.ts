import { buildBibliography, formatReference, referenceMarker, type Block, type Doc } from '@/editor';
import { blocksToMarkdown } from '@/editor/markdown';
import type { AiBeatExportMode } from './types';

export type MarkdownExportOptions = {
  includeTitle: boolean;
  includeReferences: boolean;
  /** `omit` drops AI beat drafts; anything else keeps their generated text. */
  aiBeat: AiBeatExportMode;
};

/** A paragraph without its AI beat drafts (placeholders and children both). */
function withoutAiBeats(block: Block): Block {
  if (block.type !== 'paragraph' || !block.children?.some((child) => child.type === 'aiBeat')) return block;
  const beats = new Set(block.children.filter((child) => child.type === 'aiBeat').map((child) => child.id));
  // `inlineHtmlToMarkdown` writes nothing for a placeholder whose child is
  // gone, so dropping the children is enough.
  return { ...block, children: block.children.filter((child) => !beats.has(child.id)) };
}

function escapeHeading(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The whole document as Markdown, the way "Copy as Markdown" writes a block:
 * citations as Pandoc keys (`[@10.1/abc]`), maths in `$…$`, diagrams and
 * figures as `mermaid` / `figure` fences. The reference list, when asked for,
 * is the document's bibliography in its own style, for readers without a .bib.
 */
export function documentToMarkdown(doc: Doc, options: MarkdownExportOptions): string {
  const blocks = options.aiBeat === 'omit' ? doc.blocks.map(withoutAiBeats) : doc.blocks;
  const parts: string[] = [];
  const title = escapeHeading(doc.name ?? '');
  if (options.includeTitle && title) parts.push(`# ${title}`);
  const body = blocksToMarkdown(blocks).trim();
  if (body) parts.push(body);

  if (options.includeReferences) {
    const bibliography = buildBibliography(doc.blocks, {
      library: doc.sources,
      style: doc.citationStyle ?? null,
    });
    if (bibliography.entries.length > 0) {
      const rows = bibliography.entries.map((entry) => {
        const reference = formatReference(entry, bibliography.style);
        const marker = referenceMarker(entry, bibliography.style);
        const link = reference.href ? ` <${reference.href}>` : '';
        return `- ${marker ? `${marker} ` : ''}${reference.text}${link} \`@${entry.displayKey}\``;
      });
      parts.push(['## References', '', ...rows].join('\n'));
    }
  }

  return `${parts.join('\n\n')}\n`;
}
