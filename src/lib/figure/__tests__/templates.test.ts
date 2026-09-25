import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { FIGURE_TEMPLATES, type FigureTemplate } from '../templates';
import type { FigureDiagnostic, FigureModel, JsonValue, ParseResult } from '../types';

/*
 * Templates are the figures people start from, so they are held to more than
 * "it parses": strict JSON, the documented vocabulary only, every id and edge
 * endpoint resolved, maths that KaTeX renders, and the structure of the paper
 * figure each one redraws. The spec reader and normaliser are checked too when
 * they are present; the full compile (layout, routing) lives in compile.test.ts.
 */

type JsonObject = { [key: string]: JsonValue };

type ParseModule = { parseFigureSource: (source: string) => ParseResult };
type NormalizeModule = {
  normalizeFigure: (parse: ParseResult) => { model: FigureModel | null; diagnostics: FigureDiagnostic[] };
};

// A glob import resolves to nothing while a sibling stage is missing, where a
// static import would fail the whole file.
const loadParse = import.meta.glob<ParseModule>('../parse.ts')['../parse.ts'];
const loadNormalize = import.meta.glob<NormalizeModule>('../normalize.ts')['../normalize.ts'];

const EXPECTED_IDS = [
  'sdpa',
  'mha',
  'transformer',
  'decoder-block',
  'mla',
  'moe',
  'rag',
  'agent-loop',
  'resnet-block',
  'autoencoder',
  'attention-masks',
  'vit',
  'method-pipeline',
];

/* ────────────────────────────────────────────────────────────────────────
 * The documented vocabulary (docs/figures.md)
 * ──────────────────────────────────────────────────────────────────────── */

const TOP_KEYS = new Set([
  'caption', 'label', 'title', 'alt', 'direction', 'layout', 'columns', 'gap', 'align', 'uniform', 'size',
  'font', 'palette', 'nodes', 'groups', 'edges', 'legend',
]);
const NODE_KEYS = new Set([
  'id', 'label', 'sublabel', 'role', 'shape', 'tone', 'border', 'pattern', 'bold', 'italic', 'stack', 'repeat',
  'badge', 'cells', 'values', 'mask', 'src', 'width', 'height', 'rank', 'beside', 'side', 'sameRank', 'to', 'parent',
]);
const GROUP_KEYS = new Set([
  'id', 'children', 'label', 'labelPosition', 'layout', 'direction', 'tone', 'border', 'filled', 'repeat', 'panel',
  'uniform', 'gap', 'align', 'columns', 'rank', 'beside', 'side', 'sameRank', 'parent',
]);
const EDGE_KEYS = new Set([
  'from', 'to', 'label', 'line', 'weight', 'arrow', 'route', 'kind', 'fromSide', 'toSide', 'tone', 'constraint',
]);
const LEGEND_KEYS = new Set(['label', 'tone', 'pattern', 'shape', 'border', 'line', 'weight', 'arrow', 'edge']);

/** Canonical role names only: templates teach the words, not the aliases. */
const ROLES = new Set([
  'input', 'output', 'embedding', 'attention', 'ffn', 'norm', 'linear', 'activation', 'conv', 'pool', 'op',
  'latent', 'cache', 'data', 'model', 'agent', 'tool', 'retriever', 'document', 'loss', 'router', 'expert',
  'decision', 'process', 'start', 'end', 'param', 'note',
]);
const SHAPES = new Set([
  'box', 'round', 'circle', 'op', 'diamond', 'funnel', 'expand', 'cylinder', 'document', 'parallelogram',
  'hexagon', 'text', 'tensor', 'image',
]);
const TONES = new Set(['neutral', 'gray', 'blue', 'orange', 'yellow', 'green', 'red', 'purple', 'pink', 'teal']);
const BORDERS = new Set(['solid', 'dashed', 'dotted', 'bold', 'none']);
const PATTERNS = new Set(['none', 'hatch', 'dots']);
const LINES = new Set(['solid', 'dashed', 'dotted']);
const WEIGHTS = new Set(['thin', 'normal', 'thick']);
const ARROWS = new Set(['end', 'start', 'both', 'none']);
const EDGE_KINDS = new Set(['flow', 'residual', 'skip', 'feedback']);
const SIDES = new Set(['top', 'bottom', 'left', 'right']);
const DIRECTIONS = new Set(['down', 'up', 'right', 'left']);
const LAYOUTS = new Set(['flow', 'row', 'column', 'grid']);
const ALIGNS = new Set(['start', 'center', 'end']);
const MASKS = new Set(['causal', 'lower', 'upper', 'diagonal', 'full', 'none']);
const BESIDE_SIDES = new Set(['left', 'right', 'above', 'below']);
const OP_GLYPH_LABELS = new Set([
  '+', '⊕', 'add', 'sum', '×', 'x', '*', '⊗', 'mul', '·', '⊙', 'dot', 'hadamard', '‖', '||', 'concat', 'cat',
  '-', '−', 'minus',
]);
/** Simple ids, so every endpoint resolves by id and never by label matching. */
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
const ROOT = '(root)';

