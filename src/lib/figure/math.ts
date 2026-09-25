import katex from 'katex';
import { FIGURE_METRICS } from './constants';

/**
 * Maths in figure labels.
 *
 * `figureMathHtml` is the one place a label's LaTeX becomes markup, so the
 * editor, the SVG download and the DOM measurer all draw the same thing.
 *
 * `estimateMath` predicts how wide KaTeX draws an expression when there is
 * no layout engine to ask (tests, SSR, jsdom). A small reader walks the
 * LaTeX and adds up KaTeX's own font metrics (advance + italic correction,
 * from katex 0.18's `fontMetricsData`) with TeX's inter-atom spacing, script
 * sizes, fraction and delimiter rules. Checked against KaTeX in Chrome, the
 * common figure maths (`W^Q`, `\mathbf{c}_t^{KV}`, `\frac{QK^\top}{\sqrt{d_k}}`,
 * `x \in \mathbb{R}^{n\times d}`, matrices) lands within ±3%.
 */

export type FigureMathResult = { html: string; ok: boolean; error?: string };

/* ────────────────────────────────────────────────────────────────────────
 * KaTeX markup
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Lenient options: a label is often the assistant's LaTeX, and KaTeX's
 * strict mode rejects input that renders fine. `trust` stays off, so no
 * `\href`, `\url` or raw HTML reaches the figure. HTML only: the SVG carries
 * its own accessible name, and MathML would double the markup.
 */
const KATEX_OPTIONS = {
  displayMode: false,
  strict: 'ignore',
  trust: false,
  output: 'html',
  maxExpand: 1000,
} as const;

/** Map-backed LRU: insertion order doubles as recency order. */
class Lru<V> {
  private readonly entries = new Map<string, V>();
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }
}

const htmlCache = new Lru<FigureMathResult>(256);

/**
 * KaTeX HTML for one maths segment of a label (no `$` delimiters).
 *
 * A first pass that throws on errors tells whether the LaTeX is valid (`ok`,
 * and `error` for the problems list); invalid LaTeX still gets KaTeX's
 * lenient rendering, which shows the source in the error colour instead of
 * nothing.
 */
export function figureMathHtml(latex: string): FigureMathResult {
  const cached = htmlCache.get(latex);
  if (cached) return cached;
  const result = renderFigureMath(latex);
  htmlCache.set(latex, result);
  return result;
}

function renderFigureMath(latex: string): FigureMathResult {
  try {
    return { html: katex.renderToString(latex, { ...KATEX_OPTIONS, throwOnError: true }), ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      html: renderLeniently(latex),
      ok: false,
      error: message.replace(/^KaTeX parse error:\s*/, ''),
    };
  }
}

