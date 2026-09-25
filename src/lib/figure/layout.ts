import { FIGURE_METRICS, figureFont } from './constants';
import { isVertical, labelArea, rectsOverlap, translateRect, unionRect } from './geometry';
import { isEmptyLabel, measureLabel, parseLabel } from './labels';
import { LABEL_ROOM, layeredLayout, type LayeredEdge, type LayeredItem } from './layered';
import { ROOT_ID } from './types';
import type {
  Align,
  Direction,
  EdgeModel,
  Extent,
  FigureDiagnostic,
  FigureLayout,
  FigureModel,
  FontSpec,
  GroupModel,
  ItemModel,
  Label,
  LabelBox,
  NodeModel,
  Rect,
  SceneGroup,
  SceneLegend,
  SceneNode,
  Shape,
  Side,
  TensorCells,
  TextMeasurer,
} from './types';

/**
 * Container layout: sizes every node, arranges every group bottom-up and
 * places the legend, producing the absolute boxes the router and the
 * renderers draw.
 *
 * Each item is laid out in its own frame and then shifted into its parent's,
 * so a group never needs to know where it will end up. `flow` containers use
 * the layered layout; rows, columns and grids place their children directly.
 */

const M = FIGURE_METRICS;

/** Shapes that read as a block in a stack, and so take part in `uniform`. */
const BOX_LIKE: ReadonlySet<Shape> = new Set<Shape>([
  'box',
  'round',
  'document',
  'parallelogram',
  'hexagon',
  'funnel',
  'expand',
  'cylinder',
  'diamond',
]);

/** Padding of the pill around a badge's text. */
const BADGE_PAD_X = 4;
const BADGE_PAD_Y = 1.5;
/** How far the badge sits inside the corner, so it reads as attached rather than floating. */
const BADGE_INSET = 2;
/** Horizontal padding of a bare `text` node's label. */
const TEXT_PAD = 2;
/** Legend rows wrap at the drawing's width, but never narrower than this. */
const LEGEND_MIN_WRAP = 360;
/** Between a legend swatch and its label, and between wrapped legend rows. */
const LEGEND_INNER_GAP = 6;
/**
 * The tightest layer gap a flow may ask for with `gap`: a stub out of the
 * source, room for a bend, and an arrowhead into the target.
 */
const MIN_RANK_GAP = M.edge.stub * 2 + M.edge.arrowLength;
/**
 * The tightest gap between two row, column or grid neighbours an edge runs
 * between, whatever `gap` asks: the router's clearance on both sides and a
 * stub. Facing ports line up, so the edge is one straight run.
 */
const MIN_EDGE_GAP = 2 * M.edge.clearance + M.edge.stub;
/** How far the router takes a self-loop out of its node's side. */
const SELF_LOOP_REACH = 16;
/** How far past a group title's text the router keeps out (its soft box margin). */
const TITLE_MARGIN = 2;

type Context = {
  model: FigureModel;
  measurer: TextMeasurer;
  family: FontSpec['family'];
  diagnostics: FigureDiagnostic[];
  /** Edge label sizes, measured once per edge however many groups ask. */
  edgeLabels: Map<EdgeModel, Extent | null>;
  /** Items already laid out: one listed twice, or inside itself, is drawn once. */
  placed: Set<string>;
};

/** An item laid out in its own frame, with everything it draws. */
type Laid = {
  item: ItemModel;
  bounds: Rect;
  /** What siblings align on: a node's anchor, a group's box. */
  anchor: Rect;
  nodes: SceneNode[];
  groups: SceneGroup[];
};

type Size = { width: number; height: number };

/* ────────────────────────────────────────────────────────────────────────
 * Small helpers
 * ──────────────────────────────────────────────────────────────────────── */

function measure(
  ctx: Context,
  label: Label | null,
  font: FontSpec,
  maxWidth?: number,
  align: LabelBox['align'] = 'center',
): LabelBox | null {
  if (!label || isEmptyLabel(label)) return null;
  return measureLabel(label, font, ctx.measurer, { maxWidth, align });
}

function measureString(ctx: Context, text: string | null | undefined, font: FontSpec, maxWidth?: number): LabelBox | null {
  return text && text.trim() ? measure(ctx, parseLabel(text), font, maxWidth) : null;
}

/** A copy of `box` at (x, y): measured boxes may be shared, so they are never mutated. */
function at(box: LabelBox, x: number, y: number): LabelBox {
  return { ...box, x, y };
}

function moveBox(box: LabelBox | null, dx: number, dy: number): LabelBox | null {
  return box && { ...box, x: box.x + dx, y: box.y + dy };
}

function unionAll(first: Rect, ...rest: Array<Rect | null>): Rect {
  let out = first;
  for (const rect of rest) if (rect) out = unionRect(out, rect);
  return out;
}

/** Shift an item and everything it draws; rects are replaced, never mutated. */
function shiftLaid(laid: Laid, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  laid.bounds = translateRect(laid.bounds, dx, dy);
  laid.anchor = translateRect(laid.anchor, dx, dy);
  for (const node of laid.nodes) {
    node.shape = translateRect(node.shape, dx, dy);
    node.anchor = translateRect(node.anchor, dx, dy);
    node.bounds = translateRect(node.bounds, dx, dy);
    node.label = moveBox(node.label, dx, dy);
    node.sublabel = moveBox(node.sublabel, dx, dy);
    node.repeat = moveBox(node.repeat, dx, dy);
    node.badge = moveBox(node.badge, dx, dy);
  }
  for (const group of laid.groups) {
    group.box = translateRect(group.box, dx, dy);
    group.bounds = translateRect(group.bounds, dx, dy);
    group.label = moveBox(group.label, dx, dy);
    group.repeat = moveBox(group.repeat, dx, dy);
    group.panel = moveBox(group.panel, dx, dy);
  }
}

