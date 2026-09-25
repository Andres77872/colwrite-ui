import { describe, expect, it } from 'vitest';
import { layeredLayout, type LayeredEdge, type LayeredItem, type LayeredOptions, type LayeredResult } from '../layered';

const OPTIONS: LayeredOptions = { itemGap: 22, rankGap: 30, dummyGap: 10 };

let orderSeq = 0;

/** A box of `width` × `height` whose anchor is its centre. */
function item(id: string, extra: Partial<LayeredItem> & { width?: number; height?: number } = {}): LayeredItem {
  const { width = 60, height = 26, ...rest } = extra;
  return {
    id,
    order: orderSeq++,
    main: height,
    before: width / 2,
    after: width / 2,
    rank: null,
    beside: null,
    sameRank: null,
    ...rest,
  };
}

function items(...ids: string[]): LayeredItem[] {
  return ids.map((id) => item(id));
}

function edge(spec: string, extra: Partial<LayeredEdge> = {}): LayeredEdge {
  const [from, to] = spec.split('->').map((s) => s.trim());
  return { from, to, weight: 1, constraint: true, labelMain: 0, ...extra };
}

function edges(...specs: string[]): LayeredEdge[] {
  return specs.map((spec) => edge(spec));
}

function rankOf(result: LayeredResult, id: string): number {
  const rank = result.rank.get(id);
  if (rank === undefined) throw new Error(`no rank for ${id}`);
  return rank;
}

function crossOf(result: LayeredResult, id: string): number {
  const value = result.cross.get(id);
  if (value === undefined) throw new Error(`no cross position for ${id}`);
  return value;
}

/** Ids of one layer, left to right. */
function layerOrder(result: LayeredResult, rank: number): string[] {
  return [...result.rank.entries()]
    .filter(([, r]) => r === rank)
    .map(([id]) => id)
    .sort((a, b) => crossOf(result, a) - crossOf(result, b));
}

/** No two items of a layer overlap across the flow, and all sit inside the extents. */
function expectNoOverlap(result: LayeredResult, list: LayeredItem[], gap = OPTIONS.itemGap): void {
  const byId = new Map(list.map((i) => [i.id, i]));
  const layers = new Map<number, string[]>();
  for (const [id, rank] of result.rank) layers.set(rank, [...(layers.get(rank) ?? []), id]);
  for (const ids of layers.values()) {
    const sorted = ids.sort((a, b) => crossOf(result, a) - crossOf(result, b));
    for (let k = 1; k < sorted.length; k += 1) {
      const a = byId.get(sorted[k - 1])!;
      const b = byId.get(sorted[k])!;
      const space = crossOf(result, b.id) - b.before - (crossOf(result, a.id) + a.after);
      expect(space).toBeGreaterThanOrEqual(gap - 1e-6);
    }
  }
  for (const i of list) {
    const c = crossOf(result, i.id);
    expect(c - i.before).toBeGreaterThanOrEqual(-1e-6);
    expect(c + i.after).toBeLessThanOrEqual(result.crossExtent + 1e-6);
    const m = result.main.get(i.id)!;
    expect(m).toBeGreaterThanOrEqual(-1e-6);
    expect(m + i.main).toBeLessThanOrEqual(result.mainExtent + 1e-6);
  }
}

