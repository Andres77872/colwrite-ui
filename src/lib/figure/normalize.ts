import { FIGURE_METRICS, MAX_FIGURE_EDGES, MAX_FIGURE_ITEMS, MAX_LABEL_CHARS, MAX_TENSOR_CELLS } from './constants';
import { labelText, parseLabel } from './labels';
import { lineColumn } from './parse';
import { ROOT_ID } from './types';
import type {
  Align,
  ArrowEnds,
  Border,
  ContainerLayout,
  DiagnosticSeverity,
  Direction,
  EdgeKind,
  EdgeModel,
  FigureDiagnostic,
  FigureModel,
  FigureSize,
  GroupModel,
  ItemModel,
  JsonMember,
  JsonNode,
  JsonObjectNode,
  JsonStringNode,
  Label,
  LegendItemModel,
  LineStyle,
  LineWeight,
  NodeModel,
  ParseResult,
  Pattern,
  RouteStyle,
  Shape,
  Side,
  TensorCells,
  Tone,
} from './types';
import {
  ROLE_WORDS,
  SHAPE_WORDS,
  TONES,
  opGlyphFor,
  resolveDirection,
  resolveRole,
  resolveShape,
  resolveSide,
  resolveTone,
  vocabularyKey,
  type RoleDef,
} from './vocabulary';

/**
 * Spec → model: reads the parsed JSON of a figure into a `FigureModel`,
 * resolving every alias, shorthand and default, and explaining everything it
 * had to ignore or repair.
 *
 * The reader is deliberately forgiving — specs are written by people and by
 * language models, and a figure that draws with a warning beats one that
 * does not draw — but never silent: each forgiveness that changes meaning is
 * a diagnostic with the JSON path and source range of the offending text, so
 * the editor can select it and a repair round can fix it.
 */

/* ────────────────────────────────────────────────────────────────────────
 * Diagnostics
 * ──────────────────────────────────────────────────────────────────────── */

type Where = { path: string; range?: [number, number] };

type Scope = 'spec' | 'item' | 'edge' | 'legend' | 'tensor' | 'image';

type Context = {
  diagnostics: FigureDiagnostic[];
  source: string | undefined;
  /** Reported problems, so one mistake read twice (the middle of a chain) is listed once. */
  seen: Set<string>;
  /** `sourceOffsets` per string node, computed once: a long chain asks for many ranges in one string. */
  offsets: WeakMap<JsonNode, number[] | null>;
};

/** A problems list longer than this is noise; the first ones are what an author fixes. */
const MAX_DIAGNOSTICS = 200;

function report(ctx: Context, severity: DiagnosticSeverity, code: string, message: string, where?: Where): void {
  const key = `${code}\u0000${message}\u0000${where?.path ?? ''}\u0000${where?.range?.join(':') ?? ''}`;
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  const diagnostic: FigureDiagnostic = { severity, code, message };
  if (where?.path) diagnostic.path = where.path;
  if (where?.range) {
    diagnostic.range = where.range;
    if (ctx.source !== undefined) {
      const { line, column } = lineColumn(ctx.source, where.range[0]);
      diagnostic.line = line;
      diagnostic.column = column;
    }
  }
  ctx.diagnostics.push(diagnostic);
}

const warn = (ctx: Context, code: string, message: string, where?: Where) =>
  report(ctx, 'warning', code, message, where);
const note = (ctx: Context, code: string, message: string, where?: Where) =>
  report(ctx, 'info', code, message, where);

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };

function orderDiagnostics(diagnostics: FigureDiagnostic[]): FigureDiagnostic[] {
  const sorted = diagnostics
    .map((diagnostic, index) => ({ diagnostic, index }))
    .sort((a, b) => SEVERITY_RANK[a.diagnostic.severity] - SEVERITY_RANK[b.diagnostic.severity] || a.index - b.index)
    .map(({ diagnostic }) => diagnostic);
  if (sorted.length <= MAX_DIAGNOSTICS) return sorted;
  const kept = sorted.slice(0, MAX_DIAGNOSTICS - 1);
  kept.push({
    severity: 'info',
    code: 'spec.more-problems',
    message: `${sorted.length - kept.length} more problems are not listed; fix the ones above first.`,
  });
  return kept;
}

const nodeRange = (node: JsonNode): [number, number] => [node.start, node.end];

/* ────────────────────────────────────────────────────────────────────────
 * Words: suggestions and quoting
 * ──────────────────────────────────────────────────────────────────────── */

/** Edit distance, or `cap + 1` as soon as it must exceed `cap`. */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > cap) return cap + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * The candidate nearest `word`, within `maxEdits` edits (compared through
 * `key`); the earliest candidate wins a tie, so suggestions are stable.
 */
function nearest(
  word: string,
  candidates: Iterable<string>,
  maxEdits: number,
  key: (text: string) => string = vocabularyKey,
): string | null {
  const target = key(word);
  if (!target) return null;
  let best: string | null = null;
  let bestDistance = maxEdits + 1;
  for (const candidate of candidates) {
    const distance = editDistance(target, key(candidate), maxEdits);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

const quote = (text: string) => JSON.stringify(text);

function orList(words: readonly string[]): string {
  const quoted = words.map(quote);
  return quoted.length <= 1 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`;
}

const didYouMean = (suggestion: string | null) => (suggestion ? ` Did you mean ${quote(suggestion)}?` : '');

/** Word tables for enumerated values: accepted spellings → the canonical value. */
function wordTable<T extends string>(table: Record<T, readonly string[]>): {
  resolve: (word: string) => T | null;
  values: readonly T[];
  words: readonly string[];
} {
  const index = new Map<string, T>();
  const values = Object.keys(table) as T[];
  for (const value of values) {
    for (const word of [value, ...table[value]]) {
      const key = vocabularyKey(word);
      if (!index.has(key)) index.set(key, value);
    }
  }
  return {
    resolve: (word) => index.get(vocabularyKey(word)) ?? null,
    values,
    words: values.flatMap((value) => [value, ...table[value]]),
  };
}

const LAYOUTS = wordTable<ContainerLayout>({
  flow: ['layered', 'auto', 'dag', 'graph'],
  row: ['horizontal', 'hbox', 'inline'],
  column: ['vertical', 'vbox', 'stack', 'col'],
  grid: ['table', 'matrix'],
});
const ALIGNS = wordTable<Align>({
  start: ['left', 'top', 'begin'],
  center: ['centre', 'middle', 'mid'],
  end: ['right', 'bottom'],
});
const SIZES = wordTable<FigureSize>({
  auto: ['column', 'default', 'natural', 'single'],
  small: ['half', 'narrow'],
  medium: [],
  large: [],
  full: ['wide', 'page', 'double', 'double-column', 'two-column', 'full-width'],
});
const FONTS = wordTable<'sans' | 'serif'>({
  sans: ['sans-serif', 'helvetica', 'arial', 'inter'],
  serif: ['times', 'times-new-roman', 'roman', 'cm', 'computer-modern', 'source-serif'],
});
const PALETTES = wordTable<'color' | 'mono'>({
  color: ['colour', 'colored', 'coloured'],
  mono: ['grayscale', 'greyscale', 'bw', 'black-and-white', 'monochrome', 'gray', 'grey'],
});
const BORDERS = wordTable<Border>({
  solid: ['normal', 'default', 'plain', 'line'],
  dashed: ['dash', 'dashes'],
  dotted: ['dot', 'dots'],
  bold: ['thick', 'heavy', 'strong'],
  none: ['no', 'hidden', 'borderless', 'invisible'],
});
const PATTERNS = wordTable<Pattern>({
  none: ['no', 'plain', 'solid'],
  hatch: ['hatched', 'hatching', 'stripes', 'striped', 'lines', 'cached', 'frozen'],
  dots: ['dotted', 'dot', 'stipple', 'stippled'],
});
const LINES = wordTable<LineStyle>({
  solid: ['normal', 'plain', 'default', 'continuous'],
  dashed: ['dash', 'dashes'],
  dotted: ['dot', 'dots'],
});
const WEIGHTS = wordTable<LineWeight>({
  thin: ['light', 'hairline', 'fine'],
  normal: ['regular', 'medium', 'default'],
  thick: ['bold', 'heavy', 'strong', 'wide'],
});
const ARROWS = wordTable<ArrowEnds>({
  end: ['forward', 'target', 'head', '->', 'yes'],
  start: ['backward', 'reverse', 'reversed', 'source', 'tail', '<-'],
  both: ['double', 'bidirectional', 'two-way', '<->'],
  none: ['no', 'off', 'undirected', '--'],
});
const ROUTES = wordTable<RouteStyle>({
  ortho: ['orthogonal', 'manhattan', 'elbow', 'step', 'right-angle'],
  straight: ['line', 'direct', 'linear'],
  curved: ['curve', 'spline', 'bezier', 'smooth'],
});
const EDGE_KINDS = wordTable<EdgeKind>({
  flow: ['normal', 'default', 'data'],
  residual: ['identity'],
  skip: ['shortcut', 'skip-connection'],
  feedback: ['back', 'backward', 'loop', 'recurrent', 'recurrence', 'cycle'],
});
const MASKS = wordTable<TensorCells['pattern']>({
  none: ['no', 'off', 'empty'],
  full: ['all', 'dense', 'ones'],
  lower: ['causal', 'tril', 'lower-triangular', 'triangular'],
  upper: ['triu', 'upper-triangular', 'anti-causal'],
  diagonal: ['diag', 'identity', 'eye'],
});
const LABEL_POSITIONS = wordTable<'top' | 'bottom'>({ top: ['above'], bottom: ['below'] });
const BEFORE_WORDS = wordTable<'before' | 'after'>({
  before: ['left', 'above', 'top', 'start'],
  after: ['right', 'below', 'bottom', 'end'],
});
const RANK_WORDS = wordTable<'first' | 'last'>({ first: ['min', 'source', 'top'], last: ['max', 'sink', 'bottom'] });
const GROUP_TYPES = new Set(['group', 'cluster', 'subgraph', 'container'].map(vocabularyKey));

/* ────────────────────────────────────────────────────────────────────────
 * Reading objects
 * ──────────────────────────────────────────────────────────────────────── */

/** An object's members by normalised key (`fromSide` = `from_side`), tracking which were read. */
type Fields = {
  node: JsonObjectNode;
  path: string;
  byKey: Map<string, JsonMember>;
  used: Set<JsonMember>;
};

/** `nodes[2].children[1].shape`; keys that are not identifiers are bracketed: `nodes["kv-cache"]`. */
function joinPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  if (!/^[A-Za-z_$][\w$]*$/.test(key)) return `${base}[${quote(key)}]`;
  return base ? `${base}.${key}` : key;
}

function fieldsOf(ctx: Context, node: JsonObjectNode, path: string): Fields {
  const byKey = new Map<string, JsonMember>();
  const used = new Set<JsonMember>();
  for (const member of node.members) {
    const key = vocabularyKey(member.key);
    const earlier = byKey.get(key);
    // Exact duplicates are the parser's to report; spellings of one key are ours.
    if (earlier && earlier.key !== member.key) {
      warn(
        ctx,
        'spec.duplicate-key',
        `${quote(earlier.key)} and ${quote(member.key)} set the same key; the last one is used.`,
        { path: joinPath(path, member.key), range: [member.keyStart, member.keyEnd] },
      );
    }
    if (earlier) used.add(earlier);
    byKey.set(key, member);
  }
  return { node, path, byKey, used };
}

const memberWhere = (f: Fields, member: JsonMember): Where => ({
  path: joinPath(f.path, member.key),
  range: nodeRange(member.value),
});

/** Looks a key up without marking it read. */
function peek(f: Fields | null, names: readonly string[]): JsonMember | null {
  if (!f) return null;
  for (const name of names) {
    const member = f.byKey.get(vocabularyKey(name));
    if (member) return member;
  }
  return null;
}

/**
 * The member that sets a property, by its aliases in priority order. Other
 * aliases present at the same time lose, with a warning naming the winner.
 */
function take(ctx: Context, f: Fields | null, names: readonly string[], scope: Scope): JsonMember | null {
  if (!f) return null;
  let winner: JsonMember | null = null;
  for (const name of names) {
    const member = f.byKey.get(vocabularyKey(name));
    if (!member || f.used.has(member)) continue;
    f.used.add(member);
    if (!winner) {
      winner = member;
      continue;
    }
    warn(
      ctx,
      `${scope}.duplicate-alias`,
      `${quote(member.key)} is ignored because ${quote(winner.key)} already sets the same thing.`,
      { path: joinPath(f.path, member.key), range: [member.keyStart, member.keyEnd] },
    );
  }
  return winner;
}

/** Keys commonly written for another key, beyond typos. */
const KEY_SYNONYMS: Record<Scope, Record<string, string>> = {
  spec: {
    links: 'edges', connections: 'edges', arrows: 'edges', relations: 'edges', items: 'nodes',
    elements: 'nodes', blocks: 'nodes', components: 'nodes', vertices: 'nodes', children: 'nodes',
    description: 'alt', desc: 'alt', name: 'title', heading: 'title', theme: 'palette', colors: 'palette',
    colours: 'palette', fontfamily: 'font', typeface: 'font', orientation: 'direction', rankdir: 'direction',
    dir: 'direction', flow: 'direction', width: 'size', scale: 'size', clusters: 'groups', subgraphs: 'groups',
    key: 'legend',
  },
  item: {
    fillcolor: 'tone', background: 'tone', bg: 'tone', bgcolor: 'tone', shapetype: 'shape', subtext: 'sublabel',
    caption: 'sublabel', description: 'sublabel', parentid: 'parent', in: 'parent', within: 'parent',
    container: 'parent', next: 'to', targets: 'to', outputs: 'to', layer: 'rank', level: 'rank', heads: 'stack',
    count: 'stack', image: 'src', orientation: 'direction', dir: 'direction', rankdir: 'direction',
  },
  edge: {
    caption: 'label', linestyle: 'line', stroke: 'line', dash: 'line', thickness: 'weight', width: 'weight',
    strokewidth: 'weight', head: 'arrow', arrowhead: 'arrow', heads: 'arrow', curve: 'route', path: 'route',
    routing: 'route', color: 'tone', sourceport: 'fromSide', targetport: 'toSide',
  },
  legend: { text: 'label', caption: 'label', linestyle: 'line', color: 'tone', swatch: 'tone' },
  tensor: {},
  image: {},
};

const SCOPE_NOUN: Record<Scope, string> = {
  spec: 'top-level key',
  item: 'key',
  edge: 'edge key',
  legend: 'legend key',
  tensor: 'key',
  image: 'key',
};

/**
 * Reports every member nobody read. Keys that start with `_` or `$`
 * (`_comment`, `$schema`) are metadata by JSON convention and pass quietly.
 */
function reportUnknown(
  ctx: Context,
  f: Fields,
  scope: Scope,
  known: readonly string[],
  owner: string,
  misplaced?: { keys: ReadonlySet<string>; reason: string },
): void {
  for (const member of f.node.members) {
    if (f.used.has(member) || /^[_$]/.test(member.key)) continue;
    f.used.add(member);
    const key = vocabularyKey(member.key);
    const where: Where = { path: joinPath(f.path, member.key), range: [member.keyStart, member.keyEnd] };
    if (misplaced?.keys.has(key)) {
      warn(ctx, `${scope}.misplaced-key`, `${quote(member.key)} ${misplaced.reason}; it is ignored.`, where);
      continue;
    }
    // Own keys only: `constructor` would otherwise find Object.prototype's.
    const synonyms = KEY_SYNONYMS[scope];
    const synonym = Object.hasOwn(synonyms, key) ? synonyms[key] : undefined;
    const suggestion = synonym ?? nearest(member.key, known, 2);
    warn(
      ctx,
      `${scope}.unknown-key`,
      `Unknown ${SCOPE_NOUN[scope]} ${quote(member.key)}${owner}.${didYouMean(suggestion)} It is ignored.`,
      where,
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading values
 * ──────────────────────────────────────────────────────────────────────── */

function describe(node: JsonNode): string {
  switch (node.kind) {
    case 'object':
      return 'an object';
    case 'array':
      return 'a list';
    case 'string':
      return `text ${quote(node.value.length > 40 ? `${node.value.slice(0, 40)}…` : node.value)}`;
    case 'number':
      return `the number ${node.value}`;
    case 'boolean':
      return String(node.value);
    case 'null':
      return 'null';
  }
}

function invalid(ctx: Context, scope: Scope, f: Fields, member: JsonMember, expected: string): void {
  warn(
    ctx,
    `${scope}.invalid-value`,
    `${quote(member.key)} expects ${expected}, not ${describe(member.value)}; it is ignored.`,
    memberWhere(f, member),
  );
}

/** Text from a string or a number; `null` reads as absent. */
function readText(ctx: Context, scope: Scope, f: Fields, member: JsonMember | null): string | undefined {
  if (!member || member.value.kind === 'null') return undefined;
  if (member.value.kind === 'string') return member.value.value;
  if (member.value.kind === 'number') return String(member.value.value);
  invalid(ctx, scope, f, member, 'text');
  return undefined;
}

/** A boolean, also from `"true"`/`"false"`/`"yes"`/`"no"`. */
function readBool(ctx: Context, scope: Scope, f: Fields, member: JsonMember | null): boolean | undefined {
  if (!member || member.value.kind === 'null') return undefined;
  if (member.value.kind === 'boolean') return member.value.value;
  if (member.value.kind === 'string') {
    const word = vocabularyKey(member.value.value);
    if (word === 'true' || word === 'yes') return true;
    if (word === 'false' || word === 'no') return false;
  }
  invalid(ctx, scope, f, member, 'true or false');
  return undefined;
}

/** A finite number, also from `"120"` or `"120px"`. */
function readNumber(ctx: Context, scope: Scope, f: Fields, member: JsonMember | null): number | undefined {
  if (!member || member.value.kind === 'null') return undefined;
  if (member.value.kind === 'number' && Number.isFinite(member.value.value)) return member.value.value;
  if (member.value.kind === 'string') {
    const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(px)?\s*$/i.exec(member.value.value);
    if (match) return Number(match[1]);
  }
  invalid(ctx, scope, f, member, 'a number');
  return undefined;
}

/** An enumerated word, with a did-you-mean when it is misspelled. */
function readWord<T extends string>(
  ctx: Context,
  scope: Scope,
  f: Fields,
  member: JsonMember | null,
  table: { resolve: (word: string) => T | null; values: readonly T[]; words: readonly string[] },
): T | undefined {
  if (!member || member.value.kind === 'null') return undefined;
  if (member.value.kind !== 'string') {
    invalid(ctx, scope, f, member, orList(table.values));
    return undefined;
  }
  const resolved = table.resolve(member.value.value);
  if (resolved) return resolved;
  const suggestion = nearest(member.value.value, table.words, 2);
  warn(
    ctx,
    `${scope}.invalid-value`,
    `${quote(member.key)} must be ${orList(table.values)}; ${quote(member.value.value)} is ignored.${didYouMean(suggestion)}`,
    memberWhere(f, member),
  );
  return undefined;
}

function readDirection(ctx: Context, scope: Scope, f: Fields, member: JsonMember | null): Direction | undefined {
  if (!member || member.value.kind === 'null') return undefined;
  if (member.value.kind === 'string') {
    const direction = resolveDirection(member.value.value);
    if (direction) return direction;
  }
  warn(
    ctx,
    `${scope}.invalid-value`,
    `"direction" must be "down", "up", "right" or "left" (or TB, BT, LR, RL); ${describe(member.value)} is ignored.`,
    memberWhere(f, member),
  );
  return undefined;
}

function readTone(ctx: Context, scope: Scope, f: Fields, member: JsonMember | null): Tone | undefined {
  if (!member || member.value.kind === 'null') return undefined;
  if (member.value.kind === 'string') {
    if (!member.value.value.trim()) return undefined;
    const tone = resolveTone(member.value.value);
    if (tone) return tone;
    const suggestion = nearest(member.value.value, TONES, 2);
    warn(
      ctx,
      `${scope}.unknown-tone`,
      `Unknown tone ${quote(member.value.value)}; use ${orList(TONES)}, a CSS colour name or a #hex value.` +
        didYouMean(suggestion),
      memberWhere(f, member),
    );
    return undefined;
  }
  invalid(ctx, scope, f, member, 'a tone name or colour');
  return undefined;
}

