import { FIGURE_METRICS, figureFont } from './constants';
import {
  center,
  clamp,
  clipToOutline,
  formatCoordinate,
  isVertical,
  oppositeSide,
  outlineBounds,
  portPoint,
  rectsOverlap,
  shapeOutline,
  sideNormal,
  sideSpan,
  type Outline,
} from './geometry';
import { measureLabel } from './labels';
import { ROOT_ID } from './types';
import type {
  Arrowhead,
  Direction,
  EdgeModel,
  FigureDiagnostic,
  FigureLayout,
  FigureModel,
  GroupModel,
  LabelBox,
  Point,
  Rect,
  SceneEdge,
  SceneGroup,
  SceneNode,
  Side,
  TextMeasurer,
} from './types';

/**
 * Edge routing: sides, ports, paths, arrowheads and edge labels.
 *
 * Layout only places boxes. This stage connects them the way a careful
 * author draws an architecture figure: an edge leaves and enters on the
 * sides the flow implies, edges sharing a side get their own evenly spaced
 * ports in the order of where they go, and an orthogonal edge takes the
 * cheapest right-angled path around every node — few bends, few crossings,
 * no shortcut through a group it does not belong to. Runs that still end up
 * on top of each other are nudged apart, so every edge stays traceable.
 */

const EDGE = FIGURE_METRICS.edge;

/**
 * Per-px surcharge on grid lines that are neither a channel centre nor a
 * port line. Far too small to add a bend or a detour; it only breaks ties
 * between equally short paths towards the middle of the gap between nodes.
 */
const OFF_CENTRE_COST = 0.05;
/** Cost of each grid step inside a text box (group titles, repeat markers, captions, the legend). */
const LABEL_COST = 500;
/** Breathing room kept around text boxes, in px. */
const LABEL_MARGIN = 2;
/** Least room kept from a neighbour too close for the full clearance, in px. */
const NEIGHBOUR_MARGIN = 2;
/** A* gives up on one edge after this many expansions, and the edge takes a simple route. */
const MAX_EXPANSIONS = 30_000;
/**
 * Expansions shared by every search of one figure. Past it, the remaining
 * edges take simple routes: a figure at the item and edge caps must still
 * compile in well under a second on the main thread.
 */
const FIGURE_EXPANSIONS = 600_000;
/** Above this many grid points the channel midlines are dropped, bounding memory on huge figures. */
const MAX_GRID_POINTS = 1_500_000;
/** How far a self-loop reaches out of its side. */
const SELF_LOOP_OUT = 16;
/** Shortest run a nudge may leave between two bends. */
const MIN_RUN = 2;
/** Ports keep this far from the ends of a side when they move to line up with the other end. */
const PORT_MARGIN = 4;
/**
 * Parallel runs closer than this are one bundle for nudging. Exactly
 * collinear runs are the obvious case; runs 2px apart read as a double line
 * and are spread just the same.
 */
const NUDGE_REACH = EDGE.nudge - 0.5;
/**
 * Extra per-px cost of running along another route's port run. Nudging can
 * separate any other shared run afterwards, but never a port run, so a
 * route rather bends away than shares one for more than a few px.
 */
const PORT_RUN_SHARE = 4;
const EPS = 1e-6;

/* ────────────────────────────────────────────────────────────────────────
 * Endpoints and sides
 * ──────────────────────────────────────────────────────────────────────── */

type Endpoint = {
  id: string;
  outline: Outline;
  /** The outline's bounding box: what sides and ports refer to. */
  rect: Rect;
  /** Everything the node paints, which routes keep `clearance` from; null for a group. */
  body: Rect | null;
  /** Groups the endpoint sits in, innermost first, without the root. */
  ancestors: string[];
  direction: Direction;
  /** Circles and diamonds: every edge on a side meets at the side's centre. */
  pointPorts: boolean;
  /**
   * The bottom of the caption under a tensor or an image, or null. A bottom
   * port sits there, below the caption, since the grid's own bottom side is
   * covered by it.
   */
  foot: number | null;
  /** The top of a caption placed above the tensor or image instead, or null. */
  head: number | null;
};

/** A route's attachment to one endpoint. */
type End = {
  plan: Plan;
  which: 0 | 1;
  endpoint: Endpoint;
  side: Side;
  /** Sort key: where the other end is, along this side. */
  key: number;
  point: Point;
  /** Whether other ends share this side (then the port cannot move on its own). */
  shared: boolean;
  /** Length of the straight run out of the port before the first bend. */
  stub: number;
};

type Plan = {
  edge: EdgeModel;
  /** Position in model order; the tie-breaker everywhere. */
  index: number;
  from: Endpoint;
  to: Endpoint;
  ends: [End | null, End | null];
  /** Groups the route may pass through for free: those around either endpoint. */
  free: Set<string>;
  points: Point[];
  /** How the points were made; only grid and direct routes are nudged. */
  kind: 'grid' | 'direct' | 'loop' | 'straight' | 'curved' | 'fallback';
};

function ancestorsOf(model: FigureModel, parent: string): string[] {
  const out: string[] = [];
  let id = parent;
  // The depth cap is only a guard against a malformed parent cycle.
  while (id !== ROOT_ID && out.length < 64) {
    const item = model.items.get(id);
    if (!item || item.kind !== 'group') break;
    out.push(id);
    id = item.parent;
  }
  return out;
}

function nodeEndpoint(node: SceneNode, model: FigureModel): Endpoint {
  const shape = node.model.shape;
  // A bare text node has no outline of its own: edges attach to its whole
  // box. A tensor or an image is met at the grid or the picture, never at the
  // caption under it, so its arrows point at what they mean.
  const outline: Outline =
    shape === 'text' ? { kind: 'rect', rect: node.anchor, radius: 0 } : shapeOutline(shape, node.shape, node.direction);
  const outside = shape === 'tensor' || shape === 'image';
  const captioned = outside && node.anchor.y + node.anchor.height > node.shape.y + node.shape.height + EPS;
  const headed = outside && node.anchor.y < node.shape.y - EPS;
  return {
    id: node.id,
    outline,
    rect: outlineBounds(outline),
    body: node.bounds,
    ancestors: ancestorsOf(model, node.model.parent),
    direction: node.direction,
    pointPorts: outline.kind === 'ellipse' || shape === 'diamond',
    foot: captioned ? node.anchor.y + node.anchor.height : null,
    head: headed ? node.anchor.y : null,
  };
}

/** Where a port at `offset` along the side touches the endpoint (beyond the caption on a captioned side). */
function portAt(endpoint: Endpoint, side: Side, offset: number): Point {
  const p = portPoint(endpoint.outline, side, offset);
  if (side === 'bottom' && endpoint.foot !== null) return { x: p.x, y: endpoint.foot };
  if (side === 'top' && endpoint.head !== null) return { x: p.x, y: endpoint.head };
  return p;
}

function groupEndpoint(group: SceneGroup, model: FigureModel): Endpoint {
  const outline: Outline = { kind: 'rect', rect: group.box, radius: FIGURE_METRICS.group.radius };
  return {
    id: group.id,
    outline,
    rect: group.box,
    body: null,
    ancestors: ancestorsOf(model, group.model.parent),
    direction: group.direction,
    pointPorts: false,
    foot: null,
    head: null,
  };
}

/** The lowest group holding both endpoints; a group endpoint holds itself. */
function commonGroup(model: FigureModel, a: Endpoint, b: Endpoint): GroupModel {
  const chainB = new Set(b.body ? b.ancestors : [b.id, ...b.ancestors]);
  for (const id of a.body ? a.ancestors : [a.id, ...a.ancestors]) {
    if (!chainB.has(id)) continue;
    const item = model.items.get(id);
    if (item?.kind === 'group') return item;
  }
  return model.root;
}

type FlowAxis = { vertical: boolean; sign: 1 | -1 } | null;

/** The axis a container's children follow, or null when only geometry can tell (grid). */
function flowAxis(group: GroupModel): FlowAxis {
  switch (group.layout) {
    case 'flow':
      return {
        vertical: isVertical(group.direction),
        sign: group.direction === 'down' || group.direction === 'right' ? 1 : -1,
      };
    case 'column':
      return { vertical: true, sign: group.direction === 'up' ? -1 : 1 };
    case 'row':
      return { vertical: false, sign: group.direction === 'left' ? -1 : 1 };
    case 'grid':
      return null;
  }
}

/**
 * The sides an edge leaves and enters by, following the flow of the
 * container both endpoints share: down the flow out of the downstream side
 * into the upstream one; a residual into the flank facing its source; an
 * edge against the flow out of and into the same flank so it loops around;
 * within one layer, the facing sides.
 */
function chooseSides(edge: EdgeModel, a: Endpoint, b: Endpoint, axis: FlowAxis): [Side, Side] {
  const ra = a.rect;
  const rb = b.rect;
  const ca = center(ra);
  const cb = center(rb);
  if (!axis) {
    const dx = (cb.x - ca.x) / Math.max(1, (ra.width + rb.width) / 2);
    const dy = (cb.y - ca.y) / Math.max(1, (ra.height + rb.height) / 2);
    if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
    return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  }
  const { vertical, sign } = axis;
  // Positions along the flow, oriented so that downstream always grows.
  const lo = (r: Rect) =>
    sign > 0 ? (vertical ? r.y : r.x) : -(vertical ? r.y + r.height : r.x + r.width);
  const hi = (r: Rect) => lo(r) + (vertical ? r.height : r.width);
  const downstream: Side = vertical ? (sign > 0 ? 'bottom' : 'top') : sign > 0 ? 'right' : 'left';

  if (lo(rb) - hi(ra) > 0) {
    if (edge.kind === 'residual' || edge.kind === 'skip') {
      if (vertical) return [downstream, ca.x > cb.x + rb.width / 4 ? 'right' : 'left'];
      return [downstream, ca.y > cb.y + rb.height / 4 ? 'bottom' : 'top'];
    }
    return [downstream, oppositeSide(downstream)];
  }
  if (lo(ra) - hi(rb) > 0) {
    const flank: Side = vertical ? 'right' : 'bottom';
    return [flank, flank];
  }
  if (vertical) return ca.x <= cb.x ? ['right', 'left'] : ['left', 'right'];
  return ca.y <= cb.y ? ['bottom', 'top'] : ['top', 'bottom'];
}

/** Pinned sides win; an edge that pins one side gets the other from the same rules. */
function resolveSides(edge: EdgeModel, chosen: [Side, Side]): [Side, Side] {
  const loop = chosen[0] === chosen[1];
  if (edge.fromSide && edge.toSide) return [edge.fromSide, edge.toSide];
  // A loop-around keeps both ends on one flank: follow the pinned one.
  if (edge.fromSide) return [edge.fromSide, loop ? edge.fromSide : chosen[1]];
  if (edge.toSide) return [loop ? edge.toSide : chosen[0], edge.toSide];
  return chosen;
}

/** Midpoint of one side of a rect: where an edge on that side heads. */
function sideMidpoint(rect: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }
}

const isHorizontalSide = (side: Side) => side === 'top' || side === 'bottom';

/** A port's position along its side: x on top/bottom, y on left/right. */
const crossOf = (end: End) => (isHorizontalSide(end.side) ? end.point.x : end.point.y);

/**
 * Where a port would like to sit along its side, before its neighbours on the
 * same side push it: in line with the other end when the two sides face each
 * other and overlap — so the edge is one straight run, the way a figure's
 * main stack reads — and otherwise at the side's centre.
 */
function desiredCross(end: End, span: [number, number]): number {
  const { endpoint, side } = end;
  const own = center(endpoint.rect);
  const mid = clamp(isHorizontalSide(side) ? own.x : own.y, span[0], span[1]);
  const other = end.plan.ends[end.which === 0 ? 1 : 0];
  if (!other || other.side !== oppositeSide(side)) return mid;
  const far = other.endpoint;
  const farCentre = center(far.rect);
  const farMid = isHorizontalSide(side) ? farCentre.x : farCentre.y;
  // A circle or diamond takes every edge at its centre: line up with that.
  if (far.pointPorts) return farMid >= span[0] && farMid <= span[1] ? farMid : mid;
  if (endpoint.pointPorts) return mid;
  const [flo, fhi] = sideSpan(far.outline, other.side);
  const lo = Math.max(span[0], flo);
  const hi = Math.min(span[1], fhi);
  if (hi < lo) return mid;
  // Aim at the centre of the narrower side, so a small node (an input's
  // label, an operator) is met in its middle by the wide block it feeds.
  const narrower = fhi - flo < span[1] - span[0] ? (flo + fhi) / 2 : (span[0] + span[1]) / 2;
  return clamp(narrower, lo, hi);
}

