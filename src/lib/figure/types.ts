/**
 * Structured figures — the shared contract.
 *
 * A structured figure is a code block whose `language` is `figure` and whose
 * text is a declarative JSON spec: nodes, nested groups and edges, written by
 * the author or the assistant. Nothing about the drawing is stored; the
 * client parses, normalises, lays out and routes the spec on every render,
 * so the API, `doc_edit`, markdown and every export carry it unchanged.
 *
 *   source text ──parse──▶ JsonNode (with source ranges)
 *               ──normalise──▶ FigureModel (+ diagnostics)
 *               ──layout──▶ FigureLayout (boxes)
 *               ──route──▶ FigureScene (boxes + edge paths)
 *               ──render──▶ SVG (FigureSvg) · TikZ (figureToTikz)
 *
 * Every stage is pure and synchronous, so the same code draws the editor,
 * the review cards, the chat and the static HTML export.
 *
 * Units are CSS pixels at 96 dpi; the figure prints at the size it is laid
 * out (1px = 0.75pt) unless it has to shrink to fit the text column.
 */

/* ────────────────────────────────────────────────────────────────────────
 * Diagnostics
 * ──────────────────────────────────────────────────────────────────────── */

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type FigureDiagnostic = {
  severity: DiagnosticSeverity;
  /** Stable machine code, e.g. `json.syntax`, `edge.unknown-node`. */
  code: string;
  /** One sentence an author (or the assistant) can act on. */
  message: string;
  /** JSON path of the offending value, e.g. `nodes[2].children[0].shape`. */
  path?: string;
  /** Source offsets [start, end) of the offending text, when known. */
  range?: [number, number];
  /** 1-based line and column of `range[0]`, when known. */
  line?: number;
  column?: number;
};

/* ────────────────────────────────────────────────────────────────────────
 * Parsing: a lenient JSON reader that keeps source ranges
 * ──────────────────────────────────────────────────────────────────────── */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type JsonNodeBase = { start: number; end: number };

export type JsonObjectNode = JsonNodeBase & { kind: 'object'; members: JsonMember[] };
export type JsonArrayNode = JsonNodeBase & { kind: 'array'; items: JsonNode[] };
export type JsonStringNode = JsonNodeBase & { kind: 'string'; value: string };
export type JsonNumberNode = JsonNodeBase & { kind: 'number'; value: number };
export type JsonBooleanNode = JsonNodeBase & { kind: 'boolean'; value: boolean };
export type JsonNullNode = JsonNodeBase & { kind: 'null' };

export type JsonNode =
  | JsonObjectNode
  | JsonArrayNode
  | JsonStringNode
  | JsonNumberNode
  | JsonBooleanNode
  | JsonNullNode;

/** `"key": value` — `start` is the key's first character, `end` the value's end. */
export type JsonMember = {
  key: string;
  keyStart: number;
  keyEnd: number;
  value: JsonNode;
  start: number;
  end: number;
};

export type ParseResult = {
  /** The parsed tree, or null when the text could not be read at all. */
  ast: JsonNode | null;
  /** Plain value of `ast` (objects keep the LAST duplicate key). */
  value: JsonValue | null;
  /**
   * Ranges always index the original text: a Markdown fence around the JSON
   * is skipped in place, never sliced off.
   */
  diagnostics: FigureDiagnostic[];
};

/* ────────────────────────────────────────────────────────────────────────
 * Labels: text with `$…$` maths and `\n` line breaks
 * ──────────────────────────────────────────────────────────────────────── */

export type LabelSegment = { kind: 'text'; value: string } | { kind: 'math'; value: string };

export type Label = {
  /** One entry per line; a line is a run of text and maths segments. */
  lines: LabelSegment[][];
  /** The label as written, for accessible names and TikZ. */
  source: string;
  hasMath: boolean;
};

/* ────────────────────────────────────────────────────────────────────────
 * The normalised model
 * ──────────────────────────────────────────────────────────────────────── */

export type Direction = 'down' | 'up' | 'right' | 'left';
export type Side = 'top' | 'bottom' | 'left' | 'right';
export type ContainerLayout = 'flow' | 'row' | 'column' | 'grid';
export type Align = 'start' | 'center' | 'end';

export type Tone =
  | 'neutral'
  | 'gray'
  | 'blue'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'red'
  | 'purple'
  | 'pink'
  | 'teal';

export type Shape =
  | 'box'
  | 'round'
  | 'circle'
  | 'op'
  | 'diamond'
  /** A trapezoid that narrows along the flow: a down-projection, an encoder. */
  | 'funnel'
  /** A trapezoid that widens along the flow: an up-projection, a decoder. */
  | 'expand'
  | 'cylinder'
  | 'document'
  | 'parallelogram'
  | 'hexagon'
  /** A bare label — inputs, outputs, annotations. */
  | 'text'
  /** A grid of cells: a vector, a matrix, an attention map, a token row. */
  | 'tensor'
  | 'image';

/** Vector glyph drawn inside an `op` circle; `null` draws the label text. */
export type OpGlyph = 'plus' | 'times' | 'dot' | 'concat' | 'minus' | null;