/** An integer clamped into [lo, hi], with a warning when it had to move. */
function clampInteger(
  ctx: Context,
  scope: Scope,
  f: Fields,
  member: JsonMember,
  value: number,
  lo: number,
  hi: number,
): number {
  const rounded = Math.round(value);
  const clamped = Math.max(lo, Math.min(hi, rounded));
  if (clamped !== rounded) {
    warn(ctx, `${scope}.clamped`, `${quote(member.key)} must be between ${lo} and ${hi}; ${value} is read as ${clamped}.`, memberWhere(f, member));
  }
  return clamped;
}

/* ────────────────────────────────────────────────────────────────────────
 * Labels
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Caps a label at MAX_LABEL_CHARS. A cut inside `$…$` would leave an
 * unmatched dollar that draws as text, so the cut moves back before the
 * formula it would split.
 */
function clampLabelText(ctx: Context, text: string, where: Where): string {
  if (text.length <= MAX_LABEL_CHARS) return text;
  let cut = text.slice(0, MAX_LABEL_CHARS);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const dollars = [...cut.matchAll(/(?<!\\)\$/g)].map((match) => match.index);
  if (dollars.length % 2 === 1) cut = cut.slice(0, dollars[dollars.length - 1]);
  warn(
    ctx,
    'label.too-long',
    `The label is ${text.length} characters; only the first ${MAX_LABEL_CHARS} are drawn. Move detail into the caption.`,
    where,
  );
  return `${cut.trimEnd()}…`;
}

/** The label a member sets, or undefined when it is absent or unreadable. */
function readLabelSource(ctx: Context, scope: Scope, f: Fields, member: JsonMember | null): string | undefined {
  const text = readText(ctx, scope, f, member);
  if (text === undefined || !member) return undefined;
  return clampLabelText(ctx, text, memberWhere(f, member));
}

function labelOrNull(source: string | null | undefined): Label | null {
  return source !== null && source !== undefined && source.trim() ? parseLabel(source) : null;
}

const GREEK = new Set(
  'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega'.split(
    ' ',
  ),
);

/** The letters of a formula: `\mathbf{c}_t^{KV}` → `ctKV`, `\alpha` → `alpha`. */
function mathLetters(latex: string): string {
  return latex
    .replace(/\\([A-Za-z]+)/g, (_, name: string) => (GREEK.has(name.toLowerCase()) ? name : ' '))
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const MAX_SLUG = 40;

/** A readable id from a label: `Multi-Head\nAttention` → `multi-head-attention`. */
function slugOf(label: Label | null): string {
  if (!label) return '';
  const words = label.lines.flatMap((line) =>
    line.map((segment) => (segment.kind === 'text' ? segment.value : mathLetters(segment.value))),
  );
  const slug = words
    .join(' ')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= MAX_SLUG) return slug;
  const cut = slug.slice(0, MAX_SLUG);
  const dash = cut.lastIndexOf('-');
  return dash > MAX_SLUG / 2 ? cut.slice(0, dash) : cut;
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  used.add(id);
  return id;
}

/** Whitespace-insensitive label text, for matching an edge endpoint to a label. */
const matchText = (label: Label) => labelText(label).replace(/\s+/g, ' ').trim();

/* ────────────────────────────────────────────────────────────────────────
 * Shorthand edges
 * ──────────────────────────────────────────────────────────────────────── */

export type ShorthandEdge = {
  from: string[];
  to: string[];
  fromSide: Side | null;
  toSide: Side | null;
  line: LineStyle;
  weight: LineWeight;
  arrow: ArrowEnds;
  label: string | null;
};

type Arrow = { start: number; end: number; left: boolean; right: boolean; line: LineStyle; weight: LineWeight };

type ShorthandEndpoint = {
  /** The name without a side suffix. */
  name: string;
  /** The name as written, suffix included (tried first: an id may contain a dot). */
  raw: string;
  side: Side | null;
  /** Offsets of `raw` in the shorthand text. */
  start: number;
  end: number;
};

type ShorthandHop = {
  from: ShorthandEndpoint[];
  to: ShorthandEndpoint[];
  line: LineStyle;
  weight: LineWeight;
  arrow: ArrowEnds;
  label: string | null;
  labelStart: number;
};

const UNICODE_ARROWS = new Map<string, Omit<Arrow, 'start' | 'end' | 'line'>>([
  ['→', { left: false, right: true, weight: 'normal' }],
  ['⟶', { left: false, right: true, weight: 'normal' }],
  ['➔', { left: false, right: true, weight: 'normal' }],
  ['➜', { left: false, right: true, weight: 'normal' }],
  ['⇒', { left: false, right: true, weight: 'thick' }],
  ['⟹', { left: false, right: true, weight: 'thick' }],
  ['←', { left: true, right: false, weight: 'normal' }],
  ['⟵', { left: true, right: false, weight: 'normal' }],
  ['⇐', { left: true, right: false, weight: 'thick' }],
  ['↔', { left: true, right: true, weight: 'normal' }],
  ['⟷', { left: true, right: true, weight: 'normal' }],
  ['⇔', { left: true, right: true, weight: 'thick' }],
]);

/**
 * The arrow token starting at `i`, if any: an optional `<`, a run of `-`,
 * `=` or `.`, and an optional `>`. A lone `-` or `.` without a head is part
 * of a name (`feed-forward`, `x.top`), never an arrow. Dots make it dotted,
 * `=` thick, and two or more dashes with a head dashed (`-->`), while `--`
 * and `---` without heads are plain lines.
 */
function arrowAt(text: string, i: number): Arrow | null {
  const unicode = UNICODE_ARROWS.get(text[i]);
  if (unicode) return { start: i, end: i + 1, line: 'solid', ...unicode };
  let j = i;
  const left = text[j] === '<';
  if (left) j += 1;
  let k = j;
  while (k < text.length && (text[k] === '-' || text[k] === '=' || text[k] === '.')) k += 1;
  const body = text.slice(j, k);
  if (!body) return null;
  const right = text[k] === '>';
  if (right) k += 1;
  if (!left && !right && body.length < 2) return null;
  const dotted = body.includes('.');
  const thick = !dotted && body.includes('=');
  const line: LineStyle = dotted ? 'dotted' : !thick && (left || right) && body.length >= 2 ? 'dashed' : 'solid';
  return { start: i, end: k, left, right, line, weight: thick ? 'thick' : 'normal' };
}

function firstArrow(text: string): Arrow | null {
  for (let i = 0; i < text.length; i += 1) {
    const arrow = arrowAt(text, i);
    if (arrow) return arrow;
  }
  return null;
}

const SIDE_SUFFIX = /^(.*\S)\s*\.\s*([A-Za-z]+)$/s;

function endpointsOf(text: string, offset: number): ShorthandEndpoint[] {
  const endpoints: ShorthandEndpoint[] = [];
  let cursor = 0;
  for (const part of text.split(',')) {
    const lead = part.length - part.trimStart().length;
    const raw = part.trim();
    if (raw) {
      const start = offset + cursor + lead;
      const suffix = SIDE_SUFFIX.exec(raw);
      const side = suffix ? resolveSide(suffix[2]) : null;
      endpoints.push({ name: side && suffix ? suffix[1].trim() : raw, raw, side, start, end: start + raw.length });
    }
    cursor += part.length + 1;
  }
  return endpoints;
}

/** Whether an endpoint names an item as written, or once a side suffix is taken off. */
function endpointIsName(text: string, isName: (name: string) => boolean): boolean {
  const raw = text.trim();
  if (!raw) return false;
  if (isName(raw)) return true;
  const suffix = SIDE_SUFFIX.exec(raw);
  return !!suffix && resolveSide(suffix[2]) !== null && isName(suffix[1].trim());
}

function arrowText(text: string, arrow: Arrow): string {
  return text.slice(arrow.start, arrow.end);
}

/**
 * Reads `a, b -> c --> d: label` into hops with offsets, for precise
 * diagnostics. `isName` says whether a name is a declared item, so a bare
 * colon inside one (`enc:out`) is not read as the start of a label.
 */
function scanShorthand(text: string, isName?: (name: string) => boolean): ShorthandHop[] | { error: string } {
  const first = firstArrow(text);
  if (!first) {
    return { error: `${quote(text.trim())} has no arrow; write an edge as "a -> b".` };
  }
  // The label follows the first ": " after an arrow, so it may itself contain arrows.
  let body = text;
  let label: string | null = null;
  let labelStart = -1;
  const colon = text.indexOf(': ', first.end);
  if (colon >= 0) {
    body = text.slice(0, colon);
    label = text.slice(colon + 2);
    labelStart = colon + 2;
  }
  const arrows: Arrow[] = [];
  const segments: Array<{ text: string; start: number }> = [];
  let segmentStart = 0;
  for (let i = 0; i < body.length; ) {
    const arrow = arrowAt(body, i);
    if (!arrow) {
      i += 1;
      continue;
    }
    segments.push({ text: body.slice(segmentStart, i), start: segmentStart });
    arrows.push(arrow);
    i = arrow.end;
    segmentStart = i;
  }
  segments.push({ text: body.slice(segmentStart), start: segmentStart });
  if (label === null) {
    // `a -> b:label`: a colon in the last endpoint starts the label — unless
    // the endpoint as written is an id, as with a dot before a side suffix.
    const last = segments[segments.length - 1];
    const at = last.text.indexOf(':');
    if (at >= 0 && !(isName && endpointIsName(last.text.slice(last.text.lastIndexOf(',') + 1), isName))) {
      label = last.text.slice(at + 1);
      labelStart = last.start + at + 1;
      segments[segments.length - 1] = { text: last.text.slice(0, at), start: last.start };
    }
  }
  const groups = segments.map((segment) => endpointsOf(segment.text, segment.start));
  for (let k = 0; k < arrows.length; k += 1) {
    if (groups[k].length === 0) {
      return { error: `Missing a node before ${quote(arrowText(body, arrows[k]))} in ${quote(text.trim())}.` };
    }
    if (groups[k + 1].length === 0) {
      return { error: `Missing a node after ${quote(arrowText(body, arrows[k]))} in ${quote(text.trim())}.` };
    }
  }
  const trimmedLabel = label?.trim() ? label.trim() : null;
  const labelOffset = trimmedLabel && label ? labelStart + (label.length - label.trimStart().length) : -1;
  return arrows.map((arrow, k) => {
    const reversed = arrow.left && !arrow.right;
    const isLast = k === arrows.length - 1;
    return {
      from: reversed ? groups[k + 1] : groups[k],
      to: reversed ? groups[k] : groups[k + 1],
      line: arrow.line,
      weight: arrow.weight,
      arrow: arrow.left && arrow.right ? 'both' : arrow.left || arrow.right ? 'end' : 'none',
      label: isLast ? trimmedLabel : null,
      labelStart: isLast ? labelOffset : -1,
    };
  });
}

