import { describe, expect, it } from 'vitest';
import { formatCompact } from '../text';

describe('formatCompact', () => {
  it('keeps small numbers exact, thousands-separated', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(7)).toBe('7');
    expect(formatCompact(1284)).toBe('1,284');
    // The cutoff: five digits is where a number stops being read as a
    // quantity and starts being counted digit by digit.
    expect(formatCompact(9999)).toBe('9,999');
  });

  it('compacts at and above ten thousand', () => {
    expect(formatCompact(10_000)).toBe('10K');
    expect(formatCompact(12_900)).toBe('12.9K');
    expect(formatCompact(4_200_000)).toBe('4.2M');
    expect(formatCompact(3_000_000_000)).toBe('3B');
  });

  it('drops the decimal once the mantissa has three digits', () => {
    expect(formatCompact(154_000)).toBe('154K');
    expect(formatCompact(999_400)).toBe('999K');
  });

  it('does not leave a bare .0', () => {
    expect(formatCompact(34_000)).toBe('34K');
    expect(formatCompact(2_000_000)).toBe('2M');
  });

  it('handles negatives and non-finite input without producing junk', () => {
    expect(formatCompact(-12_900)).toBe('-12.9K');
    expect(formatCompact(Number.NaN)).toBe('0');
    expect(formatCompact(Number.POSITIVE_INFINITY)).toBe('0');
  });
});