function renderLeniently(latex: string): string {
  try {
    return katex.renderToString(latex, { ...KATEX_OPTIONS, throwOnError: false });
  } catch {
    // Only an internal KaTeX failure gets here; parse errors were rendered above.
    return `<span class="katex-error">${escapeHtml(latex)}</span>`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/* ────────────────────────────────────────────────────────────────────────
 * Width estimate: metrics
 * ──────────────────────────────────────────────────────────────────────── */

export type MathEstimate = {
  /** Advance width, in em of the label's font. */
  width: number;
  /** Line height the maths needs, in em: a plain line plus any stacking. */
  height: number;
};

type AtomClass = 'ord' | 'op' | 'bin' | 'rel' | 'open' | 'close' | 'punct' | 'inner';
/** TeX styles: display, text, script, scriptscript. */
type Level = 0 | 1 | 2 | 3;
type Variant = 'math' | 'rm' | 'it' | 'bf' | 'bi' | 'sf' | 'tt' | 'cal' | 'bb' | 'scr' | 'frak';
type Style = { level: Level; variant: Variant; size: number };

/** A laid-out piece of a formula; lengths are in em of the label's font. */
type Item = {
  /** TeX atom class; null for explicit space, which spacing rules skip over. */
  cls: AtomClass | null;
  width: number;
  /** Height needed beyond one plain line. */
  extra: number;
  /** Style level and size the item was set in: spacing scales with them. */
  level: Level;
  scale: number;
  /** Scripts stack above/below instead of beside (display `\sum`, `\overbrace`). */
  limits?: boolean;
  /** Rises above a capital (a superscript, a fraction): `\left(` and `\sqrt` grow. */
  tall?: boolean;
  /** Italic correction included in `width`; a subscript tucks back under it. */
  italic?: number;
};

type Box = { width: number; extra: number; cls: AtomClass; tall: boolean };

/**
 * Script size relative to text. KaTeX uses 0.7; the estimate rounds up to
 * 0.72 so it errs wide (a clipped label is worse than a pixel of air).
 */
const SCRIPT_SCALE = 0.72;
const LEVEL_SCALE = [1, 1, SCRIPT_SCALE, SCRIPT_SCALE * SCRIPT_SCALE] as const;
/** A plain line, em: maths that stacks nothing keeps a text label's height. */
const PLAIN_LINE = FIGURE_METRICS.lineHeight;
/** Height a fraction adds to a line (0.7 in display style). */
const FRACTION_EXTRA = 0.35;
/** More when a part rises above a capital itself (`\frac{QK^\top}{\sqrt{d_k}}`). */
const TALL_PART_EXTRA = 0.15;
/** Height a sub- and superscript pair adds; KaTeX keeps most within the line. */
const SCRIPT_PAIR_EXTRA = 0.1;
/** Height of display limits and brace annotations set above/below their base. */
const LIMIT_EXTRA = 0.5;
/** Height of a small note set over/under a symbol (`\overset`, `\xrightarrow`). */
const NOTE_EXTRA = 0.2;
const NULL_DELIMITER = 0.12;
const SCRIPT_SPACE = 0.05;
const PRIME_WIDTH = 0.275;
/** A command this table does not know: most are symbols about a relation wide. */
const UNKNOWN_COMMAND = 0.778;
/** Display-style big operators come from KaTeX_Size2 instead of Size1. */
const DISPLAY_OPERATOR = 1.37;
/** Deepest brace nesting read structurally; past it tokens count flat. */
const MAX_DEPTH = 48;

/** KaTeX_Main-Regular advances, ‰ em, for ASCII 33–126 (`!` … `~`). */
const MAIN_ASCII = [
  278, 500, 833, 500, 833, 778, 278, 389, 389, 500, 778, 278, 333, 278, 500, 500, 500, 500, 500, 500, 500, 500,
  500, 500, 500, 278, 278, 778, 778, 778, 472, 778, 750, 708, 722, 764, 681, 653, 785, 750, 361, 514, 778, 625,
  917, 750, 778, 681, 778, 736, 556, 722, 750, 750, 1028, 750, 750, 611, 278, 500, 278, 500, 500, 500, 500, 556,
  444, 556, 444, 306, 500, 556, 278, 306, 528, 278, 833, 556, 500, 556, 528, 392, 394, 389, 556, 528, 722, 528,
  528, 444, 500, 278, 500, 500,
];

/** KaTeX_Math-Italic advance + italic correction, ‰ em: a–z, then A–Z. */
const MATH_ITALIC = [
  529, 429, 433, 520, 466, 597, 513, 576, 345, 469, 552, 318, 878, 600, 485, 503, 482, 479, 469, 361, 572, 521,
  743, 572, 526, 509, 750, 809, 786, 856, 796, 782, 786, 913, 518, 651, 921, 681, 1079, 913, 791, 781, 791, 767,
  671, 723, 792, 806, 1083, 907, 803, 754,
];

/** The italic corrections included in MATH_ITALIC, ‰ em (letters not listed have none). */
const ITALIC_CORRECTION: Record<string, number> = {
  f: 108, g: 36, j: 57, k: 31, l: 20, q: 36, r: 28, v: 36, w: 27, y: 36, z: 44, B: 50, C: 72, D: 28, E: 58,
  F: 139, H: 81, I: 78, J: 96, K: 72, M: 109, N: 109, O: 28, P: 139, R: 8, S: 58, T: 139, U: 109, V: 222,
  W: 139, X: 78, Y: 222, Z: 72,
};

/** KaTeX_Caligraphic (`\mathcal`) and KaTeX_AMS (`\mathbb`) capitals, ‰ em. */
const CALLIGRAPHIC_UPPER = [
  798, 687, 585, 799, 617, 818, 654, 854, 618, 863, 776, 690, 1201, 968, 824, 778, 817, 848, 681, 799, 725, 695,
  1070, 860, 751, 804,
];
const BLACKBOARD_UPPER = [
  722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778, 611, 778, 722, 556, 667, 722, 722,
  1000, 722, 722, 667,
];

/** Width factors of other KaTeX faces against the tables above. */
const VARIANT_FACTOR: Record<Variant, number> = {
  math: 1,
  rm: 1,
  it: 1.08, // Main-Italic vs Math-Italic
  bf: 1.14, // Main-Bold vs Main-Regular
  bi: 1.15, // Math-BoldItalic vs Math-Italic
  sf: 0.93, // SansSerif vs Main-Regular
  tt: 1,
  cal: 1,
  bb: 1,
  scr: 1,
  frak: 1,
};
/** Bold Greek (`\boldsymbol{\theta}`, `\mathbf{\Sigma}`) against the regular glyphs. */
const BOLD_GREEK_FACTOR: Partial<Record<Variant, number>> = { bi: 1.19, bf: 1.15 };

/** Maths-mode ASCII that is not a plain ordinary: [class, width ‰ em]. */
const MATH_ASCII: Record<string, readonly [AtomClass, number]> = {
  '+': ['bin', 778],
  '-': ['bin', 778], // drawn as a minus sign
  '*': ['bin', 500],
  '=': ['rel', 778],
  '<': ['rel', 778],
  '>': ['rel', 778],
  ':': ['rel', 278],
  ',': ['punct', 278],
  ';': ['punct', 278],
  '(': ['open', 389],
  '[': ['open', 278],
  ')': ['close', 389],
  ']': ['close', 278],
  '!': ['close', 278],
  '?': ['close', 472],
};

/*
 * Named symbols, ‰ em from KaTeX's metrics: `names` are the commands (space
 * separated), `char` the Unicode character typed directly in maths (if any).
 */
type SymbolRow = readonly [names: string, char: string, width: number];

const GREEK: SymbolRow[] = [
  ['alpha', 'α', 643], ['beta', 'β', 618], ['gamma', 'γ', 573], ['delta', 'δ', 482], ['epsilon', 'ϵ', 406],
  ['varepsilon', 'ε', 466], ['zeta', 'ζ', 511], ['eta', 'η', 532], ['theta', 'θ', 497], ['vartheta', 'ϑ', 591],
  ['iota', 'ι', 354], ['kappa', 'κ', 576], ['lambda', 'λ', 583], ['mu', 'μ', 603], ['nu', 'ν', 558],
  ['xi', 'ξ', 484], ['omicron', 'ο', 485], ['pi', 'π', 606], ['varpi', 'ϖ', 856], ['rho', 'ρ', 517],
  ['varrho', 'ϱ', 517], ['sigma', 'σ', 607], ['varsigma', 'ς', 443], ['tau', 'τ', 550], ['upsilon', 'υ', 576],
  ['phi', 'ϕ', 596], ['varphi', 'φ', 654], ['chi', 'χ', 626], ['psi', 'ψ', 687], ['omega', 'ω', 658],
  ['Gamma', 'Γ', 625], ['Delta', 'Δ', 833], ['Theta', 'Θ', 778], ['Lambda', 'Λ', 694], ['Xi', 'Ξ', 667],
  ['Pi', 'Π', 750], ['Sigma', 'Σ', 722], ['Upsilon', 'Υ', 778], ['Phi', 'Φ', 722], ['Psi', 'Ψ', 778],
  ['Omega', 'Ω', 722],
];
const ORD_SYMBOLS: SymbolRow[] = [
  ['infty', '∞', 1000], ['partial', '∂', 587], ['nabla', '∇', 833], ['forall', '∀', 556], ['exists', '∃', 556],
  ['nexists', '∄', 556], ['neg lnot', '¬', 667], ['emptyset', '∅', 500], ['varnothing', '', 778],
  ['top', '⊤', 778], ['bot', '⊥', 778], ['ell', 'ℓ', 417], ['hbar', 'ℏ', 540], ['prime', '′', 275],
  ['Re', 'ℜ', 722], ['Im', 'ℑ', 722], ['aleph', 'ℵ', 611], ['wp', '℘', 636], ['angle', '∠', 722],
  ['triangle', '△', 889], ['imath', 'ı', 345], ['jmath', 'ȷ', 412], ['sharp', '♯', 389], ['flat', '♭', 389],
  ['natural', '♮', 389], ['clubsuit', '♣', 778], ['diamondsuit', '♢', 778], ['heartsuit', '♡', 778],
  ['spadesuit', '♠', 778], ['checkmark', '✓', 833], ['S', '§', 444], ['P', '¶', 611], ['vdots', '⋮', 278],
  ['surd', '√', 833], ['degree', '°', 400], ['backslash', '', 500], ['vert', '', 278], ['Vert |', '‖', 500],
  ['%', '', 833], ['#', '', 833], ['&', '', 778], ['_', '', 500], ['$', '', 500],
];
const BIN_SYMBOLS: SymbolRow[] = [
  ['times', '×', 778], ['cdot', '⋅', 278], ['cdotp', '·', 278], ['oplus', '⊕', 778], ['otimes', '⊗', 778],
  ['odot', '⊙', 778], ['ominus', '⊖', 778], ['oslash', '⊘', 778], ['pm', '±', 778], ['mp', '∓', 778],
  ['div', '÷', 778], ['ast', '∗', 500], ['star', '⋆', 500], ['circ', '∘', 500], ['bullet', '∙', 500],
  ['wedge land', '∧', 667], ['vee lor', '∨', 667], ['cup', '∪', 667], ['cap', '∩', 667], ['setminus', '∖', 500],
  ['sqcup', '⊔', 667], ['sqcap', '⊓', 667], ['uplus', '⊎', 667], ['diamond', '⋄', 500],
  ['bigtriangleup', '', 889], ['bigtriangledown', '▽', 889], ['triangleleft', '◃', 500],
  ['triangleright', '▹', 500], ['amalg', '⨿', 750], ['wr', '≀', 278], ['dagger', '†', 444],
  ['ddagger', '‡', 444], ['', '−', 778],
];
const REL_SYMBOLS: SymbolRow[] = [
  ['leq le', '≤', 778], ['geq ge', '≥', 778], ['neq ne', '≠', 778], ['approx', '≈', 778], ['equiv', '≡', 778],
  ['sim', '∼', 778], ['simeq', '≃', 778], ['cong', '≅', 778], ['propto', '∝', 778], ['in', '∈', 667],
  ['notin', '∉', 667], ['ni owns', '∋', 667], ['subset', '⊂', 778], ['subseteq', '⊆', 778], ['supset', '⊃', 778],
  ['supseteq', '⊇', 778], ['to rightarrow', '→', 1000], ['leftarrow gets', '←', 1000],
  ['leftrightarrow', '↔', 1000], ['Rightarrow', '⇒', 1000], ['Leftarrow', '⇐', 1000],
  ['Leftrightarrow', '⇔', 1000], ['mapsto', '↦', 1000], ['longrightarrow', '⟶', 1638],
  ['longleftarrow', '⟵', 1609], ['Longrightarrow', '⟹', 1638], ['Longleftarrow', '⟸', 1609],
  ['longleftrightarrow', '⟷', 1859], ['Longleftrightarrow', '⟺', 1858], ['longmapsto', '⟼', 1638],
  ['hookrightarrow', '↪', 1126], ['hookleftarrow', '↩', 1126], ['rightleftharpoons', '⇌', 1000],
  ['uparrow', '↑', 500], ['downarrow', '↓', 500], ['updownarrow', '↕', 500], ['Uparrow', '⇑', 611],
  ['Downarrow', '⇓', 611], ['nearrow', '↗', 1000], ['searrow', '↘', 1000], ['nwarrow', '↖', 1000],
  ['swarrow', '↙', 1000], ['ll', '≪', 1000], ['gg', '≫', 1000], ['prec', '≺', 778], ['succ', '≻', 778],
  ['preceq', '⪯', 778], ['succeq', '⪰', 778], ['mid', '∣', 278], ['parallel', '∥', 500], ['perp', '', 778],
  ['models', '⊨', 867], ['vdash', '⊢', 611], ['dashv', '⊣', 611], ['doteq', '≐', 778], ['asymp', '≍', 778],
  ['bowtie', '⋈', 900], ['coloneqq', '≔', 990], ['leqslant', '⩽', 778], ['geqslant', '⩾', 778],
  ['lesssim', '≲', 778], ['gtrsim', '≳', 778], ['triangleq', '≜', 778],
  // These carry their own \; on both sides.
  ['implies', '', 2194], ['impliedby', '', 2165], ['iff', '', 2414],
];
const OPEN_SYMBOLS: SymbolRow[] = [
  ['langle', '⟨', 389], ['lceil', '⌈', 444], ['lfloor', '⌊', 444], ['lvert', '', 278], ['lVert', '', 500],
  ['lbrace {', '', 500], ['lbrack', '', 278], ['lparen', '', 389], ['lgroup', '⟮', 667],
];
const CLOSE_SYMBOLS: SymbolRow[] = [
  ['rangle', '⟩', 389], ['rceil', '⌉', 444], ['rfloor', '⌋', 444], ['rvert', '', 278], ['rVert', '', 500],
  ['rbrace }', '', 500], ['rbrack', '', 278], ['rparen', '', 389], ['rgroup', '⟯', 667],
];
const INNER_SYMBOLS: SymbolRow[] = [
  ['ldots dots dotsc dotsb dotsm dotsi dotso', '…', 1172], ['cdots', '⋯', 1172], ['ddots', '⋱', 1282],
];
const PUNCT_SYMBOLS: SymbolRow[] = [['colon', '', 278]];
/** Big operators, textstyle (KaTeX_Size1) widths with italic correction. */
const OP_SYMBOLS: SymbolRow[] = [
  ['sum', '∑', 1056], ['prod', '∏', 944], ['coprod', '∐', 944], ['int', '∫', 667], ['iint', '∬', 1000],
  ['iiint', '∭', 1333], ['oint', '∮', 667], ['bigcup', '⋃', 833], ['bigcap', '⋂', 833],
  ['bigoplus', '⨁', 1111], ['bigotimes', '⨂', 1111], ['bigodot', '⨀', 1111], ['bigvee', '⋁', 833],
  ['bigwedge', '⋀', 833], ['bigsqcup', '⨆', 833], ['biguplus', '⨄', 833],
];

type SymbolInfo = { cls: AtomClass; width: number; greek: boolean };
const SYMBOLS = new Map<string, SymbolInfo>();
const UNICODE_SYMBOLS = new Map<string, SymbolInfo>();
for (const [cls, rows] of [
  ['ord', GREEK],
  ['ord', ORD_SYMBOLS],
  ['bin', BIN_SYMBOLS],
  ['rel', REL_SYMBOLS],
  ['open', OPEN_SYMBOLS],
  ['close', CLOSE_SYMBOLS],
  ['inner', INNER_SYMBOLS],
  ['punct', PUNCT_SYMBOLS],
  ['op', OP_SYMBOLS],
] as const) {
  for (const [names, char, width] of rows) {
    const info = { cls, width: width / 1000, greek: rows === GREEK };
    for (const name of names.split(' ')) if (name) SYMBOLS.set(name, info);
    if (char && !UNICODE_SYMBOLS.has(char)) UNICODE_SYMBOLS.set(char, info);
  }
}

/** Operator names set upright (`\log`, `\max`…): command → the text KaTeX draws. */
const OPERATOR_NAMES = new Map<string, string>([
  ...(
    'arcsin arccos arctan arctg arcctg arg ch cos cosec cosh cot cotg coth csc ctg cth deg dim exp hom ker lg ' +
    'ln log sec sin sinh sh tan tanh tg th det gcd inf lim max min Pr sup plim'
  )
    .split(' ')
    .map((name): [string, string] => [name, name]),
  ['argmax', 'arg max'],
  ['argmin', 'arg min'],
  ['liminf', 'lim inf'],
  ['limsup', 'lim sup'],
  ['injlim', 'inj lim'],
  ['projlim', 'proj lim'],
]);
/** Operators that take limits above/below in display style. */
const LIMIT_OPERATORS = new Set(
  'det gcd inf lim max min Pr sup plim argmax argmin liminf limsup injlim projlim'.split(' '),
);

/** Explicit spacing commands, em at the current size. */
const SPACES: Record<string, number> = {
  ',': 3 / 18,
  thinspace: 3 / 18,
  ':': 4 / 18,
  '>': 4 / 18,
  medspace: 4 / 18,
  ';': 5 / 18,
  thickspace: 5 / 18,
  '!': -3 / 18,
  negthinspace: -3 / 18,
  negmedspace: -4 / 18,
  negthickspace: -5 / 18,
  quad: 1,
  qquad: 2,
  enspace: 0.5,
  ' ': 0.25,
  '\t': 0.25,
  '\n': 0.25,
  nobreakspace: 0.25,
  space: 0.25,
};

const FONT_COMMANDS: Record<string, Variant> = {
  mathrm: 'rm',
  mathnormal: 'math',
  mathit: 'it',
  mathbf: 'bf',
  bold: 'bf',
  mathsf: 'sf',
  mathtt: 'tt',
  mathcal: 'cal',
  mathscr: 'scr',
  mathbb: 'bb',
  Bbb: 'bb',
  mathfrak: 'frak',
  frak: 'frak',
  boldsymbol: 'bi',
  bm: 'bi',
};

/** Old-style switches that change the font for the rest of the group. */
const FONT_SWITCHES: Record<string, Variant> = { rm: 'rm', bf: 'bf', it: 'it', sf: 'sf', tt: 'tt', cal: 'cal' };

const TEXT_COMMANDS: Record<string, Variant> = {
  text: 'rm',
  textrm: 'rm',
  textnormal: 'rm',
  textup: 'rm',
  textmd: 'rm',
  mbox: 'rm',
  hbox: 'rm',
  textbf: 'bf',
  textit: 'it',
  textsl: 'it',
  emph: 'it',
  textsf: 'sf',
  texttt: 'tt',
};

const SIZES: Record<string, number> = {
  tiny: 0.5,
  scriptsize: 0.7,
  footnotesize: 0.8,
  small: 0.9,
  normalsize: 1,
  large: 1.2,
  Large: 1.44,
  LARGE: 1.728,
  huge: 2.074,
  Huge: 2.488,
};

/** Accents and decorations: the base's width, or the stretchy glyph's minimum (em). */
const ACCENTS: Record<string, number> = {};
for (const name of (
  'hat check tilde acute grave dot ddot dddot breve bar vec mathring widehat widetilde widecheck utilde ' +
  'overline underline underbar cancel bcancel xcancel sout overgroup undergroup'
).split(' ')) {
  ACCENTS[name] = 0;
}
for (const name of (
  'overleftarrow overrightarrow overleftrightarrow underleftarrow underrightarrow underleftrightarrow ' +
  'Overrightarrow overleftharpoon overrightharpoon overlinesegment underlinesegment'
).split(' ')) {
  ACCENTS[name] = 0.888;
}

const CLASS_COMMANDS: Record<string, AtomClass> = {
  mathord: 'ord',
  mathop: 'op',
  mathbin: 'bin',
  mathrel: 'rel',
  mathopen: 'open',
  mathclose: 'close',
  mathpunct: 'punct',
  mathinner: 'inner',
};

/** Extensible arrows and their minimum widths (KaTeX's stretchy table), em. */
const EXTENSIBLE_ARROWS: Record<string, number> = {
  xrightarrow: 1.469,
  xleftarrow: 1.469,
  xhookrightarrow: 1.469,
  xhookleftarrow: 1.469,
  xtwoheadrightarrow: 1.469,
  xtwoheadleftarrow: 1.469,
  xrightharpoonup: 1.469,
  xrightharpoondown: 1.469,
  xleftharpoonup: 1.469,
  xleftharpoondown: 1.469,
  xRightarrow: 1.526,
  xLeftarrow: 1.526,
  xmapsto: 1.5,
  xlongequal: 0.888,
  xleftrightarrow: 1.75,
  xLeftrightarrow: 1.75,
  xrightleftharpoons: 1.75,
  xleftrightharpoons: 1.75,
  xtofrom: 1.75,
};

/** Delimiter widths, ‰ em: normal, KaTeX_Size1–Size4, then the extensible stack. */
const DELIMITER_SIZES = {
  paren: [389, 458, 597, 736, 792, 875],
  bracket: [278, 417, 472, 528, 583, 667],
  brace: [500, 583, 667, 750, 806, 889],
  angle: [389, 472, 611, 750, 806, 806],
  vert: [278, 333, 333, 333, 333, 333],
  doubleVert: [500, 556, 556, 556, 556, 556],
  ceil: [444, 472, 528, 583, 639, 667],
  slash: [500, 578, 811, 1044, 1278, 1278],
  arrow: [500, 667, 667, 667, 667, 667],
} as const;
type DelimiterKind = keyof typeof DELIMITER_SIZES;

const DELIMITER_KINDS: Record<string, DelimiterKind> = {};
for (const [kind, tokens] of [
  ['paren', '( ) \\lparen \\rparen'],
  ['bracket', '[ ] \\lbrack \\rbrack'],
  ['brace', '\\{ \\} \\lbrace \\rbrace'],
  ['angle', '< > ⟨ ⟩ \\langle \\rangle'],
  ['vert', '| \\vert \\lvert \\rvert \\mid'],
  ['doubleVert', '‖ \\| \\Vert \\lVert \\rVert'],
  ['ceil', '⌈ ⌉ ⌊ ⌋ \\lceil \\rceil \\lfloor \\rfloor'],
  ['slash', '/ \\backslash'],
] as const) {
  for (const token of tokens.split(' ')) DELIMITER_KINDS[token] = kind;
}

type EnvironmentSpec = { open?: string; close?: string; colSep: number; rowHeight: number; aligned?: boolean };
/** Array-like environments: delimiters, column gap and baseline distance (em). */
const ENVIRONMENTS: Record<string, EnvironmentSpec> = {
  matrix: { colSep: 1, rowHeight: 1.2 },
  pmatrix: { open: '(', close: ')', colSep: 1, rowHeight: 1.2 },
  bmatrix: { open: '[', close: ']', colSep: 1, rowHeight: 1.2 },
  Bmatrix: { open: '\\{', close: '\\}', colSep: 1, rowHeight: 1.2 },
  vmatrix: { open: '|', close: '|', colSep: 1, rowHeight: 1.2 },
  Vmatrix: { open: '\\|', close: '\\|', colSep: 1, rowHeight: 1.2 },
  smallmatrix: { colSep: 0.333, rowHeight: 1.2 },
  cases: { open: '\\{', close: '.', colSep: 1, rowHeight: 1.75 },
  dcases: { open: '\\{', close: '.', colSep: 1, rowHeight: 1.75 },
  rcases: { open: '.', close: '\\}', colSep: 1, rowHeight: 1.75 },
  aligned: { colSep: 0, rowHeight: 1.45, aligned: true },
  alignedat: { colSep: 0, rowHeight: 1.45, aligned: true },
  split: { colSep: 0, rowHeight: 1.45, aligned: true },
  gathered: { colSep: 0, rowHeight: 1.45 },
  array: { colSep: 1, rowHeight: 1.2 },
  darray: { colSep: 1, rowHeight: 1.2 },
  subarray: { colSep: 0.333, rowHeight: 1.2 },
};

/*
 * TeX's inter-atom spacing (The TeXbook, ch. 18; tex.web §764), rows = left
 * atom, columns = right atom, both in CLASS_ORDER. 0 none, 1 thin space
 * except in scripts, 2 thin space, 3 medium space except in scripts,
 * 4 thick space except in scripts, * impossible (a bin becomes an ord first).
 */
const CLASS_ORDER: Record<AtomClass, number> = { ord: 0, op: 1, bin: 2, rel: 3, open: 4, close: 5, punct: 6, inner: 7 };
const SPACING = ['02340001', '22*40001', '33**3**3', '44*04004', '00*00000', '02340001', '11*11111', '12341011'];
const BIN_BLOCKERS = new Set<AtomClass>(['bin', 'op', 'rel', 'open', 'punct']);

/* ────────────────────────────────────────────────────────────────────────
 * Width estimate: layout rules
 * ──────────────────────────────────────────────────────────────────────── */

/** A table entry by name; `in` would also match `toString`, `constructor`… */
function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function spacing(left: AtomClass, right: AtomClass, item: Item): number {
  const code = SPACING[CLASS_ORDER[left]][CLASS_ORDER[right]];
  const tight = item.level >= 2;
  const mu = code === '2' || (code === '1' && !tight) ? 3 : code === '3' && !tight ? 4 : code === '4' && !tight ? 5 : 0;
  return (mu / 18) * item.scale;
}

/** A list's width: its items plus TeX spacing between neighbouring atoms. */
function listWidth(items: Item[]): number {
  // A binary operator with nothing to combine becomes an ordinary (−x, a = −b).
  const classes = items.map((item) => item.cls);
  let previous = -1;
  for (let i = 0; i < classes.length; i += 1) {
    const cls = classes[i];
    if (cls === null) continue;
    if (cls === 'bin' && (previous < 0 || BIN_BLOCKERS.has(classes[previous] ?? 'ord'))) classes[i] = 'ord';
    if ((cls === 'rel' || cls === 'close' || cls === 'punct') && previous >= 0 && classes[previous] === 'bin') {
      classes[previous] = 'ord';
    }
    previous = i;
  }
  if (previous >= 0 && classes[previous] === 'bin') classes[previous] = 'ord';

  let width = 0;
  let left: AtomClass | null = null;
  items.forEach((item, i) => {
    width += item.width;
    const cls = classes[i];
    if (cls === null) return;
    if (left !== null) width += spacing(left, cls, item);
    left = cls;
  });
  return width;
}

function boxOf(items: Item[]): Box {
  return {
    width: listWidth(items),
    extra: items.reduce((max, item) => Math.max(max, item.extra), 0),
    cls: items.length === 1 ? (items[0].cls ?? 'ord') : 'ord',
    tall: items.some((item) => item.tall === true),
  };
}

function scaleOf(style: Style): number {
  return LEVEL_SCALE[style.level] * style.size;
}

function scriptStyle(style: Style): Style {
  return { ...style, level: style.level <= 1 ? 2 : 3 };
}

/** Numerator/denominator style: one step smaller, display → text. */
function fractionStyle(style: Style, display: boolean): Style {
  return { ...style, level: display ? 1 : style.level <= 1 ? 2 : 3 };
}

function makeItem(
  style: Style,
  cls: AtomClass | null,
  width: number,
  extra = 0,
  flags: { limits?: boolean; tall?: boolean } = {},
): Item {
  // Enlarged text (\large…) is also taller than a plain line.
  const grown = Math.max(0, style.size - 1) * PLAIN_LINE;
  return { cls, width, extra: extra + grown, level: style.level, scale: scaleOf(style), ...flags };
}

function isAsciiLetter(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'));
}

function isBlank(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

/** Index of the `}` matching the `{` at `open` (or the end of the text). */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') i += 1;
    else if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return i;
  }
  return src.length;
}

/**
 * Tokens of maths-mode LaTeX: `\name` or `\x` for commands, otherwise one
 * character. Whitespace and `%` comments are skipped as TeX does.
 */
class Reader {
  private pos = 0;
  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  peek(): string | null {
    const at = this.pos;
    const token = this.next();
    this.pos = at;
    return token;
  }

  next(): string | null {
    this.skipBlank();
    const { src } = this;
    if (this.pos >= src.length) return null;
    if (src[this.pos] === '\\') {
      let end = this.pos + 1;
      while (isAsciiLetter(src[end])) end += 1;
      if (end === this.pos + 1) end = Math.min(end + 1, src.length);
      const token = src.slice(this.pos, end);
      this.pos = end;
      // A lone backslash at the very end draws nothing.
      return token.length > 1 ? token : this.next();
    }
    const ch = String.fromCodePoint(src.codePointAt(this.pos) ?? 0);
    this.pos += ch.length;
    return ch === '~' ? '\\nobreakspace' : ch;
  }

  /** Consume a `*` right after a command name (`\operatorname*`). */
  star(): boolean {
    if (this.src[this.pos] !== '*') return false;
    this.pos += 1;
    return true;
  }

  /** Raw text of the next argument: a braced group's inside, or one token. */
  rawArgument(): string {
    this.skipBlank();
    if (this.src[this.pos] !== '{') return this.next() ?? '';
    const close = matchBrace(this.src, this.pos);
    const inner = this.src.slice(this.pos + 1, close);
    this.pos = Math.min(close + 1, this.src.length);
    return inner;
  }

  /** Raw text of an optional `[…]` argument, or null when there is none. */
  rawOptional(): string | null {
    this.skipBlank();
    if (this.src[this.pos] !== '[') return null;
    let depth = 0;
    for (let i = this.pos + 1; i < this.src.length; i += 1) {
      const ch = this.src[i];
      if (ch === '\\') i += 1;
      else if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === ']' && depth <= 0) {
        const inner = this.src.slice(this.pos + 1, i);
        this.pos = i + 1;
        return inner;
      }
    }
    return null;
  }

  /** A TeX dimension such as `3pt`, `-1.5mu` or `{2em}`, in em (0 when unreadable). */
  dimension(): number {
    this.skipBlank();
    if (this.src[this.pos] === '{') return dimensionEm(this.rawArgument());
    const match = /^[+-]?\s*(?:\d+\.?\d*|\.\d+)\s*[a-z]{2}/.exec(this.src.slice(this.pos));
    if (!match) return 0;
    this.pos += match[0].length;
    return dimensionEm(match[0]);
  }

  private skipBlank(): void {
    const { src } = this;
    while (this.pos < src.length) {
      if (isBlank(src[this.pos])) this.pos += 1;
      else if (src[this.pos] === '%') {
        while (this.pos < src.length && src[this.pos] !== '\n') this.pos += 1;
      } else break;
    }
  }
}