/**
 * Ports of one side, in order, as close to their desired positions as a
 * minimum spacing allows: isotonic regression (pool adjacent violators) on
 * the positions with the spacing taken out, then shifted back inside the side.
 */
function spacedPorts(desired: number[], spacing: number, lo: number, hi: number): number[] {
  const n = desired.length;
  if (n === 0) return [];
  const gap = n > 1 ? Math.min(spacing, (hi - lo) / (n - 1)) : 0;
  // Remove the spacing, solve the monotone fit, add it back.
  const shifted = desired.map((value, k) => value - k * gap);
  const blocks: Array<{ sum: number; count: number }> = [];
  for (const value of shifted) {
    blocks.push({ sum: value, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      if (prev.sum / prev.count <= last.sum / last.count) break;
      prev.sum += last.sum;
      prev.count += last.count;
      blocks.pop();
    }
  }
  const fitted: number[] = [];
  for (const block of blocks) for (let k = 0; k < block.count; k += 1) fitted.push(block.sum / block.count);
  let out = fitted.map((value, k) => value + k * gap);
  // Keep the run inside the side.
  if (out[0] < lo) out = out.map((value) => value + (lo - out[0]));
  if (out[n - 1] > hi) out = out.map((value) => value - (out[n - 1] - hi));
  return out;
}

/**
 * Place the ports of every (endpoint, side): each one in line with where its
 * edge goes when it can be, ordered by that destination so that neighbours do
 * not cross right outside the node, and never closer than `portSpacing`.
 */
function assignPorts(ends: End[]): void {
  const bySide = new Map<string, End[]>();
  for (const end of ends) {
    const key = `${end.endpoint.id}\u0000${end.side}`;
    const list = bySide.get(key);
    if (list) list.push(end);
    else bySide.set(key, [end]);
  }
  for (const list of bySide.values()) {
    list.sort((p, q) => p.key - q.key || p.plan.index - q.plan.index || p.which - q.which);
    const { endpoint, side } = list[0];
    const span = sideSpan(endpoint.outline, side);
    const n = list.length;
    if (endpoint.pointPorts) {
      const centre = center(endpoint.rect);
      const mid = clamp(isHorizontalSide(side) ? centre.x : centre.y, span[0], span[1]);
      for (const end of list) {
        end.point = portAt(endpoint, side, mid);
        end.shared = n > 1;
      }
      continue;
    }
    const placed = spacedPorts(
      list.map((end) => desiredCross(end, span)),
      EDGE.portSpacing,
      span[0],
      span[1],
    );
    list.forEach((end, k) => {
      end.point = portAt(endpoint, side, placed[k]);
      end.shared = n > 1;
    });
  }
}

/**
 * How far along the side's normal the port is from the edge of the node's
 * clearance zone: the stub must reach at least that far, or the route would
 * start inside an obstacle (a stacked copy, a badge, a tensor's label).
 */
function exitDistance(end: End): number {
  const body = end.endpoint.body;
  if (!body) return 0;
  const c = EDGE.clearance;
  const p = end.point;
  switch (end.side) {
    case 'top':
      return Math.max(0, p.y - (body.y - c));
    case 'bottom':
      return Math.max(0, body.y + body.height + c - p.y);
    case 'left':
      return Math.max(0, p.x - (body.x - c));
    case 'right':
      return Math.max(0, body.x + body.width + c - p.x);
  }
}

/** The gap between two ports whose sides face each other across it, or −1. */
function facingGap(a: End, b: End): number {
  if (b.side !== oppositeSide(a.side)) return -1;
  const n = sideNormal(a.side);
  const gap = (b.point.x - a.point.x) * n.x + (b.point.y - a.point.y) * n.y;
  return gap > 0 ? gap : -1;
}

function arrowMetrics(edge: EdgeModel): { length: number; width: number } {
  return edge.weight === 'thick'
    ? { length: EDGE.arrowLengthThick, width: EDGE.arrowWidthThick }
    : { length: EDGE.arrowLength, width: EDGE.arrowWidth };
}

const hasStartArrow = (edge: EdgeModel) => edge.arrow === 'start' || edge.arrow === 'both';
const hasEndArrow = (edge: EdgeModel) => edge.arrow === 'end' || edge.arrow === 'both';

/* ────────────────────────────────────────────────────────────────────────
 * Obstacles
 * ──────────────────────────────────────────────────────────────────────── */

/** An axis-aligned box; routes may run along its border but never through its interior. */
type Box = { x0: number; y0: number; x1: number; y1: number };
type NodeBox = Box & { id: string };

/** Round to 1/1000 px so a coordinate and the grid line made from it compare equal. */
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function boxOf(rect: Rect, inflate: number): Box {
  return {
    x0: r3(rect.x - inflate),
    y0: r3(rect.y - inflate),
    x1: r3(rect.x + rect.width + inflate),
    y1: r3(rect.y + rect.height + inflate),
  };
}

function strictlyInside(box: Box, x: number, y: number): boolean {
  return x > box.x0 + EPS && x < box.x1 - EPS && y > box.y0 + EPS && y < box.y1 - EPS;
}

/** Whether an axis-aligned segment passes through the box's interior. */
function runHitsBox(a: Point, b: Point, box: Box): boolean {
  if (Math.abs(a.x - b.x) < EPS) {
    return (
      a.x > box.x0 + EPS &&
      a.x < box.x1 - EPS &&
      Math.min(a.y, b.y) < box.y1 - EPS &&
      Math.max(a.y, b.y) > box.y0 + EPS
    );
  }
  if (Math.abs(a.y - b.y) < EPS) {
    return (
      a.y > box.y0 + EPS &&
      a.y < box.y1 - EPS &&
      Math.min(a.x, b.x) < box.x1 - EPS &&
      Math.max(a.x, b.x) > box.x0 + EPS
    );
  }
  return segmentHitsRect(a, b, { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 });
}

/** Liang–Barsky: whether any part of segment ab lies inside the rect. */
function segmentHitsRect(a: Point, b: Point, rect: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < EPS) return q > 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, a.x - rect.x) &&
    clip(dx, rect.x + rect.width - a.x) &&
    clip(-dy, a.y - rect.y) &&
    clip(dy, rect.y + rect.height - a.y) &&
    t1 - t0 > EPS
  );
}

type GroupInfo = {
  id: string;
  box: Box;
  /** Index of the parent group in the same list, −1 for the root. */
  parent: number;
  depth: number;
  /** Only a group the reader can see (a border, a fill, a title, a caption) is worth steering around. */
  visible: boolean;
};

