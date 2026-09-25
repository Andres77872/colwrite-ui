import { beforeEach, describe, expect, it } from 'vitest';
import { compileFigure, describeFigure, figureMeta, resetFigureCacheForTests } from '../compile';
import { inflateRect, rectsOverlap } from '../geometry';
import { createHeuristicMeasurer } from '../measure';
import { FIGURE_TEMPLATES } from '../templates';
import type { FigureScene, Point, Rect } from '../types';

const measurer = createHeuristicMeasurer();

beforeEach(() => resetFigureCacheForTests());

function inside(outer: Rect, inner: Rect, slack = 0.5): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

/** Whether the axis-aligned segment a→b passes through the interior of `rect`. */
function segmentCrosses(a: Point, b: Point, rect: Rect): boolean {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  return x2 > rect.x && x1 < rect.x + rect.width && y2 > rect.y && y1 < rect.y + rect.height;
}

function checkScene(scene: FigureScene, label: string) {
  const everything: Rect = { x: 0, y: 0, width: scene.width, height: scene.height };
  for (const node of scene.nodes) {
    expect(inside(everything, node.bounds), `${label}: node ${node.id} inside the figure`).toBe(true);
  }
  // Sibling nodes never overlap.
  for (let i = 0; i < scene.nodes.length; i += 1) {
    for (let j = i + 1; j < scene.nodes.length; j += 1) {
      const a = scene.nodes[i];
      const b = scene.nodes[j];
      expect(rectsOverlap(a.shape, b.shape, 0.5), `${label}: ${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
  // Every node sits inside every group that contains it.
  for (const group of scene.groups) {
    for (const node of scene.nodes) {
      let parent = node.model.parent;
      let contained = false;
      while (parent) {
        if (parent === group.id) {
          contained = true;
          break;
        }
        const next = scene.groups.find((candidate) => candidate.id === parent)?.model.parent;
        if (!next || next === parent) break;
        parent = next;
      }
      if (contained) {
        expect(inside(group.box, node.shape, 1), `${label}: ${node.id} inside group ${group.id}`).toBe(true);
      }
    }
  }
  // Orthogonal routes are axis-aligned and never cut through a node they do
  // not connect; nothing an edge paints falls outside the canvas.
  for (const edge of scene.edges) {
    expect(edge.d.length, `${label}: edge ${edge.id} has a path`).toBeGreaterThan(0);
    for (const point of edge.points) {
      expect(inside(everything, { ...point, width: 0, height: 0 }), `${label}: ${edge.id} point inside the figure`).toBe(true);
    }
    if (edge.label) expect(inside(everything, edge.label), `${label}: ${edge.id} label inside the figure`).toBe(true);
    if (edge.model.route !== 'ortho' || edge.model.from === edge.model.to) continue;
    const points = edge.points;
    for (let k = 1; k < points.length; k += 1) {
      const a = points[k - 1];
      const b = points[k];
      expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01, `${label}: ${edge.id} segment ${k} is axis-aligned`).toBe(true);
      for (const node of scene.nodes) {
        if (node.id === edge.model.from || node.id === edge.model.to) continue;
        const grown = inflateRect(node.shape, -1);
        if (grown.width <= 0 || grown.height <= 0) continue;
        expect(segmentCrosses(a, b, grown), `${label}: ${edge.id} crosses ${node.id}`).toBe(false);
      }
    }
  }
}

describe('templates', () => {
  it('ships a useful set', () => {
    expect(FIGURE_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    const ids = FIGURE_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['sdpa', 'mha', 'transformer', 'mla', 'moe']));
  });

  for (const template of FIGURE_TEMPLATES) {
    it(`${template.id} compiles cleanly and lays out without collisions`, () => {
      const compiled = compileFigure(template.source, measurer);
      const problems = compiled.diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error' || (diagnostic.severity === 'warning' && diagnostic.code !== 'print.small-text'),
      );
      expect(problems).toEqual([]);
      expect(compiled.ok).toBe(true);
      expect(compiled.scene).not.toBeNull();
      checkScene(compiled.scene!, template.id);
      expect(figureMeta(template.source).caption).toBeTruthy();
      expect(describeFigure(compiled.model!).length).toBeGreaterThan(20);
    });
  }
});

describe('compileFigure', () => {
  it('reports an empty spec, bad JSON and a crash-free edge to nowhere', () => {
    expect(compileFigure('', measurer)).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: 'figure.empty' })] });

    const broken = compileFigure('{"nodes": [', measurer);
    expect(broken.ok).toBe(false);
    expect(broken.diagnostics[0]).toMatchObject({ severity: 'error', line: 1 });

    const dangling = compileFigure('{"nodes": ["a", "b"], "edges": ["a -> b", "a -> nope"]}', measurer);
    expect(dangling.ok).toBe(true);
    expect(dangling.scene!.edges).toHaveLength(1);
    expect(dangling.diagnostics.some((diagnostic) => diagnostic.code === 'edge.unknown-node')).toBe(true);
  });

  it('caches by source and measurer, and is deterministic', () => {
    const source = FIGURE_TEMPLATES[0].source;
    const first = compileFigure(source, measurer);
    expect(compileFigure(source, measurer)).toBe(first);
    resetFigureCacheForTests();
    const again = compileFigure(source, measurer);
    expect(again).not.toBe(first);
    expect(JSON.stringify(again.scene)).toBe(JSON.stringify(first.scene));
  });

  it('warns when a figure is too wide to print legibly', () => {
    const nodes = Array.from({ length: 14 }, (_, index) => ({ id: `n${index}`, label: `Stage number ${index}` }));
    const edges = nodes.slice(1).map((node, index) => `n${index} -> ${node.id}`);
    const wide = compileFigure(JSON.stringify({ direction: 'right', nodes, edges }), measurer);
    expect(wide.diagnostics.some((diagnostic) => diagnostic.code === 'print.small-text')).toBe(true);
  });

  it('warns about print size for an explicit "size", which fixes the printed width', () => {
    const chain = (size: string) =>
      JSON.stringify({ size, caption: 'Small.', direction: 'right', nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], edges: ['a -> b -> c -> d -> e -> f -> g -> h'] });
    const small = compileFigure(chain('small'), measurer);
    // Narrow enough for the column at natural size, so only the share makes it small.
    expect(small.scene!.width).toBeLessThan(616);
    const warning = small.diagnostics.find((diagnostic) => diagnostic.code === 'print.small-text');
    expect(warning?.message).toContain('"size": "small"');
    for (const size of ['auto', 'full']) {
      expect(compileFigure(chain(size), measurer).diagnostics.some((diagnostic) => diagnostic.code === 'print.small-text')).toBe(false);
    }
  });

  it('counts legend text as essential when checking print size', () => {
    const compiled = compileFigure(
      JSON.stringify({ nodes: ['a', 'b'], edges: ['a -> b'], legend: [{ label: 'Cached', tone: 'teal' }] }),
      measurer,
    );
    const legend = compiled.scene!.legend!.items[0].label.font.size;
    expect(legend).toBeLessThan(12);
    expect(compiled.scene!.legibleScale).toBeCloseTo(6.5 / (legend * 0.75), 6);
  });

  it('keeps loops and every edge label inside the canvas, moved with the drawing', () => {
    const specs = [
      {
        layout: 'grid',
        nodes: [
          { id: 'n0', label: 'Add & Norm' },
          { id: 'n1', shape: 'hexagon' },
          { id: 'n2', stack: 3 },
          { id: 'g', children: ['n3'], label: 'Encoder', layout: 'column' },
        ],
        edges: [
          'n3.top => n1',
          { from: 'n2', to: 'n2', label: '$y$', toSide: 'top' },
          { from: 'n3', to: 'n3', toSide: 'top' },
          'n3.top ..> n0: a much longer edge label',
        ],
      },
      // A self-loop's label left of the drawing: the canvas grows left for it.
      {
        layout: 'column',
        direction: 'left',
        nodes: [
          { id: 'n0', stack: 3 },
          { id: 'n1', stack: 3 },
          { id: 'n2', label: 'x' },
          { id: 'n3', shape: 'hexagon' },
          { id: 'n4', shape: 'hexagon' },
          'n5',
          { id: 'g', label: 'Encoder', layout: 'column', children: ['n6'] },
        ],
        edges: ['n3 => n3: a much longer edge label', { from: 'n1', to: 'n0', label: 'z', toSide: 'right' }, 'n6.top -> n2'],
      },
    ];
    for (const spec of specs) {
      const compiled = compileFigure(JSON.stringify(spec), measurer);
      expect(compiled.ok).toBe(true);
      checkScene(compiled.scene!, 'labelled loops');
      // The stroke data moved with the points: it starts where the route does.
      for (const edge of compiled.scene!.edges) {
        if (edge.start) continue;
        const [x, y] = edge.d.slice(1).split(/[LAC]/)[0].split(' ').map(Number);
        expect(x).toBeCloseTo(edge.points[0].x, 1);
        expect(y).toBeCloseTo(edge.points[0].y, 1);
      }
    }
  });

  it('routes around a sibling that sits closer than the clearance', () => {
    const specs = [
      { layout: 'column', gap: 8, nodes: ['a', 'b', 'c'], edges: ['a -> c'] },
      { layout: 'row', gap: 4, nodes: ['a', 'b', 'c'], edges: ['a -> c'] },
      { layout: 'row', gap: 12, nodes: ['a', 'b', 'c'], edges: ['a -> c'] },
      { layout: 'grid', columns: 3, gap: 8, nodes: ['a', 'b', 'c', 'd', 'e', 'f'], edges: ['a -> c', 'a -> f', 'd -> f'] },
      { direction: 'right', nodes: [{ id: 'g', layout: 'row', gap: 6, children: ['a', 'b', 'c'] }], edges: ['a -> c'] },
    ];
    for (const spec of specs) {
      const compiled = compileFigure(JSON.stringify(spec), measurer);
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code.startsWith('route.'))).toEqual([]);
      checkScene(compiled.scene!, JSON.stringify(spec));
    }
  });

  it('routes every edge of a grouped figure within the budget, orthogonally', () => {
    const groups = Array.from({ length: 7 }, (_, g) => ({ id: `g${g}`, label: `G${g}`, children: [0, 1, 2].map((n) => `g${g}n${n}`) }));
    const edges = [
      'g6n0 -> g2n0', 'g5n1 -> g2n2', 'g3n0 -> g2n1', 'g3n1 -> g4n1', 'g5n1 -> g6n0', 'g3n1 -> g2n0', 'g2n0 -> g6n0', 'g2n1 -> g2n1', 'g6n2 -> g5n0',
      'g5n0 -> g5n1', 'g0n0 -> g5n1', 'g2n1 -> g3n2', 'g1n2 -> g3n2', 'g1n1 -> g1n2', 'g0n0 -> g3n0', 'g4n0 -> g0n2', 'g6n1 -> g6n0',
    ];
    const compiled = compileFigure(JSON.stringify({ nodes: groups, edges }), measurer);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code.startsWith('route.'))).toEqual([]);
    checkScene(compiled.scene!, 'seven groups');
  });

  it('describes a figure for screen readers', () => {
    const compiled = compileFigure('{"nodes": [{"id": "a", "label": "Encoder"}, "b"], "edges": ["a -> b"]}', measurer);
    expect(describeFigure(compiled.model!)).toBe('Diagram with 2 elements and 1 connection. Connections: Encoder to b.');
  });
});

describe('figureMeta', () => {
  it('reads the caption the renderer prints, however the spec spells it', () => {
    for (const source of [
      '{"caption": "Map form", "nodes": {"a": {"label": "A"}, "b": "B"}, "edges": ["a -> b"]}',
      '{"Caption": "Map form", "Nodes": ["a", "b"]}',
      '{"CAPTION": "Map form", "Label": "fig:a", "nodes": ["a"]}',
      '{"caption": "  Map form  ", "nodes": ["a"]}',
    ]) {
      const meta = figureMeta(source);
      const compiled = compileFigure(source, measurer);
      expect(compiled.ok).toBe(true);
      expect(meta).toMatchObject({ caption: 'Map form', empty: false });
      expect(meta.caption).toBe(compiled.model!.caption);
      expect(meta.label).toBe(compiled.model!.label);
    }
    expect(figureMeta('{"caption": 2024, "nodes": ["a"]}').caption).toBe('2024');
  });

  it('gives a starter no caption, so it takes no figure number, but keeps its draft', () => {
    expect(figureMeta('{"caption": "A figure still to draw.", "nodes": []}')).toEqual({
      caption: null,
      label: null,
      title: null,
      empty: true,
      draft: 'A figure still to draw.',
    });
    expect(figureMeta('{"Caption": "Still to draw."}')).toMatchObject({ caption: null, empty: true, draft: 'Still to draw.' });
  });

  it('never numbers a spec that cannot draw, and does not take it for a starter', () => {
    for (const source of ['{"caption": "Broken", "nodes": [', '"just text"', '{"caption": "Bad", "nodes": [null]}']) {
      expect(figureMeta(source), source).toMatchObject({ caption: null, empty: false, draft: null });
    }
    expect(figureMeta('')).toMatchObject({ caption: null, empty: false });
  });

  it('agrees with every template', () => {
    for (const template of FIGURE_TEMPLATES) {
      const model = compileFigure(template.source, measurer).model!;
      expect(figureMeta(template.source)).toMatchObject({ caption: model.caption, label: model.label, title: model.title, empty: false });
    }
  });
});

describe('compileFigure — speed', () => {
  /** Deterministic pseudo-random edges. */
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }
  const moe = (experts: number) => {
    const ids = Array.from({ length: experts }, (_, i) => `e${i}`);
    return JSON.stringify({
      direction: 'right',
      nodes: ['x', { id: 'router', role: 'router' }, { id: 'experts', label: 'Experts', children: ids }, { id: 'sum', role: 'op', label: '+' }],
      edges: ['x -> router', { from: 'router', to: ids }, { from: ids, to: 'sum' }],
    });
  };
  const flat = (nodes: number, edges: number, seed: number) => {
    const next = random(seed);
    const ids = Array.from({ length: nodes }, (_, i) => `v${i}`);
    const list = Array.from({ length: edges }, () => {
      const a = Math.floor(next() * nodes);
      const b = (a + 1 + Math.floor(next() * (nodes - 1))) % nodes;
      return `v${a} -> v${b}`;
    });
    return JSON.stringify({ nodes: ids, edges: list });
  };
  const grouped = (groups: number, per: number, edges: number, seed: number) => {
    const next = random(seed);
    const pick = () => `g${Math.floor(next() * groups)}n${Math.floor(next() * per)}`;
    return JSON.stringify({
      nodes: Array.from({ length: groups }, (_, g) => ({ id: `g${g}`, label: `G${g}`, children: Array.from({ length: per }, (_, n) => `g${g}n${n}`) })),
      edges: Array.from({ length: edges }, () => `${pick()} -> ${pick()}`),
    });
  };
  function timed(source: string) {
    const started = performance.now();
    const compiled = compileFigure(source, measurer);
    return { compiled, elapsed: performance.now() - started };
  }
  /** Every orthogonal edge between two items is drawn with right angles only, even when it took a simple route. */
  function expectRightAngles(scene: FigureScene) {
    for (const edge of scene.edges) {
      if (edge.model.route !== 'ortho' || edge.model.from === edge.model.to) continue;
      edge.points.slice(1).forEach((b, k) => {
        const a = edge.points[k];
        expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01, `${edge.id} is orthogonal`).toBe(true);
      });
    }
  }

  // Generous for CI; on a laptop these take a fraction of it.
  it('compiles a figure at the item and edge caps in bounded time, with simple routes past the budget', () => {
    const { compiled, elapsed } = timed(flat(400, 800, 1));
    expect(compiled.ok).toBe(true);
    expect(compiled.scene!.edges).toHaveLength(800);
    expect(elapsed).toBeLessThan(3000);
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.code === 'route.budget')).toBe(true);
    expectRightAngles(compiled.scene!);
  });

  it('compiles twenty groups of eight with 200 edges in bounded time', () => {
    const { compiled, elapsed } = timed(grouped(20, 8, 200, 3));
    expect(compiled.ok).toBe(true);
    expect(elapsed).toBeLessThan(3000);
    expectRightAngles(compiled.scene!);
  });

  it('routes a 40-expert mixture of experts carefully and quickly', () => {
    const { compiled, elapsed } = timed(moe(40));
    expect(elapsed).toBeLessThan(1500);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code.startsWith('route.'))).toEqual([]);
    checkScene(compiled.scene!, 'moe-40');
  });

  it('keeps ordinary figures fast', () => {
    for (const source of [moe(12), flat(40, 80, 5), ...FIGURE_TEMPLATES.map((template) => template.source)]) {
      resetFigureCacheForTests();
      const { compiled, elapsed } = timed(source);
      expect(elapsed).toBeLessThan(750);
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code.startsWith('route.'))).toEqual([]);
    }
  });
});

describe('maths that cannot be typeset', () => {
  it('is reported where it is written, and the figure still draws', () => {
    const source = JSON.stringify({
      caption: 'Bad $\\frac{a$ caption',
      nodes: [{ id: 'a', label: 'Fine $x^2$' }, { id: 'b', label: 'Broken $\\notacommand{x}$' }],
      edges: [{ from: 'a', to: 'b', label: '$}$' }],
    });
    const compiled = compileFigure(source, measurer);
    expect(compiled.ok).toBe(true);
    const math = compiled.diagnostics.filter((diagnostic) => diagnostic.code === 'label.math-invalid');
    expect(math.map((diagnostic) => diagnostic.message)).toEqual([
      expect.stringContaining('the caption'),
      expect.stringContaining('node "b"'),
      expect.stringContaining('edge a → b'),
    ]);
    expect(math[1].line).toBe(1);
  });
});
