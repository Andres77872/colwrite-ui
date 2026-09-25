import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIGURE_MATH_CLASS, FIGURE_MATH_CSS, FIGURE_METRICS, figureFont } from '../constants';
import { estimateMath, figureMathHtml } from '../math';
import { createDomMeasurer, createHeuristicMeasurer } from '../measure';

const SANS = figureFont('sans', 12);
const SERIF = figureFont('serif', 12);
const LINE = 12 * FIGURE_METRICS.lineHeight;
const heuristic = createHeuristicMeasurer();
const textWidth = (value: string, font = SANS) => heuristic.text(value, font).width;
const em = (latex: string) => estimateMath(latex).width;

afterEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('heuristic text measurement', () => {
  it('is one shared, stateless measurer keyed "heuristic"', () => {
    expect(heuristic.key).toBe('heuristic');
    expect(createHeuristicMeasurer()).toBe(heuristic);
  });

  it('matches Inter 400 advance widths at 12px', () => {
    // Real hmtx sums: 117.9, 68.7 and 9.18px (Chrome's canvas agrees within 1%).
    expect(textWidth('Multi-Head Attention')).toBeCloseTo(117.89, 1);
    expect(textWidth('Add & Norm')).toBeCloseTo(68.7, 1);
    expect(textWidth('Q')).toBeCloseTo(9.18, 1);
    expect(textWidth('Scaled Dot-Product Attention')).toBeCloseTo(166.5, 0);
  });

  it('matches Source Serif 4 at 12px', () => {
    expect(textWidth('Multi-Head Attention', SERIF)).toBeCloseTo(121.86, 1);
    expect(textWidth('Q', SERIF)).toBeCloseTo(8.86, 1);
  });

  it('scales linearly with the font size', () => {
    expect(textWidth('Softmax', figureFont('sans', 24))).toBeCloseTo(2 * textWidth('Softmax'), 10);
  });

  it('widens with weight, and by less than the brief-era 6%', () => {
    const regular = textWidth('Feed Forward');
    const medium = textWidth('Feed Forward', figureFont('sans', 12, 500));
    const semibold = textWidth('Feed Forward', figureFont('sans', 12, 600));
    const bold = textWidth('Feed Forward', figureFont('sans', 12, 700));
    expect(regular).toBeLessThan(medium);
    expect(medium).toBeLessThan(semibold);
    expect(semibold).toBeLessThan(bold);
    expect(bold / regular).toBeLessThan(1.06);
  });

  it('treats Inter italic as slightly wider and Source Serif italic as narrower', () => {
    expect(textWidth('Norm', figureFont('sans', 12, 400, true))).toBeGreaterThan(textWidth('Norm'));
    expect(textWidth('Norm', figureFont('serif', 12, 400, true))).toBeLessThan(textWidth('Norm', SERIF));
  });

  it('reports the face’s line extent as height, even for empty text', () => {
    expect(heuristic.text('', SANS)).toEqual({ width: 0, height: 12 * 1.21 });
    expect(heuristic.text('x', SERIF).height).toBeCloseTo(12 * 1.371, 10);
  });

  it('measures accented letters as their base letter and combining marks as nothing', () => {
    expect(textWidth('café')).toBeCloseTo(textWidth('cafe'), 10);
    expect(textWidth('Ångström')).toBeCloseTo(textWidth('Angstrom'), 10);
    expect(textWidth('e\u0301')).toBeCloseTo(textWidth('e'), 10);
  });

  it('knows the common typographic characters', () => {
    expect(textWidth('–')).toBeCloseTo(6, 10);
    expect(textWidth('—')).toBeCloseTo(12, 10);
    expect(textWidth('\u00a0')).toBeCloseTo(textWidth(' '), 10);
    expect(textWidth('\t')).toBeCloseTo(textWidth(' '), 10);
    expect(textWidth('\u2003')).toBeCloseTo(12, 10);
  });

  it('gives wide East Asian characters a full em and arrows a symbol font’s em', () => {
    expect(textWidth('日本語')).toBeCloseTo(36, 10);
    expect(textWidth('한')).toBeCloseTo(12, 10);
    expect(textWidth('→')).toBeCloseTo(12, 10);
  });

  it('counts an emoji sequence or a flag once', () => {
    const one = textWidth('👩');
    expect(textWidth('👩\u200d💻')).toBeCloseTo(one, 10); // ZWJ sequence
    expect(textWidth('🇪🇸')).toBeCloseTo(one, 10); // regional indicator pair
    expect(textWidth('🇪🇸🇫🇷')).toBeCloseTo(2 * one, 10);
    // A lone indicator does not pair with one after other text.
    expect(textWidth('🇪x🇸')).toBeCloseTo(2 * one + textWidth('x'), 10);
    expect(textWidth('\u200b\ufeff')).toBe(0);
  });

  it('never shrinks as text grows, and stays finite on any input', () => {
    const sample = 'Aé日→🙂\u0301\u0000 x·×Ω∑¿';
    let previous = 0;
    for (let i = 1; i <= sample.length; i += 1) {
      const width = textWidth(sample.slice(0, i));
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeGreaterThanOrEqual(previous);
      previous = width;
    }
  });
});

