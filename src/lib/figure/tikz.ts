import { FIGURE_METRICS, figureFont } from './constants';
import { cylinderCap, documentWave, shapeOutline } from './geometry';
import { parseLabel } from './labels';
import { figureMathHtml } from './math';
import { figurePalette, type FigurePalette, type ToneColors } from './palette';
import type {
  Border,
  Direction,
  FigureModel,
  FigureScene,
  FigureSize,
  FontSpec,
  Label,
  LabelBox,
  LabelSegment,
  OpGlyph,
  Pattern,
  Point,
  Rect,
  SceneEdge,
  SceneGroup,
  SceneLegend,
  SceneNode,
  Shape,
  TensorCells,
  Tone,
} from './types';

/**
 * TikZ export: the routed scene as a LaTeX `figure` the author can paste.
 *
 * It draws the same geometry as `FigureSvg` — the same outlines, ports,
 * routes, stroke widths, dashes and colours — so the paper matches the
 * editor. Coordinates stay in the editor's px through `x=0.75pt,y=-0.75pt`
 * (96 dpi, y down), which keeps every number in the output traceable to the
 * scene. Labels are re-typeset by TeX: text is escaped, `$…$` maths passes
 * through verbatim only when KaTeX parses it and it uses no command that
 * could reach past the figure (otherwise it prints as its source), and
 * Unicode symbols that pdfLaTeX cannot read become maths commands, or `?`
 * with a `% note:` when nothing spells them. The syntax is deliberately
 * plain TikZ (arrows.meta, shapes.geometric, patterns), so it compiles with
 * any TeX Live.
 */

/** px → pt: the scene is laid out in CSS px at 96 dpi. */
const PT = 0.75;

/** Outline widths in px, as FigureSvg draws them. */
const STROKE = 1;
const STROKE_BOLD = 1.8;
const STROKE_FINE = 0.8;

/** The SVG's pattern tiles paint the stroke colour at partial opacity; here mixed into the fill instead. */
const PATTERNS: Record<Exclude<Pattern, 'none'>, { name: string; strength: number }> = {
  hatch: { name: 'north east lines', strength: 55 },
  dots: { name: 'dots', strength: 60 },
};

/** Print width relative to the text column, as `StructuredFigure` sizes it on screen. */
const SIZE_SHARE: Record<FigureSize, string | null> = {
  auto: null,
  small: '0.5',
  medium: '0.7',
  large: '0.85',
  full: '',
};

/** A cubic with this handle length (× radius) is within 0.03% of a quarter ellipse. */
const QUARTER_ARC = (4 / 3) * Math.tan(Math.PI / 8);

/** A route point closer than this (px) to the line through its neighbours is not a corner. */
const COLLINEAR = 0.15;

/** Rectangles per statement for tensor cells, so a 32×32 heat map stays line-oriented. */
const RECTS_PER_LINE = 8;

type Ctx = {
  palette: FigurePalette;
  family: FontSpec['family'];
  /** `\definecolor` name → HTML hex, in order of first use: only what the picture paints. */
  colors: Map<string, string>;
  /** Some label uses author maths or a symbol that needs amsmath/amssymb. */
  ams: boolean;
  /** Packages beyond amsmath/amssymb that the pasted maths needs. */
  packages: Set<string>;
  /** Notes on what the element being emitted could not print as written (see `takeNotes`). */
  notes: Set<string>;
  /** Some note was written; the header points to them. */
  noted: boolean;
  /** The picture-wide font; labels set in it need no `font=` of their own. */
  baseFont: string;
};

/* ────────────────────────────────────────────────────────────────────────
 * Numbers and colours
 * ──────────────────────────────────────────────────────────────────────── */

/** Rounded decimal text; never `NaN`, `-0` or an exponent in the output. */
function fixed(value: number, digits: 1 | 2): string {
  if (!Number.isFinite(value)) return '0';
  const scale = digits === 1 ? 10 : 100;
  return String(Math.round(value * scale) / scale || 0);
}

function round1(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 || 0 : 0;
}

/** A coordinate in px, to 0.1px. */
function c(p: Point): string {
  return `(${fixed(p.x, 1)},${fixed(p.y, 1)})`;
}

/** A length given in px, as a TeX dimension. */
function len(px: number): string {
  return `${fixed(px * PT, 2)}pt`;
}

function rectangle(rect: Rect): string {
  return `${c(rect)} rectangle ${c({ x: rect.x + rect.width, y: rect.y + rect.height })}`;
}

function centre(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** CSS colour → xcolor `HTML` hex; alpha is composited over white paper. */
function htmlHex(css: string): string {
  const value = css.trim().toLowerCase();
  let rgba: number[] | null = null;
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex && hex[1].length !== 5 && hex[1].length !== 7) {
    const digits = hex[1];
    const pairs =
      digits.length <= 4 ? [...digits].map((d) => d + d) : (digits.match(/../g) ?? []);
    rgba = pairs.map((pair) => parseInt(pair, 16));
    if (rgba.length === 4) rgba[3] /= 255;
  } else {
    const fn = /^rgba?\(([^)]*)\)$/.exec(value);
    if (fn) {
      const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
      rgba = parts.slice(0, 4).map((part, i) => {
        const n = parseFloat(part);
        if (part.endsWith('%')) return i === 3 ? n / 100 : (n / 100) * 255;
        return n;
      });
    } else if (value === 'white') {
      rgba = [255, 255, 255];
    } else if (value === 'black') {
      rgba = [0, 0, 0];
    }
  }
  if (!rgba || rgba.length < 3 || rgba.some((n) => !Number.isFinite(n))) return '000000';
  const alpha = rgba.length > 3 ? Math.min(1, Math.max(0, rgba[3])) : 1;
  return rgba
    .slice(0, 3)
    .map((channel) => {
      const mixed = Math.round(Math.min(255, Math.max(0, channel)) * alpha + 255 * (1 - alpha));
      return mixed.toString(16).padStart(2, '0');
    })
    .join('')
    .toUpperCase();
}

const PART_NAMES: Record<keyof ToneColors, string> = {
  fill: 'Fill',
  stroke: 'Stroke',
  text: 'Text',
  groupFill: 'GroupFill',
  groupStroke: 'GroupStroke',
  cell: 'Cell',
};

const BASE_NAMES = {
  ink: 'cwfInk',
  muted: 'cwfMuted',
  edge: 'cwfEdge',
  background: 'cwfPaper',
  placeholder: 'cwfPlaceholder',
} as const;

function defineColor(ctx: Ctx, name: string, css: string): string {
  if (!ctx.colors.has(name)) ctx.colors.set(name, htmlHex(css));
  return name;
}

function baseColor(ctx: Ctx, key: keyof typeof BASE_NAMES): string {
  return defineColor(ctx, BASE_NAMES[key], ctx.palette[key]);
}

/** A tone's colour by name (`cwfBlueFill`); defined on first use only. */
function toneColor(ctx: Ctx, tone: Tone, part: keyof ToneColors): string {
  const colors = ctx.palette.tones[tone] ?? ctx.palette.tones.neutral;
  // Every tone's text is the ink; one name reads better than ten equal ones.
  if (part === 'text' && htmlHex(colors.text) === htmlHex(ctx.palette.ink)) return baseColor(ctx, 'ink');
  const name = `cwf${tone.charAt(0).toUpperCase()}${tone.slice(1)}${PART_NAMES[part]}`;
  return defineColor(ctx, name, colors[part]);
}

/** As `edgeColor` in palette.ts: an edge's tone stroke, else the edge colour (`neutral` is the default look). */
function edgeColorName(ctx: Ctx, tone: Tone | null): string {
  return tone && tone !== 'neutral' ? toneColor(ctx, tone, 'stroke') : baseColor(ctx, 'edge');
}

/** xcolor mix: `percent`% of `a` over `b` — how SVG opacity is printed without transparency. */
function mix(a: string, percent: number, b: string): string {
  const p = Math.round(percent);
  if (p >= 100) return a;
  if (p <= 0) return b;
  return `${a}!${p}!${b}`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Labels: escaping, maths and Unicode
 * ──────────────────────────────────────────────────────────────────────── */

/** LaTeX specials in running text; `<`, `>` and `|` print wrongly in OT1 unless named. */
const TEXT_ESCAPES = new Map<string, string>([
  ['\\', '\\textbackslash{}'],
  ['{', '\\{'],
  ['}', '\\}'],
  ['$', '\\$'],
  ['&', '\\&'],
  ['%', '\\%'],
  ['#', '\\#'],
  ['_', '\\_'],
  ['~', '\\textasciitilde{}'],
  ['^', '\\textasciicircum{}'],
  ['<', '\\textless{}'],
  ['>', '\\textgreater{}'],
  ['|', '\\textbar{}'],
]);

type SymbolTex = {
  /** Maths-mode spelling. */
  math: string;
  /** Text-mode spelling; when absent the symbol is typeset as maths. */
  text?: string;
  /** Needs amssymb (`\mathbb`). */
  ams?: boolean;
};

const GREEK: Record<string, string> = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'varepsilon', 'ϵ': 'epsilon',
  'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ϑ': 'vartheta', 'ι': 'iota', 'κ': 'kappa',
  'λ': 'lambda', 'μ': 'mu', 'µ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'π': 'pi', 'ϖ': 'varpi',
  'ρ': 'rho', 'ϱ': 'varrho', 'σ': 'sigma', 'ς': 'varsigma', 'τ': 'tau', 'υ': 'upsilon',
  'φ': 'varphi', 'ϕ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
  'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta', 'ϴ': 'Theta', 'Λ': 'Lambda', 'Ξ': 'Xi', 'Π': 'Pi',
  'Σ': 'Sigma', 'Υ': 'Upsilon', 'Φ': 'Phi', 'Ψ': 'Psi', 'Ω': 'Omega',
};

/** Greek capitals (and omicron) that look like Latin letters and have no command. */
const GREEK_LATIN: Record<string, string> = {
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M',
  'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Χ': 'X', 'ο': 'o',
};

