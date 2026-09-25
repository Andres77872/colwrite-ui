import { FIGURE_METRICS, MAX_FIGURE_SOURCE } from './constants';
import { labelText, parseLabel } from './labels';
import { figureMathHtml } from './math';
import { layoutFigure } from './layout';
import { normalizeFigure } from './normalize';
import { lineColumn, parseFigureSource } from './parse';
import { translateRect } from './geometry';
import { edgeBounds, routeFigure, translateEdges } from './route';
import { vocabularyKey } from './vocabulary';
import type {
  Label,
  CompiledFigure,
  FigureDiagnostic,
  FigureLayout,
  FigureModel,
  FigureScene,
  LabelBox,
  ParseResult,
  TextMeasurer,
} from './types';

/**
 * Source text → drawable scene, the one entry point every surface uses.
 *
 * Each stage is pure, so a result depends only on the source and the
 * measurer's metrics; both are the cache key. The editor re-renders a figure
 * on every keystroke elsewhere in the document, and the export, the review
 * card and the chat may all show the same figure, so an unchanged figure
 * must never be laid out twice.
 */

const CACHE_LIMIT = 48;
const cache = new Map<string, CompiledFigure>();

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

/** Errors first, then warnings, then notes; stable within each. */
export function sortDiagnostics(diagnostics: readonly FigureDiagnostic[]): FigureDiagnostic[] {
  return diagnostics
    .map((diagnostic, index) => ({ diagnostic, index }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.diagnostic.severity] - SEVERITY_RANK[b.diagnostic.severity] || a.index - b.index,
    )
    .map(({ diagnostic }) => diagnostic);
}

function dedupe(diagnostics: readonly FigureDiagnostic[]): FigureDiagnostic[] {
  const seen = new Set<string>();
  const out: FigureDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.severity}|${diagnostic.code}|${diagnostic.message}|${diagnostic.range?.join(':') ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(diagnostic);
  }
  return out;
}

function failure(source: string, parse: ParseResult, diagnostics: FigureDiagnostic[], model: FigureModel | null = null): CompiledFigure {
  return { source, parse, model, scene: null, diagnostics: sortDiagnostics(dedupe(diagnostics)), ok: false };
}

function crash(code: string, stage: string, error: unknown): FigureDiagnostic {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    severity: 'error',
    code,
    message: `The figure could not be ${stage} (${detail}). This is a bug in the renderer, not in the spec.`,
  };
}

/**
 * The scale at which the smallest essential text — node labels, sublabels,
 * edge labels, group titles, panel captions, the legend — still prints at
 * `minPrintPt`. Badges and cell text are deliberately small and do not count.
 */
function legibleScaleOf(scene: Pick<FigureScene, 'nodes' | 'groups' | 'edges' | 'legend'>): number {
  let smallest = Infinity;
  for (const node of scene.nodes) {
    if (node.label && node.model.shape !== 'tensor') smallest = Math.min(smallest, node.label.font.size);
    if (node.sublabel) smallest = Math.min(smallest, node.sublabel.font.size);
  }
  for (const edge of scene.edges) if (edge.label) smallest = Math.min(smallest, edge.label.font.size);
  for (const group of scene.groups) {
    if (group.label) smallest = Math.min(smallest, group.label.font.size);
    if (group.panel) smallest = Math.min(smallest, group.panel.font.size);
  }
  for (const item of scene.legend?.items ?? []) smallest = Math.min(smallest, item.label.font.size);
  if (!Number.isFinite(smallest)) return 0;
  // px → pt at 96 dpi.
  return FIGURE_METRICS.minPrintPt / (smallest * 0.75);
}

/**
 * The share of the text column an explicit `size` prints the figure at,
 * scaling it up or down (as on screen and in TikZ); `auto` prints at the
 * natural size and only shrinks to fit.
 */
const PRINT_SHARE: Record<FigureModel['size'], number | null> = { auto: null, small: 0.5, medium: 0.7, large: 0.85, full: 1 };

