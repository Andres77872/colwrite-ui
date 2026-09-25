import { describe, expect, it, vi } from 'vitest';
import { FIGURE_METRICS } from '../constants';
import { inflateRect } from '../geometry';
import { edgeBounds, minBends, routeFigure, translateEdges } from '../route';
import { ROOT_ID } from '../types';
import type {
  Border,
  ContainerLayout,
  Direction,
  EdgeModel,
  FigureLayout,
  FigureModel,
  FontSpec,
  GroupModel,
  ItemModel,
  Label,
  NodeModel,
  Point,
  Rect,
  SceneEdge,
  SceneGroup,
  SceneNode,
  Shape,
  TextMeasurer,
} from '../types';

// The router only needs a label's measured box. A local stand-in keeps these
// tests about routing, independent of the text module's metrics.
vi.mock('../labels', () => ({
  measureLabel: (label: Label, font: FontSpec, measurer: TextMeasurer) => {
    const lineHeight = font.size * 1.25;
    const lines = label.lines.map((segments) => {
      const widths = segments.map(
        (s) => (s.kind === 'math' ? measurer.math(s.value, font) : measurer.text(s.value, font)).width,
      );
      return { width: widths.reduce((a, b) => a + b, 0), height: lineHeight, segments: widths };
    });
    return {
      x: 0,
      y: 0,
      width: Math.max(0, ...lines.map((line) => line.width)),
      height: lines.reduce((sum, line) => sum + line.height, 0),
      label,
      font,
      align: 'center',
      lines,
      lineHeight,
    };
  },
}));

const EDGE = FIGURE_METRICS.edge;

const measurer: TextMeasurer = {
  key: 'test',
  text: (value, font) => ({ width: value.length * font.size * 0.6, height: font.size * 1.25 }),
  math: (latex, font) => ({ width: latex.length * font.size * 0.5, height: font.size * 1.25 }),
};

/* ────────────────────────────────────────────────────────────────────────
 * Fixtures: hand-built models and layouts
 * ──────────────────────────────────────────────────────────────────────── */

function plain(text: string): Label {
  return { lines: text.split('\n').map((line) => [{ kind: 'text', value: line }]), source: text, hasMath: false };
}

type NodeSpec = {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  shape?: Shape;
  parent?: string;
  /** Painted bounds when larger than the shape (a stack, a badge). */
  bounds?: Rect;
  /** Shape plus caption, for a tensor or an image with its label underneath. */
  anchor?: Rect;
};

type GroupSpec = {
  id: string;
  box: Rect;
  parent?: string;
  label?: string;
  border?: Border;
  filled?: boolean;
  layout?: ContainerLayout;
  direction?: Direction;
};

type EdgeSpec = Partial<Omit<EdgeModel, 'label'>> & { from: string; to: string; label?: string };

type FigureSpec = {
  nodes: NodeSpec[];
  groups?: GroupSpec[];
  edges: EdgeSpec[];
  direction?: Direction;
  layout?: ContainerLayout;
};

function groupModel(id: string, parent: string, order: number, overrides: Partial<GroupModel> = {}): GroupModel {
  return {
    kind: 'group',
    id,
    parent,
    order,
    path: id === ROOT_ID ? '' : `groups[${order}]`,
    label: null,
    children: [],
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
    ...overrides,
  };
}

function nodeModel(id: string, parent: string, order: number, shape: Shape): NodeModel {
  return {
    kind: 'node',
    id,
    parent,
    order,
    path: `nodes[${order}]`,
    label: plain(id),
    sublabel: null,
    shape,
    op: shape === 'op' ? 'plus' : null,
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
  };
}

function build(spec: FigureSpec): { layout: FigureLayout; model: FigureModel } {
  const direction = spec.direction ?? 'down';
  const root = groupModel(ROOT_ID, ROOT_ID, -1, { layout: spec.layout ?? 'flow', direction, border: 'none' });
  const items = new Map<string, ItemModel>();
  let order = 0;
  const groups: SceneGroup[] = [];
  for (const g of spec.groups ?? []) {
    const parent = g.parent ?? ROOT_ID;
    const model = groupModel(g.id, parent, order++, {
      label: g.label ? plain(g.label) : null,
      border: g.border ?? 'dashed',
      filled: g.filled ?? false,
      layout: g.layout ?? 'flow',
      direction: g.direction ?? direction,
    });
    items.set(g.id, model);
    groups.push({
      id: g.id,
      model,
      box: g.box,
      bounds: g.box,
      label: null,
      repeat: null,
      panel: null,
      depth: 1,
      direction: model.direction,
    });
  }
  const nodes: SceneNode[] = spec.nodes.map((n) => {
    const parent = n.parent ?? ROOT_ID;
    const shape = n.shape ?? 'box';
    const model = nodeModel(n.id, parent, order++, shape);
    items.set(n.id, model);
    const rect = { x: n.x, y: n.y, width: n.w ?? 80, height: n.h ?? 30 };
    const parentGroup = parent === ROOT_ID ? root : (items.get(parent) as GroupModel);
    return {
      id: n.id,
      model,
      shape: rect,
      anchor: n.anchor ?? rect,
      bounds: n.bounds ?? n.anchor ?? rect,
      label: null,
      sublabel: null,
      repeat: null,
      badge: null,
      stackOffset: 0,
      direction: parentGroup.direction,
      depth: 1,
    };
  });
  for (const item of items.values()) {
    const parent = item.parent === ROOT_ID ? root : (items.get(item.parent) as GroupModel);
    parent.children.push(item.id);
  }
  const edges: EdgeModel[] = spec.edges.map((e, i) => ({
    id: `e${i}`,
    fromSide: null,
    toSide: null,
    line: 'solid',
    weight: 'normal',
    arrow: 'end',
    route: 'ortho',
    kind: 'flow',
    constraint: true,
    tone: null,
    order: i,
    path: `edges[${i}]`,
    ...e,
    label: e.label ? plain(e.label) : null,
  }));
  const right = Math.max(...nodes.map((n) => n.bounds.x + n.bounds.width), ...groups.map((g) => g.box.x + g.box.width));
  const bottom = Math.max(...nodes.map((n) => n.bounds.y + n.bounds.height), ...groups.map((g) => g.box.y + g.box.height));
  const layout: FigureLayout = {
    width: right + 4,
    height: bottom + 4,
    nodes,
    groups,
    legend: null,
    direction,
    diagnostics: [],
  };
  const model: FigureModel = {
    title: null,
    caption: null,
    label: null,
    alt: null,
    size: 'auto',
    font: 'sans',
    palette: 'color',
    root,
    items,
    edges,
    legend: [],
  };
  return { layout, model };
}

function route(spec: FigureSpec) {
  const { layout, model } = build(spec);
  const result = routeFigure(layout, model, measurer);
  const byId = new Map(result.edges.map((edge) => [edge.id, edge]));
  const edge = (i: number) => byId.get(`e${i}`) as SceneEdge;
  const node = (id: string) => layout.nodes.find((n) => n.id === id) as SceneNode;
  return { ...result, layout, model, edge, node };
}

