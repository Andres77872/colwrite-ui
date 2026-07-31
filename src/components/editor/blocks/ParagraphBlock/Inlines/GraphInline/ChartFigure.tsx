import { useMemo, useState } from 'react';
import type { GraphChild } from '@/editor';
import { cn } from '@/lib/utils';
import {
  MAX_PIE_SLICES,
  arcPath,
  formatNumber,
  linearScale,
  pieSlices,
  seriesColor,
} from './chartScale';

/**
 * The chart itself — plain SVG, no chart library.
 *
 * The previous widget waited on a Chart.js `<script defer>` from a CDN and
 * polled `window.Chart` forty times before giving up, so a figure in a
 * document was blank for up to six seconds and permanently blank offline. It
 * also drew its own fallback in hard-coded `rgba(255,255,255,…)`, which only
 * works on a dark surface.
 *
 * Everything here follows the theme's tokens and renders on the first frame.
 */

const PLOT = { width: 480, height: 260, top: 12, right: 16, bottom: 34, left: 44 };
/** Bars are capped rather than filling their slot: the leftover band is air. */
const MAX_BAR_WIDTH = 24;
const BAR_GAP = 2;

export type ChartFigureProps = {
  kind: GraphChild['kind'];
  values: number[];
  labels: string[];
  colors?: string[];
  title?: string;
  xLabel?: string;
  yLabel?: string;
  className?: string;
  /** Export uses the same SVG without hover hit targets or tooltips. */
  interactive?: boolean;
};

type Hover = { index: number; x: number; y: number } | null;
type PieSlice = ReturnType<typeof pieSlices>[number];

function positionPieSlices(slices: PieSlice[]) {
  let angle = -Math.PI / 2;
  return slices.map((slice) => {
    const start = angle;
    const end = angle + slice.fraction * Math.PI * 2;
    angle = end;
    return { ...slice, start, end };
  });
}