function groupInfos(layout: FigureLayout, model: FigureModel): GroupInfo[] {
  const groups = layout.groups.filter((group) => group.id !== ROOT_ID);
  const depthOf = (group: SceneGroup) => ancestorsOf(model, group.model.parent).length + 1;
  const sorted = groups
    .map((group, index) => ({ group, index, depth: depthOf(group) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index);
  const indexById = new Map(sorted.map((entry, i) => [entry.group.id, i]));
  return sorted.map(({ group, depth }) => {
    const m = group.model;
    return {
      id: group.id,
      box: boxOf(group.box, 0),
      parent: indexById.get(m.parent) ?? -1,
      depth,
      visible: m.border !== 'none' || m.filled || m.label !== null || m.panel !== null,
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * The orthogonal visibility grid
 * ──────────────────────────────────────────────────────────────────────── */

type Grid = {
  xs: number[];
  ys: number[];
  nx: number;
  ny: number;
  /** Per-px surcharge along each vertical (xs) and horizontal (ys) line. */
  costX: Float64Array;
  costY: Float64Array;
  /**
   * Obstacles covering each elementary segment: horizontal ones indexed
   * `j·(nx−1) + i` (from column i to i+1 on row j), vertical ones `j·nx + i`
   * (from row j to j+1 on column i).
   */
  hardH: Uint16Array;
  hardV: Uint16Array;
  softH: Uint16Array;
  softV: Uint16Array;
  /** Innermost group strictly around each grid point (`j·nx + i`), −1 for none. */
  groupAt: Int16Array;
  /** Segments claimed by routes found earlier, and points they run straight through. */
  usedH: Uint8Array;
  usedV: Uint8Array;
  throughH: Uint8Array;
  throughV: Uint8Array;
  /** Bends of earlier routes. */
  corner: Uint8Array;
};

/** First index whose value is ≥ v. */
function lowerBound(values: number[], v: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of a grid line, or −1 when the coordinate is not one. */
function lineIndex(values: number[], v: number): number {
  const target = r3(v);
  const i = lowerBound(values, target - EPS);
  return i < values.length && Math.abs(values[i] - target) < 1e-4 ? i : -1;
}

function sortedUnique(values: number[]): number[] {
  const sorted = values.map(r3).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (out.length === 0 || v - out[out.length - 1] > EPS) out.push(v);
  return out;
}

type GridInput = {
  hard: Box[];
  soft: Box[];
  groups: GroupInfo[];
  /** Lines every port's stub runs along (preferred) and the coordinates where stubs end. */
  portX: number[];
  portY: number[];
  stubX: number[];
  stubY: number[];
};

/**
 * One axis of the grid and each line's surcharge. `borders` are group
 * border coordinates: the lines at border ± clearance make a channel whose
 * centre is the border itself, and a route drawn on top of a group's
 * outline reads as part of it, so no midline is kept there.
 */
function lineSet(structural: number[], preferred: number[], plain: number[], borders: number[], withMidlines: boolean) {
  const base = sortedUnique(structural);
  const mids: number[] = [];
  if (withMidlines) {
    for (let k = 0; k + 1 < base.length; k += 1) {
      const mid = r3((base[k] + base[k + 1]) / 2);
      if (!borders.some((b) => Math.abs(b - mid) < 1)) mids.push(mid);
    }
  }
  const lines = sortedUnique([...base, ...mids, ...preferred, ...plain]);
  const favoured = new Set([...mids, ...preferred.map(r3)]);
  const cost = new Float64Array(lines.length);
  lines.forEach((v, i) => {
    cost[i] = favoured.has(v) ? 0 : OFF_CENTRE_COST;
  });
  return { lines, cost };
}

/**
 * Candidate lines: every obstacle border, every group border ± clearance,
 * a frame around everything, the port lines and stub ends, and the centre
 * line of every channel between consecutive borders — where a careful
 * drawing puts a jog.
 */
function buildGrid(input: GridInput): Grid {
  const c = EDGE.clearance;
  const structX: number[] = [];
  const structY: number[] = [];
  let frame: Box | null = null;
  const grow = (box: Box) => {
    frame = frame
      ? {
          x0: Math.min(frame.x0, box.x0),
          y0: Math.min(frame.y0, box.y0),
          x1: Math.max(frame.x1, box.x1),
          y1: Math.max(frame.y1, box.y1),
        }
      : { ...box };
  };
  for (const box of [...input.hard, ...input.soft]) {
    structX.push(box.x0, box.x1);
    structY.push(box.y0, box.y1);
    grow(box);
  }
  for (const { box } of input.groups) {
    structX.push(box.x0 - c, box.x0 + c, box.x1 - c, box.x1 + c);
    structY.push(box.y0 - c, box.y0 + c, box.y1 - c, box.y1 + c);
    grow({ x0: box.x0 - c, y0: box.y0 - c, x1: box.x1 + c, y1: box.y1 + c });
  }
  for (let k = 0; k < input.stubX.length; k += 1) grow({ x0: input.stubX[k], y0: input.stubY[k], x1: input.stubX[k], y1: input.stubY[k] });
  const outer = frame as Box | null;
  if (outer) {
    structX.push(outer.x0 - c, outer.x1 + c);
    structY.push(outer.y0 - c, outer.y1 + c);
  }

  const bordersX = input.groups.flatMap(({ box }) => [box.x0, box.x1]);
  const bordersY = input.groups.flatMap(({ box }) => [box.y0, box.y1]);
  let gx = lineSet(structX, input.portX, input.stubX, bordersX, true);
  let gy = lineSet(structY, input.portY, input.stubY, bordersY, true);
  if (gx.lines.length * gy.lines.length > MAX_GRID_POINTS) {
    gx = lineSet(structX, input.portX, input.stubX, bordersX, false);
    gy = lineSet(structY, input.portY, input.stubY, bordersY, false);
  }
  const xs = gx.lines;
  const ys = gy.lines;
  const nx = xs.length;
  const ny = ys.length;
  const grid: Grid = {
    xs,
    ys,
    nx,
    ny,
    costX: gx.cost,
    costY: gy.cost,
    hardH: new Uint16Array(Math.max(0, nx - 1) * ny),
    hardV: new Uint16Array(nx * Math.max(0, ny - 1)),
    softH: new Uint16Array(Math.max(0, nx - 1) * ny),
    softV: new Uint16Array(nx * Math.max(0, ny - 1)),
    groupAt: new Int16Array(nx * ny).fill(-1),
    usedH: new Uint8Array(Math.max(0, nx - 1) * ny),
    usedV: new Uint8Array(nx * Math.max(0, ny - 1)),
    throughH: new Uint8Array(nx * ny),
    throughV: new Uint8Array(nx * ny),
    corner: new Uint8Array(nx * ny),
  };
  for (const box of input.hard) rasterize(grid, box, grid.hardH, grid.hardV);
  for (const box of input.soft) rasterize(grid, box, grid.softH, grid.softV);
  // Shallow groups first, so a nested group overwrites its parent. The
  // border counts as inside: running along a foreign group's outline costs
  // as much as running through it.
  input.groups.forEach((group, g) => {
    const { box } = group;
    const i0 = lowerBound(xs, box.x0 - EPS);
    const i1 = lowerBound(xs, box.x1 + EPS);
    const j0 = lowerBound(ys, box.y0 - EPS);
    const j1 = lowerBound(ys, box.y1 + EPS);
    for (let j = j0; j < j1; j += 1) grid.groupAt.fill(g, j * nx + i0, j * nx + i1);
  });
  return grid;
}

/** Count the box against every elementary segment that runs through its interior. */
function rasterize(grid: Grid, box: Box, h: Uint16Array, v: Uint16Array): void {
  const { xs, ys, nx } = grid;
  const i0 = lowerBound(xs, box.x0 - EPS);
  const i1 = lowerBound(xs, box.x1 + EPS) - 1;
  const j0 = lowerBound(ys, box.y0 - EPS);
  const j1 = lowerBound(ys, box.y1 + EPS) - 1;
  for (let j = j0; j <= j1; j += 1) {
    if (!(ys[j] > box.y0 + EPS && ys[j] < box.y1 - EPS)) continue;
    for (let i = i0; i < i1; i += 1) h[j * (nx - 1) + i] += 1;
  }
  for (let i = i0; i <= i1; i += 1) {
    if (!(xs[i] > box.x0 + EPS && xs[i] < box.x1 - EPS)) continue;
    for (let j = j0; j < j1; j += 1) v[j * nx + i] += 1;
  }
}

/** `used*` value of a run another route can still be nudged off. */
const USED = 1;
/** `used*` value of a port run, which never moves: sharing it is sharing for good. */
const USED_PORT = 2;

/**
 * Record a finished route on the grid, so later routes pay for sharing its
 * runs and for crossing it. A run's first and last points need not be grid
 * points (a port lies inside its node's clearance), so pass-through points
 * are judged against the run's real extent, not the grid lines it spans.
 */
function claim(grid: Grid, points: Point[]): void {
  const { xs, ys, nx } = grid;
  const last = points.length - 2;
  for (let k = 0; k <= last; k += 1) {
    const a = points[k];
    const b = points[k + 1];
    const mark = k === 0 || k === last ? USED_PORT : USED;
    if (Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) > EPS) {
      const j = lineIndex(ys, a.y);
      if (j < 0) continue;
      const lo = Math.min(a.x, b.x);
      const hi = Math.max(a.x, b.x);
      const i0 = lowerBound(xs, lo - 1e-4);
      const i1 = lowerBound(xs, hi + 1e-4) - 1;
      for (let i = i0; i < i1; i += 1) grid.usedH[j * (nx - 1) + i] = Math.max(grid.usedH[j * (nx - 1) + i], mark);
      for (let i = i0; i <= i1; i += 1) if (xs[i] > lo + 1e-4 && xs[i] < hi - 1e-4) grid.throughH[j * nx + i] = 1;
    } else if (Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) > EPS) {
      const i = lineIndex(xs, a.x);
      if (i < 0) continue;
      const lo = Math.min(a.y, b.y);
      const hi = Math.max(a.y, b.y);
      const j0 = lowerBound(ys, lo - 1e-4);
      const j1 = lowerBound(ys, hi + 1e-4) - 1;
      for (let j = j0; j < j1; j += 1) grid.usedV[j * nx + i] = Math.max(grid.usedV[j * nx + i], mark);
      for (let j = j0; j <= j1; j += 1) if (ys[j] > lo + 1e-4 && ys[j] < hi - 1e-4) grid.throughV[j * nx + i] = 1;
    }
  }
  for (let k = 1; k < points.length - 1; k += 1) {
    const i = lineIndex(xs, points[k].x);
    const j = lineIndex(ys, points[k].y);
    if (i >= 0 && j >= 0) grid.corner[j * nx + i] = 1;
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * A* over (point, heading)
 * ──────────────────────────────────────────────────────────────────────── */

/** Headings: 0 right (+x), 1 down (+y), 2 left (−x), 3 up (−y). */
type Dir = 0 | 1 | 2 | 3;
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

function outward(side: Side): Dir {
  return side === 'right' ? 0 : side === 'bottom' ? 1 : side === 'left' ? 2 : 3;
}

const reverse = (d: number) => ((d + 2) & 3) as Dir;

/**
 * The fewest bends any rectilinear path needs from (p, heading d) to t,
 * arriving with heading e — obstacles only add to it, so it keeps the A*
 * heuristic admissible while steering it hard towards the right approach.
 */
export function minBends(p: Point, d: Dir, t: Point, e: Dir): number {
  return bendsBetween(t.x - p.x, t.y - p.y, d, e);
}

/** `minBends` on the offset to the target, allocation-free for the search's inner loop. */
function bendsBetween(dx: number, dy: number, d: Dir, e: Dir): number {
  const ahead = dx * DX[d] + dy * DY[d];
  if (e === d) {
    const aside = dx * DY[d] - dy * DX[d];
    if (ahead < -EPS) return 4;
    return Math.abs(aside) < EPS ? 0 : 2;
  }
  if (e === reverse(d)) return 2;
  const along = dx * DX[e] + dy * DY[e];
  return ahead >= -EPS && along >= -EPS ? 1 : 3;
}

/**
 * Binary min-heap of search entries ordered by (f, h, insertion), where
 * f = g + weight·h. `h` is kept unweighted, so the weight can be raised
 * mid-search and the heap rebuilt around it.
 */
class OpenSet {
  private heap: number[] = [];
  private readonly f: number[] = [];
  private readonly h: number[] = [];
  readonly state: number[] = [];
  readonly g: number[] = [];
  private weight = 1;

  get size(): number {
    return this.heap.length;
  }

  push(state: number, g: number, h: number): void {
    const id = this.state.length;
    this.state.push(state);
    this.g.push(g);
    this.h.push(h);
    this.f.push(g + this.weight * h);
    const heap = this.heap;
    let i = heap.length;
    heap.push(id);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(id, heap[parent])) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = id;
  }

  /** The entry id with the smallest key; the caller checks `size` first. */
  pop(): number {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length > 0) this.siftDown(0, last);
    return top;
  }

  /** Re-key every open entry under a new heuristic weight. */
  reweight(weight: number): void {
    this.weight = weight;
    const heap = this.heap;
    for (const id of heap) this.f[id] = this.g[id] + weight * this.h[id];
    for (let i = (heap.length >> 1) - 1; i >= 0; i -= 1) this.siftDown(i, heap[i]);
  }

  private siftDown(from: number, id: number): void {
    const heap = this.heap;
    const n = heap.length;
    let i = from;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const child = r < n && this.less(heap[r], heap[l]) ? r : l;
      if (!this.less(heap[child], id)) break;
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = id;
  }

  private less(a: number, b: number): boolean {
    const fa = this.f[a];
    const fb = this.f[b];
    if (fa !== fb) return fa < fb;
    const ha = this.h[a];
    const hb = this.h[b];
    if (ha !== hb) return ha < hb;
    return a < b;
  }
}

/** Above this many search states (32 MB of tables) the searches fall back to maps, bounding memory on huge grids. */
const MAX_TABLE_STATES = 1 << 21;

/**
 * Best cost and predecessor of every (point, heading) state, shared by all
 * the searches on one grid. A stamp per search clears it in O(1); typed
 * arrays keep the inner loop free of hashing on ordinary figures.
 */
class StateTable {
  private stamp = 0;
  private readonly seen: Uint32Array | null;
  private readonly cost: Float64Array | null;
  private readonly prev: Int32Array | null;
  private costMap = new Map<number, number>();
  private prevMap = new Map<number, number>();

  constructor(states: number) {
    const small = states <= MAX_TABLE_STATES;
    this.seen = small ? new Uint32Array(states) : null;
    this.cost = small ? new Float64Array(states) : null;
    this.prev = small ? new Int32Array(states) : null;
  }

  begin(): void {
    this.stamp += 1;
    if (!this.seen) {
      this.costMap = new Map();
      this.prevMap = new Map();
    }
  }

  best(state: number): number {
    if (this.seen) return this.seen[state] === this.stamp ? (this.cost as Float64Array)[state] : Infinity;
    return this.costMap.get(state) ?? Infinity;
  }

  from(state: number): number {
    if (this.seen) return this.seen[state] === this.stamp ? (this.prev as Int32Array)[state] : -1;
    return this.prevMap.get(state) ?? -1;
  }

  set(state: number, cost: number, from: number): void {
    if (this.seen) {
      this.seen[state] = this.stamp;
      (this.cost as Float64Array)[state] = cost;
      (this.prev as Int32Array)[state] = from;
    } else {
      this.costMap.set(state, cost);
      this.prevMap.set(state, from);
    }
  }
}

/**
 * The search runs as plain A* first, which finds the cheapest route and
 * breaks ties towards channel centres, and grows the heuristic's weight
 * whenever it runs longer than that: a crowded fan-out, where every route
 * pays for sharing and crossing the ones before it, would otherwise flood
 * the whole grid. Past the first stage a route costs at most `weight` times
 * the cheapest one. Expansions at which each stage begins, and its weight.
 */
const SEARCH_STAGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1_000, 1.5],
  [2_500, 2.5],
  [6_000, 5],
];

/** Counts every A* expansion of one `routeFigure` call against the figure-wide cap. */
type Budget = { left: number };

type Search = {
  start: number;
  startDir: Dir;
  goal: number;
  /** Heading of the final run into the target port. */
  goalDir: Dir;
  /**
   * Obstacles around the start or goal stub end: the endpoints' own boxes,
   * which the route may cross, and a neighbour's clearance box, which it may
   * cross only outside the neighbour itself (`body`).
   */
  excluded: Excluded[];
  /** Per group: how many foreign groups enclose it (itself included); null when none are foreign. */
  foreign: Int32Array | null;
  groupParent: Int32Array;
  groupDepth: Int32Array;
};

type Excluded = { box: Box; body: Box | null };

const GOAL = -1;

function turnCost(d: Dir, e: Dir): number {
  if (d === e) return 0;
  return d === reverse(e) ? Infinity : EDGE.bendPenalty;
}

/** Foreign groups around point b that do not also enclose point a. */
function groupsEntered(a: number, b: number, s: Search, foreign: Int32Array): number {
  if (b < 0) return 0;
  let x = a;
  let y = b;
  while (x !== y) {
    const dx = x < 0 ? 0 : s.groupDepth[x];
    const dy = y < 0 ? 0 : s.groupDepth[y];
    if (dx >= dy && x >= 0) x = s.groupParent[x];
    if (dy >= dx && y >= 0) y = s.groupParent[y];
  }
  return foreign[b] - (x >= 0 ? foreign[x] : 0);
}

/** How many of the obstacles covering the point the search may pass through. */
function coveredByExcluded(excluded: Excluded[], x: number, y: number): number {
  let n = 0;
  for (const { box, body } of excluded) if (strictlyInside(box, x, y) && !(body && strictlyInside(body, x, y))) n += 1;
  return n;
}

/** Whether the elementary grid segment from (i, j) to (ni, nj) runs through an obstacle the search may not cross. */
function segmentBlocked(grid: Grid, excluded: Excluded[], i: number, j: number, ni: number, nj: number): boolean {
  const horizontal = j === nj;
  const hard = horizontal ? grid.hardH[j * (grid.nx - 1) + Math.min(i, ni)] : grid.hardV[Math.min(j, nj) * grid.nx + i];
  if (hard === 0) return false;
  if (excluded.length === 0) return true;
  return hard > coveredByExcluded(excluded, (grid.xs[i] + grid.xs[ni]) / 2, (grid.ys[j] + grid.ys[nj]) / 2);
}

/**
 * Cheapest path on the grid from the source stub to the target stub, as
 * grid point indices with its cost, or null when there is none within the
 * edge's cap or the figure's budget. Cost: length, `bendPenalty` per bend,
 * `crossingPenalty` per crossing of an earlier route, half the length again
 * on runs an earlier route already uses, `groupPenalty` per foreign group
 * entered plus twice the length inside it, and a toll for running through a
 * text box.
 */
function search(grid: Grid, table: StateTable, s: Search, budget: Budget): { path: number[]; cost: number } | null {
  const { xs, ys, nx, ny } = grid;
  const gi = s.goal % nx;
  const gj = (s.goal - gi) / nx;
  const tx = xs[gi];
  const ty = ys[gj];
  const goalDir = s.goalDir;
  const heuristic = (i: number, j: number, d: Dir) =>
    Math.abs(xs[i] - tx) + Math.abs(ys[j] - ty) + EDGE.bendPenalty * bendsBetween(tx - xs[i], ty - ys[j], d, goalDir);

  table.begin();
  const open = new OpenSet();
  const si = s.start % nx;
  const sj = (s.start - si) / nx;
  const startState = s.start * 4 + s.startDir;
  table.set(startState, 0, -1);
  open.push(startState, 0, heuristic(si, sj, s.startDir));
  const cap = Math.min(MAX_EXPANSIONS, budget.left);
  let stage = 1;
  let goalCost = Infinity;
  let goalFrom = -1;
  let expansions = 0;

  while (open.size > 0) {
    const id = open.pop();
    const state = open.state[id];
    const g = open.g[id];
    if (state === GOAL) {
      budget.left -= expansions;
      const path: number[] = [];
      for (let at = goalFrom; at >= 0; at = table.from(at)) path.push(at >> 2);
      return { path: path.reverse(), cost: g };
    }
    if (g > table.best(state)) continue;
    if (expansions >= cap) {
      budget.left -= expansions;
      return null;
    }
    expansions += 1;
    if (stage < SEARCH_STAGES.length && expansions >= SEARCH_STAGES[stage][0]) {
      open.reweight(SEARCH_STAGES[stage][1]);
      stage += 1;
    }
    const p = state >> 2;
    const d = (state & 3) as Dir;
    if (p === s.goal) {
      const total = g + turnCost(d, goalDir);
      if (total < goalCost) {
        goalCost = total;
        goalFrom = state;
        open.push(GOAL, total, 0);
      }
    }
    const i = p % nx;
    const j = (p - i) / nx;
    // Passing another route's corner on neither of its runs makes the two
    // corners kiss, which reads as a junction; sharing a run there is an
    // overlap that nudging separates.
    let usedIn = 1;
    if (grid.corner[p] && p !== s.start) {
      const bi = i - DX[d];
      const bj = j - DY[d];
      usedIn = d === 0 || d === 2 ? grid.usedH[j * (nx - 1) + Math.min(i, bi)] : grid.usedV[Math.min(j, bj) * nx + i];
    }
    // Straight on, then the two turns; never back.
    for (let turn = 0; turn < 3; turn += 1) {
      const nd = (turn === 0 ? d : turn === 1 ? (d + 1) & 3 : (d + 3) & 3) as Dir;
      const ni = i + DX[nd];
      const nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      if (segmentBlocked(grid, s.excluded, i, j, ni, nj)) continue;
      const horizontal = nd === 0 || nd === 2;
      const seg = horizontal ? j * (nx - 1) + Math.min(i, ni) : Math.min(j, nj) * nx + i;
      const q = nj * nx + ni;
      const len = horizontal ? Math.abs(xs[ni] - xs[i]) : Math.abs(ys[nj] - ys[j]);
      let cost = len * (1 + (horizontal ? grid.costY[j] : grid.costX[i]));
      if (nd !== d) cost += EDGE.bendPenalty;
      const used = horizontal ? grid.usedH[seg] : grid.usedV[seg];
      if (used) cost += (used === USED_PORT ? 0.5 + PORT_RUN_SHARE : 0.5) * len;
      else if (!usedIn) cost += EDGE.crossingPenalty;
      if (horizontal ? grid.throughV[q] : grid.throughH[q]) cost += EDGE.crossingPenalty;
      if (horizontal ? grid.softH[seg] : grid.softV[seg]) cost += LABEL_COST;
      if (s.foreign) {
        const ga = grid.groupAt[p];
        const gb = grid.groupAt[q];
        if (ga !== gb) cost += EDGE.groupPenalty * groupsEntered(ga, gb, s, s.foreign);
        if (gb >= 0 && s.foreign[gb] > 0) cost += 2 * len;
      }
      const ng = g + cost;
      const ns = q * 4 + nd;
      if (ng >= table.best(ns)) continue;
      const h = heuristic(ni, nj, nd);
      // The unweighted heuristic is a true lower bound, so this prunes safely at any stage.
      if (ng + h >= goalCost) continue;
      table.set(ns, ng, state);
      open.push(ns, ng, h);
    }
  }
  budget.left -= expansions;
  return null;
}

/** Drop repeated points and the middle of straight runs, treating coordinates within `tolerance` as equal. */
function simplify(points: Point[], tolerance = EPS): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) <= tolerance && Math.abs(last.y - p.y) <= tolerance) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = last;
      const collinear =
        (Math.abs(a.x - b.x) <= tolerance && Math.abs(b.x - p.x) <= tolerance) ||
        (Math.abs(a.y - b.y) <= tolerance && Math.abs(b.y - p.y) <= tolerance);
      if (collinear) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/**
 * Make a grid route exactly orthogonal. Grid lines are rounded to 1/1000
 * px while ports are not, so a run can sit a hair off its axis — enough to
 * stop it merging with its neighbour and to hide a port run from nudging.
 * Each run takes its coordinate from the port it starts or ends at, or else
 * from its grid line; the end points stay exactly on their outlines.
 */
function rectify(points: Point[]): Point[] {
  const pts = simplify(points, 2e-3);
  const n = pts.length;
  if (n < 2) return pts;
  const vertical = (k: number) => Math.abs(pts[k].x - pts[k + 1].x) <= Math.abs(pts[k].y - pts[k + 1].y);
  if (n === 2) {
    // One run between two ports already in line: move the far end along its side.
    return vertical(0) ? [pts[0], { x: pts[0].x, y: pts[1].y }] : [pts[0], { x: pts[1].x, y: pts[0].y }];
  }
  // Grid moves alternate once collinear runs are merged; anything else is left as found.
  for (let k = 1; k < n - 1; k += 1) if (vertical(k - 1) === vertical(k)) return pts;
  const line = (k: number): number => {
    const v = vertical(k);
    if (k === 0) return v ? pts[0].x : pts[0].y;
    if (k === n - 2) return v ? pts[n - 1].x : pts[n - 1].y;
    return v ? (pts[k].x + pts[k + 1].x) / 2 : (pts[k].y + pts[k + 1].y) / 2;
  };
  const out: Point[] = [pts[0]];
  for (let k = 1; k < n - 1; k += 1) {
    // An interior point joins one vertical and one horizontal run.
    const before = vertical(k - 1);
    out.push(before ? { x: line(k - 1), y: line(k) } : { x: line(k), y: line(k - 1) });
  }
  out.push(pts[n - 1]);
  return simplify(out);
}

/* ────────────────────────────────────────────────────────────────────────
 * Nudging
 * ──────────────────────────────────────────────────────────────────────── */

type Route = { points: Point[]; stubs: [number, number]; order: number };

type Run = {
  route: Route;
  /** Index of the run's first point in `route.points`. */
  k: number;
  coord: number;
  lo: number;
  hi: number;
  /** Port runs never move: they carry the port and the arrowhead. */
  fixed: boolean;
  /** Which way the route turns at the low / high end: −1 towards smaller coordinates, +1 larger, 0 none. */
  turnLo: number;
  turnHi: number;
};

function collectRuns(routes: Route[], horizontal: boolean): Run[] {
  const runs: Run[] = [];
  for (const route of routes) {
    const pts = route.points;
    const n = pts.length;
    for (let k = 0; k + 1 < n; k += 1) {
      const a = pts[k];
      const b = pts[k + 1];
      const isRun = horizontal
        ? Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) > EPS
        : Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) > EPS;
      if (!isRun) continue;
      const along = (p: Point) => (horizontal ? p.x : p.y);
      const across = (p: Point) => (horizontal ? p.y : p.x);
      const coord = across(a);
      const turn = (neighbour: Point | undefined) =>
        neighbour ? Math.sign(Math.round((across(neighbour) - coord) * 1000)) : 0;
      const aIsLow = along(a) < along(b);
      const turnA = turn(k > 0 ? pts[k - 1] : undefined);
      const turnB = turn(k + 2 < n ? pts[k + 2] : undefined);
      runs.push({
        route,
        k,
        coord,
        lo: Math.min(along(a), along(b)),
        hi: Math.max(along(a), along(b)),
        fixed: k === 0 || k === n - 2,
        turnLo: aIsLow ? turnA : turnB,
        turnHi: aIsLow ? turnB : turnA,
      });
    }
  }
  return runs;
}