/** Whether a container lines its children up along y (so markers go beside them, not under). */
function stacksVertically(group: GroupModel): boolean {
  if (group.layout === 'column') return true;
  if (group.layout === 'row') return false;
  return isVertical(group.direction);
}

function fixedSize(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.min(M.node.maxFixed, Math.max(M.node.minFixed, value));
}

/** A label with its sublabel under it, as one block. */
function stackedExtent(label: LabelBox | null, sublabel: LabelBox | null): Size {
  const gap = label && sublabel ? M.node.sublabelGap : 0;
  return {
    width: Math.max(label?.width ?? 0, sublabel?.width ?? 0),
    height: (label?.height ?? 0) + gap + (sublabel?.height ?? 0),
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Nodes
 * ──────────────────────────────────────────────────────────────────────── */

/** The shape's natural size around a label block of `block` (label + sublabel). */
function shapeSize(node: NodeModel, block: Size, vertical: boolean): Size {
  const { padX, padY, minWidth, minHeight, opDiameter } = M.node;
  const lw = block.width;
  const lh = block.height;
  const boxW = Math.max(minWidth, lw + 2 * padX);
  const boxH = Math.max(minHeight, lh + 2 * padY);
  switch (node.shape) {
    case 'round':
      // The stadium's ends eat into the label's room.
      return { width: boxW + boxH * 0.35, height: boxH };
    case 'circle': {
      if (lw <= 1.5 * lh) {
        const d = Math.max(28, Math.max(lw, lh) + 14);
        return { width: d, height: d };
      }
      return { width: lw * 1.2 + 18, height: Math.max(28, lh * 1.3 + 12) };
    }
    case 'op': {
      const d = node.op !== null ? opDiameter : Math.max(opDiameter, Math.max(lw, lh) + 8);
      return { width: d, height: d };
    }
    case 'diamond':
      return { width: Math.max(40, lw * 1.6 + 20), height: Math.max(32, lh * 1.6 + 14) };
    case 'funnel':
    case 'expand': {
      if (vertical) {
        const h = Math.max(28, lh + 2 * padY);
        return { width: Math.max(56, lw + 2 * padX + 2 * 0.45 * h), height: h };
      }
      return { width: Math.max(44, lw + 2 * padX), height: Math.max(28, lh + 2 * padY) + 20 };
    }
    case 'parallelogram':
      return { width: boxW + 0.35 * boxH, height: boxH };
    case 'hexagon':
      return { width: boxW + 0.6 * boxH, height: boxH };
    case 'cylinder':
      return { width: boxW, height: boxH + 12 };
    case 'document':
      return { width: boxW, height: boxH + 6 };
    case 'text':
      return { width: Math.max(12, lw + 2 * TEXT_PAD), height: Math.max(14, lh + 2) };
    case 'image':
      return { width: M.node.imageWidth, height: M.node.imageHeight };
    case 'tensor':
    case 'box':
      return { width: boxW, height: boxH };
  }
}

/**
 * Grow a shape until its label area holds the block. The formulas above
 * already do for ordinary labels; this catches tall, narrow ones where a
 * slanted side would otherwise cut into the text. Every label area grows
 * with its shape no faster than 1:1, so adding the deficit never overshoots.
 */
function fitLabelArea(node: NodeModel, size: Size, block: Size, direction: Direction, growW: boolean, growH: boolean): Size {
  let { width, height } = size;
  for (let i = 0; i < 32; i += 1) {
    const area = labelArea(node.shape, { x: 0, y: 0, width, height }, direction);
    const dw = growW ? block.width - area.width : 0;
    const dh = growH ? block.height - area.height : 0;
    if (dw <= 0.01 && dh <= 0.01) break;
    if (dw > 0.01) width += dw;
    if (dh > 0.01) height += dh;
  }
  return { width, height };
}

/**
 * A tensor's grid. Every cell has the same size so a renderer can split the
 * shape evenly: token cells fit the widest token, plain cells shrink until
 * the grid fits `maxExtent`.
 */
function tensorSize(ctx: Context, cells: TensorCells | null): Size {
  const T = M.tensor;
  const rows = Math.max(1, Math.floor(cells?.rows ?? 1));
  const cols = Math.max(1, Math.floor(cells?.cols ?? 4));
  if (cells?.text) {
    const font = figureFont(ctx.family, M.font.cell);
    let widest = 0;
    let tallest = 0;
    for (const row of cells.text) {
      for (const text of row) {
        const box = measureString(ctx, text, font);
        if (!box) continue;
        widest = Math.max(widest, box.width);
        tallest = Math.max(tallest, box.height);
      }
    }
    const cellW = Math.max(T.textCellMinWidth, widest + 2 * T.textCellPad);
    const cellH = Math.max(T.textCellHeight, tallest + T.textCellPad);
    return { width: cols * cellW, height: rows * cellH };
  }
  const cell = Math.max(T.minCell, Math.min(T.cell, T.maxExtent / Math.max(rows, cols)));
  return { width: cols * cell, height: rows * cell };
}

/**
 * Whether a tensor's or an image's caption goes above it rather than under:
 * on the side no edge uses, the way DeepSeek-V2 labels "Output hidden" over
 * the strip it arrives at. In an upward flow edges leave through the top and
 * arrive at the bottom, so a sink is captioned on top; in a downward flow, a
 * source. Anything else keeps its caption underneath.
 */
function captionAbove(model: FigureModel, node: NodeModel, direction: Direction): boolean {
  if (direction !== 'up' && direction !== 'down') return false;
  let incoming = 0;
  let outgoing = 0;
  for (const edge of model.edges) {
    if (edge.kind === 'feedback' || edge.from === edge.to) continue;
    if (edge.to === node.id) incoming += 1;
    if (edge.from === node.id) outgoing += 1;
  }
  return direction === 'up' ? incoming > 0 && outgoing === 0 : outgoing > 0 && incoming === 0;
}

/**
 * Size and dress one node in its own frame: the front shape's top-left is
 * the origin. `forced` is a `uniform` size, which widens the shape without
 * re-wrapping the label (an explicit `width` does re-wrap it).
 */
function layoutNode(
  ctx: Context,
  node: NodeModel,
  direction: Direction,
  parentVertical: boolean,
  depth: number,
  forced: Partial<Size> = {},
): Laid {
  const N = M.node;
  const labelFont = figureFont(ctx.family, M.font.node, node.bold ? 600 : 400, node.italic);
  const subFont = figureFont(ctx.family, M.font.sublabel);
  const fixedW = fixedSize(node.width);
  const fixedH = fixedSize(node.height);
  const glyph = node.shape === 'op' && node.op !== null;
  const outside = node.shape === 'tensor' || node.shape === 'image';

  let size: Size;
  let label: LabelBox | null;
  let sublabel: LabelBox | null;
  if (outside) {
    const natural = node.shape === 'tensor' ? tensorSize(ctx, node.cells) : shapeSize(node, { width: 0, height: 0 }, true);
    size = { width: fixedW ?? natural.width, height: fixedH ?? natural.height };
    const wrap = Math.max(M.labelMaxWidth, size.width);
    label = measure(ctx, node.label, labelFont, wrap);
    sublabel = measure(ctx, node.sublabel, subFont, wrap);
  } else {
    const inset = node.shape === 'text' ? TEXT_PAD : N.padX;
    const wrap = fixedW !== null ? Math.max(1, fixedW - 2 * inset) : M.labelMaxWidth;
    label = glyph ? null : measure(ctx, node.label, labelFont, wrap);
    sublabel = measure(ctx, node.sublabel, subFont, wrap);
    // A glyph fills its circle, so a sublabel goes outside, beside it.
    const block = stackedExtent(label, glyph ? null : sublabel);
    const natural = fitLabelArea(
      node,
      shapeSize(node, block, isVertical(direction)),
      block,
      direction,
      fixedW === null,
      fixedH === null,
    );
    size = {
      width: fixedW ?? Math.max(forced.width ?? 0, natural.width),
      height: fixedH ?? Math.max(forced.height ?? 0, natural.height),
    };
  }

  const shape: Rect = { x: 0, y: 0, width: size.width, height: size.height };
  const cx = size.width / 2;
  let anchor: Rect = shape;
  let extra: Rect | null = null;

  if (outside && captionAbove(ctx.model, node, direction)) {
    let bottom = -N.externalLabelGap;
    if (sublabel) {
      sublabel = at(sublabel, cx - sublabel.width / 2, bottom - sublabel.height);
      bottom = sublabel.y - N.sublabelGap;
    }
    if (label) label = at(label, cx - label.width / 2, bottom - label.height);
    anchor = unionAll(shape, label, sublabel);
  } else if (outside) {
    let top = size.height + N.externalLabelGap;
    if (label) {
      label = at(label, cx - label.width / 2, top);
      top += label.height + N.sublabelGap;
    }
    if (sublabel) sublabel = at(sublabel, cx - sublabel.width / 2, top);
    anchor = unionAll(shape, label, sublabel);
  } else if (glyph) {
    if (sublabel) {
      sublabel = parentVertical
        ? at(sublabel, size.width + N.externalLabelGap, size.height / 2 - sublabel.height / 2)
        : at(sublabel, cx - sublabel.width / 2, size.height + N.externalLabelGap);
      extra = sublabel;
    }
  } else {
    const area = labelArea(node.shape, shape, direction);
    const block = stackedExtent(label, sublabel);
    let top = area.y + (area.height - block.height) / 2;
    if (label) {
      label = at(label, area.x + (area.width - label.width) / 2, top);
      top += label.height + N.sublabelGap;
    }
    if (sublabel) sublabel = at(sublabel, area.x + (area.width - sublabel.width) / 2, top);
  }

  const copies = Math.max(1, Math.min(8, Math.round(Number.isFinite(node.stack) ? node.stack : 1)));
  const lift = (copies - 1) * N.stackOffset;
  // Labels are included too: one can overflow a shape given a fixed size too small for it.
  let bounds = unionAll(anchor, { x: 0, y: -lift, width: size.width + lift, height: size.height + lift }, extra, label, sublabel);

  // The badge rides the outermost copy's corner, so a stack does not hide it.
  let badge = measureString(ctx, node.badge, figureFont(ctx.family, M.font.badge));
  if (badge) {
    const width = badge.width + 2 * BADGE_PAD_X;
    const height = badge.height + 2 * BADGE_PAD_Y;
    badge = { ...badge, x: size.width + lift - width / 2 - BADGE_INSET, y: -lift - height / 2, width, height };
    bounds = unionAll(bounds, badge);
  }

  // `repeat` on a node is optional in the model; normalize fills it when the spec has one.
  const repeatText = (node as NodeModel & { repeat?: string | null }).repeat;
  let repeat = measureString(ctx, repeatText, figureFont(ctx.family, M.font.repeat, 600));
  if (repeat) {
    repeat = parentVertical
      ? at(repeat, bounds.x + bounds.width + N.repeatGap, size.height / 2 - repeat.height / 2)
      : at(repeat, cx - repeat.width / 2, bounds.y + bounds.height + N.repeatGap);
    bounds = unionAll(bounds, repeat);
  }

  const scene: SceneNode = {
    id: node.id,
    model: node,
    shape,
    anchor,
    bounds,
    label,
    sublabel,
    repeat,
    badge,
    stackOffset: copies > 1 ? N.stackOffset : 0,
    direction,
    depth,
  };
  return { item: node, bounds, anchor, nodes: [scene], groups: [] };
}

/* ────────────────────────────────────────────────────────────────────────
 * Arrangements
 * ──────────────────────────────────────────────────────────────────────── */

/** The child of `groupId` that is, or contains, item `id`; null when `id` is not inside the group. */
function childContaining(model: FigureModel, groupId: string, id: string): string | null {
  let current = id;
  for (let guard = 0; guard <= model.items.size; guard += 1) {
    const item = model.items.get(current);
    if (!item) return null;
    if (item.parent === groupId) return current;
    if (item.parent === ROOT_ID) return null;
    current = item.parent;
  }
  return null;
}

function edgeLabelExtent(ctx: Context, edge: EdgeModel): Extent | null {
  if (!ctx.edgeLabels.has(edge)) {
    const box = measure(ctx, edge.label, figureFont(ctx.family, M.font.edge));
    ctx.edgeLabels.set(edge, box && { width: box.width, height: box.height });
  }
  return ctx.edgeLabels.get(edge) ?? null;
}

/**
 * The side across the flow a long edge will run on, as the router decides
 * it: a pinned side of either end, else the left (top) for a residual or
 * skip, which the router brings into its target from that side.
 */
function channelSide(edge: EdgeModel, vertical: boolean): LayeredEdge['channel'] {
  const across = (side: Side | null): LayeredEdge['channel'] => {
    if (side === (vertical ? 'left' : 'top')) return 'before';
    if (side === (vertical ? 'right' : 'bottom')) return 'after';
    return undefined;
  };
  return across(edge.toSide) ?? across(edge.fromSide) ?? (edge.kind === 'residual' || edge.kind === 'skip' ? 'before' : undefined);
}

/**
 * The model's edges as edges between this group's children: an edge between
 * descendants of two different children orders those two children.
 */
function liftEdges(ctx: Context, group: GroupModel, childIds: ReadonlySet<string>, vertical: boolean): LayeredEdge[] {
  const lifted: LayeredEdge[] = [];
  for (const edge of ctx.model.edges) {
    const from = childContaining(ctx.model, group.id, edge.from);
    const to = childContaining(ctx.model, group.id, edge.to);
    if (!from || !to || from === to || !childIds.has(from) || !childIds.has(to)) continue;
    const label = edgeLabelExtent(ctx, edge);
    // A long edge's label sits beside its vertical run (to the right) or
    // above its horizontal run, so its channel keeps room on that side.
    const beside = label ? M.edge.labelGap + (vertical ? label.width : label.height) : 0;
    lifted.push({
      from,
      to,
      weight: 1,
      constraint: edge.constraint && edge.kind !== 'feedback',
      labelMain: label ? (vertical ? label.height : label.width) : 0,
      labelCross: label ? (vertical ? label.width : label.height) : 0,
      channel: channelSide(edge, vertical),
      channelRoom: vertical ? { before: 0, after: beside } : { before: beside, after: 0 },
    });
  }
  return lifted;
}

/**
 * Room past the last item, across the flow, for edges the router takes
 * around the outside: edges against the layering loop around the right of a
 * vertical flow (the bottom of a horizontal one), and self-loops leave by the
 * same side. Without it a loop runs over the group's border or off the page.
 */
function loopRoom(
  ctx: Context,
  edges: LayeredEdge[],
  rank: ReadonlyMap<string, number>,
  childIds: ReadonlySet<string>,
  vertical: boolean,
): number {
  let room = 0;
  const back = edges.filter((e) => (rank.get(e.from) ?? 0) > (rank.get(e.to) ?? 0));
  if (back.length) {
    const label = Math.max(0, ...back.map((e) => e.labelCross ?? 0));
    room = M.edge.stub + M.edge.nudge * (back.length - 1) + (label > 0 ? M.edge.labelGap + label : 0);
  }
  for (const edge of ctx.model.edges) {
    if (edge.from !== edge.to || !childIds.has(edge.from)) continue;
    const label = edgeLabelExtent(ctx, edge);
    const labelRoom = label ? M.edge.labelGap + (vertical ? label.width : label.height) : 0;
    room = Math.max(room, SELF_LOOP_REACH + labelRoom);
  }
  return room > 0 ? room + M.edge.clearance : 0;
}

function arrangeFlow(ctx: Context, group: GroupModel, kids: Laid[], allPanels: boolean): Rect {
  const vertical = isVertical(group.direction);
  const itemGap = group.gap !== null ? Math.max(0, group.gap) : allPanels ? M.gap.panel : M.gap.item;
  const rankGap = group.gap !== null ? Math.max(group.gap, MIN_RANK_GAP) : allPanels ? M.gap.panel : M.gap.rank;
  const items: LayeredItem[] = kids.map(({ item, bounds: b, anchor: a }) => {
    const centre = vertical ? a.x + a.width / 2 : a.y + a.height / 2;
    const start = vertical ? b.x : b.y;
    const end = vertical ? b.x + b.width : b.y + b.height;
    return {
      id: item.id,
      order: item.order,
      main: vertical ? b.height : b.width,
      before: centre - start,
      after: end - centre,
      rank: item.rank,
      beside: item.beside,
      sameRank: item.sameRank,
      path: item.path,
      range: item.range,
    };
  });
  const childIds = new Set(kids.map((k) => k.item.id));
  const edges = liftEdges(ctx, group, childIds, vertical);
  const result = layeredLayout(items, edges, { itemGap, rankGap, dummyGap: M.gap.dummy });
  ctx.diagnostics.push(...result.diagnostics);
  const crossExtent = result.crossExtent + loopRoom(ctx, edges, result.rank, childIds, vertical);

  for (const kid of kids) {
    const cross = result.cross.get(kid.item.id) ?? 0;
    const main = result.main.get(kid.item.id) ?? 0;
    const { bounds: b, anchor: a } = kid;
    if (vertical) {
      // `up` mirrors the main axis, so the first layer ends up at the bottom.
      const y = group.direction === 'up' ? result.mainExtent - main - b.height : main;
      shiftLaid(kid, cross - (a.x + a.width / 2), y - b.y);
    } else {
      const x = group.direction === 'left' ? result.mainExtent - main - b.width : main;
      shiftLaid(kid, x - b.x, cross - (a.y + a.height / 2));
    }
  }
  return vertical
    ? { x: 0, y: 0, width: crossExtent, height: result.mainExtent }
    : { x: 0, y: 0, width: result.mainExtent, height: crossExtent };
}

/**
 * Room the edges between two children need between them, for arrangements
 * that place children without looking at edges (row, column, grid): a lane
 * for the route and, for a labelled edge, its label along the run. `width`
 * is the room when the pair sits side by side, `height` when one is above
 * the other.
 */
type EdgeRoom = (a: Laid, b: Laid) => Size;

function edgeRoom(ctx: Context, group: GroupModel, kids: Laid[]): EdgeRoom {
  const ids = new Set(kids.map((k) => k.item.id));
  const key = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const room = new Map<string, Size>();
  for (const edge of ctx.model.edges) {
    const from = childContaining(ctx.model, group.id, edge.from);
    const to = childContaining(ctx.model, group.id, edge.to);
    if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) continue;
    const label = edgeLabelExtent(ctx, edge);
    const prev = room.get(key(from, to));
    room.set(key(from, to), {
      width: Math.max(prev?.width ?? 0, MIN_EDGE_GAP, label ? label.width + LABEL_ROOM : 0),
      height: Math.max(prev?.height ?? 0, MIN_EDGE_GAP, label ? label.height + LABEL_ROOM : 0),
    });
  }
  return (a, b) => room.get(key(a.item.id, b.item.id)) ?? { width: 0, height: 0 };
}

const NO_ROOM: EdgeRoom = () => ({ width: 0, height: 0 });

/**
 * A row (`alongX`) or column in declaration order, aligned across by `align`.
 * Neighbours joined by an edge sit at least `room` apart.
 */
function arrangeLine(kids: Laid[], alongX: boolean, reverse: boolean, gap: number, align: Align, room: EdgeRoom = NO_ROOM): Rect {
  const sequence = reverse ? [...kids].reverse() : kids;
  const crossStart = (r: Rect) => (alongX ? r.y : r.x);
  const crossSize = (r: Rect) => (alongX ? r.height : r.width);
  const before = (k: Laid) => crossStart(k.anchor) + crossSize(k.anchor) / 2 - crossStart(k.bounds);
  // `center` lines up anchor centres, not bounds: a stacked or badged box
  // stays in line with its plain neighbours.
  const line = Math.max(0, ...sequence.map(before));
  const extent =
    align === 'center'
      ? Math.max(0, ...sequence.map((k) => line - before(k) + crossSize(k.bounds)))
      : Math.max(0, ...sequence.map((k) => crossSize(k.bounds)));
  let cursor = 0;
  sequence.forEach((kid, i) => {
    if (i > 0) {
      const need = room(sequence[i - 1], kid);
      cursor += Math.max(gap, alongX ? need.width : need.height);
    }
    const b = kid.bounds;
    const along = cursor - (alongX ? b.x : b.y);
    const start = align === 'start' ? 0 : align === 'end' ? extent - crossSize(b) : line - before(kid);
    const across = start - crossStart(b);
    shiftLaid(kid, alongX ? along : across, alongX ? across : along);
    cursor += alongX ? b.width : b.height;
  });
  const length = cursor;
  return alongX ? { x: 0, y: 0, width: length, height: extent } : { x: 0, y: 0, width: extent, height: length };
}

/**
 * Row-major cells; every column as wide as its widest item, every row as tall
 * as its tallest. The gap between two columns (rows) widens for the edges
 * joining neighbouring cells across it.
 */
function arrangeGrid(kids: Laid[], columns: number, gap: number, room: EdgeRoom = NO_ROOM): Rect {
  if (kids.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const cols = Math.max(1, Math.min(kids.length, Math.floor(columns) || 1));
  const rows = Math.ceil(kids.length / cols);
  const colW = new Array<number>(cols).fill(0);
  const rowH = new Array<number>(rows).fill(0);
  kids.forEach((kid, i) => {
    colW[i % cols] = Math.max(colW[i % cols], kid.bounds.width);
    rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)], kid.bounds.height);
  });
  const colGap = new Array<number>(cols).fill(gap);
  const rowGap = new Array<number>(rows).fill(gap);
  kids.forEach((a, i) => {
    for (let j = i + 1; j < kids.length; j += 1) {
      const need = room(a, kids[j]);
      if (need.width === 0 && need.height === 0) continue;
      const dc = Math.abs((i % cols) - (j % cols));
      const dr = Math.abs(Math.floor(i / cols) - Math.floor(j / cols));
      const c = Math.min(i % cols, j % cols);
      const r = Math.min(Math.floor(i / cols), Math.floor(j / cols));
      // Side by side the label sits along a horizontal run, stacked along a
      // vertical one; a diagonal neighbour only needs a lane through both.
      if (dr === 0 && dc === 1) colGap[c] = Math.max(colGap[c], need.width);
      else if (dc === 0 && dr === 1) rowGap[r] = Math.max(rowGap[r], need.height);
      else if (dc === 1 && dr === 1) {
        colGap[c] = Math.max(colGap[c], MIN_EDGE_GAP);
        rowGap[r] = Math.max(rowGap[r], MIN_EDGE_GAP);
      }
    }
  });
  const colX = colW.map((_, c) => colW.slice(0, c).reduce((sum, w, k) => sum + w + colGap[k], 0));
  const rowY = rowH.map((_, r) => rowH.slice(0, r).reduce((sum, h, k) => sum + h + rowGap[k], 0));
  kids.forEach((kid, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const b = kid.bounds;
    shiftLaid(kid, colX[c] + (colW[c] - b.width) / 2 - b.x, rowY[r] + (rowH[r] - b.height) / 2 - b.y);
  });
  return {
    x: 0,
    y: 0,
    width: colX[cols - 1] + colW[cols - 1],
    height: rowY[rows - 1] + rowH[rows - 1],
  };
}

