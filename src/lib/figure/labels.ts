import { FIGURE_METRICS } from './constants';
import type { FontSpec, Label, LabelBox, LabelSegment, TextMeasurer } from './types';

/**
 * Figure labels: text with `$…$` maths and line breaks.
 *
 * A label is parsed once, by normalisation, into lines of text and maths
 * segments with the whitespace an SVG `<text>` would collapse already
 * collapsed, so what layout measures is exactly what the renderers draw.
 */

/**
 * Line breaks: a real newline, and — for the common double-escaped
 * `"Multi-Head\\nAttention"` — a literal `\n` outside maths, whatever
 * follows: text outside `$…$` is never LaTeX, and maths (where `\nabla` and
 * `\nu` live) is consumed whole before this is asked.
 */
function isLiteralBreak(text: string, i: number): boolean {
  return text[i] === '\\' && text[i + 1] === 'n';
}

/** Index of the delimiter closing maths that starts at `from`, or -1. */
function closingDollar(text: string, from: number, double: boolean): number {
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1; // `\$` and `\\` inside maths belong to the LaTeX
    } else if (ch === '\n') {
      return -1; // maths never spans a line break
    } else if (ch === '$' && (!double || text[i + 1] === '$')) {
      return i;
    }
  }
  return -1;
}

/**
 * Undoes one escaping level too many inside maths. `\\mathbf` — a label
 * copied from an already-escaped JSON string — would typeset as a row break
 * followed by italic letters, so exactly two backslashes before two or more
 * ASCII letters (a command name) become one. A real row break (`\\` before
 * a space, digit, bracket, a lone letter or the end) is kept, and so is
 * `\\\mathbf` (a row break, then a command).
 */
function repairOverEscapedMath(latex: string): string {
  return latex.replace(/\\+(?=[A-Za-z]{2})/g, (run) => (run.length === 2 ? '\\' : run));
}

/**
 * Collapses runs of spaces and tabs to one space and drops other control
 * characters, as SVG and HTML rendering would; no-break spaces are kept.
 */
function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, '').replace(/[ \t\v\f]+/g, ' ');
}

function trimLine(segments: LabelSegment[]): LabelSegment[] {
  const out = segments.slice();
  if (out[0]?.kind === 'text') out[0] = { kind: 'text', value: out[0].value.replace(/^ +/, '') };
  const last = out.length - 1;
  if (out[last]?.kind === 'text') out[last] = { kind: 'text', value: out[last].value.replace(/ +$/, '') };
  return out.filter((segment) => segment.kind === 'math' || segment.value !== '');
}

/**
 * Parses label text as written in the spec.
 *
 * - A newline breaks the line (`\r\n` and `\r` count as one); so does a
 *   literal `\n` outside maths (a literal backslash there is `\\`).
 * - `$…$` (or `$$…$$`, drawn inline too) is maths, never across a line
 *   break; empty maths is dropped. `\$` is a literal dollar sign and `\\` a
 *   literal backslash outside maths; inside maths both stay LaTeX, except
 *   that an over-escaped `\\mathbf` is read as `\mathbf`.
 * - A `$` with no closing partner on its line is literal text.
 * - Runs of whitespace collapse to one space; each line is trimmed, and
 *   blank lines at the start and end are dropped (blank lines in between
 *   are kept as spacing).
 */
