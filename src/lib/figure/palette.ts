import type { Tone } from './types';

/**
 * Figure palettes.
 *
 * A figure has to read in three places: on screen in either theme, on a
 * colour printer, and photocopied in grayscale. So every light tone is built
 * the same way in CIELAB: a pastel fill (chroma 13–22) with a same-hue stroke
 * at L* 43, and ink text on top. The hues are spaced like Okabe–Ito / Tol's
 * "light" scheme (yellow 95°, orange 68°, red 35°, pink 350°, purple 305°,
 * blue 258°, teal 200°, green 140°), so neighbours differ for the common
 * colour-vision deficiencies too.
 *
 * Hue alone does not survive a grayscale print, so the fills also sit on a
 * lightness ladder, 1.5 L* apart (yellow lightest, purple darkest): any two
 * tones differ by ≥ 0.02 in relative luminance, which a printer resolves.
 * Mono spaces its grays 3 L* apart for the same reason, without hue to help.
 * Text on every fill is ≥ 7:1 (WCAG AAA); strokes are ≥ 3:1 against their
 * fill. `palette.test.ts` checks all of it.
 *
 * `neutral` is the unstyled default: the background as fill, ink as stroke.
 */

export type ToneColors = {
  /** Node fill. */
  fill: string;
  /** Node outline, operator glyphs, hatching. */
  stroke: string;
  /** Label ink on the fill. */
  text: string;
  /** Fill of a filled group: a lighter tint, so the nodes inside stand out. */
  groupFill: string;
  /** Group border: softer than a node's, so containers recede. */
  groupStroke: string;
  /** A filled tensor cell (masks, heat maps); readable under cell text. */
  cell: string;
};

export type FigurePalette = {
  /** `<theme>-<variant>`, e.g. `light-color`; part of render cache keys. */
  id: string;
  background: string;
  /** Labels outside shapes: group titles, edge labels, captions, legend. */
  ink: string;
  /** Sublabels, and an image placeholder's cross and note. */
  muted: string;
  /** Default edge stroke and arrowheads. */
  edge: string;
  /** Stroke behind edge labels, so a line never runs through text. */
  halo: string;
  /** Screen-only selection outline. */
  highlight: string;
  /** Fill of an image that is not drawn: no, invalid or remote source. */
  placeholder: string;
  tones: Record<Tone, ToneColors>;
};

export type FigureTheme = 'light' | 'dark';
export type FigureVariant = 'color' | 'mono';

type ToneTable = Record<Exclude<Tone, 'neutral'>, ToneColors>;

type Base = Omit<FigurePalette, 'id' | 'tones'> & {
  neutral: Omit<ToneColors, 'fill' | 'stroke' | 'text'>;
};

/** Build a tone from its five colours; every tone's text is the palette ink. */
function tone(ink: string, fill: string, stroke: string, groupFill: string, groupStroke: string, cell: string): ToneColors {
  return { fill, stroke, text: ink, groupFill, groupStroke, cell };
}

const LIGHT_INK = '#1f2328';
const DARK_INK = '#ececec';
const MONO_INK = '#1f1f1f';

const LIGHT_BASE: Base = {
  background: '#ffffff',
  ink: LIGHT_INK,
  muted: '#4b535b',
  edge: '#333a40',
  halo: '#ffffff',
  highlight: '#2383e2',
  placeholder: '#eef1f4',
  neutral: { groupFill: '#f6f8fb', groupStroke: '#898f95', cell: '#8b9197' },
};

const DARK_BASE: Base = {
  // The editor's dark surface, so a figure sits on the page without a card.
  background: '#191919',
  ink: DARK_INK,
  muted: '#bdbdbd',
  edge: '#bbbbbb',
  halo: '#191919',
  highlight: '#4a9ded',
  placeholder: '#2a2a2a',
  neutral: { groupFill: '#222222', groupStroke: '#6a6a6a', cell: '#636363' },
};