const UNIT_EM: Record<string, number> = {
  em: 1,
  ex: 0.431,
  mu: 1 / 18,
  pt: 0.1,
  px: 0.1,
  bp: 0.1004,
  pc: 1.2,
  dd: 0.107,
  cc: 1.284,
  mm: 0.2845,
  cm: 2.845,
  in: 7.227,
};

function dimensionEm(text: string): number {
  const match = /^\s*([+-]?)\s*(\d+\.?\d*|\.\d+)\s*([a-z]{2})/.exec(text);
  if (!match) return 0;
  const value = Number(match[2]) * (lookup(UNIT_EM, match[3]) ?? 0);
  return match[1] === '-' ? -value : value;
}

const never = () => false;
const isCloseBrace = (token: string) => token === '}';

/** Parse tokens into items until `stop` matches (the stopping token is left unread). */
function parseList(r: Reader, initial: Style, depth: number, stop: (token: string) => boolean): Item[] {
  let style = initial;
  const items: Item[] = [];
  let infix: { at: number; delimited: boolean } | null = null;
  for (;;) {
    const token = r.peek();
    if (token === null || stop(token)) break;
    r.next();
    if (depth > MAX_DEPTH) {
      // Pathological nesting: count what is left flat instead of recursing.
      if (token !== '{' && token !== '}') items.push(makeItem(style, 'ord', 0.5 * scaleOf(style)));
      continue;
    }
    if (token === '^' || token === '_' || token === "'") {
      attachScripts(token, r, style, depth, items);
    } else if (token === '{') {
      const inner = parseList(r, style, depth + 1, isCloseBrace);
      if (r.peek() === '}') r.next();
      const box = boxOf(inner);
      items.push(makeItem(style, 'ord', box.width, box.extra, { tall: box.tall }));
    } else if (token === '}' || token === '&') {
      // Unbalanced or out of place: KaTeX reports it; nothing to draw here.
    } else if (token[0] === '\\') {
      const name = token.slice(1);
      const switched = switchStyle(name, style);
      if (switched) style = switched;
      else if (name === 'over' || name === 'choose' || name === 'atop' || name === 'above') {
        if (name === 'above') r.dimension();
        infix = { at: items.length, delimited: name === 'choose' };
      } else command(name, r, style, depth, items);
    } else {
      items.push(charItem(token, style));
    }
  }
  if (!infix) return items;
  // `{a \over b}`: everything before is the numerator, everything after the denominator.
  const display = initial.level === 0;
  const shrink = scaleOf(fractionStyle(initial, display)) / scaleOf(initial);
  const num = scaled(boxOf(items.slice(0, infix.at)), shrink);
  const den = scaled(boxOf(items.slice(infix.at)), shrink);
  return [fractionItem(num, den, initial, display, infix.delimited)];
}