export function parseLabel(text: string): Label {
  if (!text) return { lines: [], source: '', hasMath: false };
  const source = text;
  const input = text.replace(/\r\n?/g, '\n');
  const lines: LabelSegment[][] = [];
  let line: LabelSegment[] = [];
  let buffer = '';
  const flushText = () => {
    if (buffer) line.push({ kind: 'text', value: cleanText(buffer) });
    buffer = '';
  };
  const breakLine = () => {
    flushText();
    lines.push(trimLine(mergeText(line)));
    line = [];
  };

  for (let i = 0; i < input.length; ) {
    const ch = input[i];
    if (ch === '\n') {
      breakLine();
      i += 1;
    } else if (isLiteralBreak(input, i)) {
      breakLine();
      i += 2;
    } else if (ch === '\\' && (input[i + 1] === '$' || input[i + 1] === '\\')) {
      buffer += input[i + 1];
      i += 2;
    } else if (ch === '$') {
      const double = input[i + 1] === '$';
      const open = double ? 2 : 1;
      const close = closingDollar(input, i + open, double);
      if (close < 0) {
        // Unmatched: the first `$` is text; a `$$` may still open single-dollar maths.
        buffer += '$';
        i += 1;
        continue;
      }
      const latex = input.slice(i + open, close);
      if (latex.trim()) {
        flushText();
        line.push({ kind: 'math', value: repairOverEscapedMath(latex) });
      }
      i = close + open;
    } else {
      buffer += ch;
      i += 1;
    }
  }
  breakLine();

  while (lines.length > 0 && lines[0].length === 0) lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].length === 0) lines.pop();
  return { lines, source, hasMath: lines.some((segments) => segments.some((segment) => segment.kind === 'math')) };
}

/** Joins neighbouring text segments, so a line alternates text and maths. */
function mergeText(segments: LabelSegment[]): LabelSegment[] {
  const out: LabelSegment[] = [];
  for (const segment of segments) {
    const previous = out[out.length - 1];
    if (segment.kind === 'text' && previous?.kind === 'text') {
      out[out.length - 1] = { kind: 'text', value: (previous.value + segment.value).replace(/ {2,}/g, ' ') };
    } else {
      out.push(segment);
    }
  }
  return out;
}

/** A hyphen or en dash between a letter or digit and the line's end. */
const SOFT_HYPHEN_END = /[\p{L}\p{N}][-\u2010\u2013]$/u;

/**
 * The label as plain readable text, for accessible names, alt text and
 * search: maths is kept as its LaTeX without the `$`, lines are joined with
 * a space — except after a line ending in a hyphen ("Multi-" + "Head"), so
 * a wrapped label reads the same as the original.
 */
export function labelText(label: Label): string {
  let text = '';
  for (const segments of label.lines) {
    const line = segments.map((segment) => (segment.kind === 'math' ? segment.value.trim() : segment.value)).join('');
    if (!line.trim()) continue;
    text += text && !SOFT_HYPHEN_END.test(text) ? ` ${line}` : line;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Whether a label draws nothing: absent, or only whitespace and empty maths. */
export function isEmptyLabel(label: Label | null): boolean {
  if (!label) return true;
  return label.lines.every((segments) => segments.every((segment) => !segment.value.trim()));
}

/* ────────────────────────────────────────────────────────────────────────
 * Measuring and wrapping
 * ──────────────────────────────────────────────────────────────────────── */

type Measured = { width: number; height: number; segments: number[] };

function measureLine(segments: LabelSegment[], font: FontSpec, measurer: TextMeasurer, lineHeight: number): Measured {
  let width = 0;
  let height = lineHeight;
  const widths = segments.map((segment) => {
    if (segment.kind === 'text') return measurer.text(segment.value, font).width;
    const extent = measurer.math(segment.value, font);
    // Tall maths (a fraction, stacked scripts) makes its line taller.
    height = Math.max(height, extent.height);
    return extent.width;
  });
  for (const w of widths) width += w;
  return { width, height, segments: widths };
}

/** How a word joins the next one: at a space (dropped at a break) or after a hyphen. */
type Word = { segments: LabelSegment[]; joint: 'space' | 'hyphen' | 'end' };

/**
 * Splits a line into words. Text breaks at spaces and after a hyphen or en
 * dash between letters/digits; maths is atomic and sticks to the text
 * touching it, so "($Q$," never breaks.
 */
function splitWords(segments: LabelSegment[]): Word[] {
  const words: Word[] = [];
  let current: LabelSegment[] = [];
  let run = '';
  const flushRun = () => {
    if (run) current.push({ kind: 'text', value: run });
    run = '';
  };
  const endWord = (joint: Word['joint']) => {
    flushRun();
    if (current.length > 0) words.push({ segments: current, joint });
    else if (words.length > 0 && joint === 'space') words[words.length - 1].joint = 'space';
    current = [];
  };
  for (const segment of segments) {
    if (segment.kind === 'math') {
      flushRun();
      current.push(segment);
      continue;
    }
    const { value } = segment;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === ' ') {
        endWord('space');
      } else {
        run += ch;
        const breakable =
          (ch === '-' || ch === '\u2010' || ch === '\u2013') &&
          /[\p{L}\p{N}]/u.test(value[i - 1] ?? '') &&
          /[\p{L}\p{N}]/u.test(value[i + 1] ?? '');
        if (breakable) endWord('hyphen');
      }
    }
  }
  endWord('end');
  return words;
}

