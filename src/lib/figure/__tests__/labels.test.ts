import { describe, expect, it, vi } from 'vitest';
import { FIGURE_METRICS, figureFont } from '../constants';
import { isEmptyLabel, labelText, measureLabel, parseLabel } from '../labels';
import { createHeuristicMeasurer } from '../measure';
import type { Label, LabelSegment, TextMeasurer } from '../types';

const text = (value: string): LabelSegment => ({ kind: 'text', value });
const math = (value: string): LabelSegment => ({ kind: 'math', value });

/** Exact arithmetic: 6px per text character, 10px per LaTeX character. */
function fakeMeasurer(mathHeight: (latex: string) => number = () => 15): TextMeasurer {
  return {
    key: 'fake',
    text: (value) => ({ width: [...value].length * 6, height: 14 }),
    math: (latex) => ({ width: [...latex].length * 10, height: mathHeight(latex) }),
  };
}

const FONT = figureFont('sans', 12);
const LINE = 12 * FIGURE_METRICS.lineHeight;

/** A wrapped box's lines as plain strings, maths in `$…$`. */
function lineStrings(label: Label): string[] {
  return label.lines.map((line) => line.map((s) => (s.kind === 'math' ? `$${s.value}$` : s.value)).join(''));
}

describe('parseLabel', () => {
  it('reads plain text as one text line and keeps the source', () => {
    expect(parseLabel('Add & Norm')).toEqual({ lines: [[text('Add & Norm')]], source: 'Add & Norm', hasMath: false });
  });

  it('reads nothing from an empty or blank string', () => {
    expect(parseLabel('')).toEqual({ lines: [], source: '', hasMath: false });
    expect(parseLabel('  \n\t ')).toEqual({ lines: [], source: '  \n\t ', hasMath: false });
  });

  it('splits lines on real newlines, including \\r\\n and a lone \\r', () => {
    expect(parseLabel('Multi-Head\nAttention').lines).toEqual([[text('Multi-Head')], [text('Attention')]]);
    expect(parseLabel('a\r\nb\rc').lines).toEqual([[text('a')], [text('b')], [text('c')]]);
  });

  it('treats a double-escaped literal \\n outside maths as a line break', () => {
    // The JSON "Multi-Head\\nAttention" decodes to a backslash and an n.
    expect(parseLabel('Multi-Head\\nAttention').lines).toEqual([[text('Multi-Head')], [text('Attention')]]);
    expect(parseLabel('Add\\n Norm').lines).toEqual([[text('Add')], [text('Norm')]]);
    expect(parseLabel('end\\n').lines).toEqual([[text('end')]]);
  });

  it('breaks at a literal \\n before a lowercase word too, since text outside maths is never LaTeX', () => {
    // A model that doubles every backslash writes a PRISMA sublabel like this.
    expect(parseLabel('$n = 80$\\nwrong population (41)\\nno comparator (27)').lines).toEqual([
      [math('n = 80')],
      [text('wrong population (41)')],
      [text('no comparator (27)')],
    ]);
    expect(parseLabel('Excluded\\nwrong population').lines).toEqual([[text('Excluded')], [text('wrong population')]]);
    // A backslash meant literally is written `\\`.
    expect(parseLabel('C:\\\\new').lines).toEqual([[text('C:\\new')]]);
  });

  it('keeps a literal \\n inside maths as LaTeX', () => {
    expect(parseLabel('$\\nabla \\nu$').lines).toEqual([[math('\\nabla \\nu')]]);
    expect(parseLabel('Gradient $\\nabla f$\\nnorm').lines).toEqual([[text('Gradient '), math('\\nabla f')], [text('norm')]]);
  });

  it('splits maths from text and flags it', () => {
    const label = parseLabel('Linear $W^Q$ and $W^K$');
    expect(label.lines).toEqual([[text('Linear '), math('W^Q'), text(' and '), math('W^K')]]);
    expect(label.hasMath).toBe(true);
  });

  it('keeps LaTeX verbatim inside maths, spaces and escapes included', () => {
    expect(parseLabel('$\\mathbf{c}_t^{KV}  \\in \\mathbb{R}$').lines).toEqual([
      [math('\\mathbf{c}_t^{KV}  \\in \\mathbb{R}')],
    ]);
  });

  it('repairs a doubled backslash before a command inside maths, so it typesets', () => {
    // `\\mathbf` (escaped once too often) would draw as a row break and italic letters.
    expect(parseLabel('$\\\\mathbf{k}_t^{C}$').lines).toEqual([[math('\\mathbf{k}_t^{C}')]]);
    expect(parseLabel('Latent $\\\\mathbf{c}_t^{KV} \\\\in \\\\mathbb{R}^{d_c}$').lines).toEqual([
      [text('Latent '), math('\\mathbf{c}_t^{KV} \\in \\mathbb{R}^{d_c}')],
    ]);
    // What a tool call copying a snapshot label verbatim stores.
    expect(parseLabel(JSON.parse('"$\\\\\\\\frac{QK^\\\\\\\\top}{\\\\\\\\sqrt{d_k}}$"') as string).lines).toEqual([
      [math('\\frac{QK^\\top}{\\sqrt{d_k}}')],
    ]);
  });

  it('keeps a real LaTeX row break inside maths', () => {
    // Before a space, digit, bracket, a lone letter or the end, `\\` is a row break.
    for (const latex of ['a \\\\ b', 'a\\\\2', 'a\\\\[2pt] b', 'a\\\\{b}', 'a\\\\b', 'a\\\\']) {
      expect(parseLabel(`$${latex}$`).lines).toEqual([[math(latex)]]);
    }
    // Three backslashes are a row break followed by a command.
    expect(parseLabel('$a\\\\\\beta$').lines).toEqual([[math('a\\\\\\beta')]]);
    // Outside maths, `\\` is still a literal backslash.
    expect(parseLabel('a\\\\mathbf').lines).toEqual([[text('a\\mathbf')]]);
  });

  it('reads \\$ as a literal dollar and \\\\ as a literal backslash outside maths', () => {
    expect(parseLabel('cost \\$5').lines).toEqual([[text('cost $5')]]);
    expect(parseLabel('a\\\\b').lines).toEqual([[text('a\\b')]]);
    // An escaped backslash does not escape the dollar after it.
    expect(parseLabel('\\\\$x$').lines).toEqual([[text('\\'), math('x')]]);
  });

  it('keeps \\$ inside maths as LaTeX, where it does not close the maths', () => {
    expect(parseLabel('$\\$5 + x$').lines).toEqual([[math('\\$5 + x')]]);
  });

  it('reads a $ with no partner on its line as text', () => {
    expect(parseLabel('Cost: $5').lines).toEqual([[text('Cost: $5')]]);
    expect(parseLabel('$a$ costs $5').lines).toEqual([[math('a'), text(' costs $5')]]);
    expect(parseLabel('$').lines).toEqual([[text('$')]]);
    expect(parseLabel('$$').lines).toEqual([[text('$$')]]);
  });

  it('never lets maths span a line break', () => {
    expect(parseLabel('$a\nb$').lines).toEqual([[text('$a')], [text('b$')]]);
  });

  it('reads $$…$$ as (inline) maths, and falls back to $…$ when $$ is unclosed', () => {
    expect(parseLabel('$$x+y$$').lines).toEqual([[math('x+y')]]);
    expect(parseLabel('$$x$').lines).toEqual([[text('$'), math('x')]]);
  });

  it('drops empty maths', () => {
    expect(parseLabel('a $ $ b').lines).toEqual([[text('a b')]]);
    expect(parseLabel('$$$$').lines).toEqual([]);
    expect(parseLabel('x $  $').hasMath).toBe(false);
  });

  it('reads adjacent maths as separate segments', () => {
    expect(parseLabel('$a$$b$').lines).toEqual([[math('a'), math('b')]]);
  });

  it('collapses whitespace runs and trims each line, as SVG text would', () => {
    expect(parseLabel('  Feed \t  Forward  ').lines).toEqual([[text('Feed Forward')]]);
    expect(parseLabel('  $x$   and  ').lines).toEqual([[math('x'), text(' and')]]);
  });

  it('keeps no-break spaces and drops stray control characters', () => {
    expect(parseLabel('N\u00a0×').lines).toEqual([[text('N\u00a0×')]]);
    expect(parseLabel('a\u0008b\u0000c').lines).toEqual([[text('abc')]]);
  });

  it('drops blank lines at the ends but keeps interior ones as spacing', () => {
    expect(parseLabel('\n\nA\n\nB\n\n').lines).toEqual([[text('A')], [], [text('B')]]);
  });

  it('keeps astral characters intact', () => {
    expect(parseLabel('🙂 ok').lines).toEqual([[text('🙂 ok')]]);
  });
});