function bySide(endpoints: ShorthandEndpoint[]): Array<{ side: Side | null; names: string[] }> {
  const out: Array<{ side: Side | null; names: string[] }> = [];
  for (const endpoint of endpoints) {
    const bucket = out.find((entry) => entry.side === endpoint.side);
    if (bucket) bucket.names.push(endpoint.name);
    else out.push({ side: endpoint.side, names: [endpoint.name] });
  }
  return out;
}

/**
 * Reads an edge string: `a -> b`, a fan-in `a, b -> c`, a chain
 * `a -> b -> c`, pinned sides `a.right -> b.left`, and a label after the
 * first `: ` (or a trailing `:label`). Arrow tokens pick the style: `-->`
 * dashed, `..>` / `-.->` dotted, `=>` thick, `<->` both ends, `--` / `..`
 * no arrow, and `<-` / `<--` point backwards (the ends are swapped, so the
 * edge still runs source → target). Endpoints with different pinned sides in
 * one list come back as separate edges, since a side belongs to one edge.
 */
export function parseEdgeShorthand(text: string): ShorthandEdge[] | { error: string } {
  const hops = scanShorthand(text);
  if (!Array.isArray(hops)) return hops;
  const edges: ShorthandEdge[] = [];
  for (const hop of hops) {
    for (const from of bySide(hop.from)) {
      for (const to of bySide(hop.to)) {
        edges.push({
          from: from.names,
          to: to.names,
          fromSide: from.side,
          toSide: to.side,
          line: hop.line,
          weight: hop.weight,
          arrow: hop.arrow,
          label: hop.label,
        });
      }
    }
  }
  return edges;
}

/* ────────────────────────────────────────────────────────────────────────
 * Items: collection, identity and containment
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * One place an item is written: an object, a bare string, or a `nodes` map
 * member. Several entries can name one item — a declaration plus string
 * references in `children` arrays — and ownership decides which defines it.
 */
type Entry = {
  seq: number;
  node: JsonNode;
  path: string;
  /** The group entry whose `children` holds this entry; null at the top level. */
  container: Entry | null;
  /** The top-level array this entry sits in directly. */
  top: 'nodes' | 'groups' | null;
  fields: Fields | null;
  /** The id as written — the `id` member, a map key or the bare string — else null. */
  id: string | null;
  labelSource: string | null;
  /** Says more than its id, so it defines the item rather than naming it. */
  rich: boolean;
  groupHint: boolean;
  /** A `"children": null` or `[]` read as "no children": the item is a node unless something names it as a parent. */
  leafChildren: JsonMember | null;
  status: 'owner' | 'renamed' | 'derived' | 'reference' | 'redundant' | 'dropped';
  draft: Draft | null;
};

type Draft = {
  id: string;
  order: number;
  entry: Entry;
  group: boolean;
  label: Label | null;
  /** Null = the root. */
  parent: Draft | null;
  /** The `children` entry that placed the item in its parent. */
  claim: Entry | null;
  /** Moved by its own `parent` key: sorts after the listed children. */
  adopted: boolean;
  model: ItemModel | null;
  explicitDirection: Direction | null;
  /** `panel: true` (text null) or the panel string, lettered once every group is known. */
  panelSpec: { text: string | null } | null;
  /** Edges declared on the item (`to`, `edges`), read once every item exists. */
  toMember: JsonMember | null;
  edgesMember: JsonMember | null;
};

/** Takes the edge-declaring keys, which are read after every item exists. */
function takeEdgeKeys(ctx: Context, f: Fields, draft: Draft): void {
  draft.toMember = take(ctx, f, ['to'], 'item');
  draft.edgesMember = take(ctx, f, ['edges'], 'item');
}

type Slot = { node: JsonNode; path: string; mapKey: string | null };

/**
 * Whether an object in place of the `nodes` list is a map keyed by id
 * (`{"q": {…}, "k": "K"}`) rather than one node written without its list
 * (`{"id": "q", "label": "Q"}`): a map's values are all nodes, and its keys
 * are not node keys.
 */
function isItemMap(node: JsonObjectNode): boolean {
  if (node.members.length === 0) return false;
  if (node.members.every((m) => m.value.kind === 'object')) return true;
  return (
    node.members.every((m) => m.value.kind === 'object' || m.value.kind === 'string' || m.value.kind === 'number') &&
    !node.members.some((m) => ITEM_KEY_SET.has(vocabularyKey(m.key)))
  );
}

function slotsOf(ctx: Context, member: JsonMember, f: Fields, scope: Scope, allowMap: boolean): Slot[] {
  const path = joinPath(f.path, member.key);
  const value = member.value;
  if (value.kind === 'array') return value.items.map((node, i) => ({ node, path: joinPath(path, i), mapKey: null }));
  if (value.kind === 'object' && value.members.length === 0) return [];
  if (allowMap && value.kind === 'object' && isItemMap(value)) {
    // `"nodes": {"q": {…}, "k": "K"}` — keyed by id.
    return value.members.map((m) => ({ node: m.value, path: joinPath(path, m.key), mapKey: m.key }));
  }
  if (value.kind === 'string' || value.kind === 'object' || value.kind === 'number') {
    note(ctx, `${scope}.not-a-list`, `${quote(member.key)} should be a list; reading it as a list of one.`, memberWhere(f, member));
    return [{ node: value, path, mapKey: null }];
  }
  if (value.kind !== 'null') invalid(ctx, scope, f, member, 'a list');
  return [];
}

const LABEL_KEYS = ['label', 'text', 'name', 'title'] as const;
const CHILDREN_KEYS = ['children', 'nodes'] as const;

/**
 * Whether a `children` member leaves the item a node: `null` (which reads as
 * absent) or an empty list beside node keys, on an item with no group keys.
 */
function isLeafChildren(node: JsonObjectNode, children: JsonMember): boolean {
  const value = children.value;
  const empty =
    value.kind === 'null' ||
    (value.kind === 'array' && value.items.length === 0) ||
    (value.kind === 'object' && value.members.length === 0);
  if (!empty) return false;
  const keys = node.members.map((m) => vocabularyKey(m.key));
  if (keys.some((key) => GROUP_ONLY_SET.has(key))) return false;
  return value.kind === 'null' || keys.some((key) => NODE_EVIDENCE_SET.has(key));
}

function collectEntries(
  ctx: Context,
  slots: Slot[],
  container: Entry | null,
  top: Entry['top'],
  entries: Entry[],
): void {
  for (const slot of slots) {
    const { node, path, mapKey } = slot;
    const where: Where = { path, range: nodeRange(node) };
    const base = { seq: 0, node, path, container, top, status: 'owner' as const, draft: null, leafChildren: null };
    if (node.kind === 'string' || node.kind === 'number') {
      const text = node.kind === 'string' ? node.value : String(node.value);
      if (!text.trim()) {
        warn(ctx, 'item.invalid', 'An empty string is not a node; it is ignored.', where);
        continue;
      }
      const labelSource = clampLabelText(ctx, mapKey === null ? text.trim() : text, where);
      const id = mapKey ?? text.trim();
      entries.push({
        ...base,
        seq: entries.length,
        fields: null,
        id,
        labelSource,
        rich: labelSource.trim() !== id,
        groupHint: false,
      });
      continue;
    }
    if (node.kind !== 'object') {
      warn(
        ctx,
        'item.invalid',
        `A node is an object or a string, not ${describe(node)}; it is ignored.`,
        where,
      );
      continue;
    }
    const f = fieldsOf(ctx, node, path);
    const idMember = take(ctx, f, ['id'], 'item');
    let id: string | null = mapKey;
    if (idMember) {
      const text = readText(ctx, 'item', f, idMember);
      if (text !== undefined && text.trim()) id = text.trim();
      else if (text !== undefined) warn(ctx, 'item.invalid-value', '"id" is empty; an id is derived from the label.', memberWhere(f, idMember));
    }
    const labelSource = readLabelSource(ctx, 'item', f, take(ctx, f, LABEL_KEYS, 'item')) ?? null;
    let children = take(ctx, f, CHILDREN_KEYS, 'item');
    const typeMember = peek(f, ['type', 'kind']);
    const groupMember = peek(f, ['group']);
    const declaredGroup =
      top === 'groups' ||
      (typeMember?.value.kind === 'string' && GROUP_TYPES.has(vocabularyKey(typeMember.value.value))) ||
      (groupMember?.value.kind === 'boolean' && groupMember.value.value);
    // Uniform model output writes `"children": null` or `[]` on every leaf; that is not an empty group.
    const leafChildren = children && !declaredGroup && isLeafChildren(node, children) ? children : null;
    if (leafChildren) children = null;
    const entry: Entry = {
      ...base,
      seq: entries.length,
      fields: f,
      id,
      labelSource,
      rich: node.members.some((m) => vocabularyKey(m.key) !== 'id'),
      groupHint: !!children || !!declaredGroup,
      leafChildren,
    };
    entries.push(entry);
    if (children) collectEntries(ctx, slotsOf(ctx, children, f, 'item', false), entry, null, entries);
  }
}

/** Where an entry's id is written: its `id` value, else the whole entry. */
function idWhere(entry: Entry): Where {
  const idMember = peek(entry.fields, ['id']);
  return { path: entry.path, range: idMember ? nodeRange(idMember.value) : nodeRange(entry.node) };
}

/** Entry precedence for owning an id: a rich definition, then a top-level mention, then a child reference. */
const ownership = (entry: Entry) => (entry.rich ? 2 : entry.container ? 0 : 1);

/** Whether `group` is `item` or sits inside it (moving `item` into `group` would make a cycle). */
function containsOrIs(item: Draft, group: Draft | null): boolean {
  for (let g = group; g; g = g.parent) if (g === item) return true;
  return false;
}

const nameOf = (draft: Draft | null) => (draft ? quote(draft.id) : 'the top level');

/* ────────────────────────────────────────────────────────────────────────
 * Endpoint resolution (edges, parent, beside, sameRank)
 * ──────────────────────────────────────────────────────────────────────── */

type Resolution =
  | { kind: 'ok'; draft: Draft }
  | { kind: 'root' }
  | { kind: 'dropped' }
  | { kind: 'ambiguous'; ids: string[]; by: 'id' | 'label' }
  | { kind: 'unknown'; suggestion: string | null };

type Resolver = (name: string) => Resolution;

function makeResolver(drafts: Draft[], dropped: ReadonlySet<string>): Resolver {
  const byId = new Map<string, Draft>();
  const byLowerId = new Map<string, Draft[]>();
  const byLabel = new Map<string, Draft[]>();
  const byLowerLabel = new Map<string, Draft[]>();
  const push = (map: Map<string, Draft[]>, key: string, draft: Draft) => {
    const list = map.get(key);
    if (list) list.push(draft);
    else map.set(key, [draft]);
  };
  for (const draft of drafts) {
    byId.set(draft.id, draft);
    push(byLowerId, draft.id.toLowerCase(), draft);
    if (draft.label) {
      const text = matchText(draft.label);
      if (text) {
        push(byLabel, text, draft);
        push(byLowerLabel, text.toLowerCase(), draft);
      }
    }
  }
  const ids = drafts.map((draft) => draft.id);
  return (raw) => {
    const name = raw.trim();
    if (name === ROOT_ID) return { kind: 'root' };
    const exact = byId.get(name);
    if (exact) return { kind: 'ok', draft: exact };
    if (dropped.has(name)) return { kind: 'dropped' };
    const lower = name.toLowerCase();
    const caseless = byLowerId.get(lower) ?? [];
    if (caseless.length === 1) return { kind: 'ok', draft: caseless[0] };
    if (caseless.length > 1) return { kind: 'ambiguous', ids: caseless.map((d) => d.id), by: 'id' };
    const text = name.replace(/\s+/g, ' ');
    for (const list of [byLabel.get(text) ?? [], byLowerLabel.get(text.toLowerCase()) ?? []]) {
      if (list.length === 1) return { kind: 'ok', draft: list[0] };
      if (list.length > 1) return { kind: 'ambiguous', ids: list.map((d) => d.id), by: 'label' };
    }
    return { kind: 'unknown', suggestion: suggestId(name, ids) };
  };
}

/** The id an unknown name most likely meant: a near spelling, or one that extends or truncates it. */
function suggestId(name: string, ids: readonly string[]): string | null {
  const lower = name.toLowerCase();
  // Short names are close to everything; scale the tolerance with the length.
  const maxEdits = lower.length <= 3 ? 1 : lower.length <= 5 ? 2 : 3;
  const close = nearest(lower, ids, maxEdits, (text) => text.toLowerCase());
  if (close) return close;
  let best: string | null = null;
  for (const id of ids) {
    const candidate = id.toLowerCase();
    if (lower.length < 2 || candidate.length < 2) continue;
    if (!candidate.startsWith(lower) && !lower.startsWith(candidate)) continue;
    if (!best || Math.abs(id.length - name.length) < Math.abs(best.length - name.length)) best = id;
  }
  return best;
}

function unresolvedMessage(name: string, resolution: Resolution): string {
  if (resolution.kind === 'ambiguous') {
    return resolution.by === 'label'
      ? `${quote(name)} is the label of several nodes (${resolution.ids.map(quote).join(', ')}); use an id.`
      : `${quote(name)} matches several ids that differ only in case (${resolution.ids.map(quote).join(', ')}).`;
  }
  if (resolution.kind === 'unknown') return `No node or group ${quote(name)}.${didYouMean(resolution.suggestion)}`;
  if (resolution.kind === 'root') return `${quote(name)} is the figure itself, not a node.`;
  return '';
}

/* ────────────────────────────────────────────────────────────────────────
 * Item properties
 * ──────────────────────────────────────────────────────────────────────── */