/** The parts of an infix fraction were read at the list's size; a fraction sets them smaller. */
function scaled(box: Box, factor: number): Box {
  return { ...box, width: box.width * factor, extra: box.extra * factor };
}

function switchStyle(name: string, style: Style): Style | null {
  switch (name) {
    case 'displaystyle':
      return { ...style, level: 0 };
    case 'textstyle':
      return { ...style, level: 1 };
    case 'scriptstyle':
      return { ...style, level: 2 };
    case 'scriptscriptstyle':
      return { ...style, level: 3 };
  }
  const variant = lookup(FONT_SWITCHES, name);
  if (variant) return { ...style, variant };
  const size = lookup(SIZES, name);
  if (size !== undefined) return { ...style, size };
  return null;
}

const EMPTY_BOX: Box = { width: 0, extra: 0, cls: 'ord', tall: false };

/** One argument: a braced group, or a single token with its own arguments. */
function parseArgument(r: Reader, style: Style, depth: number): Box {
  const token = r.peek();
  if (token === null || token === '}' || token === '&') return EMPTY_BOX;
  r.next();
  if (token === '{') {
    const items = parseList(r, style, depth + 1, isCloseBrace);
    if (r.peek() === '}') r.next();
    return boxOf(items);
  }
  const items: Item[] = [];
  if (token[0] === '\\') command(token.slice(1), r, style, depth, items);
  else if (token !== '^' && token !== '_' && token !== "'") items.push(charItem(token, style));
  return boxOf(items);
}