function printCheck(scene: FigureScene, size: FigureModel['size']): FigureDiagnostic | null {
  const share = PRINT_SHARE[size];
  const width = Math.max(1, scene.width);
  const printScale =
    share !== null ? (share * FIGURE_METRICS.printColumn) / width : Math.min(1, FIGURE_METRICS.printColumn / width);
  if (printScale >= scene.legibleScale) return null;
  const smallestPt = (FIGURE_METRICS.minPrintPt / scene.legibleScale) * printScale;
  const along = scene.direction === 'right' || scene.direction === 'left' ? 'down' : 'right';
  const why =
    share !== null && share < 1
      ? `The figure prints at ${Math.round(share * 100)}% of the column ("size": "${size}")`
      : `The figure is ${Math.round(scene.width)}px wide`;
  const larger = share !== null && share < 1 ? 'a larger "size"' : '"size": "full" for a two-column page';
  return {
    severity: 'warning',
    code: 'print.small-text',
    message:
      `${why}, so on a printed page its smallest labels shrink to ${smallestPt.toFixed(1)}pt (below ` +
      `${FIGURE_METRICS.minPrintPt}pt). Try "direction": "${along}", fewer items side by side, shorter labels, or ${larger}.`,
  };
}

function withPositions(source: string, diagnostics: FigureDiagnostic[]): FigureDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    if (!diagnostic.range || diagnostic.line !== undefined) return diagnostic;
    const { line, column } = lineColumn(source, diagnostic.range[0]);
    return { ...diagnostic, line, column };
  });
}

function moveLabel(box: LabelBox | null, dx: number, dy: number): LabelBox | null {
  return box && { ...box, x: box.x + dx, y: box.y + dy };
}

/** The layout moved by (dx, dy) on a canvas of the given size. */
function translateLayout(layout: FigureLayout, dx: number, dy: number, width: number, height: number): FigureLayout {
  return {
    ...layout,
    width,
    height,
    nodes: layout.nodes.map((node) => ({
      ...node,
      shape: translateRect(node.shape, dx, dy),
      anchor: translateRect(node.anchor, dx, dy),
      bounds: translateRect(node.bounds, dx, dy),
      label: moveLabel(node.label, dx, dy),
      sublabel: moveLabel(node.sublabel, dx, dy),
      repeat: moveLabel(node.repeat, dx, dy),
      badge: moveLabel(node.badge, dx, dy),
    })),
    groups: layout.groups.map((group) => ({
      ...group,
      box: translateRect(group.box, dx, dy),
      bounds: translateRect(group.bounds, dx, dy),
      label: moveLabel(group.label, dx, dy),
      repeat: moveLabel(group.repeat, dx, dy),
      panel: moveLabel(group.panel, dx, dy),
    })),
    legend: layout.legend && {
      box: translateRect(layout.legend.box, dx, dy),
      items: layout.legend.items.map((item) => ({
        ...item,
        swatch: translateRect(item.swatch, dx, dy),
        label: moveLabel(item.label, dx, dy) ?? item.label,
      })),
    },
  };
}

/**
 * Lay out and route, growing the canvas when a route reaches past it: a
 * feedback loop around the whole drawing, or a label beside an outer edge,
 * would otherwise be clipped by the SVG's viewBox. The layout and the routed
 * edges move together, so the canvas measured from them covers every stroke
 * and label exactly.
 */
function layoutAndRoute(model: FigureModel, measurer: TextMeasurer) {
  let layout = layoutFigure(model, measurer);
  let routed = routeFigure(layout, model, measurer);
  const reach = edgeBounds(routed.edges);
  if (reach) {
    const margin = FIGURE_METRICS.margin;
    const dx = Math.max(0, Math.ceil(margin - reach.x));
    const dy = Math.max(0, Math.ceil(margin - reach.y));
    const width = Math.max(layout.width + dx, Math.ceil(reach.x + reach.width + dx + margin));
    const height = Math.max(layout.height + dy, Math.ceil(reach.y + reach.height + dy + margin));
    if (dx > 0 || dy > 0) {
      layout = translateLayout(layout, dx, dy, width, height);
      routed = { ...routed, edges: translateEdges(routed.edges, dx, dy) };
    } else if (width > layout.width || height > layout.height) {
      layout = { ...layout, width, height };
    }
  }
  return { layout, routed };
}

/** Most `label.math-invalid` warnings reported per figure. */
const MAX_MATH_WARNINGS = 12;

/**
 * Maths KaTeX cannot typeset. The drawing shows it in red, but the author (and
 * the assistant, through Fix problems) needs to be told where it is — and the
 * TikZ export would otherwise carry it into a LaTeX file that fails to build.
 */