const MATH_SYMBOLS: Record<string, string> = {
  '⊕': '\\oplus', '⊗': '\\otimes', '⊙': '\\odot', '⊖': '\\ominus', '⊘': '\\oslash',
  '×': '\\times', '·': '\\cdot', '⋅': '\\cdot', '∙': '\\cdot', '÷': '\\div', '−': '-',
  '±': '\\pm', '∓': '\\mp', '∗': '\\ast', '∘': '\\circ', '√': '\\surd', '∑': '\\sum',
  '∏': '\\prod', '∫': '\\int', '∂': '\\partial', '∇': '\\nabla', '∞': '\\infty',
  '∝': '\\propto', '∼': '\\sim', '≈': '\\approx', '≃': '\\simeq', '≅': '\\cong',
  '≡': '\\equiv', '≠': '\\neq', '≤': '\\leq', '≥': '\\geq', '≪': '\\ll', '≫': '\\gg',
  '∈': '\\in', '∉': '\\notin', '∋': '\\ni', '⊂': '\\subset', '⊃': '\\supset',
  '⊆': '\\subseteq', '⊇': '\\supseteq', '∪': '\\cup', '∩': '\\cap', '∅': '\\emptyset',
  '∀': '\\forall', '∃': '\\exists', '¬': '\\neg', '∧': '\\wedge', '∨': '\\vee',
  '‖': '\\|', '∥': '\\parallel', '⊤': '\\top', '⊥': '\\perp', '⟨': '\\langle',
  '⟩': '\\rangle', '⌈': '\\lceil', '⌉': '\\rceil', '⌊': '\\lfloor', '⌋': '\\rfloor',
  '→': '\\rightarrow', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow',
  '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow', '↑': '\\uparrow', '↓': '\\downarrow',
  '↦': '\\mapsto', '⟶': '\\longrightarrow', '⟵': '\\longleftarrow', '↗': '\\nearrow',
  '↘': '\\searrow', 'ℓ': '\\ell', 'ℏ': '\\hbar', '°': '^{\\circ}',
  '⋯': '\\cdots', '⋮': '\\vdots', '⋱': '\\ddots', '⟹': '\\Longrightarrow', '⟸': '\\Longleftarrow',
  '⟺': '\\Longleftrightarrow', '⟷': '\\longleftrightarrow', '⟼': '\\longmapsto', '∖': '\\setminus',
  '⊄': '\\not\\subset', '⊅': '\\not\\supset', '∌': '\\not\\ni', '∣': '\\mid', '≺': '\\prec',
  '≻': '\\succ', '⪯': '\\preceq', '⪰': '\\succeq', '≮': '\\not<', '≯': '\\not>', '≐': '\\doteq',
  '≔': ':=', '≍': '\\asymp', '≢': '\\not\\equiv', '≉': '\\not\\approx', '≁': '\\not\\sim',
  '⊢': '\\vdash', '⊣': '\\dashv', '⊨': '\\models', '⊎': '\\uplus', '⊓': '\\sqcap', '⊔': '\\sqcup',
  '⊑': '\\sqsubseteq', '⊒': '\\sqsupseteq', '⋀': '\\bigwedge', '⋁': '\\bigvee', '⋂': '\\bigcap',
  '⋃': '\\bigcup', '⨁': '\\bigoplus', '⨂': '\\bigotimes', '⨀': '\\bigodot', '∐': '\\coprod',
  '∮': '\\oint', '∠': '\\angle', '△': '\\triangle', '⋄': '\\diamond', '◦': '\\circ', '⋆': '\\star',
  'ℵ': '\\aleph', 'ℑ': '\\Im', 'ℜ': '\\Re', '℘': '\\wp', 'ȷ': '\\jmath', '↪': '\\hookrightarrow',
  '↩': '\\hookleftarrow', '⇌': '\\rightleftharpoons', '⇑': '\\Uparrow', '⇓': '\\Downarrow',
  '↕': '\\updownarrow', '⇕': '\\Updownarrow', '↖': '\\nwarrow', '↙': '\\swarrow',
  '⇀': '\\rightharpoonup', '↼': '\\leftharpoonup', '∆': '\\Delta', '♯': '\\sharp', '♭': '\\flat',
  '♮': '\\natural', '♠': '\\spadesuit', '♣': '\\clubsuit', '♡': '\\heartsuit', '♥': '\\heartsuit',
  '♢': '\\diamondsuit', '♦': '\\diamondsuit', '≀': '\\wr', '⋈': '\\bowtie', '⟦': '[\\![', '⟧': ']\\!]',
  // No standard command; the usual stand-ins.
  '✗': '\\times', '✘': '\\times',
  // Letterlike letters (Planck's ℎ, script ℯ ℊ ℴ): the plain maths letter.
  'ℎ': 'h', 'ℯ': 'e', 'ℊ': 'g', 'ℴ': 'o',
};

/** As MATH_SYMBOLS, for commands from amssymb/amsmath. */
const AMS_SYMBOLS: Record<string, string> = {
  '⊊': '\\subsetneq', '⊋': '\\supsetneq', '⊈': '\\nsubseteq', '⊉': '\\nsupseteq', '∤': '\\nmid',
  '∦': '\\nparallel', '≼': '\\preccurlyeq', '≽': '\\succcurlyeq', '≲': '\\lesssim', '≳': '\\gtrsim',
  '≦': '\\leqq', '≧': '\\geqq', '⩽': '\\leqslant', '⩾': '\\geqslant', '≰': '\\nleq', '≱': '\\ngeq',
  '≜': '\\triangleq', '≇': '\\ncong', '⊩': '\\Vdash', '⊏': '\\sqsubset', '⊐': '\\sqsupset',
  '∬': '\\iint', '∭': '\\iiint', '▽': '\\triangledown', '□': '\\square', '◊': '\\lozenge',
  '★': '\\bigstar', '∴': '\\therefore', '∵': '\\because', '∄': '\\nexists', '⇝': '\\rightsquigarrow',
  '↝': '\\rightsquigarrow', '⇄': '\\rightleftarrows', '⇆': '\\leftrightarrows',
  '⇋': '\\leftrightharpoons', '↠': '\\twoheadrightarrow', '↣': '\\rightarrowtail',
  '∎': '\\blacksquare', '■': '\\blacksquare', '⊸': '\\multimap', '⊠': '\\boxtimes', '⊞': '\\boxplus',
  '⊟': '\\boxminus', '⊡': '\\boxdot', '∔': '\\dotplus', '⋉': '\\ltimes', '⋊': '\\rtimes',
  '⊛': '\\circledast', '⊚': '\\circledcirc', '∡': '\\measuredangle', '⊲': '\\vartriangleleft',
  '⊳': '\\vartriangleright', '✓': '\\checkmark', '✔': '\\checkmark', 'ϰ': '\\varkappa', 'ϝ': '\\digamma',
};

const BLACKBOARD: Record<string, string> = {
  'ℝ': 'R', 'ℕ': 'N', 'ℤ': 'Z', 'ℚ': 'Q', 'ℂ': 'C', 'ℍ': 'H', 'ℙ': 'P',
};

/** Letterlike script and fraktur capitals (the holes of the maths alphabets below). */
const LETTERLIKE: Record<string, string> = {
  'ℬ': '\\mathcal{B}', 'ℰ': '\\mathcal{E}', 'ℱ': '\\mathcal{F}', 'ℋ': '\\mathcal{H}', 'ℐ': '\\mathcal{I}',
  'ℒ': '\\mathcal{L}', 'ℳ': '\\mathcal{M}', 'ℛ': '\\mathcal{R}',
};
const LETTERLIKE_AMS: Record<string, string> = { 'ℭ': '\\mathfrak{C}', 'ℌ': '\\mathfrak{H}', 'ℨ': '\\mathfrak{Z}' };

const LATIN_CAPITALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LATIN_LETTERS = `${LATIN_CAPITALS}abcdefghijklmnopqrstuvwxyz`;
const DIGITS = '0123456789';
/** Greek in the order of the Mathematical Alphanumeric Symbols block: ϴ after Ρ, ∇ and ∂ closing each case. */
const MATH_GREEK = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡϴΣΤΥΦΧΨΩ∇αβγδεζηθικλμνξοπρςστυφχψω∂ϵϑϰϕϱϖ';

const bold = (tex: string) => `\\boldsymbol{${tex}}`;
const boldSans = (tex: string) => `\\boldsymbol{\\mathsf{${tex}}}`;

/**
 * Styled letters and digits of U+1D400–U+1D7FF (𝐱, 𝔼, 𝜃, 𝟙…), by the
 * first code point of each alphabet. Alphabets LaTeX cannot style (script
 * and double-struck lower case) are left out, so they print as `?`.
 */
const MATH_ALPHABETS: { start: number; chars: string; style: (tex: string) => string; ams?: boolean }[] = [
  { start: 0x1d400, chars: LATIN_LETTERS, style: (t) => `\\mathbf{${t}}` },
  { start: 0x1d434, chars: LATIN_LETTERS, style: (t) => t },
  { start: 0x1d468, chars: LATIN_LETTERS, style: bold, ams: true },
  { start: 0x1d49c, chars: LATIN_CAPITALS, style: (t) => `\\mathcal{${t}}` },
  { start: 0x1d4d0, chars: LATIN_CAPITALS, style: (t) => bold(`\\mathcal{${t}}`), ams: true },
  { start: 0x1d504, chars: LATIN_LETTERS, style: (t) => `\\mathfrak{${t}}`, ams: true },
  { start: 0x1d538, chars: LATIN_CAPITALS, style: (t) => `\\mathbb{${t}}`, ams: true },
  { start: 0x1d56c, chars: LATIN_LETTERS, style: (t) => bold(`\\mathfrak{${t}}`), ams: true },
  { start: 0x1d5a0, chars: LATIN_LETTERS, style: (t) => `\\mathsf{${t}}` },
  { start: 0x1d5d4, chars: LATIN_LETTERS, style: boldSans, ams: true },
  { start: 0x1d608, chars: LATIN_LETTERS, style: (t) => `\\mathsf{${t}}` },
  { start: 0x1d63c, chars: LATIN_LETTERS, style: boldSans, ams: true },
  { start: 0x1d670, chars: LATIN_LETTERS, style: (t) => `\\mathtt{${t}}` },
  { start: 0x1d6a8, chars: MATH_GREEK, style: bold, ams: true },
  { start: 0x1d6e2, chars: MATH_GREEK, style: (t) => t },
  { start: 0x1d71c, chars: MATH_GREEK, style: bold, ams: true },
  { start: 0x1d756, chars: MATH_GREEK, style: bold, ams: true },
  { start: 0x1d790, chars: MATH_GREEK, style: bold, ams: true },
  { start: 0x1d7ce, chars: DIGITS, style: (t) => `\\mathbf{${t}}` },
  // Double-struck digits (𝟙, the indicator): amssymb has none; bold is the usual stand-in.
  { start: 0x1d7d8, chars: DIGITS, style: (t) => `\\mathbf{${t}}` },
  { start: 0x1d7e2, chars: DIGITS, style: (t) => `\\mathsf{${t}}` },
  { start: 0x1d7ec, chars: DIGITS, style: boldSans, ams: true },
  { start: 0x1d7f6, chars: DIGITS, style: (t) => `\\mathtt{${t}}` },
];

