import { Fragment, type CSSProperties, type JSX, type ReactNode } from 'react';
import {
  FIGURE_FONT_STACKS,
  FIGURE_MATH_CLASS,
  FIGURE_MATH_CSS,
  FIGURE_METRICS,
  figureFont,
} from '@/lib/figure/constants';
import { formatCoordinate as fmt, inflateRect, roundedRectPath, shapePath } from '@/lib/figure/geometry';
import { isEmptyLabel, parseLabel } from '@/lib/figure/labels';
import { figureMathHtml } from '@/lib/figure/math';
import { edgeColor, type FigurePalette, type ToneColors } from '@/lib/figure/palette';
import type {
  Border,
  FigureScene,
  FontSpec,
  Label,
  LabelBox,
  LabelSegment,
  LineStyle,
  LineWeight,
  OpGlyph,
  Pattern,
  Point,
  Rect,
  SceneEdge,
  SceneGroup,
  SceneLegend,
  SceneNode,
  TensorCells,
  Tone,
} from '@/lib/figure/types';

export type FigureItemKind = 'node' | 'group' | 'edge';

export type FigureSvgProps = {
  scene: FigureScene;
  palette: FigurePalette;
  /**
   * Prefix of every id inside the SVG (title, patterns, clip paths). Two
   * figures on one page must not share it, or one's `url(#…)` fills would
   * resolve to the other's definitions.
   */
  idPrefix: string;
  /** Accessible name; "Figure" when absent. */
  title?: string;
  /** Accessible description, e.g. the spec's `alt` or a generated one. */
  description?: string;
  className?: string;
  style?: CSSProperties;
  /** Item to outline as selected (screen only). */
  selectedId?: string | null;
  /** Makes nodes, groups and edges clickable and tags them `data-figure-id`. */
  onItemClick?: (id: string, kind: FigureItemKind) => void;
  /**
   * Paint the palette background behind the drawing. Downloads need it: a
   * transparent SVG with dark ink vanishes on a dark slide. On screen the
   * page shows through instead, so a figure sits flush in any card.
   */
  background?: boolean;
};

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** Node and group outline widths, px. Edges use `FIGURE_METRICS.edge`. */
const STROKE = 1;
const STROKE_BOLD = 1.8;
const STROKE_FINE = 0.8;
/** Width of the invisible stroke that makes a 1px edge easy to click. */
const EDGE_HIT_WIDTH = 10;
/** Halo behind edge labels, px of stroke (half of it shows around each glyph). */
const HALO_WIDTH = 3;
/** Distance of the selection outline from the item's bounds. */
const SELECTION_GAP = 3;

/** Two decimals: below a printer's resolution and keeps the markup small. */
function r2(value: number): number {
  return Math.round(value * 100) / 100 || 0;
}

/**
 * Ids end up inside `url(#…)` and CSS selectors; React's `useId` output
 * (`«r1»`, `:r1:`) is not safe there, so anything unusual becomes `_`.
 */
function safePrefix(prefix: string): string {
  const cleaned = prefix.replace(/[^A-Za-z0-9_-]/g, '_');
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `f${cleaned}`;
}

/**
 * Only inline images are drawn. A remote `src` would be fetched the moment
 * the figure renders — in a chat reply, a proposed change, a shared
 * document — with no click, telling its host who is reading and carrying
 * whatever the URL was built to leak; the export's CSP would block it anyway.
 * Checked here, not only in normalisation, because a scene can be hand-built.
 */
const INLINE_IMAGE_SRC = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i;

/** Placeholder note under a remote image's host, and its size in px. */
const REMOTE_IMAGE_NOTE = 'remote image not loaded';
const NOTE_SIZE = 8.5;

type Ctx = {
  palette: FigurePalette;
  prefix: string;
  family: FontSpec['family'];
  onItemClick?: FigureSvgProps['onItemClick'];
};

type StrokeProps = {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  strokeLinecap?: 'round';
};

function toneColors(palette: FigurePalette, tone: Tone | null | undefined): ToneColors {
  return (tone && palette.tones[tone]) || palette.tones.neutral;
}