const MONO_LIGHT_BASE: Base = {
  ...LIGHT_BASE,
  ink: MONO_INK,
  muted: '#444444',
  edge: '#2b2b2b',
  placeholder: '#eeeeee',
  neutral: { groupFill: '#f7f7f7', groupStroke: '#727272', cell: '#919191' },
};

const MONO_DARK_BASE: Base = {
  ...DARK_BASE,
  edge: '#c8c8c8',
  placeholder: '#2a2a2a',
  neutral: { groupFill: '#222222', groupStroke: '#6a6a6a', cell: '#666666' },
};

// Arguments: ink, fill, stroke, groupFill, groupStroke, cell. The comment is
// each fill's L*, the grayscale ladder.
const LIGHT_COLOR: ToneTable = {
  yellow: tone(LIGHT_INK, '#fef0c6', '#796413', '#fcf8ec', '#988b5a', '#e2bd58'), // L* 95
  green: tone(LIGHT_INK, '#dcf3d8', '#3b7239', '#f2faf0', '#70956b', '#82b27d'), // L* 93.5
  teal: tone(LIGHT_INK, '#c9eff0', '#027174', '#eafbfc', '#3b999b', '#3ab6ba'), // L* 92
  orange: tone(LIGHT_INK, '#ffdec2', '#925812', '#fff6f0', '#ac845f', '#ce9c6d'), // L* 90.5
  gray: tone(LIGHT_INK, '#dce0e4', '#5f676d', '#f6f8fb', '#868c92', '#a0a7ad'), // L* 89
  blue: tone(LIGHT_INK, '#c6def7', '#036c9d', '#f3f9ff', '#5b91bb', '#67ace1'), // L* 87.5
  pink: tone(LIGHT_INK, '#f1cedc', '#9d4972', '#fff6f9', '#b67a95', '#db8fb1'), // L* 86
  red: tone(LIGHT_INK, '#f6c9c0', '#ab4538', '#fff6f4', '#ba7c70', '#e09284'), // L* 84.5
  purple: tone(LIGHT_INK, '#d5cae7', '#6f5b9c', '#faf6ff', '#9484b4', '#b09cd8'), // L* 83
};

// Deep fills (L* 22–30, same ladder order) under light same-hue strokes.
const DARK_COLOR: ToneTable = {
  yellow: tone(DARK_INK, '#4d472e', '#d1b274', '#27241a', '#82774e', '#6c612f'),
  green: tone(DARK_INK, '#364934', '#90c38a', '#1e261d', '#607f5c', '#436a40'),
  teal: tone(DARK_INK, '#1b494a', '#44c8cb', '#162627', '#368284', '#006c6f'),
  orange: tone(DARK_INK, '#503c29', '#e1ab79', '#2b221b', '#927152', '#7f5933'),
  gray: tone(DARK_INK, '#3a3e42', '#afb7bf', '#212426', '#72787d', '#5c6167'),
  blue: tone(DARK_INK, '#233e53', '#73bdf6', '#1b252d', '#507b9e', '#216690'),
  pink: tone(DARK_INK, '#4e303e', '#ef9ec2', '#2c2025', '#9b687f', '#8b4d6a'),
  red: tone(DARK_INK, '#4d2f2a', '#f5a092', '#2d211e', '#9e6a61', '#8d5046'),
  purple: tone(DARK_INK, '#393148', '#c1abec', '#25222c', '#7e7098', '#685989'),
};