describe('labelText', () => {
  it('keeps maths as LaTeX without the dollars and joins lines with a space', () => {
    expect(labelText(parseLabel('Linear $W^Q$\nprojection'))).toBe('Linear W^Q projection');
  });

  it('joins a line ending in a hyphen without a space', () => {
    expect(labelText(parseLabel('Multi-\nHead'))).toBe('Multi-Head');
    // A spaced dash is a dash, not a broken word.
    expect(labelText(parseLabel('x -\ny'))).toBe('x - y');
  });

  it('collapses whitespace, including inside maths, and skips blank lines', () => {
    expect(labelText(parseLabel('a\n\n$ x  +   y $'))).toBe('a x + y');
  });

  it('is empty for an empty label', () => {
    expect(labelText(parseLabel(''))).toBe('');
  });

  it('reads the same before and after wrapping', () => {
    const label = parseLabel('Retrieval-augmented generation with $\\mathbf{h}_t$ memory');
    const box = measureLabel(label, FONT, createHeuristicMeasurer(), { maxWidth: 60 });
    expect(box.label.lines.length).toBeGreaterThan(2);
    expect(labelText(box.label)).toBe(labelText(label));
  });
});

describe('isEmptyLabel', () => {
  it('is true for null, an empty parse and whitespace-only segments', () => {
    expect(isEmptyLabel(null)).toBe(true);
    expect(isEmptyLabel(parseLabel(''))).toBe(true);
    expect(isEmptyLabel({ lines: [[text('  ')], [math(' ')]], source: '', hasMath: true })).toBe(true);
  });

  it('is false as soon as anything draws', () => {
    expect(isEmptyLabel(parseLabel('Q'))).toBe(false);
    expect(isEmptyLabel(parseLabel('$x$'))).toBe(false);
  });
});