function mathDiagnostics(model: FigureModel): FigureDiagnostic[] {
  const out: FigureDiagnostic[] = [];
  const check = (label: Label | null, where: string, path?: string, range?: [number, number]) => {
    if (!label || out.length >= MAX_MATH_WARNINGS) return;
    for (const line of label.lines) {
      for (const segment of line) {
        if (segment.kind !== 'math' || out.length >= MAX_MATH_WARNINGS) continue;
        const result = figureMathHtml(segment.value);
        if (result.ok) continue;
        out.push({
          severity: 'warning',
          code: 'label.math-invalid',
          message: `The maths $${segment.value}$ in ${where} cannot be typeset (${result.error ?? 'invalid LaTeX'}).`,
          ...(path ? { path } : {}),
          ...(range ? { range } : {}),
        });
      }
    }
  };
  if (model.caption) check(parseLabel(model.caption), 'the caption', 'caption');
  for (const item of model.items.values()) {
    const where = `${item.kind} "${item.id}"`;
    check(item.label, where, item.path, item.range);
    if (item.kind === 'node') check(item.sublabel, `the sublabel of ${where}`, item.path, item.range);
  }
  for (const edge of model.edges) check(edge.label, `the label of edge ${edge.from} → ${edge.to}`, edge.path, edge.range);
  model.legend.forEach((entry, index) => check(entry.label, 'the legend', `legend[${index}]`));
  return out;
}

function compileUncached(source: string, measurer: TextMeasurer): CompiledFigure {
  const emptyParse: ParseResult = { ast: null, value: null, diagnostics: [] };
  if (!source.trim()) {
    return failure(source, emptyParse, [
      { severity: 'error', code: 'figure.empty', message: 'The figure is empty. Start from a template or describe it to the assistant.' },
    ]);
  }
  if (source.length > MAX_FIGURE_SOURCE) {
    return failure(source, emptyParse, [
      {
        severity: 'error',
        code: 'figure.too-long',
        message: `The spec is ${source.length.toLocaleString()} characters; the limit is ${MAX_FIGURE_SOURCE.toLocaleString()}. Split it into several figures.`,
      },
    ]);
  }

  const parse = parseFigureSource(source);
  if (!parse.ast) return failure(source, parse, parse.diagnostics);

  let normalized: ReturnType<typeof normalizeFigure>;
  try {
    normalized = normalizeFigure(parse, source);
  } catch (error) {
    return failure(source, parse, [...parse.diagnostics, crash('figure.normalize-crash', 'read', error)]);
  }
  const { model } = normalized;
  const early = withPositions(source, [
    ...parse.diagnostics,
    ...normalized.diagnostics,
    ...(model ? mathDiagnostics(model) : []),
  ]);
  if (!model) return failure(source, parse, early);

  let scene: FigureScene;
  try {
    const { layout, routed } = layoutAndRoute(model, measurer);
    const partial = { ...layout, edges: routed.edges, legibleScale: 0 };
    scene = {
      ...partial,
      legibleScale: legibleScaleOf(partial),
      diagnostics: [...layout.diagnostics, ...routed.diagnostics],
    };
  } catch (error) {
    return failure(source, parse, [...early, crash('figure.layout-crash', 'laid out', error)], model);
  }

  const print = printCheck(scene, model.size);
  const diagnostics = sortDiagnostics(
    dedupe(withPositions(source, [...early, ...scene.diagnostics, ...(print ? [print] : [])])),
  );
  return { source, parse, model, scene, diagnostics, ok: true };
}

/**
 * Parse, normalise, lay out and route a figure spec.
 *
 * Never throws: a spec that cannot be drawn comes back `ok: false` with
 * diagnostics that say why, and a renderer bug is reported as a diagnostic
 * rather than taking the editor down with it.
 */
