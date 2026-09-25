import { FIGURE_FONT_STACKS, FIGURE_MATH_CLASS, FIGURE_MATH_CSS, FIGURE_METRICS } from './constants';
import { estimateMath, figureMathHtml, isWide } from './math';
import type { Extent, FontSpec, TextMeasurer } from './types';

/**
 * Text and maths measurement for figure layout.
 *
 * In a browser, text is measured with canvas `measureText` in the figure's
 * own font stack and maths with a hidden KaTeX element, so boxes fit what
 * the SVG draws. Where there is no layout engine (tests, SSR, jsdom) a
 * deterministic heuristic stands in: per-character advance widths of the
 * two faces figures use, measured from the bundled fonts, and a KaTeX metric
 * estimate for maths (`estimateMath`).
 *
 * Measurements depend on which fonts have loaded, so every measurer carries
 * a `key` that layout caches include, and the key changes (a new
 * "generation") whenever the page's fonts finish loading.
 */

/*
 * Advance widths in ‰ em for ASCII 32–126 (space … `~`), regular weight,
 * read from the hmtx tables of @fontsource/inter 5.3.0 (Inter 4) and
 * @fontsource/source-serif-4 5.3.0. At 12px Inter gives "Multi-Head
 * Attention" 117.9px, "Add & Norm" 68.7px, "Q" 9.2px. Kerning is left out,
 * which errs a fraction of a pixel wide.
 */
const INTER_ASCII = [
  281, 288, 466, 633, 642, 982, 644, 300, 365, 365, 501, 662, 288, 460, 288, 360, 631, 407, 610, 618, 646, 593,
  620, 566, 619, 620, 288, 302, 662, 662, 662, 511, 966, 690, 654, 730, 722, 601, 590, 746, 743, 269, 571, 672,
  565, 903, 753, 765, 639, 765, 644, 642, 646, 744, 690, 985, 682, 679, 629, 365, 360, 365, 471, 456, 323, 562,
  612, 571, 612, 583, 370, 613, 591, 242, 242, 549, 242, 876, 591, 600, 612, 612, 376, 528, 327, 591, 562, 818,
  546, 562, 552, 426, 333, 426, 662,
];
const SERIF_ASCII = [
  237, 289, 381, 525, 518, 932, 728, 182, 362, 362, 458, 534, 302, 320, 302, 341, 529, 529, 529, 529, 529, 529,
  529, 529, 529, 529, 302, 302, 534, 534, 534, 414, 834, 712, 653, 662, 739, 638, 612, 723, 814, 376, 381, 710,
  618, 935, 768, 738, 621, 738, 690, 544, 632, 758, 709, 1005, 672, 667, 586, 335, 341, 335, 534, 514, 400, 541,
  619, 520, 614, 533, 369, 557, 641, 329, 303, 594, 329, 955, 643, 579, 622, 601, 456, 465, 359, 628, 579, 836,
  569, 586, 490, 359, 290, 359, 534,
];

/** Common non-ASCII characters in both faces' Latin subsets: [sans, serif] ‰ em. */
const LATIN_EXTRAS: Record<string, readonly [number, number]> = {
  '\u00a0': [281, 237], // no-break space
  '–': [500, 514],
  '—': [1000, 814],
  '‘': [261, 225],
  '’': [261, 225],
  '“': [440, 440],
  '”': [440, 440],
  '…': [864, 826],
  '•': [563, 305],
  '·': [288, 302],
  '×': [662, 534],
  '÷': [662, 534],
  '±': [662, 534],
  '−': [662, 534],
  '°': [456, 344],
  '€': [667, 518],
  '£': [611, 519],
  '©': [914, 756],
  '®': [666, 460],
  '™': [611, 793],
  '′': [223, 249],
  '″': [442, 431],
  '«': [583, 540],
  '»': [583, 540],
  '↑': [834, 680],
  '↓': [834, 680],
  ß: [616, 630],
  æ: [917, 827],
  Æ: [994, 956],
  œ: [1000, 916],
  Œ: [1005, 971],
  ø: [600, 579],
  Ø: [765, 738],
  µ: [586, 617],
  '§': [568, 494],
  '¶': [603, 599],
};