/** Maths from raw text (an optional argument, a `$…$` inside `\text`). */
function parseRaw(raw: string, style: Style, depth: number): Box {
  return boxOf(parseList(new Reader(raw), style, depth + 1, never));
}

function attachScripts(first: string, r: Reader, style: Style, depth: number, items: Item[]): void {
  const last = items[items.length - 1];
  const base = last && last.cls !== null ? (items.pop() as Item) : makeItem(style, 'ord', 0);
  const script = scriptStyle(style);
  let sup: Box | null = null;
  let sub: Box | null = null;
  let primes = 0;
  for (let token: string | null = first; ; token = r.next()) {
    if (token === "'") primes += 1;
    else if (token === '^') sup = parseArgument(r, script, depth + 1);
    else if (token === '_') sub = parseArgument(r, script, depth + 1);
    const next = r.peek();
    if (next !== '^' && next !== '_' && next !== "'") break;
  }
  const s = scaleOf(style);
  const supWidth = primes * PRIME_WIDTH * scaleOf(script) + (sup?.width ?? 0);
  // TeX sets a subscript at the letter's width without its italic correction.
  const subWidth = sub ? sub.width - (base.italic ?? 0) : 0;
  const tall = base.tall === true || sup !== null;
  if (base.limits) {
    items.push({
      ...base,
      width: Math.max(base.width, supWidth, subWidth),
      extra: base.extra + (sup ? LIMIT_EXTRA * s + sup.extra : 0) + (sub ? LIMIT_EXTRA * s + sub.extra : 0),
      tall,
    });
    return;
  }
  items.push({
    ...base,
    width: base.width + Math.max(supWidth, subWidth, 0) + SCRIPT_SPACE * s,
    italic: 0,
    extra: Math.max(base.extra, sup?.extra ?? 0, sub?.extra ?? 0) + (sup && sub ? SCRIPT_PAIR_EXTRA * s : 0),
    tall,
  });
}