export type Border = 'solid' | 'dashed' | 'dotted' | 'bold' | 'none';
export type Pattern = 'none' | 'hatch' | 'dots';

export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type LineWeight = 'thin' | 'normal' | 'thick';
export type ArrowEnds = 'end' | 'start' | 'both' | 'none';
export type RouteStyle = 'ortho' | 'straight' | 'curved';
/**
 * What an edge means for layout.
 * - `flow`: ordinary data flow; ranks follow it.
 * - `residual` / `skip`: joins later in the flow, routed around the blocks it
 *   skips and entering its target from the side.
 * - `feedback`: goes back against the flow; ignored by ranking.
 */
export type EdgeKind = 'flow' | 'residual' | 'skip' | 'feedback';

export type TensorCells = {
  rows: number;
  cols: number;
  /** Per-cell text (token rows), row-major, `rows × cols`; null when unlabelled. */
  text: (string | null)[][] | null;
  /** Per-cell intensity 0..1 (heat maps), row-major; null when flat. */
  values: number[][] | null;
  /**
   * Cells drawn filled: a causal mask (`lower`), its complement (`upper`), a
   * diagonal, every cell, or none.
   */
  pattern: 'none' | 'full' | 'lower' | 'upper' | 'diagonal';
};

type ItemBase = {
  id: string;
  /** Id of the parent group; the root group is `ROOT_ID`. */
  parent: string;
  /** Declaration order across the whole spec — the tie-breaker everywhere. */
  order: number;
  /** JSON path of the item's definition, for diagnostics and the inspector. */
  path: string;
  /** Source range of the item's definition (an object or a shorthand string). */
  range?: [number, number];
};

export type NodeModel = ItemBase & {
  kind: 'node';
  label: Label;
  /** A smaller second line under the label: a tensor shape, a dimension. */
  sublabel: Label | null;
  shape: Shape;
  op: OpGlyph;
  tone: Tone;
  border: Border;
  pattern: Pattern;
  bold: boolean;
  italic: boolean;
  /** Copies drawn stacked behind the node (multi-head, experts); 1 = none. */
  stack: number;
  /** Small tag on the node's top-right corner, e.g. "cached", "frozen". */
  badge: string | null;
  /** Marker beside the node, e.g. "h" beside stacked heads. */
  repeat?: string | null;
  cells: TensorCells | null;
  /** Image source, `image` shape only: a base64 `data:image/…` URL draws; an http(s) URL is kept but never loaded. */
  src: string | null;
  /** Explicit size in px (clamped), overriding the measured size. */
  width: number | null;
  height: number | null;
  /** Layer hint inside a `flow` parent: an index, or the first/last layer. */
  rank: number | 'first' | 'last' | null;
  /** Same layer as another sibling, placed right next to it. */
  beside: { id: string; before: boolean } | null;
  /** Same layer as another sibling, wherever the ordering puts it. */
  sameRank: string | null;
};

export type GroupModel = ItemBase & {
  kind: 'group';
  label: Label | null;
  children: string[];
  layout: ContainerLayout;
  direction: Direction;
  /** Grid columns (`grid` only). */
  columns: number;
  align: Align;
  /** Gap between children in px; null picks the layout's default. */
  gap: number | null;
  tone: Tone;
  border: Border;
  /** Whether the group box is filled with its tone. */
  filled: boolean;
  /** Repetition marker drawn beside the group, e.g. "N×". */
  repeat: string | null;
  /** Sub-figure caption under the group, e.g. "(a) Encoder". */
  panel: string | null;
  /** Give every box-like child of a column/flow stack the same width. */
  uniform: boolean;
  labelPosition: 'top' | 'bottom';
  rank: NodeModel['rank'];
  beside: NodeModel['beside'];
  sameRank: NodeModel['sameRank'];
};

export type ItemModel = NodeModel | GroupModel;

export type EdgeModel = {
  id: string;
  from: string;
  to: string;
  fromSide: Side | null;
  toSide: Side | null;
  label: Label | null;
  line: LineStyle;
  weight: LineWeight;
  arrow: ArrowEnds;
  route: RouteStyle;
  kind: EdgeKind;
  /** Whether the edge orders layers in a `flow` container. */
  constraint: boolean;
  tone: Tone | null;
  order: number;
  path: string;
  range?: [number, number];
};

export type LegendItemModel = {
  label: Label;
  /** A node swatch (tone/shape/pattern/border) or an edge sample (line/arrow). */
  sample:
    | { kind: 'node'; tone: Tone; shape: Shape; pattern: Pattern; border: Border }
    | { kind: 'edge'; line: LineStyle; weight: LineWeight; tone: Tone | null };
};

/** Print width relative to the text column. `auto` = natural size, capped at 100%. */
export type FigureSize = 'auto' | 'small' | 'medium' | 'large' | 'full';

export type FigureModel = {
  title: string | null;
  caption: string | null;
  /** Cross-reference key, e.g. `fig:mla`. */
  label: string | null;
  alt: string | null;
  size: FigureSize;
  font: 'sans' | 'serif';
  palette: 'color' | 'mono';
  /** The implicit root group; its id is `ROOT_ID`. */
  root: GroupModel;
  /** Every node and group except the root, by id. */
  items: Map<string, ItemModel>;
  edges: EdgeModel[];
  legend: LegendItemModel[];
};