/* ────────────────────────────────────────────────────────────────────────
 * Geometry checks
 * ──────────────────────────────────────────────────────────────────────── */

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

function onRectBorder(p: Point, r: Rect): 'top' | 'bottom' | 'left' | 'right' | null {
  const within = (v: number, lo: number, hi: number) => v >= lo - 1e-6 && v <= hi + 1e-6;
  if (close(p.y, r.y) && within(p.x, r.x, r.x + r.width)) return 'top';
  if (close(p.y, r.y + r.height) && within(p.x, r.x, r.x + r.width)) return 'bottom';
  if (close(p.x, r.x) && within(p.y, r.y, r.y + r.height)) return 'left';
  if (close(p.x, r.x + r.width) && within(p.y, r.y, r.y + r.height)) return 'right';
  return null;
}

/** Whether the axis-aligned segment ab runs through the rect's interior. */
function runCrosses(a: Point, b: Point, r: Rect): boolean {
  const eps = 1e-6;
  if (close(a.x, b.x)) {
    return (
      a.x > r.x + eps &&
      a.x < r.x + r.width - eps &&
      Math.min(a.y, b.y) < r.y + r.height - eps &&
      Math.max(a.y, b.y) > r.y + eps
    );
  }
  return (
    a.y > r.y + eps &&
    a.y < r.y + r.height - eps &&
    Math.min(a.x, b.x) < r.x + r.width - eps &&
    Math.max(a.x, b.x) > r.x + eps
  );
}

function segments(points: Point[]): Array<[Point, Point]> {
  return points.slice(0, -1).map((p, i) => [p, points[i + 1]]);
}

function expectOrthogonal(edge: SceneEdge): void {
  for (const [a, b] of segments(edge.points)) {
    expect(close(a.x, b.x) || close(a.y, b.y), `${edge.id}: ${JSON.stringify([a, b])}`).toBe(true);
  }
}

/**
 * Whether a route end touches the node where edges attach: the grid or the
 * picture of a tensor or an image (or, on the side its caption covers, the
 * caption's foot, in line with the grid), the whole box of a text node, the
 * shape of anything else.
 */
function attaches(p: Point, node: SceneNode): boolean {
  const shape = node.model.shape;
  if (shape === 'text') return onRectBorder(p, node.anchor) !== null;
  if (onRectBorder(p, node.shape) !== null) return true;
  const foot = node.anchor.y + node.anchor.height;
  return (
    (shape === 'tensor' || shape === 'image') &&
    close(p.y, foot) &&
    p.x >= node.shape.x - 1e-6 &&
    p.x <= node.shape.x + node.shape.width + 1e-6
  );
}

/** The invariants every orthogonal route must keep. */
function expectCleanRoute(edge: SceneEdge, layout: FigureLayout): void {
  expectOrthogonal(edge);
  const pts = edge.points;
  const from = layout.nodes.find((n) => n.id === edge.model.from);
  const to = layout.nodes.find((n) => n.id === edge.model.to);
  if (from) expect(attaches(pts[0], from), `${edge.id} start`).toBe(true);
  if (to) expect(attaches(pts[pts.length - 1], to), `${edge.id} end`).toBe(true);
  segments(pts).forEach(([a, b], k) => {
    for (const node of layout.nodes) {
      const own = node.id === edge.model.from || node.id === edge.model.to;
      // A port run starts on its own node; everything else keeps the clearance.
      const isPortRunOf =
        (node.id === edge.model.from && k === 0) || (node.id === edge.model.to && k === pts.length - 2);
      if (isPortRunOf) continue;
      const zone = own ? node.bounds : inflateRect(node.bounds, EDGE.clearance - 1);
      expect(runCrosses(a, b, zone), `${edge.id} segment ${k} crosses ${node.id}`).toBe(false);
    }
  });
}

/** Proper crossings between two orthogonal routes (touching ends and shared runs do not count). */
function crossings(p: SceneEdge, q: SceneEdge): number {
  let n = 0;
  for (const [a, b] of segments(p.points)) {
    for (const [c, d] of segments(q.points)) {
      const [h, v] = close(a.y, b.y) && close(c.x, d.x) ? [[a, b], [c, d]] : close(c.y, d.y) && close(a.x, b.x) ? [[c, d], [a, b]] : [null, null];
      if (!h || !v) continue;
      const x = v[0].x;
      const y = h[0].y;
      const inside = (t: number, lo: number, hi: number) => t > Math.min(lo, hi) + 1e-6 && t < Math.max(lo, hi) - 1e-6;
      if (inside(x, h[0].x, h[1].x) && inside(y, v[0].y, v[1].y)) n += 1;
    }
  }
  return n;
}