const COMMON_KEYS = [
  'id', 'label', 'text', 'name', 'title', 'type', 'kind', 'group', 'role', 'tone', 'color', 'colour', 'fill',
  'border', 'style', 'dashed', 'dotted', 'repeat', 'rank', 'beside', 'side', 'sameRank', 'sameRankAs',
  'alignWith', 'to', 'parent', 'children', 'nodes', 'edges',
] as const;
const NODE_ONLY_KEYS = [
  'sublabel', 'subtitle', 'dims', 'detail', 'shape', 'pattern', 'hatch', 'hatched', 'cached', 'bold', 'italic',
  'stack', 'copies', 'stacked', 'badge', 'cells', 'values', 'mask', 'src', 'url', 'href', 'width', 'height',
] as const;
const GROUP_ONLY_KEYS = [
  'layout', 'direction', 'columns', 'cols', 'align', 'gap', 'filled', 'panel', 'uniform', 'labelPosition',
] as const;
const NODE_KEYS = [...COMMON_KEYS, ...NODE_ONLY_KEYS];
const GROUP_KEYS = [...COMMON_KEYS, ...GROUP_ONLY_KEYS];
const NODE_ONLY_SET: ReadonlySet<string> = new Set(NODE_ONLY_KEYS.map(vocabularyKey));
const GROUP_ONLY_SET: ReadonlySet<string> = new Set(GROUP_ONLY_KEYS.map(vocabularyKey));
const ITEM_KEY_SET: ReadonlySet<string> = new Set([...NODE_KEYS, ...GROUP_ONLY_KEYS].map(vocabularyKey));
/** Keys that say an item draws as a node: a label, a role, a tone, or any node-only key. */
const NODE_EVIDENCE_SET: ReadonlySet<string> = new Set(
  [...LABEL_KEYS, 'role', 'tone', 'color', 'colour', ...NODE_ONLY_KEYS].map(vocabularyKey),
);

type Placement = Pick<NodeModel, 'rank' | 'beside' | 'sameRank'>;

type Style = { tone: Tone | undefined; role: RoleDef | null; typeShape: Shape | null };

/** `role`, `type`/`kind` and the tone keys, shared by nodes and groups. */
function readStyle(ctx: Context, f: Fields | null, draft: Draft): Style {
  const style: Style = { tone: undefined, role: null, typeShape: null };
  if (!f) return style;
  const roleMember = take(ctx, f, ['role'], 'item');
  const roleText = readText(ctx, 'item', f, roleMember);
  if (roleMember && roleText !== undefined) {
    style.role = resolveRole(roleText);
    if (!style.role) {
      warn(
        ctx,
        'item.unknown-role',
        `Unknown role ${quote(roleText)}.${didYouMean(nearest(roleText, ROLE_WORDS, 2))} It is ignored.`,
        memberWhere(f, roleMember),
      );
    }
  }
  const typeMember = take(ctx, f, ['type', 'kind'], 'item');
  const typeText = readText(ctx, 'item', f, typeMember);
  if (typeMember && typeText !== undefined) {
    const key = vocabularyKey(typeText);
    if (GROUP_TYPES.has(key)) {
      // Already made the item a group.
    } else if (key === 'node' || key === 'item') {
      // The default.
    } else if (draft.group) {
      const role = resolveRole(typeText);
      if (role && !style.role) style.role = role;
      else warn(ctx, 'item.misplaced-key', `${quote(typeMember.key)}: ${quote(typeText)} does not apply to a group; it is ignored.`, memberWhere(f, typeMember));
    } else {
      style.typeShape = resolveShape(typeText);
      if (!style.typeShape) {
        const role = resolveRole(typeText);
        if (role && !style.role) style.role = role;
        else if (!role) {
          const suggestion = nearest(typeText, [...SHAPE_WORDS, ...ROLE_WORDS], 2);
          warn(
            ctx,
            'item.unknown-type',
            `${quote(typeMember.key)}: ${quote(typeText)} is neither a shape nor a role; it is ignored.${didYouMean(suggestion)}`,
            memberWhere(f, typeMember),
          );
        }
      }
    }
  }
  const toneMember = take(ctx, f, ['tone', 'color', 'colour'], 'item');
  style.tone = readTone(ctx, 'item', f, toneMember);
  const fill = peek(f, ['fill']);
  if (fill && fill.value.kind === 'string') {
    f.used.add(fill);
    if (toneMember) {
      warn(ctx, 'item.duplicate-alias', `"fill" is ignored because ${quote(toneMember.key)} already sets the tone.`, memberWhere(f, fill));
    } else {
      style.tone = readTone(ctx, 'item', f, fill);
    }
  }
  return style;
}

/** `border`, `style` (when it is a border word) and the `dashed`/`dotted` flags. */
function readBorder(ctx: Context, f: Fields | null): Border | undefined {
  if (!f) return undefined;
  const member = take(ctx, f, ['border'], 'item');
  let border: Border | undefined;
  if (member?.value.kind === 'boolean') border = member.value.value ? 'solid' : 'none';
  else if (member?.value.kind === 'number') border = member.value.value <= 0 ? 'none' : member.value.value >= 1.5 ? 'bold' : 'solid';
  else border = readWord(ctx, 'item', f, member, BORDERS);
  const styleMember = take(ctx, f, ['style'], 'item');
  if (styleMember) {
    const word = styleMember.value.kind === 'string' ? BORDERS.resolve(styleMember.value.value) : null;
    if (!word) invalid(ctx, 'item', f, styleMember, `a border style (${orList(BORDERS.values)})`);
    else if (border === undefined) border = word;
  }
  for (const flag of ['dashed', 'dotted'] as const) {
    const flagMember = take(ctx, f, [flag], 'item');
    if (readBool(ctx, 'item', f, flagMember) && border === undefined) border = flag;
  }
  return border;
}

function readPlacement(ctx: Context, f: Fields | null, draft: Draft, resolve: Resolver): Placement {
  const placement: Placement = { rank: null, beside: null, sameRank: null };
  if (!f) return placement;
  const rankMember = take(ctx, f, ['rank'], 'item');
  if (rankMember && rankMember.value.kind !== 'null') {
    const word = rankMember.value.kind === 'string' ? RANK_WORDS.resolve(rankMember.value.value) : null;
    if (word) placement.rank = word;
    else {
      const value = readNumber(ctx, 'item', f, rankMember);
      if (value !== undefined) placement.rank = clampInteger(ctx, 'item', f, rankMember, value, 0, MAX_FIGURE_ITEMS);
    }
  }
  const sibling = (member: JsonMember | null, key: string): string | null => {
    const text = readText(ctx, 'item', f, member);
    if (!member || text === undefined || !text.trim()) return null;
    const resolution = resolve(text);
    if (resolution.kind === 'dropped') return null;
    if (resolution.kind !== 'ok') {
      warn(ctx, 'item.unknown-sibling', `${quote(key)}: ${unresolvedMessage(text.trim(), resolution)} It is ignored.`, memberWhere(f, member));
      return null;
    }
    const target = resolution.draft;
    if (target === draft) {
      warn(ctx, 'item.unknown-sibling', `${quote(key)} names the item itself; it is ignored.`, memberWhere(f, member));
      return null;
    }
    if (target.parent !== draft.parent) {
      warn(
        ctx,
        'item.unknown-sibling',
        `${quote(key)}: ${quote(target.id)} is in ${nameOf(target.parent)}, not beside ${quote(draft.id)} in ${nameOf(draft.parent)}; it is ignored.`,
        memberWhere(f, member),
      );
      return null;
    }
    return target.id;
  };
  const besideMember = take(ctx, f, ['beside'], 'item');
  const besideId = sibling(besideMember, 'beside');
  const sideMember = take(ctx, f, ['side'], 'item');
  const side = readWord(ctx, 'item', f, sideMember, BEFORE_WORDS);
  if (besideId) placement.beside = { id: besideId, before: side === 'before' };
  else if (sideMember && !besideMember) {
    warn(ctx, 'item.misplaced-key', '"side" only applies together with "beside"; it is ignored.', memberWhere(f, sideMember));
  }
  placement.sameRank = sibling(take(ctx, f, ['sameRank', 'sameRankAs', 'alignWith'], 'item'), 'sameRank');
  return placement;
}

/** `repeat` marker: text, or a count `n` drawn as `n×`. */
function readRepeat(ctx: Context, f: Fields | null): string | null {
  if (!f) return null;
  const member = take(ctx, f, ['repeat'], 'item');
  if (!member || member.value.kind === 'null') return null;
  if (member.value.kind === 'number') return `${member.value.value}×`;
  const text = readText(ctx, 'item', f, member);
  return text?.trim() ? clampLabelText(ctx, text.trim(), memberWhere(f, member)) : null;
}

function readFixedSize(ctx: Context, f: Fields, key: 'width' | 'height'): number | null {
  const member = take(ctx, f, [key], 'item');
  const value = readNumber(ctx, 'item', f, member);
  if (value === undefined || !member) return null;
  const { minFixed, maxFixed } = FIGURE_METRICS.node;
  const clamped = Math.max(minFixed, Math.min(maxFixed, value));
  if (clamped !== value) {
    warn(ctx, 'item.clamped', `${quote(member.key)} must be between ${minFixed} and ${maxFixed} px; ${value} is read as ${clamped}.`, memberWhere(f, member));
  }
  return clamped;
}

/**
 * Base64 raster/SVG data URLs, which draw, and `http(s):` URLs without
 * credentials, which are kept (an export can name them) but never fetched;
 * anything else — scripts, other schemes, relative paths — is refused.
 */
function safeImageSrc(value: string): string | null {
  const text = value.trim();
  const data = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,([\s\S]*)$/i.exec(text);
  if (data) {
    const payload = data[2].replace(/\s+/g, '');
    if (!payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;
    return `data:image/${data[1].toLowerCase()};base64,${payload}`;
  }
  try {
    const url = new URL(text);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/* ─── Tensors ─── */

type Grid<T> = T[][];

function cellText(node: JsonNode): string | null | undefined {
  if (node.kind === 'string') return node.value;
  if (node.kind === 'number') return String(node.value);
  if (node.kind === 'null') return null;
  return undefined;
}

function cellValue(node: JsonNode): number | undefined {
  if (node.kind === 'number' && Number.isFinite(node.value)) return node.value;
  if (node.kind === 'boolean') return node.value ? 1 : 0;
  return undefined;
}

/** A dimension spec: `8`, `[r, c]`, `"8x8"`, `{rows, cols}`. Null when the value is not one. */
function dimsOf(node: JsonNode): [number, number] | null {
  if (node.kind === 'number') return [1, node.value];
  if (node.kind === 'string') {
    const pair = /^\s*(\d+)\s*(?:[x×*,]|by)\s*(\d+)\s*$/i.exec(node.value);
    if (pair) return [Number(pair[1]), Number(pair[2])];
    const single = /^\s*(\d+)\s*$/.exec(node.value);
    return single ? [1, Number(single[1])] : null;
  }
  if (node.kind === 'array' && node.items.length === 2) {
    const [a, b] = node.items;
    if (a.kind === 'number' && b.kind === 'number') return [a.value, b.value];
    return null;
  }
  if (node.kind === 'object') {
    const get = (...keys: string[]): number | undefined => {
      for (const member of node.members) {
        if (keys.includes(vocabularyKey(member.key)) && member.value.kind === 'number') return member.value.value;
      }
      return undefined;
    };
    const rows = get('rows', 'r', 'height');
    const cols = get('cols', 'columns', 'c', 'width');
    if (rows !== undefined || cols !== undefined) return [rows ?? 1, cols ?? 1];
  }
  return null;
}

type Numbers = { flat: number[]; grid: null } | { flat: null; grid: Grid<number> };

/** Per-cell numbers: a flat list (one row, or row-major) or a list of rows. */
function readNumbers(ctx: Context, f: Fields, member: JsonMember): Numbers | null {
  const node = member.value;
  if (node.kind !== 'array') {
    invalid(ctx, 'tensor', f, member, 'a list of numbers, or a list of rows');
    return null;
  }
  const state = { bad: false };
  const read = (item: JsonNode): number => {
    const value = cellValue(item);
    if (value === undefined) state.bad = true;
    return value ?? 0;
  };
  const numbers: Numbers = node.items.every((item) => item.kind !== 'array')
    ? { flat: node.items.map(read), grid: null }
    : {
        flat: null,
        grid: node.items.map((row) => {
          if (row.kind === 'array') return row.items.map(read);
          state.bad = true;
          return [];
        }),
      };
  if (state.bad) {
    warn(ctx, 'tensor.invalid-value', `${quote(member.key)} holds entries that are not numbers; they are read as 0.`, memberWhere(f, member));
  }
  return numbers;
}

/** Labelled cells: a list of labels (one row) or a list of rows. */
function readCellText(ctx: Context, f: Fields, member: JsonMember, items: JsonNode[]): Grid<string | null> {
  const state = { bad: false };
  const read = (item: JsonNode): string | null => {
    const text = cellText(item);
    if (text === undefined) state.bad = true;
    return text ?? null;
  };
  let grid: Grid<string | null>;
  if (items.every((item) => item.kind === 'array')) {
    grid = items.map((row) => (row.kind === 'array' ? row.items.map(read) : []));
    const cols = Math.max(...grid.map((row) => row.length));
    if (grid.some((row) => row.length !== cols)) {
      warn(ctx, 'tensor.ragged', 'The rows of "cells" differ in length; short rows are padded with empty cells.', memberWhere(f, member));
      grid = grid.map((row) => [...row, ...new Array<null>(cols - row.length).fill(null)]);
    }
  } else {
    grid = [items.map(read)];
  }
  if (state.bad) {
    warn(ctx, 'tensor.invalid-value', '"cells" holds entries that are not text; they are drawn empty.', memberWhere(f, member));
  }
  return grid;
}

/** Fits the cell count under MAX_TENSOR_CELLS, keeping the aspect ratio as far as whole cells allow. */
function fitCells(rows: number, cols: number): [number, number] {
  if (rows * cols <= MAX_TENSOR_CELLS) return [rows, cols];
  const scale = Math.sqrt(MAX_TENSOR_CELLS / (rows * cols));
  let r = Math.max(1, Math.floor(rows * scale));
  let c = Math.max(1, Math.floor(cols * scale));
  if (r * c > MAX_TENSOR_CELLS) {
    if (r > c) r = Math.floor(MAX_TENSOR_CELLS / c);
    else c = Math.floor(MAX_TENSOR_CELLS / r);
  }
  return [r, c];
}

/**
 * A tensor's cells from `cells`, `values` and `mask`: the dimensions come
 * from `cells` (or from `values` when it is missing), values are shaped to
 * them, and intensities are brought into 0..1.
 */
function readTensor(ctx: Context, f: Fields | null, draft: Draft): TensorCells {
  const cellsMember = f ? take(ctx, f, ['cells'], 'item') : null;
  const valuesMember = f ? take(ctx, f, ['values'], 'item') : null;
  const maskMember = f ? take(ctx, f, ['mask'], 'item') : null;
  const itemWhere: Where = { path: draft.entry.path, range: nodeRange(draft.entry.node) };
  let rows = 0;
  let cols = 0;
  let text: Grid<string | null> | null = null;
  let numbers: Numbers | null = null;
  let numbersWhere: Where = itemWhere;
  let pattern: TensorCells['pattern'] = 'none';

  if (f && cellsMember && cellsMember.value.kind !== 'null') {
    const node = cellsMember.value;
    const dims = dimsOf(node);
    if (dims) [rows, cols] = dims;
    else if (node.kind === 'array' && node.items.length > 0) {
      text = readCellText(ctx, f, cellsMember, node.items);
      rows = text.length;
      cols = Math.max(...text.map((row) => row.length));
    } else {
      invalid(ctx, 'tensor', f, cellsMember, 'a count, [rows, cols], a list of labels, or a list of rows');
    }
  }
  if (f && valuesMember && valuesMember.value.kind !== 'null') {
    numbers = readNumbers(ctx, f, valuesMember);
    numbersWhere = memberWhere(f, valuesMember);
  }
  if (f && maskMember && maskMember.value.kind !== 'null') {
    const node = maskMember.value;
    if (node.kind === 'array') {
      // An explicit 0/1 mask (a sliding window, a block pattern) draws as intensities.
      if (numbers) {
        warn(ctx, 'tensor.misplaced-key', 'A "mask" grid is ignored because "values" already sets the cells.', memberWhere(f, maskMember));
      } else {
        numbers = readNumbers(ctx, f, maskMember);
        numbersWhere = memberWhere(f, maskMember);
      }
    } else if (node.kind === 'boolean' && !node.value) {
      pattern = 'none';
    } else {
      pattern = readWord(ctx, 'tensor', f, maskMember, MASKS) ?? 'none';
    }
  }

  if (rows === 0 && cols === 0 && numbers) {
    if (numbers.grid) {
      rows = numbers.grid.length;
      cols = Math.max(0, ...numbers.grid.map((row) => row.length));
    } else {
      rows = 1;
      cols = numbers.flat.length;
    }
  }
  const dimsWhere = f && cellsMember ? memberWhere(f, cellsMember) : itemWhere;
  if (rows === 0 && cols === 0) {
    warn(
      ctx,
      'tensor.no-cells',
      `Tensor ${quote(draft.id)} has no "cells"; drawing a row of 4. Give "cells": n, [rows, cols] or a list of labels.`,
      dimsWhere,
    );
    rows = 1;
    cols = 4;
  }
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    const whole = (n: number) => (Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1);
    warn(
      ctx,
      'tensor.invalid-value',
      `A tensor needs whole, positive rows and columns; ${rows}×${cols} is read as ${whole(rows)}×${whole(cols)}.`,
      dimsWhere,
    );
    rows = whole(rows);
    cols = whole(cols);
  }
  const [fitRows, fitCols] = fitCells(rows, cols);
  if (fitRows !== rows || fitCols !== cols) {
    warn(
      ctx,
      'tensor.too-many-cells',
      `A tensor draws at most ${MAX_TENSOR_CELLS} cells; ${rows}×${cols} is cut to ${fitRows}×${fitCols}.`,
      dimsWhere,
    );
    rows = fitRows;
    cols = fitCols;
  }
  if (text) text = text.slice(0, rows).map((row) => row.slice(0, cols));

  let values: Grid<number> | null = null;
  if (numbers) {
    const { flat, grid } = numbers;
    const fits = grid
      ? grid.length === rows && grid.every((row) => row.length === cols)
      : flat.length === rows * cols;
    values = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => (grid ? grid[r]?.[c] : flat[r * cols + c]) ?? 0),
    );
    if (!fits) {
      warn(
        ctx,
        'tensor.values-shape',
        `The values do not match the ${rows}×${cols} cells; missing ones are 0 and extra ones are dropped.`,
        numbersWhere,
      );
    }
    const all = values.flat();
    if (all.some((value) => value < 0)) {
      warn(ctx, 'tensor.values-range', 'Cell values below 0 are drawn as 0; values run from 0 to 1.', numbersWhere);
    }
    const max = Math.max(...all);
    if (max > 1) {
      note(ctx, 'tensor.values-normalized', `Cell values go up to ${max}; they are divided by it to run from 0 to 1.`, numbersWhere);
    }
    const divisor = max > 1 ? max : 1;
    values = values.map((row) => row.map((value) => Math.max(0, Math.min(1, value / divisor))));
  }
  return { rows, cols, text, values, pattern };
}