describe('measureLabel', () => {
  it('measures an empty label as a 0×0 box at the origin', () => {
    const label = parseLabel('');
    const box = measureLabel(label, FONT, fakeMeasurer());
    expect(box).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      label,
      font: FONT,
      align: 'center',
      lines: [],
      lineHeight: LINE,
    });
  });

  it('keeps one zero line per line of a whitespace-only label', () => {
    const label: Label = { lines: [[text(' ')], []], source: ' ', hasMath: false };
    const box = measureLabel(label, FONT, fakeMeasurer());
    expect(box.width).toBe(0);
    expect(box.height).toBe(0);
    expect(box.lines).toEqual([
      { width: 0, height: 0, segments: [0] },
      { width: 0, height: 0, segments: [] },
    ]);
  });

  it('sums segment widths per line and uses font.size × lineHeight per line', () => {
    const box = measureLabel(parseLabel('ab $xy$ c'), FONT, fakeMeasurer());
    expect(box.lines).toEqual([{ width: 18 + 20 + 12, height: LINE, segments: [18, 20, 12] }]);
    expect(box.width).toBe(50);
    expect(box.height).toBe(LINE);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.lineHeight).toBe(LINE);
  });

  it('stacks explicit lines: height is the sum, width the widest', () => {
    const box = measureLabel(parseLabel('abc\na\n\nabcd'), FONT, fakeMeasurer());
    expect(box.lines.map((line) => line.width)).toEqual([18, 6, 0, 24]);
    expect(box.width).toBe(24);
    expect(box.height).toBe(4 * LINE);
  });

  it('makes a line as tall as its tallest maths, never shorter than a text line', () => {
    const measurer = fakeMeasurer((latex) => (latex.startsWith('\\frac') ? 24 : 9));
    const box = measureLabel(parseLabel('$\\frac{a}{b}$ x\n$y$'), FONT, measurer);
    expect(box.lines.map((line) => line.height)).toEqual([24, LINE]);
    expect(box.height).toBe(24 + LINE);
  });

  it('passes the font through to the measurer', () => {
    const measurer = fakeMeasurer();
    const textSpy = vi.spyOn(measurer, 'text');
    const mathSpy = vi.spyOn(measurer, 'math');
    const bold = figureFont('serif', 11, 600, true);
    measureLabel(parseLabel('a $b$'), bold, measurer);
    expect(textSpy).toHaveBeenCalledWith('a ', bold);
    expect(mathSpy).toHaveBeenCalledWith('b', bold);
  });

  it('records the alignment and keeps the label object when nothing wraps', () => {
    const label = parseLabel('short');
    const box = measureLabel(label, FONT, fakeMeasurer(), { align: 'right', maxWidth: 1000 });
    expect(box.align).toBe('right');
    expect(box.label).toBe(label);
  });

  describe('wrapping', () => {
    it('breaks greedily at spaces and drops the space at the break', () => {
      // "aaa bbb" = 42px fits 45; "aaa bbb ccc" = 66px does not.
      const box = measureLabel(parseLabel('aaa bbb ccc'), FONT, fakeMeasurer(), { maxWidth: 45 });
      expect(lineStrings(box.label)).toEqual(['aaa bbb', 'ccc']);
      expect(box.lines.map((line) => line.width)).toEqual([42, 18]);
      expect(box.width).toBe(42);
      expect(box.height).toBe(2 * LINE);
    });

    it('does not wrap a line that fits exactly', () => {
      const label = parseLabel('aaa bbb');
      const box = measureLabel(label, FONT, fakeMeasurer(), { maxWidth: 42 });
      expect(box.label).toBe(label);
      expect(box.lines).toHaveLength(1);
    });

    it('keeps the source and maths flag, and line boxes aligned with the wrapped lines', () => {
      const label = parseLabel('one two $x$ three four');
      const box = measureLabel(label, FONT, fakeMeasurer(), { maxWidth: 30 });
      expect(box.label).not.toBe(label);
      expect(box.label.source).toBe(label.source);
      expect(box.label.hasMath).toBe(true);
      expect(box.lines).toHaveLength(box.label.lines.length);
      box.label.lines.forEach((line, i) => expect(box.lines[i].segments).toHaveLength(line.length));
    });

    it('never puts spaces at the start or end of a wrapped line', () => {
      const box = measureLabel(parseLabel('aa bb $x$ cc dd'), FONT, fakeMeasurer(), { maxWidth: 20 });
      for (const line of lineStrings(box.label)) expect(line).toBe(line.trim());
      expect(lineStrings(box.label)).toEqual(['aa', 'bb', '$x$', 'cc', 'dd']);
    });

    it('treats maths as atomic and keeps text touching it on the same line', () => {
      const box = measureLabel(parseLabel('see ($x+y$), then'), FONT, fakeMeasurer(), { maxWidth: 10 });
      expect(lineStrings(box.label)).toEqual(['see', '($x+y$),', 'then']);
    });

    it('breaks after a hyphen between letters', () => {
      // "Multi-Head" = 60px, "Multi-" = 36px.
      const box = measureLabel(parseLabel('Multi-Head Attention'), FONT, fakeMeasurer(), { maxWidth: 40 });
      expect(lineStrings(box.label)).toEqual(['Multi-', 'Head', 'Attention']);
    });

    it('breaks after an en dash between letters too, but not at a spaced or leading dash', () => {
      const dash = measureLabel(parseLabel('encoder–decoder'), FONT, fakeMeasurer(), { maxWidth: 50 });
      expect(lineStrings(dash.label)).toEqual(['encoder–', 'decoder']);
      const spaced = measureLabel(parseLabel('x - -5'), FONT, fakeMeasurer(), { maxWidth: 1 });
      expect(lineStrings(spaced.label)).toEqual(['x', '-', '-5']);
    });

    it('lets a single overlong word overflow rather than break inside it', () => {
      const box = measureLabel(parseLabel('Transformer'), FONT, fakeMeasurer(), { maxWidth: 20 });
      expect(lineStrings(box.label)).toEqual(['Transformer']);
      expect(box.width).toBe(66);
    });

    it('wraps each explicit line on its own and keeps the explicit breaks', () => {
      const box = measureLabel(parseLabel('aa bb cc\ndd\nee ff'), FONT, fakeMeasurer(), { maxWidth: 30 });
      expect(lineStrings(box.label)).toEqual(['aa bb', 'cc', 'dd', 'ee ff']);
    });

    it('puts one word per line when maxWidth is zero or negative', () => {
      for (const maxWidth of [0, -8]) {
        const box = measureLabel(parseLabel('a b c'), FONT, fakeMeasurer(), { maxWidth });
        expect(lineStrings(box.label)).toEqual(['a', 'b', 'c']);
      }
    });

    it('ignores a non-finite maxWidth', () => {
      const label = parseLabel('aaa bbb ccc');
      for (const maxWidth of [Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(measureLabel(label, FONT, fakeMeasurer(), { maxWidth }).label).toBe(label);
      }
    });

    it('keeps a no-break space from breaking', () => {
      const box = measureLabel(parseLabel('N\u00a0× layers'), FONT, fakeMeasurer(), { maxWidth: 20 });
      expect(lineStrings(box.label)).toEqual(['N\u00a0×', 'layers']);
    });

    it('measures a wrapped line as a whole text run', () => {
      const measurer = fakeMeasurer();
      const spy = vi.spyOn(measurer, 'text');
      const box = measureLabel(parseLabel('aaa bbb ccc'), FONT, measurer, { maxWidth: 45 });
      expect(box.lines[0].segments).toEqual([42]);
      expect(spy).toHaveBeenCalledWith('aaa bbb', FONT);
    });
  });

  describe('with the heuristic measurer', () => {
    const heuristic = createHeuristicMeasurer();

    it('gives realistic Inter widths at 12px', () => {
      const box = measureLabel(parseLabel('Multi-Head Attention'), FONT, heuristic);
      expect(box.width).toBeGreaterThan(115);
      expect(box.width).toBeLessThan(126);
      expect(box.height).toBe(LINE);
    });

    it('wraps a long label at the node label width', () => {
      const label = parseLabel('Retrieval-augmented generation over a vector index of document chunks');
      expect(measureLabel(label, FONT, heuristic).width).toBeGreaterThan(2 * FIGURE_METRICS.labelMaxWidth - 20);
      const box = measureLabel(label, FONT, heuristic, { maxWidth: FIGURE_METRICS.labelMaxWidth });
      expect(lineStrings(box.label)).toEqual([
        'Retrieval-augmented generation',
        'over a vector index of document',
        'chunks',
      ]);
      expect(box.width).toBeLessThanOrEqual(FIGURE_METRICS.labelMaxWidth);
      for (const line of box.lines) expect(line.width).toBeLessThanOrEqual(FIGURE_METRICS.labelMaxWidth);
    });

    it('makes a line with a fraction taller than a text line', () => {
      const box = measureLabel(parseLabel('$\\frac{QK^\\top}{\\sqrt{d_k}}$'), FONT, heuristic);
      expect(box.height).toBeGreaterThan(LINE);
    });

    it('keeps simple maths at text line height', () => {
      const box = measureLabel(parseLabel('Linear $W^Q$'), FONT, heuristic);
      expect(box.height).toBe(LINE);
    });

    it('is deterministic', () => {
      const label = parseLabel('Linear projection $W^{DKV}$ of $\\mathbf{h}_t$');
      const a = measureLabel(label, FONT, heuristic, { maxWidth: 100 });
      const b = measureLabel(label, FONT, heuristic, { maxWidth: 100 });
      expect(b).toEqual(a);
    });
  });
});