function lastDirection(points: Point[]): Point {
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/* ────────────────────────────────────────────────────────────────────────
 * Tests
 * ──────────────────────────────────────────────────────────────────────── */

describe('routeFigure — straight chains', () => {
  it('draws an aligned vertical chain as two-point routes from bottom to top', () => {
    const { edges, diagnostics, edge } = route({
      nodes: [
        { id: 'a', x: 100, y: 20 },
        { id: 'b', x: 100, y: 80 },
        { id: 'c', x: 100, y: 140 },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(edges.map((e) => e.id)).toEqual(['e0', 'e1']);
    expect(edge(0).points).toEqual([
      { x: 140, y: 50 },
      { x: 140, y: 80 },
    ]);
    expect(edge(1).points).toEqual([
      { x: 140, y: 110 },
      { x: 140, y: 140 },
    ]);
    // The stroke stops at the arrow base, so the line never pokes through the tip.
    expect(edge(0).d).toBe(`M140 50L140 ${80 - EDGE.arrowLength}`);
  });

  it('lines up the ports of two overlapping but off-centre nodes instead of jogging', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 100, y: 20, w: 120 },
        { id: 'b', x: 180, y: 90, w: 80 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const pts = edge(0).points;
    expect(pts).toHaveLength(2);
    expect(pts[0].x).toBe(pts[1].x);
    expect(pts[0].y).toBe(50);
    expect(pts[1].y).toBe(90);
  });

  it('routes a horizontal flow left to right between facing sides', () => {
    const { edge } = route({
      direction: 'right',
      nodes: [
        { id: 'a', x: 20, y: 40 },
        { id: 'b', x: 140, y: 40 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    expect(edge(0).points).toEqual([
      { x: 100, y: 55 },
      { x: 140, y: 55 },
    ]);
    expect(lastDirection(edge(0).points)).toEqual({ x: 1, y: 0 });
  });

  it('follows an upward flow out of the top and into the bottom', () => {
    const { edge } = route({
      direction: 'up',
      nodes: [
        { id: 'a', x: 100, y: 200 },
        { id: 'b', x: 200, y: 100 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const pts = edge(0).points;
    expectOrthogonal(edge(0));
    expect(pts[0]).toEqual({ x: 140, y: 200 });
    expect(pts[pts.length - 1]).toEqual({ x: 240, y: 130 });
    expect(lastDirection(pts)).toEqual({ x: 0, y: -1 });
    // A Z with its jog in the gap between the two layers.
    expect(pts).toHaveLength(4);
    expect(pts[1].y).toBeGreaterThan(130);
    expect(pts[1].y).toBeLessThan(200);
  });
});

describe('routeFigure — orthogonal routes', () => {
  it('keeps every route axis-aligned, on its outlines and clear of other nodes', () => {
    const nodes: NodeSpec[] = [];
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) nodes.push({ id: `n${r}${c}`, x: 20 + c * 110 + (r % 2) * 25, y: 20 + r * 70 });
    }
    const edges: EdgeSpec[] = [
      { from: 'n00', to: 'n10' },
      { from: 'n00', to: 'n11' },
      { from: 'n01', to: 'n12' },
      { from: 'n02', to: 'n13' },
      { from: 'n10', to: 'n21' },
      { from: 'n11', to: 'n21' },
      { from: 'n12', to: 'n23' },
      { from: 'n03', to: 'n30' },
      { from: 'n00', to: 'n33' },
      { from: 'n20', to: 'n31' },
      { from: 'n21', to: 'n32' },
      { from: 'n13', to: 'n10' },
      { from: 'n32', to: 'n01', kind: 'feedback' },
      { from: 'n02', to: 'n22', kind: 'residual' },
    ];
    const { edges: routed, diagnostics, layout } = route({ nodes, edges });
    expect(diagnostics).toEqual([]);
    expect(routed).toHaveLength(edges.length);
    for (const edge of routed) expectCleanRoute(edge, layout);
  });

  it('prefers few bends: a diagonal neighbour gets one jog, not a staircase', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 20, y: 20 },
        { id: 'b', x: 200, y: 90 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    // bottom → jog in the gap → top: exactly two bends.
    expect(edge(0).points).toHaveLength(4);
    const [p0, p1, p2, p3] = edge(0).points;
    expect(p1.x).toBe(p0.x);
    expect(p2.y).toBe(p1.y);
    expect(p3.x).toBe(p2.x);
    // The jog runs along the centre of the gap between the layers.
    expect(p1.y).toBeCloseTo((50 + 90) / 2, 6);
  });

  it('starts with an outward run and ends with an inward run at least a stub long', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 20, y: 20 },
        { id: 'b', x: 260, y: 150 },
        { id: 'wall', x: 100, y: 80, w: 250 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const pts = edge(0).points;
    expect(pts[0].y).toBe(50);
    expect(pts[1].x).toBe(pts[0].x);
    expect(pts[1].y - pts[0].y).toBeGreaterThanOrEqual(EDGE.stub - 1e-6);
    const last = pts[pts.length - 1];
    const before = pts[pts.length - 2];
    expect(last.y).toBe(150);
    expect(before.x).toBe(last.x);
    expect(last.y - before.y).toBeGreaterThanOrEqual(EDGE.arrowLength + EDGE.cornerRadius - 1e-6);
  });

  it('never passes through a node standing in the way', () => {
    const { edge, layout } = route({
      nodes: [
        { id: 'a', x: 100, y: 20 },
        { id: 'block', x: 60, y: 90, w: 160 },
        { id: 'b', x: 100, y: 170 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    expectCleanRoute(edge(0), layout);
    expect(edge(0).points.length).toBeGreaterThan(2);
  });

  it('routes a residual down the flank and into the target from the left', () => {
    const { edge, node, layout } = route({
      nodes: [
        { id: 'x', x: 100, y: 20 },
        { id: 'block', x: 100, y: 90 },
        { id: 'add', x: 100, y: 160 },
      ],
      edges: [
        { from: 'x', to: 'block' },
        { from: 'block', to: 'add' },
        { from: 'x', to: 'add', kind: 'residual' },
      ],
    });
    const residual = edge(2);
    expectCleanRoute(residual, layout);
    const add = node('add').anchor;
    const block = node('block').bounds;
    const pts = residual.points;
    const tip = pts[pts.length - 1];
    expect(tip.x).toBe(add.x);
    expect(tip.y).toBeCloseTo(add.y + add.height / 2, 6);
    expect(lastDirection(pts)).toEqual({ x: 1, y: 0 });
    // It goes round the block on the left, at least a clearance away.
    const minX = Math.min(...pts.map((p) => p.x));
    expect(minX).toBeLessThanOrEqual(block.x - EDGE.clearance + 1e-6);
    // Out of x's bottom, left of the flow edge's port so the two never cross.
    expect(pts[0].y).toBe(50);
    expect(pts[0].x).toBeLessThan(edge(0).points[0].x);
  });

  it('loops a feedback edge round the right of the stack', () => {
    const { edge, node, layout } = route({
      nodes: [
        { id: 'a', x: 100, y: 20 },
        { id: 'b', x: 80, y: 90, w: 120 },
        { id: 'c', x: 100, y: 160 },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a', kind: 'feedback', constraint: false },
      ],
    });
    const back = edge(2);
    expectCleanRoute(back, layout);
    const pts = back.points;
    const a = node('a').anchor;
    const c = node('c').anchor;
    const b = node('b').bounds;
    expect(pts[0].x).toBe(c.x + c.width);
    expect(pts[pts.length - 1].x).toBe(a.x + a.width);
    expect(lastDirection(pts)).toEqual({ x: -1, y: 0 });
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThanOrEqual(b.x + b.width + EDGE.clearance - 1e-6);
  });

  it('keeps out of a group that holds neither endpoint when a detour exists', () => {
    const { edge, layout } = route({
      nodes: [
        { id: 'a', x: 100, y: 0 },
        { id: 'g1', x: 300, y: 140, parent: 'G' },
        { id: 'b', x: 100, y: 300 },
      ],
      groups: [{ id: 'G', box: { x: 60, y: 100, width: 340, height: 120 }, border: 'solid' }],
      edges: [{ from: 'a', to: 'b' }],
    });
    const box = layout.groups[0].box;
    expectCleanRoute(edge(0), layout);
    for (const [p, q] of segments(edge(0).points)) expect(runCrosses(p, q, box)).toBe(false);
  });

  it('crosses its own group freely', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 100, y: 120, parent: 'G' },
        { id: 'b', x: 100, y: 180, parent: 'G' },
      ],
      groups: [{ id: 'G', box: { x: 80, y: 100, width: 120, height: 120 }, border: 'solid' }],
      edges: [{ from: 'a', to: 'b' }],
    });
    expect(edge(0).points).toHaveLength(2);
  });

  it('passes an invisible arrangement group without detouring', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 100, y: 0 },
        { id: 'g1', x: 300, y: 140, parent: 'G' },
        { id: 'b', x: 100, y: 300 },
      ],
      groups: [{ id: 'G', box: { x: 60, y: 100, width: 340, height: 120 }, border: 'none' }],
      edges: [{ from: 'a', to: 'b' }],
    });
    expect(edge(0).points).toHaveLength(2);
  });

  it('stays exactly orthogonal on fractional coordinates, branching a residual off a shared ⊕ port', () => {
    // A Transformer sublayer as the layout places it: sizes from text
    // metrics, so nothing sits on a whole pixel.
    const { edges, edge, node, layout } = route({
      direction: 'up',
      nodes: [
        { id: 'add', x: 91.29685, y: 630, w: 20, h: 20, shape: 'op' },
        { id: 'attn', x: 64.94685, y: 538, w: 92.70000000000002, h: 44 },
        { id: 'norm', x: 64.94685, y: 479, w: 92.70000000000002, h: 29 },
        { id: 'ffn', x: 64.94685, y: 405, w: 92.70000000000002, h: 44 },
        { id: 'norm2', x: 64.94685, y: 346, w: 92.70000000000002, h: 29 },
      ],
      edges: [
        { from: 'add', to: 'attn' },
        { from: 'attn', to: 'norm' },
        { from: 'add', to: 'norm', kind: 'residual' },
        { from: 'norm', to: 'ffn' },
        { from: 'ffn', to: 'norm2' },
        { from: 'norm', to: 'norm2', kind: 'residual' },
      ],
    });
    for (const e of edges) expectCleanRoute(e, layout);
    const add = node('add').anchor;
    const residual = edge(2).points;
    // Out of the ⊕'s top, straight up along the main line, then off to the side.
    expect(residual[0]).toEqual({ x: add.x + add.width / 2, y: add.y });
    expect(residual[1].x).toBe(residual[0].x);
    expect(residual[1].y).toBeLessThan(add.y);
    expect(residual[1].y).toBeGreaterThan(582);
    // Into the norm from the left, clear of the attention block.
    const norm = node('norm').anchor;
    expect(residual[residual.length - 1].x).toBe(norm.x);
    expect(lastDirection(residual)).toEqual({ x: 1, y: 0 });
    expect(Math.min(...residual.map((p) => p.x))).toBeLessThanOrEqual(64.94685 - EDGE.clearance + 1e-6);
  });

  it('starts past a stacked node’s painted copies', () => {
    const { edge, layout } = route({
      direction: 'up',
      nodes: [
        { id: 'a', x: 100, y: 200 },
        // Two copies stacked 4px up and to the right: bounds grow by 8.
        { id: 'heads', x: 100, y: 100, bounds: { x: 100, y: 92, width: 88, height: 38 } },
        { id: 'out', x: 200, y: 20 },
      ],
      edges: [
        { from: 'a', to: 'heads' },
        { from: 'heads', to: 'out' },
      ],
    });
    const pts = edge(1).points;
    expect(pts[0].y).toBe(100);
    // The first bend sits outside the copies' clearance zone.
    expect(pts[1].y).toBeLessThanOrEqual(92 - EDGE.clearance + 1e-6);
    expectCleanRoute(edge(1), layout);
  });
});

describe('routeFigure — ports', () => {
  it('gives edges sharing a side distinct ports, ordered by where they go', () => {
    const { edge } = route({
      nodes: [
        { id: 's', x: 200, y: 20 },
        { id: 'a', x: 40, y: 120 },
        { id: 'b', x: 200, y: 120 },
        { id: 'c', x: 360, y: 120 },
      ],
      edges: [
        { from: 's', to: 'c' },
        { from: 's', to: 'a' },
        { from: 's', to: 'b' },
      ],
    });
    const toC = edge(0).points[0];
    const toA = edge(1).points[0];
    const toB = edge(2).points[0];
    for (const p of [toA, toB, toC]) expect(p.y).toBe(50);
    expect(toA.x).toBeLessThan(toB.x);
    expect(toB.x).toBeLessThan(toC.x);
    expect(toB.x - toA.x).toBeCloseTo(EDGE.portSpacing, 6);
    expect(toC.x - toB.x).toBeCloseTo(EDGE.portSpacing, 6);
    // Centred on the side.
    expect(toB.x).toBe(240);
  });

  it('orders a fan-out by where each route heads, so a detour does not cross its neighbours', () => {
    // `aux` sits between e1 and e2 as seen from the router, but the row in
    // front of it is a wall: its route detours round one end, past the
    // routes to the nodes on that side. Its port must be the outermost there.
    const { edges, edge, layout } = route({
      direction: 'up',
      nodes: [
        { id: 'router', x: 220, y: 312, w: 100 },
        { id: 'mix', x: 70, y: 200, w: 70 },
        { id: 'e1', x: 150, y: 200, w: 60 },
        { id: 'e2', x: 220, y: 200, w: 60 },
        { id: 'e3', x: 290, y: 200, w: 60 },
        { id: 'aux', x: 150, y: 40, w: 100 },
      ],
      edges: ['mix', 'e1', 'aux', 'e2', 'e3'].map((to) => ({ from: 'router', to })),
    });
    for (const e of edges) expectCleanRoute(e, layout);
    let total = 0;
    for (let i = 0; i < edges.length; i += 1) for (let j = i + 1; j < edges.length; j += 1) total += crossings(edges[i], edges[j]);
    expect(total).toBe(0);
    const aux = edge(2).points;
    const ports = edges.map((e) => e.points[0].x);
    const detourRight = Math.max(...aux.map((p) => p.x)) > 320;
    expect(aux[0].x).toBe(detourRight ? Math.max(...ports) : Math.min(...ports));
  });

  it('squeezes ports onto a narrow side instead of spilling past it', () => {
    const { edges } = route({
      nodes: [
        { id: 's', x: 200, y: 20, w: 30 },
        ...[0, 1, 2, 3, 4].map((i) => ({ id: `t${i}`, x: 40 + i * 90, y: 120 })),
      ],
      edges: [0, 1, 2, 3, 4].map((i) => ({ from: 's', to: `t${i}` })),
    });
    const xs = edges.map((e) => e.points[0].x);
    expect(new Set(xs).size).toBe(5);
    const radius = FIGURE_METRICS.node.radius;
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(200 + radius - 1e-6);
      expect(x).toBeLessThanOrEqual(230 - radius + 1e-6);
    }
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
  });

  it('meets every edge at the centre of an operator circle’s side', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 20, y: 20 },
        { id: 'b', x: 220, y: 20 },
        { id: 'plus', x: 150, y: 120, w: 20, h: 20, shape: 'op' },
      ],
      edges: [
        { from: 'a', to: 'plus' },
        { from: 'b', to: 'plus' },
      ],
    });
    expect(edge(0).end?.tip).toEqual({ x: 160, y: 120 });
    expect(edge(1).end?.tip).toEqual({ x: 160, y: 120 });
  });

  it('honours pinned sides', () => {
    const { edge, layout } = route({
      nodes: [
        { id: 'a', x: 100, y: 20 },
        { id: 'b', x: 100, y: 120 },
      ],
      edges: [{ from: 'a', to: 'b', fromSide: 'right', toSide: 'left' }],
    });
    const pts = edge(0).points;
    expect(pts[0]).toEqual({ x: 180, y: 35 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 135 });
    expect(lastDirection(pts)).toEqual({ x: 1, y: 0 });
    expectCleanRoute(edge(0), layout);
  });

  it('takes the other side from the rules when only one is pinned', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 100, y: 20 },
        { id: 'b', x: 260, y: 120 },
      ],
      edges: [{ from: 'a', to: 'b', fromSide: 'right' }],
    });
    const pts = edge(0).points;
    expect(pts[0].x).toBe(180);
    // b is downstream: enter at its top.
    expect(pts[pts.length - 1].y).toBe(120);
    expect(lastDirection(pts)).toEqual({ x: 0, y: 1 });
  });

  it('attaches to a group’s box when the edge names the group', () => {
    const { edge } = route({
      nodes: [
        { id: 'in', x: 120, y: 0 },
        { id: 'inner', x: 120, y: 120, parent: 'G' },
      ],
      groups: [{ id: 'G', box: { x: 100, y: 100, width: 120, height: 70 }, border: 'solid' }],
      edges: [{ from: 'in', to: 'G' }],
    });
    const tip = edge(0).end?.tip as Point;
    expect(tip.y).toBe(100);
    expect(tip.x).toBeGreaterThan(100);
    expect(tip.x).toBeLessThan(220);
  });

  it('connects nodes in one layer through their facing sides', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 20, y: 40 },
        { id: 'b', x: 180, y: 40 },
      ],
      edges: [{ from: 'b', to: 'a' }],
    });
    expect(edge(0).points).toEqual([
      { x: 180, y: 55 },
      { x: 100, y: 55 },
    ]);
  });
});