/* ────────────────────────────────────────────────────────────────────────
 * Reading a spec
 * ──────────────────────────────────────────────────────────────────────── */

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function specOf(template: FigureTemplate): JsonObject {
  const value = JSON.parse(template.source) as JsonValue;
  if (!isObject(value)) throw new Error(`${template.id}: the spec is not an object`);
  return value;
}

type ItemInfo = { id: string; parent: string; kind: 'node' | 'group'; value: JsonObject; path: string };

function collectItems(spec: JsonObject): ItemInfo[] {
  const items: ItemInfo[] = [];
  const visit = (list: JsonValue | undefined, parent: string, path: string) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) throw new Error(`${path} is not an array`);
    list.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isObject(item)) throw new Error(`${itemPath}: templates declare every item as an object`);
      const kind = Array.isArray(item.children) ? 'group' : 'node';
      items.push({ id: String(item.id), parent, kind, value: item, path: itemPath });
      if (kind === 'group') visit(item.children, String(item.id), `${itemPath}.children`);
    });
  };
  visit(spec.nodes, ROOT, 'nodes');
  visit(spec.groups, ROOT, 'groups');
  return items;
}

function item(spec: JsonObject, id: string): JsonObject {
  const found = collectItems(spec).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no item "${id}"`);
  return found.value;
}

type EdgeInfo = {
  from: string;
  to: string;
  label: string | null;
  line: string;
  arrow: string;
  kind: string;
  toSide: string | null;
  fromSide: string | null;
  constraint: boolean;
};

/** Arrow tokens of the shorthand grammar, longest first, and what each one draws. */
const ARROW_TOKENS: ReadonlyArray<{ token: string; line: string; arrow: string; reversed?: boolean }> = [
  { token: '<-->', line: 'dashed', arrow: 'both' },
  { token: '<..>', line: 'dotted', arrow: 'both' },
  { token: '-.->', line: 'dotted', arrow: 'end' },
  { token: '...>', line: 'dotted', arrow: 'end' },
  { token: '<=>', line: 'solid', arrow: 'both' },
  { token: '<->', line: 'solid', arrow: 'both' },
  { token: '-->', line: 'dashed', arrow: 'end' },
  { token: '..>', line: 'dotted', arrow: 'end' },
  { token: '==>', line: 'solid', arrow: 'end' },
  { token: '<--', line: 'dashed', arrow: 'end', reversed: true },
  { token: '---', line: 'solid', arrow: 'none' },
  { token: '...', line: 'dotted', arrow: 'none' },
  { token: '=>', line: 'solid', arrow: 'end' },
  { token: '->', line: 'solid', arrow: 'end' },
  { token: '<-', line: 'solid', arrow: 'end', reversed: true },
  { token: '--', line: 'solid', arrow: 'none' },
  { token: '..', line: 'dotted', arrow: 'none' },
];

function endpointList(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim().replace(/\.(top|bottom|left|right|n|s|e|w)$/, ''))
    .filter(Boolean);
}

/** `a, b -> c --> d: label` → one edge per source × target per arrow, as the docs define it. */
function shorthandEdges(text: string): EdgeInfo[] {
  const colon = text.indexOf(': ');
  const body = colon >= 0 ? text.slice(0, colon) : text;
  const label = colon >= 0 ? text.slice(colon + 2).trim() : null;
  const groups: string[][] = [];
  const arrows: (typeof ARROW_TOKENS)[number][] = [];
  let current = '';
  for (let i = 0; i < body.length; ) {
    const arrow = ARROW_TOKENS.find((candidate) => body.startsWith(candidate.token, i));
    if (arrow) {
      groups.push(endpointList(current));
      arrows.push(arrow);
      current = '';
      i += arrow.token.length;
    } else {
      current += body[i];
      i += 1;
    }
  }
  groups.push(endpointList(current));
  if (arrows.length === 0) throw new Error(`"${text}" has no arrow`);
  const edges: EdgeInfo[] = [];
  arrows.forEach((arrow, index) => {
    const [sources, targets] = arrow.reversed ? [groups[index + 1], groups[index]] : [groups[index], groups[index + 1]];
    if (sources.length === 0 || targets.length === 0) throw new Error(`"${text}" has an empty endpoint`);
    for (const from of sources) {
      for (const to of targets) {
        edges.push({
          from,
          to,
          label,
          line: arrow.line,
          arrow: arrow.arrow,
          kind: 'flow',
          toSide: null,
          fromSide: null,
          constraint: true,
        });
      }
    }
  });
  return edges;
}

function asList(value: JsonValue | undefined): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.map(String);
  throw new Error(`bad endpoint ${JSON.stringify(value)}`);
}

function edgesOf(spec: JsonObject): EdgeInfo[] {
  const list = spec.edges ?? [];
  if (!Array.isArray(list)) throw new Error('edges is not an array');
  return list.flatMap((edge): EdgeInfo[] => {
    if (typeof edge === 'string') return shorthandEdges(edge);
    if (!isObject(edge)) throw new Error(`bad edge ${JSON.stringify(edge)}`);
    return asList(edge.from).flatMap((from) =>
      asList(edge.to).map((to) => ({
        from,
        to,
        label: typeof edge.label === 'string' ? edge.label : null,
        line: typeof edge.line === 'string' ? edge.line : 'solid',
        arrow: typeof edge.arrow === 'string' ? edge.arrow : 'end',
        kind: typeof edge.kind === 'string' ? edge.kind : 'flow',
        toSide: typeof edge.toSide === 'string' ? edge.toSide : null,
        fromSide: typeof edge.fromSide === 'string' ? edge.fromSide : null,
        constraint: edge.constraint !== false,
      })),
    );
  });
}

function hasEdge(spec: JsonObject, from: string, to: string): boolean {
  return edgesOf(spec).some((edge) => edge.from === from && edge.to === to);
}

/** Splits text into its `$…$` maths and the text around it; `\$` is a literal dollar. */
function splitMaths(text: string): { math: string[]; plain: string[]; balanced: boolean } {
  const math: string[] = [];
  const plain: string[] = [];
  let inMath = false;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\' && text[i + 1] === '$') {
      current += '$';
      i += 1;
    } else if (text[i] === '$') {
      (inMath ? math : plain).push(current);
      current = '';
      inMath = !inMath;
    } else {
      current += text[i];
    }
  }
  (inMath ? math : plain).push(current);
  return { math, plain, balanced: !inMath };
}

/** Every text an author reads in the figure or its caption, with where it came from. */
function readableStrings(spec: JsonObject): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [];
  const add = (where: string, value: JsonValue | undefined) => {
    if (typeof value === 'string') out.push({ where, text: value });
  };
  add('caption', spec.caption);
  for (const info of collectItems(spec)) {
    for (const key of ['label', 'sublabel', 'repeat', 'badge', 'panel']) add(`${info.path}.${key}`, info.value[key]);
  }
  (Array.isArray(spec.edges) ? spec.edges : []).forEach((edge, index) => {
    if (typeof edge === 'string') {
      const colon = edge.indexOf(': ');
      if (colon >= 0) out.push({ where: `edges[${index}]`, text: edge.slice(colon + 2) });
    } else if (isObject(edge)) {
      add(`edges[${index}].label`, edge.label);
    }
  });
  (Array.isArray(spec.legend) ? spec.legend : []).forEach((entry, index) => {
    if (isObject(entry)) add(`legend[${index}].label`, entry.label);
  });
  return out;
}

/** Bracket depth at the start of each line, ignoring brackets inside strings. */
function lineDepths(source: string): number[] {
  const depths: number[] = [];
  let depth = 0;
  let inString = false;
  for (const line of source.split('\n')) {
    depths.push(depth);
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (inString) {
        if (char === '\\') i += 1;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') depth -= 1;
    }
  }
  return depths;
}

/* ────────────────────────────────────────────────────────────────────────
 * The list
 * ──────────────────────────────────────────────────────────────────────── */

describe('FIGURE_TEMPLATES', () => {
  it('lists the canonical figures in menu order', () => {
    expect(FIGURE_TEMPLATES.map((template) => template.id)).toEqual(EXPECTED_IDS);
  });

  it('gives every template a unique kebab-case id, a menu label, a one-line description and a category', () => {
    for (const template of FIGURE_TEMPLATES) {
      expect(template.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(template.label.trim()).toBe(template.label);
      expect(template.label.length).toBeGreaterThan(3);
      expect(template.label.length).toBeLessThanOrEqual(40);
      expect(template.description).toMatch(/^\S.*\.$/);
      expect(template.description.length).toBeLessThanOrEqual(110);
      expect(template.description).not.toContain('\n');
      expect(['architecture', 'mechanism', 'pipeline', 'layout']).toContain(template.category);
    }
    expect(new Set(FIGURE_TEMPLATES.map((template) => template.label)).size).toBe(FIGURE_TEMPLATES.length);
  });

  it('covers every category', () => {
    const categories = new Set(FIGURE_TEMPLATES.map((template) => template.category));
    expect([...categories].sort()).toEqual(['architecture', 'layout', 'mechanism', 'pipeline']);
  });

  it('is frozen, so no editor can change what another one inserts', () => {
    expect(Object.isFrozen(FIGURE_TEMPLATES)).toBe(true);
    for (const template of FIGURE_TEMPLATES) expect(Object.isFrozen(template)).toBe(true);
  });

  it('gives every figure its own cross-reference key', () => {
    const keys = FIGURE_TEMPLATES.map((template) => specOf(template).label);
    for (const key of keys) expect(key).toMatch(/^fig:[a-z]+(-[a-z]+)*$/);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Every template, the same checks
 * ──────────────────────────────────────────────────────────────────────── */

describe.each(FIGURE_TEMPLATES.map((template) => [template.id, template] as const))('%s', (_id, template) => {
  it('is strict JSON, pretty-printed with two spaces', () => {
    expect(() => JSON.parse(template.source)).not.toThrow();
    const source = template.source;
    expect(source.trim()).toBe(source);
    expect(source.startsWith('{\n')).toBe(true);
    expect(source).not.toMatch(/[\t\r]/);
    const lines = source.split('\n');
    const depths = lineDepths(source);
    lines.forEach((line, index) => {
      expect(line, `line ${index + 1} has trailing whitespace`).toBe(line.trimEnd());
      const indent = line.length - line.trimStart().length;
      const closes = /^[}\]]/.test(line.trimStart()) ? 1 : 0;
      expect(indent, `line ${index + 1}: ${line.trim()}`).toBe(2 * (depths[index] - closes));
    });
  });

  it('declares a caption and uses only documented top-level keys', () => {
    const spec = specOf(template);
    expect(typeof spec.caption).toBe('string');
    expect(String(spec.caption).length).toBeGreaterThan(20);
    for (const key of Object.keys(spec)) expect(TOP_KEYS, `top-level "${key}"`).toContain(key);
    if (spec.direction !== undefined) expect(DIRECTIONS).toContain(spec.direction);
    if (spec.layout !== undefined) expect(LAYOUTS).toContain(spec.layout);
    if (spec.align !== undefined) expect(ALIGNS).toContain(spec.align);
    if (spec.gap !== undefined) expect(spec.gap).toBeGreaterThan(0);
    expect(Array.isArray(spec.nodes) && spec.nodes.length > 0).toBe(true);
  });

  it('gives every item a unique simple id and uses only documented keys and values', () => {
    const spec = specOf(template);
    const items = collectItems(spec);
    const ids = items.map((info) => info.id);
    expect(new Set(ids).size, `duplicate ids in ${ids.join(', ')}`).toBe(ids.length);
    for (const info of items) {
      const where = `${info.path} (${info.id})`;
      const value = info.value;
      expect(info.id, where).toMatch(ID_PATTERN);
      for (const key of Object.keys(value)) {
        expect(info.kind === 'group' ? GROUP_KEYS : NODE_KEYS, `${where}: key "${key}"`).toContain(key);
      }
      if (value.role !== undefined) expect(ROLES, where).toContain(value.role);
      if (value.shape !== undefined) expect(SHAPES, where).toContain(value.shape);
      if (value.tone !== undefined) expect(TONES, where).toContain(value.tone);
      if (value.border !== undefined) expect(BORDERS, where).toContain(value.border);
      if (value.pattern !== undefined) expect(PATTERNS, where).toContain(value.pattern);
      if (value.layout !== undefined) expect(LAYOUTS, where).toContain(value.layout);
      if (value.direction !== undefined) expect(DIRECTIONS, where).toContain(value.direction);
      if (value.align !== undefined) expect(ALIGNS, where).toContain(value.align);
      if (value.rank !== undefined) {
        expect(Number.isInteger(value.rank) && Number(value.rank) >= 0, where).toBe(true);
      }
      if (value.stack !== undefined) {
        expect(Number.isInteger(value.stack) && Number(value.stack) >= 2 && Number(value.stack) <= 8, where).toBe(true);
      }
      if (info.kind === 'group') {
        expect((value.children as JsonValue[]).length, `${where} has children`).toBeGreaterThan(0);
        if (value.panel !== undefined) expect(['boolean', 'string'], where).toContain(typeof value.panel);
      } else {
        expect(typeof value.label, `${where} has a label`).toBe('string');
        expect(String(value.label).trim(), where).not.toBe('');
      }
    }
  });

  it('draws operator nodes as glyphs and fills in every tensor', () => {
    for (const info of collectItems(specOf(template))) {
      const value = info.value;
      const where = `${info.path} (${info.id})`;
      if (value.role === 'op' || value.shape === 'op') expect(OP_GLYPH_LABELS, where).toContain(value.label);
      // A bare `+` that is not declared as an operator would draw as a box.
      if (typeof value.label === 'string' && OP_GLYPH_LABELS.has(value.label) && value.label.length === 1) {
        expect(value.role === 'op' || value.shape === 'op', `${where} should be an op`).toBe(true);
      }
      const tensorOnly = ['cells', 'values', 'mask'].filter((key) => value[key] !== undefined);
      if (value.shape !== 'tensor') {
        expect(tensorOnly, `${where}: tensor keys on a ${String(value.shape ?? value.role)}`).toEqual([]);
        continue;
      }
      const cells = value.cells;
      expect(cells, `${where} declares its cells`).toBeDefined();
      let rows: number;
      let cols: number;
      if (typeof cells === 'number') {
        [rows, cols] = [1, cells];
      } else if (Array.isArray(cells) && cells.every((cell) => typeof cell === 'number')) {
        [rows, cols] = cells as number[];
      } else if (Array.isArray(cells) && cells.every((cell) => typeof cell === 'string')) {
        [rows, cols] = [1, cells.length];
      } else {
        const grid = cells as string[][];
        rows = grid.length;
        cols = grid[0].length;
        for (const row of grid) {
          expect(row.length, `${where}: ragged text grid`).toBe(cols);
          for (const cell of row) expect(typeof cell).toBe('string');
        }
      }
      expect(Number.isInteger(rows) && Number.isInteger(cols) && rows >= 1 && cols >= 1, where).toBe(true);
      expect(rows * cols, where).toBeLessThanOrEqual(1024);
      if (value.mask !== undefined) expect(MASKS, where).toContain(value.mask);
      if (value.values !== undefined) {
        const grid = value.values as number[][];
        expect(grid.length, `${where}: value rows`).toBe(rows);
        for (const row of grid) {
          expect(row.length, `${where}: value columns`).toBe(cols);
          for (const cell of row) expect(cell >= 0 && cell <= 1, `${where}: value ${cell}`).toBe(true);
        }
      }
    }
  });

  it('places side inputs and same-layer hints next to real siblings', () => {
    const items = collectItems(specOf(template));
    for (const info of items) {
      for (const key of ['beside', 'sameRank']) {
        const target = info.value[key];
        if (target === undefined) continue;
        const sibling = items.find((candidate) => candidate.id === target);
        expect(sibling, `${info.id}.${key} → ${String(target)}`).toBeDefined();
        expect(sibling?.parent, `${info.id}.${key} → ${String(target)} is a sibling`).toBe(info.parent);
        expect(target).not.toBe(info.id);
      }
      if (info.value.side !== undefined) {
        expect(info.value.beside, `${info.id}.side needs beside`).toBeDefined();
        expect(BESIDE_SIDES).toContain(info.value.side);
      }
    }
  });

  it('connects existing items only, through documented edge keys', () => {
    const spec = specOf(template);
    const ids = new Set(collectItems(spec).map((info) => info.id));
    for (const edge of Array.isArray(spec.edges) ? spec.edges : []) {
      if (typeof edge === 'string') continue;
      expect(isObject(edge)).toBe(true);
      for (const key of Object.keys(edge as JsonObject)) expect(EDGE_KEYS, `edge key "${key}"`).toContain(key);
      const { weight } = edge as JsonObject;
      if (weight !== undefined) expect(WEIGHTS).toContain(weight);
    }
    const edges = edgesOf(spec);
    // Only a multi-panel layout may be a figure without arrows.
    if (template.category !== 'layout') expect(edges.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const edge of edges) {
      const name = `${edge.from} -> ${edge.to}`;
      expect(ids, `${name}: unknown source`).toContain(edge.from);
      expect(ids, `${name}: unknown target`).toContain(edge.to);
      expect(edge.from, `${name} is a self-loop`).not.toBe(edge.to);
      expect(seen.has(name), `${name} is declared twice`).toBe(false);
      seen.add(name);
      expect(LINES, name).toContain(edge.line);
      expect(ARROWS, name).toContain(edge.arrow);
      expect(EDGE_KINDS, name).toContain(edge.kind);
      if (edge.toSide !== null) expect(SIDES, name).toContain(edge.toSide);
      if (edge.fromSide !== null) expect(SIDES, name).toContain(edge.fromSide);
    }
  });

  it('leaves no node unconnected', () => {
    const spec = specOf(template);
    const touched = new Set(edgesOf(spec).flatMap((edge) => [edge.from, edge.to]));
    const items = collectItems(spec);
    const parentOf = new Map(items.map((info) => [info.id, info.parent]));
    for (const info of items) {
      if (info.kind === 'group') continue;
      // A panel's lone tensor is the figure itself, not a step in a flow.
      if (items.find((candidate) => candidate.id === info.parent)?.value.panel !== undefined) continue;
      // A node inside a group that edges attach to (the agent's tools) is connected through it.
      let connected = false;
      for (let id: string | undefined = info.id; id && id !== ROOT; id = parentOf.get(id)) {
        if (touched.has(id)) connected = true;
      }
      expect(connected, `${info.id} has no edge`).toBe(true);
    }
  });

  it('keeps legends to documented entries', () => {
    const spec = specOf(template);
    if (spec.legend === undefined) return;
    expect(Array.isArray(spec.legend)).toBe(true);
    for (const entry of spec.legend as JsonValue[]) {
      expect(isObject(entry)).toBe(true);
      const value = entry as JsonObject;
      for (const key of Object.keys(value)) expect(LEGEND_KEYS, `legend key "${key}"`).toContain(key);
      expect(typeof value.label).toBe('string');
      if (value.tone !== undefined) expect(TONES).toContain(value.tone);
      if (value.pattern !== undefined) expect(PATTERNS).toContain(value.pattern);
      if (value.line !== undefined) expect(LINES).toContain(value.line);
      if (value.weight !== undefined) expect(WEIGHTS).toContain(value.weight);
    }
  });

  it('writes maths that KaTeX renders, and keeps LaTeX inside $…$', () => {
    for (const { where, text } of readableStrings(specOf(template))) {
      const { math, plain, balanced } = splitMaths(text);
      expect(balanced, `${where}: unbalanced $ in ${text}`).toBe(true);
      // A single backslash before t, n, r, b or f would have become a control
      // character in strict JSON; a stray one outside maths prints as-is.
      for (const part of plain) expect(part, `${where}: backslash outside maths`).not.toContain('\\');
      const control = [...text].find((char) => char.charCodeAt(0) < 0x20 && char !== '\n');
      expect(control, `${where}: control character`).toBeUndefined();
      for (const latex of math) {
        expect(latex.trim(), `${where}: empty maths`).not.toBe('');
        expect(latex, `${where}: line break inside maths`).not.toContain('\n');
        expect(
          () => katex.renderToString(latex, { displayMode: false, throwOnError: true, strict: 'error', trust: false }),
          `${where}: ${latex}`,
        ).not.toThrow();
      }
    }
  });

  it('reads the same through the lenient spec reader, without a single note', async () => {
    if (!loadParse) return;
    const { parseFigureSource } = await loadParse();
    const parsed = parseFigureSource(template.source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.value).toEqual(JSON.parse(template.source));
  });

  it('normalises without a warning, keeping every item and edge', async () => {
    if (!loadParse || !loadNormalize) return;
    const [{ parseFigureSource }, { normalizeFigure }] = await Promise.all([loadParse(), loadNormalize()]);
    const { model, diagnostics } = normalizeFigure(parseFigureSource(template.source));
    expect(diagnostics.filter((diagnostic) => diagnostic.severity !== 'info')).toEqual([]);
    expect(model).not.toBeNull();
    if (!model) return;
    const spec = specOf(template);
    expect(model.caption).toBe(spec.caption);
    expect([...model.items.keys()].sort()).toEqual(collectItems(spec).map((info) => info.id).sort());
    for (const info of collectItems(spec)) {
      const parent = info.parent === ROOT ? model.root.id : info.parent;
      expect(model.items.get(info.id)?.parent, `${info.id}'s parent`).toBe(parent);
    }
    const pairs = (list: Array<{ from: string; to: string }>) => list.map((edge) => `${edge.from} -> ${edge.to}`).sort();
    expect(pairs(model.edges)).toEqual(pairs(edgesOf(spec)));
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Faithful to the paper figure
 * ──────────────────────────────────────────────────────────────────────── */

