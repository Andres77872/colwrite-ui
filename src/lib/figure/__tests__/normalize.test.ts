import { describe, expect, it } from 'vitest';
import { MAX_FIGURE_EDGES, MAX_FIGURE_ITEMS, MAX_LABEL_CHARS, MAX_TENSOR_CELLS } from '../constants';
import { labelText } from '../labels';
import { normalizeFigure, parseEdgeShorthand, type ShorthandEdge } from '../normalize';
import { parseFigureSource } from '../parse';
import { ROOT_ID } from '../types';
import type { EdgeModel, FigureDiagnostic, FigureModel, GroupModel, NodeModel } from '../types';

/* ─── Helpers ─── */

type Result = { model: FigureModel | null; diagnostics: FigureDiagnostic[]; source: string };

/** Normalises a spec given as a value (pretty-printed) or as source text. */
function run(spec: unknown, options: { withSource?: boolean } = {}): Result {
  const source = typeof spec === 'string' ? spec : JSON.stringify(spec, null, 2);
  const parse = parseFigureSource(source);
  expect(parse.ast, 'the test spec must parse').not.toBeNull();
  const result = normalizeFigure(parse, options.withSource === false ? undefined : source);
  return { ...result, source };
}

function model(result: Result): FigureModel {
  expect(result.model, JSON.stringify(result.diagnostics, null, 2)).not.toBeNull();
  return result.model!;
}

function node(m: FigureModel, id: string): NodeModel & { repeat?: string | null } {
  const item = m.items.get(id);
  if (item?.kind !== 'node') throw new Error(`No node "${id}" in [${[...m.items.keys()].join(', ')}]`);
  return item;
}

function group(m: FigureModel, id: string): GroupModel {
  if (id === ROOT_ID) return m.root;
  const item = m.items.get(id);
  if (item?.kind !== 'group') throw new Error(`No group "${id}" in [${[...m.items.keys()].join(', ')}]`);
  return item;
}

const codes = (result: Result) => result.diagnostics.map((d) => d.code);
const find = (result: Result, code: string) => result.diagnostics.filter((d) => d.code === code);
const one = (result: Result, code: string): FigureDiagnostic => {
  const found = find(result, code);
  expect(found, `${code} in ${JSON.stringify(codes(result))}`).toHaveLength(1);
  return found[0];
};
const clean = (result: Result) =>
  expect(result.diagnostics.filter((d) => d.severity !== 'info'), JSON.stringify(result.diagnostics, null, 2)).toEqual([]);
const text = (label: { lines: unknown[] } | null) => (label ? labelText(label as never) : null);
const pairs = (m: FigureModel) => m.edges.map((e) => `${e.from}->${e.to}`);
const edge = (m: FigureModel, from: string, to: string): EdgeModel => {
  const found = m.edges.find((e) => e.from === from && e.to === to);
  if (!found) throw new Error(`No edge ${from} -> ${to} in ${pairs(m).join(', ')}`);
  return found;
};
/** The source text a diagnostic's range covers. */
const covered = (result: Result, diagnostic: FigureDiagnostic) =>
  diagnostic.range ? result.source.slice(diagnostic.range[0], diagnostic.range[1]) : null;

/* ─── The top level ─── */

describe('normalizeFigure: top level', () => {
  it('returns no model and no diagnostics when the source did not parse', () => {
    expect(normalizeFigure({ ast: null, value: null, diagnostics: [] })).toEqual({ model: null, diagnostics: [] });
  });

  it('reads a minimal spec with every default', () => {
    const result = run({ nodes: ['a', 'b'], edges: ['a -> b'] });
    clean(result);
    const m = model(result);
    expect(m).toMatchObject({ title: null, caption: null, label: null, alt: null, size: 'auto', font: 'sans', palette: 'color' });
    expect(m.root).toMatchObject({
      id: ROOT_ID,
      kind: 'group',
      children: ['a', 'b'],
      layout: 'flow',
      direction: 'down',
      columns: 2,
      align: 'center',
      gap: null,
      border: 'none',
      filled: false,
      uniform: false,
      label: null,
    });
    expect(node(m, 'a')).toMatchObject({
      kind: 'node',
      parent: ROOT_ID,
      order: 0,
      path: 'nodes[0]',
      shape: 'box',
      tone: 'neutral',
      border: 'solid',
      pattern: 'none',
      op: null,
      bold: false,
      italic: false,
      stack: 1,
      repeat: null,
      badge: null,
      cells: null,
      src: null,
      width: null,
      height: null,
      rank: null,
      beside: null,
      sameRank: null,
      sublabel: null,
    });
    expect(text(node(m, 'a').label)).toBe('a');
    expect(node(m, 'b').order).toBe(1);
    expect(m.edges).toEqual([
      expect.objectContaining({
        id: 'e1',
        from: 'a',
        to: 'b',
        line: 'solid',
        weight: 'normal',
        arrow: 'end',
        route: 'ortho',
        kind: 'flow',
        constraint: true,
        tone: null,
        label: null,
        fromSide: null,
        toSide: null,
        order: 0,
        path: 'edges[0]',
      }),
    ]);
    expect(m.legend).toEqual([]);
  });

  it('reads a bare list as the nodes, with a note', () => {
    const result = run(['a', { id: 'b', label: 'B' }]);
    const m = model(result);
    expect(m.root.children).toEqual(['a', 'b']);
    expect(node(m, 'b').path).toBe('[1]');
    expect(one(result, 'spec.bare-array').severity).toBe('info');
  });

  it('rejects a spec that is not an object', () => {
    for (const spec of ['"a -> b"', '42', 'true', 'null']) {
      const result = run(spec);
      expect(result.model).toBeNull();
      expect(one(result, 'spec.not-object').severity).toBe('error');
    }
  });

  it('rejects a spec without nodes', () => {
    for (const spec of [{}, { nodes: [] }, { nodes: {} }, { edges: ['a -> b'] }, { nodes: [], groups: [] }]) {
      const result = run(spec);
      expect(result.model).toBeNull();
      expect(one(result, 'spec.no-nodes').severity).toBe('error');
    }
  });

  it('rejects a spec whose nodes are all unusable', () => {
    const result = run({ nodes: [true, null, ''] });
    expect(result.model).toBeNull();
    expect(codes(result)).toEqual(['spec.no-nodes', 'item.invalid', 'item.invalid', 'item.invalid']);
  });

  it('draws a spec with only groups', () => {
    const m = model(run({ groups: [{ id: 'g', children: ['x'] }] }));
    expect(group(m, 'g').children).toEqual(['x']);
    expect(m.root.children).toEqual(['g']);
  });

  it('reads captions and metadata, trimmed', () => {
    const m = model(
      run({ caption: '  Multi-head latent attention. ', label: 'fig:mla', title: 'MLA', alt: 'A diagram', nodes: ['a'] }),
    );
    expect(m).toMatchObject({ caption: 'Multi-head latent attention.', label: 'fig:mla', title: 'MLA', alt: 'A diagram' });
    expect(model(run({ caption: '   ', nodes: ['a'] })).caption).toBeNull();
  });

  it('warns about a caption that is not text', () => {
    const result = run({ caption: ['a'], nodes: ['a'] });
    expect(model(result).caption).toBeNull();
    expect(one(result, 'spec.invalid-value').path).toBe('caption');
  });

  it.each([
    ['auto', 'auto'], ['column', 'auto'], ['small', 'small'], ['half', 'small'], ['medium', 'medium'],
    ['large', 'large'], ['full', 'full'], ['wide', 'full'], ['page', 'full'], ['double', 'full'], ['FULL', 'full'],
  ])('size %s → %s', (size, expected) => {
    const result = run({ size, nodes: ['a'] });
    clean(result);
    expect(model(result).size).toBe(expected);
  });

  it.each([
    ['sans', 'sans'], ['sans-serif', 'sans'], ['Helvetica', 'sans'], ['arial', 'sans'],
    ['serif', 'serif'], ['times', 'serif'], ['roman', 'serif'], ['cm', 'serif'],
  ])('font %s → %s', (font, expected) => {
    expect(model(run({ font, nodes: ['a'] })).font).toBe(expected);
  });

  it.each([
    ['color', 'color'], ['colour', 'color'], ['mono', 'mono'], ['grayscale', 'mono'], ['greyscale', 'mono'], ['bw', 'mono'],
  ])('palette %s → %s', (palette, expected) => {
    expect(model(run({ palette, nodes: ['a'] })).palette).toBe(expected);
  });

  it('warns about an unknown size, font or palette and keeps the default', () => {
    const result = run({ size: 'hueg', font: 'comic', palette: 'rainbow', nodes: ['a'] });
    const m = model(result);
    expect([m.size, m.font, m.palette]).toEqual(['auto', 'sans', 'color']);
    expect(find(result, 'spec.invalid-value').map((d) => d.path)).toEqual(['size', 'font', 'palette']);
  });

  it('accepts version 1 and warns about any other', () => {
    clean(run({ version: 1, nodes: ['a'] }));
    clean(run({ version: '1', nodes: ['a'] }));
    const result = run({ version: 2, nodes: ['a'] });
    expect(model(result)).toBeTruthy();
    expect(one(result, 'spec.version')).toMatchObject({ severity: 'warning', path: 'version' });
  });

  it('warns about unknown top-level keys with a suggestion', () => {
    const result = run({ nodes: ['a', 'b'], edgs: ['a -> b'], links: [], captoin: 'x' });
    const unknown = find(result, 'spec.unknown-key');
    expect(unknown.map((d) => d.path)).toEqual(['edgs', 'links', 'captoin']);
    expect(unknown[0].message).toContain('Did you mean "edges"?');
    expect(unknown[1].message).toContain('Did you mean "edges"?');
    expect(unknown[2].message).toContain('Did you mean "caption"?');
    expect(covered(result, unknown[0])).toBe('"edgs"');
  });

  it('never suggests a name inherited from Object.prototype', () => {
    const result = run({
      constructor: 1,
      nodes: [{ id: 'a', Constructor: 'x' }, 'b'],
      edges: [{ from: 'a', to: 'b', con_structor: 2 }],
      legend: [{ label: 'L', constructor: 3 }],
    });
    const unknown = result.diagnostics.filter((d) => d.code.endsWith('.unknown-key'));
    expect(unknown.map((d) => d.path).sort()).toEqual(
      ['constructor', 'edges[0].con_structor', 'legend[0].constructor', 'nodes[0].Constructor'].sort(),
    );
    for (const d of unknown) expect(d.message).not.toContain('undefined');
  });

  it('lets `_` and `$` metadata keys through quietly', () => {
    clean(run({ $schema: 'x', _comment: 'y', nodes: [{ id: 'a', _note: 'z' }] }));
  });

  it('reads keys regardless of case and separators', () => {
    const result = run({
      Direction: 'LR',
      nodes: [{ ID: 'a', Label: 'A', same_rank: 'b' }, 'b'],
      edges: [{ From: 'a', TO: 'b', from_side: 'right' }],
    });
    clean(result);
    const m = model(result);
    expect(m.root.direction).toBe('right');
    expect(text(node(m, 'a').label)).toBe('A');
    expect(node(m, 'a').sameRank).toBe('b');
    expect(edge(m, 'a', 'b').fromSide).toBe('right');
  });

  it('warns when two spellings set one key, and uses the last', () => {
    const result = run('{"nodes": [{"id": "a", "label": "first", "Label": "second"}]}');
    expect(text(node(model(result), 'a').label)).toBe('second');
    expect(one(result, 'spec.duplicate-key').path).toBe('nodes[0].Label');
  });

  it('reads how the root arranges its children', () => {
    const result = run({ direction: 'up', layout: 'row', gap: 12, align: 'start', uniform: true, nodes: ['a'] });
    clean(result);
    expect(model(result).root).toMatchObject({ direction: 'up', layout: 'row', gap: 12, align: 'start', uniform: true });
  });

  it.each([
    ['down', 'down'], ['TB', 'down'], ['td', 'down'], ['top-bottom', 'down'], ['vertical', 'down'],
    ['up', 'up'], ['BT', 'up'], ['bottom-top', 'up'],
    ['right', 'right'], ['LR', 'right'], ['left-right', 'right'], ['horizontal', 'right'],
    ['left', 'left'], ['RL', 'left'], ['right-left', 'left'],
  ])('direction %s → %s', (direction, expected) => {
    expect(model(run({ direction, nodes: ['a'] })).root.direction).toBe(expected);
  });

  it('warns about an unknown direction and keeps down', () => {
    const result = run({ direction: 'sideways', nodes: ['a'] });
    expect(model(result).root.direction).toBe('down');
    expect(one(result, 'spec.invalid-value').path).toBe('direction');
  });

  it('reads "columns" alone as a grid, with a note', () => {
    const result = run({ columns: 3, nodes: ['a'] });
    expect(model(result).root).toMatchObject({ layout: 'grid', columns: 3 });
    expect(one(result, 'spec.grid-implied').severity).toBe('info');
    expect(model(run({ layout: 'flow', columns: 3, nodes: ['a'] })).root.layout).toBe('flow');
  });

  it('clamps gap and columns', () => {
    const result = run({ layout: 'grid', columns: 0, gap: -5, nodes: ['a'] });
    expect(model(result).root).toMatchObject({ columns: 1, gap: 0 });
    expect(find(result, 'spec.clamped')).toHaveLength(2);
  });

  it('reads layout aliases', () => {
    expect(model(run({ layout: 'horizontal', nodes: ['a'] })).root.layout).toBe('row');
    expect(model(run({ layout: 'vertical', nodes: ['a'] })).root.layout).toBe('column');
    expect(model(run({ layout: 'table', nodes: ['a'] })).root.layout).toBe('grid');
    const result = run({ layout: 'grd', nodes: ['a'] });
    expect(one(result, 'spec.invalid-value').message).toContain('Did you mean "grid"?');
  });

  it('reads align aliases', () => {
    expect(model(run({ align: 'left', nodes: ['a'] })).root.align).toBe('start');
    expect(model(run({ align: 'middle', nodes: ['a'] })).root.align).toBe('center');
    expect(model(run({ align: 'bottom', nodes: ['a'] })).root.align).toBe('end');
  });
});