describe('maths estimate', () => {
  it('uses KaTeX math-italic widths for letters and upright ones for digits and Greek capitals', () => {
    expect(em('Q')).toBeCloseTo(0.791, 3);
    expect(em('x')).toBeCloseTo(0.572, 3);
    expect(em('2')).toBeCloseTo(0.5, 3);
    expect(em('\\alpha')).toBeCloseTo(0.643, 3);
    expect(em('α')).toBeCloseTo(0.643, 3);
    expect(em('\\Sigma')).toBeCloseTo(0.722, 3);
  });

  it('adds TeX spacing around binary operators and relations', () => {
    expect(em('a+b')).toBeCloseTo(0.529 + 0.778 + 0.429 + (2 * 4) / 18, 3);
    expect(em('a=b')).toBeCloseTo(0.529 + 0.778 + 0.429 + (2 * 5) / 18, 3);
    expect(em('a \\times b')).toBeCloseTo(em('a+b'), 3);
  });

  it('turns a leading or post-relation operator into a unary sign', () => {
    expect(em('-x')).toBeCloseTo(0.778 + 0.572, 3);
    expect(em('a=-b')).toBeCloseTo(0.529 + 0.778 + 0.778 + 0.429 + (2 * 5) / 18, 3);
  });

  it('sets scripts at 0.72 size without operator spacing', () => {
    expect(em('x^{a+b}')).toBeCloseTo(0.572 + 0.72 * (0.529 + 0.778 + 0.429) + 0.05, 3);
    expect(em('W^Q')).toBeCloseTo(1.083 + 0.72 * 0.791 + 0.05, 3);
  });

  it('tucks a subscript under the italic correction', () => {
    expect(em('W_i')).toBeCloseTo(1.083 - 0.139 + 0.72 * 0.345 + 0.05, 3);
    expect(em('h_t')).toBeCloseTo(0.576 + 0.72 * 0.361 + 0.05, 3);
    expect(em('W_i^Q')).toBeCloseTo(em('W^Q'), 3);
  });

  it('keeps simple maths at a text line and grows for stacking', () => {
    expect(estimateMath('W^Q').height).toBe(FIGURE_METRICS.lineHeight);
    expect(estimateMath('W_i^Q').height).toBeCloseTo(1.35, 3);
    expect(estimateMath('\\frac{a}{b}').height).toBeCloseTo(1.6, 3);
    expect(estimateMath('\\frac{QK^\\top}{\\sqrt{d_k}}').height).toBeCloseTo(1.75, 3);
    expect(estimateMath('\\dfrac{a}{b}').height).toBeCloseTo(1.95, 3);
    expect(estimateMath('\\frac{\\frac{a}{b}}{c}').height).toBeGreaterThan(estimateMath('\\frac{a}{b}').height);
  });

  it('sets fraction parts one size smaller, between null delimiters', () => {
    expect(em('\\frac{a}{b}')).toBeCloseTo(0.72 * 0.529 + 0.24, 3);
    expect(em('\\dfrac{a}{b}')).toBeCloseTo(0.529 + 0.24, 3);
    expect(em('{a \\over b}')).toBeCloseTo(em('\\frac{a}{b}'), 3);
    expect(em('\\binom{n}{k}')).toBeCloseTo(em('{n \\choose k}'), 3);
  });

  it('reads font commands, text and operator names', () => {
    expect(em('\\mathbf{x}')).toBeCloseTo(0.528 * 1.14, 3);
    expect(em('\\text{a b}')).toBeCloseTo(0.5 + 0.25 + 0.556, 3);
    expect(em('\\mathrm{softmax}')).toBeCloseTo(3.45, 3);
    expect(em('\\operatorname{softmax}')).toBeCloseTo(3.45, 3);
    expect(em('\\log x')).toBeCloseTo(1.278 + 3 / 18 + 0.572, 3);
    expect(em('\\mathcal{L}')).toBeCloseTo(0.69, 3);
    expect(em('\\mathbb{R}')).toBeCloseTo(0.722, 3);
  });

  it('grows delimiters with what they enclose', () => {
    expect(em('\\left( x \\right)')).toBeCloseTo(0.572 + 2 * 0.389, 3);
    expect(em('\\left( x^2 \\right)')).toBeCloseTo(em('x^2') + 2 * 0.458, 3);
    expect(em('\\bigl( x \\bigr)')).toBeCloseTo(0.572 + 2 * 0.458, 3);
    expect(em('\\begin{pmatrix} a \\\\ b \\end{pmatrix}')).toBeCloseTo(0.529 + 2 * 0.736, 3);
    expect(em('\\begin{pmatrix} a \\\\ b \\\\ c \\end{pmatrix}')).toBeCloseTo(0.529 + 2 * 0.875, 3);
  });

  it('lays out matrices by column, a row per line', () => {
    const matrix = estimateMath('\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}');
    expect(matrix.width).toBeCloseTo(0.529 + 0.52 + 1 + 2 * 0.528, 3);
    expect(matrix.height).toBeCloseTo(FIGURE_METRICS.lineHeight + 1.2, 3);
    // A trailing \\ adds no row.
    expect(estimateMath('\\begin{matrix} a \\\\ b \\\\ \\end{matrix}')).toEqual(
      estimateMath('\\begin{matrix} a \\\\ b \\end{matrix}'),
    );
  });

  it('gives stretchy constructs their minimum width', () => {
    expect(em('\\xrightarrow{f}')).toBeCloseTo(1.469, 3);
    expect(em('\\overbrace{abc}^{n}')).toBeCloseTo(1.6, 3);
    expect(em('\\overrightarrow{x}')).toBeCloseTo(0.888, 3);
    expect(em('\\hat{x}')).toBeCloseTo(0.572, 3);
  });

  it('counts an unknown command as one symbol', () => {
    expect(em('\\unknownsymbol')).toBeCloseTo(0.778, 3);
  });

  it('never goes negative', () => {
    expect(em('\\hspace{-100em}x')).toBe(0);
    expect(em('\\!\\!\\!')).toBe(0);
  });

  it('survives pathological input with finite numbers', () => {
    const inputs = [
      '{'.repeat(500) + 'x' + '}'.repeat(500),
      '}}}{{{',
      '\\',
      'x^',
      '^_^_',
      "f''''",
      '\\toString \\constructor \\__proto__',
      '\\begin{constructor} a \\end{constructor}',
      '\\begin{matrix} a & b',
      '\\left( \\frac{a}{b}',
      '\\right)',
      '\\sqrt[',
      '\\frac',
      '% only a comment',
      '\\text{unclosed',
      '\\kern',
      '\\def\\x#1{#1}\\x{a}',
      'x'.repeat(5000),
    ];
    for (const latex of inputs) {
      const { width, height } = estimateMath(latex);
      expect(Number.isFinite(width), latex).toBe(true);
      expect(width, latex).toBeGreaterThanOrEqual(0);
      expect(height, latex).toBeGreaterThanOrEqual(FIGURE_METRICS.lineHeight);
    }
  });

  it('is deterministic and cached', () => {
    expect(estimateMath('\\mathbf{c}_t^{KV}')).toBe(estimateMath('\\mathbf{c}_t^{KV}'));
  });
});

