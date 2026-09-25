import { describe, expect, it } from 'vitest';
import { edgeColor, figurePalette, toneHex, type FigurePalette } from '../palette';
import type { Tone } from '../types';

const TONES: Tone[] = ['neutral', 'gray', 'blue', 'orange', 'yellow', 'green', 'red', 'purple', 'pink', 'teal'];
const HUED: Tone[] = TONES.filter((tone) => tone !== 'neutral');
const CHROMATIC: Tone[] = HUED.filter((tone) => tone !== 'gray');
const PALETTES: FigurePalette[] = [
  figurePalette('light', 'color'),
  figurePalette('light', 'mono'),
  figurePalette('dark', 'color'),
  figurePalette('dark', 'mono'),
];
const LIGHT = PALETTES.slice(0, 2);
const DARK = PALETTES.slice(2);

/* sRGB → relative luminance (WCAG 2) and CIELAB (D65), for the checks below. */

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function lab(hex: string): { L: number; C: number; h: number } {
  const [r, g, b] = channels(hex).map(linear);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const A = 500 * (f(X) - f(Y));
  const B = 200 * (f(Y) - f(Z));
  return { L: 116 * f(Y) - 16, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function pairs<T>(items: T[]): Array<[T, T]> {
  return items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b] as [T, T]));
}

