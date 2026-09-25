import type { FontSpec } from './types';

/** The code-block language that makes a block a structured figure. */
export const FIGURE_LANGUAGE = 'figure';

/** Longest source that is compiled; a figure past this is unreadable on a page anyway. */
export const MAX_FIGURE_SOURCE = 200_000;
/** Most nodes + groups a figure may declare. */
export const MAX_FIGURE_ITEMS = 400;
/** Most edges a figure may declare (after expanding fan-in / fan-out). */
export const MAX_FIGURE_EDGES = 800;
/** Most cells a single tensor may draw. */
export const MAX_TENSOR_CELLS = 1024;
/** Longest label, in characters. */
export const MAX_LABEL_CHARS = 400;

/**
 * CSS font stacks the SVG is drawn with. The app's face comes first, then the
 * standalone export's embedded face ("CW …"), then metric-compatible system
 * fallbacks, so the same markup reads right in the editor, the export and a
 * downloaded SVG.
 */
export const FIGURE_FONT_STACKS: Record<FontSpec['family'], string> = {
  sans: 'Inter, "CW Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: '"Source Serif 4", "CW Source Serif", "Source Serif Pro", Georgia, "Times New Roman", serif',
};

/** Class on every maths wrapper; the SVG's own <style> sizes KaTeX inside it. */
export const FIGURE_MATH_CLASS = 'cwfig-math';

/**
 * KaTeX draws at 1.21em of its surroundings by default, which makes maths in
 * a 12px figure label read a size larger than the words around it. Figures
 * set it to 1em; the measurer and every renderer share this rule.
 */
export const FIGURE_MATH_CSS = `.${FIGURE_MATH_CLASS} .katex{font-size:1em;line-height:1.2;white-space:nowrap}.${FIGURE_MATH_CLASS} .katex-display{margin:0}`;

/** Every size in the figure, in px. 12px labels print at 9pt. */
export const FIGURE_METRICS = {
  font: {
    node: 12,
    sublabel: 10,
    group: 11,
    edge: 10,
    repeat: 13,
    panel: 11.5,
    legend: 10.5,
    badge: 8.5,
    cell: 10,
  },
  /** Line height as a multiple of the font size. */
  lineHeight: 1.25,
  /** Plain-text node labels wrap past this width unless the node has a fixed width. */
  labelMaxWidth: 190,
  node: {
    padX: 12,
    padY: 7,
    minWidth: 44,
    minHeight: 26,
    /** Gap between a label and its sublabel. */
    sublabelGap: 2,
    radius: 3,
    /** Diameter of an operator circle that draws a glyph. */
    opDiameter: 20,
    /** Offset of each stacked copy, up and to the right. */
    stackOffset: 4,
    /** Gap between a tensor/image and its label underneath. */
    externalLabelGap: 4,
    /** Gap between a node and its repeat marker. */
    repeatGap: 6,
    imageWidth: 120,
    imageHeight: 90,
    minFixed: 16,
    maxFixed: 640,
  },
  tensor: {
    /** Cell size of an unlabelled grid, before it shrinks to fit `maxExtent`. */
    cell: 11,
    minCell: 4,
    maxExtent: 220,
    /** Labelled (token) cells: height and horizontal padding. */
    textCellHeight: 20,
    textCellPad: 6,
    textCellMinWidth: 20,
  },
  group: {
    pad: 12,
    /** Padding of a borderless, unfilled group (a panel, a pure arrangement). */
    padBare: 2,
    radius: 6,
    titleGap: 6,
    repeatGap: 8,
    panelGap: 8,
  },
  gap: {
    /** Between items of one layer (cross axis) in a flow. */
    item: 22,
    /** Between layers (flow axis) in a flow. */
    rank: 30,
    /** Reserved width of a long edge passing through a layer. */
    dummy: 10,
    /** Row / column / grid. */
    stack: 22,
    /** Between panels (groups with `panel`). */
    panel: 32,
  },
  edge: {
    stroke: 1.1,
    strokeThin: 0.8,
    strokeThick: 2,
    arrowLength: 7,
    arrowWidth: 6,
    arrowLengthThick: 9,
    arrowWidthThick: 8,
    /** Corner radius on orthogonal bends. */
    cornerRadius: 4,
    /** Clearance kept between a route and any node. */
    clearance: 6,
    /** Straight run out of a port before the first bend. */
    stub: 8,
    /** Spacing between ports sharing one side. */
    portSpacing: 12,
    /** Spacing between parallel segments after nudging. */
    nudge: 5,
    /** Cost of one bend, in px of length (libavoid calls 50 "sensible"). */
    bendPenalty: 40,
    /** Cost of crossing another edge. */
    crossingPenalty: 60,
    /** Cost of entering a group that holds neither endpoint. */
    groupPenalty: 400,
    labelGap: 4,
  },
  legend: {
    gap: 14,
    swatchWidth: 18,
    swatchHeight: 11,
    itemGap: 16,
    marginTop: 16,
  },
  /** Width of the paper export's text column; drives the legibility warning. */
  printColumn: 616,
  /** Smallest acceptable printed label size, in pt. */
  minPrintPt: 6.5,
  /** Blank margin around the whole drawing. */
  margin: 4,
} as const;

export function figureFont(
  family: FontSpec['family'],
  size: number,
  weight: FontSpec['weight'] = 400,
  italic = false,
): FontSpec {
  return { family, size, weight, italic };
}