describe('heuristic maths measurement', () => {
  it('scales the estimate by the font size, ignoring weight and style', () => {
    const plain = heuristic.math('W^Q', SANS);
    expect(plain).toEqual({ width: em('W^Q') * 12, height: LINE });
    expect(heuristic.math('W^Q', figureFont('serif', 12, 700, true))).toEqual(plain);
    expect(heuristic.math('W^Q', figureFont('sans', 24)).width).toBeCloseTo(2 * plain.width, 10);
  });

  it('measures LaTeX KaTeX rejects as its source text, since KaTeX shows it that way', () => {
    for (const latex of ['\\frac{a', 'x^^', '\\notacommand x']) {
      expect(heuristic.math(latex, SANS)).toEqual({ width: textWidth(latex), height: LINE });
    }
  });

  it('measures empty maths as nothing, one line tall', () => {
    expect(heuristic.math('', SANS)).toEqual({ width: 0, height: LINE });
    expect(heuristic.math('   ', SANS)).toEqual({ width: 0, height: LINE });
  });
});

describe('figureMathHtml', () => {
  it('renders valid LaTeX as KaTeX HTML without MathML', () => {
    const result = figureMathHtml('\\mathbf{c}_t^{KV}');
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.html).toContain('class="katex"');
    expect(result.html).not.toContain('katex-mathml');
  });

  it('reports invalid LaTeX and still renders its source', () => {
    const result = figureMathHtml('\\frac{a');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(/^KaTeX parse error/);
    expect(result.html).toContain('katex-error');
    expect(result.html).toContain('\\frac{a');
  });

  it('accepts what strict mode would reject', () => {
    expect(figureMathHtml('é + x').ok).toBe(true);
  });

  it('never emits links or raw markup', () => {
    expect(figureMathHtml('\\href{javascript:alert(1)}{x}').html).not.toMatch(/href=/);
    expect(figureMathHtml('\\url{https://example.com}').html).not.toMatch(/href=/);
    expect(figureMathHtml('\\text{<script>alert(1)</script>}').html).not.toContain('<script>');
    expect(figureMathHtml('\\htmlClass{evil}{x}').html).not.toContain('class="evil');
  });

  it('caches results and evicts the least recently used past 256', () => {
    const first = figureMathHtml('y_{cache}');
    expect(figureMathHtml('y_{cache}')).toBe(first);
    for (let i = 0; i < 300; i += 1) figureMathHtml(`z_{${i}}`);
    const again = figureMathHtml('y_{cache}');
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * DOM measurer
 * ──────────────────────────────────────────────────────────────────────── */

type FakeContext = { font: string; measureText: ReturnType<typeof vi.fn> };

/** A 2D context stand-in: 7px per character, optional font bounding box. */
function stubCanvas(bounding: { ascent?: number; descent?: number } = { ascent: 11.6, descent: 2.9 }): {
  ctx: FakeContext;
  fonts: string[];
} {
  const fonts: string[] = [];
  const ctx: FakeContext = {
    font: '',
    measureText: vi.fn((value: string) => {
      fonts.push(ctx.font);
      return {
        width: [...value].length * 7,
        fontBoundingBoxAscent: bounding.ascent,
        fontBoundingBoxDescent: bounding.descent,
      };
    }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  return { ctx, fonts };
}

type Seen = { html: string; fontSize: string; fontFamily: string; fontWeight: string; fontStyle: string };

/** Gives elements a layout: every rect is `width × height`. */
function stubLayout(width: number, height: number): Seen[] {
  const seen: Seen[] = [];
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const { fontSize, fontFamily, fontWeight, fontStyle } = this.style;
    seen.push({ html: this.innerHTML, fontSize, fontFamily, fontWeight, fontStyle });
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
  });
  return seen;
}

describe('createDomMeasurer', () => {
  it('returns null without a 2D canvas, as in jsdom, without throwing', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(createDomMeasurer(document)).toBeNull();
  });

  it('returns null when the canvas is blocked and throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(createDomMeasurer(document)).toBeNull();
  });

  it('measures text with canvas in the figure font stack', () => {
    const { fonts } = stubCanvas();
    const measurer = createDomMeasurer(document)!;
    expect(measurer.key).toMatch(/^dom:\d+$/);
    expect(measurer.text('Linear', figureFont('serif', 11, 600, true))).toEqual({ width: 42, height: 11.6 + 2.9 });
    expect(fonts[0]).toMatch(/^italic 600 11px "Source Serif 4", /);
    measurer.text('Linear', SANS);
    expect(fonts[1]).toMatch(/^400 12px Inter, /);
  });

  it('falls back to the face’s extent when canvas reports no bounding box', () => {
    stubCanvas({});
    expect(createDomMeasurer(document)!.text('x', SANS).height).toBeCloseTo(12 * 1.21, 10);
  });

  it('caches text per font and value', () => {
    const { ctx } = stubCanvas();
    const measurer = createDomMeasurer(document)!;
    measurer.text('Norm', SANS);
    measurer.text('Norm', SANS);
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
    measurer.text('Norm', figureFont('sans', 12, 600));
    expect(ctx.measureText).toHaveBeenCalledTimes(2);
  });

  it('falls back to the heuristic for maths when the element has no layout (jsdom)', () => {
    stubCanvas();
    const measurer = createDomMeasurer(document)!;
    expect(measurer.math('W^Q', SANS)).toEqual(heuristic.math('W^Q', SANS));
  });

  it('measures maths in a hidden KaTeX host styled like the label', () => {
    stubCanvas();
    const seen = stubLayout(42, 20);
    const measurer = createDomMeasurer(document)!;
    expect(measurer.math('W^Q', figureFont('sans', 12, 600, true))).toEqual({ width: 42, height: 20 });
    expect(seen).toHaveLength(1);
    expect(seen[0].html).toContain('class="katex"');
    expect(seen[0]).toMatchObject({ fontSize: '12px', fontWeight: '600', fontStyle: 'italic' });
    expect(seen[0].fontFamily).toContain('Inter');

    const host = document.querySelector<HTMLElement>('div[data-cwfig-measure]')!;
    expect(host.className).toBe(FIGURE_MATH_CLASS);
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.style.position).toBe('absolute');
    expect(host.style.visibility).toBe('hidden');
    // Emptied after each measurement.
    expect(host.innerHTML).toBe('');
  });

  it('never reports maths shorter than a text line', () => {
    stubCanvas();
    stubLayout(30, 5);
    expect(createDomMeasurer(document)!.math('x', SANS)).toEqual({ width: 30, height: LINE });
  });

  it('caches maths per font and LaTeX', () => {
    stubCanvas();
    const seen = stubLayout(42, 20);
    const measurer = createDomMeasurer(document)!;
    measurer.math('h_t', SANS);
    measurer.math('h_t', SANS);
    expect(seen).toHaveLength(1);
    measurer.math('h_t', SERIF);
    expect(seen).toHaveLength(2);
  });

  it('measures empty maths without touching the DOM', () => {
    stubCanvas();
    const seen = stubLayout(42, 20);
    expect(createDomMeasurer(document)!.math('  ', SANS)).toEqual({ width: 0, height: LINE });
    expect(seen).toHaveLength(0);
    expect(document.querySelector('div[data-cwfig-measure]')).toBeNull();
  });

  it('draws invalid LaTeX the way KaTeX shows it, in the host', () => {
    stubCanvas();
    const seen = stubLayout(50, 15);
    createDomMeasurer(document)!.math('\\frac{a', SANS);
    expect(seen[0].html).toContain('katex-error');
  });

  it('injects the maths CSS once and shares one host between measurers', () => {
    stubCanvas();
    stubLayout(42, 20);
    createDomMeasurer(document)!.math('a', SANS);
    createDomMeasurer(document)!.math('b', SANS);
    const styles = document.querySelectorAll('#cwfig-measure-style');
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe(FIGURE_MATH_CSS);
    expect(styles[0].parentElement).toBe(document.head);
    expect(document.querySelectorAll('div[data-cwfig-measure]')).toHaveLength(1);
  });

  it('re-attaches its host when the page body is replaced', () => {
    stubCanvas();
    const seen = stubLayout(42, 20);
    const measurer = createDomMeasurer(document)!;
    measurer.math('a', SANS);
    document.body.innerHTML = '';
    measurer.math('b', SANS);
    expect(seen).toHaveLength(2);
    expect(document.querySelectorAll('div[data-cwfig-measure]')).toHaveLength(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Shared measurer, font generations, font loading
 * (fresh module state per test: the watcher and generation are module-level)
 * ──────────────────────────────────────────────────────────────────────── */

type FakeFontSet = EventTarget & {
  status: 'loading' | 'loaded';
  ready: Promise<void>;
  load: ReturnType<typeof vi.fn>;
  resolveReady: () => void;
};

function installFonts(status: FakeFontSet['status'] = 'loaded'): FakeFontSet {
  let resolveReady = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const fonts = Object.assign(new EventTarget(), {
    status,
    ready,
    load: vi.fn(async () => []),
    resolveReady: () => resolveReady(),
  });
  Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
  return fonts;
}

async function freshMeasure() {
  vi.resetModules();
  return import('../measure');
}

describe('getFigureMeasurer and font changes', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'fonts');
  });

  it('uses the heuristic in jsdom without asking for a canvas', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const { getFigureMeasurer } = await freshMeasure();
    const measurer = getFigureMeasurer();
    expect(measurer.key).toBe('heuristic');
    expect(getFigureMeasurer()).toBe(measurer);
    expect(getContext).not.toHaveBeenCalled();
  });

  it('uses one DOM measurer per font generation in a browser', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0');
    stubCanvas();
    const fonts = installFonts();
    const { getFigureMeasurer } = await freshMeasure();
    const first = getFigureMeasurer();
    expect(first.key).toBe('dom:0');
    expect(getFigureMeasurer()).toBe(first);
    fonts.dispatchEvent(new Event('loadingdone'));
    const second = getFigureMeasurer();
    expect(second).not.toBe(first);
    expect(second.key).toBe('dom:1');
  });

  it('is a no-op subscription outside a browser font set', async () => {
    const { onFigureFontsChange } = await freshMeasure();
    const listener = vi.fn();
    const unsubscribe = onFigureFontsChange(listener);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies on loadingdone and changes the DOM measurer key', async () => {
    stubCanvas();
    const fonts = installFonts();
    const { onFigureFontsChange, createDomMeasurer: create } = await freshMeasure();
    const listener = vi.fn();
    const unsubscribe = onFigureFontsChange(listener);
    const before = create(document)!.key;
    fonts.dispatchEvent(new Event('loadingdone'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(create(document)!.key).not.toBe(before);
    unsubscribe();
    fonts.dispatchEvent(new Event('loadingdone'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies once fonts that were loading are ready', async () => {
    const fonts = installFonts('loading');
    const { onFigureFontsChange } = await freshMeasure();
    const listener = vi.fn();
    onFigureFontsChange(listener);
    fonts.resolveReady();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
  });

  it('does not wait on ready when fonts were already loaded', async () => {
    const fonts = installFonts('loaded');
    const { onFigureFontsChange } = await freshMeasure();
    const listener = vi.fn();
    onFigureFontsChange(listener);
    fonts.resolveReady();
    await Promise.resolve();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps notifying the others when one listener throws, and rethrows it later', async () => {
    const fonts = installFonts();
    const { onFigureFontsChange } = await freshMeasure();
    const scheduled: Array<() => void> = [];
    onFigureFontsChange(() => {
      throw new Error('boom');
    });
    const after = vi.fn();
    onFigureFontsChange(after);
    const microtask = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      scheduled.push(callback);
    });
    fonts.dispatchEvent(new Event('loadingdone'));
    microtask.mockRestore();
    expect(after).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);
    expect(() => scheduled[0]()).toThrow('boom');
  });
});