describe('routeFigure — tensors and images', () => {
  // A 4-cell token row whose caption, underneath, is wider than the row.
  const tensor = (id: string, x: number, y: number, captionWidth = 120): NodeSpec => ({
    id,
    x,
    y,
    w: 80,
    h: 20,
    shape: 'tensor',
    anchor: { x: x + 40 - captionWidth / 2, y, width: captionWidth, height: 40 },
  });
  const caption = (node: SceneNode): Rect => ({
    x: node.anchor.x,
    y: node.shape.y + node.shape.height,
    width: node.anchor.width,
    height: node.anchor.y + node.anchor.height - node.shape.y - node.shape.height,
  });
  const crossesCaption = (edge: SceneEdge, node: SceneNode) =>
    segments(edge.points).some(([a, b]) => runCrosses(a, b, caption(node)));

  it('meets a tensor beside its grid, level with the grid rather than the caption', () => {
    const { edge, node, layout } = route({
      direction: 'right',
      nodes: [{ id: 'src', x: 0, y: 95 }, tensor('tok', 200, 100)],
      edges: [{ from: 'src', to: 'tok' }],
    });
    const end = edge(0).points[edge(0).points.length - 1];
    const tok = node('tok').shape;
    expect(end.x).toBe(tok.x);
    expect(end.y).toBeGreaterThanOrEqual(tok.y);
    expect(end.y).toBeLessThanOrEqual(tok.y + tok.height);
    expectCleanRoute(edge(0), layout);
  });

  it('spreads ports across the grid’s width, not the caption’s', () => {
    const { edges, node, layout } = route({
      nodes: [
        { id: 'a', x: 60, y: 0, w: 40 },
        { id: 'b', x: 140, y: 0, w: 40 },
        { id: 'c', x: 220, y: 0, w: 40 },
        tensor('tok', 120, 100, 240),
      ],
      edges: [
        { from: 'a', to: 'tok' },
        { from: 'b', to: 'tok' },
        { from: 'c', to: 'tok' },
      ],
    });
    const tok = node('tok').shape;
    for (const e of edges) {
      const end = e.points[e.points.length - 1];
      expect(end.y).toBe(tok.y);
      expect(end.x).toBeGreaterThanOrEqual(tok.x);
      expect(end.x).toBeLessThanOrEqual(tok.x + tok.width);
      expectCleanRoute(e, layout);
    }
  });

  it('brings an arrow arriving from the caption’s side round to a flank of the grid', () => {
    const { edge, node, layout } = route({
      direction: 'up',
      nodes: [tensor('tok', 100, 40), { id: 'src', x: 100, y: 200 }],
      edges: [{ from: 'src', to: 'tok' }],
    });
    const pts = edge(0).points;
    const tok = node('tok');
    const end = pts[pts.length - 1];
    expect([tok.shape.x, tok.shape.x + tok.shape.width]).toContain(end.x);
    expect(end.y).toBeGreaterThanOrEqual(tok.shape.y);
    expect(end.y).toBeLessThanOrEqual(tok.shape.y + tok.shape.height);
    expect(crossesCaption(edge(0), tok)).toBe(false);
    expectCleanRoute(edge(0), layout);
  });

  it('starts an edge leaving by the caption’s side below the caption, in line with the grid', () => {
    const { edge, node, layout } = route({
      nodes: [tensor('tok', 100, 20), { id: 'dst', x: 100, y: 160 }],
      edges: [{ from: 'tok', to: 'dst' }],
    });
    const start = edge(0).points[0];
    const tok = node('tok');
    expect(start.y).toBe(tok.anchor.y + tok.anchor.height);
    expect(start.x).toBeGreaterThanOrEqual(tok.shape.x);
    expect(start.x).toBeLessThanOrEqual(tok.shape.x + tok.shape.width);
    expect(crossesCaption(edge(0), tok)).toBe(false);
    expectCleanRoute(edge(0), layout);
  });

  it('keeps a pinned bottom side, meeting it at the caption’s foot', () => {
    const { edge, node } = route({
      direction: 'up',
      nodes: [tensor('tok', 100, 40), { id: 'src', x: 100, y: 200 }],
      edges: [{ from: 'src', to: 'tok', toSide: 'bottom' }],
    });
    const pts = edge(0).points;
    const tok = node('tok');
    expect(pts[pts.length - 1].y).toBe(tok.anchor.y + tok.anchor.height);
    expect(lastDirection(pts)).toEqual({ x: 0, y: -1 });
  });
});