describe('layeredLayout — ranks', () => {
  it('returns an empty layout for no items', () => {
    const result = layeredLayout([], [], OPTIONS);
    expect(result.cross.size).toBe(0);
    expect(result.crossExtent).toBe(0);
    expect(result.mainExtent).toBe(0);
    expect(result.bands).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('lays a single item out at the origin', () => {
    const result = layeredLayout([item('a', { width: 80, height: 30 })], [], OPTIONS);
    expect(crossOf(result, 'a')).toBe(40);
    expect(result.main.get('a')).toBe(0);
    expect(result.crossExtent).toBe(80);
    expect(result.mainExtent).toBe(30);
    expect(result.bands).toEqual([[0, 30]]);
  });

  it('assigns longest-path ranks so inputs share the first layer', () => {
    const list = items('q', 'k', 'v', 'matmul', 'softmax', 'out');
    const result = layeredLayout(list, edges('q -> matmul', 'k -> matmul', 'matmul -> softmax', 'softmax -> out', 'v -> out'), OPTIONS);
    expect(['q', 'k', 'v'].map((id) => rankOf(result, id))).toEqual([0, 0, 0]);
    expect(rankOf(result, 'matmul')).toBe(1);
    expect(rankOf(result, 'softmax')).toBe(2);
    expect(rankOf(result, 'out')).toBe(3);
  });

  it('ignores self loops, unknown endpoints and duplicate item ids', () => {
    const list = [...items('a', 'b'), item('a', { width: 500 })];
    const result = layeredLayout(list, edges('a -> a', 'a -> ghost', 'ghost -> b', 'a -> b'), OPTIONS);
    expect(result.rank.size).toBe(2);
    expect(rankOf(result, 'b')).toBe(1);
    // The first definition of `a` wins.
    expect(result.crossExtent).toBe(60);
  });

  it('breaks cycles in declaration order', () => {
    const result = layeredLayout(items('a', 'b', 'c'), edges('a -> b', 'b -> c', 'c -> a'), OPTIONS);
    expect([rankOf(result, 'a'), rankOf(result, 'b'), rankOf(result, 'c')]).toEqual([0, 1, 2]);
  });

  it('lets non-constraint edges order but not rank', () => {
    const result = layeredLayout(
      items('a', 'b', 'c'),
      [edge('a -> b'), edge('b -> c', { constraint: false })],
      OPTIONS,
    );
    expect(rankOf(result, 'c')).toBe(0);
    expect(rankOf(result, 'b')).toBe(1);
  });

  it('treats a numeric rank as a lower bound', () => {
    const list = [item('a'), item('b'), item('c', { rank: 2 }), item('d')];
    const result = layeredLayout(list, edges('a -> b', 'b -> d'), OPTIONS);
    expect(rankOf(result, 'c')).toBe(2);
    expect(rankOf(result, 'd')).toBe(2);
    expect(result.diagnostics).toEqual([]);
  });

  it('warns and ignores a rank its inputs contradict', () => {
    const list = [item('a'), item('b'), item('c', { rank: 1, path: 'nodes[2]', range: [10, 20] })];
    const result = layeredLayout(list, edges('a -> b', 'b -> c'), OPTIONS);
    expect(rankOf(result, 'c')).toBe(2);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'layout.rank-conflict',
      path: 'nodes[2].rank',
      range: [10, 20],
    });
  });

  it('drops layers nobody sits on', () => {
    const list = [item('a'), item('b', { rank: 5 })];
    const result = layeredLayout(list, edges('a -> b'), OPTIONS);
    expect(rankOf(result, 'b')).toBe(1);
    expect(result.bands).toHaveLength(2);
  });

  it('puts `first` on layer 0 and warns about its inputs', () => {
    const list = [item('a'), item('b'), item('c', { rank: 'first' })];
    const result = layeredLayout(list, edges('a -> b', 'b -> c'), OPTIONS);
    expect(rankOf(result, 'c')).toBe(0);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['layout.rank-conflict']);
  });

  it('puts `last` on the deepest layer, after its inputs', () => {
    const list = [item('legend', { rank: 'last' }), item('a'), item('b'), item('c'), item('out', { rank: 'last' })];
    const result = layeredLayout(list, edges('a -> b', 'b -> c', 'c -> out'), OPTIONS);
    expect(rankOf(result, 'out')).toBe(3);
    expect(rankOf(result, 'legend')).toBe(3);
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps `last` on the deepest existing layer when nothing feeds it', () => {
    const list = [item('a'), item('b'), item('note', { rank: 'last' })];
    const result = layeredLayout(list, edges('a -> b'), OPTIONS);
    expect(rankOf(result, 'note')).toBe(1);
  });

  it('warns when a `last` item feeds others', () => {
    const list = [item('a', { rank: 'last' }), item('b')];
    const result = layeredLayout(list, edges('a -> b'), OPTIONS);
    expect(rankOf(result, 'a')).toBe(0);
    expect(rankOf(result, 'b')).toBe(0);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['layout.rank-conflict']);
  });

  it('puts a `beside` item on its anchor layer and ignores its own inputs', () => {
    const list = [item('x'), item('attn'), item('add'), item('pe', { beside: { id: 'add', before: true } })];
    const result = layeredLayout(list, edges('x -> attn', 'attn -> add', 'x -> pe', 'pe -> add'), OPTIONS);
    expect(rankOf(result, 'pe')).toBe(rankOf(result, 'add'));
    expect(layerOrder(result, rankOf(result, 'add'))).toEqual(['pe', 'add']);
  });

  it('places a `beside` item right after its anchor by default', () => {
    const list = [item('a'), item('b'), item('c'), item('side', { beside: { id: 'a', before: false } })];
    const result = layeredLayout(list, edges('a -> c', 'b -> c'), OPTIONS);
    expect(layerOrder(result, 0)).toEqual(['a', 'side', 'b']);
  });

  it('keeps `beside` adjacency through the crossing sweeps', () => {
    // The sweeps want to reorder layer 1; the side input must stay glued.
    const list = [
      item('a'),
      item('b'),
      item('y'),
      item('x'),
      item('s', { beside: { id: 'x', before: true } }),
    ];
    const result = layeredLayout(list, edges('a -> x', 'b -> y'), OPTIONS);
    const order = layerOrder(result, 1);
    expect(order.indexOf('s') + 1).toBe(order.indexOf('x'));
  });

  it('ignores a `beside` naming a stranger or itself, with a warning', () => {
    const list = [item('a'), item('b', { beside: { id: 'nope', before: false }, path: 'nodes[1]' }), item('c', { beside: { id: 'c', before: false } })];
    const result = layeredLayout(list, edges('a -> b'), OPTIONS);
    expect(rankOf(result, 'b')).toBe(1);
    expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['layout.hint-ignored', 'nodes[1].beside'],
      ['layout.hint-ignored', undefined],
    ]);
  });

  it('survives a `beside` cycle', () => {
    const list = [item('a', { beside: { id: 'b', before: false } }), item('b', { beside: { id: 'a', before: false } }), item('c')];
    const result = layeredLayout(list, edges('c -> a'), OPTIONS);
    expect(rankOf(result, 'a')).toBe(rankOf(result, 'b'));
    expect(result.rank.size).toBe(3);
  });

  it('moves a `sameRank` item to the named sibling’s layer', () => {
    const list = [item('a'), item('b'), item('c'), item('d', { sameRank: 'b' })];
    const result = layeredLayout(list, edges('a -> b', 'b -> c', 'a -> c', 'c -> d'), OPTIONS);
    expect(rankOf(result, 'd')).toBe(rankOf(result, 'b'));
    // Naming a later item still shares its layer.
    const list2 = [item('p', { sameRank: 'r' }), item('q'), item('r')];
    const result2 = layeredLayout(list2, edges('p -> q', 'q -> r'), OPTIONS);
    expect(rankOf(result2, 'r')).toBe(rankOf(result2, 'p'));
  });

  it('keeps the inputs of a `sameRank` target declared after the hint', () => {
    const list = [item('a'), item('y', { sameRank: 'b' }), item('b'), item('c')];
    const result = layeredLayout(list, edges('a -> b', 'b -> c'), OPTIONS);
    expect(['a', 'y', 'b', 'c'].map((id) => rankOf(result, id))).toEqual([0, 1, 1, 2]);
    expect(result.diagnostics).toEqual([]);
  });

  it('lays an unrolled LSTM out one step per layer', () => {
    // Inputs and hidden states are declared before the cell state they share
    // a step with, as a model writes them.
    const list = [
      item('c0'),
      item('h0'),
      ...[1, 2, 3].flatMap((t) => [item(`x${t}`, { sameRank: `c${t}` }), item(`h${t}`, { sameRank: `c${t}` })]),
      item('c1'),
      item('c2'),
      item('c3'),
    ];
    const specs = ['c0 -> c1', 'h0 -> c1'];
    for (const t of [1, 2, 3]) {
      specs.push(`x${t} -> c${t}`, `c${t} -> h${t}`);
      if (t < 3) specs.push(`c${t} -> c${t + 1}`, `h${t} -> c${t + 1}`);
    }
    const result = layeredLayout(list, edges(...specs), OPTIONS);
    expect([rankOf(result, 'c0'), rankOf(result, 'h0')]).toEqual([0, 0]);
    for (const t of [1, 2, 3]) {
      for (const id of [`x${t}`, `h${t}`, `c${t}`]) expect(rankOf(result, id)).toBe(t);
    }
    // Every edge between steps runs with the flow; the ones inside a step are flat.
    for (const spec of specs) {
      const [from, to] = spec.split(' -> ');
      const step = (id: string) => Number(id.slice(1));
      expect(rankOf(result, to) - rankOf(result, from)).toBe(step(to) === step(from) ? 0 : 1);
    }
    expect(result.bands).toHaveLength(4);
    expectNoOverlap(result, list);
    expect(result.diagnostics).toEqual([]);
  });

  it('warns when a follower also has a rank', () => {
    const list = [item('a'), item('b', { beside: { id: 'a', before: false }, rank: 3 })];
    const result = layeredLayout(list, [], OPTIONS);
    expect(rankOf(result, 'b')).toBe(0);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['layout.rank-conflict']);
  });
});