export function ChartFigure(props: ChartFigureProps) {
  const { kind, values, labels, className, interactive = true } = props;
  const [hover, setHover] = useState<Hover>(null);

  if (values.length === 0) {
    return (
      <div
        className={cn(
          'flex min-h-[8rem] items-center justify-center px-4 py-6 text-sm text-muted-foreground',
          className,
        )}
      >
        Add values to draw this chart.
      </div>
    );
  }

  const labelFor = (index: number) => labels[index] || `Item ${index + 1}`;

  return (
    <div className={cn('relative', className)}>
      {kind === 'pie' ? (
        <PieChart {...props} hover={hover} setHover={setHover} labelFor={labelFor} />
      ) : (
        <CartesianChart {...props} hover={hover} setHover={setHover} labelFor={labelFor} />
      )}

      {interactive && hover !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-md"
          style={{ left: `${hover.x}%`, top: `${hover.y}%` }}
        >
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ background: seriesColor(kind === 'pie' ? hover.index : 0, props.colors) }}
            />
            <span className="text-muted-foreground">{labelFor(hover.index)}</span>
            <span className="font-medium tabular-nums">{formatNumber(values[hover.index])}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------
   Bar / line / area
   ---------------------------------------- */

type InnerProps = ChartFigureProps & {
  hover: Hover;
  setHover: (hover: Hover) => void;
  labelFor: (index: number) => string;
};

function CartesianChart({ kind, values, colors, xLabel, yLabel, hover, setHover, labelFor, interactive = true }: InnerProps) {
  const { min, max, ticks } = useMemo(() => linearScale(values), [values]);
  const color = seriesColor(0, colors);

  const plotWidth = PLOT.width - PLOT.left - PLOT.right;
  const plotHeight = PLOT.height - PLOT.top - PLOT.bottom;
  const y = (value: number) => PLOT.top + plotHeight - ((value - min) / (max - min)) * plotHeight;
  const band = plotWidth / values.length;
  const centre = (index: number) => PLOT.left + band * (index + 0.5);

  // One value is direct-labelled — the largest. A number beside every mark is
  // chaos; the axis carries the rest.
  const peakIndex = values.reduce((best, value, index) => (value > values[best] ? index : best), 0);

  const linePoints = values.map((value, index) => `${centre(index)},${y(value)}`).join(' ');
  const areaPath =
    values.length > 1
      ? `M ${centre(0)},${y(min < 0 ? 0 : min)} L ${values
          .map((value, index) => `${centre(index)},${y(value)}`)
          .join(' L ')} L ${centre(values.length - 1)},${y(min < 0 ? 0 : min)} Z`
      : '';

  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(3, band - BAR_GAP * 2));
  const zeroY = y(0);

  // Category labels are dropped rather than overlapped once they cannot fit —
  // a row of colliding half-words says less than no row at all.
  const labelStride = Math.ceil(values.length / Math.floor(plotWidth / 48));

  return (
    <svg
      viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
      className="w-full"
      role="img"
      aria-label={`${kind} chart with ${values.length} values`}
      onMouseLeave={interactive ? () => setHover(null) : undefined}
    >
      {/* Gridlines: solid hairlines one step off the surface, never dashed. */}
      {ticks.map((tick) => (
        <line
          key={tick.value}
          x1={PLOT.left}
          x2={PLOT.width - PLOT.right}
          y1={y(tick.value)}
          y2={y(tick.value)}
          stroke="var(--color-chart-grid)"
          strokeWidth={1}
        />
      ))}

      {ticks.map((tick) => (
        <text
          key={`label-${tick.value}`}
          x={PLOT.left - 6}
          y={y(tick.value)}
          dy="0.32em"
          textAnchor="end"
          className="fill-muted-foreground"
          style={{ fontSize: 'var(--text-2xs)', fontVariantNumeric: 'tabular-nums' }}
        >
          {tick.label}
        </text>
      ))}

      {/* Zero rule sits above the grid so a chart with negatives reads right. */}
      <line
        x1={PLOT.left}
        x2={PLOT.width - PLOT.right}
        y1={zeroY}
        y2={zeroY}
        stroke="var(--color-chart-axis)"
        strokeWidth={1}
      />

      {kind === 'area' && areaPath && <path d={areaPath} fill={color} fillOpacity={0.1} />}

      {kind === 'bar'
        ? values.map((value, index) => (
            <path
              key={index}
              d={barPath(
                centre(index) - barWidth / 2,
                barWidth,
                y(Math.max(value, 0)),
                y(Math.min(value, 0)),
                Math.min(4, barWidth / 2),
                value >= 0,
              )}
              fill={seriesColor(0, colors)}
              opacity={hover && hover.index !== index ? 0.55 : 1}
            />
          ))
        : (
          <>
            <polyline
              points={linePoints}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {values.map((value, index) => (
              <circle
                key={index}
                cx={centre(index)}
                cy={y(value)}
                r={hover?.index === index ? 5 : 4}
                fill={color}
                // A 2px ring in the surface colour keeps markers legible where
                // they cross the line or each other.
                stroke="var(--color-card)"
                strokeWidth={2}
              />
            ))}
          </>
        )}

      {/* One direct label, on the peak. Held inside the plot: a value that
          lands on the top gridline would otherwise be drawn off the canvas. */}
      {values.length > 0 && (
        <text
          x={centre(peakIndex)}
          y={Math.max(9, y(values[peakIndex]) - (kind === 'bar' ? 6 : 10))}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: 'var(--text-2xs)', fontWeight: 600 }}
        >
          {formatNumber(values[peakIndex])}
        </text>
      )}

      {values.map((_, index) =>
        index % labelStride === 0 ? (
          <text
            key={`x-${index}`}
            x={centre(index)}
            y={PLOT.height - PLOT.bottom + 14}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 'var(--text-2xs)' }}
          >
            {truncate(labelFor(index), 10)}
          </text>
        ) : null,
      )}

      {xLabel && (
        <text
          x={PLOT.left + plotWidth / 2}
          y={PLOT.height - 2}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: 'var(--text-2xs)' }}
        >
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text
          transform={`translate(10 ${PLOT.top + plotHeight / 2}) rotate(-90)`}
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: 'var(--text-2xs)' }}
        >
          {yLabel}
        </text>
      )}

      {/* Hit targets are the full band, not the mark: a 2px-wide bar or a 4px
          dot is not something anyone can reliably point at. */}
      {interactive && values.map((_, index) => (
        <rect
          key={`hit-${index}`}
          x={PLOT.left + band * index}
          y={PLOT.top}
          width={band}
          height={plotHeight}
          fill="transparent"
          onMouseEnter={() =>
            setHover({
              index,
              x: (centre(index) / PLOT.width) * 100,
              y: (y(values[index]) / PLOT.height) * 100,
            })
          }
        />
      ))}
    </svg>
  );
}