/* ─── Items: ids and labels ─── */

describe('normalizeFigure: ids and labels', () => {
  it('reads a string node as id and label, trimmed', () => {
    const m = model(run({ nodes: ['  Q  '] }));
    expect(node(m, 'Q').label.source).toBe('Q');
  });

  it('turns numeric ids into strings', () => {
    const m = model(run({ nodes: [1, { id: 2, label: 'Two' }], edges: [{ from: 1, to: 2 }] }));
    expect(text(node(m, '1').label)).toBe('1');
    expect(text(node(m, '2').label)).toBe('Two');
    expect(pairs(m)).toEqual(['1->2']);
  });

  it('keeps ids case-sensitive', () => {
    const m = model(run({ nodes: ['q', 'Q'] }));
    expect(m.root.children).toEqual(['q', 'Q']);
  });

  it('derives ids from labels', () => {
    const result = run({
      nodes: [
        { label: 'Multi-Head\nAttention' },
        { label: 'Add & Norm' },
        { label: '$\\mathbf{c}_t^{KV}$' },
        { label: '$\\alpha$ gate' },
        { label: 'Modèle' },
        { label: 'Linear $W^{Q}$' },
      ],
    });
    clean(result);
    expect(model(result).root.children).toEqual([
      'multi-head-attention',
      'add-norm',
      'ctkv',
      'alpha-gate',
      'modele',
      'linear-wq',
    ]);
  });

  it('derives n<order> when there is no usable label', () => {
    const m = model(run({ nodes: ['a', { shape: 'circle' }, { label: '⊕' }] }));
    expect(m.root.children).toEqual(['a', 'n1', 'n2']);
    expect(text(node(m, 'n1').label)).toBe('');
    expect(text(node(m, 'n2').label)).toBe('⊕');
  });

  it('uniquifies derived ids, never taking an explicit one declared later', () => {
    const m = model(run({ nodes: [{ label: 'Linear' }, { label: 'Linear' }, { label: 'Linear' }, { id: 'linear-2' }] }));
    expect(m.root.children).toEqual(['linear', 'linear-3', 'linear-4', 'linear-2']);
  });

  it('shortens very long derived ids at a word boundary', () => {
    const m = model(run({ nodes: [{ label: 'a very long label that keeps going well past forty characters' }] }));
    const [id] = m.root.children;
    expect(id.length).toBeLessThanOrEqual(40);
    expect(id.endsWith('-')).toBe(false);
    expect('a-very-long-label-that-keeps-going-well-past-forty-characters'.startsWith(id)).toBe(true);
  });

  it('renames a later duplicate id, with a warning at its id', () => {
    const result = run({ nodes: [{ id: 'a', label: 'First' }, { id: 'a', label: 'Second' }, { id: 'a', label: 'Third' }] });
    const m = model(result);
    expect(m.root.children).toEqual(['a', 'a-2', 'a-3']);
    expect(text(node(m, 'a-2').label)).toBe('Second');
    const warnings = find(result, 'item.duplicate-id');
    expect(warnings).toHaveLength(2);
    expect(warnings[0].message).toContain('renamed "a-2"');
    expect(warnings[0].message).toContain('nodes[0]');
    expect(covered(result, warnings[0])).toBe('"a"');
  });

  it('skips over an explicit id when renaming', () => {
    const m = model(run({ nodes: [{ id: 'a', label: 'x' }, { id: 'a', label: 'y' }, { id: 'a-2', label: 'z' }] }));
    expect(m.root.children).toEqual(['a', 'a-3', 'a-2']);
  });

  it('reserves the root id', () => {
    const result = run({ nodes: [{ id: ROOT_ID, label: 'Root' }] });
    expect(model(result).root.children).toEqual(['root']);
    expect(one(result, 'item.reserved-id').severity).toBe('warning');
  });

  it('treats an empty id as missing', () => {
    const result = run({ nodes: [{ id: '  ', label: 'Encoder' }] });
    expect(model(result).root.children).toEqual(['encoder']);
    expect(one(result, 'item.invalid-value').path).toBe('nodes[0].id');
  });

  it('reads label aliases, and warns when two are given', () => {
    const m = model(run({ nodes: [{ id: 'a', text: 'A' }, { id: 'b', name: 'B' }, { id: 'c', title: 'C' }] }));
    expect(['a', 'b', 'c'].map((id) => text(node(m, id).label))).toEqual(['A', 'B', 'C']);
    const result = run({ nodes: [{ id: 'a', label: 'A', name: 'Alpha' }] });
    expect(text(node(model(result), 'a').label)).toBe('A');
    expect(one(result, 'item.duplicate-alias')).toMatchObject({ path: 'nodes[0].name' });
  });

  it('shows the id when a node has no label, except on tensors and images', () => {
    const m = model(run({ nodes: [{ id: 'enc' }, { id: 't', shape: 'tensor', cells: 3 }, { id: 'img', shape: 'image' }] }));
    expect(text(node(m, 'enc').label)).toBe('enc');
    expect(text(node(m, 't').label)).toBe('');
    expect(text(node(m, 'img').label)).toBe('');
  });

  it('keeps maths and line breaks in labels', () => {
    const m = model(run({ nodes: [{ id: 'a', label: 'Scaled\n$\\sqrt{d_k}$' }] }));
    const label = node(m, 'a').label;
    expect(label.lines).toHaveLength(2);
    expect(label.hasMath).toBe(true);
  });

  it('cuts an over-long label, never inside maths', () => {
    const long = 'x'.repeat(MAX_LABEL_CHARS + 50);
    const result = run({ nodes: [{ id: 'a', label: long }] });
    const source = node(model(result), 'a').label.source;
    expect(source).toHaveLength(MAX_LABEL_CHARS + 1);
    expect(source.endsWith('…')).toBe(true);
    expect(one(result, 'label.too-long').path).toBe('nodes[0].label');

    const maths = `${'y'.repeat(MAX_LABEL_CHARS - 5)} $\\alpha + \\beta$`;
    const cut = node(model(run({ nodes: [{ id: 'a', label: maths }] })), 'a').label;
    expect(cut.hasMath).toBe(false);
    expect(cut.source).toBe(`${'y'.repeat(MAX_LABEL_CHARS - 5)}…`);
  });

  it('cuts an over-long id shown as the label, keeping the id itself whole', () => {
    const long = 'x'.repeat(MAX_LABEL_CHARS + 50);
    const result = run({ nodes: [{ id: long }, 'b', { id: `t${long}`, shape: 'tensor', cells: 3 }], edges: [`${long} -> b`] });
    const m = model(result);
    expect(node(m, long).label.source).toHaveLength(MAX_LABEL_CHARS + 1);
    const warning = one(result, 'label.too-long');
    expect(warning.path).toBe('nodes[0]');
    expect(covered(result, warning)).toBe(JSON.stringify(long));
    expect(pairs(m)).toEqual([`${long}->b`]);
  });

  it('warns about items that are neither objects nor strings', () => {
    const result = run({ nodes: ['a', [1, 2], true, null, ''] });
    expect(model(result).root.children).toEqual(['a']);
    expect(find(result, 'item.invalid').map((d) => d.path)).toEqual(['nodes[1]', 'nodes[2]', 'nodes[3]', 'nodes[4]']);
  });

  it('reads nodes written as a map keyed by id', () => {
    const result = run({ nodes: { q: { label: 'Q', role: 'input' }, k: 'K', 'kv-cache': {} } });
    clean(result);
    const m = model(result);
    expect(m.root.children).toEqual(['q', 'k', 'kv-cache']);
    expect(node(m, 'q').shape).toBe('text');
    expect(text(node(m, 'k').label)).toBe('K');
    expect(text(node(m, 'kv-cache').label)).toBe('kv-cache');
    expect(node(m, 'kv-cache').path).toBe('nodes["kv-cache"]');
  });

  it('reads a single node object written without its list', () => {
    const result = run({ nodes: { id: 'a', label: 'A' } });
    expect(model(result).root.children).toEqual(['a']);
    expect(one(result, 'spec.not-a-list').severity).toBe('info');
  });
});

/* ─── Groups and containment ─── */