/**
 * Order of two parallel runs across their shared channel that avoids a
 * crossing: where one run ends and turns off while the other carries on,
 * the one turning towards smaller coordinates goes on that side.
 */
function compareRuns(s: Run, t: Run): number {
  const atLow = (() => {
    if (s.lo < t.lo - EPS) return t.turnLo === 0 ? 0 : -t.turnLo;
    if (t.lo < s.lo - EPS) return s.turnLo;
    return Math.sign(s.turnLo - t.turnLo);
  })();
  const atHigh = (() => {
    if (s.hi > t.hi + EPS) return t.turnHi === 0 ? 0 : -t.turnHi;
    if (t.hi > s.hi + EPS) return s.turnHi;
    return Math.sign(s.turnHi - t.turnHi);
  })();
  // When the two ends disagree a crossing is unavoidable; the low end decides.
  const vote = atLow !== 0 ? atLow : atHigh;
  if (vote !== 0) return vote;
  if (Math.abs(s.coord - t.coord) > EPS) return s.coord - t.coord;
  return s.route.order - t.route.order || s.k - t.k;
}

/**
 * How far a run may move across its axis: its own obstacles, the
 * obstacles its neighbouring runs would grow into, and the neighbours'
 * minimum lengths (a port run keeps its stub, so the arrowhead and the
 * first bend stay clear of the node).
 */
function runRange(run: Run, horizontal: boolean, boxes: Box[]): [number, number] {
  const pts = run.route.points;
  const { k, coord: c, lo: s0, hi: s1 } = run;
  const n = pts.length;
  const across = (p: Point) => (horizontal ? p.y : p.x);
  const along = (p: Point) => (horizontal ? p.x : p.y);
  const neighbours: Array<{ at: number; other: number; min: number }> = [];
  if (k > 0) {
    neighbours.push({ at: along(pts[k]), other: across(pts[k - 1]), min: k - 1 === 0 ? run.route.stubs[0] : MIN_RUN });
  }
  if (k + 2 < n) {
    neighbours.push({
      at: along(pts[k + 1]),
      other: across(pts[k + 2]),
      min: k + 1 === n - 2 ? run.route.stubs[1] : MIN_RUN,
    });
  }
  let lo = -Infinity;
  let hi = Infinity;
  for (const { other, min } of neighbours) {
    if (other < c) lo = Math.max(lo, other + min);
    else hi = Math.min(hi, other - min);
  }
  for (const box of boxes) {
    const a0 = horizontal ? box.x0 : box.y0;
    const a1 = horizontal ? box.x1 : box.y1;
    const c0 = horizontal ? box.y0 : box.x0;
    const c1 = horizontal ? box.y1 : box.x1;
    if (s0 < a1 - EPS && s1 > a0 + EPS) {
      if (c <= c0 + EPS) hi = Math.min(hi, c0);
      else if (c >= c1 - EPS) lo = Math.max(lo, c1);
    }
    for (const { at, other } of neighbours) {
      if (!(at > a0 + EPS && at < a1 - EPS)) continue;
      // Already through this box (a port run inside its own node): not ours to fix.
      if (Math.min(other, c) < c1 - EPS && Math.max(other, c) > c0 + EPS) continue;
      if (other < c && c0 >= c - EPS) hi = Math.min(hi, c0);
      if (other > c && c1 <= c + EPS) lo = Math.max(lo, c1);
    }
  }
  return [Math.min(lo, c), Math.max(hi, c)];
}