const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵀᵈᵏ';
const SUPERSCRIPT_VALUES = '0123456789+-=()niTdk';
const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜᵢⱼ';
const SUBSCRIPT_VALUES = '0123456789+-=()aeoxhklmnpstij';

/** Symbols with a text-mode spelling (typography, not maths). */
const TEXT_SYMBOLS: Record<string, [text: string, math: string]> = {
  '…': ['\\ldots{}', '\\ldots'],
  '–': ['--', '-'],
  '—': ['---', '-'],
  '‐': ['-', '-'],
  '‑': ['-', '-'],
  '‒': ['--', '-'],
  '―': ['---', '-'],
  '‘': ['`', '`'],
  '’': ["'", "'"],
  '“': ['``', '``'],
  '”': ["''", "''"],
  '′': ["'", "'"],
  '″': ["''", "''"],
  '‴': ["'''", "'''"],
  '⁄': ['/', '/'],
  '∕': ['/', '/'],
  ' ': ['~', '~'],
  ' ': ['\\,', '\\,'],
  ' ': ['\\,', '\\,'],
  ' ': ['\\enspace{}', '\\enspace'],
  ' ': ['\\quad{}', '\\quad'],
  '§': ['\\S{}', '\\S'],
  '¶': ['\\P{}', '\\P'],
  '©': ['\\copyright{}', '\\copyright'],
  '•': ['\\textbullet{}', '\\bullet'],
  '†': ['\\dag{}', '\\dagger'],
  '‡': ['\\ddag{}', '\\ddagger'],
  '€': ['\\texteuro{}', '\\text{\\texteuro}'],
  '™': ['\\texttrademark{}', '\\text{\\texttrademark}'],
  '‰': ['\\textperthousand{}', '\\text{\\textperthousand}'],
  // Invisible characters pdfLaTeX cannot read: dropped.
  '­': ['', ''],
  '​': ['', ''],
  '‌': ['', ''],
  '‍': ['', ''],
  '⁠': ['', ''],
  '﻿': ['', ''],
  '︎': ['', ''],
  '️': ['', ''],
};

const SYMBOLS: ReadonlyMap<string, SymbolTex> = (() => {
  const map = new Map<string, SymbolTex>();
  for (const [ch, name] of Object.entries(GREEK)) map.set(ch, { math: `\\${name}` });
  for (const [ch, letter] of Object.entries(GREEK_LATIN)) {
    map.set(ch, { math: letter === 'o' ? 'o' : `\\mathrm{${letter}}`, text: letter });
  }
  for (const [ch, math] of Object.entries(MATH_SYMBOLS)) map.set(ch, { math });
  for (const [ch, math] of Object.entries(AMS_SYMBOLS)) map.set(ch, { math, ams: true });
  for (const [ch, letter] of Object.entries(BLACKBOARD)) map.set(ch, { math: `\\mathbb{${letter}}`, ams: true });
  for (const [ch, math] of Object.entries(LETTERLIKE)) map.set(ch, { math });
  for (const [ch, math] of Object.entries(LETTERLIKE_AMS)) map.set(ch, { math, ams: true });
  for (const { start, chars, style, ams } of MATH_ALPHABETS) {
    [...chars].forEach((ch, i) => {
      const base = map.get(ch);
      map.set(String.fromCodePoint(start + i), { math: style(base?.math ?? ch), ams: Boolean(ams || base?.ams) });
    });
  }
  [...SUPERSCRIPTS].forEach((ch, i) => map.set(ch, { math: `^{${SUPERSCRIPT_VALUES[i]}}` }));
  [...SUBSCRIPTS].forEach((ch, i) => map.set(ch, { math: `_{${SUBSCRIPT_VALUES[i]}}` }));
  for (const [ch, [text, math]] of Object.entries(TEXT_SYMBOLS)) map.set(ch, { math, text });
  return map;
})();

/**
 * pdfLaTeX's utf8 input reads Latin-1 and Latin Extended-A; anything above
 * that no table spells would stop the build ("Unicode character … not set up").
 */
const LATIN_END = 0x17f;

/** C0/C1 control characters and DEL: TeX reads them as invalid or as line ends. */
function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code < 0xa0);
}

/**
 * KaTeX conveniences plain LaTeX lacks, spelled the standard way (amsmath /
 * amssymb), so maths that drew in the editor also compiles.
 */
const KATEX_MACROS = new Map<string, string>([
  ['R', '\\mathbb{R}'], ['N', '\\mathbb{N}'], ['Z', '\\mathbb{Z}'], ['Q', '\\mathbb{Q}'], ['C', '\\mathbb{C}'],
  ['reals', '\\mathbb{R}'], ['Reals', '\\mathbb{R}'], ['natnums', '\\mathbb{N}'],
  ['cnums', '\\mathbb{C}'], ['Complex', '\\mathbb{C}'],
  ['Bbb', '\\mathbb'], ['bold', '\\mathbf'], ['bm', '\\boldsymbol'],
  ['argmax', '\\operatorname*{arg\\,max}'], ['argmin', '\\operatorname*{arg\\,min}'],
  ['plim', '\\operatorname*{plim}'],
  ['lang', '\\langle'], ['rang', '\\rangle'], ['empty', '\\emptyset'], ['infin', '\\infty'],
  ['Alpha', '\\mathrm{A}'], ['Beta', '\\mathrm{B}'], ['Epsilon', '\\mathrm{E}'], ['Zeta', '\\mathrm{Z}'],
  ['Eta', '\\mathrm{H}'], ['Iota', '\\mathrm{I}'], ['Kappa', '\\mathrm{K}'], ['Mu', '\\mathrm{M}'],
  ['Nu', '\\mathrm{N}'], ['Omicron', '\\mathrm{O}'], ['Rho', '\\mathrm{P}'], ['Tau', '\\mathrm{T}'],
  ['Chi', '\\mathrm{X}'], ['omicron', 'o'],
  ['rarr', '\\rightarrow'], ['rArr', '\\Rightarrow'], ['Rarr', '\\Rightarrow'],
  ['larr', '\\leftarrow'], ['lArr', '\\Leftarrow'], ['Larr', '\\Leftarrow'],
  ['harr', '\\leftrightarrow'], ['hArr', '\\Leftrightarrow'], ['Harr', '\\Leftrightarrow'],
  ['lrarr', '\\leftrightarrow'], ['lrArr', '\\Leftrightarrow'], ['Lrarr', '\\Leftrightarrow'],
  ['uarr', '\\uparrow'], ['uArr', '\\Uparrow'], ['Uarr', '\\Uparrow'],
  ['darr', '\\downarrow'], ['dArr', '\\Downarrow'], ['Darr', '\\Downarrow'],
  ['alef', '\\aleph'], ['alefsym', '\\aleph'], ['bull', '\\bullet'], ['Dagger', '\\ddagger'],
  ['clubs', '\\clubsuit'], ['diamonds', '\\diamondsuit'], ['hearts', '\\heartsuit'], ['spades', '\\spadesuit'],
  ['exist', '\\exists'], ['isin', '\\in'], ['notni', '\\not\\ni'], ['plusmn', '\\pm'], ['sdot', '\\cdot'],
  ['sect', '\\S'], ['sub', '\\subset'], ['sube', '\\subseteq'], ['supe', '\\supseteq'],
  ['image', '\\Im'], ['real', '\\Re'], ['weierp', '\\wp'], ['thetasym', '\\vartheta'],
  // KaTeX's colour shorthands, as the xcolor names TikZ already loads.
  ['blue', '\\textcolor{blue}'], ['orange', '\\textcolor{orange}'], ['pink', '\\textcolor{pink}'],
  ['red', '\\textcolor{red}'], ['green', '\\textcolor{green}'], ['gray', '\\textcolor{gray}'],
  ['purple', '\\textcolor{purple}'],
]);

function translateKatex(latex: string): string {
  // `\\` is consumed as a pair, so the `R` of `\\R` is never taken for `\R`.
  return latex.replace(/\\([A-Za-z]+|[^A-Za-z])/g, (whole, name: string) => KATEX_MACROS.get(name) ?? whole);
}

/**
 * Commands never pasted as live maths. Definitions, catcodes, files, the
 * shell and output streams would reach past the figure into the author's
 * build, and KaTeX parses several of them (`\def`, `\gdef`, `\let`,
 * `\newcommand`, `\href`, `\url`, `\includegraphics`, `\verb`, `\message`),
 * so its verdict alone is not enough. `\newline` would end the node's line.
 */
const BLOCKED_COMMANDS = new Set([
  'input', 'include', 'includeonly', 'InputIfFileExists', 'IfFileExists', 'endinput', 'openin', 'openout',
  'closein', 'closeout', 'read', 'readline', 'write', 'immediate', 'special', 'directlua', 'latelua',
  'ShellEscape', 'jobname', 'scantokens', 'message', 'errmessage', 'typeout', 'includegraphics', 'url',
  'href', 'verb', 'def', 'edef', 'gdef', 'xdef', 'let', 'futurelet', 'global', 'long', 'outer',
  'newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand', 'newenvironment',
  'renewenvironment', 'catcode', 'lccode', 'uccode', 'sfcode', 'mathcode', 'delcode', 'makeatletter',
  'makeatother', 'csname', 'endcsname', 'expandafter', 'noexpand', 'loop', 'usepackage', 'RequirePackage',
  'documentclass', 'newline', 'htmlClass', 'htmlId', 'htmlStyle', 'htmlData',
]);

