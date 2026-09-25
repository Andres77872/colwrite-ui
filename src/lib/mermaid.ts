import type { Mermaid, MermaidConfig } from 'mermaid';
import { importMermaid } from '@/lib/mermaidModule';

/**
 * Mermaid diagrams, drawn the same way everywhere they appear: the editor's
 * diagram blocks, the review cards, the assistant's replies, the HTML export
 * and the component catalog.
 *
 * Mermaid is ~2 MB of parsers and layout engines that most sessions never
 * need, so it is imported on first use and Vite splits it into its own chunk.
 * It is also global and stateful — `initialize` rewrites a site-wide config
 * and `render` measures text in a scratch element on <body> — so every draw
 * goes through one queue: two diagrams in different themes can never pick up
 * each other's config halfway through a render.
 *
 * Security: `securityLevel: 'strict'` is fixed here and is on Mermaid's own
 * `secure` list, so an `%%{init}%%` directive inside a diagram cannot lower
 * it. In strict mode labels are text, click handlers are disabled, and the
 * finished SVG goes through DOMPurify before it is returned. That sanitised
 * string is what callers inject; no other markup from the source reaches the
 * page.
 */

/** The code-block language that makes a block a diagram. */
export const MERMAID_LANGUAGE = 'mermaid';

/**
 * The longest source that is drawn. Mermaid's own default is 50 000; a
 * diagram past a few thousand characters is unreadable on a page anyway, and
 * layout time grows much faster than the text does.
 */
export const MAX_MERMAID_SOURCE = 20_000;

export type MermaidRenderResult =
  | { ok: true; svg: string; diagramType: string }
  | { ok: false; error: string };

/**
 * The design tokens a diagram is drawn with.
 *
 * Read from the element the diagram lives in, so a diagram follows the app
 * theme and also a `data-theme` island (a dark card in the catalog, the
 * light-only export). `key` changes whenever any colour does, which is what
 * the render cache and the components' effects key on.
 */
export type MermaidTheme = {
  key: string;
  dark: boolean;
  fontFamily: string;
  variables: Record<string, string | boolean>;
};

const TOKENS = {
  background: '#ffffff',
  foreground: '#2c2c2b',
  'muted-foreground': '#65645f',
  muted: '#f1f1ef',
  'code-bg': '#f7f6f3',
  border: '#e9e9e7',
  'border-strong': '#dfdfde',
  'chart-grid': '#e9e9e7',
  'tint-blue': '#e7f3f8',
  'tint-purple': '#f6f3f9',
  'tint-green': '#edf3ec',
  'tint-yellow': '#fbf3db',
  'tint-orange': '#fbecdd',
  'tint-pink': '#faf1f5',
  'tint-red': '#fdebec',
  'tint-gray': '#f1f1ef',
  'series-1': '#2f78d4',
  'series-2': '#c9501f',
  'series-3': '#12875f',
  'series-4': '#a86e00',
  'series-5': '#c2466f',
  'series-6': '#067306',
  'series-7': '#7466d9',
  'series-8': '#cf4c4c',
} as const;

type TokenName = keyof typeof TOKENS;

const FALLBACK_FONT = 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// Mermaid derives shades with khroma, which reads hex and rgb() — not the
// oklch()/color-mix() a future token might use. Anything else falls back to
// the light palette rather than failing inside a layout engine.
const PARSEABLE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i;

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})/i.exec(hex);
  if (!match) return 1;
  const value = parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/**
 * The palette as the given element sees it, or the light one without an
 * element. `fontFamily` overrides the element's `--font-sans` — the export
 * names its own embedded faces.
 */