/** Typographic spaces, em (the same in any face). */
const SPACE_WIDTHS: Record<string, number> = {
  '\u2002': 0.5,
  '\u2003': 1,
  '\u2004': 0.333,
  '\u2005': 0.25,
  '\u2006': 0.167,
  '\u2009': 0.2,
  '\u200a': 0.1,
  '\u202f': 0.2,
  '\u205f': 0.222,
  '\u3000': 1,
};

/**
 * Wider weights, measured over a corpus of figure labels (Inter 600 is 2%
 * wider than 400, Source Serif 700 3%), rounded up so bold text never
 * measures short.
 */
const WEIGHT_FACTOR: Record<FontSpec['family'], Record<FontSpec['weight'], number>> = {
  sans: { 400: 1, 500: 1.015, 600: 1.03, 700: 1.045 },
  serif: { 400: 1, 500: 1.01, 600: 1.02, 700: 1.035 },
};
/**
 * Inter italic is 0.5% wider than upright. Source Serif italic is 7.5%
 * narrower on letters but not on digits, so 0.96 keeps digits from measuring short.
 */
const ITALIC_FACTOR: Record<FontSpec['family'], number> = { sans: 1.01, serif: 0.96 };
/** hhea ascent + descent, em: the height of one line of the face. */
const FONT_EXTENT: Record<FontSpec['family'], number> = { sans: 1.21, serif: 1.371 };

const ZERO_WIDTH = /[\p{M}\p{Cc}\p{Cf}]/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const UPPERCASE = /[\p{Lu}\p{Lt}]/u;
const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;
const PUNCTUATION = /\p{P}/u;
const SEPARATOR = /\p{Zs}/u;

function isArrow(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x2190 && code <= 0x21ff) || (code >= 0x27f0 && code <= 0x27ff) || (code >= 0x2900 && code <= 0x297f);
}

/** Width in em of a character the tables do not list, judged by its kind. */
function fallbackCharWidth(ch: string, table: readonly number[]): number {
  // Accented Latin letters are as wide as their base letter.
  const base = ch.normalize('NFD').charCodeAt(0);
  if (base >= 32 && base <= 126) return table[base - 32] / 1000;
  if (ZERO_WIDTH.test(ch)) return 0;
  if (isWide(ch)) return 1;
  if (PICTOGRAPH.test(ch)) return 1.25;
  if (UPPERCASE.test(ch)) return 0.7;
  if (LETTER.test(ch)) return 0.58;
  if (DIGIT.test(ch)) return 0.62;
  if (SEPARATOR.test(ch)) return 0.28;
  if (PUNCTUATION.test(ch)) return 0.35;
  // Arrows come from a symbol fallback font, a full em wide.
  if (isArrow(ch)) return 1;
  // Operators, currency, other symbols.
  return 0.8;
}

/** The heuristic width of a run of text, px. */
function heuristicTextWidth(value: string, font: FontSpec): number {
  const table = font.family === 'serif' ? SERIF_ASCII : INTER_ASCII;
  const column = font.family === 'serif' ? 1 : 0;
  let em = 0;
  let joined = false;
  let flagHalf = false;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const regional = code >= 0x1f1e6 && code <= 0x1f1ff;
    if (code >= 32 && code <= 126) {
      em += table[code - 32] / 1000;
    } else if (ch === '\t') {
      em += table[0] / 1000; // SVG and HTML draw a tab as a space
    } else if (Object.hasOwn(LATIN_EXTRAS, ch)) {
      em += LATIN_EXTRAS[ch][column] / 1000;
    } else if (Object.hasOwn(SPACE_WIDTHS, ch)) {
      em += SPACE_WIDTHS[ch];
    } else if (regional) {
      // Regional indicators draw a flag per pair.
      if (!flagHalf) em += 1.25;
    } else if (!(joined && PICTOGRAPH.test(ch))) {
      // A pictograph after a zero-width joiner is part of the previous emoji.
      em += fallbackCharWidth(ch, table);
    }
    joined = ch === '\u200d';
    flagHalf = regional && !flagHalf;
  }
  const factor = WEIGHT_FACTOR[font.family][font.weight] * (font.italic ? ITALIC_FACTOR[font.family] : 1);
  return em * font.size * factor;
}

function lineExtent(font: FontSpec): number {
  return font.size * FIGURE_METRICS.lineHeight;
}