/** Commands KaTeX draws that no LaTeX package spells the same way. */
const KATEX_ONLY = new Set([
  'minuso', 'varcoppa', 'angl', 'angln', 'phase', 'origof', 'imageof', 'overlinesegment',
  'underlinesegment', 'widecheck', 'overgroup', 'undergroup', 'Overrightarrow', 'overleftharpoon',
  'overrightharpoon', 'xtofrom', 'xrightleftarrows', 'xrightequilibrium', 'xleftequilibrium',
  'kaBlue', 'kaGreen',
]);
const KATEX_ONLY_COLOR = /^(?:blue|teal|green|gold|red|maroon|purple|mint|gray)[A-I]$/;

/** Commands that LaTeX spells as KaTeX does once a package is loaded; named in the preamble comment. */
const MATH_PACKAGES = new Map<string, string>([
  ...['cancel', 'bcancel', 'xcancel'].map((name) => [name, 'cancel'] as const),
  ...['bra', 'ket', 'braket', 'Bra', 'Ket', 'Braket', 'set', 'Set'].map((name) => [name, 'braket'] as const),
  ...[
    'coloneqq', 'Coloneqq', 'coloneq', 'Coloneq', 'eqqcolon', 'Eqqcolon', 'eqcolon', 'Eqcolon',
    'colonapprox', 'Colonapprox', 'colonsim', 'Colonsim', 'dblcolon', 'vcentcolon', 'mathclap',
    'mathllap', 'mathrlap', 'xRightarrow', 'xLeftarrow', 'xleftrightarrow', 'xLeftrightarrow',
    'xhookleftarrow', 'xhookrightarrow', 'xmapsto', 'xtwoheadrightarrow', 'xtwoheadleftarrow',
    'xrightharpoonup', 'xrightharpoondown', 'xleftharpoonup', 'xleftharpoondown',
    'xrightleftharpoons', 'xleftrightharpoons',
  ].map((name) => [name, 'mathtools'] as const),
  ...['llbracket', 'rrbracket', 'lBrace', 'rBrace'].map((name) => [name, 'stmaryrd'] as const),
  ['mathscr', 'mathrsfs'],
  ['oiint', 'esint'],
  ['oiiint', 'esint'],
  ['utilde', 'undertilde'],
  ['xlongequal', 'extarrows'],
  ['degree', 'gensymb'],
]);

/** Maths environments a pasted label may open, with the package each needs beyond amsmath ('' for none). */
const MATH_ENVIRONMENTS = new Map<string, string>([
  ...['matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix', 'array', 'subarray',
    'cases', 'aligned', 'alignedat', 'gathered'].map((name) => [name, ''] as const),
  ...['matrix*', 'pmatrix*', 'bmatrix*', 'Bmatrix*', 'vmatrix*', 'Vmatrix*', 'dcases', 'dcases*', 'rcases',
    'rcases*', 'drcases'].map((name) => [name, 'mathtools'] as const),
]);

/** Records a note for the element being emitted; `takeNotes` writes them after it. */
function note(ctx: Ctx, text: string): void {
  ctx.notes.add(comment(text, 120));
}

/** The pending notes as `% note:` lines, emptied. */
function takeNotes(ctx: Ctx): string[] {
  const lines = [...ctx.notes].map((text) => `% note: ${text}`);
  ctx.notes.clear();
  if (lines.length > 0) ctx.noted = true;
  return lines;
}

/** A character pdfLaTeX cannot read and no table spells: `?`, with a note naming it. */
function unprintable(ctx: Ctx, ch: string): string {
  const code = (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
  // Only visible characters go into the comment as themselves.
  const shown = /[\p{L}\p{N}\p{P}\p{S}]/u.test(ch) ? `${ch} (U+${code})` : `U+${code}`;
  note(ctx, `${shown} has no pdfLaTeX spelling; printed as ?`);
  return '?';
}

/** Commands whose braced argument is set as text, where a maths command would not compile. */
const TEXT_ARGUMENT = /\\(?:text(?:rm|sf|tt|bf|md|it|up|sl|sc|normal)?|emph|[hm]box|fbox|f?colorbox(?:\{[^{}]*\}){1,2})\s*$/;

/**
 * Unicode inside maths → commands. Adjacent scripts of one kind merge
 * (`x²³` → `x^{23}`), and a repeated kind gets a fresh base, since TeX
 * rejects a double superscript. Inside a text argument (`\text{…}`) a symbol
 * keeps its text spelling or goes through `\ensuremath`; an accented Latin
 * letter in maths goes through `\text`; anything pdfLaTeX cannot read is `?`.
 */
function mathUnicode(ctx: Ctx, latex: string): string {
  let out = '';
  let script: '^' | '_' | null = null;
  const used = new Set<'^' | '_'>();
  let afterCommand = false;
  // Brace depth of the source, and the depths at which a text argument opened.
  let depth = 0;
  const textAt: number[] = [];
  let slashes = 0;
  for (const ch of latex) {
    const symbol = SYMBOLS.get(ch);
    const inText = textAt.length > 0;
    if (!symbol) {
      const escaped = slashes % 2 === 1;
      slashes = ch === '\\' ? slashes + 1 : 0;
      if (ch === '{' && !escaped) {
        // The tail is enough to see the command, and keeps long labels linear.
        if (TEXT_ARGUMENT.test(out.slice(-80))) textAt.push(depth);
        depth += 1;
      } else if (ch === '}' && !escaped) {
        depth -= 1;
        if (textAt[textAt.length - 1] === depth) textAt.pop();
      }
      if (afterCommand && /[A-Za-z]/.test(ch)) out += ' ';
      const code = ch.codePointAt(0) ?? 0;
      if (isControl(code)) {
        out += ' ';
      } else if (code < 0x80 || inText) {
        out += code > LATIN_END ? unprintable(ctx, ch) : ch;
      } else {
        // Accented letters are text commands under pdfLaTeX, invalid in maths.
        ctx.ams = true;
        out += `{\\text{${code > LATIN_END ? unprintable(ctx, ch) : ch}}}`;
      }
      script = null;
      used.clear();
      afterCommand = false;
      continue;
    }
    slashes = 0;
    if (symbol.ams) ctx.ams = true;
    if (inText) {
      out += symbol.text ?? `\\ensuremath{${symbol.math}}`;
      script = null;
      used.clear();
      afterCommand = false;
      continue;
    }
    const tex = symbol.math;
    const kind = tex.startsWith('^{') ? '^' : tex.startsWith('_{') ? '_' : null;
    if (kind) {
      if (script === kind) {
        out = out.slice(0, -1) + tex.slice(2);
        continue;
      }
      if (used.has(kind)) {
        out += '{}';
        used.clear();
      }
      used.add(kind);
      script = kind;
      afterCommand = false;
      out += tex;
      continue;
    }
    if (afterCommand && /^[A-Za-z]/.test(tex)) out += ' ';
    out += tex;
    script = null;
    used.clear();
    afterCommand = /\\[A-Za-z]+$/.test(tex);
  }
  return out;
}

const BREAKS_TIKZ = 'would break the surrounding TikZ';

/**
 * Why author maths (after `mathUnicode`) cannot be pasted into the document
 * as maths, or null when it can. Braces, environments and `\left`/`\right`
 * must balance, with nothing (a `%`, `#`, `$`, stray `&` or `\\`) that breaks
 * the surrounding TikZ and no `^^`, which TeX reads as an escaped character
 * (`\^^69nput` is `\input`). Every command must be one LaTeX spells as KaTeX
 * does: never a `BLOCKED_COMMANDS` primitive, a KaTeX-only one or an `@`
 * internal. `packages` collects what the accepted commands need.
 */
function mathProblem(tex: string, packages: Set<string>): string | null {
  if (tex.includes('^^')) return BREAKS_TIKZ;
  // KaTeX reads `@` as a letter in command names; LaTeX's internals use it too.
  const words = /[A-Za-z@]+/y;
  let depth = 0;
  let lefts = 0;
  const envs: string[] = [];
  for (let i = 0; i < tex.length; i += 1) {
    const ch = tex[i];
    if (ch === '\\') {
      words.lastIndex = i + 1;
      const word = words.exec(tex);
      if (!word) {
        if (i + 1 >= tex.length) return BREAKS_TIKZ;
        if (tex[i + 1] === '\\' && envs.length === 0) return BREAKS_TIKZ;
        i += 1;
        continue;
      }
      const name = word[0];
      i += name.length;
      if (name.includes('@') || BLOCKED_COMMANDS.has(name)) return `uses \\${name}, which an export never runs`;
      if (KATEX_ONLY.has(name) || KATEX_ONLY_COLOR.test(name)) return `uses \\${name}, which only KaTeX defines`;
      const pkg = MATH_PACKAGES.get(name);
      if (pkg) packages.add(pkg);
      if (name === 'left') lefts += 1;
      if (name === 'right') {
        lefts -= 1;
        if (lefts < 0) return BREAKS_TIKZ;
      }
      if (name === 'begin' || name === 'end') {
        const env = /^\s*\{([^{}]*)\}/.exec(tex.slice(i + 1));
        if (!env) return BREAKS_TIKZ;
        const envPackage = MATH_ENVIRONMENTS.get(env[1]);
        if (envPackage === undefined) return `uses the ${env[1]} environment, which an export never opens`;
        if (envPackage) packages.add(envPackage);
        if (name === 'begin') envs.push(env[1]);
        else if (envs.pop() !== env[1]) return BREAKS_TIKZ;
      }
      continue;
    }
    if (ch === '%' || ch === '#' || ch === '$') return BREAKS_TIKZ;
    if (ch === '&' && envs.length === 0) return BREAKS_TIKZ;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth < 0) return BREAKS_TIKZ;
    }
  }
  return depth === 0 && lefts === 0 && envs.length === 0 ? null : BREAKS_TIKZ;
}

