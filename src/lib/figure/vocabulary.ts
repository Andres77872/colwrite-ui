import type { Direction, OpGlyph, Shape, Side, Tone } from './types';

/**
 * The words of the figure spec — shapes, tones, roles, operator glyphs,
 * directions and sides — with the aliases people and models actually write.
 *
 * Shared by the normaliser, which resolves them, and the editor's Reference
 * panel, which lists them, so the two can never disagree about what a word
 * means. Every lookup is case-, space-, hyphen- and underscore-insensitive:
 * `Kv_Cache`, `kv cache` and `kv-cache` are the same word.
 */

/** Lower-cases and drops spaces, hyphens and underscores, so spellings of one word compare equal. */
export function vocabularyKey(word: string): string {
  return word.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function indexWords<T>(entries: ReadonlyArray<readonly [T, readonly string[]]>): Map<string, T> {
  const index = new Map<string, T>();
  for (const [value, words] of entries) {
    for (const word of words) {
      const key = vocabularyKey(word);
      // The first definition of a word wins, so a table reads top-down.
      if (!index.has(key)) index.set(key, value);
    }
  }
  return index;
}

/* ────────────────────────────────────────────────────────────────────────
 * Shapes
 * ──────────────────────────────────────────────────────────────────────── */

export const SHAPES: readonly Shape[] = [
  'box',
  'round',
  'circle',
  'op',
  'diamond',
  'funnel',
  'expand',
  'cylinder',
  'document',
  'parallelogram',
  'hexagon',
  'text',
  'tensor',
  'image',
];

/** Other names for each shape, as the Reference panel lists them. */
export const SHAPE_ALIASES: Readonly<Record<Shape, readonly string[]>> = {
  box: ['rect', 'rectangle', 'square'],
  round: ['rounded', 'pill', 'stadium', 'capsule'],
  circle: ['ellipse', 'oval'],
  op: ['plus', 'sum', 'add', 'oplus', 'operator'],
  diamond: ['rhombus', 'decision'],
  funnel: ['trapezoid', 'trapezium', 'down-projection'],
  expand: ['up-projection'],
  cylinder: ['database', 'db', 'storage', 'cyl'],
  document: ['file', 'doc', 'paper'],
  parallelogram: ['io', 'data-io'],
  hexagon: [],
  text: ['plain', 'label', 'none'],
  tensor: ['matrix', 'grid', 'vector', 'tokens', 'sequence'],
  image: ['picture', 'img', 'photo', 'figure'],
};

const SHAPE_INDEX = indexWords(SHAPES.map((shape) => [shape, [shape, ...SHAPE_ALIASES[shape]]] as const));

/** A shape from its name or alias; null when the word is not a shape. */
export function resolveShape(name: string): Shape | null {
  return SHAPE_INDEX.get(vocabularyKey(name)) ?? null;
}

/** Every word `resolveShape` accepts, for did-you-mean suggestions. */
export const SHAPE_WORDS: readonly string[] = SHAPES.flatMap((shape) => [shape, ...SHAPE_ALIASES[shape]]);

/* ────────────────────────────────────────────────────────────────────────
 * Tones
 * ──────────────────────────────────────────────────────────────────────── */

export const TONES: readonly Tone[] = [
  'neutral',
  'gray',
  'blue',
  'orange',
  'yellow',
  'green',
  'red',
  'purple',
  'pink',
  'teal',
];

/**
 * Colour words mapped to the tone a reader would call them. Curated rather
 * than computed from each name's hex value, because a name carries intent the
 * hue misses: `lavender` is meant as purple although its hue is blue, and
 * `aliceblue` as blue although it is nearly white.
 */
const COLOUR_WORDS: ReadonlyArray<readonly [Tone, readonly string[]]> = [
  ['neutral', ['neutral', 'white', 'none', 'default', 'transparent', 'plain', 'background', 'snow', 'ivory',
    'ghostwhite', 'floralwhite', 'whitesmoke', 'linen', 'seashell', 'oldlace']],
  ['gray', ['gray', 'grey', 'silver', 'lightgray', 'lightgrey', 'darkgray', 'darkgrey', 'dimgray', 'dimgrey',
    'gainsboro', 'slategray', 'slategrey', 'lightslategray', 'darkslategray', 'black', 'charcoal', 'graphite']],
  ['blue', ['blue', 'lightblue', 'skyblue', 'lightskyblue', 'deepskyblue', 'dodgerblue', 'cornflowerblue',
    'royalblue', 'steelblue', 'lightsteelblue', 'powderblue', 'navy', 'navyblue', 'darkblue', 'mediumblue',
    'midnightblue', 'aliceblue', 'azure', 'cobalt', 'sapphire']],
  ['teal', ['teal', 'cyan', 'aqua', 'turquoise', 'darkturquoise', 'mediumturquoise', 'paleturquoise',
    'lightcyan', 'darkcyan', 'cadetblue', 'aquamarine', 'mediumaquamarine', 'lightseagreen']],
  ['green', ['green', 'lightgreen', 'palegreen', 'darkgreen', 'forestgreen', 'seagreen', 'mediumseagreen',
    'darkseagreen', 'limegreen', 'lime', 'lawngreen', 'chartreuse', 'olive', 'olivedrab', 'darkolivegreen',
    'yellowgreen', 'greenyellow', 'springgreen', 'mediumspringgreen', 'honeydew', 'mint', 'mintcream', 'sage',
    'emerald']],
  ['yellow', ['yellow', 'lightyellow', 'gold', 'goldenrod', 'darkgoldenrod', 'palegoldenrod',
    'lightgoldenrodyellow', 'khaki', 'darkkhaki', 'lemonchiffon', 'cornsilk', 'beige', 'wheat', 'moccasin',
    'cream', 'amber', 'mustard', 'lemon']],
  ['orange', ['orange', 'darkorange', 'coral', 'sandybrown', 'peru', 'chocolate', 'tan', 'burlywood',
    'peachpuff', 'bisque', 'navajowhite', 'papayawhip', 'blanchedalmond', 'lightsalmon', 'sienna',
    'saddlebrown', 'peach', 'apricot', 'tangerine', 'vermilion', 'vermillion']],
  ['red', ['red', 'darkred', 'crimson', 'firebrick', 'maroon', 'brown', 'indianred', 'tomato', 'orangered',
    'salmon', 'darksalmon', 'lightcoral', 'scarlet', 'burgundy', 'rosybrown']],
  ['pink', ['pink', 'lightpink', 'hotpink', 'deeppink', 'palevioletred', 'mediumvioletred', 'magenta',
    'fuchsia', 'rose', 'mistyrose', 'lavenderblush', 'orchid', 'salmonpink', 'blush']],
  ['purple', ['purple', 'rebeccapurple', 'indigo', 'violet', 'darkviolet', 'darkorchid', 'mediumorchid',
    'mediumpurple', 'blueviolet', 'slateblue', 'darkslateblue', 'mediumslateblue', 'lavender', 'plum',
    'thistle', 'darkmagenta', 'lilac', 'mauve', 'amethyst']],
];

const COLOUR_INDEX = indexWords(COLOUR_WORDS);

/** Qualifiers that shade a colour without changing which tone it is. */
const SHADE_PREFIX = /^(light|dark|pale|deep|bright|soft|medium|pastel|muted|dusty|vivid)/;

function toneFromWord(word: string): Tone | null {
  const key = vocabularyKey(word);
  const direct = COLOUR_INDEX.get(key);
  if (direct) return direct;
  // `darkteal`, `pastel-green`, `blue-500`: a shade or a scale step of a known colour.
  const bare = key.replace(SHADE_PREFIX, '').replace(/\d+$/, '');
  if (bare && bare !== key) return COLOUR_INDEX.get(bare) ?? null;
  return null;
}

/** RGB channels 0..255 from `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` or `hsl()`/`hsla()`. */
function parseColour(value: string): [number, number, number] | null {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    if (digits.length <= 4) {
      return [0, 1, 2].map((i) => parseInt(digits[i] + digits[i], 16)) as [number, number, number];
    }
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
  }
  const fn = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(text);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  if (fn[1].startsWith('rgb')) {
    const channels = parts.slice(0, 3).map((part) =>
      part.endsWith('%') ? (parseFloat(part) / 100) * 255 : parseFloat(part),
    );
    if (channels.some((c) => !Number.isFinite(c))) return null;
    return channels.map((c) => Math.max(0, Math.min(255, c))) as [number, number, number];
  }
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  if (![h, s, l].every(Number.isFinite)) return null;
  // HSL → RGB (CSS Color 4).
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    return 255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

/**
 * The tone nearest a colour value, by hue — with low-chroma colours going to
 * gray, or to neutral when nearly white. Chroma rather than HSL saturation
 * decides "is this a colour at all", because saturation is unstable at the
 * extremes: `#fffff0` is 100% saturated and still reads as white.
 */
function toneFromRgb([r, g, b]: [number, number, number]): Tone {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const chroma = max - min;
  const lightness = (max + min) / 2;
  if (lightness >= 0.96) return 'neutral';
  if (chroma < 0.12) return lightness > 0.9 ? 'neutral' : 'gray';
  let hue: number;
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  if (max === rr) hue = 60 * (((gg - bb) / chroma) % 6);
  else if (max === gg) hue = 60 * ((bb - rr) / chroma + 2);
  else hue = 60 * ((rr - gg) / chroma + 4);
  hue = (hue + 360) % 360;
  // Boundaries put the common chart colours (matplotlib's tab10, Okabe-Ito)
  // on the tone a reader would name them by.
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 42) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 160) return 'green';
  if (hue < 190) return 'teal';
  if (hue < 255) return 'blue';
  if (hue < 290) return 'purple';
  return 'pink';
}