/* ─── Nodes and groups ─── */

/**
 * `NodeModel` has no field for a node's `repeat` marker yet; layout reads it
 * as an optional extra, so the model carries it alongside.
 */
type NodeWithRepeat = NodeModel & { repeat: string | null };

function buildNode(ctx: Context, draft: Draft, resolve: Resolver): NodeWithRepeat {
  const f = draft.entry.fields;
  const who = ` on node ${quote(draft.id)}`;
  const style = readStyle(ctx, f, draft);
  let shape: Shape | null = null;
  const shapeMember = f ? take(ctx, f, ['shape'], 'item') : null;
  const shapeText = f ? readText(ctx, 'item', f, shapeMember) : undefined;
  if (f && shapeMember && shapeText !== undefined) {
    shape = resolveShape(shapeText);
    if (!shape) {
      warn(
        ctx,
        'item.unknown-shape',
        `Unknown shape ${quote(shapeText)}.${didYouMean(nearest(shapeText, SHAPE_WORDS, 2))} It is drawn as a box.`,
        memberWhere(f, shapeMember),
      );
    }
  }
  shape ??= style.typeShape;
  // Cells or an image source say what the node is more surely than a role does.
  if (!shape && peek(f, ['cells', 'values'])) shape = 'tensor';
  if (!shape && peek(f, ['src', 'url', 'href'])) shape = 'image';
  shape ??= style.role?.shape ?? 'box';

  const tone = style.tone ?? style.role?.tone ?? 'neutral';
  // A node without a label shows its id, as a bare string does; a tensor or an
  // image carries its label outside and is fine without one.
  const derived = draft.entry.status === 'derived';
  // The id drawn as the label is capped like any label; the id itself stays whole for edges.
  const labelSource =
    draft.entry.labelSource ??
    (derived || shape === 'tensor' || shape === 'image' ? '' : clampLabelText(ctx, draft.id, idWhere(draft.entry)));
  const label = draft.label ?? parseLabel(labelSource);

  let sublabel: Label | null = null;
  const sublabelMember = f ? take(ctx, f, ['sublabel', 'subtitle', 'dims', 'detail'], 'item') : null;
  if (f && sublabelMember) {
    const value = sublabelMember.value;
    if (value.kind === 'array' && value.items.every((item) => item.kind === 'string' || item.kind === 'number')) {
      // `"dims": ["B", "T", 512]` → B × T × 512.
      const parts = value.items.map((item) => (item.kind === 'string' ? item.value : String((item as { value: number }).value)));
      sublabel = labelOrNull(clampLabelText(ctx, parts.join(' × '), memberWhere(f, sublabelMember)));
    } else {
      sublabel = labelOrNull(readLabelSource(ctx, 'item', f, sublabelMember));
    }
  }

  const border = readBorder(ctx, f) ?? (shape === 'text' ? 'none' : 'solid');

  let pattern: Pattern = 'none';
  if (f) {
    pattern = readWord(ctx, 'item', f, take(ctx, f, ['pattern'], 'item'), PATTERNS) ?? 'none';
    for (const flag of ['hatch', 'hatched', 'cached'] as const) {
      const flagMember = take(ctx, f, [flag], 'item');
      if (readBool(ctx, 'item', f, flagMember) && pattern === 'none') pattern = 'hatch';
    }
  }

  const bold = (f && readBool(ctx, 'item', f, take(ctx, f, ['bold'], 'item'))) ?? false;
  const italic = (f && readBool(ctx, 'item', f, take(ctx, f, ['italic'], 'item'))) ?? style.role?.italic ?? false;

  let stack = 1;
  const stackMember = f ? take(ctx, f, ['stack', 'copies', 'stacked'], 'item') : null;
  if (f && stackMember && stackMember.value.kind !== 'null') {
    if (stackMember.value.kind === 'boolean') stack = stackMember.value.value ? 3 : 1;
    else {
      const value = readNumber(ctx, 'item', f, stackMember);
      if (value !== undefined) stack = clampInteger(ctx, 'item', f, stackMember, value, 1, 8);
    }
  }

  const repeat = readRepeat(ctx, f);
  let badge: string | null = null;
  if (f) {
    const badgeMember = take(ctx, f, ['badge'], 'item');
    const text = readText(ctx, 'item', f, badgeMember);
    if (badgeMember && text?.trim()) badge = clampLabelText(ctx, text.trim(), memberWhere(f, badgeMember));
  }

  let cells: TensorCells | null = null;
  if (shape === 'tensor') cells = readTensor(ctx, f, draft);

  let src: string | null = null;
  const srcMember = f ? take(ctx, f, ['src', 'url', 'href'], 'item') : null;
  if (f && srcMember) {
    const text = readText(ctx, 'item', f, srcMember);
    if (shape !== 'image') {
      warn(ctx, 'image.misplaced-key', `${quote(srcMember.key)} only applies to "shape": "image"; it is ignored.`, memberWhere(f, srcMember));
    } else if (text !== undefined) {
      src = safeImageSrc(text);
      if (!src) {
        warn(
          ctx,
          'image.unsafe-src',
          'Images must be base64 data:image/png, jpeg, gif, webp or svg+xml URLs; a placeholder is drawn instead.',
          memberWhere(f, srcMember),
        );
      } else if (!src.startsWith('data:')) {
        // Fetching would tell another site who reads the document, and when.
        note(
          ctx,
          'image.remote',
          'Remote images are not loaded, to keep reading private; a placeholder is drawn. Embed the image as a base64 data:image/… URL to show it.',
          memberWhere(f, srcMember),
        );
      }
    }
  }

  const width = f ? readFixedSize(ctx, f, 'width') : null;
  const height = f ? readFixedSize(ctx, f, 'height') : null;
  const placement = readPlacement(ctx, f, draft, resolve);

  if (f) {
    const fill = peek(f, ['fill']);
    if (fill && !f.used.has(fill)) {
      f.used.add(fill);
      warn(ctx, 'item.misplaced-key', '"fill": true/false only applies to groups; colour a node with "tone".', memberWhere(f, fill));
    }
    const leaf = draft.entry.leafChildren;
    if (leaf) {
      note(
        ctx,
        'item.no-children',
        `${quote(leaf.key)} is ${leaf.value.kind === 'null' ? 'null' : 'empty'}, so ${quote(draft.id)} is a node; add "type": "group" for an empty group box.`,
        memberWhere(f, leaf),
      );
    }
    takeEdgeKeys(ctx, f, draft);
    if (shape !== 'tensor') {
      for (const member of [take(ctx, f, ['cells'], 'item'), take(ctx, f, ['values'], 'item'), take(ctx, f, ['mask'], 'item')]) {
        if (member) warn(ctx, 'tensor.misplaced-key', `${quote(member.key)} only applies to "shape": "tensor"; it is ignored.`, memberWhere(f, member));
      }
    }
    reportUnknown(ctx, f, 'item', NODE_KEYS, who, {
      keys: GROUP_ONLY_SET,
      reason: `applies to groups, and ${quote(draft.id)} has no "children"`,
    });
  }

  const node: NodeWithRepeat = {
    kind: 'node',
    id: draft.id,
    parent: draft.parent?.id ?? ROOT_ID,
    order: draft.order,
    path: draft.entry.path,
    range: nodeRange(draft.entry.node),
    label,
    sublabel,
    shape,
    op: shape === 'op' ? opGlyphFor(labelSource) : null,
    tone,
    border,
    pattern,
    bold,
    italic,
    stack,
    repeat,
    badge,
    cells,
    src,
    width,
    height,
    ...placement,
  };
  return node;
}

type Arrangement = {
  layout: ContainerLayout;
  direction: Direction | null;
  columns: number;
  align: Align;
  gap: number | null;
  uniform: boolean;
};

/** How a container arranges its children: shared by groups and the top level. */
function readArrangement(ctx: Context, scope: Scope, f: Fields | null): Arrangement {
  const arrangement: Arrangement = { layout: 'flow', direction: null, columns: 2, align: 'center', gap: null, uniform: false };
  if (!f) return arrangement;
  const layoutMember = take(ctx, f, ['layout'], scope);
  const layout = readWord(ctx, scope, f, layoutMember, LAYOUTS);
  arrangement.direction = readDirection(ctx, scope, f, take(ctx, f, ['direction'], scope)) ?? null;
  const columnsMember = take(ctx, f, ['columns', 'cols'], scope);
  const columns = readNumber(ctx, scope, f, columnsMember);
  if (columns !== undefined && columnsMember) {
    arrangement.columns = clampInteger(ctx, scope, f, columnsMember, columns, 1, 64);
    if (!layoutMember) {
      note(ctx, `${scope}.grid-implied`, '"columns" without a "layout" is read as "layout": "grid".', memberWhere(f, columnsMember));
    }
  }
  arrangement.layout = layout ?? (columns !== undefined && !layoutMember ? 'grid' : 'flow');
  arrangement.align = readWord(ctx, scope, f, take(ctx, f, ['align'], scope), ALIGNS) ?? 'center';
  const gapMember = take(ctx, f, ['gap'], scope);
  const gap = readNumber(ctx, scope, f, gapMember);
  if (gap !== undefined && gapMember) arrangement.gap = clampInteger(ctx, scope, f, gapMember, gap, 0, 400);
  arrangement.uniform = readBool(ctx, scope, f, take(ctx, f, ['uniform'], scope)) ?? false;
  return arrangement;
}