describe('normalizeFigure: groups and containment', () => {
  it('makes a group of anything with children, type group, group: true, or in "groups"', () => {
    const m = model(
      run({
        nodes: [{ id: 'a', children: ['x'] }, { id: 'b', type: 'group' }, { id: 'c', group: true }, { id: 'd', kind: 'cluster' }],
        groups: ['e', { id: 'f' }],
      }),
    );
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) expect(m.items.get(id)?.kind, id).toBe('group');
    expect(m.root.children).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(text(group(m, 'e').label)).toBe('e');
    expect(group(m, 'f').label).toBeNull();
  });

  it('moves a node declared at the top level into the group that lists it', () => {
    const result = run({ nodes: ['a', 'b', 'c', { id: 'g', children: ['c', 'a'] }] });
    clean(result);
    const m = model(result);
    expect(m.root.children).toEqual(['b', 'g']);
    expect(group(m, 'g').children).toEqual(['c', 'a']);
    expect(node(m, 'a')).toMatchObject({ parent: 'g', order: 0, path: 'nodes[0]' });
  });

  it('moves nodes into a group declared in "groups"', () => {
    const result = run({ nodes: ['a', 'b', 'c'], groups: [{ id: 'enc', label: 'Encoder', children: ['a', 'b'] }] });
    clean(result);
    const m = model(result);
    expect(m.root.children).toEqual(['c', 'enc']);
    expect(group(m, 'enc').children).toEqual(['a', 'b']);
  });

  it('creates a node for a child string declared nowhere else', () => {
    const m = model(run({ nodes: [{ id: 'g', children: ['Linear', { id: 'x' }] }] }));
    expect(group(m, 'g').children).toEqual(['Linear', 'x']);
    expect(node(m, 'Linear')).toMatchObject({ parent: 'g', path: 'nodes[0].children[0]' });
  });

  it('nests groups with paths to each definition', () => {
    const m = model(run({ nodes: [{ id: 'outer', children: [{ id: 'inner', children: [{ id: 'leaf' }] }] }] }));
    expect(node(m, 'leaf')).toMatchObject({ parent: 'inner', path: 'nodes[0].children[0].children[0]' });
    expect(group(m, 'inner').parent).toBe('outer');
  });

  it('reads "nodes" inside an item as its children', () => {
    const m = model(run({ nodes: [{ id: 'g', nodes: ['a', 'b'] }] }));
    expect(group(m, 'g').children).toEqual(['a', 'b']);
  });

  it('reads a single child written without a list', () => {
    const result = run({ nodes: [{ id: 'g', children: 'a' }] });
    expect(group(model(result), 'g').children).toEqual(['a']);
    expect(one(result, 'item.not-a-list').severity).toBe('info');
  });

  it('lets the first group that lists an item keep it', () => {
    const result = run({ nodes: ['a', { id: 'g1', children: ['a'] }, { id: 'g2', children: ['a'] }] });
    const m = model(result);
    expect(group(m, 'g1').children).toEqual(['a']);
    expect(group(m, 'g2').children).toEqual([]);
    const warning = one(result, 'item.duplicate-child');
    expect(warning.path).toBe('nodes[2].children[0]');
    expect(warning.message).toContain('"g1"');
  });

  it('counts a definition inside a group as that group listing it', () => {
    const result = run({ nodes: [{ id: 'g1', children: [{ id: 'a', label: 'A' }] }, { id: 'g2', children: ['a'] }] });
    const m = model(result);
    expect(node(m, 'a').parent).toBe('g1');
    expect(one(result, 'item.duplicate-child').path).toBe('nodes[1].children[0]');
  });

  it('lets an earlier reference win over a later definition in another group', () => {
    const result = run({ nodes: [{ id: 'g1', children: ['a'] }, { id: 'g2', children: [{ id: 'a', label: 'A' }] }] });
    const m = model(result);
    expect(node(m, 'a').parent).toBe('g1');
    expect(text(node(m, 'a').label)).toBe('A');
    expect(one(result, 'item.duplicate-child').path).toBe('nodes[1].children[0]');
  });

  it('warns when a group lists the same child twice', () => {
    const result = run({ nodes: [{ id: 'g', children: ['a', 'a'] }] });
    expect(group(model(result), 'g').children).toEqual(['a']);
    expect(one(result, 'item.duplicate-child').message).toContain('listed twice');
  });

  it('reads an id-only child object as a reference', () => {
    const result = run({ nodes: [{ id: 'a', label: 'Alpha' }, { id: 'g', children: [{ id: 'a' }] }] });
    clean(result);
    const m = model(result);
    expect(node(m, 'a').parent).toBe('g');
    expect(m.items.size).toBe(2);
  });

  it('ignores a bare mention of an item defined elsewhere, with a note', () => {
    const result = run({ nodes: ['a', { id: 'g', children: [{ id: 'a', label: 'Alpha', tone: 'blue' }] }] });
    const m = model(result);
    expect(m.items.size).toBe(2);
    expect(node(m, 'a')).toMatchObject({ parent: 'g', tone: 'blue' });
    expect(m.root.children).toEqual(['g']);
    expect(one(result, 'item.redundant')).toMatchObject({ severity: 'info', path: 'nodes[0]' });
  });

  it('refuses a containment cycle made by children lists', () => {
    const result = run({ nodes: [{ id: 'g1', children: ['g2'] }, { id: 'g2', children: ['g1'] }] });
    const m = model(result);
    expect(group(m, 'g2').parent).toBe('g1');
    expect(group(m, 'g1').parent).toBe(ROOT_ID);
    expect(m.root.children).toEqual(['g1']);
    expect(one(result, 'item.cycle').path).toBe('nodes[1].children[0]');
  });

  it('refuses a group listing itself', () => {
    const result = run({ nodes: [{ id: 'g', children: ['g', 'a'] }] });
    const m = model(result);
    expect(group(m, 'g').children).toEqual(['a']);
    expect(one(result, 'item.cycle').message).toContain('itself');
  });

  it('moves items with a "parent" key, after the listed children', () => {
    const result = run({
      nodes: [{ id: 'a', parent: 'g' }, 'b', { id: 'c', group: 'g' }],
      groups: [{ id: 'g', children: ['b'] }],
    });
    clean(result);
    const m = model(result);
    expect(group(m, 'g').children).toEqual(['b', 'a', 'c']);
    expect(m.root.children).toEqual(['g']);
  });

  it('resolves "parent" by label too', () => {
    const m = model(run({ nodes: [{ id: 'a', parent: 'Encoder' }], groups: [{ id: 'enc', label: 'Encoder' }] }));
    expect(node(m, 'a').parent).toBe('enc');
  });

  it('warns about an unknown parent with a suggestion', () => {
    const result = run({ nodes: [{ id: 'a', parent: 'encodr' }], groups: [{ id: 'encoder', children: ['x'] }] });
    expect(node(model(result), 'a').parent).toBe(ROOT_ID);
    const warning = one(result, 'item.unknown-parent');
    expect(warning.message).toContain('Did you mean "encoder"?');
    expect(covered(result, warning)).toBe('"encodr"');
  });

  it('warns when the parent is a node', () => {
    const result = run({ nodes: ['b', { id: 'a', parent: 'b' }] });
    expect(node(model(result), 'a').parent).toBe(ROOT_ID);
    one(result, 'item.parent-not-group');
  });

  it('refuses a "parent" that would make a cycle', () => {
    const result = run({ groups: [{ id: 'g1', parent: 'g2', children: ['x'] }, { id: 'g2', parent: 'g1', children: ['y'] }] });
    const m = model(result);
    expect(group(m, 'g1').parent).toBe('g2');
    expect(group(m, 'g2').parent).toBe(ROOT_ID);
    expect(one(result, 'item.cycle').path).toBe('groups[1].parent');
  });

  it('lets "parent" win over a children listing, with a warning', () => {
    const result = run({ nodes: [{ id: 'a', parent: 'g2' }], groups: [{ id: 'g1', children: ['a'] }, { id: 'g2' }] });
    const m = model(result);
    expect(node(m, 'a').parent).toBe('g2');
    expect(group(m, 'g1').children).toEqual([]);
    expect(one(result, 'item.parent-conflict').message).toContain('"g1"');
  });

  it('moves an item back to the top level with "parent": "root"', () => {
    const m = model(run({ nodes: [{ id: 'g', children: [{ id: 'a', parent: 'root' }, 'b'] }] }));
    expect(node(m, 'a').parent).toBe(ROOT_ID);
    expect(m.root.children).toEqual(['g', 'a']);
  });

  it('warns about an empty group', () => {
    const result = run({ nodes: ['a'], groups: ['g'] });
    expect(one(result, 'group.empty').path).toBe('groups[0]');
  });

  it('keeps an item a node when "children" is null, or empty beside node keys', () => {
    // Uniform model output writes `"children": null` (or `[]`) on every leaf.
    const result = run({
      nodes: [
        { id: 'x', label: 'X', role: 'input', children: null },
        { id: 'a', label: 'Attention', role: 'attention', shape: 'circle', children: [] },
        { id: 'n', nodes: null },
      ],
      edges: ['x -> a'],
    });
    clean(result);
    const m = model(result);
    expect(node(m, 'x').shape).toBe('text');
    expect(node(m, 'a')).toMatchObject({ shape: 'circle', tone: 'orange' });
    expect(node(m, 'n').kind).toBe('node');
    expect(find(result, 'item.no-children').map((d) => [d.path, d.severity])).toEqual([
      ['nodes[0].children', 'info'],
      ['nodes[1].children', 'info'],
      ['nodes[2].nodes', 'info'],
    ]);
  });

  it('still makes an empty group of an empty "children" alone, or of a declared group', () => {
    const result = run({
      nodes: [
        { id: 'g', children: [] },
        { id: 'h', label: 'H', type: 'group', children: null },
        { id: 'p', label: 'P', layout: 'row', children: [] },
      ],
      groups: [{ id: 'q', label: 'Q', children: null }],
    });
    const m = model(result);
    for (const id of ['g', 'h', 'p', 'q']) expect(m.items.get(id)?.kind, id).toBe('group');
    expect(find(result, 'group.empty')).toHaveLength(4);
    expect(find(result, 'item.no-children')).toEqual([]);
  });

  it('makes such an item a group after all when others name it as their parent', () => {
    const result = run({
      nodes: [
        { id: 'enc', label: 'Encoder', children: null, parent: null },
        { id: 'a', label: 'A', children: null, parent: 'enc' },
        { id: 'dec', label: 'Decoder', tone: 'blue', children: [] },
        { id: 'b', label: 'B', children: [], group: 'dec' },
      ],
    });
    clean(result);
    const m = model(result);
    expect(group(m, 'enc').children).toEqual(['a']);
    expect(group(m, 'dec').children).toEqual(['b']);
    expect(find(result, 'item.no-children').map((d) => d.path)).toEqual(['nodes[1].children', 'nodes[3].children']);
  });

  it('applies group defaults', () => {
    const m = model(run({ nodes: [{ id: 'g', label: 'Encoder', children: ['a'] }] }));
    expect(group(m, 'g')).toMatchObject({
      layout: 'flow',
      direction: 'down',
      columns: 2,
      align: 'center',
      gap: null,
      tone: 'neutral',
      filled: false,
      border: 'dashed',
      repeat: null,
      panel: null,
      uniform: false,
      labelPosition: 'top',
    });
    expect(text(group(m, 'g').label)).toBe('Encoder');
  });

  it('fills and outlines a toned group, unless told otherwise', () => {
    const m = model(
      run({
        nodes: [
          { id: 'a', tone: 'blue', children: ['x'] },
          { id: 'b', tone: 'blue', filled: false, children: ['y'] },
          { id: 'c', filled: true, children: ['z'] },
          { id: 'd', tone: 'neutral', children: ['w'] },
          { id: 'e', role: 'attention', children: ['v'] },
          { id: 'f', tone: 'blue', border: 'none', children: ['u'] },
          { id: 'h', fill: false, color: 'teal', children: ['t'] },
        ],
      }),
    );
    expect(group(m, 'a')).toMatchObject({ filled: true, border: 'solid', tone: 'blue' });
    expect(group(m, 'b')).toMatchObject({ filled: false, border: 'dashed' });
    expect(group(m, 'c')).toMatchObject({ filled: true, border: 'solid', tone: 'neutral' });
    expect(group(m, 'd')).toMatchObject({ filled: false, border: 'dashed' });
    expect(group(m, 'e')).toMatchObject({ filled: true, tone: 'orange' });
    expect(group(m, 'f')).toMatchObject({ filled: true, border: 'none' });
    expect(group(m, 'h')).toMatchObject({ filled: false, tone: 'teal' });
  });

  it('inherits the direction from the parent, after moves', () => {
    const m = model(
      run({
        direction: 'up',
        nodes: [
          { id: 'a', children: [{ id: 'b', direction: 'right', children: [{ id: 'c', children: ['x'] }] }] },
          { id: 'late', parent: 'b', children: ['y'] },
        ],
      }),
    );
    expect(group(m, 'a').direction).toBe('up');
    expect(group(m, 'b').direction).toBe('right');
    expect(group(m, 'c').direction).toBe('right');
    expect(group(m, 'late').direction).toBe('right');
  });

  it('reads group arrangement keys', () => {
    const result = run({
      nodes: [{ id: 'g', layout: 'grid', columns: 3, gap: 8, align: 'end', uniform: true, labelPosition: 'bottom', repeat: 'N×', children: ['a'] }],
    });
    clean(result);
    expect(group(model(result), 'g')).toMatchObject({
      layout: 'grid',
      columns: 3,
      gap: 8,
      align: 'end',
      uniform: true,
      labelPosition: 'bottom',
      repeat: 'N×',
    });
  });

  it('draws a numeric repeat as a count', () => {
    expect(group(model(run({ nodes: [{ id: 'g', repeat: 6, children: ['a'] }] })), 'g').repeat).toBe('6×');
  });

  it('letters panels in declaration order and moves the title into the caption', () => {
    const result = run({
      layout: 'row',
      nodes: [
        { id: 'p1', label: 'Full', panel: true, children: ['a'] },
        { id: 'p2', panel: 'Causal', children: ['b'] },
        { id: 'p3', panel: '(z) Sliding window', children: ['c'] },
        { id: 'p4', panel: 'Caption', label: 'Title', children: ['d'] },
        { id: 'p5', panel: true, children: ['e'] },
        { id: 'plain', label: 'Not a panel', children: ['f'] },
      ],
    });
    clean(result);
    const m = model(result);
    expect(group(m, 'p1')).toMatchObject({ panel: '(a) Full', label: null, border: 'none' });
    expect(group(m, 'p2')).toMatchObject({ panel: '(b) Causal', label: null });
    expect(group(m, 'p3').panel).toBe('(z) Sliding window');
    expect(group(m, 'p4').panel).toBe('(d) Caption');
    expect(text(group(m, 'p4').label)).toBe('Title');
    expect(group(m, 'p5').panel).toBe('(e)');
    expect(group(m, 'plain').panel).toBeNull();
  });

  it('lets an explicit border win on a panel', () => {
    expect(group(model(run({ nodes: [{ id: 'p', panel: true, border: 'solid', children: ['a'] }] })), 'p').border).toBe('solid');
  });

  it('warns about node keys on a group and group keys on a node', () => {
    const result = run({ nodes: [{ id: 'g', shape: 'box', stack: 3, children: ['a'] }, { id: 'n', layout: 'row', columns: 2 }] });
    const misplaced = find(result, 'item.misplaced-key');
    expect(misplaced.map((d) => d.path)).toEqual(['nodes[0].shape', 'nodes[0].stack', 'nodes[1].layout', 'nodes[1].columns']);
    expect(misplaced[0].message).toContain('group');
  });

  it('warns about a type that does not apply to a group', () => {
    const result = run({ nodes: [{ id: 'g', type: 'tensor', children: ['a'] }] });
    expect(one(result, 'item.misplaced-key').path).toBe('nodes[0].type');
  });
});

