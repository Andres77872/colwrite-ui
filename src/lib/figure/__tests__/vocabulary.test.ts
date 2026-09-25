import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIRECTION_ALIASES,
  ROLES,
  ROLE_WORDS,
  SHAPES,
  SHAPE_ALIASES,
  SHAPE_WORDS,
  TONES,
  opGlyphFor,
  resolveDirection,
  resolveRole,
  resolveShape,
  resolveSide,
  resolveTone,
  vocabularyKey,
} from '../vocabulary';
import type { Shape, Tone } from '../types';

/**
 * The vocabulary is the spec language itself, so these tests read the tables
 * in docs/figures.md and check the code says exactly what the docs say.
 */
const DOCS = readFileSync(resolve(__dirname, '../../../../docs/figures.md'), 'utf8');

/** Rows of the Markdown table whose header row starts with `header`. */
function tableRows(header: string): string[][] {
  const lines = DOCS.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`| ${header} |`));
  if (start < 0) throw new Error(`No table "${header}" in docs/figures.md`);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(
      line
        .replace(/\\\|/g, '\uE000')
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.replace(/\uE000/g, '|').trim()),
    );
  }
  return rows;
}

const codeWords = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe('SHAPES and TONES', () => {
  it('list exactly the shapes and tones the docs name, in order', () => {
    const nodeKeys = tableRows('Key');
    const shapeRow = nodeKeys.find((row) => row[0] === '`shape`');
    const toneRow = nodeKeys.find((row) => row[0] === '`tone`');
    expect(codeWords(shapeRow![1])).toEqual([...SHAPES]);
    // The row goes on to mention `#hex` values, which are not tone names.
    expect(codeWords(toneRow![1].split('.')[0])).toEqual([...TONES]);
  });

  it('every canonical shape resolves to itself', () => {
    for (const shape of SHAPES) expect(resolveShape(shape)).toBe(shape);
  });
});

describe('resolveShape', () => {
  const aliases: Array<[string, Shape]> = [
    ['rect', 'box'], ['rectangle', 'box'], ['square', 'box'],
    ['rounded', 'round'], ['pill', 'round'], ['stadium', 'round'], ['capsule', 'round'],
    ['ellipse', 'circle'], ['oval', 'circle'],
    ['plus', 'op'], ['sum', 'op'], ['add', 'op'], ['oplus', 'op'], ['operator', 'op'],
    ['rhombus', 'diamond'], ['decision', 'diamond'],
    ['trapezoid', 'funnel'], ['trapezium', 'funnel'], ['down-projection', 'funnel'],
    ['up-projection', 'expand'],
    ['database', 'cylinder'], ['db', 'cylinder'], ['storage', 'cylinder'], ['cyl', 'cylinder'],
    ['file', 'document'], ['doc', 'document'], ['paper', 'document'],
    ['io', 'parallelogram'], ['data-io', 'parallelogram'],
    ['plain', 'text'], ['label', 'text'], ['none', 'text'],
    ['matrix', 'tensor'], ['grid', 'tensor'], ['vector', 'tensor'], ['tokens', 'tensor'], ['sequence', 'tensor'],
    ['picture', 'image'], ['img', 'image'], ['photo', 'image'], ['figure', 'image'],
  ];

  it.each(aliases)('%s → %s', (alias, shape) => {
    expect(resolveShape(alias)).toBe(shape);
  });

  it('ignores case, spaces, hyphens and underscores', () => {
    expect(resolveShape('  Rectangle ')).toBe('box');
    expect(resolveShape('Down_Projection')).toBe('funnel');
    expect(resolveShape('UP PROJECTION')).toBe('expand');
    expect(resolveShape('dataio')).toBe('parallelogram');
    expect(resolveShape('HEXAGON')).toBe('hexagon');
  });

  it('returns null for words that are not shapes', () => {
    expect(resolveShape('rectangel')).toBeNull();
    expect(resolveShape('')).toBeNull();
    expect(resolveShape('attention')).toBeNull();
  });

  it('SHAPE_WORDS holds every accepted spelling once', () => {
    const expected = SHAPES.flatMap((shape) => [shape, ...SHAPE_ALIASES[shape]]);
    expect([...SHAPE_WORDS]).toEqual(expected);
    expect(new Set(SHAPE_WORDS.map(vocabularyKey)).size).toBe(SHAPE_WORDS.length);
  });
});