/** The segments of words joined into one line (text runs merged). */
function joinWords(words: Word[]): LabelSegment[] {
  const segments: LabelSegment[] = [];
  words.forEach((word, i) => {
    segments.push(...word.segments);
    if (i < words.length - 1 && word.joint === 'space') segments.push({ kind: 'text', value: ' ' });
  });
  return mergeText(segments);
}

/**
 * Greedy word wrap of one line at `maxWidth`. Returns null when the line
 * fits (or cannot break), so an unchanged line keeps its segments as-is. A
 * single word wider than `maxWidth` stays whole: breaking inside a word or
 * a formula reads worse in a figure than a box that grows.
 */
function wrapLine(
  segments: LabelSegment[],
  maxWidth: number,
  width: (segments: LabelSegment[]) => number,
): LabelSegment[][] | null {
  const words = splitWords(segments);
  if (words.length < 2) return null;
  const lines: LabelSegment[][] = [];
  let start = 0;
  for (let i = 1; i < words.length; i += 1) {
    // Tolerance: a line that fits exactly must not wrap on float noise.
    if (width(joinWords(words.slice(start, i + 1))) > maxWidth + 1e-6) {
      lines.push(joinWords(words.slice(start, i)));
      start = i;
    }
  }
  if (start === 0) return null;
  lines.push(joinWords(words.slice(start)));
  return lines;
}

/**
 * Measures a label, returning its box at (0, 0).
 *
 * With `maxWidth`, text is greedily word-wrapped (maths segments are atomic)
 * and the wrapped label replaces `box.label`; explicit line breaks always
 * hold. Each line is `font.size × lineHeight` tall, or as tall as its
 * tallest maths. An empty label measures 0 × 0.
 */
export function measureLabel(
  label: Label,
  font: FontSpec,
  measurer: TextMeasurer,
  options?: { maxWidth?: number; align?: 'left' | 'center' | 'right' },
): LabelBox {
  const align = options?.align ?? 'center';
  const lineHeight = font.size * FIGURE_METRICS.lineHeight;
  if (isEmptyLabel(label)) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      label,
      font,
      align,
      lines: label.lines.map((segments) => ({ width: 0, height: 0, segments: segments.map(() => 0) })),
      lineHeight,
    };
  }

  const measure = (segments: LabelSegment[]) => measureLine(segments, font, measurer, lineHeight);
  let wrapped = label;
  const maxWidth = options?.maxWidth;
  if (maxWidth !== undefined && Number.isFinite(maxWidth)) {
    let changed = false;
    const lines = label.lines.flatMap((segments) => {
      if (measure(segments).width <= maxWidth + 1e-6) return [segments];
      const broken = wrapLine(segments, maxWidth, (candidate) => measure(candidate).width);
      if (!broken) return [segments];
      changed = true;
      return broken;
    });
    if (changed) wrapped = { lines, source: label.source, hasMath: label.hasMath };
  }

  const lines = wrapped.lines.map(measure);
  return {
    x: 0,
    y: 0,
    width: lines.reduce((max, line) => Math.max(max, line.width), 0),
    height: lines.reduce((sum, line) => sum + line.height, 0),
    label: wrapped,
    font,
    align,
    lines,
    lineHeight,
  };
}