function buildGroup(ctx: Context, draft: Draft, resolve: Resolver): GroupModel {
  const f = draft.entry.fields;
  const who = ` on group ${quote(draft.id)}`;
  const style = readStyle(ctx, f, draft);
  const tone = style.tone ?? style.role?.tone ?? 'neutral';
  const toneGiven = style.tone !== undefined || style.role !== null;
  const arrangement = readArrangement(ctx, 'item', f);
  draft.explicitDirection = arrangement.direction;

  let filled: boolean | undefined;
  if (f) {
    filled = readBool(ctx, 'item', f, take(ctx, f, ['filled'], 'item'));
    const fill = peek(f, ['fill']);
    if (fill && !f.used.has(fill)) {
      f.used.add(fill);
      if (fill.value.kind === 'boolean') filled ??= fill.value.value;
      else invalid(ctx, 'item', f, fill, 'a tone or true/false');
    }
  }
  filled ??= toneGiven && tone !== 'neutral';

  let panel: Draft['panelSpec'] = null;
  const panelMember = f ? take(ctx, f, ['panel'], 'item') : null;
  if (f && panelMember && panelMember.value.kind !== 'null') {
    if (panelMember.value.kind === 'boolean') {
      if (panelMember.value.value) panel = { text: null };
    } else {
      const text = readText(ctx, 'item', f, panelMember);
      if (text !== undefined) {
        panel = { text: text.trim() ? clampLabelText(ctx, text.trim(), memberWhere(f, panelMember)) : null };
      }
    }
  }
  draft.panelSpec = panel;
  const border = readBorder(ctx, f) ?? (panel ? 'none' : filled ? 'solid' : 'dashed');
  const repeat = readRepeat(ctx, f);
  const labelPosition = (f && readWord(ctx, 'item', f, take(ctx, f, ['labelPosition'], 'item'), LABEL_POSITIONS)) || 'top';
  const placement = readPlacement(ctx, f, draft, resolve);
  if (f) {
    takeEdgeKeys(ctx, f, draft);
    reportUnknown(ctx, f, 'item', GROUP_KEYS, who, {
      keys: NODE_ONLY_SET,
      reason: `applies to nodes, and ${quote(draft.id)} is a group`,
    });
  }
  return {
    kind: 'group',
    id: draft.id,
    parent: draft.parent?.id ?? ROOT_ID,
    order: draft.order,
    path: draft.entry.path,
    range: nodeRange(draft.entry.node),
    label: draft.label,
    children: [],
    layout: arrangement.layout,
    direction: 'down',
    columns: arrangement.columns,
    align: arrangement.align,
    gap: arrangement.gap,
    tone,
    border,
    filled,
    repeat,
    panel: null,
    uniform: arrangement.uniform,
    labelPosition,
    ...placement,
  };
}

/** `(a)`, `(b)`, …, `(z)`, `(aa)`, `(ab)`, … */
function panelLetter(index: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return index < 26 ? letters[index] : letters[Math.floor(index / 26) - 1] + letters[index % 26];
}

/* ────────────────────────────────────────────────────────────────────────
 * Edges
 * ──────────────────────────────────────────────────────────────────────── */

type EndpointRef = { raw: string; name: string; side: Side | null; where: Where };

type EdgeStyle = {
  line: LineStyle;
  weight: LineWeight;
  arrow: ArrowEnds;
  route: RouteStyle;
  kind: EdgeKind;
  constraint: boolean;
  tone: Tone | null;
  fromSide: Side | null;
  toSide: Side | null;
  label: Label | null;
  id: string | null;
};

const DEFAULT_EDGE: EdgeStyle = {
  line: 'solid',
  weight: 'normal',
  arrow: 'end',
  route: 'ortho',
  kind: 'flow',
  constraint: true,
  tone: null,
  fromSide: null,
  toSide: null,
  label: null,
  id: null,
};

const EDGE_KEYS = [
  'id', 'from', 'source', 'src', 'start', 'to', 'target', 'dst', 'end', 'label', 'text', 'title', 'name', 'line',
  'style', 'dashed', 'dotted', 'weight', 'thick', 'thin', 'arrow', 'arrows', 'bidirectional', 'directed', 'route',
  'fromSide', 'sourceSide', 'exit', 'fromPort', 'toSide', 'targetSide', 'enter', 'toPort', 'kind', 'type',
  'residual', 'skip', 'feedback', 'constraint', 'tone', 'color', 'colour',
] as const;

type EdgeSink = {
  edges: EdgeModel[];
  usedIds: Set<string>;
  resolve: Resolver;
  overflow: boolean;
};

/**
 * Endpoints from an edge object's `from`/`to` value: an id, a list of ids,
 * `"a, b"`, or `"a.right"` with a pinned side.
 */
function endpointRefs(ctx: Context, f: Fields, member: JsonMember): EndpointRef[] {
  const refs: EndpointRef[] = [];
  const fromNode = (node: JsonNode, path: string) => {
    const text = node.kind === 'string' ? node.value : node.kind === 'number' ? String(node.value) : null;
    if (text === null) {
      warn(ctx, 'edge.invalid-value', `An edge end is an id, not ${describe(node)}; it is ignored.`, { path, range: nodeRange(node) });
      return;
    }
    for (const endpoint of endpointsOf(text, 0)) {
      refs.push({ raw: endpoint.raw, name: endpoint.name, side: endpoint.side, where: { path, range: textRange(ctx, node, endpoint.start, endpoint.end) } });
    }
  };
  const path = joinPath(f.path, member.key);
  if (member.value.kind === 'array') member.value.items.forEach((node, i) => fromNode(node, joinPath(path, i)));
  else fromNode(member.value, path);
  return refs;
}

const CONTROL_ESCAPES: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * The source offset of each character of a decoded string (and of its end),
 * found by replaying the reader's escapes against the decoded value, which
 * settles every ambiguity (`\beta` kept as LaTeX vs `\b` a control escape);
 * null when the two do not line up.
 */
function sourceOffsets(raw: string, decoded: string): number[] | null {
  const offsets: number[] = [];
  let i = 0;
  let j = 0;
  while (j < decoded.length) {
    if (i >= raw.length) return null;
    const c = raw[i];
    if (c === '\\' && i + 1 < raw.length) {
      const e = raw[i + 1];
      const hex = e === 'u' ? raw.slice(i + 2, i + 6) : '';
      let width = 0;
      if ('"\'\\/'.includes(e) && decoded[j] === e) width = 2;
      else if (/^[0-9a-fA-F]{4}$/.test(hex) && decoded[j] === String.fromCharCode(parseInt(hex, 16))) width = 6;
      else if (CONTROL_ESCAPES[e] !== undefined && decoded[j] === CONTROL_ESCAPES[e]) width = 2;
      if (width) {
        offsets.push(i);
        i += width;
        j += 1;
        continue;
      }
      // Otherwise the backslash was kept as LaTeX and reads as itself.
    }
    if (c < ' ' && c !== decoded[j] && decoded[j] === '\\') {
      // A raw control character inside maths, restored as backslash + letter.
      offsets.push(i, i);
      i += 1;
      j += 2;
      continue;
    }
    if (c !== decoded[j]) return null;
    offsets.push(i);
    i += 1;
    j += 1;
  }
  if (i !== raw.length) return null;
  offsets.push(i);
  return offsets;
}

/**
 * The source range of `[from, to)` within a string value. Exact when the
 * source is known; without it, exact only when the string has no escapes
 * (its raw length equals its value's), else the whole string.
 */
function textRange(ctx: Context, node: JsonNode, from: number, to: number): [number, number] {
  if (node.kind === 'string') {
    const base = node.start + 1;
    if (ctx.source !== undefined) {
      let offsets = ctx.offsets.get(node);
      if (offsets === undefined) {
        offsets = sourceOffsets(ctx.source.slice(base, node.end - 1), node.value);
        ctx.offsets.set(node, offsets);
      }
      if (offsets && to < offsets.length) return [base + offsets[from], base + offsets[to]];
    } else if (node.end - node.start - 2 === node.value.length) {
      return [base + from, base + to];
    }
  }
  return nodeRange(node);
}

/**
 * A weight written where the line style goes (`"line": "thick"`, `"bold"`):
 * `=>` is documented as the thick arrow, so models reach for the word.
 */
function weightAsLine(member: JsonMember | null): LineWeight | null {
  if (member?.value.kind !== 'string' || LINES.resolve(member.value.value)) return null;
  return WEIGHTS.resolve(member.value.value);
}

function readEdgeStyle(ctx: Context, f: Fields): EdgeStyle {
  const style: EdgeStyle = { ...DEFAULT_EDGE };
  const idText = readText(ctx, 'edge', f, take(ctx, f, ['id'], 'edge'));
  if (idText?.trim()) style.id = idText.trim();
  const labelMember = take(ctx, f, LABEL_KEYS, 'edge');
  style.label = labelOrNull(readLabelSource(ctx, 'edge', f, labelMember));

  const lineMember = take(ctx, f, ['line', 'style'], 'edge');
  const lineWeight = weightAsLine(lineMember);
  style.line = (lineWeight ? undefined : readWord(ctx, 'edge', f, lineMember, LINES)) ?? 'solid';
  for (const flag of ['dashed', 'dotted'] as const) {
    if (readBool(ctx, 'edge', f, take(ctx, f, [flag], 'edge')) && (!lineMember || lineWeight)) style.line = flag;
  }

  const weightMember = take(ctx, f, ['weight'], 'edge');
  if (weightMember?.value.kind === 'number') {
    const w = weightMember.value.value;
    style.weight = w < 1 ? 'thin' : w > 1.5 ? 'thick' : 'normal';
  } else {
    style.weight = readWord(ctx, 'edge', f, weightMember, WEIGHTS) ?? 'normal';
  }
  const thick = readBool(ctx, 'edge', f, take(ctx, f, ['thick'], 'edge'));
  const thin = readBool(ctx, 'edge', f, take(ctx, f, ['thin'], 'edge'));
  if (!weightMember && lineWeight) style.weight = lineWeight;
  else if (!weightMember && thick) style.weight = 'thick';
  else if (!weightMember && thin) style.weight = 'thin';

  const arrowMember = take(ctx, f, ['arrow', 'arrows'], 'edge');
  if (arrowMember?.value.kind === 'boolean') style.arrow = arrowMember.value.value ? 'end' : 'none';
  else style.arrow = readWord(ctx, 'edge', f, arrowMember, ARROWS) ?? 'end';
  const bidirectional = readBool(ctx, 'edge', f, take(ctx, f, ['bidirectional'], 'edge'));
  const directed = readBool(ctx, 'edge', f, take(ctx, f, ['directed'], 'edge'));
  if (!arrowMember) {
    if (bidirectional) style.arrow = 'both';
    else if (directed === false) style.arrow = 'none';
  }

  style.route = readWord(ctx, 'edge', f, take(ctx, f, ['route'], 'edge'), ROUTES) ?? 'ortho';

  const kindMember = take(ctx, f, ['kind', 'type'], 'edge');
  let kind = readWord(ctx, 'edge', f, kindMember, EDGE_KINDS);
  for (const flag of ['residual', 'skip', 'feedback'] as const) {
    if (readBool(ctx, 'edge', f, take(ctx, f, [flag], 'edge')) && !kindMember) kind ??= flag;
  }
  style.kind = kind ?? 'flow';
  style.constraint = readBool(ctx, 'edge', f, take(ctx, f, ['constraint'], 'edge')) ?? style.kind !== 'feedback';
  style.tone = readTone(ctx, 'edge', f, take(ctx, f, ['tone', 'color', 'colour'], 'edge')) ?? null;

  const side = (names: readonly string[]): Side | null => {
    const member = take(ctx, f, names, 'edge');
    const text = readText(ctx, 'edge', f, member);
    if (!member || text === undefined) return null;
    const resolved = resolveSide(text);
    if (!resolved) {
      warn(ctx, 'edge.invalid-value', `${quote(member.key)} must be "top", "bottom", "left" or "right"; ${quote(text)} is ignored.`, memberWhere(f, member));
    }
    return resolved;
  };
  style.fromSide = side(['fromSide', 'sourceSide', 'exit', 'fromPort']);
  style.toSide = side(['toSide', 'targetSide', 'enter', 'toPort']);
  return style;
}

/** Whether the edge cap is reached, reporting it the first time. */
function edgesFull(ctx: Context, sink: EdgeSink, where: Where): boolean {
  if (sink.edges.length < MAX_FIGURE_EDGES) return false;
  if (!sink.overflow) {
    sink.overflow = true;
    report(ctx, 'error', 'spec.too-many-edges', `A figure draws at most ${MAX_FIGURE_EDGES} edges; the rest are dropped.`, where);
  }
  return true;
}

/** Adds one edge per source × target, dropping ends that do not resolve. */
function addEdges(
  ctx: Context,
  sink: EdgeSink,
  from: EndpointRef[],
  to: EndpointRef[],
  style: EdgeStyle,
  where: Where,
  describeEdge: string,
): void {
  const resolveEnd = (ref: EndpointRef): { draft: Draft; side: Side | null } | null => {
    // An id may itself contain a dot; only a name that does not resolve as written loses its suffix.
    if (ref.side) {
      const whole = sink.resolve(ref.raw);
      if (whole.kind === 'ok') return { draft: whole.draft, side: null };
    }
    const resolution = sink.resolve(ref.name);
    if (resolution.kind === 'ok') return { draft: resolution.draft, side: ref.side };
    if (resolution.kind === 'dropped') return null;
    const code = resolution.kind === 'ambiguous' ? 'edge.ambiguous-node' : resolution.kind === 'root' ? 'edge.root' : 'edge.unknown-node';
    warn(ctx, code, `Edge ${describeEdge}: ${unresolvedMessage(ref.name, resolution)} The edge is dropped.`, ref.where);
    return null;
  };
  const sources = from.map(resolveEnd);
  const targets = to.map(resolveEnd);
  for (const source of sources) {
    if (!source) continue;
    for (const target of targets) {
      if (!target) continue;
      if (edgesFull(ctx, sink, where)) return;
      const order = sink.edges.length;
      const id = uniqueId(style.id ?? `e${order + 1}`, sink.usedIds);
      sink.edges.push({
        id,
        from: source.draft.id,
        to: target.draft.id,
        fromSide: source.side ?? style.fromSide,
        toSide: target.side ?? style.toSide,
        label: style.label,
        line: style.line,
        weight: style.weight,
        arrow: style.arrow,
        route: style.route,
        kind: style.kind,
        constraint: style.constraint,
        tone: style.tone,
        order,
        path: where.path,
        ...(where.range ? { range: where.range } : {}),
      });
    }
  }
}

/**
 * One shorthand edge string — or one line of a multi-line `edges` string,
 * `part`, whose offsets are relative to the whole string node.
 */
function readShorthandEdge(
  ctx: Context,
  sink: EdgeSink,
  node: JsonStringNode,
  path: string,
  part: { text: string; start: number } = { text: node.value, start: 0 },
): void {
  const where: Where = { path, range: nodeRange(node) };
  const hops = scanShorthand(part.text, (name) => sink.resolve(name).kind !== 'unknown');
  if (!Array.isArray(hops)) {
    warn(ctx, 'edge.syntax', `${hops.error} The edge is dropped.`, where);
    return;
  }
  const ref = (endpoint: ShorthandEndpoint): EndpointRef => ({
    raw: endpoint.raw,
    name: endpoint.name,
    side: endpoint.side,
    where: { path, range: textRange(ctx, node, part.start + endpoint.start, part.start + endpoint.end) },
  });
  for (const hop of hops) {
    // Past the cap every hop is dropped: skip the endpoint work for the rest of a long chain.
    if (edgesFull(ctx, sink, where)) break;
    const labelAt = part.start + hop.labelStart;
    const labelSource =
      hop.label === null ? null : clampLabelText(ctx, hop.label, { path, range: textRange(ctx, node, labelAt, labelAt + hop.label.length) });
    addEdges(
      ctx,
      sink,
      hop.from.map(ref),
      hop.to.map(ref),
      { ...DEFAULT_EDGE, line: hop.line, weight: hop.weight, arrow: hop.arrow, label: labelOrNull(labelSource) },
      where,
      quote(part.text.trim()),
    );
  }
}