/* ─── Node properties ─── */

describe('normalizeFigure: node properties', () => {
  it('takes shape, tone and italic from the role', () => {
    const result = run({
      nodes: [
        { id: 'a', role: 'attention' },
        { id: 'b', role: 'RMSNorm' },
        { id: 'c', role: 'cache' },
        { id: 'd', role: 'note' },
        { id: 'e', role: 'input' },
        { id: 'f', role: 'model' },
      ],
    });
    clean(result);
    const m = model(result);
    expect(node(m, 'a')).toMatchObject({ shape: 'box', tone: 'orange', italic: false, border: 'solid' });
    expect(node(m, 'b')).toMatchObject({ shape: 'box', tone: 'yellow' });
    expect(node(m, 'c')).toMatchObject({ shape: 'cylinder', tone: 'gray' });
    expect(node(m, 'd')).toMatchObject({ shape: 'text', italic: true, border: 'none' });
    expect(node(m, 'e')).toMatchObject({ shape: 'text', border: 'none' });
    expect(node(m, 'f')).toMatchObject({ shape: 'round', tone: 'blue' });
  });

  it('lets explicit shape, tone and italic win over the role', () => {
    const m = model(run({ nodes: [{ id: 'a', role: 'attention', shape: 'round', tone: 'teal' }, { id: 'n', role: 'note', italic: false }] }));
    expect(node(m, 'a')).toMatchObject({ shape: 'round', tone: 'teal' });
    expect(node(m, 'n').italic).toBe(false);
  });

  it('warns about an unknown role with a suggestion and draws a box', () => {
    const result = run({ nodes: [{ id: 'a', role: 'atention' }] });
    expect(node(model(result), 'a')).toMatchObject({ shape: 'box', tone: 'neutral' });
    const warning = one(result, 'item.unknown-role');
    expect(warning.message).toContain('Did you mean "attention"?');
    expect(warning.path).toBe('nodes[0].role');
    expect(covered(result, warning)).toBe('"atention"');
  });

  it('reads "type" as a shape, else as a role', () => {
    const result = run({ nodes: [{ id: 'a', type: 'cylinder' }, { id: 'b', kind: 'ffn' }, { id: 'c', type: 'node' }, { id: 'd', type: 'blob' }] });
    const m = model(result);
    expect(node(m, 'a').shape).toBe('cylinder');
    expect(node(m, 'b')).toMatchObject({ shape: 'box', tone: 'blue' });
    expect(node(m, 'c').shape).toBe('box');
    expect(one(result, 'item.unknown-type').path).toBe('nodes[3].type');
  });

  it('reads shape aliases and warns about unknown shapes', () => {
    const m = model(run({ nodes: [{ id: 'a', shape: 'rectangle' }, { id: 'b', shape: 'Up-Projection' }, { id: 'c', shape: 'db' }] }));
    expect([node(m, 'a').shape, node(m, 'b').shape, node(m, 'c').shape]).toEqual(['box', 'expand', 'cylinder']);
    const result = run({ nodes: [{ id: 'a', shape: 'rectangel', role: 'ffn' }] });
    expect(node(model(result), 'a').shape).toBe('box');
    expect(one(result, 'item.unknown-shape').message).toContain('Did you mean "rectangle"?');
  });

  it('reads tone from tone, color, colour and a fill colour', () => {
    const m = model(
      run({
        nodes: [
          { id: 'a', tone: 'blue' },
          { id: 'b', color: 'lightblue' },
          { id: 'c', colour: '#d62728' },
          { id: 'd', fill: 'gold' },
          { id: 'e', tone: '' },
        ],
      }),
    );
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => node(m, id).tone)).toEqual(['blue', 'blue', 'red', 'yellow', 'neutral']);
  });

  it('warns about an unknown tone and about a fill beside a tone', () => {
    const result = run({ nodes: [{ id: 'a', tone: 'blurple' }, { id: 'b', tone: 'red', fill: 'blue' }, { id: 'c', fill: true }] });
    const m = model(result);
    expect(node(m, 'a').tone).toBe('neutral');
    expect(node(m, 'b').tone).toBe('red');
    expect(one(result, 'item.unknown-tone').message).toContain('Did you mean "purple"?');
    expect(one(result, 'item.duplicate-alias').path).toBe('nodes[1].fill');
    expect(one(result, 'item.misplaced-key').path).toBe('nodes[2].fill');
  });

  it('reads borders from border, style and the dashed/dotted flags', () => {
    const result = run({
      nodes: [
        { id: 'a', border: 'dashed' },
        { id: 'b', style: 'dotted' },
        { id: 'c', dashed: true },
        { id: 'd', dotted: true },
        { id: 'e', border: 'thick' },
        { id: 'f', border: 'none' },
        { id: 'g', border: false },
        { id: 'h', shape: 'text', border: 'solid' },
        { id: 'i', dashed: false },
      ],
    });
    clean(result);
    const m = model(result);
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((id) => node(m, id).border)).toEqual([
      'dashed', 'dotted', 'dashed', 'dotted', 'bold', 'none', 'none', 'solid', 'solid',
    ]);
  });

  it('warns about a style that is not a border', () => {
    const result = run({ nodes: [{ id: 'a', style: 'fancy' }] });
    expect(node(model(result), 'a').border).toBe('solid');
    expect(one(result, 'item.invalid-value').path).toBe('nodes[0].style');
  });

  it('reads patterns from pattern, hatch and cached', () => {
    const m = model(
      run({ nodes: [{ id: 'a', pattern: 'hatch' }, { id: 'b', hatch: true }, { id: 'c', cached: true }, { id: 'd', pattern: 'dots' }, { id: 'e', pattern: 'striped' }] }),
    );
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => node(m, id).pattern)).toEqual(['hatch', 'hatch', 'hatch', 'dots', 'hatch']);
  });

  it('reads and clamps stacks', () => {
    const result = run({
      nodes: [
        { id: 'a', stack: 3 },
        { id: 'b', stack: true },
        { id: 'c', stack: false },
        { id: 'd', copies: 4 },
        { id: 'e', stack: 12 },
        { id: 'f', stack: 0 },
        { id: 'g', stack: 2.6 },
      ],
    });
    const m = model(result);
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => node(m, id).stack)).toEqual([3, 3, 1, 4, 8, 1, 3]);
    expect(find(result, 'item.clamped').map((d) => d.path)).toEqual(['nodes[4].stack', 'nodes[5].stack']);
  });

  it('reads repeat, badge, bold and italic', () => {
    const result = run({ nodes: [{ id: 'a', repeat: 'h', badge: 'cached', bold: true, italic: true }, { id: 'b', repeat: 8 }] });
    clean(result);
    const m = model(result);
    expect(node(m, 'a')).toMatchObject({ repeat: 'h', badge: 'cached', bold: true, italic: true });
    expect(node(m, 'b').repeat).toBe('8×');
  });

  it('reads booleans written as words and warns about other values', () => {
    const result = run({ nodes: [{ id: 'a', bold: 'yes' }, { id: 'b', bold: 'very' }] });
    const m = model(result);
    expect(node(m, 'a').bold).toBe(true);
    expect(node(m, 'b').bold).toBe(false);
    expect(one(result, 'item.invalid-value').path).toBe('nodes[1].bold');
  });

  it('reads and clamps fixed sizes', () => {
    const result = run({ nodes: [{ id: 'a', width: 120, height: '40px' }, { id: 'b', width: 5, height: 5000 }, { id: 'c', width: 'wide' }] });
    const m = model(result);
    expect(node(m, 'a')).toMatchObject({ width: 120, height: 40 });
    expect(node(m, 'b')).toMatchObject({ width: 16, height: 640 });
    expect(node(m, 'c').width).toBeNull();
    expect(find(result, 'item.clamped')).toHaveLength(2);
    expect(one(result, 'item.invalid-value').path).toBe('nodes[2].width');
  });

  it('reads sublabels and their aliases', () => {
    const m = model(
      run({
        nodes: [
          { id: 'a', sublabel: '$B\\times d$' },
          { id: 'b', dims: ['B', 'T', 512] },
          { id: 'c', subtitle: 'frozen' },
          { id: 'd', detail: '  ' },
        ],
      }),
    );
    expect(node(m, 'a').sublabel?.hasMath).toBe(true);
    expect(text(node(m, 'b').sublabel)).toBe('B × T × 512');
    expect(text(node(m, 'c').sublabel)).toBe('frozen');
    expect(node(m, 'd').sublabel).toBeNull();
  });

  it('draws operator glyphs only for op nodes', () => {
    const m = model(
      run({
        nodes: [
          { id: 'a', role: 'op', label: '+' },
          { id: 'b', shape: 'op', label: '×' },
          { id: 'c', shape: 'circle', label: '+' },
          { id: 'd', label: 'add' },
          { id: 'e', shape: 'op', label: 'σ' },
          { id: 'f', role: 'op', label: '$\\oplus$' },
          { id: 'g', role: 'operator', label: 'concat' },
          { id: 'add', role: 'op' },
        ],
      }),
    );
    expect(node(m, 'a')).toMatchObject({ shape: 'op', op: 'plus' });
    expect(node(m, 'b').op).toBe('times');
    expect(node(m, 'c')).toMatchObject({ shape: 'circle', op: null });
    expect(node(m, 'd')).toMatchObject({ shape: 'box', op: null });
    expect(node(m, 'e')).toMatchObject({ shape: 'op', op: null });
    expect(text(node(m, 'e').label)).toBe('σ');
    expect(node(m, 'f').op).toBe('plus');
    expect(node(m, 'g').op).toBe('concat');
    expect(node(m, 'add').op).toBe('plus');
  });

  it('reads layer hints', () => {
    const result = run({
      nodes: [
        'x',
        { id: 'a', rank: 2 },
        { id: 'b', rank: 'first' },
        { id: 'c', rank: 'last' },
        { id: 'd', rank: '3' },
        { id: 'e', beside: 'x' },
        { id: 'f', beside: 'x', side: 'left' },
        { id: 'g', beside: 'x', side: 'above' },
        { id: 'h', sameRank: 'x' },
        { id: 'i', sameRankAs: 'x' },
        { id: 'j', alignWith: 'x' },
      ],
    });
    clean(result);
    const m = model(result);
    expect(['a', 'b', 'c', 'd'].map((id) => node(m, id).rank)).toEqual([2, 'first', 'last', 3]);
    expect(node(m, 'e').beside).toEqual({ id: 'x', before: false });
    expect(node(m, 'f').beside).toEqual({ id: 'x', before: true });
    expect(node(m, 'g').beside).toEqual({ id: 'x', before: true });
    expect(['h', 'i', 'j'].map((id) => node(m, id).sameRank)).toEqual(['x', 'x', 'x']);
  });

  it('clamps a negative rank', () => {
    const result = run({ nodes: [{ id: 'a', rank: -1 }] });
    expect(node(model(result), 'a').rank).toBe(0);
    one(result, 'item.clamped');
  });

  it('warns about beside and sameRank that do not name a sibling', () => {
    const result = run({
      nodes: [
        { id: 'g', children: ['inner'] },
        { id: 'a', beside: 'inner' },
        { id: 'b', sameRank: 'nope' },
        { id: 'c', beside: 'c' },
        { id: 'd', side: 'left' },
      ],
    });
    const m = model(result);
    expect(node(m, 'a').beside).toBeNull();
    expect(node(m, 'b').sameRank).toBeNull();
    expect(node(m, 'c').beside).toBeNull();
    expect(find(result, 'item.unknown-sibling').map((d) => d.path)).toEqual(['nodes[1].beside', 'nodes[2].sameRank', 'nodes[3].beside']);
    expect(one(result, 'item.misplaced-key').path).toBe('nodes[4].side');
  });

  it('checks siblings after moves', () => {
    const result = run({ nodes: [{ id: 'a', beside: 'b', parent: 'g' }, 'b'], groups: [{ id: 'g', children: ['b'] }] });
    clean(result);
    expect(node(model(result), 'a').beside).toEqual({ id: 'b', before: false });
  });

  it('warns about unknown node keys with a suggestion, naming the node', () => {
    const result = run({ nodes: [{ id: 'a', lable: 'A', fillColor: 'red' }] });
    const [typo, synonym] = find(result, 'item.unknown-key');
    expect(typo.message).toContain('on node "a"');
    expect(typo.message).toContain('Did you mean "label"?');
    expect(synonym.message).toContain('Did you mean "tone"?');
  });
});

