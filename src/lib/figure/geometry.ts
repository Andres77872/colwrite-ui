import { FIGURE_METRICS } from './constants';
import type { Direction, Point, Rect, Shape, Side } from './types';

/**
 * Shape outlines — the single definition of every node's geometry.
 *
 * Layout sizes a node so its label fits inside the outline defined here; the
 * router attaches edges to it; the SVG renderer and the TikZ exporter draw
 * it. Keeping one definition is what makes an arrowhead touch the outline in
 * every output.
 */

export type Outline =
  | { kind: 'rect'; rect: Rect; radius: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'polygon'; points: Point[] };

const { radius: BOX_RADIUS } = FIGURE_METRICS.node;

export function isVertical(direction: Direction): boolean {
  return direction === 'down' || direction === 'up';
}

/** Inset of a trapezoid's narrow side, per side, in px. */
export function trapezoidInset(rect: Rect, direction: Direction): number {
  return isVertical(direction)
    ? Math.min(rect.height * 0.45, rect.width * 0.3)
    : Math.min(10, rect.height * 0.3);
}

/** Horizontal skew of a parallelogram. */
export function parallelogramSkew(rect: Rect): number {
  return Math.min(rect.height * 0.35, rect.width * 0.2);
}

/** Inset of a hexagon's pointed ends. */
export function hexagonInset(rect: Rect): number {
  return Math.min(rect.height * 0.3, rect.width * 0.2);
}

/** Vertical radius of a cylinder's elliptical caps. */
export function cylinderCap(rect: Rect): number {
  return Math.min(6, rect.height * 0.15);
}

/** Amplitude of a document's wavy bottom edge. */
export function documentWave(rect: Rect): number {
  return Math.min(4, rect.height * 0.12);
}

/**
 * The trapezoid's corners, clockwise from top-left. `narrowEnd` says which
 * side is short: a funnel narrows *along* the flow, an expand widens.
 */