export function compileFigure(source: string, measurer: TextMeasurer): CompiledFigure {
  const key = `${measurer.key}\u0000${source}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const result = compileUncached(source, measurer);
  cache.set(key, result);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return result;
}

/** For tests: forget cached compilations. */
export function resetFigureCacheForTests(): void {
  cache.clear();
}

/* ────────────────────────────────────────────────────────────────────────
 * Metadata without a layout
 * ──────────────────────────────────────────────────────────────────────── */

export type FigureMeta = {
  /** The caption the figure prints under "Figure N." — null unless the spec draws. */
  caption: string | null;
  label: string | null;
  title: string | null;
  /** Parses, but declares nothing to draw yet (a starter spec). */
  empty: boolean;
  /** A starter's caption: what the figure is meant to show. Never numbered. */
  draft: string | null;
};

const metaCache = new Map<string, FigureMeta>();

/** A top-level text field of the raw spec, keys matched as leniently as the reader does. */
function draftText(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let found: unknown = undefined;
  for (const [name, field] of Object.entries(value)) if (vocabularyKey(name) === key) found = field;
  const text = typeof found === 'number' && Number.isFinite(found) ? String(found) : typeof found === 'string' ? found : '';
  return text.trim() || null;
}

/**
 * Caption, label and title as the renderer will read them — what numbering
 * and the outline need. The spec is read the way `compileFigure` reads it
 * (any key spelling, a map of nodes, a numeric caption), but never measured
 * or laid out. Only a figure that draws has a caption, so a starter or a
 * broken spec never takes a figure number.
 */
export function figureMeta(source: string): FigureMeta {
  const hit = metaCache.get(source);
  if (hit) return hit;
  let meta: FigureMeta = { caption: null, label: null, title: null, empty: false, draft: null };
  if (source.trim() && source.length <= MAX_FIGURE_SOURCE) {
    const parse = parseFigureSource(source);
    let normalized: ReturnType<typeof normalizeFigure> | null = null;
    try {
      normalized = parse.ast ? normalizeFigure(parse, source) : null;
    } catch {
      // compileFigure reports the crash; there is nothing to number.
    }
    const model = normalized?.model ?? null;
    if (model) {
      meta = { caption: model.caption, label: model.label, title: model.title, empty: false, draft: null };
    } else if (normalized) {
      // Only "no nodes yet" makes a starter; a spec with anything else wrong is shown with its problems.
      const problems = [...parse.diagnostics, ...normalized.diagnostics].filter((diagnostic) => diagnostic.severity !== 'info');
      const empty = problems.length > 0 && problems.every((diagnostic) => diagnostic.code === 'spec.no-nodes');
      meta = { ...meta, empty, draft: empty ? draftText(parse.value, 'caption') : null };
    }
  }
  metaCache.set(source, meta);
  if (metaCache.size > 256) {
    const oldest = metaCache.keys().next().value;
    if (oldest !== undefined) metaCache.delete(oldest);
  }
  return meta;
}

/* ────────────────────────────────────────────────────────────────────────
 * Accessible description
 * ──────────────────────────────────────────────────────────────────────── */

const DESCRIBE_ITEMS = 16;
const DESCRIBE_EDGES = 14;

/**
 * A text description of the figure for screen readers and `alt`: the
 * author's `alt` when given, otherwise what it contains and how it connects.
 */
export function describeFigure(model: FigureModel): string {
  if (model.alt) return model.alt;
  const nameOf = (id: string): string => {
    const item = model.items.get(id);
    if (!item) return id;
    const text = item.kind === 'node' ? labelText(item.label) : item.label ? labelText(item.label) : '';
    return text.trim() || id;
  };
  const nodes = [...model.items.values()].filter((item) => item.kind === 'node');
  const groups = [...model.items.values()].filter((item) => item.kind === 'group');
  const parts: string[] = [];
  const lead = model.title ?? 'Diagram';
  parts.push(
    `${lead} with ${nodes.length} element${nodes.length === 1 ? '' : 's'}` +
      (groups.length ? ` in ${groups.length} group${groups.length === 1 ? '' : 's'}` : '') +
      ` and ${model.edges.length} connection${model.edges.length === 1 ? '' : 's'}.`,
  );
  if (groups.length) {
    parts.push(
      'Groups: ' +
        groups
          .slice(0, DESCRIBE_ITEMS)
          .map((group) => nameOf(group.id))
          .join('; ') +
        (groups.length > DESCRIBE_ITEMS ? '; …' : '') +
        '.',
    );
  }
  if (model.edges.length) {
    parts.push(
      'Connections: ' +
        model.edges
          .slice(0, DESCRIBE_EDGES)
          .map((edge) => `${nameOf(edge.from)} to ${nameOf(edge.to)}`)
          .join('; ') +
        (model.edges.length > DESCRIBE_EDGES ? '; …' : '') +
        '.',
    );
  } else if (nodes.length) {
    parts.push(
      'Elements: ' +
        nodes
          .slice(0, DESCRIBE_ITEMS)
          .map((node) => nameOf(node.id))
          .join('; ') +
        (nodes.length > DESCRIBE_ITEMS ? '; …' : '') +
        '.',
    );
  }
  return parts.join(' ');
}