describe('layeredLayout — ordering', () => {
  it('keeps declaration order when reordering gains nothing', () => {
    const list = items('root', 'c', 'a', 'b');
    const result = layeredLayout(list, edges('root -> c', 'root -> a', 'root -> b'), OPTIONS);
    expect(layerOrder(result, 1)).toEqual(['c', 'a', 'b']);
  });

  it('keeps declaration order of disconnected items', () => {
    const result = layeredLayout(items('z', 'y', 'x'), [], OPTIONS);
    expect(layerOrder(result, 0)).toEqual(['z', 'y', 'x']);
  });

  it('removes a crossing the declaration order would cause', () => {
    const list = items('a', 'b', 'x', 'y');
    const result = layeredLayout(list, edges('a -> y', 'b -> x'), OPTIONS);
    expect(layerOrder(result, 0)).toEqual(['a', 'b']);
    expect(layerOrder(result, 1)).toEqual(['y', 'x']);
  });

  it('routes long edges through dummy slots that stay beside the stack', () => {
    // Residual: x feeds add directly, skipping attn. The channel takes the
    // source's (earlier) side, so it lands left of the stack.
    const list = items('x', 'attn', 'add');
    const result = layeredLayout(list, edges('x -> attn', 'attn -> add', 'x -> add'), OPTIONS);
    expect(result.crossExtent).toBeCloseTo(60 + 10 + 10, 6);
    expect(crossOf(result, 'attn')).toBeGreaterThan(10);
  });
});

