import { beforeEach, describe, expect, it } from 'vitest';
import { FIGURE_METRICS } from '../constants';
import { labelArea } from '../geometry';
import { LABEL_ROOM } from '../layered';
import { layoutFigure } from '../layout';
import { routeFigure } from '../route';
import {
  ROOT_ID,
  type EdgeModel,
  type FigureLayout,
  type FigureModel,
  type GroupModel,
  type ItemModel,
  type Label,
  type LabelSegment,
  type LegendItemModel,
  type NodeModel,
  type Point,
  type Rect,
  type SceneNode,
  type TextMeasurer,
} from '../types';

const M = FIGURE_METRICS;
const EPS = 1e-6;

/** 6.5px per character at 12px; line height 1.25em. Maths measures its LaTeX source the same way. */
const measurer: TextMeasurer = {
  key: 'test',
  text: (value, font) => ({ width: (value.length * 6.5 * font.size) / 12, height: font.size * 1.25 }),
  math: (latex, font) => ({ width: (latex.length * 6.5 * font.size) / 12, height: font.size * 1.25 }),
};

/** A label built by hand: `\n` splits lines, `$…$` is maths. */
function label(text: string): Label {
  const lines = text.split('\n').map((line) => {
    const segments: LabelSegment[] = [];
    line.split('$').forEach((part, i) => {
      if (part) segments.push({ kind: i % 2 === 1 ? 'math' : 'text', value: part });
    });
    return segments;
  });
  return { lines, source: text, hasMath: text.includes('$') };
}

let order = 0;
beforeEach(() => {
  order = 0;
});

function node(id: string, extra: Partial<NodeModel> & { text?: string } = {}): NodeModel {
  const { text, ...rest } = extra;
  return {
    kind: 'node',
    id,
    parent: ROOT_ID,
    order: order++,
    path: `nodes.${id}`,
    label: label(text ?? id),
    sublabel: null,
    shape: 'box',
    op: null,
    tone: 'neutral',
    border: 'solid',
    pattern: 'none',
    bold: false,
    italic: false,
    stack: 1,
    badge: null,
    cells: null,
    src: null,
    width: null,
    height: null,
    rank: null,
    beside: null,
    sameRank: null,
    ...rest,
  };
}

function group(id: string, children: string[], extra: Partial<GroupModel> = {}): GroupModel {
  return {
    kind: 'group',
    id,
    parent: ROOT_ID,
    order: order++,
    path: `groups.${id}`,
    label: null,
    children,
    layout: 'flow',
    direction: 'down',
    columns: 2,
    align: 'center',
    gap: null,
    tone: 'neutral',
    border: 'dashed',
    filled: false,
    repeat: null,
    panel: null,
    uniform: false,
    labelPosition: 'top',
    rank: null,
    beside: null,
    sameRank: null,
    ...extra,
  };
}

function edge(spec: string, extra: Partial<EdgeModel> = {}): EdgeModel {
  const [from, to] = spec.split('->').map((s) => s.trim());
  return {
    id: spec,
    from,
    to,
    fromSide: null,
    toSide: null,
    label: null,
    line: 'solid',
    weight: 'normal',
    arrow: 'end',
    route: 'ortho',
    kind: 'flow',
    constraint: true,
    tone: null,
    order: order++,
    path: `edges.${spec}`,
    ...extra,
  };
}

/** A model whose parents follow the groups' `children`; items no group claims belong to the root. */
function figure(
  items: ItemModel[],
  edges: EdgeModel[] = [],
  options: { root?: Partial<GroupModel>; legend?: LegendItemModel[]; font?: 'sans' | 'serif' } = {},
): FigureModel {
  const claimed = new Set<string>();
  const map = new Map<string, ItemModel>();
  for (const item of items) map.set(item.id, item);
  for (const item of items) {
    if (item.kind !== 'group') continue;
    for (const child of item.children) {
      claimed.add(child);
      const found = map.get(child);
      if (found) found.parent = item.id;
    }
  }
  const root = group(
    ROOT_ID,
    items.filter((item) => !claimed.has(item.id)).map((item) => item.id),
    options.root,
  );
  return {
    title: null,
    caption: null,
    label: null,
    alt: null,
    size: 'auto',
    font: options.font ?? 'sans',
    palette: 'color',
    root,
    items: map,
    edges,
    legend: options.legend ?? [],
  };
}

function nodeOf(layout: FigureLayout, id: string): SceneNode {
  const found = layout.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`no node ${id}`);
  return found;
}

function groupOf(layout: FigureLayout, id: string) {
  const found = layout.groups.find((g) => g.id === id);
  if (!found) throw new Error(`no group ${id}`);
  return found;
}

const cx = (r: Rect) => r.x + r.width / 2;
const cy = (r: Rect) => r.y + r.height / 2;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x + a.width > b.x + EPS && b.x + b.width > a.x + EPS && a.y + a.height > b.y + EPS && b.y + b.height > a.y + EPS;
}

/** Whether the axis-aligned segment a→b passes through the interior of `rect`. */
function segmentCrosses(a: Point, b: Point, rect: Rect): boolean {
  return (
    Math.max(a.x, b.x) > rect.x &&
    Math.min(a.x, b.x) < rect.x + rect.width &&
    Math.max(a.y, b.y) > rect.y &&
    Math.min(a.y, b.y) < rect.y + rect.height
  );
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.width <= outer.x + outer.width + EPS &&
    inner.y + inner.height <= outer.y + outer.height + EPS
  );
}

/** Every structural invariant a layout must hold, whatever the spec. */
function expectSound(model: FigureModel, layout: FigureLayout): void {
  const boundsOf = (id: string): Rect => {
    const n = layout.nodes.find((x) => x.id === id);
    if (n) return n.bounds;
    return groupOf(layout, id).bounds;
  };
  const containers = [model.root, ...[...model.items.values()].filter((i): i is GroupModel => i.kind === 'group')];
  for (const container of containers) {
    const kids = container.children.filter((id) => model.items.has(id));
    // Siblings never overlap.
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        expect(overlaps(boundsOf(kids[i]), boundsOf(kids[j]))).toBe(false);
      }
    }
    // Children stay inside their group's box.
    if (container.id !== ROOT_ID) {
      const box = groupOf(layout, container.id).box;
      for (const id of kids) expect(contains(box, boundsOf(id))).toBe(true);
    }
  }
  // Everything is inside the figure, margin included.
  const canvas = {
    x: M.margin - EPS,
    y: M.margin - EPS,
    width: layout.width - 2 * M.margin + 2 * EPS,
    height: layout.height - 2 * M.margin + 2 * EPS,
  };
  for (const n of layout.nodes) {
    expect(contains(canvas, n.bounds)).toBe(true);
    expect(contains(n.bounds, n.shape)).toBe(true);
    expect(contains(n.bounds, n.anchor)).toBe(true);
    for (const box of [n.label, n.sublabel, n.repeat, n.badge]) if (box) expect(contains(n.bounds, box)).toBe(true);
  }
  for (const g of layout.groups) {
    expect(contains(canvas, g.bounds)).toBe(true);
    for (const box of [g.label, g.repeat, g.panel]) if (box) expect(contains(g.bounds, box)).toBe(true);
    if (g.label) expect(contains(g.box, g.label)).toBe(true);
  }
  if (layout.legend) {
    expect(contains(canvas, layout.legend.box)).toBe(true);
    for (const item of layout.legend.items) {
      expect(contains(layout.legend.box, item.swatch)).toBe(true);
      expect(contains(layout.legend.box, item.label)).toBe(true);
    }
  }
}