/**
 * `uniform`: box-like children without an explicit size share the widest
 * width (vertical stacks) or the tallest height (horizontal ones), which is
 * what makes a stack of blocks read as one column.
 */
function makeUniform(ctx: Context, group: GroupModel, kids: Laid[], depth: number): void {
  if (group.layout === 'grid') return;
  const axis: keyof Size = stacksVertically(group) ? 'width' : 'height';
  const targets: Array<{ index: number; node: NodeModel; size: number }> = [];
  kids.forEach((kid, index) => {
    const { item } = kid;
    if (item.kind !== 'node' || !BOX_LIKE.has(item.shape) || item[axis] !== null) return;
    targets.push({ index, node: item, size: kid.nodes[0].shape[axis] });
  });
  if (targets.length < 2) return;
  const size = Math.max(...targets.map((t) => t.size));
  for (const target of targets) {
    if (target.size >= size) continue;
    const forced = axis === 'width' ? { width: size } : { height: size };
    kids[target.index] = layoutNode(ctx, target.node, group.direction, stacksVertically(group), depth + 1, forced);
  }
}

/**
 * The side of the figure a group sits on, for markers that belong outside it:
 * the Transformer's decoder is the last column of a row, so its "N×" goes on
 * its right, away from the encoder, instead of between the two stacks where
 * it would read as the encoder's.
 */