// Grays 3 L* apart in the colour ladder's order, so switching a figure to
// mono keeps which tones are lighter than which.
const MONO_LIGHT: ToneTable = {
  yellow: tone(MONO_INK, '#f6f6f6', '#2b2b2b', '#fcfcfc', '#727272', '#919191'), // L* 97
  green: tone(MONO_INK, '#eeeeee', '#2b2b2b', '#f8f8f8', '#727272', '#919191'), // L* 94
  teal: tone(MONO_INK, '#e5e5e5', '#2b2b2b', '#f5f5f5', '#727272', '#919191'), // L* 91
  orange: tone(MONO_INK, '#dddddd', '#2b2b2b', '#f1f1f1', '#727272', '#919191'), // L* 88
  gray: tone(MONO_INK, '#d4d4d4', '#2b2b2b', '#eeeeee', '#727272', '#919191'), // L* 85
  blue: tone(MONO_INK, '#cccccc', '#2b2b2b', '#eaeaea', '#727272', '#919191'), // L* 82
  pink: tone(MONO_INK, '#c4c4c4', '#2b2b2b', '#e7e7e7', '#727272', '#919191'), // L* 79
  red: tone(MONO_INK, '#bbbbbb', '#2b2b2b', '#e3e3e3', '#727272', '#919191'), // L* 76
  purple: tone(MONO_INK, '#b3b3b3', '#2b2b2b', '#e0e0e0', '#727272', '#919191'), // L* 73
};

const MONO_DARK: ToneTable = {
  yellow: tone(DARK_INK, '#4c4c4c', '#cfcfcf', '#242424', '#7c7c7c', '#666666'),
  green: tone(DARK_INK, '#4a4a4a', '#cfcfcf', '#242424', '#7c7c7c', '#666666'),
  teal: tone(DARK_INK, '#474747', '#cfcfcf', '#242424', '#7c7c7c', '#666666'),
  orange: tone(DARK_INK, '#444444', '#cfcfcf', '#242424', '#7c7c7c', '#666666'),
  gray: tone(DARK_INK, '#414141', '#cfcfcf', '#242424', '#7c7c7c', '#666666'),
  blue: tone(DARK_INK, '#3e3e3e', '#cfcfcf', '#242424', '#7c7c7c', '#666666'),
  pink: tone(DARK_INK, '#3b3b3b', '#cfcfcf', '#242424', '#7c7c7c', '#666666'),
  red: tone(DARK_INK, '#393939', '#cfcfcf', '#242424', '#7c7c7c', '#666666'),
  purple: tone(DARK_INK, '#363636', '#cfcfcf', '#242424', '#7c7c7c', '#666666'),
};

const TABLES: Record<FigureTheme, Record<FigureVariant, [Base, ToneTable]>> = {
  light: { color: [LIGHT_BASE, LIGHT_COLOR], mono: [MONO_LIGHT_BASE, MONO_LIGHT] },
  dark: { color: [DARK_BASE, DARK_COLOR], mono: [MONO_DARK_BASE, MONO_DARK] },
};

function build(theme: FigureTheme, variant: FigureVariant): FigurePalette {
  const [{ neutral, ...base }, table] = TABLES[theme][variant];
  const tones = {
    neutral: Object.freeze({ fill: base.background, stroke: base.ink, text: base.ink, ...neutral }),
    ...Object.fromEntries(Object.entries(table).map(([name, colors]) => [name, Object.freeze({ ...colors })])),
  } as Record<Tone, ToneColors>;
  return Object.freeze({ id: `${theme}-${variant}`, ...base, tones: Object.freeze(tones) });
}

const cache = new Map<string, FigurePalette>();

/**
 * The palette a figure is drawn with. Screen rendering follows the app theme;
 * downloads and TikZ always use `light`, because a page is white. The result
 * is shared and frozen, so it can be compared by identity in memo keys.
 */
export function figurePalette(theme: FigureTheme, variant: FigureVariant): FigurePalette {
  const key = `${theme}-${variant}`;
  let palette = cache.get(key);
  if (!palette) {
    palette = build(theme, variant);
    cache.set(key, palette);
  }
  return palette;
}

/** One colour of a tone, e.g. for TikZ `\definecolor` or a legend swatch. */
export function toneHex(palette: FigurePalette, tone: Tone, part: keyof ToneColors): string {
  return palette.tones[tone][part];
}

/**
 * The stroke of an edge or arrowhead: its tone's stroke when it has one,
 * else the palette's edge colour. `neutral` is the default look, not ink.
 */
export function edgeColor(palette: FigurePalette, tone: Tone | null): string {
  return tone && tone !== 'neutral' ? palette.tones[tone].stroke : palette.edge;
}