describe('ROLES', () => {
  /** "bare text", "box, pink", "rounded, blue", "circle with an operator glyph" → shape and tone. */
  function drawsAs(text: string): { shape: Shape; tone: Tone; italic: boolean } {
    if (text === 'bare text') return { shape: 'text', tone: 'neutral', italic: false };
    if (text === 'bare italic text') return { shape: 'text', tone: 'neutral', italic: true };
    if (text === 'circle with an operator glyph') return { shape: 'op', tone: 'neutral', italic: false };
    const [shapeWord, tone] = text.split(',').map((part) => part.trim());
    const shape = resolveShape(shapeWord === 'rounded' ? 'round' : shapeWord);
    if (!shape) throw new Error(`Unknown shape in docs: ${shapeWord}`);
    return { shape, tone: tone as Tone, italic: false };
  }

  const rows = tableRows('Role (aliases)').map(([names, draws]) => {
    const [primary, aliases = ''] = names.split('(');
    return { primaries: codeWords(primary), aliases: codeWords(aliases), draws: drawsAs(draws) };
  });

  it('match the docs table: every name resolves to a role drawn as documented', () => {
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) {
      for (const word of [...row.primaries, ...row.aliases]) {
        const role = resolveRole(word);
        expect(role, word).not.toBeNull();
        expect({ shape: role!.shape, tone: role!.tone, italic: role!.italic ?? false }, word).toEqual(row.draws);
      }
      // A role named in the first column is a role of its own, not an alias.
      for (const word of row.primaries) expect(resolveRole(word)!.id).toBe(word);
    }
  });

  it('define nothing the docs do not name', () => {
    const documented = new Set(rows.flatMap((row) => [...row.primaries, ...row.aliases]));
    for (const role of ROLES) {
      for (const word of [role.id, ...role.aliases]) expect(documented.has(word), word).toBe(true);
    }
  });

  it('have unique ids and never share a word', () => {
    const keys = ROLE_WORDS.map(vocabularyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(ROLES.map((role) => role.id)).size).toBe(ROLES.length);
  });

  it('each carry a description', () => {
    for (const role of ROLES) expect(role.description.length).toBeGreaterThan(5);
  });

  it('resolve regardless of case and separators', () => {
    expect(resolveRole('Self Attention')?.id).toBe('attention');
    expect(resolveRole('RMSNorm')?.id).toBe('norm');
    expect(resolveRole('kv_cache')?.id).toBe('cache');
    expect(resolveRole('FEED-FORWARD')?.id).toBe('ffn');
    expect(resolveRole('feedforward')?.id).toBe('ffn');
    expect(resolveRole('note')?.italic).toBe(true);
  });

  it('return null for unknown words', () => {
    expect(resolveRole('atention')).toBeNull();
    expect(resolveRole('')).toBeNull();
    expect(resolveRole('box')).toBeNull();
  });
});