type OuterSide = 'left' | 'right' | null;

function childOuterSide(group: GroupModel, outer: OuterSide, index: number, count: number): OuterSide {
  if (group.layout !== 'row' || count < 2) return outer;
  const first = group.direction === 'left' ? count - 1 : 0;
  const last = group.direction === 'left' ? 0 : count - 1;
  if (index === first) return 'left';
  if (index === last) return 'right';
  return null;
}

/**
 * Sub-figure captions of panels side by side share one line, as (a), (b),
 * (c) do in a paper: panels whose boxes overlap across y form a row, and each
 * caption in it moves down to the row's lowest. The boxes stay where the
 * arrangement put them, so edges keep their alignment; a row whose captions
 * would then run into a sibling is left as it was.
 */
function alignPanelCaptions(kids: Laid[]): void {
  const panels = kids
    .filter((kid) => kid.item.kind === 'group' && kid.groups[0]?.panel)
    .sort((a, b) => a.anchor.y - b.anchor.y);
  const align = (row: Laid[]) => {
    if (row.length < 2) return;
    const line = Math.max(...row.map((kid) => kid.groups[0].panel!.y));
    const moved = new Map<Laid, { panel: LabelBox; bounds: Rect }>();
    for (const kid of row) {
      const g = kid.groups[0];
      const panel = at(g.panel!, g.panel!.x, line);
      moved.set(kid, { panel, bounds: unionAll(g.box, g.label, g.repeat, panel) });
    }
    for (const [kid, { bounds }] of moved) {
      for (const other of kids) {
        if (other !== kid && rectsOverlap(bounds, moved.get(other)?.bounds ?? other.bounds)) return;
      }
    }
    for (const [kid, { panel, bounds }] of moved) {
      kid.groups[0].panel = panel;
      kid.groups[0].bounds = bounds;
      kid.bounds = bounds;
    }
  };
  let row: Laid[] = [];
  let bottom = -Infinity;
  for (const kid of panels) {
    if (kid.anchor.y >= bottom) {
      align(row);
      row = [];
      bottom = -Infinity;
    }
    row.push(kid);
    bottom = Math.max(bottom, kid.anchor.y + kid.anchor.height);
  }
  align(row);
}