/**
 * Positions for an ordered bundle: `gap` apart, centred on where the runs
 * are now, each within its range. Shrinks the gap when the channel is
 * tight; null when no spacing fits.
 */
function placeBundle(coords: number[], ranges: Array<[number, number]>): number[] | null {
  const n = coords.length;
  const centre = coords.reduce((sum, v) => sum + v, 0) / n;
  for (const factor of [1, 0.75, 0.5, 0.3]) {
    const gap = EDGE.nudge * factor;
    const p = coords.map((_, i) => clamp(centre + (i - (n - 1) / 2) * gap, ranges[i][0], ranges[i][1]));
    for (let pass = 0; pass < n + 2; pass += 1) {
      let moved = false;
      for (let i = 1; i < n; i += 1) {
        if (p[i] < p[i - 1] + gap - EPS) {
          p[i] = Math.min(p[i - 1] + gap, ranges[i][1]);
          moved = true;
        }
      }
      for (let i = n - 2; i >= 0; i -= 1) {
        if (p[i] > p[i + 1] - gap + EPS) {
          p[i] = Math.max(p[i + 1] - gap, ranges[i][0]);
          moved = true;
        }
      }
      if (!moved) break;
    }
    const fits = p.every(
      (v, i) => v >= ranges[i][0] - EPS && v <= ranges[i][1] + EPS && (i === 0 || v - p[i - 1] >= gap - 1e-3),
    );
    if (fits) return p;
  }
  return null;
}

function insertionSort<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  const out = items.slice();
  for (let i = 1; i < out.length; i += 1) {
    const item = out[i];
    let j = i - 1;
    while (j >= 0 && compare(out[j], item) > 0) {
      out[j + 1] = out[j];
      j -= 1;
    }
    out[j + 1] = item;
  }
  return out;
}

function nudgeBundle(bundle: Run[], horizontal: boolean, boxes: Box[]): void {
  const ordered = insertionSort(bundle, compareRuns);
  // Port runs cannot move; if the preferred order squeezes a movable run
  // between two of them, try them all on one side instead.
  const attempts = [
    ordered,
    [...ordered.filter((r) => r.fixed), ...ordered.filter((r) => !r.fixed)],
    [...ordered.filter((r) => !r.fixed), ...ordered.filter((r) => r.fixed)],
  ];
  for (const order of attempts) {
    const ranges = order.map((run): [number, number] =>
      run.fixed ? [run.coord, run.coord] : runRange(run, horizontal, boxes),
    );
    const placed = placeBundle(
      order.map((run) => run.coord),
      ranges,
    );
    if (!placed) continue;
    order.forEach((run, i) => {
      if (run.fixed || Math.abs(placed[i] - run.coord) < EPS) return;
      const pts = run.route.points;
      for (const idx of [run.k, run.k + 1]) {
        pts[idx] = horizontal ? { x: pts[idx].x, y: placed[i] } : { x: placed[i], y: pts[idx].y };
      }
      run.coord = placed[i];
    });
    return;
  }
}

/**
 * Spread parallel runs of different routes that share a line (or nearly
 * do) `nudge` px apart, in an order that avoids crossings. Horizontal runs
 * first, then vertical ones, which see the horizontal moves.
 */
function nudgeRoutes(routes: Route[], boxes: Box[]): void {
  for (const horizontal of [true, false]) {
    const runs = collectRuns(routes, horizontal).sort(
      (a, b) => a.coord - b.coord || a.lo - b.lo || a.route.order - b.route.order || a.k - b.k,
    );
    // Two runs of different routes clash when they are within reach across
    // and overlap along; a bundle is a connected set of clashes.
    const root = runs.map((_, i) => i);
    const find = (i: number): number => {
      while (root[i] !== i) {
        root[i] = root[root[i]];
        i = root[i];
      }
      return i;
    };
    for (let i = 0; i < runs.length; i += 1) {
      for (let j = i + 1; j < runs.length && runs[j].coord - runs[i].coord < NUDGE_REACH; j += 1) {
        const a = runs[i];
        const b = runs[j];
        if (a.route === b.route) continue;
        if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) <= 0.5) continue;
        const ra = find(i);
        const rb = find(j);
        if (ra !== rb) root[Math.max(ra, rb)] = Math.min(ra, rb);
      }
    }
    const bundles = new Map<number, Run[]>();
    runs.forEach((run, i) => {
      const r = find(i);
      const list = bundles.get(r);
      if (list) list.push(run);
      else bundles.set(r, [run]);
    });
    // Keyed by the first run's index, so bundles are handled in coordinate order.
    for (const bundle of bundles.values()) {
      if (bundle.length < 2 || bundle.every((run) => run.fixed)) continue;
      nudgeBundle(bundle, horizontal, boxes);
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Path data and arrowheads
 * ──────────────────────────────────────────────────────────────────────── */

function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  return len < EPS ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
}

/** The last point before `index` that differs from it (routes may repeat a point). */
function distinctNeighbour(points: Point[], index: number, step: 1 | -1): Point | null {
  const p = points[index];
  for (let k = index + step; k >= 0 && k < points.length; k += step) {
    const q = points[k];
    if (Math.hypot(q.x - p.x, q.y - p.y) > EPS) return q;
  }
  return null;
}

/** A filled triangle whose tip touches the outline, pointing along `direction`. */
function arrowhead(tip: Point, direction: Point, length: number, width: number): Arrowhead {
  const u = Math.hypot(direction.x, direction.y) < EPS ? { x: 0, y: 1 } : direction;
  const bx = tip.x - u.x * length;
  const by = tip.y - u.y * length;
  const px = -u.y * (width / 2);
  const py = u.x * (width / 2);
  return {
    tip,
    polygon: [tip, { x: bx + px, y: by + py }, { x: bx - px, y: by - py }],
  };
}

/** Pull one end of a polyline back by `by` px along its last run. */
function shorten(points: Point[], atEnd: boolean, by: number): Point[] {
  const out = points.slice();
  const i = atEnd ? out.length - 1 : 0;
  const neighbour = distinctNeighbour(out, i, atEnd ? -1 : 1);
  if (!neighbour || by <= 0) return out;
  const p = out[i];
  const len = Math.hypot(p.x - neighbour.x, p.y - neighbour.y);
  const t = Math.min(by, len) / len;
  out[i] = { x: p.x + (neighbour.x - p.x) * t, y: p.y + (neighbour.y - p.y) * t };
  return out;
}

const f = formatCoordinate;

/** Polyline path with every corner rounded by at most `radius`, never more than half a run. */
function roundedPath(points: Point[], radius: number): string {
  const pts = simplifyPolyline(points);
  if (pts.length === 0) return '';
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let k = 1; k + 1 < pts.length; k += 1) {
    const prev = pts[k - 1];
    const cur = pts[k];
    const next = pts[k + 1];
    const lin = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const lout = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, lin / 2, lout / 2);
    if (r < 0.05) {
      d += `L${f(cur.x)} ${f(cur.y)}`;
      continue;
    }
    const uin = unit(prev, cur);
    const uout = unit(cur, next);
    const a = { x: cur.x - uin.x * r, y: cur.y - uin.y * r };
    const b = { x: cur.x + uout.x * r, y: cur.y + uout.y * r };
    const sweep = uin.x * uout.y - uin.y * uout.x > 0 ? 1 : 0;
    d += `L${f(a.x)} ${f(a.y)}A${f(r)} ${f(r)} 0 0 ${sweep} ${f(b.x)} ${f(b.y)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${f(last.x)} ${f(last.y)}`;
}

/** Like `simplify`, for any polyline: only exact repeats and collinear middles go. */
function simplifyPolyline(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < EPS) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const cross = (last.x - a.x) * (p.y - last.y) - (last.y - a.y) * (p.x - last.x);
      const dot = (last.x - a.x) * (p.x - last.x) + (last.y - a.y) * (p.y - last.y);
      if (Math.abs(cross) < 1e-6 && dot > 0) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

function bezierPoint(p: Point[], t: number): Point {
  const s = 1 - t;
  const a = s * s * s;
  const b = 3 * s * s * t;
  const c = 3 * s * t * t;
  const d = t * t * t;
  return {
    x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x,
    y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y,
  };
}

/** The stroke as line segments, for label collision checks (curves sampled). */
function strokeSegments(points: Point[], curved: boolean): Array<[Point, Point]> {
  const pts = curved ? Array.from({ length: 17 }, (_, i) => bezierPoint(points, i / 16)) : points;
  const out: Array<[Point, Point]> = [];
  for (let k = 0; k + 1 < pts.length; k += 1) out.push([pts[k], pts[k + 1]]);
  return out;
}

/* ────────────────────────────────────────────────────────────────────────
 * Edge labels
 * ──────────────────────────────────────────────────────────────────────── */

type LabelSpot = { x: number; y: number; align: LabelBox['align']; anchor: number };

/**
 * Candidate places for a label, best first: beside the midpoint of the
 * longest inner run (right of a vertical run, above a horizontal one), then
 * its other side, then the next-longest run; after every midpoint, the two
 * ends of each run long enough to hold the label, for when two labelled
 * edges leave a node side by side. Diagonal and curved edges offer both
 * sides of their midpoint.
 */
function labelSpots(points: Point[], curved: boolean, width: number, height: number): LabelSpot[] {
  const gap = EDGE.labelGap;
  const axisAligned =
    !curved &&
    points.every((p, k) => k === 0 || Math.abs(p.x - points[k - 1].x) < EPS || Math.abs(p.y - points[k - 1].y) < EPS);
  if (!axisAligned) {
    const mid = curved ? bezierPoint(points, 0.5) : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
    const tangent = curved ? unit(bezierPoint(points, 0.45), bezierPoint(points, 0.55)) : unit(points[0], points[1]);
    const normal = { x: -tangent.y, y: tangent.x };
    const sides = [normal, { x: -normal.x, y: -normal.y }].sort((a, b) => b.x - a.x || a.y - b.y);
    return sides.map((n) => {
      // Far enough along the normal that the box's nearest corner clears the line by `gap`.
      const reach = gap + Math.abs(n.x) * (width / 2) + Math.abs(n.y) * (height / 2);
      return { x: mid.x + n.x * reach - width / 2, y: mid.y + n.y * reach - height / 2, align: 'center' as const, anchor: -1 };
    });
  }
  const runs = points
    .slice(0, -1)
    .map((a, k) => ({ a, b: points[k + 1], k, len: Math.hypot(points[k + 1].x - a.x, points[k + 1].y - a.y) }));
  // Inner runs first; the port runs, which carry the stubs and arrowheads, only as a fallback.
  const byLength = (p: { len: number; k: number }, q: { len: number; k: number }) => q.len - p.len || p.k - q.k;
  const isInner = (k: number) => k > 0 && k < runs.length - 1;
  const pool = [
    ...runs.filter((run) => isInner(run.k)).sort(byLength),
    ...runs.filter((run) => !isInner(run.k)).sort(byLength),
  ].filter((run) => run.len > EPS);
  const beside = (x: number, y: number, vertical: boolean, k: number): LabelSpot[] =>
    vertical
      ? [
          { x: x + gap, y, align: 'left', anchor: k },
          { x: x - gap - width, y, align: 'right', anchor: k },
        ]
      : [
          { x, y: y - gap - height, align: 'center', anchor: k },
          { x, y: y + gap, align: 'center', anchor: k },
        ];
  const spots: LabelSpot[] = [];
  for (const { a, b, k } of pool) {
    const vertical = Math.abs(a.x - b.x) < EPS;
    spots.push(...beside(vertical ? a.x : (a.x + b.x) / 2 - width / 2, vertical ? (a.y + b.y) / 2 - height / 2 : a.y, vertical, k));
  }
  const margin = 2;
  for (const { a, b, k, len } of pool) {
    const vertical = Math.abs(a.x - b.x) < EPS;
    const size = vertical ? height : width;
    if (len < size + 2 * margin) continue;
    const lo = Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x) + margin;
    const hi = Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x) - margin - size;
    for (const at of [lo, hi]) spots.push(...beside(vertical ? a.x : at, vertical ? at : a.y, vertical, k));
  }
  return spots;
}