describe('layeredLayout — positions', () => {
  it('aligns a chain exactly on the anchor centres', () => {
    const list = [
      item('a', { width: 40 }),
      item('b', { width: 120 }),
      item('c', { before: 10, after: 70 }),
      item('d', { width: 90 }),
    ];
    const result = layeredLayout(list, edges('a -> b', 'b -> c', 'c -> d'), OPTIONS);
    const xs = list.map((i) => crossOf(result, i.id));
    for (const x of xs) expect(x).toBeCloseTo(xs[0], 9);
    // The widest `before` and `after` set the extent.
    expect(Math.min(...list.map((i) => crossOf(result, i.id) - i.before))).toBeCloseTo(0, 9);
    expect(result.crossExtent).toBeCloseTo(60 + 70, 9);
  });

  it('keeps the main stack straight next to a residual channel', () => {
    const list = items('x', 'attn', 'norm', 'add');
    const result = layeredLayout(list, edges('x -> attn', 'attn -> norm', 'norm -> add', 'x -> add'), OPTIONS);
    const xs = ['x', 'attn', 'norm', 'add'].map((id) => crossOf(result, id));
    for (const x of xs) expect(x).toBeCloseTo(xs[0], 6);
  });

  it('centres a node between its two inputs', () => {
    const list = items('q', 'k', 'matmul');
    const result = layeredLayout(list, edges('q -> matmul', 'k -> matmul'), OPTIONS);
    expect(crossOf(result, 'matmul')).toBeCloseTo((crossOf(result, 'q') + crossOf(result, 'k')) / 2, 6);
    expectNoOverlap(result, list);
  });

  it('centres a fan-out under its source', () => {
    const list = items('src', 'a', 'b', 'c');
    const result = layeredLayout(list, edges('src -> a', 'src -> b', 'src -> c'), OPTIONS);
    expect(crossOf(result, 'src')).toBeCloseTo(crossOf(result, 'b'), 6);
    expect(layerOrder(result, 1)).toEqual(['a', 'b', 'c']);
    expectNoOverlap(result, list);
  });

  it('never overlaps items of a layer, including a dense graph', () => {
    const list = Array.from({ length: 14 }, (_, i) => item(`n${i}`, { width: 30 + ((i * 17) % 50) }));
    const specs: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      for (const j of [i + 1, i + 3, i + 5]) if (j < 14 && (i + j) % 3 !== 0) specs.push(`n${i} -> n${j}`);
    }
    const result = layeredLayout(list, edges(...specs), OPTIONS);
    expectNoOverlap(result, list);
  });

  it('keeps dummy slots apart from real items by the dummy gap', () => {
    const list = items('a', 'b', 'c');
    const result = layeredLayout(list, edges('a -> b', 'b -> c', 'a -> c'), OPTIONS);
    // Width: the stack (60) plus one slot (10) and its gap (10).
    expect(result.crossExtent).toBeCloseTo(80, 6);
  });

  it('puts a pinned channel on its side of the items it passes', () => {
    const run = (channel?: 'before' | 'after') => {
      orderSeq = 0;
      const list = items('x', 'attn', 'add');
      return {
        list,
        result: layeredLayout(list, [edge('x -> attn'), edge('attn -> add'), edge('x -> add', { channel })], OPTIONS),
      };
    };
    const before = run('before');
    expect(crossOf(before.result, 'attn') - 30).toBeCloseTo(20, 6);
    const after = run('after');
    expect(crossOf(after.result, 'attn') - 30).toBeCloseTo(0, 6);
    expect(after.result.crossExtent).toBeCloseTo(80, 6);
    for (const { result } of [before, after]) {
      expect(crossOf(result, 'x')).toBeCloseTo(crossOf(result, 'attn'), 6);
      expect(crossOf(result, 'add')).toBeCloseTo(crossOf(result, 'attn'), 6);
    }
  });

  it('keeps room beside a long edge’s channel for its label', () => {
    const list = items('x', 'attn', 'add');
    const result = layeredLayout(
      list,
      [edge('x -> attn'), edge('attn -> add'), edge('x -> add', { channel: 'after', channelRoom: { before: 0, after: 30 } })],
      OPTIONS,
    );
    expect(result.crossExtent).toBeCloseTo(60 + 10 + 10 + 30, 6);
  });

  it('snaps a near-miss alignment straight when there is room', () => {
    // An MLA-like graph: the concat node's pull towards the attention block
    // lands it a few px off one of its inputs.
    const list = [item('h', { width: 40 }), ...items('cq', 'ckv', 'kr', 'qc', 'qr', 'kc', 'vc', 'qcat', 'kcat'), item('mha', { width: 140 }), item('u', { width: 40 })];
    const specs = ['h -> cq', 'h -> ckv', 'h -> kr', 'cq -> qc', 'cq -> qr', 'ckv -> kc', 'ckv -> vc', 'qc -> qcat', 'qr -> qcat', 'kc -> kcat', 'kr -> kcat', 'qcat -> mha', 'kcat -> mha', 'vc -> mha', 'mha -> u'];
    const result = layeredLayout(list, edges(...specs), OPTIONS);
    const offsets = ['qc', 'qr', 'mha'].map((id) => Math.abs(crossOf(result, id) - crossOf(result, 'qcat')));
    expect(Math.min(...offsets)).toBeLessThan(1e-6);
    expect(crossOf(result, 'u')).toBeCloseTo(crossOf(result, 'mha'), 9);
    expectNoOverlap(result, list);
  });

  it('widens the gap between a flat pair for a labelled edge', () => {
    const list = [item('a'), item('side', { beside: { id: 'a', before: false } })];
    const result = layeredLayout(list, [edge('side -> a', { labelCross: 40 })], OPTIONS);
    const space = crossOf(result, 'side') - 30 - (crossOf(result, 'a') + 30);
    expect(space).toBeCloseTo(52, 6);
  });

  it('is deterministic', () => {
    const build = () => {
      orderSeq = 0;
      const list = items('a', 'b', 'c', 'd', 'e', 'f', 'g');
      return layeredLayout(list, edges('a -> c', 'b -> c', 'a -> e', 'c -> d', 'd -> f', 'e -> f', 'b -> g', 'g -> f'), OPTIONS);
    };
    const first = build();
    const second = build();
    expect([...second.cross]).toEqual([...first.cross]);
    expect([...second.main]).toEqual([...first.main]);
    expect(second.bands).toEqual(first.bands);
  });

  it('does not depend on the order items are passed in', () => {
    const list = items('a', 'b', 'c', 'd');
    const e = edges('a -> c', 'b -> c', 'c -> d');
    const forward = layeredLayout(list, e, OPTIONS);
    const shuffled = layeredLayout([list[2], list[0], list[3], list[1]], e, OPTIONS);
    expect([...shuffled.cross.entries()].sort()).toEqual([...forward.cross.entries()].sort());
  });
});