/** Lay out a group's children and arrange them in the group's content frame. */
function layoutChildren(
  ctx: Context,
  group: GroupModel,
  depth: number,
  outer: OuterSide = null,
): { kids: Laid[]; content: Rect } {
  const vertical = stacksVertically(group);
  const kids: Laid[] = [];
  const members = group.children.filter((id) => ctx.model.items.has(id) && !ctx.placed.has(id));
  members.forEach((id, index) => {
    const item = ctx.model.items.get(id)!;
    if (ctx.placed.has(id)) return;
    ctx.placed.add(id);
    kids.push(
      item.kind === 'node'
        ? layoutNode(ctx, item, group.direction, vertical, depth + 1)
        : layoutGroup(ctx, item, vertical, depth + 1, childOuterSide(group, outer, index, members.length)),
    );
  });
  if (group.uniform) makeUniform(ctx, group, kids, depth);

  const allPanels = kids.length > 0 && kids.every((k) => k.item.kind === 'group' && k.item.panel !== null);
  const gap = group.gap !== null ? Math.max(0, group.gap) : allPanels ? M.gap.panel : M.gap.stack;
  const room = group.layout === 'flow' ? NO_ROOM : edgeRoom(ctx, group, kids);
  let content: Rect;
  switch (group.layout) {
    case 'row':
      content = arrangeLine(kids, true, group.direction === 'left', gap, group.align, room);
      break;
    case 'column':
      content = arrangeLine(kids, false, group.direction === 'up', gap, group.align, room);
      break;
    case 'grid':
      content = arrangeGrid(kids, group.columns, gap, room);
      break;
    case 'flow':
      content = kids.length ? arrangeFlow(ctx, group, kids, allPanels) : { x: 0, y: 0, width: 0, height: 0 };
      break;
  }
  alignPanelCaptions(kids);
  for (const kid of kids) content = unionRect(content, kid.bounds);
  return { kids, content };
}

