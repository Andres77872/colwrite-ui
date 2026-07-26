/**
 * Scale and palette helpers for the inline chart.
 *
 * Kept apart from the renderer because these are the parts worth testing:
 * axis rounding and colour assignment are where charts quietly start lying.
 */

/**
 * Categorical series colours, in fixed order.
 *
 * Read from CSS custom properties so the chart follows the theme rather than
 * hard-coding hexes the way the old widget did — its axis labels were literal
 * `rgba(255,255,255,0.6)`, which is invisible the moment the surface is light.
 * The order is fixed: a colour belongs to a category, so removing one series
 * must never repaint the rest.
 */
export const SERIES_VARS = [
  'var(--color-series-1)',
  'var(--color-series-2)',
  'var(--color-series-3)',
  'var(--color-series-4)',
  'var(--color-series-5)',
  'var(--color-series-6)',
  'var(--color-series-7)',
  'var(--color-series-8)',
] as const;

/** Part-to-whole stops reading at a glance past this many slices. */
export const MAX_PIE_SLICES = 6;

export function seriesColor(index: number, overrides?: string[]): string {
  const override = overrides?.[index];
  if (override && override.trim()) return override.trim();
  return SERIES_VARS[index % SERIES_VARS.length];
}

export type Tick = { value: number; label: string };

/** Round `value` to the nearest 1 / 2 / 5 × 10ⁿ — the steps people read as round. */
function niceStep(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimZeroes(value / 1_000_000)}M`;
  if (abs >= 10_000) return `${trimZeroes(value / 1000)}K`;
  if (abs >= 1000) return value.toLocaleString('en-US');
  if (Number.isInteger(value)) return String(value);
  return trimZeroes(value);
}

function trimZeroes(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * A y-axis with round tick values covering `values`.
 *
 * The bounds are snapped outward to the tick step so the top gridline is a
 * number worth reading, and zero is always included: a bar chart whose
 * baseline is not zero exaggerates every difference on it.
 */
export function linearScale(values: number[], targetTicks = 4): { min: number; max: number; ticks: Tick[] } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: 0, max: 1, ticks: [{ value: 0, label: '0' }] };

  let min = Math.min(0, ...finite);
  let max = Math.max(0, ...finite);
  if (min === max) max = min + 1;

  const step = niceStep((max - min) / Math.max(1, targetTicks));
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;

  const ticks: Tick[] = [];
  // Rounding guard: repeated addition of a fractional step drifts, and a tick
  // labelled "0.30000000000000004" is the classic symptom.
  for (let value = min; value <= max + step / 2; value += step) {
    const rounded = Number(value.toFixed(10));
    ticks.push({ value: rounded, label: formatNumber(rounded) });
  }

  return { min, max, ticks };
}

/** Slices of a pie, as fractions of the total. Non-positive values are dropped. */
export function pieSlices(values: number[]): Array<{ index: number; value: number; fraction: number }> {
  const positive = values.map((value, index) => ({ index, value: Math.max(0, value) }));
  const total = positive.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return [];
  return positive
    .filter((slice) => slice.value > 0)
    .map((slice) => ({ ...slice, fraction: slice.value / total }));
}

/** SVG path for one pie slice, drawn clockwise from `startAngle` (radians). */
export function arcPath(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  // A full circle has no arc endpoints to draw between, so it is emitted as
  // two half arcs; without this a single-slice pie renders as nothing.
  if (endAngle - startAngle >= Math.PI * 2 - 1e-6) {
    return [
      `M ${cx} ${cy - radius}`,
      `A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius}`,
      `A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius}`,
      'Z',
    ].join(' ');
  }

  const x1 = cx + radius * Math.cos(startAngle);
  const y1 = cy + radius * Math.sin(startAngle);
  const x2 = cx + radius * Math.cos(endAngle);
  const y2 = cy + radius * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}