function readEdgeObject(
  ctx: Context,
  sink: EdgeSink,
  node: JsonObjectNode,
  path: string,
  implicitFrom: Draft | null,
): void {
  const f = fieldsOf(ctx, node, path);
  const where: Where = { path, range: nodeRange(node) };
  const fromMember = take(ctx, f, ['from', 'source', 'src', 'start'], 'edge');
  const toMember = take(ctx, f, ['to', 'target', 'dst', 'end'], 'edge');
  const style = readEdgeStyle(ctx, f);
  reportUnknown(ctx, f, 'edge', EDGE_KEYS, '');
  let from: EndpointRef[] = fromMember ? endpointRefs(ctx, f, fromMember) : [];
  if (implicitFrom && !fromMember) {
    from = [{ raw: implicitFrom.id, name: implicitFrom.id, side: null, where }];
  }
  const to: EndpointRef[] = toMember ? endpointRefs(ctx, f, toMember) : [];
  if (!fromMember && !implicitFrom) {
    warn(ctx, 'edge.missing-endpoint', 'The edge has no "from"; it is dropped.', where);
    return;
  }
  if (!toMember) {
    warn(ctx, 'edge.missing-endpoint', 'The edge has no "to"; it is dropped.', where);
    return;
  }
  const names = (refs: EndpointRef[]) => refs.map((ref) => ref.raw).join(', ');
  addEdges(ctx, sink, from, to, style, where, quote(`${names(from)} -> ${names(to)}`));
}

/** One entry of an `edges` list: a shorthand string, an object, or a `[from, to, label?]` tuple. */
function readEdgeEntry(ctx: Context, sink: EdgeSink, node: JsonNode, path: string): void {
  if (node.kind === 'string') return readShorthandEdge(ctx, sink, node, path);
  if (node.kind === 'object') return readEdgeObject(ctx, sink, node, path, null);
  if (node.kind === 'array' && node.items.length >= 2 && node.items.length <= 3) {
    const [a, b, c] = node.items;
    const ends = [a, b].map((end) => (end.kind === 'string' || end.kind === 'number' ? end : null));
    if (ends[0] && ends[1] && (!c || c.kind === 'string')) {
      const where: Where = { path, range: nodeRange(node) };
      const refs = (end: JsonNode, i: number): EndpointRef[] =>
        endpointsOf(end.kind === 'string' ? end.value : String((end as { value: number }).value), 0).map((e) => ({
          raw: e.raw,
          name: e.name,
          side: e.side,
          where: { path: joinPath(path, i), range: textRange(ctx, end, e.start, e.end) },
        }));
      const from = refs(a, 0);
      const to = refs(b, 1);
      const label = c && c.kind === 'string' ? labelOrNull(clampLabelText(ctx, c.value, where)) : null;
      addEdges(ctx, sink, from, to, { ...DEFAULT_EDGE, label }, where, quote(`${from.map((r) => r.raw).join(', ')} -> ${to.map((r) => r.raw).join(', ')}`));
      return;
    }
  }
  warn(ctx, 'edge.invalid', `An edge is a string like "a -> b" or an object with "from" and "to", not ${describe(node)}; it is ignored.`, {
    path,
    range: nodeRange(node),
  });
}

/** Splits a multi-line `"edges"` string into its lines (and `;`-separated edges outside maths). */
function splitEdgeText(text: string): Array<{ text: string; start: number }> {
  const parts: Array<{ text: string; start: number }> = [];
  let inMath = false;
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    const ch = text[i];
    if (ch === '$' && text[i - 1] !== '\\') inMath = !inMath;
    if (i === text.length || ch === '\n' || (ch === ';' && !inMath)) {
      if (text.slice(start, i).trim()) parts.push({ text: text.slice(start, i), start });
      start = i + 1;
      if (ch === '\n') inMath = false;
    }
  }
  return parts;
}

/* ────────────────────────────────────────────────────────────────────────
 * Legend
 * ──────────────────────────────────────────────────────────────────────── */

const LEGEND_KEYS = [
  'label', 'text', 'name', 'title', 'tone', 'color', 'colour', 'fill', 'shape', 'role', 'pattern', 'hatch', 'hatched',
  'cached', 'border', 'dashed', 'dotted', 'style', 'line', 'arrow', 'arrows', 'edge', 'weight', 'thick', 'thin',
  'kind', 'type',
] as const;

function readLegendEntry(ctx: Context, node: JsonNode, path: string): LegendItemModel | null {
  const where: Where = { path, range: nodeRange(node) };
  if (node.kind === 'string') {
    const label = labelOrNull(clampLabelText(ctx, node.value, where));
    if (!label) {
      warn(ctx, 'legend.missing-label', 'A legend entry needs a label; it is ignored.', where);
      return null;
    }
    return { label, sample: { kind: 'node', tone: 'neutral', shape: 'box', pattern: 'none', border: 'solid' } };
  }
  if (node.kind !== 'object') {
    warn(ctx, 'legend.invalid', `A legend entry is an object or a string, not ${describe(node)}; it is ignored.`, where);
    return null;
  }
  const f = fieldsOf(ctx, node, path);
  const label = labelOrNull(readLabelSource(ctx, 'legend', f, take(ctx, f, LABEL_KEYS, 'legend')));
  const kindWord = readText(ctx, 'legend', f, take(ctx, f, ['kind', 'type'], 'legend'));
  const edgeFlag = readBool(ctx, 'legend', f, take(ctx, f, ['edge'], 'legend'));
  const lineMember = take(ctx, f, ['line'], 'legend');
  const arrowMember = take(ctx, f, ['arrow', 'arrows'], 'legend');
  // The sample only draws a line; the arrow's ends do not change it.
  if (arrowMember && arrowMember.value.kind !== 'boolean') readWord(ctx, 'legend', f, arrowMember, ARROWS);
  const isEdge =
    edgeFlag === true ||
    !!lineMember ||
    !!arrowMember ||
    // Only an edge sample has a line weight.
    !!peek(f, ['weight', 'thick', 'thin']) ||
    (kindWord !== undefined && ['edge', 'line', 'arrow', 'link'].includes(vocabularyKey(kindWord)));
  const tone = readTone(ctx, 'legend', f, take(ctx, f, ['tone', 'color', 'colour', 'fill'], 'legend'));
  // `style` is the line style of an edge sample and the border of a node swatch.
  const styleMember = take(ctx, f, isEdge ? ['line', 'style'] : ['border', 'style'], 'legend');
  const dashed = readBool(ctx, 'legend', f, take(ctx, f, ['dashed'], 'legend'));
  const dotted = readBool(ctx, 'legend', f, take(ctx, f, ['dotted'], 'legend'));
  const flagged = dashed ? 'dashed' : dotted ? 'dotted' : 'solid';
  let sample: LegendItemModel['sample'];
  if (isEdge) {
    const lineWeight = weightAsLine(lineMember ?? styleMember);
    const line = (lineWeight ? undefined : readWord(ctx, 'legend', f, lineMember ?? styleMember, LINES)) ?? flagged;
    const weightMember = take(ctx, f, ['weight'], 'legend');
    const thick = readBool(ctx, 'legend', f, take(ctx, f, ['thick'], 'legend'));
    const thin = readBool(ctx, 'legend', f, take(ctx, f, ['thin'], 'legend'));
    const weight =
      readWord(ctx, 'legend', f, weightMember, WEIGHTS) ?? lineWeight ?? (thick ? 'thick' : thin ? 'thin' : 'normal');
    sample = { kind: 'edge', line, weight, tone: tone ?? null };
  } else {
    const roleMember = take(ctx, f, ['role'], 'legend');
    const roleText = readText(ctx, 'legend', f, roleMember);
    const role = roleText !== undefined ? resolveRole(roleText) : null;
    if (roleMember && roleText !== undefined && !role) {
      warn(ctx, 'legend.invalid-value', `Unknown role ${quote(roleText)}.${didYouMean(nearest(roleText, ROLE_WORDS, 2))}`, memberWhere(f, roleMember));
    }
    const shapeMember = take(ctx, f, ['shape'], 'legend');
    const shapeText = readText(ctx, 'legend', f, shapeMember);
    const shape = shapeText !== undefined ? resolveShape(shapeText) : null;
    if (shapeMember && shapeText !== undefined && !shape) {
      warn(ctx, 'legend.invalid-value', `Unknown shape ${quote(shapeText)}.${didYouMean(nearest(shapeText, SHAPE_WORDS, 2))}`, memberWhere(f, shapeMember));
    }
    let pattern = readWord(ctx, 'legend', f, take(ctx, f, ['pattern'], 'legend'), PATTERNS) ?? 'none';
    for (const flag of ['hatch', 'hatched', 'cached'] as const) {
      if (readBool(ctx, 'legend', f, take(ctx, f, [flag], 'legend')) && pattern === 'none') pattern = 'hatch';
    }
    sample = {
      kind: 'node',
      tone: tone ?? role?.tone ?? 'neutral',
      shape: shape ?? role?.shape ?? 'box',
      pattern,
      border: readWord(ctx, 'legend', f, styleMember, BORDERS) ?? flagged,
    };
  }
  reportUnknown(ctx, f, 'legend', LEGEND_KEYS, '');
  if (!label) {
    warn(ctx, 'legend.missing-label', 'A legend entry needs a "label"; it is ignored.', where);
    return null;
  }
  return { label, sample };
}

/* ────────────────────────────────────────────────────────────────────────
 * The spec
 * ──────────────────────────────────────────────────────────────────────── */

const TOP_KEYS = [
  'version', 'caption', 'label', 'title', 'alt', 'size', 'font', 'palette', 'nodes', 'groups', 'edges', 'legend',
  'direction', 'layout', 'columns', 'cols', 'gap', 'align', 'uniform',
] as const;

type TopLevel = {
  fields: Fields | null;
  meta: Pick<FigureModel, 'title' | 'caption' | 'label' | 'alt' | 'size' | 'font' | 'palette'>;
  arrangement: Arrangement;
  itemLists: Array<{ slots: Slot[]; array: 'nodes' | 'groups' }>;
  edges: JsonMember | null;
  legend: JsonMember | null;
};

function topText(ctx: Context, f: Fields, key: string): string | null {
  const text = readText(ctx, 'spec', f, take(ctx, f, [key], 'spec'));
  return text?.trim() ? text.trim() : null;
}

/** The top-level keys; null when the spec is neither an object nor a bare list of nodes. */
function readTopLevel(ctx: Context, ast: JsonNode): TopLevel | null {
  const top: TopLevel = {
    fields: null,
    meta: { title: null, caption: null, label: null, alt: null, size: 'auto', font: 'sans', palette: 'color' },
    arrangement: readArrangement(ctx, 'spec', null),
    itemLists: [],
    edges: null,
    legend: null,
  };
  if (ast.kind === 'array') {
    note(ctx, 'spec.bare-array', 'The spec is a bare list; it is read as the "nodes" of a figure.', { path: '', range: nodeRange(ast) });
    top.itemLists.push({ slots: ast.items.map((node, i) => ({ node, path: `[${i}]`, mapKey: null })), array: 'nodes' });
    return top;
  }
  if (ast.kind !== 'object') {
    report(ctx, 'error', 'spec.not-object', `A figure spec is a JSON object with "nodes", not ${describe(ast)}.`, {
      path: '',
      range: nodeRange(ast),
    });
    return null;
  }
  const f = fieldsOf(ctx, ast, '');
  top.fields = f;
  const version = take(ctx, f, ['version'], 'spec');
  if (version && version.value.kind !== 'null') {
    const v = version.value;
    const ok = (v.kind === 'number' && v.value === 1) || (v.kind === 'string' && /^\s*1(\.0)?\s*$/.test(v.value));
    if (!ok) warn(ctx, 'spec.version', `Only "version": 1 exists; ${describe(v)} is read as version 1.`, memberWhere(f, version));
  }
  top.meta = {
    caption: topText(ctx, f, 'caption'),
    label: topText(ctx, f, 'label'),
    title: topText(ctx, f, 'title'),
    alt: topText(ctx, f, 'alt'),
    size: readWord(ctx, 'spec', f, take(ctx, f, ['size'], 'spec'), SIZES) ?? 'auto',
    font: readWord(ctx, 'spec', f, take(ctx, f, ['font'], 'spec'), FONTS) ?? 'sans',
    palette: readWord(ctx, 'spec', f, take(ctx, f, ['palette'], 'spec'), PALETTES) ?? 'color',
  };
  top.arrangement = readArrangement(ctx, 'spec', f);
  for (const array of ['nodes', 'groups'] as const) {
    const member = take(ctx, f, [array], 'spec');
    if (member) top.itemLists.push({ slots: slotsOf(ctx, member, f, 'spec', true), array });
  }
  top.edges = take(ctx, f, ['edges'], 'spec');
  top.legend = take(ctx, f, ['legend'], 'spec');
  reportUnknown(ctx, f, 'spec', TOP_KEYS, '');
  return top;
}

const definesItem = (entry: Entry) =>
  entry.status === 'owner' || entry.status === 'renamed' || entry.status === 'derived';

/**
 * Decides which entry defines each id, applies the item limit, and gives
 * every item its final id and declaration order. References and redundant
 * mentions are pointed at the item they name.
 */
