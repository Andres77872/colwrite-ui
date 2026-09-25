import { isDiagramBlock } from '@/editor/blockKinds';
import type { Block } from '@/editor/types';
import { mermaidThemeFor, renderMermaid } from '@/lib/mermaid';

/** Drawn diagrams for an export, by block id. */
export type RenderedDiagrams = ReadonlyMap<string, string>;

/**
 * The export's own embedded face first, then the same family the editor
 * measures with — Mermaid sizes every box from text measured in this page,
 * where "CW Inter" does not exist, so the fallback must have the same metrics.
 */
export const EXPORT_DIAGRAM_FONT = '"CW Inter", Inter, ui-sans-serif, sans-serif';

/**
 * Every diagram block in `blocks`, drawn to SVG ahead of the export.
 *
 * The standalone renderer is a synchronous `renderToStaticMarkup`, and Mermaid
 * lays out asynchronously against the live DOM, so drawing happens here first
 * and the SVGs are handed in. Always in the light palette: an export is a
 * page, whatever theme the editor is in. A diagram that does not draw is left
 * out, and the export prints its source as code rather than failing.
 */
export async function renderDocumentDiagrams(blocks: readonly Block[]): Promise<Map<string, string>> {
  const drawn = new Map<string, string>();
  const diagrams = blocks.filter((block) => block.type === 'code' && isDiagramBlock(block));
  if (diagrams.length === 0) return drawn;
  const theme = mermaidThemeFor(null, { fontFamily: EXPORT_DIAGRAM_FONT });
  for (const block of diagrams) {
    if (block.type !== 'code') continue;
    const result = await renderMermaid(block.text, theme);
    if (result.ok) drawn.set(block.id, result.svg);
  }
  return drawn;
}