/**
 * Whether an edge leaves or enters `group` through the end its title sits on
 * (`titleSide`), under the title. Edges to the outside follow the flow the
 * group sits in (its own when that one runs across): they leave through the
 * far end (the top in an `up` flow) and come in through the near end, unless
 * a side is pinned. The title is left-aligned, so only an endpoint whose box
 * reaches under the title's `span` (in the children's frame) counts.
 */
function edgeUnderTitle(ctx: Context, group: GroupModel, kids: Laid[], titleSide: Side, span: [number, number]): boolean {
  const parent = ctx.model.items.get(group.parent);
  const around = (parent?.kind === 'group' ? parent : ctx.model.root).direction;
  const flow = isVertical(around) ? around : isVertical(group.direction) ? group.direction : null;
  if (!flow) return false;
  const farEnd: Side = flow === 'up' ? 'top' : 'bottom';
  const nearEnd: Side = flow === 'up' ? 'bottom' : 'top';
  const boxes = new Map<string, Rect>();
  for (const kid of kids) {
    for (const n of kid.nodes) boxes.set(n.id, n.bounds);
    for (const g of kid.groups) boxes.set(g.id, g.box);
  }
  const inside = (id: string) => id !== group.id && childContaining(ctx.model, group.id, id) !== null;
  for (const edge of ctx.model.edges) {
    const outgoing = inside(edge.from);
    if (outgoing === inside(edge.to)) continue;
    const side = (outgoing ? edge.fromSide : edge.toSide) ?? (outgoing ? farEnd : nearEnd);
    if (side !== titleSide) continue;
    const box = boxes.get(outgoing ? edge.from : edge.to);
    if (box && box.x < span[1] + TITLE_MARGIN && box.x + box.width > span[0] - TITLE_MARGIN) return true;
  }
  return false;
}