/* ────────────────────────────────────────────────────────────────────────
 * Entry point
 * ──────────────────────────────────────────────────────────────────────── */

function warning(edge: EdgeModel, code: string, message: string): FigureDiagnostic {
  return { severity: 'warning', code, message, path: edge.path, ...(edge.range ? { range: edge.range } : {}) };
}

/** Where a straight line between two outlines leaves each of them. */
function clippedLine(a: Endpoint, b: Endpoint): Point[] {
  const ca = center(a.rect);
  const cb = center(b.rect);
  return [clipToOutline(a.outline, ca, cb), clipToOutline(b.outline, cb, ca)];
}

/**
 * An arrowhead never points into a caption: an arrival on the captioned side
 * of a tensor or an image (under it, or over it) comes round to the flank
 * facing the other end instead, unless the author pinned that side. A
 * departure there has no head and starts beyond the caption.
 */
function avoidCaptions(edge: EdgeModel, sides: [Side, Side], from: Endpoint, to: Endpoint): [Side, Side] {
  const out: [Side, Side] = [sides[0], sides[1]];
  for (const which of [0, 1] as const) {
    const endpoint = which === 0 ? from : to;
    const other = which === 0 ? to : from;
    const pinned = which === 0 ? edge.fromSide : edge.toSide;
    const arrow = which === 0 ? hasStartArrow(edge) : hasEndArrow(edge);
    const onCaption =
      (out[which] === 'bottom' && endpoint.foot !== null) || (out[which] === 'top' && endpoint.head !== null);
    if (!onCaption || pinned || !arrow) continue;
    out[which] = center(other.rect).x < center(endpoint.rect).x ? 'left' : 'right';
  }
  return out;
}

/** A grid point as (column, row). */
type Cell = [number, number];

/** Heading of the run from p to q, or −1 when they coincide. */
function headingOf(p: Cell, q: Cell): number {
  if (q[0] !== p[0]) return q[0] > p[0] ? 0 : 2;
  if (q[1] !== p[1]) return q[1] > p[1] ? 1 : 3;
  return -1;
}

/** Obstacles an axis-aligned run crosses, per grid step: a node counts a thousand times a text box. */
function runHits(grid: Grid, excluded: Excluded[], from: Cell, to: Cell, stopAt: number): number {
  const { nx } = grid;
  const [i0, j0] = from;
  const [i1, j1] = to;
  let hits = 0;
  if (j0 === j1) {
    const step = i1 > i0 ? 1 : -1;
    for (let i = i0; i !== i1 && hits < stopAt; i += step) {
      if (segmentBlocked(grid, excluded, i, j0, i + step, j0)) hits += 1000;
      else if (grid.softH[j0 * (nx - 1) + Math.min(i, i + step)]) hits += 1;
    }
  } else {
    const step = j1 > j0 ? 1 : -1;
    for (let j = j0; j !== j1 && hits < stopAt; j += step) {
      if (segmentBlocked(grid, excluded, i0, j, i0, j + step)) hits += 1000;
      else if (grid.softV[Math.min(j, j + step) * nx + i0]) hits += 1;
    }
  }
  return hits;
}

/**
 * A simple orthogonal route for an edge the search could not afford or did
 * not find: the best of a few shapes with up to four bends, through the stub
 * ends, the grid lines midway between them and the frame around everything.
 * Fewest obstacles crossed first, then bends and length. Null only when every
 * shape would double back on itself.
 */
function simpleRoute(grid: Grid, excluded: Excluded[], a: Cell, d0: Dir, b: Cell, e: Dir): Cell[] | null {
  const { xs, ys, nx, ny } = grid;
  const [ai, aj] = a;
  const [bi, bj] = b;
  const nearest = (values: number[], v: number) => {
    const k = Math.min(values.length - 1, lowerBound(values, v));
    return k > 0 && v - values[k - 1] < values[k] - v ? k - 1 : k;
  };
  const unique = (values: number[]) => [...new Set(values)];
  const cols = unique([ai, bi, nearest(xs, (xs[ai] + xs[bi]) / 2), 0, nx - 1]);
  const rows = unique([aj, bj, nearest(ys, (ys[aj] + ys[bj]) / 2), 0, ny - 1]);
  // Straight out to the frame along the start's heading, and in from it against the goal's.
  const outRows = unique([aj, d0 === 1 ? ny - 1 : d0 === 3 ? 0 : aj]);
  const inRows = unique([bj, e === 1 ? 0 : e === 3 ? ny - 1 : bj]);
  const outCols = unique([ai, d0 === 0 ? nx - 1 : d0 === 2 ? 0 : ai]);
  const inCols = unique([bi, e === 0 ? 0 : e === 2 ? nx - 1 : bi]);
  const shapes: Cell[][] = [];
  for (const x of cols) for (const y1 of outRows) for (const y2 of inRows) shapes.push([a, [ai, y1], [x, y1], [x, y2], [bi, y2], b]);
  for (const y of rows) for (const x1 of outCols) for (const x2 of inCols) shapes.push([a, [x1, aj], [x1, y], [x2, y], [x2, bj], b]);

  const candidates: Array<{ cells: Cell[]; base: number }> = [];
  for (const shape of shapes) {
    const cells: Cell[] = [a];
    let heading: number = d0;
    let bends = 0;
    let length = 0;
    let valid = true;
    for (const next of shape) {
      const last = cells[cells.length - 1];
      const h = headingOf(last, next);
      if (h < 0) continue;
      if (h === reverse(heading)) {
        valid = false;
        break;
      }
      length += Math.abs(xs[next[0]] - xs[last[0]]) + Math.abs(ys[next[1]] - ys[last[1]]);
      if (h !== heading) {
        bends += 1;
        cells.push(next);
      } else if (cells.length > 1) {
        cells[cells.length - 1] = next;
      } else {
        cells.push(next);
      }
      heading = h;
    }
    if (!valid || heading === reverse(e)) continue;
    if (heading !== e) bends += 1;
    candidates.push({ cells, base: bends * EDGE.bendPenalty + length });
  }
  // Stable: equal shapes keep the order they were listed in.
  candidates.sort((p, q) => p.base - q.base);
  let best: Cell[] | null = null;
  let fewest = Infinity;
  for (const { cells } of candidates) {
    let hits = 0;
    for (let k = 1; k < cells.length && hits < fewest; k += 1) hits += runHits(grid, excluded, cells[k - 1], cells[k], fewest - hits);
    if (hits < fewest) {
      best = cells;
      fewest = hits;
      if (hits === 0) break;
    }
  }
  return best;
}

/**
 * Keys that order each shared side's ports by where their routes actually
 * head: the first point at which a route leaves the side's span, or its far
 * end when it never does. Ports were first ordered by where the far ends are,
 * and a route that has to detour can leave the other way and cross its
 * neighbours right outside the node. Null when no side's order changes.
 */
function headingKeys(ends: End[]): Map<End, number> | null {
  const bySide = new Map<string, End[]>();
  for (const end of ends) {
    // Every edge meets a circle or a diamond at one point: there is no order.
    if (!end.shared || end.endpoint.pointPorts) continue;
    const key = `${end.endpoint.id}\u0000${end.side}`;
    const list = bySide.get(key);
    if (list) list.push(end);
    else bySide.set(key, [end]);
  }
  const keys = new Map<End, number>();
  for (const list of bySide.values()) {
    const { endpoint, side } = list[0];
    const [lo, hi] = sideSpan(endpoint.outline, side);
    const along = (p: Point) => (isHorizontalSide(side) ? p.x : p.y);
    const next = list.map((end) => {
      const { plan } = end;
      if (plan.kind !== 'grid' && plan.kind !== 'direct') return end.key;
      const pts = end.which === 0 ? plan.points : [...plan.points].reverse();
      for (const p of pts) if (along(p) < lo - EPS || along(p) > hi + EPS) return along(p);
      return along(pts[pts.length - 1]);
    });
    const order = (keyOf: (k: number) => number) =>
      list
        .map((_, k) => k)
        .sort((p, q) => keyOf(p) - keyOf(q) || list[p].plan.index - list[q].plan.index || list[p].which - list[q].which)
        .join(',');
    if (order((k) => list[k].key) === order((k) => next[k])) continue;
    list.forEach((end, k) => keys.set(end, next[k]));
  }
  return keys.size > 0 ? keys : null;
}

/** What one routing pass paid: the searches' own cost, and the edges that took a simple route. */
type Pass = { cost: number; failed: Plan[]; skipped: Plan[] };

/** Most expansions the first pass may have spent for the fan-out order to be routed again. */
const REKEY_EXPANSIONS = 150_000;

/** Cost a pass is charged for each simple route, so a pass with fewer of them always wins. */
const SIMPLE_ROUTE_COST = 1e6;

/**
 * Route every edge of a laid-out figure: sides and ports, orthogonal paths
 * found with A* on a visibility grid (or straight lines and Bézier curves
 * where the spec asks), arrowheads, stroke data and label boxes. Edges come
 * back in model order. An edge the search cannot route, or that the
 * figure's routing budget no longer covers, takes a simple orthogonal route
 * with a warning rather than being dropped.
 */
