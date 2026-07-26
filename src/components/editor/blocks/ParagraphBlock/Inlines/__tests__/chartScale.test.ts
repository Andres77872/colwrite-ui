import { describe, it, expect } from 'vitest';
import {
  arcPath,
  formatNumber,
  linearScale,
  pieSlices,
  seriesColor,
} from '../GraphInline/chartScale';

describe('linearScale', () => {
  it('always includes zero, so bar length stays proportional to value', () => {
    // A baseline that is not zero exaggerates every difference on the chart.
    const { min } = linearScale([100, 110, 120]);
    expect(min).toBe(0);
  });

  it('snaps the bounds outward to round numbers', () => {
    const { max, ticks } = linearScale([0, 37]);
    expect(max % 10).toBe(0);
    expect(ticks.every((tick) => Number.isInteger(tick.value))).toBe(true);
  });

  it('spans negative values below the zero line', () => {
    const { min, max } = linearScale([-30, 40]);
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(0);
  });

  it('produces a usable axis for a single value', () => {
    const { min, max, ticks } = linearScale([5]);
    expect(min).toBe(0);
    expect(max).toBeGreaterThan(0);
    expect(ticks.length).toBeGreaterThan(1);
  });

  it('survives all-zero data', () => {
    const { min, max } = linearScale([0, 0]);
    expect(max).toBeGreaterThan(min);
  });

  it('ignores non-finite values instead of producing NaN ticks', () => {
    const { ticks } = linearScale([1, Number.NaN, Number.POSITIVE_INFINITY, 9]);
    expect(ticks.every((tick) => Number.isFinite(tick.value))).toBe(true);
  });

  it('does not emit floating-point noise in tick labels', () => {
    const { ticks } = linearScale([0, 0.3]);
    expect(ticks.every((tick) => !tick.label.includes('0000'))).toBe(true);
  });

  it('handles empty data', () => {
    expect(linearScale([]).ticks).toHaveLength(1);
  });
});

describe('formatNumber', () => {
  it('keeps small numbers exact', () => {
    expect(formatNumber(42)).toBe('42');
    expect(formatNumber(3.5)).toBe('3.5');
  });

  it('compacts large numbers', () => {
    expect(formatNumber(12_000)).toBe('12K');
    expect(formatNumber(2_500_000)).toBe('2.5M');
  });

  it('groups thousands rather than compacting too early', () => {
    expect(formatNumber(1500)).toBe('1,500');
  });

  it('trims trailing zeroes', () => {
    expect(formatNumber(2.0)).toBe('2');
  });
});

describe('seriesColor', () => {
  it('assigns hues in fixed order', () => {
    // A colour belongs to a category: removing one series must never repaint
    // the survivors.
    expect(seriesColor(0)).not.toBe(seriesColor(1));
    expect(seriesColor(0)).toBe(seriesColor(0));
  });

  it('wraps rather than generating a ninth hue', () => {
    expect(seriesColor(8)).toBe(seriesColor(0));
  });

  it('honours an explicit override', () => {
    expect(seriesColor(0, ['#123456'])).toBe('#123456');
  });

  it('ignores a blank override', () => {
    expect(seriesColor(0, ['  '])).toBe(seriesColor(0));
  });
});

describe('pieSlices', () => {
  it('turns values into fractions of the total', () => {
    const slices = pieSlices([1, 3]);
    expect(slices.map((slice) => slice.fraction)).toEqual([0.25, 0.75]);
  });

  it('drops non-positive values, keeping the original index for colour', () => {
    const slices = pieSlices([5, 0, -2, 5]);
    expect(slices.map((slice) => slice.index)).toEqual([0, 3]);
  });

  it('returns nothing when there is no positive total', () => {
    expect(pieSlices([0, -1])).toEqual([]);
  });
});

describe('arcPath', () => {
  it('draws a wedge', () => {
    expect(arcPath(0, 0, 10, 0, Math.PI / 2)).toMatch(/^M 0 0 L /);
  });

  it('draws a full circle as two arcs', () => {
    // A single-slice pie has no arc endpoints to draw between; without this it
    // renders as nothing at all.
    const path = arcPath(0, 0, 10, 0, Math.PI * 2);
    expect(path.match(/A /g)).toHaveLength(2);
  });
});