/** Stroke attributes for a border style; null draws no outline. */
function borderStroke(border: Border, color: string): StrokeProps | null {
  switch (border) {
    case 'none':
      return null;
    case 'bold':
      return { stroke: color, strokeWidth: STROKE_BOLD };
    case 'dashed':
      return { stroke: color, strokeWidth: STROKE, strokeDasharray: '4 3' };
    case 'dotted':
      return { stroke: color, strokeWidth: STROKE, strokeDasharray: '1 2.5', strokeLinecap: 'round' };
    case 'solid':
    default:
      return { stroke: color, strokeWidth: STROKE };
  }
}

function edgeWidth(weight: LineWeight): number {
  const { stroke, strokeThin, strokeThick } = FIGURE_METRICS.edge;
  return weight === 'thin' ? strokeThin : weight === 'thick' ? strokeThick : stroke;
}

/** Edge stroke: dashes grow with the line so a thick dashed edge still reads as dashed. */
function lineStroke(line: LineStyle, weight: LineWeight, color: string): StrokeProps {
  const width = edgeWidth(weight);
  const k = Math.max(1, width / FIGURE_METRICS.edge.stroke);
  switch (line) {
    case 'dashed':
      return { stroke: color, strokeWidth: width, strokeDasharray: `${r2(4 * k)} ${r2(3 * k)}` };
    case 'dotted':
      return { stroke: color, strokeWidth: width, strokeDasharray: `1 ${r2(2.5 * k)}`, strokeLinecap: 'round' };
    case 'solid':
    default:
      return { stroke: color, strokeWidth: width };
  }
}

function patternId(prefix: string, pattern: Exclude<Pattern, 'none'>, tone: Tone): string {
  return `${prefix}-${pattern}-${tone}`;
}

function interactiveProps(ctx: Ctx, id: string, kind: FigureItemKind) {
  const { onItemClick } = ctx;
  if (!onItemClick) return {};
  return {
    'data-figure-id': id,
    'data-figure-kind': kind,
    style: { cursor: 'pointer' },
    onClick: () => onItemClick(id, kind),
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Labels
 * ──────────────────────────────────────────────────────────────────────── */

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  );
}

function lineHasMath(line: LabelSegment[]): boolean {
  return line.some((segment) => segment.kind === 'math');
}

function fontProps(font: FontSpec) {
  return {
    fontFamily: FIGURE_FONT_STACKS[font.family],
    fontSize: font.size,
    fontWeight: font.weight === 400 ? undefined : font.weight,
    fontStyle: font.italic ? 'italic' : undefined,
  };
}

/** Line heights and the top of the first line, so the text sits centred in its box. */
function lineLayout(box: LabelBox): { heights: number[]; top: number } {
  const heights = box.label.lines.map((_, i) => box.lines[i]?.height ?? box.lineHeight);
  const total = heights.reduce((sum, h) => sum + h, 0);
  // A label box is usually exactly its lines; a badge's box is the pill
  // around them, and this centres the text in it.
  return { heights, top: box.y + (box.height - total) / 2 };
}

/**
 * A plain label as SVG text: one `<tspan>` per line, baselines computed
 * rather than left to `dominant-baseline`, which PDF converters ignore.
 * `inherit` leaves font, fill and anchor to the parent `<g>`, for runs of
 * many small labels (tensor cells) that share them.
 */