describe('layoutFigure — nodes', () => {
  it('sizes a box around its label and adds the margin', () => {
    const model = figure([node('a', { text: 'Linear' })]);
    const layout = layoutFigure(model, measurer);
    const a = nodeOf(layout, 'a');
    // "Linear" = 6 × 6.5 = 39px wide, 15px tall.
    expect(a.shape).toEqual({ x: M.margin, y: M.margin, width: 39 + 2 * M.node.padX, height: 15 + 2 * M.node.padY });
    expect(layout.width).toBe(a.shape.width + 2 * M.margin);
    expect(layout.height).toBe(a.shape.height + 2 * M.margin);
    expect(a.label).toMatchObject({ width: 39, height: 15 });
    expect(cx(a.label!)).toBeCloseTo(cx(a.shape), 9);
    expect(cy(a.label!)).toBeCloseTo(cy(a.shape), 9);
    expect(a.depth).toBe(1);
    expect(a.direction).toBe('down');
    expect(a.stackOffset).toBe(0);
    expectSound(model, layout);
  });

  it('keeps short labels at the minimum box width', () => {
    const layout = layoutFigure(figure([node('x')]), measurer);
    expect(nodeOf(layout, 'x').shape).toMatchObject({ width: M.node.minWidth, height: 15 + 2 * M.node.padY });
    order = 0;
    const blank = layoutFigure(figure([node('x', { text: '' })]), measurer);
    expect(nodeOf(blank, 'x').shape).toMatchObject({ width: M.node.minWidth, height: M.node.minHeight });
    expect(nodeOf(blank, 'x').label).toBeNull();
  });

  it('fits every inside label within its shape’s label area', () => {
    const shapes = ['box', 'round', 'circle', 'diamond', 'funnel', 'expand', 'parallelogram', 'hexagon', 'cylinder', 'document', 'text'] as const;
    for (const direction of ['down', 'right'] as const) {
      order = 0;
      const items = shapes.map((shape, i) =>
        node(`n${i}`, { shape, text: i % 2 ? 'Multi-head\nattention block' : 'Feed forward', sublabel: label('$B\\times T$') }),
      );
      const model = figure(items, [], { root: { direction } });
      const layout = layoutFigure(model, measurer);
      for (const n of layout.nodes) {
        const area = labelArea(n.model.shape, n.shape, n.direction);
        expect(contains(area, n.label!)).toBe(true);
        expect(contains(area, n.sublabel!)).toBe(true);
        expect(n.sublabel!.y).toBeGreaterThanOrEqual(n.label!.y + n.label!.height + M.node.sublabelGap - EPS);
      }
      expectSound(model, layout);
    }
  });

  it('sizes the shapes by their own rules', () => {
    const model = figure([
      node('round', { shape: 'round', text: 'Model' }),
      node('circle', { shape: 'circle', text: 'σ' }),
      node('ellipse', { shape: 'circle', text: 'Environment state' }),
      node('diamond', { shape: 'diamond', text: 'ok?' }),
      node('cyl', { shape: 'cylinder', text: 'KV' }),
      node('doc', { shape: 'document', text: 'Prompt' }),
      node('txt', { shape: 'text', text: 'Input' }),
    ]);
    const layout = layoutFigure(model, measurer);
    // round: the box plus 0.35 of its height.
    expect(nodeOf(layout, 'round').shape.width).toBeCloseTo(Math.max(44, 32.5 + 24) + 29 * 0.35, 9);
    // circle: a disc around a short label, 14px larger than the label.
    expect(nodeOf(layout, 'circle').shape).toMatchObject({ width: 15 + 14, height: 15 + 14 });
    const ellipse = nodeOf(layout, 'ellipse').shape;
    expect(ellipse.width).toBeCloseTo(17 * 6.5 * 1.2 + 18, 9);
    expect(ellipse.height).toBeCloseTo(Math.max(28, 15 * 1.3 + 12), 9);
    expect(nodeOf(layout, 'diamond').shape).toMatchObject({ width: Math.max(40, 19.5 * 1.6 + 20), height: 15 * 1.6 + 14 });
    expect(nodeOf(layout, 'cyl').shape.height).toBe(29 + 12);
    expect(nodeOf(layout, 'doc').shape.height).toBe(29 + 6);
    expect(nodeOf(layout, 'txt').shape).toMatchObject({ width: 32.5 + 4, height: 15 + 2 });
  });

  it('orients funnels by the parent flow', () => {
    const vertical = layoutFigure(figure([node('f', { shape: 'funnel', text: 'Encoder' })]), measurer);
    const f = nodeOf(vertical, 'f').shape;
    expect(f.height).toBe(29);
    expect(f.width).toBeCloseTo(45.5 + 24 + 0.9 * 29, 9);
    order = 0;
    const horizontal = layoutFigure(figure([node('f', { shape: 'funnel', text: 'Encoder' })], [], { root: { direction: 'right' } }), measurer);
    const g = nodeOf(horizontal, 'f');
    expect(g.shape).toMatchObject({ width: 45.5 + 24, height: 29 + 20 });
    expect(g.direction).toBe('right');
  });

  it('draws an operator glyph as a bare circle with the sublabel beside it', () => {
    const model = figure([node('add', { shape: 'op', op: 'plus', text: '+', sublabel: label('residual') })]);
    const n = nodeOf(layoutFigure(model, measurer), 'add');
    expect(n.shape).toMatchObject({ width: M.node.opDiameter, height: M.node.opDiameter });
    expect(n.label).toBeNull();
    expect(n.anchor).toEqual(n.shape);
    expect(n.sublabel!.x).toBeCloseTo(n.shape.x + n.shape.width + M.node.externalLabelGap, 9);
    expect(cy(n.sublabel!)).toBeCloseTo(cy(n.shape), 9);
  });

  it('grows a text operator around its label', () => {
    const n = nodeOf(layoutFigure(figure([node('s', { shape: 'op', text: 'softmax' })]), measurer), 's');
    expect(n.shape.width).toBeCloseTo(45.5 + 8, 9);
    expect(n.shape.height).toBe(n.shape.width);
    expect(n.label).not.toBeNull();
  });

  it('honours an explicit size and wraps the label to it', () => {
    const model = figure([node('a', { text: 'a rather long label that wraps', width: 90, height: 60 })]);
    const n = nodeOf(layoutFigure(model, measurer), 'a');
    expect(n.shape).toMatchObject({ width: 90, height: 60 });
    expect(n.label!.width).toBeLessThanOrEqual(90 - 2 * M.node.padX + EPS);
    expect(n.label!.lines.length).toBeGreaterThan(1);
  });

  it('counts a label that overflows a too-small fixed size in the bounds', () => {
    const model = figure([node('a', { text: 'one\ntwo\nthree\nfour', height: 20 }), node('b')], [edge('a -> b')]);
    const layout = layoutFigure(model, measurer);
    const a = nodeOf(layout, 'a');
    expect(a.shape.height).toBe(20);
    expect(a.label!.height).toBe(60);
    expect(contains(a.bounds, a.label!)).toBe(true);
    expectSound(model, layout);
  });

  it('clamps an explicit size into range', () => {
    const n = nodeOf(layoutFigure(figure([node('a', { width: 5000, height: 2 })]), measurer), 'a');
    expect(n.shape).toMatchObject({ width: M.node.maxFixed, height: M.node.minFixed });
  });

  it('wraps long labels at the label width limit', () => {
    const long = 'this label goes on and on well past the width a figure block should ever have';
    const n = nodeOf(layoutFigure(figure([node('a', { text: long })]), measurer), 'a');
    expect(n.label!.width).toBeLessThanOrEqual(M.labelMaxWidth + EPS);
    expect(n.label!.lines.length).toBeGreaterThan(1);
  });

  it('uses the figure font, weight and style', () => {
    const model = figure([node('a', { bold: true, italic: true }), node('b')], [], { font: 'serif' });
    const layout = layoutFigure(model, measurer);
    expect(nodeOf(layout, 'a').label!.font).toEqual({ family: 'serif', size: M.font.node, weight: 600, italic: true });
    expect(nodeOf(layout, 'b').label!.font).toEqual({ family: 'serif', size: M.font.node, weight: 400, italic: false });
  });

  it('grows a stack up and to the right', () => {
    const n = nodeOf(layoutFigure(figure([node('heads', { stack: 3 })]), measurer), 'heads');
    const lift = 2 * M.node.stackOffset;
    expect(n.stackOffset).toBe(M.node.stackOffset);
    expect(n.bounds).toEqual({ x: n.shape.x, y: n.shape.y - lift, width: n.shape.width + lift, height: n.shape.height + lift });
    expect(n.anchor).toEqual(n.shape);
  });

  it('pins a badge on the outermost top-right corner', () => {
    const n = nodeOf(layoutFigure(figure([node('kv', { badge: 'cached', stack: 2 })]), measurer), 'kv');
    const badge = n.badge!;
    const lift = M.node.stackOffset;
    expect(badge.width).toBeCloseTo((6 * 6.5 * 8.5) / 12 + 8, 9);
    expect(badge.height).toBeCloseTo(8.5 * 1.25 + 3, 9);
    expect(cx(badge)).toBeCloseTo(n.shape.x + n.shape.width + lift - 2, 9);
    expect(cy(badge)).toBeCloseTo(n.shape.y - lift, 9);
    expect(contains(n.bounds, badge)).toBe(true);
  });

  it('puts a node’s repeat marker beside it in a vertical flow and under it in a horizontal one', () => {
    const tagged = (id: string) => ({ ...node(id), repeat: '×8' });
    const down = nodeOf(layoutFigure(figure([tagged('a')]), measurer), 'a');
    expect(down.repeat!.x).toBeCloseTo(down.shape.x + down.shape.width + M.node.repeatGap, 9);
    expect(cy(down.repeat!)).toBeCloseTo(cy(down.shape), 9);
    expect(down.repeat!.font.weight).toBe(600);
    order = 0;
    const right = nodeOf(layoutFigure(figure([tagged('a')], [], { root: { direction: 'right' } }), measurer), 'a');
    expect(right.repeat!.y).toBeCloseTo(right.shape.y + right.shape.height + M.node.repeatGap, 9);
    expect(cx(right.repeat!)).toBeCloseTo(cx(right.shape), 9);
  });

  it('draws a tensor as a grid with its label underneath', () => {
    const cells = { rows: 8, cols: 8, text: null, values: null, pattern: 'lower' as const };
    const n = nodeOf(layoutFigure(figure([node('mask', { shape: 'tensor', cells, text: 'Causal' })]), measurer), 'mask');
    expect(n.shape).toMatchObject({ width: 88, height: 88 });
    expect(n.label!.y).toBeCloseTo(n.shape.y + 88 + M.node.externalLabelGap, 9);
    expect(cx(n.label!)).toBeCloseTo(cx(n.shape), 9);
    expect(contains(n.anchor, n.label!)).toBe(true);
    expect(contains(n.anchor, n.shape)).toBe(true);
  });

  it('shrinks big tensor grids to the extent limit, but not below the minimum cell', () => {
    const big = { rows: 40, cols: 40, text: null, values: null, pattern: 'none' as const };
    const long = { rows: 1, cols: 100, text: null, values: null, pattern: 'none' as const };
    const layout = layoutFigure(figure([node('big', { shape: 'tensor', cells: big }), node('long', { shape: 'tensor', cells: long })]), measurer);
    expect(nodeOf(layout, 'big').shape).toMatchObject({ width: M.tensor.maxExtent, height: M.tensor.maxExtent });
    expect(nodeOf(layout, 'long').shape).toMatchObject({ width: 100 * M.tensor.minCell, height: M.tensor.minCell });
  });

  it('sizes token cells to the widest token', () => {
    const cells = { rows: 1, cols: 3, text: [['[CLS]', 'the', 'cat']], values: null, pattern: 'none' as const };
    const n = nodeOf(layoutFigure(figure([node('tok', { shape: 'tensor', cells, text: '' })]), measurer), 'tok');
    // "[CLS]" at 10px: 5 × 6.5 × 10/12 ≈ 27.1, plus padding on both sides.
    const cell = (5 * 6.5 * 10) / 12 + 2 * M.tensor.textCellPad;
    expect(n.shape.width).toBeCloseTo(3 * cell, 9);
    expect(n.shape.height).toBe(M.tensor.textCellHeight);
    expect(n.label).toBeNull();
    expect(n.anchor).toEqual(n.shape);
  });

  it('gives an image its default or explicit size', () => {
    const layout = layoutFigure(figure([node('img', { shape: 'image', text: 'Input' }), node('fixed', { shape: 'image', width: 64, height: 48 })]), measurer);
    expect(nodeOf(layout, 'img').shape).toMatchObject({ width: M.node.imageWidth, height: M.node.imageHeight });
    expect(nodeOf(layout, 'fixed').shape).toMatchObject({ width: 64, height: 48 });
    expect(nodeOf(layout, 'img').label!.y).toBeGreaterThan(nodeOf(layout, 'img').shape.y + M.node.imageHeight);
  });
});