export const ROOT_ID = '__root__';

/* ────────────────────────────────────────────────────────────────────────
 * Measurement
 * ──────────────────────────────────────────────────────────────────────── */

export type FontSpec = {
  family: 'sans' | 'serif';
  /** px */
  size: number;
  weight: 400 | 500 | 600 | 700;
  italic: boolean;
};

export type Extent = {
  width: number;
  /** Total height of the run (ascent + descent). */
  height: number;
};

/**
 * Text and maths measurement. The DOM measurer uses canvas `measureText`
 * and a hidden KaTeX element; the heuristic one (tests, SSR, jsdom) uses a
 * per-character width table. Implementations cache internally.
 */
export interface TextMeasurer {
  /** Identifies the metrics source; part of every layout cache key. */
  readonly key: string;
  text(value: string, font: FontSpec): Extent;
  math(latex: string, font: FontSpec): Extent;
}

/* ────────────────────────────────────────────────────────────────────────
 * Geometry shared by layout, routing and rendering
 * ──────────────────────────────────────────────────────────────────────── */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** A measured label, positioned: `x`/`y` are the top-left of its box. */
export type LabelBox = Rect & {
  label: Label;
  font: FontSpec;
  align: 'left' | 'center' | 'right';
  /** Per-line boxes, top to bottom, relative to the label box. */
  lines: Array<{
    width: number;
    height: number;
    /** Per-segment widths, same order as `label.lines[i]`. */
    segments: number[];
  }>;
  /** Line height used for plain-text lines. */
  lineHeight: number;
};

/* ────────────────────────────────────────────────────────────────────────
 * Layout output (before routing)
 * ──────────────────────────────────────────────────────────────────────── */

export type SceneNode = {
  id: string;
  model: NodeModel;
  /** The front shape's box (what the outline is drawn around). */
  shape: Rect;
  /**
   * The box edges attach to: the shape, or shape + external label for
   * tensors and images, whose label sits underneath.
   */
  anchor: Rect;
  /** Everything the node paints: stacked copies, badge, external label. */
  bounds: Rect;
  /** Inside the shape, or under it for `tensor` and `image`. */
  label: LabelBox | null;
  sublabel: LabelBox | null;
  /** The `repeat` marker beside the node. */
  repeat: LabelBox | null;
  /** The corner tag; its box is the pill, its text centred in it. */
  badge: LabelBox | null;
  /** Offset of each stacked copy behind the front shape (px). */
  stackOffset: number;
  /** Flow direction of the parent: orients `funnel`/`expand`, guides ports. */
  direction: Direction;
  /** Nesting depth (root children are 1). */
  depth: number;
};

export type SceneGroup = {
  id: string;
  model: GroupModel;
  /** The drawn box. */
  box: Rect;
  /** Box plus repeat marker and panel caption. */
  bounds: Rect;
  label: LabelBox | null;
  repeat: LabelBox | null;
  panel: LabelBox | null;
  depth: number;
  /** Flow direction inside the group (for port choice). */
  direction: Direction;
};

export type FigureLayout = {
  width: number;
  height: number;
  nodes: SceneNode[];
  groups: SceneGroup[];
  legend: SceneLegend | null;
  /** Direction of the root container. */
  direction: Direction;
  diagnostics: FigureDiagnostic[];
};

export type SceneLegend = {
  box: Rect;
  items: Array<{ sample: LegendItemModel['sample']; swatch: Rect; label: LabelBox }>;
};

/* ────────────────────────────────────────────────────────────────────────
 * Routed scene
 * ──────────────────────────────────────────────────────────────────────── */

export type Arrowhead = {
  /** Where the tip touches the target outline. */
  tip: Point;
  /** Filled triangle, tip first. */
  polygon: Point[];
};

export type SceneEdge = {
  id: string;
  model: EdgeModel;
  /**
   * The polyline from the source outline to the target outline, arrow tips
   * included. Orthogonal routes alternate horizontal/vertical segments;
   * straight routes have two points; curved routes carry the four cubic
   * Bézier control points.
   */
  points: Point[];
  /** SVG path data for the stroke, already shortened under arrowheads. */
  d: string;
  start: Arrowhead | null;
  end: Arrowhead | null;
  label: LabelBox | null;
};

export type FigureScene = FigureLayout & {
  edges: SceneEdge[];
  /** Scale at which labels still print at ≥ 6.5pt in a 616px column. */
  legibleScale: number;
};

/* ────────────────────────────────────────────────────────────────────────
 * Compile result
 * ──────────────────────────────────────────────────────────────────────── */

export type CompiledFigure = {
  source: string;
  parse: ParseResult;
  model: FigureModel | null;
  scene: FigureScene | null;
  /** Parse + normalise + layout diagnostics, errors first. */
  diagnostics: FigureDiagnostic[];
  /** Whether anything fatal stopped the figure from drawing. */
  ok: boolean;
};