function textLabel(box: LabelBox, color: string, halo: string | undefined, inherit = false): ReactNode {
  const { font, align } = box;
  const { heights, top } = lineLayout(box);
  const x = align === 'left' ? box.x : align === 'right' ? box.x + box.width : box.x + box.width / 2;
  let lineTop = top;
  const spans = box.label.lines.map((line, i) => {
    const baseline = lineTop + heights[i] / 2 + font.size * 0.35;
    lineTop += heights[i];
    const text = line.map((segment) => segment.value).join('');
    if (!text.trim()) return null;
    return (
      <tspan key={i} x={r2(x)} y={r2(baseline)}>
        {text}
      </tspan>
    );
  });
  if (inherit) return <text>{spans}</text>;
  return (
    <text
      {...fontProps(font)}
      fill={color}
      textAnchor={align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'}
      {...(halo
        ? { stroke: halo, strokeWidth: HALO_WIDTH, strokeLinejoin: 'round' as const, paintOrder: 'stroke' }
        : {})}
    >
      {spans}
    </text>
  );
}

/** One line of a maths label as XHTML: escaped text runs and KaTeX markup. */
function lineHtml(line: LabelSegment[]): string {
  return line
    .map((segment) => (segment.kind === 'math' ? figureMathHtml(segment.value).html : escapeHtml(segment.value)))
    .join('');
}

/**
 * A label with maths: KaTeX HTML in a `<foreignObject>`, one flex row per
 * line so each line is centred in the height the measurer gave it. The
 * inner span is one inline run, so text and maths share a baseline.
 */
function mathLabel(box: LabelBox, color: string, halo: string | undefined): ReactNode {
  const { font, align } = box;
  const { heights, top } = lineLayout(box);
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  return (
    <foreignObject
      x={r2(box.x - 1)}
      y={r2(top - 1)}
      width={r2(box.width + 2)}
      height={r2(heights.reduce((sum, h) => sum + h, 0) + 2)}
      style={{ overflow: 'visible' }}
    >
      <div
        {...{ xmlns: XHTML_NS }}
        className={FIGURE_MATH_CLASS}
        style={{
          padding: 1,
          fontFamily: FIGURE_FONT_STACKS[font.family],
          fontSize: `${font.size}px`,
          fontWeight: font.weight,
          fontStyle: font.italic ? 'italic' : 'normal',
          lineHeight: 1.2,
          color,
        }}
      >
        {box.label.lines.map((line, i) => (
          <div
            key={i}
            style={{ display: 'flex', alignItems: 'center', justifyContent: justify, height: `${r2(heights[i])}px` }}
          >
            <span
              style={{ whiteSpace: 'pre', ...(halo ? { backgroundColor: halo, borderRadius: 2 } : {}) }}
              dangerouslySetInnerHTML={{ __html: lineHtml(line) }}
            />
          </div>
        ))}
      </div>
    </foreignObject>
  );
}

function renderLabel(box: LabelBox | null, color: string, halo?: string): ReactNode {
  if (!box || box.label.lines.length === 0) return null;
  return box.label.lines.some(lineHasMath) ? mathLabel(box, color, halo) : textLabel(box, color, halo);
}

/**
 * A label filling `rect`, centred, for text layout never measured into a
 * box (tensor cells, image notes). Lines take the plain line height; tall
 * maths overflows its row evenly, which the measured cell size allows for.
 */
function fitBox(label: Label, rect: Rect, font: FontSpec): LabelBox {
  return { ...rect, label, font, align: 'center', lines: [], lineHeight: font.size * FIGURE_METRICS.lineHeight };
}

/* ────────────────────────────────────────────────────────────────────────
 * Shapes
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A filled, optionally patterned and outlined path. With a pattern the fill,
 * the hatching and the outline are three layers, so the hatching never paints
 * over the inner half of the stroke.
 */
function filledPath(
  key: string,
  d: string,
  fill: string,
  stroke: StrokeProps | null,
  pattern: string | null,
): ReactNode {
  if (!pattern) {
    return <path key={key} d={d} fill={fill} {...(stroke ?? { stroke: 'none' })} strokeLinejoin="round" />;
  }
  return (
    <g key={key}>
      <path d={d} fill={fill} stroke="none" />
      <path d={d} fill={`url(#${pattern})`} stroke="none" />
      {stroke && <path d={d} fill="none" {...stroke} strokeLinejoin="round" />}
    </g>
  );
}

function translate(rect: Rect, dx: number, dy: number): Rect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

/**
 * Operator glyphs as strokes sized to the circle: ⊕ and ⊖ reach the
 * outline, ⊗ meets it on the diagonals, as in the papers' figures.
 */
function opGlyph(glyph: Exclude<OpGlyph, null>, rect: Rect, stroke: StrokeProps): ReactNode {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  const line = { ...stroke, strokeDasharray: undefined, fill: 'none', strokeLinecap: 'butt' as const };
  switch (glyph) {
    case 'plus':
      return <path d={`M${fmt(cx - rx)} ${fmt(cy)}H${fmt(cx + rx)}M${fmt(cx)} ${fmt(cy - ry)}V${fmt(cy + ry)}`} {...line} />;
    case 'minus':
      return <path d={`M${fmt(cx - rx)} ${fmt(cy)}H${fmt(cx + rx)}`} {...line} />;
    case 'times': {
      const dx = rx * Math.SQRT1_2;
      const dy = ry * Math.SQRT1_2;
      return (
        <path
          d={`M${fmt(cx - dx)} ${fmt(cy - dy)}L${fmt(cx + dx)} ${fmt(cy + dy)}M${fmt(cx + dx)} ${fmt(cy - dy)}L${fmt(cx - dx)} ${fmt(cy + dy)}`}
          {...line}
        />
      );
    }
    case 'dot':
      return <circle cx={r2(cx)} cy={r2(cy)} r={r2(Math.min(rx, ry) * 0.22)} fill={stroke.stroke} />;
    case 'concat': {
      const gap = rx * 0.2;
      const h = ry * 0.5;
      return (
        <path
          d={`M${fmt(cx - gap)} ${fmt(cy - h)}V${fmt(cy + h)}M${fmt(cx + gap)} ${fmt(cy - h)}V${fmt(cy + h)}`}
          {...line}
        />
      );
    }
  }
}

/** Whether a tensor cell belongs to the mask. `upper` is the causal mask's complement. */
function inMask(pattern: TensorCells['pattern'], row: number, col: number): boolean {
  switch (pattern) {
    case 'full':
      return true;
    case 'lower':
      return col <= row;
    case 'upper':
      return col > row;
    case 'diagonal':
      return col === row;
    case 'none':
    default:
      return false;
  }
}

function tensorBody(node: SceneNode, colors: ToneColors, ctx: Ctx, background: string): ReactNode {
  const cells = node.model.cells ?? { rows: 1, cols: 1, text: null, values: null, pattern: 'none' as const };
  const rows = Math.max(1, cells.rows);
  const cols = Math.max(1, cells.cols);
  const { x, y, width, height } = node.shape;
  const cw = width / cols;
  const ch = height / rows;
  const fill = node.model.tone === 'neutral' ? background : colors.fill;

  // Filled cells: the mask decides which, `values` how strongly. Values
  // alone shade every cell; a mask alone fills its cells solid.
  const shaded: ReactNode[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const member = cells.pattern === 'none' ? cells.values !== null : inMask(cells.pattern, row, col);
      if (!member) continue;
      const raw = cells.values ? (cells.values[row]?.[col] ?? 0) : 1;
      const opacity = r2(Math.min(1, Math.max(0, Number.isFinite(raw) ? raw : 0)));
      if (opacity <= 0) continue;
      shaded.push(
        <rect
          key={`${row}:${col}`}
          x={r2(x + col * cw)}
          y={r2(y + row * ch)}
          width={r2(cw)}
          height={r2(ch)}
          fill={colors.cell}
          fillOpacity={opacity < 1 ? opacity : undefined}
        />,
      );
    }
  }

  let grid = '';
  for (let col = 1; col < cols; col += 1) grid += `M${fmt(x + col * cw)} ${fmt(y)}V${fmt(y + height)}`;
  for (let row = 1; row < rows; row += 1) grid += `M${fmt(x)} ${fmt(y + row * ch)}H${fmt(x + width)}`;
  // Thin, half-strength rules: the grid should read as structure, not ink.
  const gridWidth = Math.min(cw, ch) < 6 ? 0.4 : 0.6;

  // Cell text is parsed like any label — `$…$` maths, `\n` breaks, collapsed
  // spaces — because that is how layout measured the cells; drawing the raw
  // string would put "$x_p^1$" into a cell sized for typeset x_p^1.
  const font = figureFont(ctx.family, FIGURE_METRICS.font.cell);
  const texts: ReactNode[] = [];
  const maths: ReactNode[] = [];
  cells.text?.forEach((cellRow, row) =>
    cellRow.forEach((value, col) => {
      if (!value || row >= rows || col >= cols) return;
      const label = parseLabel(value);
      if (isEmptyLabel(label)) return;
      const box = fitBox(label, { x: x + col * cw, y: y + row * ch, width: cw, height: ch }, font);
      const key = `${row}:${col}`;
      if (label.lines.some(lineHasMath)) maths.push(<Fragment key={key}>{mathLabel(box, colors.text, undefined)}</Fragment>);
      else texts.push(<Fragment key={key}>{textLabel(box, colors.text, undefined, true)}</Fragment>);
    }),
  );

  const border = borderStroke(node.model.border, colors.stroke);
  return (
    <>
      <rect x={r2(x)} y={r2(y)} width={r2(width)} height={r2(height)} fill={fill} />
      {shaded}
      {grid && <path d={grid} fill="none" stroke={colors.stroke} strokeOpacity={0.45} strokeWidth={gridWidth} />}
      {texts.length > 0 && (
        <g fontFamily={FIGURE_FONT_STACKS[ctx.family]} fontSize={font.size} fill={colors.text} textAnchor="middle">
          {texts}
        </g>
      )}
      {maths}
      {border && <rect x={r2(x)} y={r2(y)} width={r2(width)} height={r2(height)} fill="none" {...border} />}
    </>
  );
}