/* ----------------------------------------
   Pie
   ---------------------------------------- */

function PieChart({ values, colors, labels, hover, setHover, labelFor, interactive = true }: InnerProps) {
  const slices = useMemo(() => pieSlices(values), [values]);
  const radius = 88;
  const cx = 110;
  const cy = PLOT.height / 2;

  if (slices.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        A pie needs at least one value above zero.
      </p>
    );
  }

  const drawn = positionPieSlices(slices);

  return (
    <div className="flex flex-wrap items-center gap-4 px-3 py-2">
      <svg
        viewBox={`0 0 ${cx * 2} ${PLOT.height}`}
        className="h-40 w-40 shrink-0"
        role="img"
        aria-label={`Pie chart with ${slices.length} slices`}
        onMouseLeave={interactive ? () => setHover(null) : undefined}
      >
        {drawn.map((slice) => (
          <path
            key={slice.index}
            d={arcPath(cx, cy, radius, slice.start, slice.end)}
            fill={seriesColor(slice.index, colors)}
            // The 2px surface gap does the separating, not a border.
            stroke="var(--color-card)"
            strokeWidth={2}
            opacity={hover && hover.index !== slice.index ? 0.55 : 1}
            onMouseEnter={interactive ? () => setHover({ index: slice.index, x: 50, y: 20 }) : undefined}
          />
        ))}
      </svg>

      {/* A legend is the dependable identity channel — never colour alone. */}
      <ul className="min-w-0 flex-1 space-y-1">
        {drawn.map((slice) => (
          <li key={slice.index} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: seriesColor(slice.index, colors) }}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {labelFor(slice.index)}
            </span>
            <span className="shrink-0 tabular-nums text-foreground">
              {Math.round(slice.fraction * 100)}%
            </span>
          </li>
        ))}
        {labels.length > MAX_PIE_SLICES && (
          <li className="text-xs text-muted-foreground">
            Part-to-whole stops reading past {MAX_PIE_SLICES} slices — a bar chart compares these
            better.
          </li>
        )}
      </ul>
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * A bar rounded-sm at the data end and square where it meets the baseline.
 *
 * A plain `<rect rx>` rounds all four corners, which lifts the bar off its own
 * baseline and makes short bars read as floating pills. The rounding belongs
 * only on the end that carries the value — and on the top for a positive bar,
 * the bottom for a negative one.
 */
function barPath(
  x: number,
  width: number,
  top: number,
  bottom: number,
  radius: number,
  pointsUp: boolean,
): string {
  const right = x + width;
  // Never round more than half the bar's own height, or a 3px bar becomes a
  // lens shape that no longer reads as a length.
  const r = Math.max(0, Math.min(radius, (bottom - top) / 2));

  if (pointsUp) {
    return [
      `M ${x} ${bottom}`,
      `L ${x} ${top + r}`,
      `Q ${x} ${top} ${x + r} ${top}`,
      `L ${right - r} ${top}`,
      `Q ${right} ${top} ${right} ${top + r}`,
      `L ${right} ${bottom}`,
      'Z',
    ].join(' ');
  }

  return [
    `M ${x} ${top}`,
    `L ${x} ${bottom - r}`,
    `Q ${x} ${bottom} ${x + r} ${bottom}`,
    `L ${right - r} ${bottom}`,
    `Q ${right} ${bottom} ${right} ${bottom - r}`,
    `L ${right} ${top}`,
    'Z',
  ].join(' ');
}