/**
 * A tone from a tone name, a colour word (`lightblue`, `navy`, `salmon`,
 * `gold`, `darkteal`) or a colour value (`#1f77b4`, `rgb(…)`, `hsl(…)`).
 * Figures draw from a fixed, print-safe palette, so any colour is snapped to
 * the nearest tone instead of being drawn as written.
 */
export function resolveTone(value: string): Tone | null {
  const word = toneFromWord(value);
  if (word) return word;
  const rgb = parseColour(value);
  return rgb ? toneFromRgb(rgb) : null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Roles
 * ──────────────────────────────────────────────────────────────────────── */

export type RoleDef = {
  id: string;
  aliases: readonly string[];
  shape: Shape;
  tone: Tone;
  italic?: boolean;
  description: string;
};

/**
 * What a node *is*, and how that draws. The table in `docs/figures.md`, one
 * entry per role name: a row that names several roles (`input`, `output`,
 * `io`) gives each its own entry, so a node keeps the role it was given.
 */
export const ROLES: readonly RoleDef[] = [
  { id: 'input', aliases: [], shape: 'text', tone: 'neutral', description: 'An input to the figure, drawn as bare text.' },
  { id: 'output', aliases: [], shape: 'text', tone: 'neutral', description: 'An output of the figure, drawn as bare text.' },
  { id: 'io', aliases: [], shape: 'text', tone: 'neutral', description: 'An input or output, drawn as bare text.' },
  { id: 'embedding', aliases: [], shape: 'box', tone: 'pink', description: 'Token, patch or positional embeddings.' },
  {
    id: 'attention',
    aliases: ['attn', 'self-attention', 'cross-attention'],
    shape: 'box',
    tone: 'orange',
    description: 'An attention layer.',
  },
  { id: 'ffn', aliases: ['mlp', 'feed-forward'], shape: 'box', tone: 'blue', description: 'A feed-forward block.' },
  {
    id: 'norm',
    aliases: ['layernorm', 'rmsnorm', 'batchnorm'],
    shape: 'box',
    tone: 'yellow',
    description: 'A normalisation layer.',
  },
  {
    id: 'linear',
    aliases: ['projection', 'proj', 'dense', 'fc'],
    shape: 'box',
    tone: 'purple',
    description: 'A linear map or projection.',
  },
  {
    id: 'activation',
    aliases: ['softmax', 'relu', 'gelu', 'sigmoid'],
    shape: 'box',
    tone: 'green',
    description: 'A nonlinearity or softmax.',
  },
  { id: 'conv', aliases: [], shape: 'box', tone: 'blue', description: 'A convolution.' },
  { id: 'pool', aliases: [], shape: 'box', tone: 'teal', description: 'A pooling layer.' },
  {
    id: 'op',
    aliases: ['operator'],
    shape: 'op',
    tone: 'neutral',
    description: 'An operator circle: ⊕ add, ⊗ multiply, ⊙ Hadamard, ‖ concat, ⊖ subtract.',
  },
  { id: 'latent', aliases: ['hidden', 'state'], shape: 'box', tone: 'teal', description: 'A latent or hidden state.' },
  { id: 'cache', aliases: ['kv-cache', 'memory'], shape: 'cylinder', tone: 'gray', description: 'A cache or memory.' },
  {
    id: 'data',
    aliases: ['dataset', 'database', 'storage'],
    shape: 'cylinder',
    tone: 'gray',
    description: 'A dataset or data store.',
  },
  { id: 'model', aliases: ['llm', 'network'], shape: 'round', tone: 'blue', description: 'A whole model or network.' },
  { id: 'agent', aliases: [], shape: 'round', tone: 'purple', description: 'An agent.' },
  { id: 'tool', aliases: [], shape: 'box', tone: 'orange', description: 'A tool an agent calls.' },
  {
    id: 'retriever',
    aliases: ['retrieval', 'search'],
    shape: 'box',
    tone: 'teal',
    description: 'A retriever or search step.',
  },
  { id: 'document', aliases: ['prompt', 'doc'], shape: 'document', tone: 'gray', description: 'A document or prompt.' },
  { id: 'loss', aliases: ['objective', 'reward'], shape: 'box', tone: 'red', description: 'A loss, objective or reward.' },
  { id: 'router', aliases: ['gate', 'gating'], shape: 'box', tone: 'green', description: 'A router or gate.' },
  { id: 'expert', aliases: [], shape: 'box', tone: 'blue', description: 'A mixture-of-experts expert.' },
  { id: 'decision', aliases: ['condition'], shape: 'diamond', tone: 'yellow', description: 'A decision or condition.' },
  { id: 'process', aliases: ['step'], shape: 'box', tone: 'neutral', description: 'A generic process step.' },
  { id: 'start', aliases: ['terminal'], shape: 'round', tone: 'gray', description: 'Where a process starts.' },
  { id: 'end', aliases: [], shape: 'round', tone: 'gray', description: 'Where a process ends.' },
  {
    id: 'param',
    aliases: ['parameter', 'weight'],
    shape: 'box',
    tone: 'gray',
    description: 'A parameter or weight matrix.',
  },
  {
    id: 'note',
    aliases: ['annotation', 'comment'],
    shape: 'text',
    tone: 'neutral',
    italic: true,
    description: 'An annotation, drawn as bare italic text.',
  },
];

const ROLE_INDEX = indexWords(ROLES.map((role) => [role, [role.id, ...role.aliases]] as const));

/** A role from its name or alias; null when the word is not a role. */
export function resolveRole(name: string): RoleDef | null {
  return ROLE_INDEX.get(vocabularyKey(name)) ?? null;
}

/** Every word `resolveRole` accepts, for did-you-mean suggestions. */
export const ROLE_WORDS: readonly string[] = ROLES.flatMap((role) => [role.id, ...role.aliases]);

/* ────────────────────────────────────────────────────────────────────────
 * Operator glyphs
 * ──────────────────────────────────────────────────────────────────────── */

const OP_WORDS: ReadonlyArray<readonly [Exclude<OpGlyph, null>, readonly string[]]> = [
  ['plus', ['+', '⊕', 'add', 'sum', '\\oplus']],
  ['times', ['×', 'x', '*', '⊗', 'mul', '\\times', '\\otimes']],
  ['dot', ['·', '⊙', 'dot', 'hadamard', '\\odot', '\\cdot']],
  ['concat', ['‖', '||', 'concat', 'cat', '\\|', '\\Vert', '\\parallel']],
  ['minus', ['-', '−', '⊖', 'minus', '\\ominus']],
];

// LaTeX commands are case-sensitive (`\Vert` is ‖, `\vert` is |); words are not.
const opKey = (text: string) => (text.startsWith('\\') ? text : text.toLowerCase());

const OP_INDEX = new Map<string, Exclude<OpGlyph, null>>(
  OP_WORDS.flatMap(([glyph, words]) => words.map((word) => [opKey(word), glyph] as const)),
);

/**
 * The vector glyph an `op` circle draws for its label, or null to draw the
 * label as text. A label written as maths (`$\oplus$`, `$+$`) names the same
 * glyph as its plain form.
 */
export function opGlyphFor(label: string): OpGlyph {
  let text = label.trim();
  const maths = /^\$(.*)\$$/s.exec(text);
  if (maths) text = maths[1].trim();
  return OP_INDEX.get(opKey(text)) ?? null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Directions and sides
 * ──────────────────────────────────────────────────────────────────────── */

export const DIRECTION_ALIASES: Record<string, Direction> = {
  down: 'down',
  tb: 'down',
  td: 'down',
  'top-bottom': 'down',
  'top-to-bottom': 'down',
  vertical: 'down',
  up: 'up',
  bt: 'up',
  'bottom-top': 'up',
  'bottom-to-top': 'up',
  right: 'right',
  lr: 'right',
  'left-right': 'right',
  'left-to-right': 'right',
  horizontal: 'right',
  left: 'left',
  rl: 'left',
  'right-left': 'left',
  'right-to-left': 'left',
};

const DIRECTION_INDEX = new Map(Object.entries(DIRECTION_ALIASES).map(([word, dir]) => [vocabularyKey(word), dir]));

/** A flow direction from its name or alias (`TB`, `left-to-right`, `vertical`); null when unknown. */
export function resolveDirection(name: string): Direction | null {
  return DIRECTION_INDEX.get(vocabularyKey(name)) ?? null;
}

const SIDE_INDEX = new Map<string, Side>([
  ['top', 'top'],
  ['n', 'top'],
  ['north', 'top'],
  ['bottom', 'bottom'],
  ['s', 'bottom'],
  ['south', 'bottom'],
  ['left', 'left'],
  ['w', 'left'],
  ['west', 'left'],
  ['right', 'right'],
  ['e', 'right'],
  ['east', 'right'],
]);

/** A node side from `top`/`bottom`/`left`/`right`, a compass letter or a compass word; null when unknown. */
export function resolveSide(name: string): Side | null {
  return SIDE_INDEX.get(vocabularyKey(name)) ?? null;
}