export function routeFigure(
  layout: FigureLayout,
  model: FigureModel,
  measurer: TextMeasurer,
): { edges: SceneEdge[]; diagnostics: FigureDiagnostic[] } {
  const diagnostics: FigureDiagnostic[] = [];
  const nodesById = new Map(layout.nodes.map((node) => [node.id, node]));
  const groupsById = new Map(layout.groups.filter((g) => g.id !== ROOT_ID).map((g) => [g.id, g]));
  const endpoints = new Map<string, Endpoint | null>();
  const endpointOf = (id: string): Endpoint | null => {
    if (!endpoints.has(id)) {
      const node = nodesById.get(id);
      const group = node ? undefined : groupsById.get(id);
      endpoints.set(id, node ? nodeEndpoint(node, model) : group ? groupEndpoint(group, model) : null);
    }
    return endpoints.get(id) ?? null;
  };

  // 1. Plans and sides, in model order.
  const plans: Plan[] = [];
  const ends: End[] = [];
  const sorted = [...model.edges].sort((a, b) => a.order - b.order);
  for (const edge of sorted) {
    const from = endpointOf(edge.from);
    const to = endpointOf(edge.to);
    if (!from || !to) {
      const missing = from ? edge.to : edge.from;
      diagnostics.push(
        warning(edge, 'route.unknown-endpoint', `The edge from \`${edge.from}\` to \`${edge.to}\` was not drawn: \`${missing}\` is not in the figure.`),
      );
      continue;
    }
    const plan: Plan = {
      edge,
      index: plans.length,
      from,
      to,
      ends: [null, null],
      free: new Set([...from.ancestors, ...to.ancestors]),
      points: [],
      kind: 'grid',
    };
    plans.push(plan);
    if (from.id === to.id) {
      plan.kind = 'loop';
      plan.points = selfLoop(edge, from);
      continue;
    }
    const pinned = edge.fromSide !== null || edge.toSide !== null;
    if (edge.route === 'straight' && !pinned) {
      plan.kind = 'straight';
      continue;
    }
    plan.kind = edge.route === 'curved' ? 'curved' : edge.route === 'straight' ? 'straight' : 'grid';
    const sides = avoidCaptions(edge, resolveSides(edge, chooseSides(edge, from, to, flowAxis(commonGroup(model, from, to)))), from, to);
    plan.ends = [0, 1].map((which) => {
      const endpoint = which === 0 ? from : to;
      const far = which === 0 ? to : from;
      const side = sides[which];
      const farSide = sides[1 - which];
      const aim = sideMidpoint(far.rect, farSide);
      const end: End = {
        plan,
        which: which as 0 | 1,
        endpoint,
        side,
        key: isHorizontalSide(side) ? aim.x : aim.y,
        point: center(endpoint.rect),
        shared: false,
        stub: EDGE.stub,
      };
      ends.push(end);
      return end;
    }) as [End, End];
  }

  // 2. Obstacles and groups.
  const hard: NodeBox[] = layout.nodes.map((node) => ({ ...boxOf(node.bounds, EDGE.clearance), id: node.id }));
  // A route squeezed past a neighbour too close for the full clearance still keeps off its outline.
  const skirts: NodeBox[] = layout.nodes.map((node) => ({ ...boxOf(node.bounds, NEIGHBOUR_MARGIN), id: node.id }));
  const skirtOf = new Map(skirts.map((box) => [box.id, box]));
  const soft: Box[] = [];
  for (const group of layout.groups) {
    for (const box of [group.label, group.repeat, group.panel]) if (box) soft.push(boxOf(box, LABEL_MARGIN));
  }
  for (const node of layout.nodes) if (node.repeat) soft.push(boxOf(node.repeat, LABEL_MARGIN));
  if (layout.legend) soft.push(boxOf(layout.legend.box, LABEL_MARGIN));
  // A self-loop is drawn beside its node; other routes and labels keep out of it.
  for (const plan of plans) {
    if (plan.kind !== 'loop') continue;
    const xs = plan.points.map((p) => p.x);
    const ys = plan.points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    soft.push(boxOf({ x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }, LABEL_MARGIN));
  }
  const groups = groupInfos(layout, model);
  const groupParent = Int32Array.from(groups.map((g) => g.parent));
  const groupDepth = Int32Array.from(groups.map((g) => g.depth));
  const foreignOf = (plan: Plan): Int32Array | null => {
    let any = false;
    const counts = new Int32Array(groups.length);
    groups.forEach((group, g) => {
      const own = group.visible && !plan.free.has(group.id) ? 1 : 0;
      if (own) any = true;
      counts[g] = own + (group.parent >= 0 ? counts[group.parent] : 0);
    });
    return any ? counts : null;
  };
  const isOwn = (plan: Plan, id: string) => id === plan.from.id || id === plan.to.id;
  /** Whether a straight run is clear of every node but the plan's own, every text box and every foreign group. */
  const clearRun = (plan: Plan, a: Point, b: Point): boolean => {
    for (const box of hard) {
      if (isOwn(plan, box.id)) continue;
      if (runHitsBox(a, b, box)) return false;
    }
    for (const box of soft) if (runHitsBox(a, b, box)) return false;
    for (const group of groups) {
      if (!group.visible || plan.free.has(group.id)) continue;
      if (runHitsBox(a, b, group.box)) return false;
    }
    return true;
  };
  const stubEnd = (end: End): Point => {
    const n = sideNormal(end.side);
    return { x: r3(end.point.x + n.x * end.stub), y: r3(end.point.y + n.y * end.stub) };
  };

  const gridPlans = plans.filter((plan) => plan.kind === 'grid');
  const budget: Budget = { left: FIGURE_EXPANSIONS };

  /** Ports, stubs and orthogonal routes (steps 3–6); every call starts from the ends' current keys. */
  const routeGrid = (): Pass => {
    for (const plan of gridPlans) plan.kind = 'grid';

    // 3. Ports.
    assignPorts(ends);

    // 4. Line up facing ports where one of them is free to move, so an edge
    // between two nodes that overlap across the flow is one straight run.
    for (const plan of gridPlans) {
      const [s, t] = plan.ends as [End, End];
      if (facingGap(s, t) <= 0) continue;
      if (Math.abs(crossOf(s) - crossOf(t)) < 0.5) continue;
      const sFree = !s.shared && !s.endpoint.pointPorts;
      const tFree = !t.shared && !t.endpoint.pointPorts;
      if (!sFree && !tFree) continue;
      const span = (end: End): [number, number] => {
        const [lo, hi] = sideSpan(end.endpoint.outline, end.side);
        const margin = Math.min(PORT_MARGIN, (hi - lo) / 2);
        return [lo + margin, hi - margin];
      };
      let target: number;
      if (sFree && tFree) {
        const [a0, a1] = span(s);
        const [b0, b1] = span(t);
        const lo = Math.max(a0, b0);
        const hi = Math.min(a1, b1);
        if (lo > hi) continue;
        const cs = crossOf(s);
        const ct = crossOf(t);
        target = cs >= lo && cs <= hi ? cs : ct >= lo && ct <= hi ? ct : (lo + hi) / 2;
      } else {
        const [lo, hi] = span(sFree ? s : t);
        target = crossOf(sFree ? t : s);
        if (target < lo || target > hi) continue;
      }
      const ps = sFree ? portAt(s.endpoint, s.side, target) : s.point;
      const pt = tFree ? portAt(t.endpoint, t.side, target) : t.point;
      if (!clearRun(plan, ps, isHorizontalSide(s.side) ? { x: ps.x, y: pt.y } : { x: pt.x, y: ps.y })) continue;
      s.point = ps;
      t.point = pt;
    }

    // 5. Stubs: long enough to clear the node, and for an arrowhead plus a
    // rounded corner; shared out when two facing ports are close together.
    for (const plan of plans) {
      const [s, t] = plan.ends;
      if (!s || !t) continue;
      const { length } = arrowMetrics(plan.edge);
      const want = (end: End, arrow: boolean) =>
        Math.max(arrow ? Math.max(EDGE.stub, length + EDGE.cornerRadius) : EDGE.stub, exitDistance(end));
      s.stub = want(s, hasStartArrow(plan.edge));
      t.stub = want(t, hasEndArrow(plan.edge));
      const gap = facingGap(s, t);
      if (gap > 0 && s.stub + t.stub > gap) {
        const share = s.stub / (s.stub + t.stub);
        s.stub = gap * share;
        t.stub = gap - s.stub;
      }
      // A neighbour nearer than the stub would swallow its end, leaving the
      // route no way out but through the neighbour: stop halfway to it.
      for (const end of [s, t]) {
        const p = end.point;
        const tip = stubEnd(end);
        for (const skirt of skirts) {
          if (isOwn(plan, skirt.id) || !runHitsBox(p, tip, skirt)) continue;
          const gapTo =
            (end.side === 'bottom' ? skirt.y0 - p.y : end.side === 'top' ? p.y - skirt.y1 : end.side === 'right' ? skirt.x0 - p.x : p.x - skirt.x1) +
            NEIGHBOUR_MARGIN;
          if (gapTo > EPS) end.stub = Math.min(end.stub, gapTo / 2);
        }
      }
    }

    // 6. The grid, then orthogonal routes, shortest spans first.
    const pass: Pass = { cost: 0, failed: [], skipped: [] };
    if (gridPlans.length === 0) return pass;
    const portX: number[] = [];
    const portY: number[] = [];
    const stubX: number[] = [];
    const stubY: number[] = [];
    for (const plan of gridPlans) {
      for (const end of plan.ends as [End, End]) {
        const tip = stubEnd(end);
        if (isHorizontalSide(end.side)) portX.push(end.point.x);
        else portY.push(end.point.y);
        stubX.push(tip.x);
        stubY.push(tip.y);
      }
    }
    const grid = buildGrid({ hard, soft, groups, portX, portY, stubX, stubY });
    const table = new StateTable(grid.nx * grid.ny * 4);
    const routes: Route[] = [];
    const routeOf = new Map<Plan, Route>();
    const span = (plan: Plan) => {
      const [s, t] = plan.ends as [End, End];
      return Math.abs(s.point.x - t.point.x) + Math.abs(s.point.y - t.point.y);
    };
    const order = [...gridPlans].sort((a, b) => span(a) - span(b) || a.index - b.index);
    const pointOf = ([i, j]: Cell): Point => ({ x: grid.xs[i], y: grid.ys[j] });
    for (const plan of order) {
      const [s, t] = plan.ends as [End, End];
      let points: Point[] | null = null;
      if (facingGap(s, t) > 0 && Math.abs(crossOf(s) - crossOf(t)) < 0.5) {
        // Already in line: one straight run, snapped exactly onto the axis.
        const snapped = portAt(t.endpoint, t.side, crossOf(s));
        const inLine = isHorizontalSide(t.side)
          ? Math.abs(snapped.x - s.point.x) < EPS
          : Math.abs(snapped.y - s.point.y) < EPS;
        if (inLine && clearRun(plan, s.point, snapped)) {
          t.point = snapped;
          points = [s.point, snapped];
          plan.kind = 'direct';
          pass.cost += Math.hypot(snapped.x - s.point.x, snapped.y - s.point.y);
        }
      }
      if (!points) {
        const a = stubEnd(s);
        const b = stubEnd(t);
        const start: Cell = [lineIndex(grid.xs, a.x), lineIndex(grid.ys, a.y)];
        const goal: Cell = [lineIndex(grid.xs, b.x), lineIndex(grid.ys, b.y)];
        if (start[0] < 0 || start[1] < 0 || goal[0] < 0 || goal[1] < 0) {
          // Not on the grid (a bug, not a spec problem): the last resort is a straight line.
          plan.kind = 'fallback';
          plan.points = clippedLine(plan.from, plan.to);
          pass.failed.push(plan);
          pass.cost += SIMPLE_ROUTE_COST;
          continue;
        }
        // Only the endpoints' own boxes are free to cross. A neighbour whose
        // clearance holds a stub end may be skirted, but never run through.
        const excluded: Excluded[] = [];
        for (const box of hard) {
          if (!strictlyInside(box, a.x, a.y) && !strictlyInside(box, b.x, b.y)) continue;
          excluded.push({ box, body: isOwn(plan, box.id) ? null : (skirtOf.get(box.id) ?? null) });
        }
        const found =
          budget.left > 0
            ? search(grid, table, {
                start: start[1] * grid.nx + start[0],
                startDir: outward(s.side),
                goal: goal[1] * grid.nx + goal[0],
                goalDir: reverse(outward(t.side)),
                excluded,
                foreign: foreignOf(plan),
                groupParent,
                groupDepth,
              }, budget)
            : null;
        if (found) {
          points = rectify([s.point, ...found.path.map((p) => pointOf([p % grid.nx, Math.floor(p / grid.nx)])), t.point]);
          pass.cost += found.cost;
        } else {
          (budget.left > 0 ? pass.failed : pass.skipped).push(plan);
          pass.cost += SIMPLE_ROUTE_COST;
          const cells = simpleRoute(grid, excluded, start, outward(s.side), goal, reverse(outward(t.side)));
          if (!cells) {
            plan.kind = 'fallback';
            plan.points = clippedLine(plan.from, plan.to);
            continue;
          }
          points = rectify([s.point, ...cells.map(pointOf), t.point]);
        }
      }
      plan.points = points;
      claim(grid, points);
      const route: Route = { points, stubs: [s.stub, t.stub], order: plan.index };
      routes.push(route);
      routeOf.set(plan, route);
    }
    nudgeRoutes(
      routes.sort((a, b) => a.order - b.order),
      [...hard, ...soft],
    );
    for (const [plan, route] of routeOf) plan.points = simplify(route.points);
    return pass;
  };

  let pass = routeGrid();

  // 7. Fan-out order: once the routes show where each one really heads, a
  // shared side whose ports would cross right outside the node is ordered
  // again and routed once more, keeping the cheaper pass. Only a figure that
  // routed cheaply gets the second pass, so it never doubles a slow one.
  const keys = pass.failed.length + pass.skipped.length === 0 ? headingKeys(ends) : null;
  if (keys && budget.left >= FIGURE_EXPANSIONS - REKEY_EXPANSIONS) {
    const endState = ends.map((end) => ({ end, key: end.key, point: end.point, shared: end.shared, stub: end.stub }));
    const planState = gridPlans.map((plan) => ({ plan, kind: plan.kind, points: plan.points }));
    for (const [end, key] of keys) end.key = key;
    const again = routeGrid();
    if (again.cost < pass.cost) {
      pass = again;
    } else {
      for (const { end, key, point, shared, stub } of endState) Object.assign(end, { key, point, shared, stub });
      for (const { plan, kind, points } of planState) Object.assign(plan, { kind, points });
    }
  }

  for (const plan of [...pass.failed].sort((a, b) => a.index - b.index)) {
    diagnostics.push(
      warning(
        plan.edge,
        'route.fallback',
        `No clear path was found for the edge from \`${plan.edge.from}\` to \`${plan.edge.to}\`, so it takes a simple route that may cross other items. Try pinning its sides or moving the nodes closer.`,
      ),
    );
  }
  if (pass.skipped.length > 0) {
    const skipped = [...pass.skipped].sort((a, b) => a.index - b.index);
    const named = skipped
      .slice(0, 3)
      .map((plan) => `\`${plan.edge.from}\` → \`${plan.edge.to}\``)
      .join(', ');
    diagnostics.push({
      severity: 'warning',
      code: 'route.budget',
      message:
        `The figure has too many edges to route them all carefully: ${skipped.length} of them (${named}${skipped.length > 3 ? ', …' : ''}) ` +
        'take simple routes that may cross other items. Split it into several figures, or drop some edges.',
      path: skipped[0].edge.path,
      ...(skipped[0].edge.range ? { range: skipped[0].edge.range } : {}),
    });
  }

  // 8. Straight and curved edges.
  for (const plan of plans) {
    const { edge, from, to } = plan;
    if (plan.kind === 'straight') {
      const [s, t] = plan.ends;
      if (!s || !t) {
        plan.points = clippedLine(from, to);
      } else {
        const a = edge.fromSide ? s.point : null;
        const b = edge.toSide ? t.point : null;
        plan.points = [
          a ?? clipToOutline(from.outline, center(from.rect), b ?? center(to.rect)),
          b ?? clipToOutline(to.outline, center(to.rect), a ?? center(from.rect)),
        ];
      }
    } else if (plan.kind === 'curved') {
      const [s, t] = plan.ends as [End, End];
      const n0 = sideNormal(s.side);
      const n1 = sideNormal(t.side);
      const reach = Math.max(24, Math.hypot(t.point.x - s.point.x, t.point.y - s.point.y) / 3);
      plan.points = [
        s.point,
        { x: s.point.x + n0.x * reach, y: s.point.y + n0.y * reach },
        { x: t.point.x + n1.x * reach, y: t.point.y + n1.y * reach },
        t.point,
      ];
    }
  }

  // 9. Scene edges: arrowheads, stroke data, labels (placed in model order).
  const font = figureFont(model.font, FIGURE_METRICS.font.edge);
  const strokes = plans.map((plan) => strokeSegments(plan.points, plan.kind === 'curved' || (plan.kind === 'loop' && plan.edge.route === 'curved')));
  // Each stroke's box, so a label spot only tests the strokes that could touch it.
  const strokeBoxes = strokes.map((segments) => {
    const pts = segments.flat();
    const x = Math.min(...pts.map((p) => p.x));
    const y = Math.min(...pts.map((p) => p.y));
    return { x, y, width: Math.max(...pts.map((p) => p.x)) - x, height: Math.max(...pts.map((p) => p.y)) - y };
  });
  const placed: Rect[] = [];
  const edges = plans.map((plan, p) => {
    const curved = plan.kind === 'curved' || (plan.kind === 'loop' && plan.edge.route === 'curved');
    const scene = drawEdge(plan, curved);
    if (plan.edge.label) {
      const measured = measureLabel(plan.edge.label, font, measurer);
      if (measured.width > 0 && measured.height > 0) {
        const spots = labelSpots(plan.points, curved, measured.width, measured.height);
        let best: { spot: LabelSpot; score: number } | null = null;
        spots.forEach((spot, rank) => {
          const rect = { x: spot.x, y: spot.y, width: measured.width, height: measured.height };
          let score = rank;
          for (const node of layout.nodes) if (rectsOverlap(rect, node.bounds, 0.01)) score += 1000;
          for (const box of soft) if (rectsOverlap(rect, { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }, 0.01)) score += 300;
          for (const other of placed) if (rectsOverlap(rect, other, 0.01)) score += 300;
          // Inside the drawing when that is as good: outside, the scene has to grow for it.
          if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > layout.width || rect.y + rect.height > layout.height) score += 10;
          // Straddling a group's outline strikes the text through.
          for (const { box, visible } of groups) {
            if (!visible) continue;
            const inside = rect.x >= box.x0 && rect.y >= box.y0 && rect.x + rect.width <= box.x1 && rect.y + rect.height <= box.y1;
            const outside = rect.x + rect.width <= box.x0 || rect.x >= box.x1 || rect.y + rect.height <= box.y0 || rect.y >= box.y1;
            if (!inside && !outside) score += 50;
          }
          strokes.forEach((segments, q) => {
            const sb = strokeBoxes[q];
            if (sb.x > rect.x + rect.width || sb.x + sb.width < rect.x || sb.y > rect.y + rect.height || sb.y + sb.height < rect.y) return;
            segments.forEach(([a, b], k) => {
              if (q === p && (k === spot.anchor || spot.anchor < 0)) return;
              if (segmentHitsRect(a, b, rect)) score += 20;
            });
          });
          if (!best || score < best.score) best = { spot, score };
        });
        const chosen = (best as { spot: LabelSpot; score: number } | null)?.spot;
        if (chosen) {
          scene.label = { ...measured, x: chosen.x, y: chosen.y, align: chosen.align };
          placed.push({ x: chosen.x, y: chosen.y, width: measured.width, height: measured.height });
        }
      }
    }
    return scene;
  });

  return { edges, diagnostics };
}