describe('routeFigure — arrowheads and path data', () => {
  it('points every arrowhead along its last run, tip on the outline', () => {
    const { edges } = route({
      nodes: [
        { id: 'a', x: 20, y: 20 },
        { id: 'b', x: 200, y: 110 },
        { id: 'c', x: 20, y: 200 },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c', arrow: 'both' },
        { from: 'a', to: 'c', weight: 'thick', kind: 'residual' },
      ],
    });
    for (const edge of edges) {
      const thick = edge.model.weight === 'thick';
      const length = thick ? EDGE.arrowLengthThick : EDGE.arrowLength;
      const width = thick ? EDGE.arrowWidthThick : EDGE.arrowWidth;
      const pts = edge.points;
      const end = edge.end;
      expect(end).not.toBeNull();
      if (!end) continue;
      expect(end.tip).toEqual(pts[pts.length - 1]);
      expect(end.polygon[0]).toEqual(end.tip);
      const u = lastDirection(pts);
      const base = { x: (end.polygon[1].x + end.polygon[2].x) / 2, y: (end.polygon[1].y + end.polygon[2].y) / 2 };
      expect(base.x).toBeCloseTo(end.tip.x - u.x * length, 6);
      expect(base.y).toBeCloseTo(end.tip.y - u.y * length, 6);
      expect(Math.hypot(end.polygon[1].x - end.polygon[2].x, end.polygon[1].y - end.polygon[2].y)).toBeCloseTo(width, 6);
      // The stroke ends at the arrow base.
      expect(edge.d.endsWith(`L${Math.round(base.x * 100) / 100} ${Math.round(base.y * 100) / 100}`)).toBe(true);
    }
    const both = edges[1];
    expect(both.start?.tip).toEqual(both.points[0]);
    expect(edges[0].start).toBeNull();
  });

  it('draws no arrowheads for an undirected edge and the full line', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 100, y: 20 },
        { id: 'b', x: 100, y: 80 },
      ],
      edges: [{ from: 'a', to: 'b', arrow: 'none' }],
    });
    expect(edge(0).start).toBeNull();
    expect(edge(0).end).toBeNull();
    expect(edge(0).d).toBe('M140 50L140 80');
  });

  it('rounds orthogonal corners with arcs no larger than the corner radius', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 20, y: 20 },
        { id: 'b', x: 200, y: 110 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    const arcs = [...edge(0).d.matchAll(/A(\S+) (\S+) 0 0 [01]/g)];
    expect(arcs).toHaveLength(2);
    for (const arc of arcs) expect(Number(arc[1])).toBeLessThanOrEqual(EDGE.cornerRadius);
  });
});