describe('layoutFigure — flow', () => {
  it('aligns a chain perfectly on the anchor centres', () => {
    const model = figure(
      [node('x', { shape: 'text', text: 'Input' }), node('attn', { text: 'Multi-Head Attention', stack: 3 }), node('add', { shape: 'op', op: 'plus', text: '+' }), node('ffn', { text: 'Feed Forward', badge: 'new' })],
      [edge('x -> attn'), edge('attn -> add'), edge('add -> ffn')],
    );
    const layout = layoutFigure(model, measurer);
    const centres = ['x', 'attn', 'add', 'ffn'].map((id) => cx(nodeOf(layout, id).anchor));
    for (const c of centres) expect(Math.abs(c - centres[0])).toBeLessThan(EPS);
    const ys = ['x', 'attn', 'add', 'ffn'].map((id) => nodeOf(layout, id).bounds.y);
    for (let i = 1; i < ys.length; i += 1) {
      const above = nodeOf(layout, ['x', 'attn', 'add', 'ffn'][i - 1]).bounds;
      expect(ys[i] - (above.y + above.height)).toBeGreaterThanOrEqual(M.gap.rank - EPS);
    }
    expectSound(model, layout);
  });

  it('keeps the stack straight beside a residual edge', () => {
    const model = figure(
      [node('x'), node('attn', { text: 'Attention' }), node('add', { shape: 'op', op: 'plus', text: '+' })],
      [edge('x -> attn'), edge('attn -> add'), edge('x -> add', { kind: 'residual' })],
    );
    const layout = layoutFigure(model, measurer);
    const xs = ['x', 'attn', 'add'].map((id) => cx(nodeOf(layout, id).anchor));
    for (const c of xs) expect(c).toBeCloseTo(xs[0], 6);
    // The residual's channel sits to the left of the stack.
    expect(nodeOf(layout, 'attn').bounds.x).toBeGreaterThan(M.margin + M.gap.dummy);
  });

  it('puts rank 0 at the bottom when the flow goes up', () => {
    const model = figure([node('a'), node('b'), node('c')], [edge('a -> b'), edge('b -> c')], { root: { direction: 'up' } });
    const layout = layoutFigure(model, measurer);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => nodeOf(layout, id).shape);
    expect(a.y).toBeGreaterThan(b.y + b.height);
    expect(b.y).toBeGreaterThan(c.y + c.height);
    expect(c.y).toBeCloseTo(M.margin, 9);
    expect(layout.direction).toBe('up');
    expectSound(model, layout);
  });

  it('runs right and left along x', () => {
    for (const direction of ['right', 'left'] as const) {
      order = 0;
      const model = figure([node('a'), node('b'), node('c')], [edge('a -> b'), edge('b -> c')], { root: { direction } });
      const layout = layoutFigure(model, measurer);
      const [a, b, c] = ['a', 'b', 'c'].map((id) => nodeOf(layout, id).shape);
      if (direction === 'right') expect(a.x < b.x && b.x < c.x).toBe(true);
      else expect(a.x > b.x && b.x > c.x).toBe(true);
      expect(cy(a)).toBeCloseTo(cy(b), 6);
      expect(cy(b)).toBeCloseTo(cy(c), 6);
      expectSound(model, layout);
    }
  });

  it('keeps declaration order across a layer when nothing is gained', () => {
    const model = figure([node('src'), node('c'), node('a'), node('b')], [edge('src -> c'), edge('src -> a'), edge('src -> b')]);
    const layout = layoutFigure(model, measurer);
    const [c, a, b] = ['c', 'a', 'b'].map((id) => cx(nodeOf(layout, id).anchor));
    expect(c < a && a < b).toBe(true);
    expect(cx(nodeOf(layout, 'src').anchor)).toBeCloseTo(a, 6);
  });

  it('honours beside, sameRank and rank hints', () => {
    const model = figure(
      [
        node('x'),
        node('attn'),
        node('add', { shape: 'op', op: 'plus', text: '+' }),
        node('pe', { shape: 'text', text: 'Positional encoding', beside: { id: 'add', before: true } }),
        node('out'),
        node('note', { shape: 'text', sameRank: 'attn' }),
        node('late', { rank: 3 }),
      ],
      [edge('x -> attn'), edge('attn -> add'), edge('pe -> add'), edge('add -> out')],
    );
    const layout = layoutFigure(model, measurer);
    const pe = nodeOf(layout, 'pe');
    const add = nodeOf(layout, 'add');
    expect(cy(pe.bounds)).toBeCloseTo(cy(add.bounds), 6);
    expect(pe.bounds.x + pe.bounds.width).toBeLessThanOrEqual(add.bounds.x + EPS);
    expect(cy(nodeOf(layout, 'note').bounds)).toBeCloseTo(cy(nodeOf(layout, 'attn').bounds), 6);
    expect(cy(nodeOf(layout, 'late').bounds)).toBeCloseTo(cy(nodeOf(layout, 'out').bounds), 6);
    expect(layout.diagnostics).toEqual([]);
    expectSound(model, layout);
  });

  it('keeps a flow’s layers when `sameRank` names a sibling declared later', () => {
    const model = figure(
      [node('x1', { sameRank: 'c1' }), node('c0'), node('c1'), node('c2')],
      [edge('c0 -> c1'), edge('c1 -> c2'), edge('x1 -> c1')],
      { root: { direction: 'right' } },
    );
    const layout = layoutFigure(model, measurer);
    const [c0, c1, c2, x1] = ['c0', 'c1', 'c2', 'x1'].map((id) => nodeOf(layout, id).shape);
    expect(c0.x + c0.width).toBeLessThan(c1.x);
    expect(c1.x + c1.width).toBeLessThan(c2.x);
    expect(cx(x1)).toBeCloseTo(cx(c1), 6);
    expect(layout.diagnostics).toEqual([]);
    expectSound(model, layout);
  });

  it('passes the layered diagnostics through with the item’s path', () => {
    const model = figure([node('a'), node('b', { rank: 0, range: [5, 9] })], [edge('a -> b')]);
    const layout = layoutFigure(model, measurer);
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({ code: 'layout.rank-conflict', path: 'nodes.b.rank', range: [5, 9] }),
    ]);
  });

  it('ignores feedback edges when ranking', () => {
    const model = figure(
      [node('llm'), node('tool'), node('env')],
      [edge('llm -> tool'), edge('tool -> env'), edge('env -> llm', { kind: 'feedback', constraint: false })],
    );
    const layout = layoutFigure(model, measurer);
    const ys = ['llm', 'tool', 'env'].map((id) => nodeOf(layout, id).shape.y);
    expect(ys[0] < ys[1] && ys[1] < ys[2]).toBe(true);
  });

  it('runs a residual channel on the side its target is entered from', () => {
    const build = (toSide: 'left' | 'right' | null) => {
      order = 0;
      const model = figure(
        [node('x'), node('attn'), node('add', { shape: 'op', op: 'plus', text: '+' })],
        [edge('x -> attn'), edge('attn -> add'), edge('x -> add', { kind: 'residual', toSide })],
      );
      return layoutFigure(model, measurer);
    };
    const channel = M.gap.dummy + M.gap.dummy;
    // Unpinned residuals enter from the left, so the channel is on the left…
    expect(nodeOf(build(null), 'attn').bounds.x).toBeCloseTo(M.margin + channel, 9);
    // …and a pinned right side moves it to the right.
    const right = build('right');
    expect(nodeOf(right, 'attn').bounds.x).toBeCloseTo(M.margin, 9);
    expect(right.width).toBeCloseTo(nodeOf(right, 'attn').shape.width + channel + 2 * M.margin, 9);
  });

  it('keeps room beside a long edge for its label', () => {
    const model = figure(
      [node('x'), node('attn'), node('add')],
      [edge('x -> attn'), edge('attn -> add'), edge('x -> add', { kind: 'residual', toSide: 'right', label: label('identity') })],
    );
    const layout = layoutFigure(model, measurer);
    // "identity" at 10px is 8 × 6.5 × 10/12 wide, plus the label gap.
    const room = M.edge.labelGap + (8 * 6.5 * 10) / 12;
    expect(layout.width).toBeCloseTo(nodeOf(layout, 'attn').shape.width + 2 * M.gap.dummy + room + 2 * M.margin, 9);
  });

  it('leaves room for a loop against the flow and for self-loops', () => {
    const plain = layoutFigure(figure([node('a'), node('b')], [edge('a -> b')]), measurer);
    order = 0;
    const back = layoutFigure(
      figure([node('a'), node('b')], [edge('a -> b'), edge('b -> a', { kind: 'feedback', constraint: false })]),
      measurer,
    );
    expect(back.width - plain.width).toBeCloseTo(M.edge.stub + M.edge.clearance, 9);
    // The loop's room is past the items, so they do not move.
    expect(nodeOf(back, 'a').shape.x).toBeCloseTo(nodeOf(plain, 'a').shape.x, 9);
    order = 0;
    const self = layoutFigure(figure([node('a')], [edge('a -> a')]), measurer);
    expect(self.width - (M.node.minWidth + 2 * M.margin)).toBeCloseTo(16 + M.edge.clearance, 9);
    order = 0;
    const sideways = layoutFigure(figure([node('a'), node('b')], [edge('a -> b'), edge('b -> a', { kind: 'feedback', constraint: false })], { root: { direction: 'right' } }), measurer);
    expect(sideways.height - (29 + 2 * M.margin)).toBeCloseTo(M.edge.stub + M.edge.clearance, 9);
  });

  it('orders groups by the edges between their descendants', () => {
    const model = figure(
      [
        group('dec', ['d1', 'd2'], { label: label('Decoder') }),
        node('d1'),
        node('d2'),
        group('enc', ['e1', 'e2'], { label: label('Encoder') }),
        node('e1'),
        node('e2'),
      ],
      [edge('d1 -> d2'), edge('e1 -> e2'), edge('e2 -> d1')],
    );
    const layout = layoutFigure(model, measurer);
    const enc = groupOf(layout, 'enc').box;
    const dec = groupOf(layout, 'dec').box;
    expect(enc.y + enc.height).toBeLessThan(dec.y);
    expectSound(model, layout);
  });

  it('opens the layer gap for an edge label', () => {
    const plain = layoutFigure(figure([node('a'), node('b')], [edge('a -> b')]), measurer);
    order = 0;
    const tall = label('first\nsecond\nthird');
    const labelled = layoutFigure(figure([node('a'), node('b')], [edge('a -> b', { label: tall })]), measurer);
    const gap = (l: FigureLayout) => nodeOf(l, 'b').shape.y - (nodeOf(l, 'a').shape.y + nodeOf(l, 'a').shape.height);
    expect(gap(plain)).toBeCloseTo(M.gap.rank, 9);
    expect(gap(labelled)).toBeCloseTo(3 * 10 * 1.25 + 12, 9);
  });

  it('uses the group gap, but keeps room for an arrow', () => {
    const model = figure([group('g', ['a', 'b', 'c'], { gap: 4 }), node('a'), node('b'), node('c')], [edge('a -> b')]);
    const layout = layoutFigure(model, measurer);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => nodeOf(layout, id).bounds);
    expect(b.y - (a.y + a.height)).toBeCloseTo(M.edge.stub * 2 + M.edge.arrowLength, 9);
    expect(c.x - (a.x + a.width)).toBeCloseTo(4, 9);
  });
});