export function mermaidThemeFor(
  element?: Element | null,
  overrides?: { fontFamily?: string },
): MermaidTheme {
  const style = element && typeof window !== 'undefined' ? window.getComputedStyle(element) : null;
  const token = (name: TokenName): string => {
    const value = style?.getPropertyValue(`--color-${name}`).trim() ?? '';
    return PARSEABLE_COLOR.test(value) ? value : TOKENS[name];
  };
  const t = Object.fromEntries(
    (Object.keys(TOKENS) as TokenName[]).map((name) => [name, token(name)]),
  ) as Record<TokenName, string>;
  const fontFamily = overrides?.fontFamily || style?.getPropertyValue('--font-sans').trim() || FALLBACK_FONT;
  const dark = relativeLuminance(t.background) < 0.2;
  const onSeries = '#ffffff';

  const variables: Record<string, string | boolean> = {
    darkMode: dark,
    background: t.background,
    fontFamily,
    fontSize: '14px',
    // Nodes: a quiet blue wash with a series-blue edge, the way a figure in
    // the document reads — not Mermaid's stock lavender.
    primaryColor: t['tint-blue'],
    primaryTextColor: t.foreground,
    primaryBorderColor: t['series-1'],
    secondaryColor: t['tint-purple'],
    secondaryTextColor: t.foreground,
    secondaryBorderColor: t['series-7'],
    tertiaryColor: t['code-bg'],
    tertiaryTextColor: t.foreground,
    tertiaryBorderColor: t['border-strong'],
    mainBkg: t['tint-blue'],
    nodeBorder: t['series-1'],
    nodeTextColor: t.foreground,
    textColor: t.foreground,
    titleColor: t.foreground,
    lineColor: t['muted-foreground'],
    defaultLinkColor: t['muted-foreground'],
    edgeLabelBackground: t.background,
    clusterBkg: t['code-bg'],
    clusterBorder: t['border-strong'],
    noteBkgColor: t['tint-yellow'],
    noteTextColor: t.foreground,
    noteBorderColor: t['series-4'],
    errorBkgColor: t['tint-red'],
    errorTextColor: t.foreground,
    // Sequence diagrams.
    actorBkg: t['tint-blue'],
    actorBorder: t['series-1'],
    actorTextColor: t.foreground,
    actorLineColor: t['muted-foreground'],
    signalColor: t.foreground,
    signalTextColor: t.foreground,
    labelBoxBkgColor: t['tint-blue'],
    labelBoxBorderColor: t['series-1'],
    labelTextColor: t.foreground,
    loopTextColor: t.foreground,
    activationBkgColor: t['tint-purple'],
    activationBorderColor: t['series-7'],
    sequenceNumberColor: onSeries,
    // Class, state and ER diagrams.
    classText: t.foreground,
    labelColor: t.foreground,
    altBackground: t['code-bg'],
    attributeBackgroundColorOdd: t.background,
    attributeBackgroundColorEven: t['code-bg'],
    // Gantt.
    sectionBkgColor: t['tint-blue'],
    altSectionBkgColor: t.background,
    sectionBkgColor2: t['tint-purple'],
    taskBkgColor: t['series-1'],
    taskBorderColor: t['series-1'],
    taskTextColor: onSeries,
    taskTextLightColor: onSeries,
    taskTextDarkColor: t.foreground,
    taskTextOutsideColor: t.foreground,
    taskTextClickableColor: t.foreground,
    activeTaskBkgColor: t['tint-blue'],
    activeTaskBorderColor: t['series-1'],
    doneTaskBkgColor: t.muted,
    doneTaskBorderColor: t['border-strong'],
    critBkgColor: t['series-8'],
    critBorderColor: t['series-8'],
    gridColor: t['chart-grid'],
    todayLineColor: t['series-8'],
    // Pie and git graphs take the chart series in their fixed order, so a
    // diagram's categories match the document's own charts.
    pieStrokeColor: t.background,
    pieOuterStrokeColor: t.border,
    pieTitleTextColor: t.foreground,
    pieSectionTextColor: onSeries,
    pieLegendTextColor: t.foreground,
  };
  for (let index = 1; index <= 8; index += 1) {
    const series = t[`series-${index}` as TokenName];
    variables[`pie${index}`] = series;
    variables[`git${index - 1}`] = series;
    variables[`gitBranchLabel${index - 1}`] = onSeries;
  }
  // Mind maps, timelines and journeys colour each branch from cScale: tints
  // behind foreground text, so every branch stays readable in both themes.
  const tints: TokenName[] = [
    'tint-blue', 'tint-purple', 'tint-green', 'tint-yellow',
    'tint-orange', 'tint-pink', 'tint-red', 'tint-gray',
  ];
  tints.forEach((name, index) => {
    variables[`cScale${index}`] = t[name];
    variables[`cScaleLabel${index}`] = t.foreground;
    variables[`cScalePeer${index}`] = t['border-strong'];
  });

  const key = JSON.stringify(variables);
  return { key, dark, fontFamily, variables };
}

let loader: Promise<Mermaid> | null = null;

/** Mermaid itself, imported on first use. A failed import is retried next time. */
export function loadMermaid(): Promise<Mermaid> {
  loader ??= importMermaid().catch((error: unknown) => {
    loader = null;
    throw error;
  });
  return loader;
}

/**
 * Mermaid's error text, trimmed to what helps an author.
 *
 * Parse errors come with a source excerpt and a caret line, which are kept —
 * they point at the mistake — but the token list after "Expecting" can run
 * to hundreds of characters and is cut.
 */
export function mermaidErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/No diagram type detected/i.test(raw)) {
    return 'Unknown diagram type. Start with a type such as flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, gantt, pie or mindmap.';
  }
  const message = raw
    .replace(/^Error:\s*/, '')
    .replace(/Expecting [^\n]*/g, (line) => (line.length > 170 ? `${line.slice(0, 170)}…` : line))
    .trim();
  if (!message) return 'The diagram could not be drawn.';
  return message.length > 600 ? `${message.slice(0, 600)}…` : message;
}

