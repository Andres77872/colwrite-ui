import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FIGURE_MATH_CSS } from '@/lib/figure/constants';
import { parseLabel } from '@/lib/figure/labels';
import type { FigurePalette } from '@/lib/figure/palette';
import type { FigureScene, Label, LabelBox } from '@/lib/figure/types';
import { FigureSvg } from './FigureSvg';

export type FigureSvgFileOptions = {
  /** Accessible name written into the file's `<title>`. */
  title?: string;
  /** Written into the file's `<desc>`. */
  description?: string;
  /** Id prefix inside the file; a standalone file has no neighbours to clash with. */
  idPrefix?: string;
  /**
   * The KaTeX stylesheet, fonts inlined, for figures with maths. Without it
   * the file uses the copy `figureSvgDownload` loaded earlier, if any.
   */
  katexCss?: string;
};

/**
 * Maths labels are KaTeX HTML, which is only laid out right with KaTeX's
 * stylesheet. The export's offline copy inlines every font (~350 KB), so it
 * is loaded on the first download that needs it, never with the editor.
 */
let katexCssCache: string | null = null;

async function loadKatexCss(): Promise<string> {
  if (katexCssCache === null) {
    const { katexOfflineCss } = await import('@/export/katexOfflineCss');
    katexCssCache = katexOfflineCss;
  }
  return katexCssCache;
}

function labelHasMath(label: Label | undefined): boolean {
  return Boolean(label?.lines.some((line) => line.some((segment) => segment.kind === 'math')));
}

function boxHasMath(box: LabelBox | null): boolean {
  return labelHasMath(box?.label);
}

/** Whether any label or tensor cell in the scene draws KaTeX maths. */
export function sceneHasMath(scene: FigureScene): boolean {
  return (
    scene.nodes.some((n) => [n.label, n.sublabel, n.badge, n.repeat].some(boxHasMath)) ||
    // Cells are parsed like labels when drawn (FigureSvg's tensorBody).
    scene.nodes.some((n) => n.model.cells?.text?.some((row) => row.some((text) => text && labelHasMath(parseLabel(text))))) ||
    scene.groups.some((g) => [g.label, g.repeat, g.panel].some(boxHasMath)) ||
    scene.edges.some((e) => boxHasMath(e.label)) ||
    Boolean(scene.legend?.items.some((item) => boxHasMath(item.label)))
  );
}

/** CSS inside a CDATA section, so `<` or `&` in it cannot end the XML early. */
function cdata(css: string): string {
  return `<![CDATA[${css.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

/**
 * Code points XML 1.0 forbids: C0 controls but tab and newlines, lone
 * surrogates, U+FFFE and U+FFFF. React writes them through as they are, and
 * one of them in a title, a cell or a KaTeX run makes the whole file
 * unreadable to XML parsers and SVG viewers; the browser view never cared.
 */
const XML_ILLEGAL = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

const MATH_NOTE =
  '<!-- The maths in this figure is KaTeX HTML inside <foreignObject>: it needs the KaTeX stylesheet ' +
  '(https://katex.org) to lay out, and only browsers draw foreignObject. For LaTeX, use Copy TikZ. -->\n';

/**
 * The figure as a standalone SVG document: XML prolog, namespaces, a painted
 * background, and the maths stylesheet embedded when there is maths, so the
 * file looks the same opened on its own as it did in the editor.
 */
export function figureSvgMarkup(
  scene: FigureScene,
  palette: FigurePalette,
  options: FigureSvgFileOptions = {},
): string {
  const markup = renderToStaticMarkup(
    createElement(FigureSvg, {
      scene,
      palette,
      idPrefix: options.idPrefix ?? 'cwfig',
      title: options.title,
      description: options.description,
      background: true,
    }),
  );
  const math = sceneHasMath(scene);
  const katexCss = math ? (options.katexCss ?? katexCssCache) : null;
  // FigureSvg writes the maths rule as its only stylesheet; widen it in place
  // and wrap it for XML.
  const style = `<style>${FIGURE_MATH_CSS}</style>`;
  if (!markup.includes(style)) throw new Error('FigureSvg markup is missing its stylesheet');
  // A replacer function, so `$&`-like runs in the CSS are not read as patterns.
  const body = markup.replace(style, () => `<style>${cdata(FIGURE_MATH_CSS + (katexCss ?? ''))}</style>`);
  const note = math && !katexCss ? MATH_NOTE : '';
  // Last, over everything: text, attributes, KaTeX output and the CSS alike.
  return `<?xml version="1.0" encoding="UTF-8"?>\n${note}${body.replace(XML_ILLEGAL, '')}\n`;
}

/** {@link figureSvgMarkup} as a file, synchronously (maths CSS only if already loaded). */
export function figureSvgBlob(scene: FigureScene, palette: FigurePalette, options: FigureSvgFileOptions = {}): Blob {
  return new Blob([figureSvgMarkup(scene, palette, options)], { type: 'image/svg+xml;charset=utf-8' });
}

/**
 * The file a Download button should save: loads the offline KaTeX stylesheet
 * first when the figure has maths, so the maths lays out in the file too.
 */
export async function figureSvgDownload(
  scene: FigureScene,
  palette: FigurePalette,
  options: FigureSvgFileOptions = {},
): Promise<Blob> {
  const katexCss = options.katexCss ?? (sceneHasMath(scene) ? await loadKatexCss() : undefined);
  return figureSvgBlob(scene, palette, { ...options, katexCss });
}