describe('layoutFigure — groups', () => {
  it('boxes children with padding and a title band', () => {
    const model = figure([group('g', ['a', 'b'], { label: label('Encoder'), tone: 'blue', filled: true, border: 'solid' }), node('a'), node('b')], [edge('a -> b')]);
    const layout = layoutFigure(model, measurer);
    const g = groupOf(layout, 'g');
    const a = nodeOf(layout, 'a');
    expect(g.depth).toBe(1);
    expect(a.depth).toBe(2);
    expect(g.label!.x).toBeCloseTo(g.box.x + M.group.pad, 9);
    expect(g.label!.y).toBeCloseTo(g.box.y + M.group.pad, 9);
    expect(g.label!.font.weight).toBe(600);
    expect(g.label!.align).toBe('left');
    expect(a.bounds.y).toBeCloseTo(g.label!.y + g.label!.height + M.group.titleGap, 9);
    const b = nodeOf(layout, 'b');
    expect(g.box.y + g.box.height).toBeCloseTo(b.bounds.y + b.bounds.height + M.group.pad, 9);
    expectSound(model, layout);
  });

  it('moves the title to the bottom and widens the box for a long one', () => {
    const title = label('A particularly long group title');
    const model = figure([group('g', ['a'], { label: title, labelPosition: 'bottom' }), node('a')]);
    const layout = layoutFigure(model, measurer);
    const g = groupOf(layout, 'g');
    const a = nodeOf(layout, 'a');
    expect(g.label!.y).toBeCloseTo(a.bounds.y + a.bounds.height + M.group.titleGap, 9);
    expect(g.box.width).toBeCloseTo(g.label!.width + 2 * M.group.pad, 9);
    // The content is centred under the wider title.
    expect(cx(a.shape)).toBeCloseTo(cx(g.box), 9);
  });

  it('uses the bare padding for borderless, unfilled groups', () => {
    const model = figure([group('g', ['a'], { border: 'none' }), node('a')]);
    const layout = layoutFigure(model, measurer);
    expect(nodeOf(layout, 'a').bounds.x - groupOf(layout, 'g').box.x).toBeCloseTo(M.group.padBare, 9);
  });

  it('draws the repeat marker left of a vertical stack and the panel caption under the box', () => {
    const model = figure(
      [group('enc', ['a', 'b'], { repeat: 'N×', panel: '(a) Encoder' }), node('a'), node('b')],
      [edge('a -> b')],
    );
    const layout = layoutFigure(model, measurer);
    const g = groupOf(layout, 'enc');
    expect(g.repeat!.x + g.repeat!.width).toBeCloseTo(g.box.x - M.group.repeatGap, 9);
    expect(cy(g.repeat!)).toBeCloseTo(cy(g.box), 9);
    expect(g.panel!.y).toBeCloseTo(g.box.y + g.box.height + M.group.panelGap, 9);
    expect(cx(g.panel!)).toBeCloseTo(cx(g.box), 9);
    expect(g.panel!.font.size).toBe(M.font.panel);
    expectSound(model, layout);
  });

  it('puts a group’s repeat marker under it in a horizontal parent, above the panel caption', () => {
    const model = figure([group('g', ['a'], { repeat: '×3', panel: '(a)' }), node('a')], [], { root: { direction: 'right' } });
    const g = groupOf(layoutFigure(model, measurer), 'g');
    expect(g.repeat!.y).toBeCloseTo(g.box.y + g.box.height + M.group.repeatGap, 9);
    expect(g.panel!.y).toBeCloseTo(g.repeat!.y + g.repeat!.height + M.group.panelGap, 9);
  });

  it('spaces panels with the panel gap', () => {
    const model = figure([
      group('p1', ['a'], { panel: '(a) Full', border: 'none' }),
      node('a'),
      group('p2', ['b'], { panel: '(b) Causal', border: 'none' }),
      node('b'),
      group('p3', ['c'], { panel: '(c) Sliding window', border: 'none' }),
      node('c'),
    ]);
    const layout = layoutFigure(model, measurer);
    const [p1, p2, p3] = ['p1', 'p2', 'p3'].map((id) => groupOf(layout, id).bounds);
    expect(p2.x - (p1.x + p1.width)).toBeCloseTo(M.gap.panel, 6);
    expect(p3.x - (p2.x + p2.width)).toBeCloseTo(M.gap.panel, 6);
    expectSound(model, layout);
  });

  it('nests groups and reports their depth and direction', () => {
    const model = figure(
      [
        group('outer', ['inner', 'c'], { direction: 'right', label: label('Outer') }),
        group('inner', ['a', 'b'], { direction: 'down', label: label('Inner') }),
        node('a'),
        node('b'),
        node('c'),
      ],
      [edge('a -> b'), edge('b -> c')],
    );
    const layout = layoutFigure(model, measurer);
    expect(groupOf(layout, 'outer')).toMatchObject({ depth: 1, direction: 'right' });
    expect(groupOf(layout, 'inner')).toMatchObject({ depth: 2, direction: 'down' });
    expect(nodeOf(layout, 'a')).toMatchObject({ depth: 3, direction: 'down' });
    expect(nodeOf(layout, 'c')).toMatchObject({ depth: 2, direction: 'right' });
    expect(layout.groups.map((g) => g.id)).toEqual(['outer', 'inner']);
    expect(nodeOf(layout, 'c').shape.x).toBeGreaterThan(groupOf(layout, 'inner').box.x + groupOf(layout, 'inner').box.width);
    expectSound(model, layout);
  });

  it('draws an item listed twice only once', () => {
    const model = figure([group('g', ['a', 'a']), node('a')]);
    const layout = layoutFigure(model, measurer);
    expect(layout.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('draws an empty group as a padded box', () => {
    const layout = layoutFigure(figure([group('g', [])]), measurer);
    expect(groupOf(layout, 'g').box).toMatchObject({ width: 2 * M.group.pad, height: 2 * M.group.pad });
  });
});

describe('layoutFigure — rows, columns and grids', () => {
  it('lays a row out left to right and reverses it for `left`', () => {
    for (const direction of ['down', 'left'] as const) {
      order = 0;
      const model = figure([group('r', ['a', 'b', 'c'], { layout: 'row', direction }), node('a'), node('b'), node('c')]);
      const layout = layoutFigure(model, measurer);
      const [a, b, c] = ['a', 'b', 'c'].map((id) => nodeOf(layout, id).bounds);
      if (direction === 'down') expect(a.x < b.x && b.x < c.x).toBe(true);
      else expect(a.x > b.x && b.x > c.x).toBe(true);
      const [first, second] = direction === 'down' ? [a, b] : [b, a];
      expect(second.x - (first.x + first.width)).toBeCloseTo(M.gap.stack, 9);
      expectSound(model, layout);
    }
  });

  it('lays a column out top to bottom and reverses it for `up`', () => {
    for (const direction of ['down', 'up'] as const) {
      order = 0;
      const model = figure([group('col', ['a', 'b'], { layout: 'column', direction }), node('a'), node('b')]);
      const layout = layoutFigure(model, measurer);
      const [a, b] = ['a', 'b'].map((id) => nodeOf(layout, id).bounds);
      expect(direction === 'down' ? a.y < b.y : a.y > b.y).toBe(true);
    }
  });

  it('aligns a row by `align`, centring on anchors', () => {
    const items = () => [node('a', { height: 40 }), node('b', { stack: 4 }), node('c', { shape: 'text' })];
    for (const align of ['start', 'center', 'end'] as const) {
      order = 0;
      const model = figure([group('r', ['a', 'b', 'c'], { layout: 'row', align }), ...items()]);
      const layout = layoutFigure(model, measurer);
      const [a, b, c] = ['a', 'b', 'c'].map((id) => nodeOf(layout, id));
      if (align === 'start') {
        expect(a.bounds.y).toBeCloseTo(b.bounds.y, 9);
        expect(b.bounds.y).toBeCloseTo(c.bounds.y, 9);
      } else if (align === 'end') {
        expect(a.bounds.y + a.bounds.height).toBeCloseTo(b.bounds.y + b.bounds.height, 9);
        expect(b.bounds.y + b.bounds.height).toBeCloseTo(c.bounds.y + c.bounds.height, 9);
      } else {
        expect(cy(a.anchor)).toBeCloseTo(cy(b.anchor), 9);
        expect(cy(b.anchor)).toBeCloseTo(cy(c.anchor), 9);
      }
      expectSound(model, layout);
    }
  });

  it('places grid items row-major in cells sized by the largest item', () => {
    const model = figure([
      group('g', ['a', 'b', 'c', 'd', 'e'], { layout: 'grid', columns: 2 }),
      node('a', { text: 'wide wide wide' }),
      node('b'),
      node('c', { height: 60 }),
      node('d'),
      node('e'),
    ]);
    const layout = layoutFigure(model, measurer);
    const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((id) => nodeOf(layout, id).bounds);
    // Columns: a, c, e share a centre; b, d share another.
    expect(cx(a)).toBeCloseTo(cx(c), 9);
    expect(cx(c)).toBeCloseTo(cx(e), 9);
    expect(cx(b)).toBeCloseTo(cx(d), 9);
    // Rows: a|b, c|d, e.
    expect(cy(a)).toBeCloseTo(cy(b), 9);
    expect(cy(c)).toBeCloseTo(cy(d), 9);
    // Column 1 starts one gap after column 0's widest item.
    expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(M.gap.stack - EPS);
    // Row 2 starts one gap after row 1's tallest item (c, 60px).
    expect(e.y - (c.y + c.height)).toBeCloseTo(M.gap.stack, 9);
    expectSound(model, layout);
  });

  it('never makes more grid columns than items', () => {
    const model = figure([group('g', ['a', 'b'], { layout: 'grid', columns: 5 }), node('a'), node('b')]);
    const layout = layoutFigure(model, measurer);
    const g = groupOf(layout, 'g');
    const a = nodeOf(layout, 'a').bounds;
    const b = nodeOf(layout, 'b').bounds;
    expect(g.box.width).toBeCloseTo(a.width + b.width + M.gap.stack + 2 * M.group.pad, 9);
  });

  it('makes box-like children of a uniform stack equally wide', () => {
    const model = figure(
      [
        group('s', ['a', 'b', 'c', 'd', 'e'], { uniform: true }),
        node('a', { text: 'Add & Norm' }),
        node('b', { text: 'Multi-Head Attention', shape: 'round' }),
        node('c', { text: 'FFN', shape: 'funnel' }),
        node('d', { shape: 'circle' }),
        node('e', { width: 50 }),
      ],
      [edge('a -> b'), edge('b -> c'), edge('c -> d'), edge('d -> e')],
    );
    const layout = layoutFigure(model, measurer);
    const widths = ['a', 'b', 'c'].map((id) => nodeOf(layout, id).shape.width);
    expect(widths[0]).toBeCloseTo(widths[1], 9);
    expect(widths[1]).toBeCloseTo(widths[2], 9);
    expect(nodeOf(layout, 'd').shape.width).toBe(15 + 14);
    expect(nodeOf(layout, 'e').shape.width).toBe(50);
    // Uniform widening re-centres the label rather than re-wrapping it.
    const a = nodeOf(layout, 'a');
    expect(cx(a.label!)).toBeCloseTo(cx(a.shape), 9);
    expect(a.label!.lines).toHaveLength(1);
    // Still one straight column.
    const centres = ['a', 'b', 'c', 'd', 'e'].map((id) => cx(nodeOf(layout, id).anchor));
    for (const c of centres) expect(c).toBeCloseTo(centres[0], 6);
    expectSound(model, layout);
  });

  it('makes a uniform row equally tall', () => {
    const model = figure([
      group('r', ['a', 'b'], { layout: 'row', uniform: true }),
      node('a', { text: 'one\ntwo\nthree' }),
      node('b'),
    ]);
    const layout = layoutFigure(model, measurer);
    expect(nodeOf(layout, 'b').shape.height).toBeCloseTo(nodeOf(layout, 'a').shape.height, 9);
  });

  it('leaves a uniform grid alone', () => {
    const model = figure([group('g', ['a', 'b'], { layout: 'grid', uniform: true }), node('a', { text: 'a long label' }), node('b')]);
    const layout = layoutFigure(model, measurer);
    expect(nodeOf(layout, 'b').shape.width).toBe(M.node.minWidth);
  });
});

describe('layoutFigure — room for edges and captions', () => {
  /** A group whose top child sits under its title, fed from below and read from above. */
  const titled = (direction: 'up' | 'down', extra: Partial<GroupModel> = {}) =>
    figure(
      [
        node('src'),
        group('blk', ['a', 'add'], { label: label('A rather long block title'), direction, ...extra }),
        node('a'),
        node('add', { shape: 'op', op: 'plus', text: '+' }),
        node('out'),
      ],
      [edge('src -> a'), edge('a -> add'), edge('add -> out')],
      { root: { direction } },
    );

  it('keeps a lane between a title and the content edges leave under it', () => {
    for (const direction of ['up', 'down'] as const) {
      order = 0;
      const model = titled(direction);
      const layout = layoutFigure(model, measurer);
      const g = groupOf(layout, 'blk');
      // Up: `add` leaves through the top, under the title; down: `a` is entered there.
      const under = nodeOf(layout, direction === 'up' ? 'add' : 'a');
      expect(under.bounds.x).toBeLessThan(g.label!.x + g.label!.width);
      expect(under.bounds.y - (g.label!.y + g.label!.height)).toBeCloseTo(M.group.titleGap + 2 * M.edge.clearance, 9);
      expectSound(model, layout);
      const { edges } = routeFigure(layout, model, measurer);
      for (const e of edges) {
        for (let k = 1; k < e.points.length; k += 1) expect(segmentCrosses(e.points[k - 1], e.points[k], g.label!), e.id).toBe(false);
      }
    }
  });

  it('keeps the lane under a bottom title edges come in by, and none clear of the exits', () => {
    // A bottom title in an up group sits where edges come in…
    const bottom = layoutFigure(titled('up', { labelPosition: 'bottom' }), measurer);
    const g = groupOf(bottom, 'blk');
    const a = nodeOf(bottom, 'a');
    expect(g.label!.y - (a.bounds.y + a.bounds.height)).toBeCloseTo(M.group.titleGap + 2 * M.edge.clearance, 9);
    // …but a short title clear of the only exit keeps the plain band.
    order = 0;
    const model = figure(
      [
        group('blk', ['wide', 'o'], { label: label('G'), direction: 'up' }),
        node('wide', { text: 'a wide first block' }),
        node('o', { shape: 'op', op: 'plus', text: '+' }),
        node('out'),
      ],
      [edge('o -> out')],
      { root: { direction: 'up' } },
    );
    const plain = layoutFigure(model, measurer);
    const pg = groupOf(plain, 'blk');
    expect(nodeOf(plain, 'o').bounds.x).toBeGreaterThan(pg.label!.x + pg.label!.width);
    expect(nodeOf(plain, 'wide').bounds.y - (pg.label!.y + pg.label!.height)).toBeCloseTo(M.group.titleGap, 9);
    expectSound(model, plain);
  });

  it('puts the captions of panels side by side on one line', () => {
    const panels = () => [
      group('p1', ['a1', 'b1'], { panel: '(a) Two', border: 'none' }),
      node('a1'),
      node('b1'),
      group('p2', ['a2'], { panel: '(b) One', border: 'none' }),
      node('a2'),
      group('p3', ['a3', 'b3', 'c3'], { panel: '(c) Three', border: 'none' }),
      node('a3'),
      node('b3'),
      node('c3'),
    ];
    const links = () => [edge('a1 -> b1'), edge('a3 -> b3'), edge('b3 -> c3')];
    for (const root of [{ layout: 'row' as const }, { layout: 'flow' as const }]) {
      order = 0;
      const model = figure(panels(), links(), { root });
      const layout = layoutFigure(model, measurer);
      const [p1, p2, p3] = ['p1', 'p2', 'p3'].map((id) => groupOf(layout, id));
      expect(p1.box.height).not.toBeCloseTo(p3.box.height, 3);
      expect(p1.panel!.y).toBeCloseTo(p3.panel!.y, 9);
      expect(p2.panel!.y).toBeCloseTo(p3.panel!.y, 9);
      // The tallest panel's caption stays under its own box.
      expect(p3.panel!.y).toBeCloseTo(p3.box.y + p3.box.height + M.group.panelGap, 9);
      expectSound(model, layout);
    }
    // Stacked panels keep their own captions.
    order = 0;
    const column = layoutFigure(figure(panels(), links(), { root: { layout: 'column' } }), measurer);
    for (const id of ['p1', 'p2', 'p3']) {
      const g = groupOf(column, id);
      expect(g.panel!.y).toBeCloseTo(g.box.y + g.box.height + M.group.panelGap, 9);
    }
  });

  it('opens the gap between row neighbours for the label of the edge between them', () => {
    const model = figure(
      [group('r', ['a', 'b', 'c'], { layout: 'row' }), node('a'), node('b'), node('c')],
      [edge('a -> b', { label: label('residual') }), edge('b -> c')],
    );
    const layout = layoutFigure(model, measurer);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => nodeOf(layout, id).bounds);
    // "residual" at 10px is 8 × 6.5 × 10/12 wide.
    expect(b.x - (a.x + a.width)).toBeCloseTo((8 * 6.5 * 10) / 12 + LABEL_ROOM, 9);
    expect(c.x - (b.x + b.width)).toBeCloseTo(M.gap.stack, 9);
    expectSound(model, layout);
    const { edges } = routeFigure(layout, model, measurer);
    const labelled = edges.find((e) => e.label)!;
    for (const n of layout.nodes) expect(overlaps(labelled.label!, n.bounds), n.id).toBe(false);
  });

  it('opens a column’s gap for a tall label and a grid’s gaps for labels across them', () => {
    const tall = label('first\nsecond\nthird');
    const column = layoutFigure(
      figure([group('c', ['a', 'b'], { layout: 'column' }), node('a'), node('b')], [edge('a -> b', { label: tall })]),
      measurer,
    );
    const [ca, cb] = ['a', 'b'].map((id) => nodeOf(column, id).bounds);
    expect(cb.y - (ca.y + ca.height)).toBeCloseTo(3 * 10 * 1.25 + LABEL_ROOM, 9);
    order = 0;
    const model = figure(
      [group('g', ['a', 'b', 'c', 'd'], { layout: 'grid', columns: 2 }), node('a'), node('b'), node('c'), node('d')],
      [edge('a -> b', { label: label('projection') }), edge('a -> c', { label: tall })],
    );
    const grid = layoutFigure(model, measurer);
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => nodeOf(grid, id).bounds);
    expect(b.x - (a.x + a.width)).toBeCloseTo((10 * 6.5 * 10) / 12 + LABEL_ROOM, 9);
    expect(c.y - (a.y + a.height)).toBeCloseTo(3 * 10 * 1.25 + LABEL_ROOM, 9);
    expect(cx(b)).toBeCloseTo(cx(d), 9);
    expectSound(model, grid);
    const { edges } = routeFigure(grid, model, measurer);
    for (const e of edges) for (const n of grid.nodes) expect(overlaps(e.label!, n.bounds), `${e.id} over ${n.id}`).toBe(false);
  });

  it('keeps a routing lane between neighbours an edge joins, whatever the gap', () => {
    const model = figure(
      [group('r', ['a', 'b', 'c'], { layout: 'row', gap: 2 }), node('a'), node('b'), node('c')],
      [edge('a -> b')],
    );
    const layout = layoutFigure(model, measurer);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => nodeOf(layout, id).bounds);
    expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(2 * M.edge.clearance + M.edge.stub);
    expect(c.x - (b.x + b.width)).toBeCloseTo(2, 9);
  });
});