function identifyItems(ctx: Context, entries: Entry[]): { drafts: Draft[]; dropped: Set<string> } {
  const byId = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (entry.id === ROOT_ID) {
      warn(ctx, 'item.reserved-id', `${quote(ROOT_ID)} is reserved for the figure itself; the item gets another id.`, {
        path: entry.path,
        range: nodeRange(entry.node),
      });
      entry.id = null;
    }
    if (entry.id === null) {
      entry.status = 'derived';
      continue;
    }
    const list = byId.get(entry.id);
    if (list) list.push(entry);
    else byId.set(entry.id, [entry]);
  }
  const ownerOf = new Map<string, Entry>();
  for (const [id, list] of byId) {
    let owner = list[0];
    for (const entry of list) if (ownership(entry) > ownership(owner)) owner = entry;
    ownerOf.set(id, owner);
    for (const entry of list) {
      if (entry === owner) entry.status = 'owner';
      else if (entry.rich) entry.status = 'renamed';
      else entry.status = entry.container ? 'reference' : 'redundant';
    }
  }

  const dropped = new Set<string>();
  let count = 0;
  for (const entry of entries) {
    if (!definesItem(entry)) continue;
    count += 1;
    if (count <= MAX_FIGURE_ITEMS) continue;
    if (count === MAX_FIGURE_ITEMS + 1) {
      report(ctx, 'error', 'spec.too-many-items', `A figure draws at most ${MAX_FIGURE_ITEMS} nodes and groups; the rest are dropped.`, {
        path: entry.path,
        range: nodeRange(entry.node),
      });
    }
    if (entry.status === 'owner' && entry.id !== null) dropped.add(entry.id);
    entry.status = 'dropped';
  }

  // Dropped ids stay reserved, so an edge to one is dropped quietly instead of finding a namesake.
  const used = new Set<string>([ROOT_ID, ...ownerOf.keys()]);
  const drafts: Draft[] = [];
  for (const entry of entries) {
    if (!definesItem(entry)) continue;
    const label = labelOrNull(entry.labelSource);
    const order = drafts.length;
    let id: string;
    if (entry.status === 'owner' && entry.id !== null) {
      id = entry.id;
    } else if (entry.status === 'renamed' && entry.id !== null) {
      id = uniqueId(entry.id, used);
      const first = ownerOf.get(entry.id);
      warn(
        ctx,
        'item.duplicate-id',
        `Duplicate id ${quote(entry.id)}${first ? ` (first declared at ${first.path})` : ''}; this one is renamed ${quote(id)}.`,
        idWhere(entry),
      );
    } else {
      id = uniqueId(slugOf(label) || `n${order}`, used);
    }
    const draft: Draft = {
      id,
      order,
      entry,
      group: entry.groupHint || entry.top === 'groups',
      label,
      parent: null,
      claim: null,
      adopted: false,
      model: null,
      explicitDirection: null,
      panelSpec: null,
      toMember: null,
      edgesMember: null,
    };
    entry.draft = draft;
    drafts.push(draft);
  }

  for (const entry of entries) {
    if (entry.status !== 'reference' && entry.status !== 'redundant') continue;
    const owner = entry.id !== null ? ownerOf.get(entry.id) : undefined;
    entry.draft = owner?.draft ?? null;
    if (!entry.draft || !owner) continue;
    // A mention in the top-level `groups` list still says the item is a group.
    if (entry.top === 'groups') entry.draft.group = true;
    if (entry.status === 'redundant') {
      note(
        ctx,
        'item.redundant',
        `${quote(entry.id ?? '')} is already declared at ${owner.path}; this mention adds nothing and is ignored.`,
        { path: entry.path, range: nodeRange(entry.node) },
      );
    }
  }
  return { drafts, dropped };
}

/**
 * Puts every item in its group: `children` lists first, in declaration order,
 * where the first list to claim an item keeps it; then `parent` keys (and
 * `group: "<id>"`), which win over a listing. A move that would put a group
 * inside itself is refused, so containment is always a tree.
 */
function placeItems(ctx: Context, entries: Entry[], drafts: Draft[], resolve: Resolver): void {
  for (const entry of entries) {
    const item = entry.draft;
    const group = entry.container?.draft ?? null;
    if (!entry.container || !item || !group || entry.status === 'redundant' || entry.status === 'dropped') continue;
    const where: Where = { path: entry.path, range: nodeRange(entry.node) };
    if (item.claim) {
      warn(
        ctx,
        'item.duplicate-child',
        item.parent === group
          ? `${quote(item.id)} is listed twice in the children of ${quote(group.id)}; the second is ignored.`
          : `${quote(item.id)} is already a child of ${nameOf(item.parent)} (${item.claim.path}); it cannot also be in ${quote(group.id)}.`,
        where,
      );
      continue;
    }
    if (containsOrIs(item, group)) {
      warn(ctx, 'item.cycle', `${quote(item.id)} cannot be inside ${quote(group.id)}, which is ${item === group ? 'itself' : 'inside it'}.`, where);
      continue;
    }
    item.parent = group;
    item.claim = entry;
  }

  for (const draft of drafts) {
    const f = draft.entry.fields;
    if (!f) continue;
    const parentMember = take(ctx, f, ['parent'], 'item');
    const groupMember = peek(f, ['group']);
    let member = parentMember;
    if (groupMember) {
      f.used.add(groupMember);
      if (groupMember.value.kind === 'string') {
        if (parentMember) warn(ctx, 'item.duplicate-alias', '"group" is ignored because "parent" already names the group.', memberWhere(f, groupMember));
        else member = groupMember;
      } else if (groupMember.value.kind !== 'boolean' && groupMember.value.kind !== 'null') {
        invalid(ctx, 'item', f, groupMember, 'true or a group id');
      }
    }
    const name = readText(ctx, 'item', f, member);
    if (!member || name === undefined || !name.trim()) continue;
    const where = memberWhere(f, member);
    const resolution = resolve(name);
    let target: Draft | null;
    if (resolution.kind === 'ok') target = resolution.draft;
    else if (resolution.kind === 'root' || vocabularyKey(name) === 'root') target = null;
    else {
      if (resolution.kind !== 'dropped') {
        warn(ctx, 'item.unknown-parent', `${quote(member.key)}: ${unresolvedMessage(name.trim(), resolution)} ${quote(draft.id)} stays where it is.`, where);
      }
      continue;
    }
    if (target && !target.group) {
      if (target.entry.leafChildren) {
        // Its "children": null / [] only meant none were listed; members declared flat make it a group.
        target.group = true;
      } else {
        warn(ctx, 'item.parent-not-group', `${quote(member.key)}: ${quote(target.id)} is a node, not a group; ${quote(draft.id)} stays where it is.`, where);
        continue;
      }
    }
    if (target === draft.parent) continue;
    if (target && containsOrIs(draft, target)) {
      warn(ctx, 'item.cycle', `${quote(draft.id)} cannot be inside ${quote(target.id)}, which is ${target === draft ? 'itself' : 'inside it'}; it stays where it is.`, where);
      continue;
    }
    if (draft.claim) {
      warn(
        ctx,
        'item.parent-conflict',
        `${quote(draft.id)} is listed in the children of ${nameOf(draft.parent)} but says ${quote(member.key)}: ${quote(name.trim())}; it goes to ${nameOf(target)}.`,
        where,
      );
    }
    draft.parent = target;
    draft.claim = null;
    draft.adopted = true;
  }
}

/**
 * The root group, with every group's children in listing order (items moved
 * by `parent` after, by declaration), directions inherited top-down and panel
 * captions lettered in declaration order.
 */
function arrangeGroups(ctx: Context, entries: Entry[], drafts: Draft[], top: TopLevel, ast: JsonNode): GroupModel {
  const firstTopMention = new Map<Draft, number>();
  for (const entry of entries) {
    if (!entry.container && entry.draft && !firstTopMention.has(entry.draft)) firstTopMention.set(entry.draft, entry.seq);
  }
  const slotOf = (draft: Draft): number | null => {
    if (draft.adopted) return null;
    if (draft.claim) return draft.claim.seq;
    return draft.parent === null ? (firstTopMention.get(draft) ?? null) : null;
  };
  const members = new Map<Draft | null, Draft[]>();
  for (const draft of drafts) {
    const list = members.get(draft.parent);
    if (list) list.push(draft);
    else members.set(draft.parent, [draft]);
  }
  const childrenOf = (parent: Draft | null): string[] =>
    (members.get(parent) ?? [])
      .map((draft) => ({ draft, slot: slotOf(draft) }))
      .sort((a, b) => {
        if (a.slot !== null && b.slot !== null) return a.slot - b.slot;
        if (a.slot !== null) return -1;
        if (b.slot !== null) return 1;
        return a.draft.order - b.draft.order;
      })
      .map(({ draft }) => draft.id);

  const { arrangement } = top;
  const root: GroupModel = {
    kind: 'group',
    id: ROOT_ID,
    parent: '',
    order: -1,
    path: '',
    range: nodeRange(ast),
    label: null,
    children: childrenOf(null),
    layout: arrangement.layout,
    direction: arrangement.direction ?? 'down',
    columns: arrangement.columns,
    align: arrangement.align,
    gap: arrangement.gap,
    tone: 'neutral',
    border: 'none',
    filled: false,
    repeat: null,
    panel: null,
    uniform: arrangement.uniform,
    labelPosition: 'top',
    rank: null,
    beside: null,
    sameRank: null,
  };

  // Walk the tree rather than the declaration order, which is not top-down once items move.
  const queue: Array<{ parent: Draft | null; direction: Direction }> = [{ parent: null, direction: root.direction }];
  for (let head = 0; head < queue.length; head += 1) {
    const { parent, direction } = queue[head];
    for (const draft of members.get(parent) ?? []) {
      const model = draft.model;
      if (model?.kind !== 'group') continue;
      model.direction = draft.explicitDirection ?? direction;
      model.children = childrenOf(draft);
      queue.push({ parent: draft, direction: model.direction });
      if (model.children.length === 0) {
        warn(ctx, 'group.empty', `Group ${quote(draft.id)} has no children; it draws as an empty box.`, {
          path: draft.entry.path,
          range: nodeRange(draft.entry.node),
        });
      }
    }
  }

  let panelIndex = 0;
  for (const draft of drafts) {
    const model = draft.model;
    if (model?.kind !== 'group' || !draft.panelSpec) continue;
    const letter = `(${panelLetter(panelIndex)})`;
    panelIndex += 1;
    const { text } = draft.panelSpec;
    const title = draft.entry.labelSource?.trim() ?? '';
    if (text === null) {
      // `panel: true`: the title becomes the caption, and the box draws none.
      model.panel = title ? `${letter} ${title}` : letter;
      model.label = null;
    } else {
      model.panel = /^\(\s*[A-Za-z0-9]{1,3}\s*\)/.test(text) ? text : `${letter} ${text}`;
      // A panel string replaces the title only when there is no separate label.
      if (!title) model.label = null;
    }
  }
  return root;
}

/** Edges from a node's `to` key: ids (with optional `.side`), or edge objects with an implied `from`. */
function readToKey(ctx: Context, sink: EdgeSink, draft: Draft, f: Fields, member: JsonMember): void {
  const path = joinPath(f.path, member.key);
  const list = member.value.kind === 'array' ? member.value.items : [member.value];
  list.forEach((node, i) => {
    const itemPath = member.value.kind === 'array' ? joinPath(path, i) : path;
    if (node.kind === 'object') {
      readEdgeObject(ctx, sink, node, itemPath, draft);
      return;
    }
    if (node.kind !== 'string' && node.kind !== 'number') {
      warn(ctx, 'edge.invalid', `"to" lists ids, not ${describe(node)}; it is ignored.`, { path: itemPath, range: nodeRange(node) });
      return;
    }
    const text = node.kind === 'string' ? node.value : String(node.value);
    const to = endpointsOf(text, 0).map((e) => ({
      raw: e.raw,
      name: e.name,
      side: e.side,
      where: { path: itemPath, range: textRange(ctx, node, e.start, e.end) },
    }));
    const from = [{ raw: draft.id, name: draft.id, side: null, where: { path: itemPath } }];
    addEdges(ctx, sink, from, to, DEFAULT_EDGE, { path: itemPath, range: nodeRange(node) }, quote(`${draft.id} -> ${text.trim()}`));
  });
}

function readEdgeList(ctx: Context, sink: EdgeSink, f: Fields, member: JsonMember, scope: Scope): void {
  const path = joinPath(f.path, member.key);
  const value = member.value;
  if (value.kind === 'array') {
    value.items.forEach((node, i) => readEdgeEntry(ctx, sink, node, joinPath(path, i)));
  } else if (value.kind === 'string') {
    // One edge per line (or per `;`), as in a Mermaid body.
    for (const part of splitEdgeText(value.value)) readShorthandEdge(ctx, sink, value, path, part);
  } else if (value.kind === 'object') {
    readEdgeEntry(ctx, sink, value, path);
  } else if (value.kind !== 'null') {
    invalid(ctx, scope, f, member, 'a list of edges');
  }
}

/**
 * Every edge — from `to` keys, `edges` lists inside groups and the top-level
 * `edges` — in the order it is written, which is the order layout breaks ties by.
 */
function readEdges(ctx: Context, drafts: Draft[], top: TopLevel, resolve: Resolver): EdgeModel[] {
  const sink: EdgeSink = { edges: [], usedIds: new Set([ROOT_ID, ...drafts.map((d) => d.id)]), resolve, overflow: false };
  const sources: Array<{ at: number; run: () => void }> = [];
  for (const draft of drafts) {
    const f = draft.entry.fields;
    if (!f) continue;
    const { toMember, edgesMember } = draft;
    if (toMember) sources.push({ at: toMember.start, run: () => readToKey(ctx, sink, draft, f, toMember) });
    if (edgesMember) sources.push({ at: edgesMember.start, run: () => readEdgeList(ctx, sink, f, edgesMember, 'item') });
  }
  const { fields, edges } = top;
  if (fields && edges) sources.push({ at: edges.start, run: () => readEdgeList(ctx, sink, fields, edges, 'spec') });
  sources.sort((a, b) => a.at - b.at).forEach((source) => source.run());
  return sink.edges;
}

function readLegend(ctx: Context, top: TopLevel): LegendItemModel[] {
  const { fields, legend: member } = top;
  if (!fields || !member || member.value.kind === 'null') return [];
  if (member.value.kind !== 'array') {
    invalid(ctx, 'legend', fields, member, 'a list of entries');
    return [];
  }
  const path = joinPath('', member.key);
  return member.value.items
    .map((node, i) => readLegendEntry(ctx, node, joinPath(path, i)))
    .filter((entry): entry is LegendItemModel => entry !== null);
}

/**
 * Reads a parsed figure spec into the model every later stage draws from.
 *
 * Returns a null model only when there is nothing to draw (no JSON, not an
 * object, no nodes); everything else is repaired and explained, so a figure
 * with a typo still draws. Diagnostics carry the JSON path and the source
 * range of the offending text (and line/column when `source` is passed),
 * errors first, then warnings, then notes.
 */
export function normalizeFigure(
  parse: ParseResult,
  source?: string,
): { model: FigureModel | null; diagnostics: FigureDiagnostic[] } {
  const ctx: Context = { diagnostics: [], source, seen: new Set(), offsets: new WeakMap() };
  const done = (model: FigureModel | null) => ({ model, diagnostics: orderDiagnostics(ctx.diagnostics) });
  const ast = parse.ast;
  if (!ast) return done(null);
  const top = readTopLevel(ctx, ast);
  if (!top) return done(null);

  const entries: Entry[] = [];
  for (const { slots, array } of top.itemLists) collectEntries(ctx, slots, null, array, entries);
  const { drafts, dropped } = entries.length ? identifyItems(ctx, entries) : { drafts: [], dropped: new Set<string>() };
  if (drafts.length === 0) {
    report(ctx, 'error', 'spec.no-nodes', 'The figure has no nodes; add a "nodes" list, e.g. "nodes": ["a", "b"].', {
      path: top.fields ? 'nodes' : '',
      range: nodeRange(ast),
    });
    return done(null);
  }

  const resolve = makeResolver(drafts, dropped);
  placeItems(ctx, entries, drafts, resolve);
  for (const draft of drafts) draft.model = draft.group ? buildGroup(ctx, draft, resolve) : buildNode(ctx, draft, resolve);
  const root = arrangeGroups(ctx, entries, drafts, top, ast);

  const items = new Map<string, ItemModel>();
  for (const draft of drafts) if (draft.model) items.set(draft.id, draft.model);

  return done({
    ...top.meta,
    root,
    items,
    edges: readEdges(ctx, drafts, top, resolve),
    legend: readLegend(ctx, top),
  });
}