describe('opGlyphFor', () => {
  it('matches the docs table exactly', () => {
    const glyphs: Record<string, ReturnType<typeof opGlyphFor>> = {
      '⊕': 'plus',
      '⊗': 'times',
      '⊙': 'dot',
      concat: 'concat',
      '⊖': 'minus',
    };
    const rows = tableRows('Glyph');
    expect(rows).toHaveLength(5);
    for (const [glyph, labels] of rows) {
      const expected = glyphs[glyph];
      expect(expected, glyph).toBeDefined();
      for (const label of codeWords(labels)) expect(opGlyphFor(label), label).toBe(expected);
    }
  });

  it('trims and ignores case', () => {
    expect(opGlyphFor('  ADD ')).toBe('plus');
    expect(opGlyphFor('X')).toBe('times');
    expect(opGlyphFor('Hadamard')).toBe('dot');
    expect(opGlyphFor('CONCAT')).toBe('concat');
  });

  it('reads the same glyph written as maths', () => {
    expect(opGlyphFor('$\\oplus$')).toBe('plus');
    expect(opGlyphFor('$+$')).toBe('plus');
    expect(opGlyphFor('$ \\times $')).toBe('times');
    expect(opGlyphFor('$\\otimes$')).toBe('times');
    expect(opGlyphFor('$\\odot$')).toBe('dot');
    expect(opGlyphFor('$\\cdot$')).toBe('dot');
    expect(opGlyphFor('$\\Vert$')).toBe('concat');
    expect(opGlyphFor('$-$')).toBe('minus');
  });

  it('keeps LaTeX commands case-sensitive', () => {
    // `\vert` is a single bar, not concatenation.
    expect(opGlyphFor('$\\vert$')).toBeNull();
    expect(opGlyphFor('$\\OPLUS$')).toBeNull();
  });

  it('draws anything else as text', () => {
    expect(opGlyphFor('σ')).toBeNull();
    expect(opGlyphFor('')).toBeNull();
    expect(opGlyphFor('plus')).toBeNull();
    expect(opGlyphFor('add 1')).toBeNull();
    expect(opGlyphFor('$\\sigma$')).toBeNull();
  });
});

describe('resolveTone', () => {
  it('accepts every tone name and grey', () => {
    for (const tone of TONES) expect(resolveTone(tone)).toBe(tone);
    expect(resolveTone('Grey')).toBe('gray');
    expect(resolveTone('  BLUE ')).toBe('blue');
  });

  it('maps CSS colour names to the tone a reader would name them by', () => {
    const names: Array<[string, Tone]> = [
      ['lightblue', 'blue'], ['navy', 'blue'], ['skyblue', 'blue'], ['steelblue', 'blue'],
      ['salmon', 'red'], ['crimson', 'red'], ['maroon', 'red'], ['brown', 'red'],
      ['gold', 'yellow'], ['khaki', 'yellow'], ['beige', 'yellow'],
      ['coral', 'orange'], ['chocolate', 'orange'], ['darkorange', 'orange'],
      ['lime', 'green'], ['olive', 'green'], ['forestgreen', 'green'],
      ['cyan', 'teal'], ['aqua', 'teal'], ['turquoise', 'teal'],
      ['magenta', 'pink'], ['hotpink', 'pink'], ['orchid', 'pink'],
      ['violet', 'purple'], ['indigo', 'purple'], ['lavender', 'purple'],
      ['silver', 'gray'], ['black', 'gray'], ['slategray', 'gray'],
      ['white', 'neutral'], ['none', 'neutral'], ['transparent', 'neutral'],
      ['Light Blue', 'blue'], ['light_green', 'green'],
    ];
    for (const [name, tone] of names) expect(resolveTone(name), name).toBe(tone);
  });

  it('reads shades and scale steps of a known colour', () => {
    expect(resolveTone('darkteal')).toBe('teal');
    expect(resolveTone('pastel-green')).toBe('green');
    expect(resolveTone('soft purple')).toBe('purple');
    expect(resolveTone('blue-500')).toBe('blue');
    expect(resolveTone('red700')).toBe('red');
  });

  it('snaps hex values to the nearest tone by hue', () => {
    const hex: Array<[string, Tone]> = [
      // matplotlib tab10
      ['#1f77b4', 'blue'], ['#ff7f0e', 'orange'], ['#2ca02c', 'green'], ['#d62728', 'red'], ['#9467bd', 'purple'],
      ['#8c564b', 'red'], ['#e377c2', 'pink'], ['#7f7f7f', 'gray'], ['#bcbd22', 'yellow'], ['#17becf', 'teal'],
      // Okabe-Ito
      ['#E69F00', 'orange'], ['#56B4E9', 'blue'], ['#009E73', 'teal'], ['#F0E442', 'yellow'], ['#0072B2', 'blue'],
      ['#D55E00', 'orange'], ['#CC79A7', 'pink'],
    ];
    for (const [value, tone] of hex) expect(resolveTone(value), value).toBe(tone);
  });

  it('reads short and alpha hex forms', () => {
    expect(resolveTone('#f00')).toBe('red');
    expect(resolveTone('#0f08')).toBe('green');
    expect(resolveTone('#1f77b4cc')).toBe('blue');
  });

  it('sends low-chroma colours to gray, and near-white to neutral', () => {
    expect(resolveTone('#fff')).toBe('neutral');
    expect(resolveTone('#f5f5f5')).toBe('neutral');
    expect(resolveTone('#fffff0')).toBe('neutral');
    expect(resolveTone('#808080')).toBe('gray');
    expect(resolveTone('#000')).toBe('gray');
    expect(resolveTone('#6b7280')).toBe('gray');
  });

  it('reads rgb(), rgba() and hsl()', () => {
    expect(resolveTone('rgb(31, 119, 180)')).toBe('blue');
    expect(resolveTone('rgba(255,127,14,0.5)')).toBe('orange');
    expect(resolveTone('rgb(100% 0% 0%)')).toBe('red');
    expect(resolveTone('rgb(44 160 44 / 50%)')).toBe('green');
    expect(resolveTone('hsl(280, 60%, 50%)')).toBe('purple');
    expect(resolveTone('hsla(175deg, 70%, 40%, 1)')).toBe('teal');
    expect(resolveTone('hsl(0, 0%, 50%)')).toBe('gray');
  });

  it('returns null for anything that is not a colour', () => {
    for (const value of ['blurple', '#12', '#12345', '#ggg', 'rgb(1, 2)', 'rgb(a, b, c)', 'hsl(x, 1%, 1%)', '', 'dark']) {
      expect(resolveTone(value), value).toBeNull();
    }
  });
});