function fractionItem(num: Box, den: Box, style: Style, display: boolean, delimited: boolean): Item {
  const s = scaleOf(style);
  const tallParts = num.tall || den.tall ? TALL_PART_EXTRA : 0;
  const extra = ((display ? 2 : 1) * FRACTION_EXTRA + tallParts) * s + Math.max(num.extra, den.extra);
  // `\binom` draws Size1 parentheses in text style, Size2 in display style.
  const sides = delimited ? 2 * delimiterWidth('paren', display ? 2 : 1) : 2 * NULL_DELIMITER;
  return makeItem(style, 'ord', Math.max(num.width, den.width) + sides * s, extra, { tall: true });
}

function letterWidth(ch: string, variant: Variant): number {
  const code = ch.charCodeAt(0);
  const lower = ch >= 'a';
  const italic = MATH_ITALIC[lower ? code - 97 : 26 + code - 65] / 1000;
  switch (variant) {
    case 'math':
    case 'it':
    case 'bi':
      return italic * VARIANT_FACTOR[variant];
    case 'tt':
      return 0.525;
    // The decorative faces have capitals only (Fraktur also lowercase); the rest fall back.
    case 'cal':
      return lower ? italic : CALLIGRAPHIC_UPPER[code - 65] / 1000;
    case 'bb':
      return lower ? italic : BLACKBOARD_UPPER[code - 65] / 1000;
    case 'scr':
      return lower ? italic : 1.1;
    case 'frak':
      return lower ? 0.5 : 0.8;
    default:
      return (MAIN_ASCII[code - 33] / 1000) * VARIANT_FACTOR[variant];
  }
}

/** A glyph KaTeX's fonts lack falls back to the page font; guess by kind. */
function fallbackWidth(ch: string): number {
  if (isWide(ch)) return 1;
  if (/\p{L}/u.test(ch)) return 0.6;
  return UNKNOWN_COMMAND;
}

function symbolItem(symbol: SymbolInfo, style: Style): Item {
  const s = scaleOf(style);
  const display = symbol.cls === 'op' && style.level === 0;
  const bold = symbol.greek ? (BOLD_GREEK_FACTOR[style.variant] ?? 1) : 1;
  return makeItem(style, symbol.cls, symbol.width * s * bold * (display ? DISPLAY_OPERATOR : 1), 0, {
    limits: display || undefined,
  });
}

function charItem(ch: string, style: Style): Item {
  const s = scaleOf(style);
  if (isAsciiLetter(ch)) {
    const item = makeItem(style, 'ord', letterWidth(ch, style.variant) * s);
    if (style.variant === 'math') item.italic = ((lookup(ITALIC_CORRECTION, ch) ?? 0) / 1000) * s;
    return item;
  }
  if (ch >= '0' && ch <= '9') {
    const digit = style.variant === 'tt' ? 0.525 : 0.5 * (style.variant === 'bf' ? VARIANT_FACTOR.bf : 1);
    return makeItem(style, 'ord', digit * s);
  }
  const special = lookup(MATH_ASCII, ch);
  if (special) return makeItem(style, special[0], (special[1] / 1000) * s);
  const code = ch.charCodeAt(0);
  if (ch.length === 1 && code >= 33 && code <= 126) return makeItem(style, 'ord', (MAIN_ASCII[code - 33] / 1000) * s);
  const symbol = UNICODE_SYMBOLS.get(ch);
  if (symbol) return symbolItem(symbol, style);
  return makeItem(style, 'ord', fallbackWidth(ch) * s);
}

/** Width of a delimiter at size step 0–5 (normal, \big … \Bigg, extensible); null is `.`. */
function delimiterWidth(kind: DelimiterKind | null, step: number): number {
  return kind === null ? NULL_DELIMITER : DELIMITER_SIZES[kind][Math.min(5, Math.max(0, step))] / 1000;
}

function delimiterKind(token: string | null): DelimiterKind | null {
  if (token === null || token === '.') return null;
  return lookup(DELIMITER_KINDS, token) ?? 'arrow';
}

/**
 * The size step KaTeX picks for delimiters around `box`: content that rises
 * above a capital needs Size1; stacked content picks the size covering it,
 * past Size4 an extensible stack.
 */
function delimiterStep(box: Box, s: number): number {
  const extra = box.extra / s;
  if (extra <= 0.05) return box.tall ? 1 : 0;
  const total = PLAIN_LINE + extra;
  return total <= 1.7 ? 1 : total <= 2.2 ? 2 : total <= 2.6 ? 3 : total <= 3.2 ? 4 : 5;
}

const BIG_DELIMITER = /^(big|Big|bigg|Bigg)([lrm]?)$/;
const BIG_STEP: Record<string, number> = { big: 1, Big: 2, bigg: 3, Bigg: 4 };
/** Height \big … \Bigg add to a line: they are 1.2, 1.8, 2.4 and 3em tall. */
const BIG_EXTRA = [0, 0, 0.55, 1.15, 1.75];