/**
 * A loop out of one side and back in: out at a third of the side, round
 * `SELF_LOOP_OUT` px outside, back in at two thirds. Vertical flows use the
 * right side, horizontal ones the bottom (the top under a caption), unless
 * the edge pins one.
 */
function selfLoop(edge: EdgeModel, endpoint: Endpoint): Point[] {
  const flank: Side = isVertical(endpoint.direction) ? 'right' : endpoint.foot !== null ? 'top' : 'bottom';
  const side: Side = edge.fromSide ?? edge.toSide ?? flank;
  const r = endpoint.rect;
  const n = sideNormal(side);
  const along = isHorizontalSide(side)
    ? [r.x + r.width / 3, r.x + (2 * r.width) / 3]
    : [r.y + r.height / 3, r.y + (2 * r.height) / 3];
  const p0 = portAt(endpoint, side, along[0]);
  const p3 = portAt(endpoint, side, along[1]);
  if (edge.route === 'curved') {
    const reach = SELF_LOOP_OUT * 1.5;
    return [p0, { x: p0.x + n.x * reach, y: p0.y + n.y * reach }, { x: p3.x + n.x * reach, y: p3.y + n.y * reach }, p3];
  }
  const outer = endpoint.body ?? r;
  // Out past the side, and past anything the node paints there (a stacked copy, a badge).
  const reach = (() => {
    switch (side) {
      case 'right':
        return Math.max(r.x + r.width + SELF_LOOP_OUT, outer.x + outer.width + EDGE.clearance);
      case 'left':
        return Math.min(r.x - SELF_LOOP_OUT, outer.x - EDGE.clearance);
      case 'bottom':
        return Math.max(r.y + r.height + SELF_LOOP_OUT, outer.y + outer.height + EDGE.clearance);
      case 'top':
        return Math.min(r.y - SELF_LOOP_OUT, outer.y - EDGE.clearance);
    }
  })();
  return isHorizontalSide(side)
    ? [p0, { x: p0.x, y: reach }, { x: p3.x, y: reach }, p3]
    : [p0, { x: reach, y: p0.y }, { x: reach, y: p3.y }, p3];
}

/** Arrowheads and stroke data for a routed edge (its label is placed by the caller). */
function drawEdge(plan: Plan, curved: boolean): SceneEdge {
  const { edge, points } = plan;
  const { length, width } = arrowMetrics(edge);
  const n = points.length;
  let start: Arrowhead | null = null;
  let end: Arrowhead | null = null;
  let d: string;
  if (curved) {
    const [p0, c1, c2, p3] = points;
    const uEnd = unit(Math.hypot(p3.x - c2.x, p3.y - c2.y) > EPS ? c2 : p0, p3);
    const uStart = unit(Math.hypot(p0.x - c1.x, p0.y - c1.y) > EPS ? c1 : p3, p0);
    let q0 = p0;
    let q1 = c1;
    let q2 = c2;
    let q3 = p3;
    // Shorten along the end tangents, keeping the control points' offsets,
    // so the curve arrives at the arrow base heading at the tip.
    if (hasEndArrow(edge)) {
      end = arrowhead(p3, uEnd, length, width);
      q3 = { x: p3.x - uEnd.x * length, y: p3.y - uEnd.y * length };
      q2 = { x: c2.x - uEnd.x * length, y: c2.y - uEnd.y * length };
    }
    if (hasStartArrow(edge)) {
      start = arrowhead(p0, uStart, length, width);
      q0 = { x: p0.x - uStart.x * length, y: p0.y - uStart.y * length };
      q1 = { x: c1.x - uStart.x * length, y: c1.y - uStart.y * length };
    }
    d = `M${f(q0.x)} ${f(q0.y)}C${f(q1.x)} ${f(q1.y)} ${f(q2.x)} ${f(q2.y)} ${f(q3.x)} ${f(q3.y)}`;
  } else {
    let stroke = points;
    const both = hasStartArrow(edge) && hasEndArrow(edge);
    const runLength = (i: number, step: 1 | -1) => {
      const q = distinctNeighbour(points, i, step);
      return q ? Math.hypot(points[i].x - q.x, points[i].y - q.y) : 0;
    };
    if (hasEndArrow(edge) && n >= 2) {
      const q = distinctNeighbour(points, n - 1, -1);
      end = arrowhead(points[n - 1], q ? unit(q, points[n - 1]) : { x: 0, y: 1 }, length, width);
      const run = runLength(n - 1, -1);
      stroke = shorten(stroke, true, Math.min(length, both && n === 2 ? run / 2 : run));
    }
    if (hasStartArrow(edge) && n >= 2) {
      const q = distinctNeighbour(points, 0, 1);
      start = arrowhead(points[0], q ? unit(q, points[0]) : { x: 0, y: -1 }, length, width);
      const run = runLength(0, 1);
      stroke = shorten(stroke, false, Math.min(length, both && n === 2 ? run / 2 : run));
    }
    d = plan.kind === 'fallback' || plan.kind === 'straight' ? straightPath(stroke) : roundedPath(stroke, EDGE.cornerRadius);
  }
  return { id: edge.id, model: edge, points, d, start, end, label: null };
}

function straightPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)} ${f(p.y)}`).join('');
}

/**
 * The box every edge paints — strokes, arrowheads and labels. A loop around
 * the drawing can reach past the layout's own box; the scene has to grow to
 * include it or the loop is clipped.
 */
export function edgeBounds(edges: readonly SceneEdge[]): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (p: Point, pad: number) => {
    x0 = Math.min(x0, p.x - pad);
    y0 = Math.min(y0, p.y - pad);
    x1 = Math.max(x1, p.x + pad);
    y1 = Math.max(y1, p.y + pad);
  };
  for (const edge of edges) {
    const pad = (edge.model.weight === 'thick' ? EDGE.strokeThick : EDGE.stroke) / 2;
    // A Bézier stays inside its control points' hull, so they bound curves too.
    for (const p of edge.points) add(p, pad);
    for (const head of [edge.start, edge.end]) if (head) for (const p of head.polygon) add(p, pad);
    if (edge.label) {
      // Labels are drawn over a 3px halo.
      add({ x: edge.label.x, y: edge.label.y }, 1.5);
      add({ x: edge.label.x + edge.label.width, y: edge.label.y + edge.label.height }, 1.5);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** Path data moved by (dx, dy): every coordinate pair, but an arc's radii and flags stay. */
function translatePath(d: string, dx: number, dy: number): string {
  return d.replace(/([MLCA])([^MLCA]*)/g, (_, command: string, args: string) => {
    const values = args.trim().split(/\s+/).map(Number);
    const moved = values.map((v, k) => {
      if (command === 'A') return k === 5 ? v + dx : k === 6 ? v + dy : v;
      return k % 2 === 0 ? v + dx : v + dy;
    });
    return command + moved.map(f).join(' ');
  });
}

/**
 * Routed edges moved by (dx, dy) — strokes, arrowheads and labels together.
 * Moving a finished routing is exact, where routing the moved layout again
 * could place a label elsewhere (and costs a second routing).
 */
export function translateEdges(edges: readonly SceneEdge[], dx: number, dy: number): SceneEdge[] {
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const head = (arrow: Arrowhead | null): Arrowhead | null => arrow && { tip: move(arrow.tip), polygon: arrow.polygon.map(move) };
  return edges.map((edge) => ({
    ...edge,
    points: edge.points.map(move),
    d: translatePath(edge.d, dx, dy),
    start: head(edge.start),
    end: head(edge.end),
    label: edge.label && { ...edge.label, x: edge.label.x + dx, y: edge.label.y + dy },
  }));
}