describe('layoutFigure — legend and canvas', () => {
  const legend: LegendItemModel[] = [
    { label: label('Cached during inference'), sample: { kind: 'node', tone: 'teal', shape: 'box', pattern: 'hatch', border: 'solid' } },
    { label: label('Training only'), sample: { kind: 'edge', line: 'dashed', weight: 'normal', tone: null } },
  ];

  it('puts the legend under the drawing', () => {
    const model = figure([node('a'), node('b')], [edge('a -> b')], { legend });
    const layout = layoutFigure(model, measurer);
    const b = nodeOf(layout, 'b');
    const box = layout.legend!.box;
    expect(box.y).toBeCloseTo(b.bounds.y + b.bounds.height + M.legend.marginTop, 9);
    expect(layout.height).toBeCloseTo(box.y + box.height + M.margin, 9);
    const [first, second] = layout.legend!.items;
    expect(first.swatch).toMatchObject({ width: M.legend.swatchWidth, height: M.legend.swatchHeight });
    expect(first.label.x).toBeCloseTo(first.swatch.x + M.legend.swatchWidth + 6, 9);
    expect(second.swatch.x).toBeCloseTo(first.label.x + first.label.width + M.legend.itemGap, 9);
    expect(cy(first.swatch)).toBeCloseTo(cy(first.label), 9);
    expect(second.sample).toEqual(legend[1].sample);
    expectSound(model, layout);
  });

  it('centres a narrow drawing over a wider legend', () => {
    const model = figure([node('a')], [], { legend });
    const layout = layoutFigure(model, measurer);
    expect(cx(nodeOf(layout, 'a').bounds)).toBeCloseTo(layout.width / 2, 9);
    expect(cx(layout.legend!.box)).toBeCloseTo(layout.width / 2, 9);
  });

  it('wraps legend rows at the wider of the drawing and the minimum', () => {
    const many: LegendItemModel[] = Array.from({ length: 8 }, (_, i) => ({
      label: label(`Legend entry number ${i}`),
      sample: { kind: 'node', tone: 'blue', shape: 'box', pattern: 'none', border: 'solid' },
    }));
    const model = figure([node('a')], [], { legend: many });
    const layout = layoutFigure(model, measurer);
    const rows = new Set(layout.legend!.items.map((item) => Math.round(item.swatch.y)));
    expect(rows.size).toBeGreaterThan(1);
    expect(layout.legend!.box.width).toBeLessThanOrEqual(360 + EPS);
    expectSound(model, layout);
  });

  it('lays out an empty figure as just its margin', () => {
    const layout = layoutFigure(figure([]), measurer);
    expect(layout).toMatchObject({ width: 2 * M.margin, height: 2 * M.margin, nodes: [], groups: [], legend: null });
  });

  it('lays out a legend with nothing above it', () => {
    const layout = layoutFigure(figure([], [], { legend }), measurer);
    expect(layout.legend!.box.y).toBeCloseTo(M.margin, 9);
  });

  it('keeps everything sound in a realistic mixed figure', () => {
    const model = figure(
      [
        group('enc', ['emb', 'attn', 'add1', 'ffn', 'add2'], { label: label('Encoder'), repeat: 'N×', uniform: true, direction: 'up' }),
        node('emb', { text: 'Input Embedding', tone: 'pink' }),
        node('attn', { text: 'Multi-Head\nAttention', stack: 3 }),
        node('add1', { text: 'Add & Norm' }),
        node('ffn', { text: 'Feed\nForward', badge: 'MoE' }),
        node('add2', { text: 'Add & Norm' }),
        node('pe', { shape: 'op', op: 'plus', text: '+', beside: { id: 'emb', before: false } }),
        node('tok', { shape: 'tensor', cells: { rows: 1, cols: 5, text: null, values: null, pattern: 'none' }, text: 'Tokens' }),
        group('side', ['kv', 'cache'], { layout: 'row', panel: '(b) Cache', border: 'none' }),
        node('kv', { shape: 'cylinder', text: 'KV cache' }),
        node('cache', { shape: 'document', text: 'Prompt' }),
      ],
      [
        edge('tok -> emb'),
        edge('emb -> attn'),
        edge('attn -> add1'),
        edge('emb -> add1', { kind: 'residual', label: label('residual') }),
        edge('add1 -> ffn'),
        edge('ffn -> add2'),
        edge('add1 -> add2', { kind: 'residual' }),
        edge('add2 -> kv'),
        edge('kv -> attn', { kind: 'feedback', constraint: false }),
      ],
      { legend },
    );
    const layout = layoutFigure(model, measurer);
    expectSound(model, layout);
    expect(layout.nodes).toHaveLength(9);
    expect(layout.groups).toHaveLength(2);
  });

  it('is deterministic', () => {
    const build = () => {
      order = 0;
      const model = figure(
        [group('g', ['a', 'b', 'c'], { label: label('G') }), node('a'), node('b'), node('c'), node('d'), node('e', { stack: 2 })],
        [edge('a -> b'), edge('a -> c'), edge('b -> d'), edge('c -> d'), edge('d -> e'), edge('a -> e')],
        { legend },
      );
      return layoutFigure(model, measurer);
    };
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