function templateSpec(id: string): JsonObject {
  const template = FIGURE_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`no template "${id}"`);
  return specOf(template);
}

function chainLabels(spec: JsonObject, ids: string[]): string[] {
  for (let i = 1; i < ids.length; i += 1) expect(hasEdge(spec, ids[i - 1], ids[i]), `${ids[i - 1]} -> ${ids[i]}`).toBe(true);
  return ids.map((id) => String(item(spec, id).label));
}

describe('paper fidelity', () => {
  it('sdpa: Q and K meet in MatMul, then Scale, an optional (dashed) Mask, SoftMax and MatMul with V', () => {
    const spec = templateSpec('sdpa');
    expect(spec.direction).toBe('up');
    expect(spec.uniform).toBe(true);
    expect(chainLabels(spec, ['matmul1', 'scale', 'mask', 'softmax', 'matmul2'])).toEqual([
      'MatMul',
      'Scale',
      'Mask (opt.)',
      'SoftMax',
      'MatMul',
    ]);
    expect(item(spec, 'mask').border).toBe('dashed');
    expect(hasEdge(spec, 'q', 'matmul1') && hasEdge(spec, 'k', 'matmul1') && hasEdge(spec, 'v', 'matmul2')).toBe(true);
    expect(hasEdge(spec, 'v', 'matmul1')).toBe(false);
    expect(String(spec.caption)).toContain('\\sqrt{d_k}');
  });

  it('mha: V, K, Q through stacked Linear layers into h stacked attention heads, Concat and Linear', () => {
    const spec = templateSpec('mha');
    const inputs = collectItems(spec).filter((info) => info.value.role === 'input').map((info) => info.value.label);
    expect(inputs).toEqual(['V', 'K', 'Q']);
    for (const id of ['linv', 'link', 'linq']) {
      expect(item(spec, id)).toMatchObject({ label: 'Linear', role: 'linear', stack: 3 });
      expect(hasEdge(spec, id, 'sdpa')).toBe(true);
    }
    expect(item(spec, 'sdpa')).toMatchObject({ stack: 3, repeat: 'h', role: 'attention' });
    expect(chainLabels(spec, ['sdpa', 'concat', 'out']).slice(1)).toEqual(['Concat', 'Linear']);
  });

  it('transformer: N× encoder and decoder stacks with Add & Norm residuals and positional encodings', () => {
    const spec = templateSpec('transformer');
    const children = (id: string) => (item(spec, id).children as JsonObject[]).map((child) => child.label);
    expect(children('encoder')).toEqual(['Multi-Head\nAttention', 'Add & Norm', 'Feed\nForward', 'Add & Norm']);
    expect(children('decoder')).toEqual([
      'Masked\nMulti-Head\nAttention',
      'Add & Norm',
      'Multi-Head\nAttention',
      'Add & Norm',
      'Feed\nForward',
      'Add & Norm',
    ]);
    for (const id of ['encoder', 'decoder']) expect(item(spec, id)).toMatchObject({ repeat: 'N×', uniform: true });
    // One residual around every sub-layer, each ending in its Add & Norm.
    const residuals = edgesOf(spec).filter((edge) => edge.kind === 'residual');
    expect(residuals.map((edge) => edge.to).sort()).toEqual(
      ['decNorm1', 'decNorm2', 'decNorm3', 'encNorm1', 'encNorm2'].sort(),
    );
    // Positional encodings sit beside the ⊕ on the outer side of each stack.
    expect(item(spec, 'inPos')).toMatchObject({ beside: 'inAdd', side: 'left' });
    expect(item(spec, 'outPos')).toMatchObject({ beside: 'outAdd' });
    expect(item(spec, 'outPos').side).toBeUndefined();
    // The encoder feeds the decoder's second attention, which also takes the decoder's own queries.
    expect(hasEdge(spec, 'encNorm2', 'decCross') && hasEdge(spec, 'decNorm1', 'decCross')).toBe(true);
    expect(chainLabels(spec, ['decNorm3', 'linear', 'softmax', 'probs']).slice(1)).toEqual([
      'Linear',
      'Softmax',
      'Output\nProbabilities',
    ]);
    expect(item(spec, 'outputs').label).toBe('Outputs (shifted right)');
  });

  it('decoder-block: pre-norm, so each residual branches before its RMSNorm and joins at ⊕', () => {
    const spec = templateSpec('decoder-block');
    chainLabels(spec, ['embed', 'norm1', 'attn', 'add1', 'norm2', 'ffn', 'add2', 'finalNorm']);
    const residuals = edgesOf(spec).filter((edge) => edge.kind === 'residual');
    expect(residuals.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual(['embed -> add1', 'add1 -> add2']);
    expect(item(spec, 'norm1').label).toBe('RMSNorm');
    expect(item(spec, 'ffn').label).toContain('SwiGLU');
    expect(item(spec, 'block')).toMatchObject({ repeat: 'N×', uniform: true });
  });

  it('mla: only the KV latent and the decoupled RoPE key are cached (hatched), as the legend says', () => {
    const spec = templateSpec('mla');
    const hatched = collectItems(spec).filter((info) => info.value.pattern === 'hatch').map((info) => info.id);
    expect(hatched.sort()).toEqual(['ckv', 'kr']);
    expect(spec.legend).toEqual([{ label: 'Cached during inference', tone: 'neutral', pattern: 'hatch' }]);
    const labelOf = (from: string, to: string) => edgesOf(spec).find((edge) => edge.from === from && edge.to === to)?.label;
    expect(labelOf('h', 'ckv')).toBe('$W^{DKV}$');
    expect(labelOf('ckv', 'kc')).toBe('$W^{UK}$');
    expect(labelOf('ckv', 'vc')).toBe('$W^{UV}$');
    expect(labelOf('h', 'cq')).toBe('$W^{DQ}$');
    expect(labelOf('cq', 'qc')).toBe('$W^{UQ}$');
    expect(labelOf('cq', 'qr')).toContain('RoPE');
    expect(labelOf('h', 'kr')).toContain('RoPE');
    // [q^C; q^R] and [k^C; k^R] are concatenations of exactly those parts.
    expect(hasEdge(spec, 'qc', 'q') && hasEdge(spec, 'qr', 'q')).toBe(true);
    expect(hasEdge(spec, 'kc', 'k') && hasEdge(spec, 'kr', 'k')).toBe(true);
    expect(edgesOf(spec).filter((edge) => edge.to === 'attn').map((edge) => edge.from)).toEqual(['q', 'k', 'vc']);
    // The shared RoPE key comes straight from h_t, not from the latent.
    expect(hasEdge(spec, 'ckv', 'kr')).toBe(false);
    expect(item(spec, 'ckv').label).toContain('\\mathbf{c}_t^{KV}');
  });

  it('moe: shared experts beside top-K routed experts, gated into ⊕ with the residual', () => {
    const spec = templateSpec('moe');
    expect(item(spec, 'shared')).toMatchObject({ role: 'expert', tone: 'green' });
    expect(item(spec, 'routed')).toMatchObject({ role: 'expert' });
    expect(Number(item(spec, 'routed').stack)).toBeGreaterThan(Number(item(spec, 'shared').stack));
    const routerEdge = edgesOf(spec).find((edge) => edge.from === 'router' && edge.to === 'routed');
    expect(routerEdge?.label).toContain('K_r');
    expect(edgesOf(spec).find((edge) => edge.from === 'u' && edge.to === 'sum')).toMatchObject({ kind: 'residual', toSide: 'bottom' });
    expect(hasEdge(spec, 'shared', 'sum') && hasEdge(spec, 'routed', 'sum') && hasEdge(spec, 'sum', 'out')).toBe(true);
    expect((spec.legend as JsonObject[]).map((entry) => entry.tone)).toEqual(['green', 'blue']);
  });

  it('rag: MIPS searches the document index beside it, and the generator also sees the query', () => {
    const spec = templateSpec('rag');
    expect(spec.direction).toBe('right');
    expect(item(spec, 'index')).toMatchObject({ role: 'data', beside: 'mips' });
    expect(hasEdge(spec, 'index', 'mips') && hasEdge(spec, 'encoder', 'mips') && hasEdge(spec, 'mips', 'generator')).toBe(true);
    expect(edgesOf(spec).find((edge) => edge.from === 'query' && edge.to === 'generator')?.kind).toBe('skip');
  });

  it('agent-loop: tool observations loop back to the agent against the flow', () => {
    const spec = templateSpec('agent-loop');
    const feedback = edgesOf(spec).filter((edge) => edge.kind === 'feedback');
    expect(feedback.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual(['tools -> agent']);
    // Out of the tools' top into the agent's bottom: the return half of the action arrow.
    expect(feedback[0]).toMatchObject({ fromSide: 'top', toSide: 'bottom', label: 'observation' });
    expect(hasEdge(spec, 'agent', 'tools')).toBe(true);
    const tools = item(spec, 'tools').children as JsonObject[];
    expect(tools.length).toBeGreaterThanOrEqual(3);
    for (const tool of tools) expect(tool.role).toBe('tool');
    expect(edgesOf(spec).find((edge) => edge.from === 'agent' && edge.to === 'memory')?.arrow).toBe('both');
  });

  it('resnet-block: two weight layers and an identity shortcut on the right into ⊕', () => {
    const spec = templateSpec('resnet-block');
    expect(chainLabels(spec, ['x', 'layer1', 'layer2', 'add'])).toEqual(['$\\mathbf{x}$', 'weight layer', 'weight layer', '+']);
    const shortcut = edgesOf(spec).find((edge) => edge.from === 'x' && edge.to === 'add');
    expect(shortcut).toMatchObject({ kind: 'residual', toSide: 'right' });
    expect(shortcut?.label).toContain('identity');
    expect(edgesOf(spec).find((edge) => edge.from === 'layer1' && edge.to === 'layer2')?.label).toBe('relu');
  });

  it('autoencoder: a funnel narrows to the code and an expand widens back out, left to right', () => {
    const spec = templateSpec('autoencoder');
    expect(spec.direction).toBe('right');
    chainLabels(spec, ['x', 'encoder', 'z', 'decoder', 'xhat']);
    expect(item(spec, 'encoder').shape).toBe('funnel');
    expect(item(spec, 'decoder').shape).toBe('expand');
    const rows = (id: string) => (item(spec, id).cells as number[])[0];
    expect(rows('z')).toBeLessThan(rows('x'));
    expect(rows('xhat')).toBe(rows('x'));
    // The loss compares input and reconstruction; both inputs are dashed (training only).
    expect(edgesOf(spec).find((edge) => edge.from === 'xhat' && edge.to === 'loss')).toMatchObject({ line: 'dashed' });
    expect(edgesOf(spec).find((edge) => edge.from === 'x' && edge.to === 'loss')).toMatchObject({ kind: 'skip', line: 'dashed' });
    expect(item(spec, 'loss').role).toBe('loss');
    expect(spec.legend).toEqual([{ label: 'Training only', line: 'dashed' }]);
  });

  it('attention-masks: three 8×8 panels — full, causal and a causal band of width 3', () => {
    const spec = templateSpec('attention-masks');
    expect(spec.layout).toBe('row');
    const panels = (spec.nodes as JsonObject[]).map((panel) => {
      expect(panel.panel).toBe(true);
      const [grid] = panel.children as JsonObject[];
      expect(grid).toMatchObject({ shape: 'tensor', cells: [8, 8] });
      return grid;
    });
    expect(panels.map((grid) => grid.mask ?? null)).toEqual(['full', 'causal', null]);
    const window = 3;
    const expected = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => (j <= i && j > i - window ? 1 : 0)));
    expect(panels[2].values).toEqual(expected);
  });

  it('vit: one token per patch plus the [class] token, into an L× pre-norm encoder and an MLP head', () => {
    const spec = templateSpec('vit');
    const image = item(spec, 'image').cells as string[][];
    const patches = item(spec, 'patches').cells as string[];
    const tokens = item(spec, 'tokens').cells as string[];
    expect(patches).toEqual(image.flat());
    expect(tokens).toEqual(['0*', ...patches]);
    expect(item(spec, 'cls')).toMatchObject({ beside: 'tokens', role: 'embedding' });
    chainLabels(spec, ['image', 'patches', 'projection', 'tokens', 'norm1', 'attn', 'add1', 'norm2', 'mlp', 'add2', 'head', 'class']);
    expect(item(spec, 'encoder')).toMatchObject({ repeat: 'L×', uniform: true });
    const residuals = edgesOf(spec).filter((edge) => edge.kind === 'residual');
    expect(residuals.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual(['tokens -> add1', 'add1 -> add2']);
  });

  it('method-pipeline: the ablation branch is dashed end to end and explained in the legend', () => {
    const spec = templateSpec('method-pipeline');
    const edges = edgesOf(spec);
    const ablation = edges.filter((edge) => edge.from === 'ablations' || edge.to === 'ablations');
    expect(ablation.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual(['preprocess -> ablations', 'ablations -> evaluation']);
    for (const edge of ablation) expect(edge.line).toBe('dashed');
    for (const edge of edges.filter((candidate) => !ablation.includes(candidate))) expect(edge.line).toBe('solid');
    expect(item(spec, 'ablations').border).toBe('dashed');
    expect(spec.legend).toEqual([{ label: 'Ablation branch', line: 'dashed' }]);
  });
});