/** A group: its children, the box around them, the title inside, and the markers outside. */
function layoutGroup(
  ctx: Context,
  group: GroupModel,
  parentVertical: boolean,
  depth: number,
  outer: OuterSide = null,
): Laid {
  const G = M.group;
  const { kids, content } = layoutChildren(ctx, group, depth, outer);
  const pad = group.border === 'none' && !group.filled ? G.padBare : G.pad;

  const title = measure(
    ctx,
    group.label,
    figureFont(ctx.family, M.font.group, 600),
    Math.max(content.width, M.labelMaxWidth),
    'left',
  );
  const inner = Math.max(content.width, title?.width ?? 0);
  const titleAtBottom = group.labelPosition === 'bottom';
  const dx = pad + (inner - content.width) / 2 - content.x;
  // The title stays where the author put it. When an edge runs out of (or
  // into) the group under it, the band keeps a lane between title and
  // content, so the route can jog past the text instead of striking it out.
  const lane =
    title && edgeUnderTitle(ctx, group, kids, titleAtBottom ? 'bottom' : 'top', [pad - dx, pad + title.width - dx])
      ? 2 * M.edge.clearance
      : 0;
  const titleGap = G.titleGap + lane;
  const band = title ? title.height + titleGap : 0;
  const box: Rect = { x: 0, y: 0, width: inner + 2 * pad, height: content.height + band + 2 * pad };
  const dy = pad + (titleAtBottom ? 0 : band) - content.y;
  for (const kid of kids) shiftLaid(kid, dx, dy);
  const label = title && at(title, pad, titleAtBottom ? pad + content.height + titleGap : pad);

  let repeat = measureString(ctx, group.repeat, figureFont(ctx.family, M.font.repeat, 600));
  if (repeat) {
    repeat = !parentVertical
      ? at(repeat, box.width / 2 - repeat.width / 2, box.height + G.repeatGap)
      : outer === 'right'
        ? at(repeat, box.width + G.repeatGap, box.height / 2 - repeat.height / 2)
        : at(repeat, -G.repeatGap - repeat.width, box.height / 2 - repeat.height / 2);
  }
  let panel = measureString(ctx, group.panel, figureFont(ctx.family, M.font.panel), Math.max(box.width, M.labelMaxWidth));
  if (panel) {
    const below = repeat && !parentVertical ? repeat.y + repeat.height : box.height;
    panel = at(panel, box.width / 2 - panel.width / 2, below + G.panelGap);
  }

  const bounds = unionAll(box, label, repeat, panel);
  const scene: SceneGroup = {
    id: group.id,
    model: group,
    box,
    bounds,
    label,
    repeat,
    panel,
    depth,
    direction: group.direction,
  };
  return {
    item: group,
    bounds,
    anchor: box,
    nodes: kids.flatMap((k) => k.nodes),
    groups: [scene, ...kids.flatMap((k) => k.groups)],
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Legend
 * ──────────────────────────────────────────────────────────────────────── */

type LegendRow = { items: SceneLegend['items']; width: number; height: number };

/** Legend entries flowing left to right in rows no wider than `wrap`, each row starting at x = 0. */
function layoutLegendRows(ctx: Context, wrap: number): LegendRow[] {
  const L = M.legend;
  const font = figureFont(ctx.family, M.font.legend);
  const rows: LegendRow[] = [];
  let row: Array<{ entry: SceneLegend['items'][number]; width: number; height: number; firstLine: number }> = [];
  let rowWidth = 0;
  const flush = () => {
    if (!row.length) return;
    const height = Math.max(...row.map((r) => r.height));
    rows.push({
      width: rowWidth,
      height,
      items: row.map(({ entry, height: h, firstLine }) => {
        // Centre each entry in its row, and the swatch on the label's first line.
        const top = (height - h) / 2;
        return {
          sample: entry.sample,
          swatch: { ...entry.swatch, y: top + Math.max(0, (firstLine - L.swatchHeight) / 2) },
          label: at(entry.label, entry.label.x, top + Math.max(0, (L.swatchHeight - firstLine) / 2)),
        };
      }),
    });
    row = [];
    rowWidth = 0;
  };
  for (const item of ctx.model.legend) {
    const measured = measureLabel(item.label, font, ctx.measurer, {
      maxWidth: Math.max(1, wrap - L.swatchWidth - LEGEND_INNER_GAP),
      align: 'left',
    });
    const hasText = measured.width > 0;
    const width = L.swatchWidth + (hasText ? LEGEND_INNER_GAP + measured.width : 0);
    if (row.length && rowWidth + L.itemGap + width > wrap) flush();
    const x = row.length ? rowWidth + L.itemGap : 0;
    row.push({
      entry: {
        sample: item.sample,
        swatch: { x, y: 0, width: L.swatchWidth, height: L.swatchHeight },
        label: at(measured, x + L.swatchWidth + LEGEND_INNER_GAP, 0),
      },
      width,
      height: Math.max(L.swatchHeight, measured.height),
      firstLine: measured.lines[0]?.height ?? measured.height,
    });
    rowWidth = x + width;
  }
  flush();
  return rows;
}

/* ────────────────────────────────────────────────────────────────────────
 * The figure
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Lay out a whole figure: every node and group box in absolute px, the root
 * container drawn without a box, the legend underneath, and a margin around
 * everything. Deterministic for a given model and measurer.
 */
export function layoutFigure(model: FigureModel, measurer: TextMeasurer): FigureLayout {
  const ctx: Context = {
    model,
    measurer,
    family: model.font,
    diagnostics: [],
    edgeLabels: new Map(),
    placed: new Set([model.root.id]),
  };

  const { kids, content } = layoutChildren(ctx, model.root, 0);
  const drawing: Rect = kids.length ? content : { x: 0, y: 0, width: 0, height: 0 };

  const rows = layoutLegendRows(ctx, Math.max(drawing.width, LEGEND_MIN_WRAP));
  const legendWidth = Math.max(0, ...rows.map((r) => r.width));
  const inner = Math.max(drawing.width, legendWidth);

  // The drawing is centred over a legend wider than itself.
  for (const kid of kids) {
    shiftLaid(kid, M.margin + (inner - drawing.width) / 2 - drawing.x, M.margin - drawing.y);
  }
  let bottom = M.margin + drawing.height;

  let legend: SceneLegend | null = null;
  if (rows.length) {
    let top = bottom + (kids.length ? M.legend.marginTop : 0);
    const items: SceneLegend['items'] = [];
    let box: Rect | null = null;
    for (const [index, row] of rows.entries()) {
      if (index > 0) top += LEGEND_INNER_GAP;
      const left = M.margin + (inner - row.width) / 2;
      for (const entry of row.items) {
        const swatch = translateRect(entry.swatch, left, top);
        const label = at(entry.label, entry.label.x + left, entry.label.y + top);
        items.push({ sample: entry.sample, swatch, label });
        box = unionAll(box ?? swatch, swatch, label);
      }
      top += row.height;
    }
    legend = { box: box ?? { x: M.margin, y: top, width: 0, height: 0 }, items };
    bottom = top;
  }

  const nodes = kids.flatMap((k) => k.nodes).sort((a, b) => a.model.order - b.model.order);
  const groups = kids
    .flatMap((k) => k.groups)
    .sort((a, b) => a.depth - b.depth || a.model.order - b.model.order);
  return {
    width: inner + 2 * M.margin,
    height: bottom + M.margin,
    nodes,
    groups,
    legend,
    direction: model.root.direction,
    diagnostics: ctx.diagnostics,
  };
}