describe('layeredLayout — main axis', () => {
  it('stacks bands with the rank gap and centres items in their band', () => {
    const list = [item('a', { height: 40 }), item('b', { height: 20 }), item('c', { height: 30 })];
    const result = layeredLayout(list, edges('a -> c', 'b -> c'), OPTIONS);
    expect(result.bands).toEqual([
      [0, 40],
      [70, 100],
    ]);
    expect(result.main.get('a')).toBe(0);
    expect(result.main.get('b')).toBe(10);
    expect(result.main.get('c')).toBe(70);
    expect(result.mainExtent).toBe(100);
  });

  it('widens the gaps a labelled edge crosses', () => {
    const list = items('a', 'b', 'c');
    const result = layeredLayout(list, [edge('a -> b'), edge('b -> c'), edge('a -> c', { labelMain: 40 })], OPTIONS);
    const [b0, b1, b2] = result.bands;
    expect(b1[0] - b0[1]).toBe(52);
    expect(b2[0] - b1[1]).toBe(52);
  });

  it('keeps the rank gap when the label is small', () => {
    const result = layeredLayout(items('a', 'b'), [edge('a -> b', { labelMain: 12 })], OPTIONS);
    expect(result.bands[1][0] - result.bands[0][1]).toBe(30);
  });

  it('sanitises negative sizes and weights', () => {
    const list = [item('a', { main: -5, before: -1, after: Number.NaN }), item('b')];
    const result = layeredLayout(list, [edge('a -> b', { weight: -3, labelMain: -1 })], OPTIONS);
    expect(result.main.get('a')).toBe(0);
    expect(Number.isFinite(crossOf(result, 'a'))).toBe(true);
    expect(result.bands[1][0]).toBe(30);
  });
});