function escapeChar(ch: string, next: string | undefined): string {
  // Break the ligatures TeX would otherwise form: `--` (dash), `''` and `` `` `` (quotes).
  if (ch === '-') return next === '-' || next === '–' || next === '—' ? '-{}' : '-';
  if (ch === "'") return next === "'" || next === '’' || next === '′' ? "'{}" : "'";
  if (ch === '`') return '{`}';
  const escaped = TEXT_ESCAPES.get(ch);
  if (escaped) return escaped;
  return isControl(ch.codePointAt(0) ?? 0) ? ' ' : ch;
}

/** Running text → LaTeX: specials escaped, runs of maths symbols set as one `$…$`. */
function textTex(ctx: Ctx, text: string): string {
  let out = '';
  let run = '';
  const flush = () => {
    if (run) out += `$${mathUnicode(ctx, run)}$`;
    run = '';
  };
  // Composed form first, so `e` + combining accent reads as the one letter pdfLaTeX knows.
  const chars = Array.from(text.normalize('NFC'));
  chars.forEach((ch, i) => {
    const symbol = SYMBOLS.get(ch);
    if (symbol && symbol.text === undefined) {
      run += ch;
      return;
    }
    flush();
    if (symbol) out += symbol.text ?? '';
    else if ((ch.codePointAt(0) ?? 0) > LATIN_END) out += unprintable(ctx, ch);
    else out += escapeChar(ch, chars[i + 1]);
  });
  flush();
  return out;
}

/**
 * Author maths, pasted as maths only when KaTeX parses it and `mathProblem`
 * finds nothing wrong. Anything else prints as its source in `\texttt`, with
 * a note saying why, so no command in it ever runs in the author's build.
 */
function mathTex(ctx: Ctx, latex: string): string {
  const body = mathUnicode(ctx, translateKatex(latex.normalize('NFC')));
  if (!body.trim()) return '';
  const packages = new Set<string>();
  const problem = figureMathHtml(latex).ok ? mathProblem(body, packages) : 'is not valid maths';
  if (problem) {
    note(ctx, `${comment(`$${latex}$`, 60)} ${problem}; printed as text`);
    return `\\texttt{${textTex(ctx, `$${latex}$`)}}`;
  }
  for (const pkg of packages) ctx.packages.add(pkg);
  ctx.ams = true;
  return `$${body}$`;
}

function lineTex(ctx: Ctx, segments: LabelSegment[]): string {
  return segments.map((s) => (s.kind === 'math' ? mathTex(ctx, s.value) : textTex(ctx, s.value))).join('');
}

/** A label for a node with `align=…`: lines joined by `\\`; '' when it prints nothing. */
function labelTex(ctx: Ctx, label: Label): string {
  const lines = label.lines.map((line) => lineTex(ctx, line));
  if (lines.every((line) => !line.trim())) return '';
  return lines
    .map((line, i) => {
      if (!line.trim()) return '\\mbox{}';
      // After `\\`, a leading `[` or `*` would be read as its optional argument or star.
      return i > 0 && /^\s*[[*]/.test(line) ? `{}${line}` : line;
    })
    .join(' \\\\ ');
}

/** `\fontsize` for a label font; the baseline skip is the figure's line height, to the point. */
function fontCommand(font: FontSpec): string {
  const size = font.size * PT;
  return (
    (font.family === 'serif' ? '\\rmfamily' : '\\sffamily') +
    (font.weight >= 600 ? '\\bfseries' : '') +
    (font.italic ? '\\itshape' : '') +
    `\\fontsize{${fixed(size, 2)}}{${Math.round(size * FIGURE_METRICS.lineHeight)}}\\selectfont`
  );
}

function fontOptions(ctx: Ctx, font: FontSpec): string[] {
  const command = fontCommand(font);
  return command === ctx.baseFont ? [] : [`font=${command}`];
}

/** One-line comment text: no line breaks (not even ones an editor would add), bounded length. */
function comment(text: string, max = 80): string {
  const flat = Array.from(text, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return isControl(code) || code === 0x2028 || code === 0x2029 ? ' ' : ch;
  })
    .join('')
    .trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : flat;
}

/**
 * A positioned label as its own node, anchored on the side its text is
 * aligned to, so TeX's slightly different metrics grow it away from that
 * edge. Returns null when the label prints nothing.
 */
function labelNode(
  ctx: Ctx,
  box: LabelBox,
  color: () => string,
  extra: string[] = [],
  innerSep = '0pt',
): string | null {
  const tex = labelTex(ctx, box.label);
  if (!tex) return null;
  const y = box.y + box.height / 2;
  const [anchor, x] =
    box.align === 'left'
      ? ['west', box.x]
      : box.align === 'right'
        ? ['east', box.x + box.width]
        : ['center', box.x + box.width / 2];
  const options = [
    ...(anchor === 'center' ? [] : [`anchor=${anchor}`]),
    ...extra,
    `inner sep=${innerSep}`,
    `align=${box.align}`,
    `text=${color()}`,
    ...fontOptions(ctx, box.font),
  ];
  return `\\node[${options.join(', ')}] at ${c({ x, y })} {${tex}};`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Paint
 * ──────────────────────────────────────────────────────────────────────── */

type Stroke = { color: string; width: number; dash: string | null; round: boolean };

function dashPattern(on: number, off: number): string {
  return `on ${len(on)} off ${len(off)}`;
}

/** Outline for a border style, as FigureSvg's `borderStroke`; null draws none. */
function borderStroke(border: Border, color: () => string): Stroke | null {
  switch (border) {
    case 'none':
      return null;
    case 'bold':
      return { color: color(), width: STROKE_BOLD, dash: null, round: false };
    case 'dashed':
      return { color: color(), width: STROKE, dash: dashPattern(4, 3), round: false };
    case 'dotted':
      return { color: color(), width: STROKE, dash: dashPattern(1, 2.5), round: true };
    case 'solid':
    default:
      return { color: color(), width: STROKE, dash: null, round: false };
  }
}

function strokeOptions(stroke: Stroke | null): string[] {
  if (!stroke) return [];
  const options = [`draw=${stroke.color}`, `line width=${len(stroke.width)}`];
  if (stroke.dash) options.push(`dash pattern=${stroke.dash}`);
  if (stroke.round) options.push('line cap=round');
  return options;
}

type Hatch = { name: string; color: string };

/** Fill, then pattern, then outline — the SVG's three layers, as one TikZ path. */
function fillOptions(fill: string | null, hatch: Hatch | null): string[] {
  if (!hatch) return fill ? [`fill=${fill}`] : [];
  return [...(fill ? [`preaction={fill=${fill}}`] : []), `pattern=${hatch.name}`, `pattern color=${hatch.color}`];
}

function hatchFor(ctx: Ctx, pattern: Pattern, tone: Tone, under: string): Hatch | null {
  if (pattern === 'none') return null;
  const { name, strength } = PATTERNS[pattern];
  return { name, color: mix(toneColor(ctx, tone, 'stroke'), strength, under) };
}

/* ────────────────────────────────────────────────────────────────────────
 * Shapes
 * ──────────────────────────────────────────────────────────────────────── */

type ShapeTikz = {
  /** Path operations, without the command or the final `;`. */
  path: string;
  /** Options the path needs (rounded corners). */
  options: string[];
  /** Stroked-only extra: the front rim of a cylinder's top cap. */
  detail?: string;
};

/**
 * An elliptical arc as cubic Béziers, in the scene's y-down px: angles grow
 * clockwise on the page, 0° points right. `from`/`to` are multiples of 90°.
 * Béziers rather than `arc` keep the geometry independent of how TikZ
 * treats radii under a flipped y axis.
 */
function arcTo(cx: number, cy: number, rx: number, ry: number, from: number, to: number): string {
  const at = (deg: number): Point => {
    const t = (deg * Math.PI) / 180;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  };
  const tangent = (deg: number): Point => {
    const t = (deg * Math.PI) / 180;
    return { x: -rx * Math.sin(t), y: ry * Math.cos(t) };
  };
  const step = to > from ? 90 : -90;
  const sign = Math.sign(step);
  let out = '';
  for (let a = from; a !== to; a += step) {
    const b = a + step;
    const p0 = at(a);
    const p1 = at(b);
    const t0 = tangent(a);
    const t1 = tangent(b);
    const c1 = { x: p0.x + sign * QUARTER_ARC * t0.x, y: p0.y + sign * QUARTER_ARC * t0.y };
    const c2 = { x: p1.x - sign * QUARTER_ARC * t1.x, y: p1.y - sign * QUARTER_ARC * t1.y };
    out += ` .. controls ${c(c1)} and ${c(c2)} .. ${c(p1)}`;
  }
  return out;
}

/** The cylinder of `shapePath`: body with elliptical caps, plus the top cap's front rim. */
function cylinderTikz(rect: Rect): ShapeTikz {
  const { x, y, width: w, height: h } = rect;
  const ry = cylinderCap(rect);
  const rx = w / 2;
  const cx = x + rx;
  const top = y + ry;
  const bottom = y + h - ry;
  return {
    path:
      `${c({ x, y: top })}${arcTo(cx, top, rx, ry, 180, 360)} -- ${c({ x: x + w, y: bottom })}` +
      `${arcTo(cx, bottom, rx, ry, 0, 180)} -- cycle`,
    options: [],
    detail: `${c({ x, y: top })}${arcTo(cx, top, rx, ry, 180, 0)}`,
  };
}

/** The document of `shapePath`: a rectangle with a wavy bottom edge (its SVG `S` spelled out). */
function documentTikz(rect: Rect): ShapeTikz {
  const { x, y, width: w, height: h } = rect;
  const a = documentWave(rect);
  const bottom = y + h - a;
  return {
    path:
      `${c({ x, y })} -- ${c({ x: x + w, y })} -- ${c({ x: x + w, y: bottom })}` +
      ` .. controls ${c({ x: x + w * 0.75, y: bottom - a * 1.6 })} and ${c({ x: x + w * 0.5, y: bottom + a * 1.6 })} .. ${c({ x: x + w * 0.25, y: bottom })}` +
      ` .. controls ${c({ x, y: bottom - a * 1.6 })} and ${c({ x, y: bottom - a })} .. ${c({ x, y: bottom })} -- cycle`,
    options: [],
  };
}

/** Any shape's outline as a TikZ path, from the same geometry the SVG uses. */
function shapeTikz(shape: Shape, rect: Rect, direction: Direction): ShapeTikz {
  if (shape === 'cylinder') return cylinderTikz(rect);
  if (shape === 'document') return documentTikz(rect);
  const outline = shapeOutline(shape, rect, direction);
  switch (outline.kind) {
    case 'rect': {
      const r = Math.min(outline.radius, outline.rect.width / 2, outline.rect.height / 2);
      return { path: rectangle(outline.rect), options: r > 0 ? [`rounded corners=${len(r)}`] : [] };
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = outline;
      const path =
        Math.abs(rx - ry) < 0.05
          ? `${c({ x: cx, y: cy })} circle [radius=${len(rx)}]`
          : `${c({ x: cx, y: cy })} ellipse [x radius=${len(rx)}, y radius=${len(ry)}]`;
      return { path, options: [] };
    }
    case 'polygon':
      return { path: `${outline.points.map(c).join(' -- ')} -- cycle`, options: [] };
  }
}

/** Shapes drawn as a TikZ node, so `(id)` is the shape itself. The rest are explicit paths. */
const NODE_SHAPES = new Set<Shape>(['box', 'round', 'circle', 'op', 'text']);

/**
 * The label to set inside the node's own `\node`, the idiomatic form, when
 * that puts it exactly where the layout did: centred in the shape, and — for
 * circles, which TikZ grows to circumscribe their text — clearly fitting.
 */
function inlineLabel(node: SceneNode): LabelBox | null {
  const box = node.label;
  const { shape, op } = node.model;
  if (!box || shape === 'tensor' || shape === 'image' || (shape === 'op' && op !== null)) return null;
  if (box.align !== 'center') return null;
  const a = centre(box);
  const b = centre(node.shape);
  if (Math.abs(a.x - b.x) > 0.75 || Math.abs(a.y - b.y) > 0.75) return null;
  if (
    (shape === 'circle' || shape === 'op') &&
    (box.width * Math.SQRT2 > node.shape.width || box.height * Math.SQRT2 > node.shape.height)
  ) {
    return null;
  }
  return box;
}

/** Operator glyphs, proportioned as FigureSvg draws them. */
function emitGlyph(out: string[], glyph: NonNullable<OpGlyph>, rect: Rect, stroke: Stroke): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  const line = `\\draw[draw=${stroke.color}, line width=${len(stroke.width)}]`;
  switch (glyph) {
    case 'plus':
      out.push(`${line} ${c({ x: cx - rx, y: cy })} -- ${c({ x: cx + rx, y: cy })} ${c({ x: cx, y: cy - ry })} -- ${c({ x: cx, y: cy + ry })};`);
      return;
    case 'minus':
      out.push(`${line} ${c({ x: cx - rx, y: cy })} -- ${c({ x: cx + rx, y: cy })};`);
      return;
    case 'times': {
      const dx = rx * Math.SQRT1_2;
      const dy = ry * Math.SQRT1_2;
      out.push(
        `${line} ${c({ x: cx - dx, y: cy - dy })} -- ${c({ x: cx + dx, y: cy + dy })} ` +
          `${c({ x: cx + dx, y: cy - dy })} -- ${c({ x: cx - dx, y: cy + dy })};`,
      );
      return;
    }
    case 'dot':
      out.push(`\\fill[fill=${stroke.color}] ${c({ x: cx, y: cy })} circle [radius=${len(Math.min(rx, ry) * 0.22)}];`);
      return;
    case 'concat': {
      const gap = rx * 0.2;
      const h = ry * 0.5;
      out.push(
        `${line} ${c({ x: cx - gap, y: cy - h })} -- ${c({ x: cx - gap, y: cy + h })} ` +
          `${c({ x: cx + gap, y: cy - h })} -- ${c({ x: cx + gap, y: cy + h })};`,
      );
      return;
    }
  }
}