function command(name: string, r: Reader, style: Style, depth: number, items: Item[]): void {
  const s = scaleOf(style);
  const push = (cls: AtomClass | null, width: number, extra = 0, flags: { limits?: boolean; tall?: boolean } = {}) =>
    items.push(makeItem(style, cls, width, extra, flags));
  const pushBox = (cls: AtomClass, box: Box, width = box.width) => push(cls, width, box.extra, { tall: box.tall });
  const argument = (argStyle: Style = style) => parseArgument(r, argStyle, depth + 1);

  const symbol = SYMBOLS.get(name);
  if (symbol) {
    items.push(symbolItem(symbol, style));
    return;
  }
  const operator = OPERATOR_NAMES.get(name);
  if (operator !== undefined) {
    push('op', uprightWidth(operator) * s, 0, { limits: (LIMIT_OPERATORS.has(name) && style.level === 0) || undefined });
    return;
  }
  const space = lookup(SPACES, name);
  if (space !== undefined) {
    push(null, space * s);
    return;
  }
  const font = lookup(FONT_COMMANDS, name);
  if (font) {
    const box = argument({ ...style, variant: font });
    pushBox(box.cls, box);
    return;
  }
  const text = lookup(TEXT_COMMANDS, name);
  if (text) {
    push('ord', textWidth(r.rawArgument(), text, style, depth));
    return;
  }
  const accentMinimum = lookup(ACCENTS, name);
  if (accentMinimum !== undefined) {
    const box = argument();
    pushBox('ord', box, Math.max(box.width, accentMinimum * s));
    return;
  }
  const cls = lookup(CLASS_COMMANDS, name);
  if (cls) {
    const box = argument();
    push(cls, box.width, box.extra, { tall: box.tall, limits: (name === 'mathop' && style.level === 0) || undefined });
    return;
  }
  const arrowMinimum = lookup(EXTENSIBLE_ARROWS, name);
  if (arrowMinimum !== undefined) {
    // Labels are script size, padded by half a script em on each side.
    const below = r.rawOptional();
    const above = argument(scriptStyle(style));
    const under = below === null ? EMPTY_BOX : parseRaw(below, scriptStyle(style), depth);
    const label = Math.max(above.width, under.width);
    const extra = (above.width > 0 ? NOTE_EXTRA * s : 0) + (under.width > 0 ? NOTE_EXTRA * s : 0);
    push('rel', Math.max(arrowMinimum * s, label > 0 ? label + SCRIPT_SCALE * s : 0), extra);
    return;
  }
  const big = BIG_DELIMITER.exec(name);
  if (big) {
    const step = BIG_STEP[big[1]];
    const side: AtomClass = big[2] === 'l' ? 'open' : big[2] === 'r' ? 'close' : big[2] === 'm' ? 'rel' : 'ord';
    push(side, delimiterWidth(delimiterKind(r.next()), step) * s, BIG_EXTRA[step] * s, { tall: true });
    return;
  }

  switch (name) {
    case 'frac':
    case 'dfrac':
    case 'tfrac':
    case 'cfrac':
    case 'binom':
    case 'dbinom':
    case 'tbinom': {
      const display = name[0] === 'd' || name === 'cfrac' ? true : name[0] === 't' ? false : style.level === 0;
      const parts = fractionStyle(style, display);
      const num = argument(parts);
      const den = argument(parts);
      items.push(fractionItem(num, den, style, display, name.endsWith('binom')));
      return;
    }
    case 'sqrt': {
      const index = r.rawOptional();
      const body = argument();
      // A body that rises above a capital gets the next surd size.
      const surd = body.tall || body.extra > 0 ? 1 : 0.853;
      const indexWidth = index === null ? 0 : parseRaw(index, { ...style, level: 3 }, depth).width;
      push('ord', body.width + surd * s + Math.max(0, indexWidth - 0.3 * s), body.extra + (body.extra > 0 ? 0.15 * s : 0), {
        tall: true,
      });
      return;
    }
    case 'overbrace':
    case 'underbrace': {
      const box = argument();
      push('ord', Math.max(box.width, 1.6 * s), box.extra + FRACTION_EXTRA * s, { limits: true, tall: true });
      return;
    }
    case 'overset':
    case 'underset':
    case 'stackrel': {
      const note = argument(scriptStyle(style));
      const base = argument();
      push(name === 'stackrel' ? 'rel' : base.cls, Math.max(note.width, base.width), base.extra + note.extra + NOTE_EXTRA * s, {
        tall: true,
      });
      return;
    }
    case 'operatorname':
    case 'operatornamewithlimits': {
      const starred = r.star() || name === 'operatornamewithlimits';
      const box = argument({ ...style, variant: 'rm' });
      push('op', box.width, box.extra, { limits: (starred && style.level === 0) || undefined });
      return;
    }
    case 'limits':
    case 'nolimits':
    case 'displaylimits': {
      const last = items[items.length - 1];
      if (last?.cls === 'op') last.limits = name === 'limits' || (name === 'displaylimits' && style.level === 0);
      return;
    }
    case 'color':
      r.rawArgument();
      return;
    case 'textcolor':
    case 'href': {
      r.rawArgument();
      const box = argument();
      pushBox(box.cls, box);
      return;
    }
    case 'colorbox':
      r.rawArgument();
      push('ord', textWidth(r.rawArgument(), 'rm', style, depth) + 0.6 * s);
      return;
    case 'fcolorbox':
      r.rawArgument();
      r.rawArgument();
      push('ord', textWidth(r.rawArgument(), 'rm', style, depth) + 0.68 * s);
      return;
    case 'fbox':
      push('ord', textWidth(r.rawArgument(), 'rm', style, depth) + 0.68 * s);
      return;
    case 'boxed': {
      const box = argument();
      push('ord', box.width + 0.68 * s, box.extra + 0.2 * s, { tall: true });
      return;
    }
    case 'url':
      push('ord', textWidth(r.rawArgument(), 'tt', style, depth));
      return;
    case 'phantom':
    case 'hphantom':
    case 'vphantom':
    case 'smash': {
      if (name === 'smash') r.rawOptional();
      const box = argument();
      const flat = name === 'hphantom' || name === 'smash';
      push(box.cls, name === 'vphantom' ? 0 : box.width, flat ? 0 : box.extra, { tall: !flat && box.tall });
      return;
    }
    case 'cancelto': {
      argument(scriptStyle(style));
      const box = argument();
      pushBox(box.cls, box);
      return;
    }
    case 'hspace':
      r.star();
      push(null, r.dimension() * s);
      return;
    case 'kern':
    case 'mkern':
    case 'hskip':
    case 'mskip':
      push(null, r.dimension() * s);
      return;
    case 'pmod':
    case 'pod':
    case 'mod': {
      // \quad(\operatorname{mod} n), \quad(n), \quad\operatorname{mod}\,n
      const box = argument();
      const around = name === 'pmod' ? 3.917 : name === 'pod' ? 1.778 : 3.056;
      push('ord', box.width + around * s, box.extra);
      return;
    }
    case 'bmod':
      push('bin', uprightWidth('mod') * s);
      return;
    case 'left': {
      const open = delimiterKind(r.next());
      const inner = parseList(r, style, depth + 1, (token) => token === '\\right' || token === '}');
      let close: DelimiterKind | null = null;
      if (r.peek() === '\\right') {
        r.next();
        close = delimiterKind(r.next());
      }
      const box = boxOf(inner);
      const step = delimiterStep(box, s);
      const width = box.width + (delimiterWidth(open, step) + delimiterWidth(close, step)) * s;
      push('inner', width, box.extra + (step > 1 ? 0.1 * s : 0), { tall: box.tall || step > 0 });
      return;
    }
    case 'right':
      r.next();
      return;
    case 'middle':
      push('ord', delimiterWidth(delimiterKind(r.next()), 0) * s);
      return;
    case 'begin':
      items.push(environment(r.rawArgument().trim(), r, style, depth));
      return;
    case 'end':
      r.rawArgument();
      return;
    case 'substack': {
      const rows = r.rawArgument().split('\\\\');
      const boxes = rows.map((row) => parseRaw(row, scriptStyle(style), depth));
      const width = Math.max(0, ...boxes.map((box) => box.width));
      push('ord', width, (rows.length - 1) * 1.2 * SCRIPT_SCALE * s + Math.max(0, ...boxes.map((box) => box.extra)));
      return;
    }
    case 'label':
      r.rawArgument();
      return;
    case 'tag':
      r.star();
      r.rawArgument();
      return;
    case 'newcommand':
    case 'renewcommand':
    case 'providecommand':
      r.star();
      r.rawArgument();
      r.rawOptional();
      r.rawOptional();
      r.rawArgument();
      return;
    case 'def':
    case 'gdef':
    case 'edef':
    case 'xdef':
      r.next();
      while (r.peek() !== null && r.peek() !== '{') r.next();
      r.rawArgument();
      return;
    case 'let':
      r.next();
      if (r.peek() === '=') r.next();
      r.next();
      return;
    case '\\':
    case 'cr':
    case 'newline':
    case 'nobreak':
    case 'allowbreak':
    case 'relax':
    case 'not':
    case 'nonumber':
    case 'notag':
    case '/':
      return;
    default:
      push('ord', UNKNOWN_COMMAND * s);
  }
}