const CACHE_LIMIT = 64;
const cache = new Map<string, { result: MermaidRenderResult; id: string }>();
let sequence = 0;
let queue: Promise<unknown> = Promise.resolve();

function nextId(): string {
  sequence += 1;
  return `cw-mermaid-${sequence}`;
}

/**
 * A cached SVG under a new element id.
 *
 * Mermaid scopes its stylesheet and arrow markers to the SVG's id. The same
 * diagram shown twice — in the document and in a review card — would put two
 * elements with one id on the page, and removing the first would leave the
 * second's `url(#…)` markers pointing at nothing.
 */
function withFreshId(entry: { result: MermaidRenderResult; id: string }): MermaidRenderResult {
  if (!entry.result.ok) return entry.result;
  return { ...entry.result, svg: entry.result.svg.split(entry.id).join(nextId()) };
}

function remember(key: string, entry: { result: MermaidRenderResult; id: string }): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

const LOAD_FAILED: MermaidRenderResult = {
  ok: false,
  error: 'The diagram renderer could not be loaded. Check the connection and try again.',
};

async function draw(source: string, theme: MermaidTheme, id: string): Promise<MermaidRenderResult> {
  let mermaid: Mermaid;
  try {
    mermaid = await loadMermaid();
  } catch {
    return LOAD_FAILED;
  }
  const config: MermaidConfig = {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: theme.variables,
    fontFamily: theme.fontFamily,
    // Throw instead of painting Mermaid's "bomb" error SVG into <body>.
    suppressErrorRendering: true,
    maxTextSize: MAX_MERMAID_SOURCE,
    maxEdges: 500,
    // Mermaid's default spacing is sized for a full-width page; a document
    // column is ~650px, and every pixel of gap is a pixel of label scale.
    flowchart: { nodeSpacing: 32, rankSpacing: 40, padding: 12 },
  };
  try {
    mermaid.initialize(config);
    await mermaid.parse(source);
    const { svg, diagramType } = await mermaid.render(id, source);
    return { ok: true, svg, diagramType };
  } catch (error) {
    return { ok: false, error: mermaidErrorMessage(error) };
  } finally {
    // A render that threw after creating its scratch node leaves it behind.
    document.getElementById(`d${id}`)?.remove();
  }
}

/**
 * Draw `source` as an SVG string in `theme`.
 *
 * Never rejects: an invalid diagram, an oversized one or a renderer that
 * failed to load all resolve to `{ ok: false, error }`. Results are cached per
 * theme and source, so re-mounting a diagram (scrolling a chat, leaving and
 * re-entering edit mode) does not lay it out again.
 */
export function renderMermaid(source: string, theme: MermaidTheme): Promise<MermaidRenderResult> {
  const text = source.trim();
  if (!text) return Promise.resolve({ ok: false, error: 'The diagram is empty.' });
  if (text.length > MAX_MERMAID_SOURCE) {
    return Promise.resolve({
      ok: false,
      error: `The diagram is too long to draw (${text.length.toLocaleString()} characters; the limit is ${MAX_MERMAID_SOURCE.toLocaleString()}).`,
    });
  }
  const key = `${theme.key}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) {
    remember(key, hit);
    return Promise.resolve(withFreshId(hit));
  }
  const id = nextId();
  const job = queue.then(() => draw(text, theme, id));
  queue = job.catch(() => undefined);
  return job.then((result) => {
    // A failed chunk load is the network, not the diagram: the next attempt
    // should try again rather than replay the failure.
    if (result !== LOAD_FAILED) remember(key, { result, id });
    return result;
  });
}

/**
 * A drawing already in the cache, or null — synchronously, for a component's
 * first paint. Without it every remount (leaving edit mode, a chat row
 * scrolling back in) flashes the loading state for a frame before the cached
 * result arrives.
 */
export function cachedMermaid(source: string, theme: MermaidTheme): MermaidRenderResult | null {
  const hit = cache.get(`${theme.key}\u0000${source.trim()}`);
  return hit ? withFreshId(hit) : null;
}

/** The diagram's SVG as a standalone file, with the XML prolog viewers expect. */
export function mermaidSvgFile(svg: string): Blob {
  const withNamespace = /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg)
    ? svg
    : svg.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${withNamespace}`], {
    type: 'image/svg+xml;charset=utf-8',
  });
}

/** For tests: forget cached renders and the loaded module. */
export function resetMermaidForTests(): void {
  cache.clear();
  loader = null;
  queue = Promise.resolve();
}