describe('figurePalette', () => {
  it('returns one frozen, shared palette per theme and variant', () => {
    expect(figurePalette('light', 'color')).toBe(figurePalette('light', 'color'));
    expect(figurePalette('light', 'color')).not.toBe(figurePalette('light', 'mono'));
    expect(PALETTES.map((p) => p.id)).toEqual(['light-color', 'light-mono', 'dark-color', 'dark-mono']);
    for (const palette of PALETTES) {
      expect(Object.isFrozen(palette)).toBe(true);
      expect(Object.isFrozen(palette.tones)).toBe(true);
      expect(Object.isFrozen(palette.tones.blue)).toBe(true);
    }
  });

  it('defines every tone with six-digit hex colours', () => {
    for (const palette of PALETTES) {
      expect(Object.keys(palette.tones).sort()).toEqual([...TONES].sort());
      const { tones, id: _id, ...base } = palette;
      for (const value of Object.values(base)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
      for (const tone of TONES) {
        for (const value of Object.values(tones[tone])) expect(value, `${palette.id} ${tone}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('draws neutral as the background with an ink outline, and halos in the background', () => {
    for (const palette of PALETTES) {
      expect(palette.tones.neutral.fill).toBe(palette.background);
      expect(palette.tones.neutral.stroke).toBe(palette.ink);
      expect(palette.tones.neutral.text).toBe(palette.ink);
      expect(palette.halo).toBe(palette.background);
    }
  });

  it('uses the agreed ink and mono strokes', () => {
    expect(figurePalette('light', 'color').ink).toBe('#1f2328');
    for (const tone of HUED) expect(figurePalette('light', 'mono').tones[tone].stroke).toBe('#2b2b2b');
    expect(figurePalette('light', 'color').background).toBe('#ffffff');
  });
});

describe('legibility', () => {
  it('keeps label text at ≥ 7:1 on every fill (WCAG AAA)', () => {
    for (const palette of PALETTES) {
      for (const tone of TONES) {
        const { text, fill } = palette.tones[tone];
        expect(contrast(text, fill), `${palette.id} ${tone}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('keeps sublabels at ≥ 4.5:1 on every fill', () => {
    for (const palette of PALETTES) {
      for (const tone of TONES) {
        expect(contrast(palette.muted, palette.tones[tone].fill), `${palette.id} ${tone}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps an image placeholder\'s note at ≥ 4.5:1 on its fill', () => {
    for (const palette of PALETTES) {
      expect(contrast(palette.muted, palette.placeholder), palette.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps cell text at ≥ 4.5:1 on a filled tensor cell', () => {
    for (const palette of PALETTES) {
      for (const tone of TONES) {
        const { text, cell } = palette.tones[tone];
        expect(contrast(text, cell), `${palette.id} ${tone}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('separates an outline from its fill (≥ 3:1, WCAG non-text)', () => {
    for (const palette of PALETTES) {
      for (const tone of HUED) {
        const { stroke, fill } = palette.tones[tone];
        expect(contrast(stroke, fill), `${palette.id} ${tone}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps edges, labels and group borders visible on the background', () => {
    for (const palette of PALETTES) {
      expect(contrast(palette.edge, palette.background)).toBeGreaterThanOrEqual(7);
      expect(contrast(palette.ink, palette.background)).toBeGreaterThanOrEqual(12);
      expect(contrast(palette.muted, palette.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.highlight, palette.background)).toBeGreaterThanOrEqual(3);
      for (const tone of TONES) {
        expect(contrast(palette.tones[tone].groupStroke, palette.background), `${palette.id} ${tone}`)
          .toBeGreaterThanOrEqual(3);
        // Toned edges and badges draw in the tone's stroke on the page.
        expect(contrast(palette.tones[tone].stroke, palette.background), `${palette.id} ${tone}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('makes a filled cell visibly darker (or lighter) than the tensor background', () => {
    for (const palette of PALETTES) {
      for (const tone of TONES) {
        const { cell, fill } = palette.tones[tone];
        expect(contrast(cell, fill), `${palette.id} ${tone}`).toBeGreaterThanOrEqual(1.4);
      }
    }
  });
});

describe('light colour palette', () => {
  const palette = figurePalette('light', 'color');

  it('pairs pastel fills (L* ≈ 83–95) with dark strokes (L* 40–45)', () => {
    for (const tone of HUED) {
      const { fill, stroke } = palette.tones[tone];
      expect(lab(fill).L, tone).toBeGreaterThanOrEqual(82);
      expect(lab(fill).L, tone).toBeLessThanOrEqual(96);
      expect(lab(stroke).L, tone).toBeGreaterThanOrEqual(40);
      expect(lab(stroke).L, tone).toBeLessThanOrEqual(45);
    }
  });

  it('keeps each stroke in its fill’s hue family', () => {
    for (const tone of CHROMATIC) {
      const { fill, stroke, cell, groupStroke } = palette.tones[tone];
      const hue = lab(fill).h;
      expect(hueDistance(hue, lab(stroke).h), tone).toBeLessThan(15);
      expect(hueDistance(hue, lab(groupStroke).h), tone).toBeLessThan(15);
      expect(hueDistance(hue, lab(cell).h), tone).toBeLessThan(15);
    }
  });

  it('spaces the hues so no two tones share a hue family', () => {
    for (const [a, b] of pairs(CHROMATIC)) {
      expect(hueDistance(lab(palette.tones[a].fill).h, lab(palette.tones[b].fill).h), `${a}/${b}`).toBeGreaterThan(20);
      expect(hueDistance(lab(palette.tones[a].stroke).h, lab(palette.tones[b].stroke).h), `${a}/${b}`)
        .toBeGreaterThan(20);
    }
  });

  it('keeps gray and the fills of filled groups quiet', () => {
    expect(lab(palette.tones.gray.fill).C).toBeLessThan(5);
    for (const tone of HUED) {
      // A filled group is a lighter tint than a node of its tone, so the
      // nodes inside it still read as objects.
      expect(luminance(palette.tones[tone].groupFill), tone).toBeGreaterThan(luminance(palette.tones[tone].fill));
    }
  });
});

describe('grayscale print', () => {
  it.each(LIGHT.map((p) => [p.id, p] as const))('%s: every tone fill has its own gray level', (_id, palette) => {
    for (const [a, b] of pairs(HUED)) {
      const gap = Math.abs(luminance(palette.tones[a].fill) - luminance(palette.tones[b].fill));
      expect(gap, `${a}/${b}`).toBeGreaterThanOrEqual(0.02);
    }
    // …and none of them is mistaken for the white of a neutral node.
    for (const tone of HUED) {
      expect(luminance(palette.background) - luminance(palette.tones[tone].fill), tone).toBeGreaterThanOrEqual(0.02);
    }
  });

  it('draws mono in true grays', () => {
    for (const palette of [figurePalette('light', 'mono'), figurePalette('dark', 'mono')]) {
      for (const tone of TONES) {
        for (const value of Object.values(palette.tones[tone])) {
          const [r, g, b] = channels(value);
          expect(r === g && g === b, `${palette.id} ${tone} ${value}`).toBe(true);
        }
      }
    }
  });

  it('keeps the colour palette’s light-to-dark order in mono', () => {
    const order = (palette: FigurePalette) =>
      [...HUED].sort((a, b) => luminance(palette.tones[b].fill) - luminance(palette.tones[a].fill));
    expect(order(figurePalette('light', 'mono'))).toEqual(order(figurePalette('light', 'color')));
    expect(order(figurePalette('dark', 'mono'))).toEqual(order(figurePalette('dark', 'color')));
  });
});

describe('dark palettes', () => {
  it.each(DARK.map((p) => [p.id, p] as const))('%s: deep fills under light strokes and text', (_id, palette) => {
    for (const tone of HUED) {
      const { fill, stroke, text } = palette.tones[tone];
      expect(luminance(fill), tone).toBeLessThan(luminance(stroke));
      expect(luminance(fill), tone).toBeLessThan(luminance(text));
      // Still visibly a shape on the page, not a hole in it.
      expect(contrast(fill, palette.background), tone).toBeGreaterThanOrEqual(1.4);
    }
  });
});

describe('toneHex and edgeColor', () => {
  const palette = figurePalette('light', 'color');

  it('reads one part of a tone', () => {
    expect(toneHex(palette, 'blue', 'fill')).toBe(palette.tones.blue.fill);
    expect(toneHex(palette, 'red', 'stroke')).toBe(palette.tones.red.stroke);
    expect(toneHex(palette, 'neutral', 'fill')).toBe('#ffffff');
  });

  it('draws untoned and neutral edges in the edge colour, toned ones in the tone stroke', () => {
    expect(edgeColor(palette, null)).toBe(palette.edge);
    expect(edgeColor(palette, 'neutral')).toBe(palette.edge);
    expect(edgeColor(palette, 'teal')).toBe(palette.tones.teal.stroke);
  });
});