describe('directions and sides', () => {
  it('DIRECTION_ALIASES holds the documented spellings', () => {
    const expected: Record<string, string> = {
      down: 'down', tb: 'down', td: 'down', 'top-bottom': 'down', vertical: 'down',
      up: 'up', bt: 'up', 'bottom-top': 'up',
      right: 'right', lr: 'right', 'left-right': 'right', horizontal: 'right',
      left: 'left', rl: 'left', 'right-left': 'left',
    };
    for (const [word, direction] of Object.entries(expected)) expect(DIRECTION_ALIASES[word], word).toBe(direction);
  });

  it('resolveDirection ignores case and separators', () => {
    expect(resolveDirection('TB')).toBe('down');
    expect(resolveDirection('Left-To-Right')).toBe('right');
    expect(resolveDirection('right_left')).toBe('left');
    expect(resolveDirection(' BT ')).toBe('up');
    expect(resolveDirection('sideways')).toBeNull();
  });

  it('resolveSide reads names, compass letters and compass words', () => {
    const sides: Array<[string, string]> = [
      ['top', 'top'], ['n', 'top'], ['north', 'top'],
      ['bottom', 'bottom'], ['s', 'bottom'], ['south', 'bottom'],
      ['left', 'left'], ['w', 'left'], ['west', 'left'],
      ['right', 'right'], ['e', 'right'], ['east', 'right'],
      ['TOP', 'top'], [' East ', 'right'],
    ];
    for (const [word, side] of sides) expect(resolveSide(word), word).toBe(side);
    expect(resolveSide('middle')).toBeNull();
    expect(resolveSide('')).toBeNull();
  });
});

describe('vocabularyKey', () => {
  it('folds case, spaces, hyphens and underscores', () => {
    expect(vocabularyKey(' Kv_Cache ')).toBe('kvcache');
    expect(vocabularyKey('kv - cache')).toBe('kvcache');
    expect(vocabularyKey('fromSide')).toBe('fromside');
  });
});