describe('routeFigure — straight, curved and self-loops', () => {
  it('draws a straight edge between the outlines, towards the other centre', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 0, y: 0, w: 40, h: 40 },
        { id: 'b', x: 200, y: 200, w: 40, h: 40 },
      ],
      edges: [{ from: 'a', to: 'b', route: 'straight' }],
    });
    const [p0, p1] = edge(0).points;
    expect(edge(0).points).toHaveLength(2);
    // Corner to corner along the diagonal.
    expect(p0.x).toBeCloseTo(40, 6);
    expect(p0.y).toBeCloseTo(40, 6);
    expect(p1.x).toBeCloseTo(200, 6);
    expect(p1.y).toBeCloseTo(200, 6);
    expect(edge(0).end?.tip).toEqual(p1);
  });

  it('draws a curved edge as a cubic from port normal to port normal', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 20, y: 20 },
        { id: 'b', x: 220, y: 200 },
      ],
      edges: [{ from: 'a', to: 'b', route: 'curved' }],
    });
    const [p0, c1, c2, p3] = edge(0).points;
    expect(edge(0).points).toHaveLength(4);
    expect(p0).toEqual({ x: 60, y: 50 });
    expect(p3).toEqual({ x: 260, y: 200 });
    const reach = Math.max(24, Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3);
    expect(c1).toEqual({ x: 60, y: 50 + reach });
    expect(c2).toEqual({ x: 260, y: 200 - reach });
    expect(edge(0).d).toMatch(/^M[\d.]+ [\d.]+C/);
    expect(lastDirection([c2, p3])).toEqual({ x: 0, y: 1 });
  });

  it('loops a self-edge out of the right side and back in', () => {
    const { edge } = route({
      nodes: [{ id: 'a', x: 100, y: 30, h: 30 }],
      edges: [{ from: 'a', to: 'a' }],
    });
    const pts = edge(0).points;
    expect(pts).toEqual([
      { x: 180, y: 40 },
      { x: 196, y: 40 },
      { x: 196, y: 50 },
      { x: 180, y: 50 },
    ]);
    expect(lastDirection(pts)).toEqual({ x: -1, y: 0 });
  });

  it('keeps other routes out of a self-loop', () => {
    const { edge, layout } = route({
      nodes: [
        { id: 'a', x: 150, y: 20 },
        { id: 'rnn', x: 100, y: 100 },
        { id: 'b', x: 150, y: 200 },
      ],
      edges: [
        { from: 'rnn', to: 'rnn' },
        { from: 'a', to: 'b' },
      ],
    });
    const loop = edge(0).points;
    const xs = loop.map((p) => p.x);
    const ys = loop.map((p) => p.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    // Straight down would cut through the loop; the route goes round it instead.
    expectCleanRoute(edge(1), layout);
    for (const [p, q] of segments(edge(1).points)) expect(runCrosses(p, q, box)).toBe(false);
  });
});