/** Upright (KaTeX_Main) text such as an operator name; a space is a thin space. */
function uprightWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += ch === ' ' ? 3 / 18 : textCharWidth(ch, 'rm');
  return width;
}

/** Width of one text-mode character in a KaTeX face, em. */
function textCharWidth(ch: string, variant: Variant): number {
  const code = ch.charCodeAt(0);
  if (ch.length === 1 && code >= 33 && code <= 126) {
    if (variant === 'tt') return 0.525;
    const factor = variant === 'it' ? 1.05 : variant === 'bf' || variant === 'sf' ? VARIANT_FACTOR[variant] : 1;
    return (MAIN_ASCII[code - 33] / 1000) * factor;
  }
  return UNICODE_SYMBOLS.get(ch)?.width ?? fallbackWidth(ch);
}

/** `\text{…}` and friends: characters in KaTeX_Main, spaces kept. */
function textWidth(raw: string, variant: Variant, style: Style, depth: number): number {
  const s = scaleOf(style);
  let width = 0;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\') {
      let end = i + 1;
      while (isAsciiLetter(raw[end])) end += 1;
      if (end === i + 1) end = Math.min(end + 1, raw.length);
      const name = raw.slice(i + 1, end);
      i = end;
      const nested = lookup(TEXT_COMMANDS, name);
      const space = lookup(SPACES, name);
      if (nested && depth < MAX_DEPTH) {
        while (isBlank(raw[i])) i += 1;
        // `\textbf x` without braces: the next character is measured as it comes.
        if (raw[i] !== '{') continue;
        const close = matchBrace(raw, i);
        width += textWidth(raw.slice(i + 1, close), nested, style, depth + 1);
        i = close + 1;
      } else if (space !== undefined) width += space * s;
      else if (name.length === 1) width += textCharWidth(name, variant) * s;
      else width += (SYMBOLS.get(name)?.width ?? 0) * s;
      continue;
    }
    if (ch === '$' && depth < MAX_DEPTH) {
      let close = i + 1;
      while (close < raw.length && raw[close] !== '$') close += raw[close] === '\\' ? 2 : 1;
      width += parseRaw(raw.slice(i + 1, close), { ...style, variant: 'math' }, depth).width;
      i = close + 1;
      continue;
    }
    if (ch === '{' || ch === '}') {
      i += 1;
      continue;
    }
    if (isBlank(ch)) {
      while (isBlank(raw[i])) i += 1;
      width += SPACES[' '] * s;
      continue;
    }
    const glyph = String.fromCodePoint(raw.codePointAt(i) ?? 0);
    i += glyph.length;
    width += textCharWidth(glyph, variant) * s;
  }
  return width;
}

function environment(name: string, r: Reader, style: Style, depth: number): Item {
  const kind = name.replace(/\*$/, '');
  const spec = lookup(ENVIRONMENTS, kind) ?? ENVIRONMENTS.matrix;
  if (name.endsWith('*')) r.rawOptional();
  if (kind === 'array' || kind === 'darray' || kind === 'subarray' || kind === 'alignedat') r.rawArgument();
  const small = kind === 'smallmatrix' || kind === 'subarray';
  const displayCells = spec.aligned === true || kind === 'gathered' || kind === 'dcases' || kind === 'darray';
  const cellLevel: Level = small ? (style.level <= 1 ? 2 : 3) : displayCells ? 0 : style.level === 0 ? 1 : style.level;
  const cellStyle: Style = { ...style, level: cellLevel };

  const rows: Box[][] = [];
  let row: Box[] = [];
  const endsCell = (token: string) =>
    token === '&' || token === '\\\\' || token === '\\cr' || token === '\\end' || token === '}';
  for (;;) {
    const cell = parseList(r, cellStyle, depth + 1, endsCell);
    // aligned's `a &= b`: the right column starts with an empty ord, so `=` keeps its spacing.
    if (spec.aligned && row.length % 2 === 1) cell.unshift(makeItem(cellStyle, 'ord', 0));
    row.push(boxOf(cell));
    const token = r.next();
    if (token === '&') continue;
    if (token === '\\\\' || token === '\\cr') {
      r.rawOptional(); // \\[2pt]
      rows.push(row);
      row = [];
      continue;
    }
    rows.push(row);
    if (token === '\\end') r.rawArgument();
    break;
  }
  // `a \\ b \\` ends with an empty row that draws nothing.
  const lastRow = rows[rows.length - 1];
  if (rows.length > 1 && lastRow.length === 1 && lastRow[0].width === 0) rows.pop();

  const s = scaleOf(style);
  const columns = Math.max(...rows.map((cells) => cells.length));
  let width = 0;
  for (let c = 0; c < columns; c += 1) width += Math.max(...rows.map((cells) => cells[c]?.width ?? 0));
  width += spec.colSep * Math.max(0, columns - 1) * scaleOf(cellStyle);
  if (kind === 'array' || kind === 'darray') width += s; // \arraycolsep before and after
  const rowScale = small ? SCRIPT_SCALE : 1;
  const extra =
    (rows.length - 1) * spec.rowHeight * rowScale * s +
    rows.reduce((sum, cells) => sum + Math.max(0, ...cells.map((cell) => cell.extra)), 0);
  const step = delimiterStep({ ...EMPTY_BOX, extra }, s);
  if (spec.open) width += delimiterWidth(delimiterKind(spec.open), step) * s;
  if (spec.close) width += delimiterWidth(delimiterKind(spec.close), step) * s;
  return makeItem(style, 'ord', width, extra, { tall: rows.length > 1 || rows.some((cells) => cells.some((c) => c.tall)) });
}

/** Wide East Asian characters (CJK, Hangul, fullwidth forms) take a full em. */
export function isWide(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

const estimateCache = new Lru<MathEstimate>(512);
const TEXT_STYLE: Style = { level: 1, variant: 'math', size: 1 };

/**
 * How wide and tall KaTeX draws `latex` inline, in em of the label's font.
 * Height is a plain line (`FIGURE_METRICS.lineHeight`) plus what stacking
 * adds: 0.35em per fraction level, 0.1em for a sub- and superscript pair,
 * a row per array row. Simple maths keeps the height of a text label.
 */
export function estimateMath(latex: string): MathEstimate {
  const cached = estimateCache.get(latex);
  if (cached) return cached;
  const box = boxOf(parseList(new Reader(latex), TEXT_STYLE, 0, never));
  const estimate = { width: Math.max(0, box.width), height: PLAIN_LINE + box.extra };
  estimateCache.set(latex, estimate);
  return estimate;
}