function inMask(pattern: TensorCells['pattern'], row: number, col: number): boolean {
  switch (pattern) {
    case 'full':
      return true;
    case 'lower':
      return col <= row;
    case 'upper':
      return col > row;
    case 'diagonal':
      return col === row;
    default:
      return false;
  }
}

function pushChunked(out: string[], head: string, parts: string[], perLine: number): void {
  for (let i = 0; i < parts.length; i += perLine) out.push(`${head} ${parts.slice(i, i + perLine).join(' ')};`);
}

/** A tensor as FigureSvg draws it: base, shaded cells (mask × values), thin grid, cell text, border. */
function emitTensor(ctx: Ctx, out: string[], node: SceneNode): void {
  const { model } = node;
  const cells = model.cells ?? { rows: 1, cols: 1, text: null, values: null, pattern: 'none' as const };
  const rows = Math.max(1, Math.floor(cells.rows));
  const cols = Math.max(1, Math.floor(cells.cols));
  const { x, y, width, height } = node.shape;
  const cw = width / cols;
  const ch = height / rows;
  const base = model.tone === 'neutral' ? baseColor(ctx, 'background') : toneColor(ctx, model.tone, 'fill');
  out.push(`\\fill[fill=${base}] ${rectangle(node.shape)};`);

  // The mask decides which cells fill, `values` how strongly (printed as a
  // mix with the base: the SVG's fill opacity, without transparency).
  const shades = new Map<string, string[]>();
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const member = cells.pattern === 'none' ? cells.values !== null : inMask(cells.pattern, row, col);
      if (!member) continue;
      const raw = cells.values ? (cells.values[row]?.[col] ?? 0) : 1;
      const percent = Math.round(Math.min(1, Math.max(0, Number.isFinite(raw) ? raw : 0)) * 100);
      if (percent <= 0) continue;
      const fill = mix(toneColor(ctx, model.tone, 'cell'), percent, base);
      const cell = { x: x + col * cw, y: y + row * ch, width: cw, height: ch };
      const list = shades.get(fill) ?? [];
      list.push(rectangle(cell));
      shades.set(fill, list);
    }
  }
  for (const [fill, rects] of shades) pushChunked(out, `\\fill[fill=${fill}]`, rects, RECTS_PER_LINE);

  const rules: string[] = [];
  for (let col = 1; col < cols; col += 1) {
    rules.push(`${c({ x: x + col * cw, y })} -- ${c({ x: x + col * cw, y: y + height })}`);
  }
  for (let row = 1; row < rows; row += 1) {
    rules.push(`${c({ x, y: y + row * ch })} -- ${c({ x: x + width, y: y + row * ch })}`);
  }
  if (rules.length > 0) {
    // Thin, half-strength rules: the grid reads as structure, not ink.
    const gridWidth = Math.min(cw, ch) < 6 ? 0.4 : 0.6;
    const color = mix(toneColor(ctx, model.tone, 'stroke'), 45, base);
    pushChunked(out, `\\draw[draw=${color}, line width=${len(gridWidth)}]`, rules, RECTS_PER_LINE * 2);
  }

  const cellFont = fontOptions(ctx, figureFont(ctx.family, FIGURE_METRICS.font.cell));
  cells.text?.forEach((cellRow, row) =>
    cellRow.forEach((value, col) => {
      if (!value || !value.trim() || row >= rows || col >= cols) return;
      // Read as layout measured it and FigureSvg draws it: `$…$` maths and `\n` breaks.
      const text = labelTex(ctx, parseLabel(value));
      if (!text) return;
      const options = ['inner sep=0pt', 'align=center', `text=${toneColor(ctx, model.tone, 'text')}`, ...cellFont];
      const at = { x: x + (col + 0.5) * cw, y: y + (row + 0.5) * ch };
      out.push(`\\node[${options.join(', ')}] at ${c(at)} {${text}};`);
    }),
  );

  const border = borderStroke(model.border, () => toneColor(ctx, model.tone, 'stroke'));
  if (border) out.push(`\\draw[${strokeOptions(border).join(', ')}] ${rectangle(node.shape)};`);
}

/**
 * An image as a placeholder: TeX cannot fetch a URL or read a data URL, so
 * the comment gives the `\includegraphics` to swap in once the file is local.
 */