function trapezoidPoints(rect: Rect, shape: 'funnel' | 'expand', direction: Direction): Point[] {
  const { x, y, width: w, height: h } = rect;
  const s = trapezoidInset(rect, direction);
  // The downstream end is where the flow goes: bottom for down, top for up…
  const downstream: Side =
    direction === 'down' ? 'bottom' : direction === 'up' ? 'top' : direction === 'right' ? 'right' : 'left';
  const upstream: Side =
    downstream === 'bottom' ? 'top' : downstream === 'top' ? 'bottom' : downstream === 'right' ? 'left' : 'right';
  const narrow = shape === 'funnel' ? downstream : upstream;
  switch (narrow) {
    case 'top':
      return [{ x: x + s, y }, { x: x + w - s, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    case 'bottom':
      return [{ x, y }, { x: x + w, y }, { x: x + w - s, y: y + h }, { x: x + s, y: y + h }];
    case 'left':
      return [{ x, y: y + s }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h - s }];
    case 'right':
      return [{ x, y }, { x: x + w, y: y + s }, { x: x + w, y: y + h - s }, { x, y: y + h }];
  }
}

/** The outline edges attach to and arrows clip against. */
export function shapeOutline(shape: Shape, rect: Rect, direction: Direction): Outline {
  const { x, y, width: w, height: h } = rect;
  switch (shape) {
    case 'circle':
    case 'op':
      return { kind: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 };
    case 'diamond':
      return {
        kind: 'polygon',
        points: [
          { x: x + w / 2, y },
          { x: x + w, y: y + h / 2 },
          { x: x + w / 2, y: y + h },
          { x, y: y + h / 2 },
        ],
      };
    case 'funnel':
    case 'expand':
      return { kind: 'polygon', points: trapezoidPoints(rect, shape, direction) };
    case 'parallelogram': {
      const k = parallelogramSkew(rect);
      return {
        kind: 'polygon',
        points: [{ x: x + k, y }, { x: x + w, y }, { x: x + w - k, y: y + h }, { x, y: y + h }],
      };
    }
    case 'hexagon': {
      const k = hexagonInset(rect);
      return {
        kind: 'polygon',
        points: [
          { x: x + k, y },
          { x: x + w - k, y },
          { x: x + w, y: y + h / 2 },
          { x: x + w - k, y: y + h },
          { x: x + k, y: y + h },
          { x, y: y + h / 2 },
        ],
      };
    }
    case 'round':
      return { kind: 'rect', rect, radius: Math.min(h / 2, w / 2) };
    case 'box':
    case 'document':
    case 'cylinder':
      return { kind: 'rect', rect, radius: shape === 'box' ? BOX_RADIUS : 0 };
    case 'text':
    case 'tensor':
    case 'image':
      return { kind: 'rect', rect, radius: 0 };
  }
}

function fmt(value: number): string {
  // Two decimals are below a printer's resolution and keep the markup small.
  return String(Math.round(value * 100) / 100);
}

/** Rounded-rectangle path data. */
export function roundedRectPath(rect: Rect, radius: number): string {
  const { x, y, width: w, height: h } = rect;
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
  return (
    `M${fmt(x + r)} ${fmt(y)}H${fmt(x + w - r)}` +
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + w)} ${fmt(y + r)}V${fmt(y + h - r)}` +
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + w - r)} ${fmt(y + h)}H${fmt(x + r)}` +
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x)} ${fmt(y + h - r)}V${fmt(y + r)}` +
    `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + r)} ${fmt(y)}Z`
  );
}

export function polygonPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join('') + 'Z';
}

/**
 * SVG path data for a shape's fill and outline. A cylinder also returns the
 * front arc of its top cap in `detail`, stroked but not filled.
 */
export function shapePath(shape: Shape, rect: Rect, direction: Direction): { d: string; detail?: string } {
  const { x, y, width: w, height: h } = rect;
  if (shape === 'cylinder') {
    const ry = cylinderCap(rect);
    const rx = w / 2;
    const d =
      `M${fmt(x)} ${fmt(y + ry)}` +
      `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w)} ${fmt(y + ry)}` +
      `V${fmt(y + h - ry)}` +
      `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x)} ${fmt(y + h - ry)}Z`;
    const detail = `M${fmt(x)} ${fmt(y + ry)}A${fmt(rx)} ${fmt(ry)} 0 0 0 ${fmt(x + w)} ${fmt(y + ry)}`;
    return { d, detail };
  }
  if (shape === 'document') {
    const a = documentWave(rect);
    const bottom = y + h - a;
    const d =
      `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(bottom)}` +
      `C${fmt(x + w * 0.75)} ${fmt(bottom - a * 1.6)} ${fmt(x + w * 0.5)} ${fmt(bottom + a * 1.6)} ${fmt(x + w * 0.25)} ${fmt(bottom)}` +
      `S${fmt(x)} ${fmt(bottom - a)} ${fmt(x)} ${fmt(bottom)}Z`;
    return { d };
  }
  const outline = shapeOutline(shape, rect, direction);
  switch (outline.kind) {
    case 'rect':
      return { d: roundedRectPath(outline.rect, outline.radius) };
    case 'ellipse': {
      const { cx, cy, rx, ry } = outline;
      return {
        d:
          `M${fmt(cx - rx)} ${fmt(cy)}` +
          `A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}` +
          `A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}Z`,
      };
    }
    case 'polygon':
      return { d: polygonPath(outline.points) };
  }
}

/** The box a label may occupy inside a shape (text never crosses a slanted side). */
export function labelArea(shape: Shape, rect: Rect, direction: Direction): Rect {
  const { x, y, width: w, height: h } = rect;
  switch (shape) {
    case 'funnel':
    case 'expand': {
      const s = trapezoidInset(rect, direction);
      return isVertical(direction)
        ? { x: x + s, y, width: w - 2 * s, height: h }
        : { x, y: y + s, width: w, height: h - 2 * s };
    }
    case 'parallelogram': {
      const k = parallelogramSkew(rect);
      return { x: x + k / 2, y, width: w - k, height: h };
    }
    case 'hexagon': {
      const k = hexagonInset(rect);
      return { x: x + k / 2, y, width: w - k, height: h };
    }
    case 'cylinder': {
      const ry = cylinderCap(rect);
      return { x, y: y + ry * 2, width: w, height: h - ry * 3 };
    }
    case 'document': {
      const a = documentWave(rect);
      return { x, y, width: w, height: h - a };
    }
    default:
      return rect;
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Ports and clipping
 * ──────────────────────────────────────────────────────────────────────── */

export function outlineBounds(outline: Outline): Rect {
  switch (outline.kind) {
    case 'rect':
      return outline.rect;
    case 'ellipse':
      return {
        x: outline.cx - outline.rx,
        y: outline.cy - outline.ry,
        width: outline.rx * 2,
        height: outline.ry * 2,
      };
    case 'polygon': {
      const xs = outline.points.map((p) => p.x);
      const ys = outline.points.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
  }
}

/** Outward unit normal of a side. */
export function sideNormal(side: Side): Point {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
  }
}

export function oppositeSide(side: Side): Side {
  return side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : 'left';
}

/**
 * Where an edge leaving through `side` at cross-coordinate `offset` touches
 * the outline: `offset` is an x for top/bottom, a y for left/right. It is
 * clamped into the part of the side the outline actually spans, so a port can
 * never float in the air beside a narrow trapezoid end.
 */
export function portPoint(outline: Outline, side: Side, offset: number): Point {
  const bounds = outlineBounds(outline);
  const horizontalSide = side === 'top' || side === 'bottom';
  const lo = horizontalSide ? bounds.x : bounds.y;
  const hi = horizontalSide ? bounds.x + bounds.width : bounds.y + bounds.height;

  if (outline.kind === 'rect') {
    const { rect, radius } = outline;
    // Stay clear of rounded corners: a port on the arc would leave at an angle.
    const inset = Math.min(radius, (hi - lo) / 2);
    const t = clamp(offset, lo + inset, hi - inset);
    switch (side) {
      case 'top':
        return { x: t, y: rect.y };
      case 'bottom':
        return { x: t, y: rect.y + rect.height };
      case 'left':
        return { x: rect.x, y: t };
      case 'right':
        return { x: rect.x + rect.width, y: t };
    }
  }

  if (outline.kind === 'ellipse') {
    const { cx, cy, rx, ry } = outline;
    if (horizontalSide) {
      const t = clamp(offset, cx - rx * 0.7, cx + rx * 0.7);
      const dy = ry * Math.sqrt(Math.max(0, 1 - ((t - cx) / rx) ** 2));
      return { x: t, y: side === 'top' ? cy - dy : cy + dy };
    }
    const t = clamp(offset, cy - ry * 0.7, cy + ry * 0.7);
    const dx = rx * Math.sqrt(Math.max(0, 1 - ((t - cy) / ry) ** 2));
    return { x: side === 'left' ? cx - dx : cx + dx, y: t };
  }

  // Polygon: intersect the line through `offset`, perpendicular to the side,
  // with every edge, and keep the hit nearest to that side.
  const hits: Point[] = [];
  const pts = outline.points;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (horizontalSide) {
      if ((a.x - offset) * (b.x - offset) > 0 || a.x === b.x) continue;
      const k = (offset - a.x) / (b.x - a.x);
      hits.push({ x: offset, y: a.y + k * (b.y - a.y) });
    } else {
      if ((a.y - offset) * (b.y - offset) > 0 || a.y === b.y) continue;
      const k = (offset - a.y) / (b.y - a.y);
      hits.push({ x: a.x + k * (b.x - a.x), y: offset });
    }
  }
  if (hits.length === 0) {
    // Outside the span: retry at the nearest point the polygon covers. The
    // retry is inside the span, so it cannot recurse again.
    const inside = clamp(offset, lo + 0.5, hi - 0.5);
    if (inside !== offset) return portPoint(outline, side, inside);
    // Degenerate polygon: fall back to its bounding box.
    switch (side) {
      case 'top':
        return { x: offset, y: bounds.y };
      case 'bottom':
        return { x: offset, y: bounds.y + bounds.height };
      case 'left':
        return { x: bounds.x, y: offset };
      case 'right':
        return { x: bounds.x + bounds.width, y: offset };
    }
  }
  const key = (p: Point) =>
    side === 'top' ? p.y : side === 'bottom' ? -p.y : side === 'left' ? p.x : -p.x;
  hits.sort((p, q) => key(p) - key(q));
  return hits[0];
}

/** The range of cross-coordinates a port on `side` can use. */
export function sideSpan(outline: Outline, side: Side): [number, number] {
  const b = outlineBounds(outline);
  if (outline.kind === 'ellipse') {
    return side === 'top' || side === 'bottom'
      ? [outline.cx - outline.rx * 0.7, outline.cx + outline.rx * 0.7]
      : [outline.cy - outline.ry * 0.7, outline.cy + outline.ry * 0.7];
  }
  if (outline.kind === 'polygon') {
    // The span of the side itself: the points that lie on the extreme line.
    const pts = outline.points;
    const eps = 0.5;
    const onSide = pts.filter((p) =>
      side === 'top'
        ? Math.abs(p.y - b.y) < eps
        : side === 'bottom'
          ? Math.abs(p.y - (b.y + b.height)) < eps
          : side === 'left'
            ? Math.abs(p.x - b.x) < eps
            : Math.abs(p.x - (b.x + b.width)) < eps,
    );
    if (onSide.length >= 2) {
      const coords = onSide.map((p) => (side === 'top' || side === 'bottom' ? p.x : p.y));
      return [Math.min(...coords), Math.max(...coords)];
    }
    const c = side === 'top' || side === 'bottom' ? b.x + b.width / 2 : b.y + b.height / 2;
    return [c, c];
  }
  const r = outline.radius;
  return side === 'top' || side === 'bottom'
    ? [b.x + Math.min(r, b.width / 2), b.x + b.width - Math.min(r, b.width / 2)]
    : [b.y + Math.min(r, b.height / 2), b.y + b.height - Math.min(r, b.height / 2)];
}

/**
 * Where the segment from `inside` (usually the centre) towards `toward`
 * leaves the outline. Used by straight and curved routes.
 */
export function clipToOutline(outline: Outline, inside: Point, toward: Point): Point {
  const dx = toward.x - inside.x;
  const dy = toward.y - inside.y;
  if (dx === 0 && dy === 0) return inside;
  if (outline.kind === 'ellipse') {
    const { cx, cy, rx, ry } = outline;
    // Ray from the centre direction (dx, dy).
    const ox = inside.x - cx;
    const oy = inside.y - cy;
    const a = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
    const b = 2 * ((ox * dx) / (rx * rx) + (oy * dy) / (ry * ry));
    const c = (ox * ox) / (rx * rx) + (oy * oy) / (ry * ry) - 1;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return inside;
    const t = (-b + Math.sqrt(disc)) / (2 * a);
    return { x: inside.x + t * dx, y: inside.y + t * dy };
  }
  const points =
    outline.kind === 'polygon'
      ? outline.points
      : [
          { x: outline.rect.x, y: outline.rect.y },
          { x: outline.rect.x + outline.rect.width, y: outline.rect.y },
          { x: outline.rect.x + outline.rect.width, y: outline.rect.y + outline.rect.height },
          { x: outline.rect.x, y: outline.rect.y + outline.rect.height },
        ];
  let best = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const t = ((a.x - inside.x) * ey - (a.y - inside.y) * ex) / denom;
    const u = ((a.x - inside.x) * dy - (a.y - inside.y) * dx) / denom;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  if (!Number.isFinite(best)) return inside;
  return { x: inside.x + best * dx, y: inside.y + best * dy };
}

/* ────────────────────────────────────────────────────────────────────────
 * Small helpers
 * ──────────────────────────────────────────────────────────────────────── */

export function clamp(value: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, value));
}

export function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function translateRect(rect: Rect, dx: number, dy: number): Rect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

export function inflateRect(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2 };
}

/** Whether two rects overlap by more than `tolerance` px in both axes. */
export function rectsOverlap(a: Rect, b: Rect, tolerance = 0): boolean {
  return (
    a.x + a.width - tolerance > b.x &&
    b.x + b.width - tolerance > a.x &&
    a.y + a.height - tolerance > b.y &&
    b.y + b.height - tolerance > a.y
  );
}

export { fmt as formatCoordinate };