/* ─── Tensors and images ─── */

describe('normalizeFigure: tensors', () => {
  const cellsOf = (spec: Record<string, unknown>) => {
    const result = run({ nodes: [{ id: 't', shape: 'tensor', ...spec }] });
    return { result, cells: node(model(result), 't').cells! };
  };

  it('reads a count as one row', () => {
    const { result, cells } = cellsOf({ cells: 6 });
    clean(result);
    expect(cells).toEqual({ rows: 1, cols: 6, text: null, values: null, pattern: 'none' });
  });

  it('reads [rows, cols], "RxC" and {rows, cols}', () => {
    expect(cellsOf({ cells: [8, 4] }).cells).toMatchObject({ rows: 8, cols: 4 });
    expect(cellsOf({ cells: '8x8' }).cells).toMatchObject({ rows: 8, cols: 8 });
    expect(cellsOf({ cells: '3 × 5' }).cells).toMatchObject({ rows: 3, cols: 5 });
    expect(cellsOf({ cells: { rows: 2, cols: 7 } }).cells).toMatchObject({ rows: 2, cols: 7 });
  });

  it('reads a list of labels as a token row', () => {
    const { result, cells } = cellsOf({ cells: ['[CLS]', 'The', 'cat', 3] });
    clean(result);
    expect(cells).toMatchObject({ rows: 1, cols: 4, text: [['[CLS]', 'The', 'cat', '3']] });
  });

  it('reads a grid of labels and pads ragged rows', () => {
    const { result, cells } = cellsOf({ cells: [['a', 'b', 'c'], ['d']] });
    expect(cells).toMatchObject({ rows: 2, cols: 3, text: [['a', 'b', 'c'], ['d', null, null]] });
    expect(one(result, 'tensor.ragged').path).toBe('nodes[0].cells');
  });

  it('draws non-text labels empty, with a warning', () => {
    const { result, cells } = cellsOf({ cells: ['a', { x: 1 }, null] });
    expect(cells.text).toEqual([['a', null, null]]);
    one(result, 'tensor.invalid-value');
  });

  it('reads values for a row and for a grid', () => {
    expect(cellsOf({ cells: 3, values: [0, 0.5, 1] }).cells.values).toEqual([[0, 0.5, 1]]);
    expect(cellsOf({ cells: [2, 2], values: [[0.1, 0.2], [0.3, 0.4]] }).cells.values).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('reshapes flat values row-major', () => {
    const { result, cells } = cellsOf({ cells: [2, 2], values: [0.1, 0.2, 0.3, 0.4] });
    clean(result);
    expect(cells.values).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('takes the dimensions from the values when cells are missing', () => {
    const { result, cells } = cellsOf({ values: [[0, 1, 0], [1, 0, 1]] });
    clean(result);
    expect(cells).toMatchObject({ rows: 2, cols: 3 });
    expect(cellsOf({ values: [0.2, 0.4] }).cells).toMatchObject({ rows: 1, cols: 2 });
  });

  it('normalises values above 1 by the maximum, with a note', () => {
    const { result, cells } = cellsOf({ cells: 4, values: [0, 2, 4, 8] });
    expect(cells.values).toEqual([[0, 0.25, 0.5, 1]]);
    expect(one(result, 'tensor.values-normalized').severity).toBe('info');
  });

  it('clamps negative values to 0, with a warning', () => {
    const { result, cells } = cellsOf({ cells: 3, values: [-1, 0.5, 1] });
    expect(cells.values).toEqual([[0, 0.5, 1]]);
    one(result, 'tensor.values-range');
  });

  it('pads and trims values that do not match the cells', () => {
    const short = cellsOf({ cells: [2, 2], values: [[1], [0.5, 0.5, 0.5]] });
    expect(short.cells.values).toEqual([[1, 0], [0.5, 0.5]]);
    one(short.result, 'tensor.values-shape');
    const flat = cellsOf({ cells: [2, 2], values: [1, 1, 1] });
    expect(flat.cells.values).toEqual([[1, 1], [1, 0]]);
    one(flat.result, 'tensor.values-shape');
  });

  it('reads non-numbers in values as 0, with a warning', () => {
    const { result, cells } = cellsOf({ cells: 3, values: [1, 'x', true] });
    expect(cells.values).toEqual([[1, 0, 1]]);
    one(result, 'tensor.invalid-value');
  });

  it.each([
    ['causal', 'lower'], ['lower', 'lower'], ['tril', 'lower'], ['upper', 'upper'], ['diagonal', 'diagonal'],
    ['diag', 'diagonal'], ['full', 'full'], ['all', 'full'], ['none', 'none'],
  ])('mask %s → %s', (mask, pattern) => {
    const { result, cells } = cellsOf({ cells: [4, 4], mask });
    clean(result);
    expect(cells.pattern).toBe(pattern);
  });

  it('warns about an unknown mask', () => {
    const { result, cells } = cellsOf({ cells: [4, 4], mask: 'casual' });
    expect(cells.pattern).toBe('none');
    expect(one(result, 'tensor.invalid-value').message).toContain('Did you mean "causal"?');
    expect(cellsOf({ cells: [4, 4], mask: false }).cells.pattern).toBe('none');
    one(cellsOf({ cells: [4, 4], mask: true }).result, 'tensor.invalid-value');
  });

  it('draws a 0/1 mask grid as values', () => {
    const { result, cells } = cellsOf({ cells: [2, 2], mask: [[1, 0], [1, 1]] });
    clean(result);
    expect(cells).toMatchObject({ values: [[1, 0], [1, 1]], pattern: 'none' });
    const both = cellsOf({ cells: [2, 2], values: [[0.5, 0], [0, 0.5]], mask: [[1, 0], [1, 1]] });
    expect(both.cells.values).toEqual([[0.5, 0], [0, 0.5]]);
    one(both.result, 'tensor.misplaced-key');
  });

  it('draws a row of 4 when a tensor has no cells', () => {
    const { result, cells } = cellsOf({});
    expect(cells).toMatchObject({ rows: 1, cols: 4 });
    expect(one(result, 'tensor.no-cells').path).toBe('nodes[0]');
  });

  it('caps the cell count, keeping the aspect ratio', () => {
    const square = cellsOf({ cells: [64, 64] });
    expect(square.cells).toMatchObject({ rows: 32, cols: 32 });
    one(square.result, 'tensor.too-many-cells');
    const row = cellsOf({ cells: 5000 });
    expect(row.cells).toMatchObject({ rows: 1, cols: MAX_TENSOR_CELLS });
    const column = cellsOf({ cells: [5000, 1] });
    expect(column.cells).toMatchObject({ rows: MAX_TENSOR_CELLS, cols: 1 });
    const tokens = cellsOf({ cells: Array.from({ length: 1100 }, (_, i) => `t${i}`) });
    expect(tokens.cells.cols).toBe(MAX_TENSOR_CELLS);
    expect(tokens.cells.text![0]).toHaveLength(MAX_TENSOR_CELLS);
    for (const cells of [square.cells, row.cells, column.cells]) {
      expect(cells.rows * cells.cols).toBeLessThanOrEqual(MAX_TENSOR_CELLS);
    }
  });

  it('fixes dimensions that are not whole and positive', () => {
    const zero = cellsOf({ cells: [0, 3] });
    expect(zero.cells).toMatchObject({ rows: 1, cols: 3 });
    one(zero.result, 'tensor.invalid-value');
    expect(cellsOf({ cells: 2.4 }).cells).toMatchObject({ rows: 1, cols: 2 });
  });

  it('warns about cells that are not a tensor spec', () => {
    const { result, cells } = cellsOf({ cells: true });
    expect(cells).toMatchObject({ rows: 1, cols: 4 });
    one(result, 'tensor.invalid-value');
  });

  it('makes a node with cells or values a tensor when no shape is given', () => {
    const m = model(run({ nodes: [{ id: 'a', cells: 3 }, { id: 'b', role: 'embedding', values: [0.1, 0.9] }] }));
    expect(node(m, 'a').shape).toBe('tensor');
    expect(node(m, 'b')).toMatchObject({ shape: 'tensor', tone: 'pink' });
  });

  it('warns about tensor keys on another shape', () => {
    const result = run({ nodes: [{ id: 'a', shape: 'box', cells: 3, mask: 'causal' }] });
    expect(node(model(result), 'a').cells).toBeNull();
    expect(find(result, 'tensor.misplaced-key').map((d) => d.path)).toEqual(['nodes[0].cells', 'nodes[0].mask']);
  });
});

describe('normalizeFigure: images', () => {
  const srcOf = (src: unknown, extra: Record<string, unknown> = { shape: 'image' }) => {
    const result = run({ nodes: [{ id: 'i', ...extra, src }] });
    return { result, src: node(model(result), 'i').src };
  };

  it('keeps http(s) URLs, noting that remote images are not loaded', () => {
    for (const url of ['https://example.org/cat.png', 'http://example.org/cat.png']) {
      const { result, src } = srcOf(url);
      clean(result);
      expect(src).toBe(url);
      const remote = one(result, 'image.remote');
      expect(remote).toMatchObject({ severity: 'info', path: 'nodes[0].src' });
      expect(remote.message).toContain('data:image');
    }
  });

  it('accepts base64 image data URLs', () => {
    for (const type of ['png', 'jpeg', 'jpg', 'gif', 'webp', 'svg+xml']) {
      const { result, src } = srcOf(`data:image/${type};base64,iVBORw0KGgo=`);
      clean(result);
      expect(src).toBe(`data:image/${type};base64,iVBORw0KGgo=`);
      expect(find(result, 'image.remote')).toEqual([]);
    }
    expect(srcOf('DATA:IMAGE/PNG;BASE64,iVBO\nRw0K').src).toBe('data:image/png;base64,iVBORw0K');
  });

  it('refuses anything else and draws a placeholder', () => {
    for (const bad of [
      'ftp://example.org/cat.png',
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/png,rawdata',
      'data:image/png;base64,"><script>',
      'data:image/png;base64,',
      'https://user:secret@example.org/cat.png',
      'http://user@example.org/cat.png',
      '/relative/cat.png',
      'cat.png',
    ]) {
      const { result, src } = srcOf(bad);
      expect(src, bad).toBeNull();
      expect(one(result, 'image.unsafe-src').path).toBe('nodes[0].src');
    }
  });

  it('makes a node with a source an image when no shape is given', () => {
    const m = model(run({ nodes: [{ id: 'a', url: 'https://example.org/a.png' }] }));
    expect(node(m, 'a')).toMatchObject({ shape: 'image', src: 'https://example.org/a.png' });
  });

  it('warns about a source on another shape', () => {
    const { result, src } = srcOf('https://example.org/a.png', { shape: 'box' });
    expect(src).toBeNull();
    one(result, 'image.misplaced-key');
  });
});

/* ─── Edges ─── */

describe('parseEdgeShorthand', () => {
  const edge1 = (partial: Partial<ShorthandEdge>): ShorthandEdge => ({
    from: [],
    to: [],
    fromSide: null,
    toSide: null,
    line: 'solid',
    weight: 'normal',
    arrow: 'end',
    label: null,
    ...partial,
  });

  it('reads a plain arrow', () => {
    expect(parseEdgeShorthand('q -> matmul')).toEqual([edge1({ from: ['q'], to: ['matmul'] })]);
    expect(parseEdgeShorthand('q->matmul')).toEqual([edge1({ from: ['q'], to: ['matmul'] })]);
  });

  it('reads fan-in and fan-out lists', () => {
    expect(parseEdgeShorthand('k, q -> matmul')).toEqual([edge1({ from: ['k', 'q'], to: ['matmul'] })]);
    expect(parseEdgeShorthand('h -> a, b,, c,')).toEqual([edge1({ from: ['h'], to: ['a', 'b', 'c'] })]);
  });

  it('reads a chain as consecutive edges, each with its own style', () => {
    expect(parseEdgeShorthand('a -> b --> c')).toEqual([
      edge1({ from: ['a'], to: ['b'] }),
      edge1({ from: ['b'], to: ['c'], line: 'dashed' }),
    ]);
  });

  it.each([
    ['a -> b', { line: 'solid', weight: 'normal', arrow: 'end' }],
    ['a --> b', { line: 'dashed', arrow: 'end' }],
    ['a ---> b', { line: 'dashed', arrow: 'end' }],
    ['a -.-> b', { line: 'dotted', arrow: 'end' }],
    ['a ..> b', { line: 'dotted', arrow: 'end' }],
    ['a ...> b', { line: 'dotted', arrow: 'end' }],
    ['a => b', { line: 'solid', weight: 'thick', arrow: 'end' }],
    ['a ==> b', { line: 'solid', weight: 'thick', arrow: 'end' }],
    ['a <-> b', { line: 'solid', arrow: 'both' }],
    ['a <--> b', { line: 'dashed', arrow: 'both' }],
    ['a <..> b', { line: 'dotted', arrow: 'both' }],
    ['a <=> b', { weight: 'thick', arrow: 'both' }],
    ['a -- b', { line: 'solid', arrow: 'none' }],
    ['a --- b', { line: 'solid', arrow: 'none' }],
    ['a .. b', { line: 'dotted', arrow: 'none' }],
    ['a ... b', { line: 'dotted', arrow: 'none' }],
    ['a → b', { line: 'solid', arrow: 'end' }],
    ['a ⇒ b', { weight: 'thick', arrow: 'end' }],
    ['a ↔ b', { arrow: 'both' }],
  ] as const)('%s', (shorthand, style) => {
    expect(parseEdgeShorthand(shorthand)).toEqual([edge1({ from: ['a'], to: ['b'], ...style })]);
  });

  it('turns a backwards arrow around', () => {
    expect(parseEdgeShorthand('a <- b')).toEqual([edge1({ from: ['b'], to: ['a'] })]);
    expect(parseEdgeShorthand('a <-- b')).toEqual([edge1({ from: ['b'], to: ['a'], line: 'dashed' })]);
    expect(parseEdgeShorthand('a ← b')).toEqual([edge1({ from: ['b'], to: ['a'] })]);
    expect(parseEdgeShorthand('a.top <- b.bottom')).toEqual([
      edge1({ from: ['b'], to: ['a'], fromSide: 'bottom', toSide: 'top' }),
    ]);
  });

  it('pins sides with a suffix', () => {
    expect(parseEdgeShorthand('a.right -> b.left')).toEqual([edge1({ from: ['a'], to: ['b'], fromSide: 'right', toSide: 'left' })]);
    expect(parseEdgeShorthand('a.n -> b.S')).toEqual([edge1({ from: ['a'], to: ['b'], fromSide: 'top', toSide: 'bottom' })]);
    expect(parseEdgeShorthand('v1.2 -> b')).toEqual([edge1({ from: ['v1.2'], to: ['b'] })]);
  });

  it('splits one list into edges by pinned side', () => {
    expect(parseEdgeShorthand('a.right, b, c.right -> d')).toEqual([
      edge1({ from: ['a', 'c'], to: ['d'], fromSide: 'right' }),
      edge1({ from: ['b'], to: ['d'] }),
    ]);
  });

  it('reads the label after the first ": " following an arrow', () => {
    expect(parseEdgeShorthand('x -> add: residual')).toEqual([edge1({ from: ['x'], to: ['add'], label: 'residual' })]);
    expect(parseEdgeShorthand('x -> y: maps a -> b: twice')).toEqual([edge1({ from: ['x'], to: ['y'], label: 'maps a -> b: twice' })]);
    expect(parseEdgeShorthand('x -> y: $W^{Q}: d \\to k$')).toEqual([edge1({ from: ['x'], to: ['y'], label: '$W^{Q}: d \\to k$' })]);
    expect(parseEdgeShorthand('x -> y : spaced')).toEqual([edge1({ from: ['x'], to: ['y'], label: 'spaced' })]);
  });

  it('reads a trailing ":label" on the last endpoint', () => {
    expect(parseEdgeShorthand('x -> add:residual')).toEqual([edge1({ from: ['x'], to: ['add'], label: 'residual' })]);
    expect(parseEdgeShorthand('x -> add:')).toEqual([edge1({ from: ['x'], to: ['add'] })]);
  });

  it('puts a chain label on the last hop only', () => {
    const edges = parseEdgeShorthand('a -> b -> c: out') as ShorthandEdge[];
    expect(edges.map((e) => e.label)).toEqual([null, 'out']);
  });

  it('keeps names with spaces, hyphens, dots and angle brackets', () => {
    expect(parseEdgeShorthand('Input Embedding -> Add & Norm')).toEqual([edge1({ from: ['Input Embedding'], to: ['Add & Norm'] })]);
    expect(parseEdgeShorthand('feed-forward->add')).toEqual([edge1({ from: ['feed-forward'], to: ['add'] })]);
    expect(parseEdgeShorthand('<CLS> -> enc')).toEqual([edge1({ from: ['<CLS>'], to: ['enc'] })]);
    expect(parseEdgeShorthand('x -> </s>')).toEqual([edge1({ from: ['x'], to: ['</s>'] })]);
  });

  it('explains what is wrong with a malformed edge', () => {
    expect(parseEdgeShorthand('a b')).toEqual({ error: expect.stringContaining('has no arrow') });
    expect(parseEdgeShorthand('')).toEqual({ error: expect.stringContaining('has no arrow') });
    expect(parseEdgeShorthand('-> b')).toEqual({ error: expect.stringContaining('Missing a node before "->"') });
    expect(parseEdgeShorthand('a ->')).toEqual({ error: expect.stringContaining('Missing a node after "->"') });
    expect(parseEdgeShorthand('a -> -> b')).toEqual({ error: expect.stringContaining('Missing a node') });
    expect(parseEdgeShorthand('a, , -> b')).toEqual([edge1({ from: ['a'], to: ['b'] })]);
    expect(parseEdgeShorthand(' , -> b')).toEqual({ error: expect.stringContaining('Missing a node before') });
  });
});

describe('normalizeFigure: edges', () => {
  const base = ['q', 'k', 'v', 'matmul', 'scale', 'softmax'];

  it('expands fan-in and chains in order', () => {
    const result = run({ nodes: base, edges: ['k, q -> matmul -> scale', 'scale -> softmax'] });
    clean(result);
    const m = model(result);
    expect(pairs(m)).toEqual(['k->matmul', 'q->matmul', 'matmul->scale', 'scale->softmax']);
    expect(m.edges.map((e) => e.order)).toEqual([0, 1, 2, 3]);
    expect(m.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(m.edges.map((e) => e.path)).toEqual(['edges[0]', 'edges[0]', 'edges[0]', 'edges[1]']);
  });

  it('carries the shorthand style and label', () => {
    const m = model(run({ nodes: ['x', 'add'], edges: ['x ==> add: $h$'] }));
    expect(m.edges[0]).toMatchObject({ weight: 'thick', arrow: 'end' });
    expect(m.edges[0].label?.hasMath).toBe(true);
  });

  it('resolves endpoints by id, then case-insensitive id, then label', () => {
    const result = run({
      nodes: [
        { id: 'emb', label: 'Input Embedding' },
        { id: 'add', label: 'Add &\nNorm' },
        { id: 'MHA', label: 'Multi-Head Attention' },
      ],
      edges: ['Input Embedding -> mha', 'multi-head attention -> Add & Norm'],
    });
    clean(result);
    expect(pairs(model(result))).toEqual(['emb->MHA', 'MHA->add']);
  });

  it('warns about a label shared by several nodes and drops the edge', () => {
    const result = run({ nodes: [{ id: 'm1', label: 'MatMul' }, { id: 'm2', label: 'MatMul' }, 'x'], edges: ['x -> MatMul'] });
    expect(model(result).edges).toEqual([]);
    const warning = one(result, 'edge.ambiguous-node');
    expect(warning.message).toContain('"m1", "m2"');
    expect(covered(result, warning)).toBe('MatMul');
  });

  it('warns about ids that differ only in case', () => {
    const result = run({ nodes: ['qq', 'QQ', 'x'], edges: ['x -> Qq'] });
    expect(model(result).edges).toEqual([]);
    one(result, 'edge.ambiguous-node');
  });

  it('drops an edge to an unknown node, pointing at the name, with a suggestion', () => {
    const result = run({ nodes: base, edges: ['q -> matmull'] });
    expect(model(result).edges).toEqual([]);
    const warning = one(result, 'edge.unknown-node');
    expect(warning.severity).toBe('warning');
    expect(warning.message).toContain('Did you mean "matmul"?');
    expect(warning.message).toContain('dropped');
    expect(covered(result, warning)).toBe('matmull');
    expect(warning.path).toBe('edges[0]');
  });

  it('suggests an id the name extends or truncates', () => {
    const result = run({ nodes: ['attention_block', 'x'], edges: ['x -> attention'] });
    expect(one(result, 'edge.unknown-node').message).toContain('Did you mean "attention_block"?');
  });

  it('does not suggest wildly different ids for short names', () => {
    const result = run({ nodes: ['abc', 'x'], edges: ['x -> xyz'] });
    expect(one(result, 'edge.unknown-node').message).not.toContain('Did you mean');
  });

  it('keeps the rest of a fan-out when one end is unknown', () => {
    const result = run({ nodes: base, edges: ['q -> k, nope, v'] });
    expect(pairs(model(result))).toEqual(['q->k', 'q->v']);
    one(result, 'edge.unknown-node');
  });

  it('refuses the root as an endpoint', () => {
    const result = run({ nodes: ['a'], edges: [`a -> ${ROOT_ID}`] });
    expect(model(result).edges).toEqual([]);
    one(result, 'edge.root');
  });

  it('keeps self-loops and edges to groups', () => {
    const result = run({ nodes: ['a', { id: 'g', children: ['b'] }], edges: ['a -> a', 'a -> g', 'g -> b'] });
    clean(result);
    expect(pairs(model(result))).toEqual(['a->a', 'a->g', 'g->b']);
  });

  it('pins sides from shorthand, preferring a whole id that contains a dot', () => {
    const m = model(run({ nodes: ['a', 'b', 'x.top'], edges: ['a.right -> b.left', 'x.top -> a'] }));
    expect(edge(m, 'a', 'b')).toMatchObject({ fromSide: 'right', toSide: 'left' });
    expect(edge(m, 'x.top', 'a').fromSide).toBeNull();
  });

  it('reads a trailing ":label" only when the whole name is not an id containing a colon', () => {
    const declared = run({
      nodes: ['enc:out', 'dec'],
      edges: ['enc:out -> dec', 'dec -> enc:out', 'dec -> enc:out.left', 'enc:out -> dec:skip'],
    });
    clean(declared);
    const m = model(declared);
    expect(pairs(m)).toEqual(['enc:out->dec', 'dec->enc:out', 'dec->enc:out', 'enc:out->dec']);
    expect(m.edges.map((e) => text(e.label))).toEqual([null, null, null, 'skip']);
    expect(m.edges[2].toSide).toBe('left');

    // "enc" alone would match x by its label: the whole id must win, not a self-loop labelled "out".
    const misrouted = run({ nodes: [{ id: 'x', label: 'Enc' }, { id: 'enc:out', label: 'Encoder output' }], edges: ['x -> enc:out'] });
    clean(misrouted);
    expect(pairs(model(misrouted))).toEqual(['x->enc:out']);
    expect(model(misrouted).edges[0].label).toBeNull();
  });

  it('warns about malformed shorthand and drops it', () => {
    const result = run({ nodes: ['a', 'b'], edges: ['a b', 'a -> b'] });
    expect(pairs(model(result))).toEqual(['a->b']);
    const warning = one(result, 'edge.syntax');
    expect(warning).toMatchObject({ path: 'edges[0]', severity: 'warning' });
    expect(warning.message).toContain('"a -> b"');
  });

  it('reads edge objects and their aliases', () => {
    const result = run({
      nodes: base,
      edges: [
        { from: 'q', to: 'k' },
        { source: 'k', target: 'v' },
        { src: 'v', dst: 'matmul' },
        { start: 'matmul', end: 'scale' },
      ],
    });
    clean(result);
    expect(pairs(model(result))).toEqual(['q->k', 'k->v', 'v->matmul', 'matmul->scale']);
  });

  it('connects every source to every target', () => {
    const m = model(run({ nodes: ['h', 'ckv', 'kr', 'x'], edges: [{ from: ['h', 'x'], to: ['ckv', 'kr'], label: '$W^{DKV}$', line: 'dashed' }] }));
    expect(pairs(m)).toEqual(['h->ckv', 'h->kr', 'x->ckv', 'x->kr']);
    expect(m.edges.every((e) => e.line === 'dashed' && e.label?.hasMath)).toBe(true);
  });

  it('reads comma lists and side suffixes in object ends', () => {
    const m = model(run({ nodes: ['a', 'b', 'c'], edges: [{ from: 'a.bottom', to: 'b, c' }] }));
    expect(pairs(m)).toEqual(['a->b', 'a->c']);
    expect(m.edges[0].fromSide).toBe('bottom');
  });

  it('reads line, weight and arrow from values and flags', () => {
    const result = run({
      nodes: ['a', 'b'],
      edges: [
        { from: 'a', to: 'b', style: 'dotted' },
        { from: 'a', to: 'b', dashed: true },
        { from: 'a', to: 'b', thick: true },
        { from: 'a', to: 'b', thin: true },
        { from: 'a', to: 'b', weight: 'bold' },
        { from: 'a', to: 'b', weight: 2 },
        { from: 'a', to: 'b', arrow: false },
        { from: 'a', to: 'b', arrow: true },
        { from: 'a', to: 'b', arrows: 'both' },
        { from: 'a', to: 'b', bidirectional: true },
        { from: 'a', to: 'b', directed: false },
        { from: 'a', to: 'b', arrow: 'reverse' },
        { from: 'a', to: 'b', weight: 'normal', thick: true },
      ],
    });
    clean(result);
    const edges = model(result).edges;
    expect(edges.map((e) => e.line)).toEqual(['dotted', 'dashed', ...new Array(11).fill('solid')]);
    expect(edges.map((e) => e.weight)).toEqual([
      'normal', 'normal', 'thick', 'thin', 'thick', 'thick', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal',
    ]);
    expect(edges.map((e) => e.arrow)).toEqual([
      'end', 'end', 'end', 'end', 'end', 'end', 'none', 'end', 'both', 'both', 'none', 'start', 'end',
    ]);
  });

  it('reads a weight written as the line style', () => {
    const result = run({
      nodes: ['a', 'b'],
      edges: [
        { from: 'a', to: 'b', line: 'thick' },
        { from: 'a', to: 'b', line: 'bold' },
        { from: 'a', to: 'b', style: 'thin' },
        { from: 'a', to: 'b', line: 'thick', dashed: true },
        { from: 'a', to: 'b', line: 'thick', weight: 'thin' },
      ],
    });
    clean(result);
    expect(model(result).edges.map((e) => [e.line, e.weight])).toEqual([
      ['solid', 'thick'], ['solid', 'thick'], ['solid', 'thin'], ['dashed', 'thick'], ['solid', 'thin'],
    ]);
  });

  it.each([
    ['ortho', 'ortho'], ['orthogonal', 'ortho'], ['straight', 'straight'], ['line', 'straight'], ['direct', 'straight'],
    ['curved', 'curved'], ['curve', 'curved'], ['spline', 'curved'], ['bezier', 'curved'],
  ])('route %s → %s', (route, expected) => {
    expect(model(run({ nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b', route }] })).edges[0].route).toBe(expected);
  });

  it('reads the edge kind and its effect on ranking', () => {
    const m = model(
      run({
        nodes: ['a', 'b'],
        edges: [
          { from: 'a', to: 'b', kind: 'residual' },
          { from: 'a', to: 'b', type: 'skip' },
          { from: 'a', to: 'b', kind: 'feedback' },
          { from: 'a', to: 'b', residual: true },
          { from: 'a', to: 'b', feedback: true, constraint: true },
          { from: 'a', to: 'b', constraint: false },
        ],
      }),
    );
    expect(m.edges.map((e) => [e.kind, e.constraint])).toEqual([
      ['residual', true],
      ['skip', true],
      ['feedback', false],
      ['residual', true],
      ['feedback', true],
      ['flow', false],
    ]);
  });

  it('reads pinned sides, tone and label from an object', () => {
    const result = run({
      nodes: ['a', 'b'],
      edges: [{ from: 'a', to: 'b', exit: 'east', enter: 'N', color: 'red', text: 'x' }, { from: 'a', to: 'b', fromSide: 'middle' }],
    });
    const [first, second] = model(result).edges;
    expect(first).toMatchObject({ fromSide: 'right', toSide: 'top', tone: 'red' });
    expect(text(first.label)).toBe('x');
    expect(second.fromSide).toBeNull();
    expect(one(result, 'edge.invalid-value').path).toBe('edges[1].fromSide');
  });

  it('keeps explicit edge ids unique and apart from item ids', () => {
    const m = model(run({ nodes: ['a', 'b', 'e2'], edges: [{ id: 'link', from: 'a', to: ['a', 'b'] }, 'a -> b', { id: 'a', from: 'b', to: 'a' }] }));
    expect(m.edges.map((e) => e.id)).toEqual(['link', 'link-2', 'e3', 'a-2']);
  });

  it('warns about an edge object without both ends', () => {
    const result = run({ nodes: ['a'], edges: [{ from: 'a' }, { to: 'a' }] });
    expect(model(result).edges).toEqual([]);
    expect(find(result, 'edge.missing-endpoint').map((d) => d.path)).toEqual(['edges[0]', 'edges[1]']);
  });

  it('warns about unknown edge keys', () => {
    const result = run({ nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b', lable: 'x', thickness: 2 }] });
    const warnings = find(result, 'edge.unknown-key');
    expect(warnings.map((d) => d.path)).toEqual(['edges[0].lable', 'edges[0].thickness']);
    expect(warnings[0].message).toContain('Did you mean "label"?');
    expect(warnings[1].message).toContain('Did you mean "weight"?');
  });

  it('reads [from, to, label] tuples', () => {
    const m = model(run({ nodes: ['a', 'b'], edges: [['a', 'b'], ['b', 'a', 'back']] }));
    expect(pairs(m)).toEqual(['a->b', 'b->a']);
    expect(text(m.edges[1].label)).toBe('back');
  });

  it('warns about edge entries it cannot read', () => {
    const result = run({ nodes: ['a'], edges: [42, null, ['a']] });
    expect(find(result, 'edge.invalid').map((d) => d.path)).toEqual(['edges[0]', 'edges[1]', 'edges[2]']);
  });

  it('reads edges written as one multi-line string', () => {
    const result = run({ nodes: ['a', 'b', 'c'], edges: 'a -> b\nb -> c; c --> a: $x;y$' });
    clean(result);
    const m = model(result);
    expect(pairs(m)).toEqual(['a->b', 'b->c', 'c->a']);
    expect(m.edges[2].line).toBe('dashed');
    expect(m.edges[2].label?.source).toBe('$x;y$');
  });

  it('points at the exact name on any line of a multi-line edges string', () => {
    const result = run({ nodes: ['a', 'b'], edges: 'a -> b\nb -> zz' });
    const warning = one(result, 'edge.unknown-node');
    expect(covered(result, warning)).toBe('zz');
    expect(warning.message).toContain('"b -> zz"');
  });

  it('reports an unknown node in the middle of a chain once', () => {
    const result = run({ nodes: ['a', 'c'], edges: ['a -> bb -> c'] });
    expect(model(result).edges).toEqual([]);
    expect(covered(result, one(result, 'edge.unknown-node'))).toBe('bb');
  });

  it('points a too-long shorthand label at the label', () => {
    const label = 'x'.repeat(MAX_LABEL_CHARS + 1);
    const result = run({ nodes: ['a', 'b'], edges: [`a -> b: ${label}`] });
    expect(covered(result, one(result, 'label.too-long'))).toBe(label);
    expect(model(result).edges[0].label?.source.endsWith('…')).toBe(true);
  });

  it('adds edges from a node\'s "to" key', () => {
    const result = run({ nodes: [{ id: 'a', to: ['b', 'c.left'] }, { id: 'b', to: 'c' }, 'c', { id: 'd', to: [{ to: 'a', label: 'back', kind: 'feedback' }] }] });
    clean(result);
    const m = model(result);
    expect(pairs(m)).toEqual(['a->b', 'a->c', 'b->c', 'd->a']);
    expect(edge(m, 'a', 'c').toSide).toBe('left');
    expect(edge(m, 'd', 'a')).toMatchObject({ kind: 'feedback', constraint: false });
    expect(edge(m, 'a', 'b').path).toBe('nodes[0].to[0]');
  });

  it('reads edges listed inside a group', () => {
    const m = model(run({ nodes: [{ id: 'g', children: ['a', 'b'], edges: ['a -> b'] }] }));
    expect(pairs(m)).toEqual(['a->b']);
    expect(m.edges[0].path).toBe('nodes[0].edges[0]');
  });

  it('orders edges by where they are written', () => {
    const source = `{
      "edges": ["c -> a"],
      "nodes": [{"id": "a", "to": "b"}, "b", {"id": "c", "children": ["d"], "edges": ["d -> b"]}]
    }`;
    expect(pairs(model(run(source)))).toEqual(['c->a', 'a->b', 'd->b']);
  });

  it('caps the edge count with an error', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `n${i}`);
    const result = run({ nodes: ids, edges: [{ from: ids, to: ids }] });
    expect(model(result).edges).toHaveLength(MAX_FIGURE_EDGES);
    expect(one(result, 'spec.too-many-edges').severity).toBe('error');
  });

  it('reads a long chain or edges string in linear time, stopping at the edge cap', () => {
    for (const edges of [[`a${' -> b -> a'.repeat(4000)}`], 'a -> b\n'.repeat(4000)]) {
      const started = performance.now();
      const result = run({ nodes: ['a', 'b'], edges });
      const elapsed = performance.now() - started;
      expect(model(result).edges).toHaveLength(MAX_FIGURE_EDGES);
      expect(one(result, 'spec.too-many-edges').severity).toBe('error');
      // Quadratic source mapping took over ten seconds here.
      expect(elapsed).toBeLessThan(1500);
    }
  });
});

/* ─── Limits ─── */

describe('normalizeFigure: item limit', () => {
  it('drops items past the limit with one error, and edges to them quietly', () => {
    const ids = Array.from({ length: MAX_FIGURE_ITEMS + 5 }, (_, i) => `n${i}`);
    const last = ids[ids.length - 1];
    const result = run({ nodes: ids, edges: [`n0 -> n1`, `n0 -> ${last}`], groups: [{ id: 'late', children: ['n0'] }] });
    const m = model(result);
    expect(m.items.size).toBe(MAX_FIGURE_ITEMS);
    expect(m.items.has(last)).toBe(false);
    expect(pairs(m)).toEqual(['n0->n1']);
    expect(codes(result)).toEqual(['spec.too-many-items']);
    expect(node(m, 'n0').parent).toBe(ROOT_ID);
  });

  it('never gives a derived id to an item that was dropped', () => {
    const ids = Array.from({ length: MAX_FIGURE_ITEMS }, (_, i) => `n${i}`);
    const result = run({ nodes: [{ label: 'Kept' }, ...ids.slice(0, -1), 'dropped', { id: 'x', label: 'late' }], edges: ['kept -> dropped'] });
    const m = model(result);
    expect(m.items.has('dropped')).toBe(false);
    expect(m.edges).toEqual([]);
    expect(find(result, 'edge.unknown-node')).toEqual([]);
  });
});

/* ─── Legend ─── */

describe('normalizeFigure: legend', () => {
  it('reads node swatches and edge samples', () => {
    const result = run({
      nodes: ['a'],
      legend: [
        { label: 'Cached during inference', tone: 'teal', pattern: 'hatch' },
        { label: 'Applied only at training time', line: 'dashed' },
        { label: 'Attention', role: 'attention' },
        { label: 'Optional', dashed: true },
        { label: 'Data flow', edge: true, weight: 'thick', color: 'blue' },
        { label: 'Both ways', arrow: 'both', style: 'dotted' },
        { label: 'Frozen', cached: true, style: 'bold', shape: 'round' },
        'Plain',
      ],
    });
    clean(result);
    const legend = model(result).legend;
    expect(legend.map((entry) => text(entry.label))).toEqual([
      'Cached during inference', 'Applied only at training time', 'Attention', 'Optional', 'Data flow', 'Both ways', 'Frozen', 'Plain',
    ]);
    expect(legend.map((entry) => entry.sample)).toEqual([
      { kind: 'node', tone: 'teal', shape: 'box', pattern: 'hatch', border: 'solid' },
      { kind: 'edge', line: 'dashed', weight: 'normal', tone: null },
      { kind: 'node', tone: 'orange', shape: 'box', pattern: 'none', border: 'solid' },
      { kind: 'node', tone: 'neutral', shape: 'box', pattern: 'none', border: 'dashed' },
      { kind: 'edge', line: 'solid', weight: 'thick', tone: 'blue' },
      { kind: 'edge', line: 'dotted', weight: 'normal', tone: null },
      { kind: 'node', tone: 'neutral', shape: 'round', pattern: 'hatch', border: 'bold' },
      { kind: 'node', tone: 'neutral', shape: 'box', pattern: 'none', border: 'solid' },
    ]);
  });

  it('reads a weight as the line style, and weight keys alone, as edge samples', () => {
    const result = run({
      nodes: ['a'],
      legend: [
        { line: 'thick', label: 'Cell state $c_t$' },
        { line: 'solid', label: 'Hidden state $h_t$' },
        { label: 'Gradient', weight: 'thick' },
        { label: 'Skip', thick: true, dashed: true },
        { label: 'Aux', thin: true },
        { label: 'Bold', edge: true, style: 'bold' },
      ],
    });
    clean(result);
    expect(model(result).legend.map((entry) => entry.sample)).toEqual([
      { kind: 'edge', line: 'solid', weight: 'thick', tone: null },
      { kind: 'edge', line: 'solid', weight: 'normal', tone: null },
      { kind: 'edge', line: 'solid', weight: 'thick', tone: null },
      { kind: 'edge', line: 'dashed', weight: 'thick', tone: null },
      { kind: 'edge', line: 'solid', weight: 'thin', tone: null },
      { kind: 'edge', line: 'solid', weight: 'thick', tone: null },
    ]);
  });

  it('drops entries without a label and entries it cannot read', () => {
    const result = run({ nodes: ['a'], legend: [{ tone: 'red' }, 42, ''] });
    expect(model(result).legend).toEqual([]);
    expect(codes(result)).toEqual(['legend.missing-label', 'legend.invalid', 'legend.missing-label']);
  });

  it('warns about a legend that is not a list, and about unknown keys', () => {
    const notList = run({ nodes: ['a'], legend: { label: 'x' } });
    expect(one(notList, 'legend.invalid-value').path).toBe('legend');
    const unknown = run({ nodes: ['a'], legend: [{ label: 'x', colr: 'red' }] });
    expect(one(unknown, 'legend.unknown-key').path).toBe('legend[0].colr');
  });
});

/* ─── Diagnostics ─── */

describe('normalizeFigure: diagnostics', () => {
  it('orders errors, then warnings, then notes, stable within each', () => {
    const ids = Array.from({ length: MAX_FIGURE_ITEMS + 1 }, (_, i) => `n${i}`);
    const result = run({ nodes: [{ id: 'n0', shape: 'blob' }, ...ids.slice(1)], bogus: 1, edges: ['n0 -> nx', 'n0 b'], size: 'column' });
    const severities = result.diagnostics.map((d) => d.severity);
    expect(severities).toEqual([...severities].sort((a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b)));
    expect(codes(result)).toEqual(['spec.too-many-items', 'spec.unknown-key', 'item.unknown-shape', 'edge.unknown-node', 'edge.syntax']);
  });

  it('points at the offending source text, with line and column', () => {
    const source = '{\n  "nodes": [\n    {"id": "a", "shape": "rectangel"}\n  ]\n}';
    const result = run(source);
    const warning = one(result, 'item.unknown-shape');
    expect(warning).toMatchObject({ path: 'nodes[0].shape', line: 3, column: 26 });
    expect(covered(result, warning)).toBe('"rectangel"');
  });

  it('leaves line and column to the caller when no source is given', () => {
    const result = run({ nodes: [{ id: 'a', shape: 'rectangel' }] }, { withSource: false });
    const warning = one(result, 'item.unknown-shape');
    expect(warning.range).toBeDefined();
    expect(warning.line).toBeUndefined();
    expect(warning.column).toBeUndefined();
  });

  it('maps names back through escapes when the source is known', () => {
    // `\u0062` is "b": the name reads "bb" but is written with an escape.
    const escaped = String.raw`\u0062b`;
    const source = `{"nodes": ["a"], "edges": ["a -> ${escaped}: $\\alpha$ \\"q\\"", "a -> cc: $\\\\beta$", "a\\t-> dd"]}`;
    const result = run(source);
    expect(find(result, 'edge.unknown-node').map((d) => covered(result, d))).toEqual([escaped, 'cc', 'dd']);
  });

  it('points at the whole string when escapes shift the offsets and the source is unknown', () => {
    const escaped = String.raw`\u0062b`;
    const source = `{"nodes": ["a"], "edges": ["a -> ${escaped}", "a -> cc"]}`;
    const result = run(source, { withSource: false });
    expect(find(result, 'edge.unknown-node').map((d) => covered(result, d))).toEqual([`"a -> ${escaped}"`, 'cc']);
  });

  it('points at the item for a problem with no key of its own', () => {
    const result = run({ nodes: [{ id: 't', shape: 'tensor' }] });
    const warning = one(result, 'tensor.no-cells');
    expect(covered(result, warning)?.startsWith('{')).toBe(true);
  });

  it('caps a very long problems list', () => {
    const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, shape: 'blob' }));
    const result = run({ nodes });
    expect(result.diagnostics).toHaveLength(200);
    expect(result.diagnostics[199]).toMatchObject({ code: 'spec.more-problems', severity: 'info' });
    expect(result.diagnostics[199].message).toContain('101 more');
  });

  it('is deterministic', () => {
    const spec = {
      nodes: ['a', { label: 'B b' }, { id: 'g', children: ['a', 'x'], panel: true }],
      edges: ['a -> b-b', 'x -> nope'],
      legend: [{ label: 'L', line: 'dashed' }],
    };
    const first = run(spec);
    const second = run(spec);
    expect(second.diagnostics).toEqual(first.diagnostics);
    expect([...model(second).items.entries()]).toEqual([...model(first).items.entries()]);
    expect(model(second).edges).toEqual(model(first).edges);
  });
});

/* ─── A realistic spec ─── */

describe('normalizeFigure: a full figure', () => {
  it('reads scaled dot-product attention cleanly', () => {
    const source = String.raw`{
      // Vaswani et al. 2017, Fig. 2 (left)
      caption: 'Scaled dot-product attention.',
      "direction": "up",
      "nodes": [
        {"id": "q", "label": "Q", "role": "input"},
        {"id": "k", "label": "K", "role": "input"},
        {"id": "v", "label": "V", "role": "input"},
        {"id": "mm1", "label": "MatMul", "role": "linear"},
        {"id": "scale", "label": "Scale", "role": "norm", "sublabel": "$1/\sqrt{d_k}$"},
        {"id": "mask", "label": "Mask (opt.)", "role": "attention", "border": "dashed"},
        {"id": "sm", "label": "SoftMax", "role": "activation"},
        {"id": "mm2", "label": "MatMul", "role": "linear"},
      ],
      "edges": ["q, k -> mm1 -> scale -> mask -> sm -> mm2", "v -> mm2"],
    }`;
    const result = run(source);
    expect(result.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    const m = model(result);
    expect(m.caption).toBe('Scaled dot-product attention.');
    expect(m.root.direction).toBe('up');
    expect(m.edges).toHaveLength(7);
    expect(node(m, 'scale').sublabel?.hasMath).toBe(true);
    expect(node(m, 'mask').border).toBe('dashed');
  });
});