function heuristicMath(latex: string, font: FontSpec): Extent {
  if (!latex.trim()) return { width: 0, height: lineExtent(font) };
  if (!figureMathHtml(latex).ok) {
    // KaTeX shows LaTeX it cannot parse as its source, in the label's font.
    return { width: heuristicTextWidth(latex, font), height: lineExtent(font) };
  }
  const estimate = estimateMath(latex);
  return { width: estimate.width * font.size, height: estimate.height * font.size };
}

const HEURISTIC: TextMeasurer = Object.freeze({
  key: 'heuristic',
  text: (value: string, font: FontSpec): Extent => ({
    width: heuristicTextWidth(value, font),
    height: font.size * FONT_EXTENT[font.family],
  }),
  math: heuristicMath,
});

/**
 * The deterministic measurer: no DOM, no fonts, same numbers everywhere. It
 * is stateless (maths estimates are cached in `math.ts`), so one instance
 * serves every caller.
 */
export function createHeuristicMeasurer(): TextMeasurer {
  return HEURISTIC;
}

/* ────────────────────────────────────────────────────────────────────────
 * DOM measurement
 * ──────────────────────────────────────────────────────────────────────── */

const STYLE_ID = 'cwfig-measure-style';
/** Marks the hidden maths host, shared by every measurer on the page. */
const HOST_ATTRIBUTE = 'data-cwfig-measure';
/** Past this many entries a cache is dropped rather than tracked entry by entry. */
const CACHE_LIMIT = 4000;

/** Bumped when fonts finish loading; part of the DOM measurer's key. */
let generation = 0;

function fontKey(font: FontSpec): string {
  return `${font.family}|${font.size}|${font.weight}|${font.italic ? 'i' : 'n'}`;
}

function canvasFont(font: FontSpec): string {
  return `${font.italic ? 'italic ' : ''}${font.weight} ${font.size}px ${FIGURE_FONT_STACKS[font.family]}`;
}

function remember(cache: Map<string, Extent>, key: string, extent: Extent): Extent {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, extent);
  return extent;
}

function injectMathStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = FIGURE_MATH_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}

/**
 * A measurer backed by the browser: canvas `measureText` for text, a hidden
 * `.cwfig-math` element holding KaTeX's markup for maths. Returns null when
 * the document has no 2D canvas (jsdom, some privacy modes); maths falls
 * back to the heuristic when the element has no layout (width 0).
 */