describe('routeFigure — nudging', () => {
  it('spreads two routes squeezed through one corridor a nudge apart', () => {
    // Two walls with a 17px gap: after clearance, a corridor 5px wide.
    const { edge, layout } = route({
      nodes: [
        { id: 'a1', x: 20, y: 20, w: 40 },
        { id: 'a2', x: 150, y: 20, w: 40 },
        { id: 'w1', x: 0, y: 100, w: 100 },
        { id: 'w2', x: 117, y: 100, w: 100 },
        { id: 'b1', x: 150, y: 200, w: 40 },
        { id: 'b2', x: 20, y: 200, w: 40 },
      ],
      edges: [
        { from: 'a1', to: 'b1' },
        { from: 'a2', to: 'b2' },
      ],
    });
    const throughCorridor = (e: SceneEdge) =>
      segments(e.points).find(([p, q]) => close(p.x, q.x) && Math.min(p.y, q.y) < 100 && Math.max(p.y, q.y) > 130);
    const r0 = throughCorridor(edge(0));
    const r1 = throughCorridor(edge(1));
    expect(r0).toBeDefined();
    expect(r1).toBeDefined();
    const x0 = (r0 as [Point, Point])[0].x;
    const x1 = (r1 as [Point, Point])[0].x;
    expect(Math.abs(x0 - x1)).toBeCloseTo(EDGE.nudge, 6);
    for (const x of [x0, x1]) {
      expect(x).toBeGreaterThanOrEqual(100 + EDGE.clearance - 1e-6);
      expect(x).toBeLessThanOrEqual(117 - EDGE.clearance + 1e-6);
    }
    expectCleanRoute(edge(0), layout);
    expectCleanRoute(edge(1), layout);
  });

  it('leaves no two routes running on top of each other', () => {
    const nodes: NodeSpec[] = [
      { id: 's1', x: 20, y: 20 },
      { id: 's2', x: 140, y: 20 },
      { id: 's3', x: 260, y: 20 },
      { id: 'mid', x: 60, y: 110, w: 260 },
      { id: 't1', x: 20, y: 200 },
      { id: 't2', x: 140, y: 200 },
      { id: 't3', x: 260, y: 200 },
    ];
    const { edges, layout } = route({
      nodes,
      edges: [
        { from: 's1', to: 't3' },
        { from: 's2', to: 't1' },
        { from: 's3', to: 't2' },
        { from: 's1', to: 't2' },
        { from: 's3', to: 't1' },
      ],
    });
    type Run = { edge: string; horizontal: boolean; coord: number; lo: number; hi: number; port: boolean };
    const runs: Run[] = [];
    for (const edge of edges) {
      expectCleanRoute(edge, layout);
      segments(edge.points).forEach(([p, q], k, all) => {
        const horizontal = close(p.y, q.y);
        runs.push({
          edge: edge.id,
          horizontal,
          coord: horizontal ? p.y : p.x,
          lo: horizontal ? Math.min(p.x, q.x) : Math.min(p.y, q.y),
          hi: horizontal ? Math.max(p.x, q.x) : Math.max(p.y, q.y),
          port: k === 0 || k === all.length - 1,
        });
      });
    }
    for (const a of runs) {
      for (const b of runs) {
        if (a.edge >= b.edge || a.horizontal !== b.horizontal || (a.port && b.port)) continue;
        const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
        if (overlap <= 0.5) continue;
        expect(Math.abs(a.coord - b.coord), `${a.edge}/${b.edge}`).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('routeFigure — labels', () => {
  it('puts a vertical edge’s label to its right, vertically centred', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 100, y: 20 },
        { id: 'b', x: 100, y: 110 },
      ],
      edges: [{ from: 'a', to: 'b', label: 'ReLU' }],
    });
    const label = edge(0).label;
    expect(label).not.toBeNull();
    if (!label) return;
    expect(label.x).toBeCloseTo(140 + EDGE.labelGap, 6);
    expect(label.y + label.height / 2).toBeCloseTo((50 + 110) / 2, 6);
    expect(label.align).toBe('left');
    expect(label.width).toBeGreaterThan(0);
  });

  it('puts a horizontal edge’s label centred above it', () => {
    const { edge } = route({
      direction: 'right',
      nodes: [
        { id: 'a', x: 20, y: 40 },
        { id: 'b', x: 180, y: 40 },
      ],
      edges: [{ from: 'a', to: 'b', label: 'x' }],
    });
    const label = edge(0).label;
    if (!label) throw new Error('no label');
    expect(label.x + label.width / 2).toBeCloseTo(140, 6);
    expect(label.y + label.height).toBeCloseTo(55 - EDGE.labelGap, 6);
  });

  it('moves a label to the other side when a node is in the way', () => {
    const { edge, layout } = route({
      nodes: [
        { id: 'a', x: 100, y: 20 },
        { id: 'b', x: 100, y: 110 },
        { id: 'side', x: 150, y: 70, w: 40, h: 20 },
      ],
      edges: [{ from: 'a', to: 'b', label: 'residual' }],
    });
    const label = edge(0).label;
    if (!label) throw new Error('no label');
    for (const node of layout.nodes) {
      const r = node.bounds;
      const overlaps =
        label.x < r.x + r.width && r.x < label.x + label.width && label.y < r.y + r.height && r.y < label.y + label.height;
      expect(overlaps, node.id).toBe(false);
    }
  });

  it('slides a label along its run when both sides of the midpoint are taken', () => {
    const { edge, layout } = route({
      nodes: [
        { id: 'a', x: 100, y: 20 },
        { id: 'b', x: 100, y: 150 },
        { id: 'left', x: 60, y: 92, w: 72, h: 16 },
        { id: 'right', x: 148, y: 92, w: 72, h: 16 },
      ],
      edges: [{ from: 'a', to: 'b', label: 'gate' }],
    });
    expect(edge(0).points).toEqual([
      { x: 140, y: 50 },
      { x: 140, y: 150 },
    ]);
    const label = edge(0).label;
    if (!label) throw new Error('no label');
    for (const node of layout.nodes) {
      const r = node.bounds;
      const overlaps =
        label.x < r.x + r.width && r.x < label.x + label.width && label.y < r.y + r.height && r.y < label.y + label.height;
      expect(overlaps, node.id).toBe(false);
    }
    // Still beside the run, just nearer one end.
    expect(label.x).toBeCloseTo(140 + EDGE.labelGap, 6);
    expect(label.y).toBeGreaterThanOrEqual(50);
    expect(label.y + label.height).toBeLessThanOrEqual(150);
  });

  it('keeps labels off every node in a busy figure', () => {
    const nodes: NodeSpec[] = [];
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) nodes.push({ id: `n${r}${c}`, x: 20 + c * 130, y: 20 + r * 90 });
    const { edges, layout } = route({
      nodes,
      edges: [
        { from: 'n00', to: 'n11', label: 'query' },
        { from: 'n01', to: 'n11', label: 'key' },
        { from: 'n02', to: 'n11', label: 'value' },
        { from: 'n11', to: 'n20', label: 'out' },
        { from: 'n11', to: 'n22', label: 'skip' },
        { from: 'n10', to: 'n21', label: 'h' },
      ],
    });
    const boxes: Rect[] = [];
    for (const edge of edges) {
      const label = edge.label;
      if (!label) throw new Error(`${edge.id} has no label`);
      for (const r of [...layout.nodes.map((node) => node.bounds), ...boxes]) {
        const overlaps =
          label.x < r.x + r.width && r.x < label.x + label.width && label.y < r.y + r.height && r.y < label.y + label.height;
        expect(overlaps, `${edge.id} label over ${JSON.stringify(r)}`).toBe(false);
      }
      boxes.push(label);
    }
  });

  it('has no label box for an edge without a label', () => {
    const { edge } = route({
      nodes: [
        { id: 'a', x: 100, y: 20 },
        { id: 'b', x: 100, y: 110 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    expect(edge(0).label).toBeNull();
  });
});

describe('routeFigure — failure modes', () => {
  it('skips an edge whose endpoint is not in the layout, with a warning', () => {
    const { layout, model } = build({
      nodes: [{ id: 'a', x: 0, y: 0 }],
      edges: [{ from: 'a', to: 'ghost' }],
    });
    const result = routeFigure(layout, model, measurer);
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'warning', code: 'route.unknown-endpoint', path: 'edges[0]' });
  });

  it('falls back to a straight line, with a warning, when the target is walled in', () => {
    const { edges, diagnostics } = route({
      nodes: [
        { id: 'a', x: 100, y: 0, w: 40, h: 20 },
        { id: 'top', x: 60, y: 60, w: 120, h: 10 },
        { id: 'left', x: 60, y: 60, w: 10, h: 110 },
        { id: 'right', x: 170, y: 60, w: 10, h: 110 },
        { id: 'bottom', x: 60, y: 160, w: 120, h: 10 },
        { id: 't', x: 100, y: 100, w: 40, h: 30 },
      ],
      edges: [{ from: 'a', to: 't' }],
    });
    expect(diagnostics.map((d) => d.code)).toEqual(['route.fallback']);
    expect(diagnostics[0].path).toBe('edges[0]');
    expect(edges[0].points).toHaveLength(2);
    expect(edges[0].end).not.toBeNull();
  });

  it('draws an edge to a walled-in target as a simple orthogonal route, not a diagonal', () => {
    const { edges, diagnostics } = route({
      nodes: [
        { id: 'a', x: 320, y: 0, w: 40, h: 20 },
        { id: 'top', x: 60, y: 60, w: 120, h: 10 },
        { id: 'left', x: 60, y: 60, w: 10, h: 110 },
        { id: 'right', x: 170, y: 60, w: 10, h: 110 },
        { id: 'bottom', x: 60, y: 160, w: 120, h: 10 },
        { id: 't', x: 100, y: 100, w: 40, h: 30 },
      ],
      edges: [{ from: 'a', to: 't' }],
    });
    expect(diagnostics.map((d) => d.code)).toEqual(['route.fallback']);
    expectOrthogonal(edges[0]);
    expect(edges[0].end).not.toBeNull();
  });

  it('squeezes a route between close neighbours rather than through the one in the way', () => {
    // 8px apart: less than the clearance on both sides, so the route has to
    // use part of it, but it never runs through `b` or along its outline.
    const { edge, node } = route({
      nodes: [
        { id: 'a', x: 20, y: 20, w: 44, h: 29 },
        { id: 'b', x: 20, y: 57, w: 44, h: 29 },
        { id: 'c', x: 20, y: 94, w: 44, h: 29 },
      ],
      edges: [{ from: 'a', to: 'c' }],
    });
    expectOrthogonal(edge(0));
    const b = inflateRect(node('b').bounds, 1.5);
    for (const [p, q] of segments(edge(0).points)) expect(runCrosses(p, q, b), JSON.stringify([p, q])).toBe(false);
  });

  it('returns nothing for a figure without edges', () => {
    const { edges, diagnostics } = route({ nodes: [{ id: 'a', x: 0, y: 0 }], edges: [] });
    expect(edges).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});

describe('routeFigure — determinism and scale', () => {
  /** A 6×10 layered figure with 90 edges, some skipping layers, some going back. */
  function bigFigure(): FigureSpec {
    const nodes: NodeSpec[] = [];
    const cols = 6;
    const rows = 10;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) nodes.push({ id: `n${r}_${c}`, x: 20 + c * 102 + (r % 3) * 8, y: 20 + r * 60 });
    }
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const edges: EdgeSpec[] = [];
    const seen = new Set<string>();
    while (edges.length < 90) {
      const r = Math.floor(next() * (rows - 1));
      const span = next() < 0.8 ? 1 : 2;
      const r2 = Math.min(rows - 1, r + span);
      const c = Math.floor(next() * cols);
      const c2 = Math.max(0, Math.min(cols - 1, c + Math.floor(next() * 3) - 1));
      const back = next() < 0.05;
      const from = back ? `n${r2}_${c2}` : `n${r}_${c}`;
      const to = back ? `n${r}_${c}` : `n${r2}_${c2}`;
      if (seen.has(`${from}>${to}`)) continue;
      seen.add(`${from}>${to}`);
      edges.push({ from, to, ...(back ? { kind: 'feedback' as const } : {}), ...(edges.length % 9 === 0 ? { label: 'x' } : {}) });
    }
    return { nodes, edges };
  }

  it('routes the same figure to the same scene every time', () => {
    const first = route(bigFigure());
    const second = route(bigFigure());
    expect(JSON.stringify(second.edges)).toBe(JSON.stringify(first.edges));
    expect(second.diagnostics).toEqual(first.diagnostics);
  });

  it('routes 60 nodes and 90 edges well within a frame budget', () => {
    const spec = bigFigure();
    expect(spec.nodes).toHaveLength(60);
    expect(spec.edges).toHaveLength(90);
    const { layout, model } = build(spec);
    const started = performance.now();
    const result = routeFigure(layout, model, measurer);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(750);
    expect(result.edges).toHaveLength(90);
    expect(result.diagnostics).toEqual([]);
    for (const edge of result.edges) expectCleanRoute(edge, layout);
  });
});

describe('minBends', () => {
  const p = { x: 0, y: 0 };
  it('needs no bend straight ahead, and a jog or a loop otherwise', () => {
    expect(minBends(p, 1, { x: 0, y: 50 }, 1)).toBe(0);
    expect(minBends(p, 1, { x: 30, y: 50 }, 1)).toBe(2);
    expect(minBends(p, 1, { x: 0, y: -50 }, 1)).toBe(4);
  });
  it('turns once towards a target ahead and to the side it must enter from', () => {
    expect(minBends(p, 1, { x: 30, y: 50 }, 0)).toBe(1);
    expect(minBends(p, 1, { x: -30, y: 50 }, 0)).toBe(3);
    expect(minBends(p, 1, { x: 30, y: -50 }, 0)).toBe(3);
  });
  it('always needs two bends to come back the other way', () => {
    expect(minBends(p, 1, { x: 30, y: 50 }, 3)).toBe(2);
    expect(minBends(p, 1, { x: 0, y: 0 }, 3)).toBe(2);
  });
});

describe('translateEdges', () => {
  it('moves strokes, path data, arrowheads and labels together, leaving arc radii alone', () => {
    const { edges } = route({
      nodes: [
        { id: 'a', x: 20, y: 20 },
        { id: 'b', x: 200, y: 110 },
      ],
      edges: [{ from: 'a', to: 'b', label: 'long edge label', arrow: 'both' }],
    });
    const [moved] = translateEdges(edges, 10, 20);
    const [edge] = edges;
    expect(moved.points).toEqual(edge.points.map((p) => ({ x: p.x + 10, y: p.y + 20 })));
    expect(moved.end?.polygon).toEqual(edge.end?.polygon.map((p) => ({ x: p.x + 10, y: p.y + 20 })));
    expect(moved.start?.tip).toEqual({ x: edge.start!.tip.x + 10, y: edge.start!.tip.y + 20 });
    expect(moved.label).toMatchObject({ x: edge.label!.x + 10, y: edge.label!.y + 20, width: edge.label!.width });
    const numbers = (d: string) => d.split(/[MLA]/).filter(Boolean).map((part) => part.trim().split(' ').map(Number));
    const before = numbers(edge.d);
    const after = numbers(moved.d);
    expect(edge.d).toContain('A');
    expect(after.length).toBe(before.length);
    after.forEach((values, k) => {
      const shifted = values.length === 7 ? [0, 0, 0, 0, 0, 10, 20] : [10, 20];
      values.forEach((v, i) => expect(v).toBeCloseTo(before[k][i] + shifted[i], 6));
    });
  });
});

describe('edgeBounds', () => {
  it('covers strokes, arrowheads and labels, and is null without edges', () => {
    expect(edgeBounds([])).toBeNull();
    const { edges } = route({
      nodes: [
        { id: 'a', x: 100, y: 20 },
        { id: 'b', x: 100, y: 110 },
      ],
      edges: [{ from: 'a', to: 'b', label: 'long edge label' }, { from: 'b', to: 'b' }],
    });
    const box = edgeBounds(edges) as Rect;
    for (const edge of edges) {
      const inside = (q: Point) =>
        q.x >= box.x - 1e-6 && q.x <= box.x + box.width + 1e-6 && q.y >= box.y - 1e-6 && q.y <= box.y + box.height + 1e-6;
      for (const q of edge.points) expect(inside(q)).toBe(true);
      for (const q of edge.end?.polygon ?? []) expect(inside(q)).toBe(true);
      if (edge.label) expect(inside({ x: edge.label.x + edge.label.width, y: edge.label.y + edge.label.height })).toBe(true);
    }
    // The self-loop reaches past the node, so past the layout's own box.
    expect(box.x + box.width).toBeGreaterThan(180 + 15);
  });
});