function emitImage(ctx: Ctx, out: string[], node: SceneNode): void {
  const { model } = node;
  const rect = node.shape;
  const src = model.src ?? '';
  if (/^https?:\/\//i.test(src)) out.push(`% image source: ${comment(src, 200)}`);
  else if (/^data:/i.test(src)) out.push('% image source: an embedded data URL; save it as a file to include it');
  out.push(
    `% to show it: \\node[inner sep=0pt] at ${c(centre(rect))} ` +
      `{\\includegraphics[width=${len(rect.width)},height=${len(rect.height)},keepaspectratio]{<image file>}};`,
  );
  const placeholder = baseColor(ctx, 'placeholder');
  out.push(`\\fill[fill=${placeholder}] ${rectangle(rect)};`);
  out.push(
    `\\draw[draw=${mix(baseColor(ctx, 'muted'), 50, placeholder)}, line width=${len(STROKE_FINE)}] ` +
      `${c(rect)} -- ${c({ x: rect.x + rect.width, y: rect.y + rect.height })} ` +
      `${c({ x: rect.x + rect.width, y: rect.y })} -- ${c({ x: rect.x, y: rect.y + rect.height })};`,
  );
  const border = borderStroke(model.border, () => toneColor(ctx, model.tone, 'stroke'));
  if (border) {
    const fine = { ...border, width: Math.min(border.width, STROKE_FINE) };
    out.push(`\\draw[${strokeOptions(fine).join(', ')}] ${rectangle(rect)};`);
  }
}

/** One node: stacked copies, the shape (named `name`), glyph, labels, badge, repeat marker. */
function emitNode(ctx: Ctx, out: string[], node: SceneNode, name: string): void {
  const { model } = node;
  const { shape, tone } = model;
  const bare = shape === 'text' && tone === 'neutral';
  const fill = (): string | null => (bare ? null : toneColor(ctx, tone, 'fill'));
  const strokeColor = () => toneColor(ctx, tone, 'stroke');
  const border = borderStroke(model.border, strokeColor);
  const patterned = model.pattern !== 'none' && shape !== 'image' && shape !== 'tensor';
  const hatch = (under: string | null): Hatch | null =>
    patterned ? hatchFor(ctx, model.pattern, tone, under ?? baseColor(ctx, 'background')) : null;
  const size = [`minimum width=${len(node.shape.width)}`, `minimum height=${len(node.shape.height)}`];
  const at = c(centre(node.shape));

  out.push(`% node ${comment(node.id)}`);

  // Stacked copies, back to front, up and to the right; opaque and always
  // outlined, or the stack would merge into one shape.
  const copies = Math.min(8, Math.floor(model.stack));
  for (let k = copies - 1; k >= 1; k -= 1) {
    const rect = {
      x: node.shape.x + k * node.stackOffset,
      y: node.shape.y - k * node.stackOffset,
      width: node.shape.width,
      height: node.shape.height,
    };
    const geometry = shapeTikz(shape, rect, node.direction);
    const under = bare ? baseColor(ctx, 'background') : toneColor(ctx, tone, 'fill');
    const outline = border ?? borderStroke('solid', strokeColor);
    const options = [...fillOptions(under, hatch(under)), ...strokeOptions(outline), ...geometry.options, 'line join=round'];
    out.push(`\\draw[${options.join(', ')}] ${geometry.path};`);
  }

  const inline = inlineLabel(node);
  const labelColor = () => (shape === 'tensor' || shape === 'image' ? baseColor(ctx, 'ink') : toneColor(ctx, tone, 'text'));
  const inlineTex = inline ? labelTex(ctx, inline.label) : '';
  const inlineOptions = inlineTex && inline ? ['align=center', `text=${labelColor()}`, ...fontOptions(ctx, inline.font)] : [];

  if (shape === 'tensor') {
    emitTensor(ctx, out, node);
    out.push(`\\node[${[...size, 'inner sep=0pt'].join(', ')}] (${name}) at ${at} {};`);
  } else if (shape === 'image') {
    emitImage(ctx, out, node);
    out.push(`\\node[${[...size, 'inner sep=0pt'].join(', ')}] (${name}) at ${at} {};`);
  } else if (NODE_SHAPES.has(shape)) {
    const geometry = shapeOutline(shape, node.shape, node.direction);
    const shapeOptions: string[] = [];
    if (geometry.kind === 'ellipse') {
      if (Math.abs(geometry.rx - geometry.ry) < 0.05) shapeOptions.push('circle', `minimum size=${len(node.shape.width)}`);
      else shapeOptions.push('ellipse', ...size);
    } else {
      const radius = geometry.kind === 'rect' ? Math.min(geometry.radius, node.shape.width / 2, node.shape.height / 2) : 0;
      if (radius > 0) shapeOptions.push(`rounded corners=${len(radius)}`);
      shapeOptions.push(...size);
    }
    const f = fill();
    const options = [
      ...fillOptions(f, hatch(f)),
      ...strokeOptions(border),
      ...shapeOptions,
      'inner sep=0pt',
      ...inlineOptions,
    ];
    out.push(`\\node[${options.join(', ')}] (${name}) at ${at} {${inlineTex}};`);
  } else {
    const geometry = shapeTikz(shape, node.shape, node.direction);
    const f = fill();
    const options = [...fillOptions(f, hatch(f)), ...strokeOptions(border), ...geometry.options, 'line join=round'];
    out.push(`${border ? '\\draw' : '\\path'}[${options.join(', ')}] ${geometry.path};`);
    if (geometry.detail && border) out.push(`\\draw[${strokeOptions(border).join(', ')}] ${geometry.detail};`);
    out.push(`\\node[${[...size, 'inner sep=0pt', ...inlineOptions].join(', ')}] (${name}) at ${at} {${inlineTex}};`);
  }

  if (shape === 'op' && model.op !== null) {
    const outline = border ?? borderStroke('solid', strokeColor);
    if (outline) emitGlyph(out, model.op, node.shape, outline);
  } else if (node.label && !inline) {
    const line = labelNode(ctx, node.label, labelColor);
    if (line) out.push(line);
  }
  if (node.sublabel) {
    const line = labelNode(ctx, node.sublabel, () => baseColor(ctx, 'muted'));
    if (line) out.push(line);
  }
  if (node.badge) {
    const badge = node.badge;
    const tex = labelTex(ctx, badge.label);
    if (tex) {
      const options = [
        `fill=${baseColor(ctx, 'background')}`,
        `draw=${strokeColor()}`,
        `line width=${len(STROKE_FINE)}`,
        `rounded corners=${len(badge.height / 2)}`,
        `minimum width=${len(badge.width)}`,
        `minimum height=${len(badge.height)}`,
        'inner sep=0pt',
        // Without `align`, TikZ sets the text in one box and ignores the `\\` of a two-line badge.
        'align=center',
        `text=${strokeColor()}`,
        ...fontOptions(ctx, badge.font),
      ];
      out.push(`\\node[${options.join(', ')}] at ${c(centre(badge))} {${tex}};`);
    }
  }
  if (node.repeat) {
    const line = labelNode(ctx, node.repeat, () => baseColor(ctx, 'ink'));
    if (line) out.push(line);
  }
}

/** A group: its box (filled and/or outlined), then title, repeat marker and panel caption. */
function emitGroup(ctx: Ctx, out: string[], group: SceneGroup): void {
  const { model } = group;
  out.push(`% group ${comment(group.id)}`);
  const stroke = borderStroke(model.border, () => toneColor(ctx, model.tone, 'groupStroke'));
  const fill = model.filled ? toneColor(ctx, model.tone, 'groupFill') : null;
  if (stroke || fill) {
    const radius = Math.min(FIGURE_METRICS.group.radius, group.box.width / 2, group.box.height / 2);
    const options = [...(fill ? [`fill=${fill}`] : []), ...strokeOptions(stroke), `rounded corners=${len(radius)}`];
    out.push(`${stroke ? '\\draw' : '\\path'}[${options.join(', ')}] ${rectangle(group.box)};`);
  }
  for (const box of [group.label, group.repeat, group.panel]) {
    const line = box ? labelNode(ctx, box, () => baseColor(ctx, 'ink')) : null;
    if (line) out.push(line);
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Edges
 * ──────────────────────────────────────────────────────────────────────── */

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Orthogonal polyline with per-corner radii. PGF does not clamp `rounded
 * corners`, so a short jog would draw a loop: each corner gets
 * min(cornerRadius, half of each neighbouring segment), measured on what the
 * arrowheads leave visible — the same rule as the SVG path — and a corner
 * whose radius differs switches `rounded corners` just before the segment
 * leaving it, which is when PGF reads the radius.
 */
function orthogonalPath(points: Point[], startArrow: number, endArrow: number): { path: string; radius: number } {
  // A point on the way between its neighbours is not a corner — including
  // one a router's sub-pixel jitter moved off the line by less than the
  // 0.1px rounding. Dropping it keeps PGF from rounding a phantom corner.
  const pts: Point[] = [];
  for (const p of points) {
    while (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const span = Math.hypot(p.x - a.x, p.y - a.y);
      const along = (b.x - a.x) * (p.x - a.x) + (b.y - a.y) * (p.y - a.y);
      const off = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / (span || 1);
      if (off < COLLINEAR && along > 0 && along < span * span) pts.pop();
      else break;
    }
    pts.push(p);
  }
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const visible = lengths.slice();
  visible[0] = Math.max(0, visible[0] - startArrow);
  visible[visible.length - 1] = Math.max(0, visible[visible.length - 1] - endArrow);
  const { cornerRadius } = FIGURE_METRICS.edge;
  const radii = pts.slice(1, -1).map((_, i) => {
    const r = Math.min(cornerRadius, visible[i] / 2, visible[i + 1] / 2) * PT;
    const rounded = Math.round(r * 100) / 100;
    return rounded < 0.05 ? 0 : rounded;
  });
  let current = radii[0] ?? 0;
  let path = `${c(pts[0])} -- ${c(pts[1])}`;
  for (let k = 1; k < pts.length - 1; k += 1) {
    const r = radii[k - 1];
    let option = '';
    if (r !== current) {
      option = r === 0 ? '[sharp corners] ' : `[rounded corners=${r}pt] `;
      current = r;
    }
    path += ` ${option}-- ${c(pts[k + 1])}`;
  }
  return { path, radius: radii[0] ?? 0 };
}

/** The edge's path from its scene points; null when nothing drawable is left. */
function edgePath(edge: SceneEdge, arrowLength: number): { path: string; radius: number } | null {
  const raw = edge.points.map((p) => ({ x: round1(p.x), y: round1(p.y) }));
  const points = raw.filter((p, i) => i === 0 || !samePoint(p, raw[i - 1]));
  if (points.length < 2) return null;
  if (edge.model.route === 'curved' && raw.length >= 4 && (raw.length - 1) % 3 === 0) {
    let path = c(raw[0]);
    for (let i = 1; i + 2 < raw.length; i += 3) {
      path += ` .. controls ${c(raw[i])} and ${c(raw[i + 1])} .. ${c(raw[i + 2])}`;
    }
    return { path, radius: 0 };
  }
  if (edge.model.route === 'straight' || points.length === 2) {
    return { path: points.map(c).join(' -- '), radius: 0 };
  }
  return orthogonalPath(points, edge.start ? arrowLength : 0, edge.end ? arrowLength : 0);
}

function emitEdge(ctx: Ctx, out: string[], edge: SceneEdge): void {
  const { model } = edge;
  const metrics = FIGURE_METRICS.edge;
  const thick = model.weight === 'thick';
  const width = model.weight === 'thin' ? metrics.strokeThin : thick ? metrics.strokeThick : metrics.stroke;
  const arrowLength = thick ? metrics.arrowLengthThick : metrics.arrowLength;
  const arrowWidth = thick ? metrics.arrowWidthThick : metrics.arrowWidth;
  out.push(`% edge ${comment(model.from, 40)} -> ${comment(model.to, 40)}`);
  const geometry = edgePath(edge, arrowLength);
  if (!geometry) {
    out.push('% (no route to draw)');
    return;
  }
  const options: string[] = [];
  if (edge.start || edge.end) {
    const tip = `{Stealth[length=${len(arrowLength)},width=${len(arrowWidth)}]}`;
    options.push(`${edge.start ? tip : ''}-${edge.end ? tip : ''}`);
  }
  options.push(`draw=${edgeColorName(ctx, model.tone)}`, `line width=${len(width)}`);
  // Dashes grow with the line, as in the SVG, so a thick dashed edge still reads as dashed.
  const k = Math.max(1, width / metrics.stroke);
  if (model.line === 'dashed') options.push(`dash pattern=${dashPattern(4 * k, 3 * k)}`);
  else if (model.line === 'dotted') options.push(`dash pattern=${dashPattern(1, 2.5 * k)}`, 'line cap=round');
  options.push('line join=round');
  if (geometry.radius > 0) options.push(`rounded corners=${geometry.radius}pt`);
  out.push(`\\draw[${options.join(', ')}] ${geometry.path};`);
}

function emitEdgeLabel(ctx: Ctx, out: string[], edge: SceneEdge): void {
  if (!edge.label) return;
  const { tone } = edge.model;
  const color = () => (tone && tone !== 'neutral' ? edgeColorName(ctx, tone) : baseColor(ctx, 'ink'));
  // The white box is the SVG's halo: a line passing under the label stops short of the text.
  const line = labelNode(ctx, edge.label, color, ['fill=white'], '1pt');
  if (line) out.push(line);
}

function emitLegend(ctx: Ctx, out: string[], legend: SceneLegend): void {
  for (const item of legend.items) {
    const { sample, swatch } = item;
    if (sample.kind === 'node') {
      // As in the SVG: bare text, tensors and images would be unreadable at swatch size.
      const shape =
        sample.shape === 'text' || sample.shape === 'tensor' || sample.shape === 'image' ? 'box' : sample.shape;
      const geometry = shapeTikz(shape, swatch, 'down');
      const fill = toneColor(ctx, sample.tone, 'fill');
      const stroke = borderStroke(sample.border, () => toneColor(ctx, sample.tone, 'stroke'));
      const options = [
        ...fillOptions(fill, hatchFor(ctx, sample.pattern, sample.tone, fill)),
        ...strokeOptions(stroke),
        ...geometry.options,
        'line join=round',
      ];
      out.push(`${stroke ? '\\draw' : '\\path'}[${options.join(', ')}] ${geometry.path};`);
    } else {
      const metrics = FIGURE_METRICS.edge;
      const width =
        sample.weight === 'thin' ? metrics.strokeThin : sample.weight === 'thick' ? metrics.strokeThick : metrics.stroke;
      const k = Math.max(1, width / metrics.stroke);
      const options = [`draw=${edgeColorName(ctx, sample.tone)}`, `line width=${len(width)}`];
      if (sample.line === 'dashed') options.push(`dash pattern=${dashPattern(4 * k, 3 * k)}`);
      else if (sample.line === 'dotted') options.push(`dash pattern=${dashPattern(1, 2.5 * k)}`, 'line cap=round');
      const y = swatch.y + swatch.height / 2;
      out.push(`\\draw[${options.join(', ')}] ${c({ x: swatch.x, y })} -- ${c({ x: swatch.x + swatch.width, y })};`);
    }
    const line = labelNode(ctx, item.label, () => baseColor(ctx, 'ink'));
    if (line) out.push(line);
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Document
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * TikZ node names: `[A-Za-z0-9]` only (anything else can clash with TikZ's
 * `name.anchor` syntax), never starting with a digit, unique in scene order.
 */
function nodeNames(nodes: SceneNode[]): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  nodes.forEach((node, index) => {
    let base = node.id.replace(/[^A-Za-z0-9]/g, '');
    if (!base) base = `n${index + 1}`;
    else if (/^[0-9]/.test(base)) base = `n${base}`;
    let name = base;
    for (let k = 2; used.has(name); k += 1) name = `${base}${k}`;
    used.add(name);
    names.set(node.id, name);
  });
  return names;
}

/** A `\label` key: letters, digits and the usual separators; null when nothing is left. */
function labelKey(label: string | null): string | null {
  const key = (label ?? '').trim().replace(/[^A-Za-z0-9:._/+-]+/g, '-');
  return /[A-Za-z0-9]/.test(key) ? key : null;
}

/** The caption on one line: maths kept, text escaped, line breaks as spaces. */
function captionTex(ctx: Ctx, caption: string): string {
  return parseLabel(caption)
    .lines.map((line) => lineTex(ctx, line).trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * The figure as a LaTeX snippet: a commented preamble, then a `figure`
 * environment (caption and label from the spec) around a `tikzpicture`,
 * or the bare `tikzpicture`. Colours are `\definecolor`ed inside the picture
 * — only the ones it paints, from the light palette (`mono` for grayscale
 * print) — so the snippet pastes into any document without clashes.
 * Deterministic: the same scene always gives the same text.
 */
export function figureToTikz(
  scene: FigureScene,
  model: FigureModel,
  options?: { environment?: 'figure' | 'tikzpicture'; palette?: 'color' | 'mono' },
): string {
  const environment = options?.environment ?? 'figure';
  const palette = figurePalette('light', options?.palette ?? model.palette);
  const ctx: Ctx = {
    palette,
    family: model.font,
    colors: new Map(),
    ams: false,
    packages: new Set(),
    notes: new Set(),
    noted: false,
    baseFont: fontCommand(figureFont(model.font, FIGURE_METRICS.font.node)),
  };

  const body: string[] = [`\\useasboundingbox ${rectangle({ x: 0, y: 0, width: scene.width, height: scene.height })};`];
  const section = (title: string, lines: string[]) => {
    if (lines.length > 0) body.push(`% ${title}`, ...lines);
  };

  // Paint order as in the SVG: groups (outer first), edges, nodes, edge labels, legend.
  // An element's notes follow its own lines, so each sits next to what it explains.
  const groups = scene.groups
    .map((group, order) => ({ group, order }))
    .sort((a, b) => a.group.depth - b.group.depth || a.order - b.order);
  const groupLines: string[] = [];
  for (const { group } of groups) {
    emitGroup(ctx, groupLines, group);
    groupLines.push(...takeNotes(ctx));
  }
  section('Groups', groupLines);

  const edgeLines: string[] = [];
  for (const edge of scene.edges) emitEdge(ctx, edgeLines, edge);
  section('Edges', edgeLines);

  const names = nodeNames(scene.nodes);
  const nodeLines: string[] = [];
  for (const node of scene.nodes) {
    emitNode(ctx, nodeLines, node, names.get(node.id) ?? 'n');
    nodeLines.push(...takeNotes(ctx));
  }
  section('Nodes', nodeLines);

  const edgeLabelLines: string[] = [];
  for (const edge of scene.edges) {
    emitEdgeLabel(ctx, edgeLabelLines, edge);
    edgeLabelLines.push(...takeNotes(ctx));
  }
  section('Edge labels', edgeLabelLines);

  if (scene.legend) {
    const legendLines: string[] = [];
    emitLegend(ctx, legendLines, scene.legend);
    legendLines.push(...takeNotes(ctx));
    section('Legend', legendLines);
  }

  const caption = environment === 'figure' && model.caption ? captionTex(ctx, model.caption) : '';
  const captionNotes = takeNotes(ctx);

  // Width: an explicit size prints at its share of the column, as on screen;
  // a natural-size figure wider than the column gets a hint to fit it.
  const share = SIZE_SHARE[model.size];
  const tooWide = scene.width > FIGURE_METRICS.printColumn;
  const resize = share !== null ? `\\resizebox{${share}\\linewidth}{!}{%` : tooWide ? '\\resizebox{\\linewidth}{!}{%' : null;
  const activeResize = environment === 'figure' && share !== null;

  const picture = [
    `\\begin{tikzpicture}[x=${PT}pt,y=-${PT}pt, font=${ctx.baseFont}]`,
    ...[...ctx.colors].map(([name, hex]) => `  \\definecolor{${name}}{HTML}{${hex}}`),
    ...body.map((line) => `  ${line}`),
    `\\end{tikzpicture}${resize ? '%' : ''}`,
  ];
  let wrapped: string[];
  if (!resize) {
    wrapped = picture;
  } else if (activeResize) {
    wrapped = [resize, ...picture, '}'];
  } else {
    const why = tooWide
      ? `% ${fixed(scene.width, 1)}px (${fixed(scene.width * PT, 1)}pt) wide, wider than a ${FIGURE_METRICS.printColumn}px text column:`
      : `% Printed at ${share || '1'}\\linewidth on screen:`;
    wrapped = [`${why} uncomment the two \\resizebox lines to fit it.`, `% ${resize}`, ...picture, '% }'];
  }

  const header = [
    ...(model.title ? [`% ${comment(model.title)}`] : []),
    '% TikZ export of a ColWrite structured figure.',
    '% Preamble:',
    '%   \\usepackage{tikz}',
    '%   \\usetikzlibrary{arrows.meta,shapes.geometric,patterns,calc}',
    ...(ctx.ams ? ['%   \\usepackage{amsmath,amssymb}  % for the maths in the labels'] : []),
    ...(ctx.packages.size > 0
      ? [`%   \\usepackage{${[...ctx.packages].sort().join(',')}}  % for commands the maths in the labels uses`]
      : []),
    '%   \\usepackage{lmodern}  % optional: scalable fonts, so small labels print at their exact size',
    "% Coordinates are the editor's px (1px = 0.75pt), measured down from the top-left corner.",
    ...(ctx.noted ? ['% Some labels print differently from the editor: see the "% note:" lines.'] : []),
  ];

  if (environment === 'tikzpicture') return [...header, ...wrapped].join('\n') + '\n';

  const figureEnv = model.size === 'full' ? 'figure*' : 'figure';
  const key = labelKey(model.label);
  const closing = caption
    ? [...captionNotes, `\\caption{${caption}}`, ...(key ? [`\\label{${key}}`] : [])]
    : ['% \\caption{…}', ...(key ? [`% \\label{${key}}`] : [])];
  return (
    [
      ...header,
      `\\begin{${figureEnv}}[t]`,
      '  \\centering',
      ...wrapped.map((line) => `  ${line}`),
      ...closing.map((line) => `  ${line}`),
      `\\end{${figureEnv}}`,
    ].join('\n') + '\n'
  );
}