/**
 * The host of a remote image source, for its placeholder, cut from the left
 * to `maxChars` so the registrable end ("…evil.example") stays readable.
 * Only the host: the path and query are what a leaking URL would carry.
 */
function remoteHost(src: string | null, maxChars: number): string | null {
  if (!src || !/^https?:\/\//i.test(src)) return null;
  let host: string;
  try {
    host = new URL(src).host;
  } catch {
    return null;
  }
  if (!host) return null;
  return host.length > maxChars ? `…${host.slice(host.length - Math.max(1, maxChars - 1))}` : host;
}

function imageBody(node: SceneNode, colors: ToneColors, ctx: Ctx, index: number): ReactNode {
  const { x, y, width, height } = node.shape;
  const rect = { x: r2(x), y: r2(y), width: r2(width), height: r2(height) };
  const src = node.model.src && INLINE_IMAGE_SRC.test(node.model.src) ? node.model.src : null;
  // Roughly the characters of NOTE_SIZE sans that fit across the box.
  const host = src ? null : remoteHost(node.model.src, Math.floor((width - 6) / (NOTE_SIZE * 0.55)));
  const clipId = `${ctx.prefix}-clip-${index}`;
  const border = borderStroke(node.model.border, colors.stroke);
  const note = host
    ? fitBox(
        { lines: [[{ kind: 'text', value: host }], [{ kind: 'text', value: REMOTE_IMAGE_NOTE }]], source: '', hasMath: false },
        node.shape,
        figureFont(ctx.family, NOTE_SIZE),
      )
    : null;
  const clip = (
    <clipPath id={clipId}>
      <rect {...rect} />
    </clipPath>
  );
  return (
    <>
      {src ? (
        <>
          {clip}
          <image href={src} {...rect} preserveAspectRatio="xMidYMid meet" clipPath={`url(#${clipId})`} />
        </>
      ) : (
        <>
          <rect {...rect} fill={ctx.palette.placeholder} />
          <path
            d={`M${fmt(x)} ${fmt(y)}L${fmt(x + width)} ${fmt(y + height)}M${fmt(x + width)} ${fmt(y)}L${fmt(x)} ${fmt(y + height)}`}
            fill="none"
            stroke={ctx.palette.muted}
            strokeOpacity={0.5}
            strokeWidth={STROKE_FINE}
          />
          {/* Says why there is no picture; clipped, since a small image box cannot fit it. */}
          {note && (
            <>
              {clip}
              <g clipPath={`url(#${clipId})`}>{textLabel(note, ctx.palette.muted, ctx.palette.placeholder)}</g>
            </>
          )}
        </>
      )}
      {border && <rect {...rect} fill="none" {...border} strokeWidth={Math.min(border.strokeWidth, STROKE_FINE)} />}
    </>
  );
}

function renderNode(node: SceneNode, index: number, ctx: Ctx): ReactNode {
  const { palette } = ctx;
  const { model } = node;
  const colors = toneColors(palette, model.tone);
  const stroke = borderStroke(model.border, colors.stroke);
  const pattern =
    model.pattern !== 'none' && model.shape !== 'image' && model.shape !== 'tensor'
      ? patternId(ctx.prefix, model.pattern, model.tone)
      : null;
  // A bare label paints nothing unless it was given a tone or a border; when
  // clickable it still needs a surface to catch the pointer.
  const bare = model.shape === 'text' && model.tone === 'neutral';
  const fill = bare ? (ctx.onItemClick ? 'transparent' : 'none') : colors.fill;

  // Stacked copies, back to front, each offset up and to the right. They
  // are opaque and always outlined, or the stack would merge into one shape.
  const copies: ReactNode[] = [];
  for (let k = Math.min(8, Math.floor(model.stack)) - 1; k >= 1; k -= 1) {
    const rect = translate(node.shape, k * node.stackOffset, -k * node.stackOffset);
    copies.push(
      filledPath(
        `copy-${k}`,
        shapePath(model.shape, rect, node.direction).d,
        bare ? palette.background : colors.fill,
        stroke ?? { stroke: colors.stroke, strokeWidth: STROKE },
        pattern,
      ),
    );
  }

  let body: ReactNode;
  if (model.shape === 'tensor') {
    body = tensorBody(node, colors, ctx, palette.background);
  } else if (model.shape === 'image') {
    body = imageBody(node, colors, ctx, index);
  } else {
    const { d, detail } = shapePath(model.shape, node.shape, node.direction);
    body = (
      <>
        {filledPath('shape', d, fill, stroke, pattern)}
        {detail && stroke && <path d={detail} fill="none" {...stroke} />}
      </>
    );
  }

  const glyph = model.shape === 'op' && model.op ? opGlyph(model.op, node.shape, stroke ?? { stroke: colors.stroke, strokeWidth: STROKE }) : null;
  // Labels under a tensor or an image sit on the page, not on the tone.
  const labelColor = model.shape === 'tensor' || model.shape === 'image' ? palette.ink : colors.text;

  const badge = node.badge;
  return (
    <g key={`node:${node.id}`} {...interactiveProps(ctx, node.id, 'node')}>
      {copies}
      {body}
      {glyph ?? renderLabel(node.label, labelColor)}
      {renderLabel(node.sublabel, palette.muted)}
      {badge && (
        <>
          <rect
            x={r2(badge.x)}
            y={r2(badge.y)}
            width={r2(badge.width)}
            height={r2(badge.height)}
            rx={r2(badge.height / 2)}
            fill={palette.background}
            stroke={colors.stroke}
            strokeWidth={STROKE_FINE}
          />
          {renderLabel(badge, colors.stroke)}
        </>
      )}
      {renderLabel(node.repeat, palette.ink)}
    </g>
  );
}

function renderGroup(group: SceneGroup, ctx: Ctx): ReactNode {
  const { palette } = ctx;
  const { model } = group;
  const colors = toneColors(palette, model.tone);
  const stroke = borderStroke(model.border, colors.groupStroke);
  // Clicks on the empty part of a group select the group; its children are
  // drawn later, on top, and catch their own.
  const fill = model.filled ? colors.groupFill : ctx.onItemClick ? 'transparent' : 'none';
  return (
    <g key={`group:${group.id}`} {...interactiveProps(ctx, group.id, 'group')}>
      <path d={roundedRectPath(group.box, FIGURE_METRICS.group.radius)} fill={fill} {...(stroke ?? { stroke: 'none' })} />
      {renderLabel(group.label, palette.ink)}
      {renderLabel(group.repeat, palette.ink)}
      {renderLabel(group.panel, palette.ink)}
    </g>
  );
}

function pointsAttr(points: Point[]): string {
  return points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
}

function renderEdge(edge: SceneEdge, ctx: Ctx): ReactNode {
  const { model } = edge;
  const color = edgeColor(ctx.palette, model.tone);
  const stroke = lineStroke(model.line, model.weight, color);
  return (
    <g key={`edge:${edge.id}`} {...interactiveProps(ctx, edge.id, 'edge')}>
      {ctx.onItemClick && <path d={edge.d} fill="none" stroke="transparent" strokeWidth={EDGE_HIT_WIDTH} />}
      <path d={edge.d} fill="none" {...stroke} strokeLinejoin="round" />
      {edge.start && <polygon points={pointsAttr(edge.start.polygon)} fill={color} />}
      {edge.end && <polygon points={pointsAttr(edge.end.polygon)} fill={color} />}
    </g>
  );
}

function renderEdgeLabel(edge: SceneEdge, ctx: Ctx): ReactNode {
  if (!edge.label) return null;
  const { palette } = ctx;
  const color = edge.model.tone && edge.model.tone !== 'neutral' ? edgeColor(palette, edge.model.tone) : palette.ink;
  return (
    <g key={`label:${edge.id}`} {...interactiveProps(ctx, edge.id, 'edge')}>
      {renderLabel(edge.label, color, palette.halo)}
    </g>
  );
}

function renderLegend(legend: SceneLegend, ctx: Ctx): ReactNode {
  const { palette } = ctx;
  return legend.items.map((item, i) => {
    const { sample, swatch } = item;
    let mark: ReactNode;
    if (sample.kind === 'node') {
      const colors = toneColors(palette, sample.tone);
      // A bare-text, tensor or image swatch would be invisible or noisy at
      // 18×11: those show as a plain box in their tone.
      const shape =
        sample.shape === 'text' || sample.shape === 'tensor' || sample.shape === 'image' ? 'box' : sample.shape;
      const pattern = sample.pattern !== 'none' ? patternId(ctx.prefix, sample.pattern, sample.tone) : null;
      mark = filledPath(
        'swatch',
        shapePath(shape, swatch, 'down').d,
        colors.fill,
        borderStroke(sample.border, colors.stroke),
        pattern,
      );
    } else {
      const y = swatch.y + swatch.height / 2;
      mark = (
        <path
          d={`M${fmt(swatch.x)} ${fmt(y)}H${fmt(swatch.x + swatch.width)}`}
          fill="none"
          {...lineStroke(sample.line, sample.weight, edgeColor(palette, sample.tone))}
        />
      );
    }
    return (
      <g key={`legend:${i}`}>
        {mark}
        {renderLabel(item.label, palette.ink)}
      </g>
    );
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * Defs and selection
 * ──────────────────────────────────────────────────────────────────────── */

/** Only the pattern/tone pairs the scene uses, so a plain figure carries no defs. */
function usedPatterns(scene: FigureScene): Array<[Exclude<Pattern, 'none'>, Tone]> {
  const seen = new Map<string, [Exclude<Pattern, 'none'>, Tone]>();
  const add = (pattern: Pattern, tone: Tone) => {
    if (pattern !== 'none') seen.set(`${pattern}-${tone}`, [pattern, tone]);
  };
  for (const node of scene.nodes) {
    if (node.model.shape !== 'image' && node.model.shape !== 'tensor') add(node.model.pattern, node.model.tone);
  }
  for (const item of scene.legend?.items ?? []) {
    if (item.sample.kind === 'node') add(item.sample.pattern, item.sample.tone);
  }
  return [...seen.values()].sort(([p1, t1], [p2, t2]) => `${p1}-${t1}`.localeCompare(`${p2}-${t2}`));
}

function patternDef(prefix: string, pattern: Exclude<Pattern, 'none'>, tone: Tone, palette: FigurePalette): ReactNode {
  const color = toneColors(palette, tone).stroke;
  const id = patternId(prefix, pattern, tone);
  if (pattern === 'hatch') {
    // Vertical rules turned 45°: "/" hatching, TikZ's `north east lines`.
    return (
      <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(45)">
        <path d="M2.5 0V5" stroke={color} strokeOpacity={0.55} strokeWidth={0.7} />
      </pattern>
    );
  }
  return (
    <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={4} height={4}>
      <circle cx={2} cy={2} r={0.75} fill={color} fillOpacity={0.6} />
    </pattern>
  );
}

function edgeBounds(edge: SceneEdge): Rect | null {
  const points = [...edge.points, ...(edge.start?.polygon ?? []), ...(edge.end?.polygon ?? [])];
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function selectionBounds(scene: FigureScene, id: string): Rect | null {
  const node = scene.nodes.find((n) => n.id === id);
  if (node) return node.bounds;
  const group = scene.groups.find((g) => g.id === id);
  if (group) return group.bounds;
  const edge = scene.edges.find((e) => e.id === id);
  return edge ? edgeBounds(edge) : null;
}

/** The figure's font family, read off any label (the scene does not carry it separately). */
function sceneFamily(scene: FigureScene): FontSpec['family'] {
  const boxes: Array<LabelBox | null> = [
    ...scene.nodes.flatMap((n) => [n.label, n.sublabel]),
    ...scene.groups.flatMap((g) => [g.label, g.panel]),
    ...scene.edges.map((e) => e.label),
    ...(scene.legend?.items.map((item) => item.label) ?? []),
  ];
  return boxes.find((box) => box !== null)?.font.family ?? 'sans';
}

/**
 * A routed figure as SVG.
 *
 * Pure: no hooks, no DOM reads, so the editor, the review cards, the chat
 * and the static export (`renderToStaticMarkup`) draw the same markup.
 * Arrowheads, hatching and operator glyphs are plain geometry rather than
 * `<marker>`s or fonts, so every SVG consumer and PDF converter reproduces
 * them. Maths labels are KaTeX HTML in `<foreignObject>`s, sized by the same
 * `FIGURE_MATH_CSS` the measurer used.
 *
 * Paint order: groups (outer first) → edges → nodes → edge labels (haloed,
 * so they stay readable where a line passes) → legend → selection.
 */
export function FigureSvg({
  scene,
  palette,
  idPrefix,
  title,
  description,
  className,
  style,
  selectedId,
  onItemClick,
  background = false,
}: FigureSvgProps): JSX.Element {
  const prefix = safePrefix(idPrefix);
  const ctx: Ctx = { palette, prefix, family: sceneFamily(scene), onItemClick };
  const titleId = `${prefix}-title`;
  const descId = `${prefix}-desc`;
  const width = r2(scene.width);
  const height = r2(scene.height);

  const groups = scene.groups
    .map((group, order) => ({ group, order }))
    .sort((a, b) => a.group.depth - b.group.depth || a.order - b.order);
  const selection = selectedId ? selectionBounds(scene, selectedId) : null;
  const outline = selection ? inflateRect(selection, SELECTION_GAP) : null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-labelledby={description ? `${titleId} ${descId}` : titleId}
      className={className}
      style={style}
      fontFamily={FIGURE_FONT_STACKS[ctx.family]}
    >
      <title id={titleId}>{title?.trim() || 'Figure'}</title>
      {description && <desc id={descId}>{description}</desc>}
      <defs>
        <style>{FIGURE_MATH_CSS}</style>
        {usedPatterns(scene).map(([pattern, tone]) => patternDef(prefix, pattern, tone, palette))}
      </defs>
      {background && <rect width={width} height={height} fill={palette.background} />}
      <g>{groups.map(({ group }) => renderGroup(group, ctx))}</g>
      <g>{scene.edges.map((edge) => renderEdge(edge, ctx))}</g>
      <g>{scene.nodes.map((node, index) => renderNode(node, index, ctx))}</g>
      <g>{scene.edges.map((edge) => renderEdgeLabel(edge, ctx))}</g>
      {scene.legend && <g>{renderLegend(scene.legend, ctx)}</g>}
      {outline && (
        <rect
          data-figure-selection=""
          x={r2(outline.x)}
          y={r2(outline.y)}
          width={r2(outline.width)}
          height={r2(outline.height)}
          rx={4}
          fill="none"
          stroke={palette.highlight}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