export function createDomMeasurer(doc: Document | undefined = globalThis.document): TextMeasurer | null {
  if (!doc) return null;
  let context: CanvasRenderingContext2D | null;
  try {
    context = doc.createElement('canvas').getContext('2d');
  } catch {
    // A blocked canvas (privacy settings) measures nothing.
    return null;
  }
  if (!context) return null;
  const ctx = context;
  const owner = doc;
  const textCache = new Map<string, Extent>();
  const mathCache = new Map<string, Extent>();
  let host: HTMLDivElement | null = null;

  function mathHost(): HTMLDivElement | null {
    // Re-attach if something emptied <body> since the last measurement.
    if (host?.isConnected) return host;
    const parent = owner.body ?? owner.documentElement;
    if (!parent) return null;
    injectMathStyle(owner);
    host = owner.querySelector<HTMLDivElement>(`div[${HOST_ATTRIBUTE}]`);
    if (host) return host;
    host = owner.createElement('div');
    host.className = FIGURE_MATH_CLASS;
    host.setAttribute(HOST_ATTRIBUTE, '');
    host.setAttribute('aria-hidden', 'true');
    // Absolute + max-content: the box shrinks to the formula; the line height
    // matches a label line, so plain maths measures exactly one line tall.
    host.style.cssText =
      'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;' +
      `width:max-content;margin:0;padding:0;border:0;white-space:nowrap;letter-spacing:normal;line-height:${FIGURE_METRICS.lineHeight}`;
    parent.appendChild(host);
    return host;
  }

  return {
    key: `dom:${generation}`,
    text(value, font) {
      const key = `${fontKey(font)}\u0000${value}`;
      const cached = textCache.get(key);
      if (cached) return cached;
      ctx.font = canvasFont(font);
      const metrics = ctx.measureText(value);
      const ascent = metrics.fontBoundingBoxAscent;
      const descent = metrics.fontBoundingBoxDescent;
      const height =
        Number.isFinite(ascent) && Number.isFinite(descent) && ascent + descent > 0
          ? ascent + descent
          : font.size * FONT_EXTENT[font.family];
      return remember(textCache, key, { width: metrics.width, height });
    },
    math(latex, font) {
      if (!latex.trim()) return { width: 0, height: lineExtent(font) };
      const key = `${fontKey(font)}\u0000${latex}`;
      const cached = mathCache.get(key);
      if (cached) return cached;
      const element = mathHost();
      let extent: Extent | null = null;
      if (element) {
        element.style.fontFamily = FIGURE_FONT_STACKS[font.family];
        element.style.fontSize = `${font.size}px`;
        element.style.fontWeight = String(font.weight);
        element.style.fontStyle = font.italic ? 'italic' : 'normal';
        element.innerHTML = figureMathHtml(latex).html;
        const rect = element.getBoundingClientRect();
        if (rect.width > 0) extent = { width: rect.width, height: Math.max(rect.height, lineExtent(font)) };
        element.textContent = '';
      }
      // No layout engine behind the element (jsdom): estimate instead.
      return remember(mathCache, key, extent ?? heuristicMath(latex, font));
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The shared measurer and font loading
 * ──────────────────────────────────────────────────────────────────────── */

let current: { generation: number; measurer: TextMeasurer } | null = null;
const listeners = new Set<() => void>();
let watching = false;
let serifRequested = false;

function fontSet(): FontFaceSet | null {
  return typeof document !== 'undefined' && document.fonts ? document.fonts : null;
}

/** jsdom has no layout: its canvas logs "not implemented" and measures nothing. */
function isJsdom(): boolean {
  return typeof navigator !== 'undefined' && /\bjsdom\//.test(navigator.userAgent);
}

function bumpGeneration(): void {
  generation += 1;
  current = null;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      // One failing subscriber must not starve the others; surface it anyway.
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

function watchFonts(): void {
  if (watching) return;
  const fonts = fontSet();
  if (!fonts) return;
  watching = true;
  fonts.addEventListener('loadingdone', bumpGeneration);
  if (fonts.status !== 'loaded') {
    void fonts.ready.then(
      () => bumpGeneration(),
      () => undefined,
    );
  }
}

/**
 * The measurer figures lay out with: the DOM measurer in a browser, the
 * heuristic elsewhere. One instance per font generation, so its caches are
 * shared by every figure on the page and dropped when fonts change.
 */
export function getFigureMeasurer(): TextMeasurer {
  watchFonts();
  if (current?.generation === generation) return current.measurer;
  const dom = typeof document !== 'undefined' && !isJsdom() ? createDomMeasurer(document) : null;
  current = { generation, measurer: dom ?? createHeuristicMeasurer() };
  return current.measurer;
}

/**
 * Calls `listener` whenever fonts finish loading and measurements may have
 * changed (the measurer's key changes with them). Returns the unsubscribe.
 * A no-op outside a browser.
 */
export function onFigureFontsChange(listener: () => void): () => void {
  if (!fontSet()) return () => undefined;
  watchFonts();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERIF_FACES = ['400 12px "Source Serif 4"', '600 12px "Source Serif 4"', '700 12px "Source Serif 4"', 'italic 400 12px "Source Serif 4"'];

/**
 * Makes a figure face available. Inter is the app's own face and always
 * loaded; Source Serif is fetched on first use (weights 400/600/700 and
 * italic), and its arrival is announced through `onFigureFontsChange`.
 */
export function loadFigureFont(family: FontSpec['family']): void {
  if (family !== 'serif' || serifRequested || typeof document === 'undefined') return;
  serifRequested = true;
  watchFonts();
  Promise.all([
    import('@fontsource/source-serif-4/latin-400.css'),
    import('@fontsource/source-serif-4/latin-600.css'),
    import('@fontsource/source-serif-4/latin-700.css'),
    import('@fontsource/source-serif-4/latin-400-italic.css'),
  ])
    .then(async () => {
      const fonts = fontSet();
      if (!fonts) return;
      // Loading explicitly (rather than on first draw) lets the layout settle once.
      await Promise.all(SERIF_FACES.map((face) => fonts.load(face)));
      bumpGeneration();
    })
    .catch(() => {
      // Offline or a failed chunk: the fallback serif draws; allow a later retry.
      serifRequested = false;
    });
}
