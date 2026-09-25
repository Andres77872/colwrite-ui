/**
 * Structured figures: a JSON spec in a `figure` code block, laid out and
 * drawn on the client. See `docs/figures.md` for the language and the
 * pipeline; `types.ts` for the contract between the stages.
 */
export { FIGURE_LANGUAGE, FIGURE_METRICS, FIGURE_FONT_STACKS, MAX_FIGURE_SOURCE } from './constants';
export {
  compileFigure,
  describeFigure,
  figureMeta,
  sortDiagnostics,
  type FigureMeta,
} from './compile';
export { parseFigureSource, lineColumn } from './parse';
export { findItemNode, formatFigureSource, setItemProperty } from './edit';
export { labelText, parseLabel } from './labels';
export { figureMathHtml } from './math';
export { getFigureMeasurer, loadFigureFont, onFigureFontsChange, createHeuristicMeasurer } from './measure';
export { figurePalette, type FigurePalette } from './palette';
export { figureToTikz } from './tikz';
export { FIGURE_TEMPLATES, type FigureTemplate } from './templates';
export { ROLES, SHAPES, TONES, type RoleDef } from './vocabulary';
export type * from './types';