describe('loadFigureFont', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'fonts');
  });

  it('does nothing for the sans face, which the app already loads', async () => {
    const fonts = installFonts();
    const { loadFigureFont } = await freshMeasure();
    loadFigureFont('sans');
    await Promise.resolve();
    expect(fonts.load).not.toHaveBeenCalled();
  });

  it('loads Source Serif once, all four faces, then announces it', async () => {
    const fonts = installFonts();
    const { loadFigureFont, onFigureFontsChange } = await freshMeasure();
    const listener = vi.fn();
    onFigureFontsChange(listener);
    loadFigureFont('serif');
    loadFigureFont('serif');
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(fonts.load).toHaveBeenCalledTimes(4);
    expect(fonts.load.mock.calls.map(([face]) => face)).toEqual([
      '400 12px "Source Serif 4"',
      '600 12px "Source Serif 4"',
      '700 12px "Source Serif 4"',
      'italic 400 12px "Source Serif 4"',
    ]);
  });

  it('allows a retry after a failed load', async () => {
    const fonts = installFonts();
    fonts.load.mockRejectedValueOnce(new Error('offline'));
    const { loadFigureFont, onFigureFontsChange } = await freshMeasure();
    const listener = vi.fn();
    onFigureFontsChange(listener);
    loadFigureFont('serif');
    await vi.waitFor(() => expect(fonts.load).toHaveBeenCalledTimes(4));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).not.toHaveBeenCalled();
    loadFigureFont('serif');
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(fonts.load).toHaveBeenCalledTimes(8);
  });
});
