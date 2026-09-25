import type { FigureDiagnostic } from './types';

/**
 * Layered (Sugiyama) layout of one container's children.
 *
 * It works on abstract axes: `main` runs along the flow, so layers stack
 * along it, and `cross` runs across it, so the items of one layer sit side by
 * side. layout.ts maps the axes to x/y for each direction, so this module
 * never needs to know whether a figure flows down, up, right or left.
 *
 *   ranks (longest path + hints) ─▶ dummy slots for long edges
 *     ─▶ order (barycentre sweeps; declaration order unless a sweep helps)
 *     ─▶ cross positions (weighted-median alignment, solved with PAVA)
 *     ─▶ main positions (bands and the gaps between them)
 *
 * Everything is deterministic: ties always fall back to declaration order.
 */

export type LayeredItem = {
  id: string;
  order: number;
  /** Extent along the flow axis. */
  main: number;
  /** Extent across the flow axis, split around the anchor centre so anchors (not bounds) line up. */
  before: number;
  after: number;
  rank: number | 'first' | 'last' | null;
  beside: { id: string; before: boolean } | null;
  sameRank: string | null;
  /** Where the item is defined, so a hint it breaks can point at the source. */
  path?: string;
  range?: [number, number];
};

export type LayeredEdge = {
  from: string;
  to: string;
  weight: number;
  constraint: boolean;
  /** Extra room the edge's label needs in the gap between its layers, along the flow axis. */
  labelMain: number;
  /**
   * Room the label needs across the flow when the edge joins two items of
   * one layer (a `beside` input with a labelled arrow).
   */
  labelCross?: number;
  /**
   * Which side of the items it passes a long edge's channel should take,
   * when the router is going to use that side anyway (a residual entering
   * its target from the left, a pinned `toSide`). Unset: wherever crossings
   * are fewest.
   */
  channel?: 'before' | 'after';
  /** Room across the flow beside a long edge's channel, for its label. */
  channelRoom?: { before: number; after: number };
};

export type LayeredOptions = { itemGap: number; rankGap: number; dummyGap: number };

export type LayeredResult = {
  /**
   * Anchor-centre cross coordinate per item, and the main coordinate where
   * the item starts (its band's start, centred within the band). Both ≥ 0.
   */
  cross: Map<string, number>;
  main: Map<string, number>;
  rank: Map<string, number>;
  /** Total extents. */
  crossExtent: number;
  mainExtent: number;
  /** Rank band [start, end] along the main axis, index = rank. */
  bands: Array<[number, number]>;
  diagnostics: FigureDiagnostic[];
};

/** Barycentre sweeps tried when ordering the layers. */
const ORDER_SWEEPS = 12;
/** Alternating down/up alignment passes when positioning. */
const POSITION_PASSES = 8;
/**
 * How much harder the inner segments of a long edge hold their line than an
 * edge between two real items: a channel that wobbles reads as two edges.
 */
const LONG_EDGE_STRAIGHTNESS = 4;
/** Pull of an item with no neighbour on the side being aligned: it moves only when pushed. */
const FREE_WEIGHT = 1e-3;
/**
 * Room around an edge label on top of the label itself (its gap to the line,
 * both sides). layout.ts keeps the same room between row, column and grid
 * neighbours, so a label reads the same in every arrangement.
 */
export const LABEL_ROOM = 12;
/**
 * A near-miss alignment under this many px is snapped straight when there
 * is room: an orthogonal edge would otherwise draw it as a tiny jog, which
 * reads as a glitch rather than an offset.
 */
const SNAP_DISTANCE = 8;

type Link = { to: number; weight: number };

type Vertex = {
  /** Item id; empty for a dummy slot. */
  id: string;
  dummy: boolean;
  rank: number;
  main: number;
  before: number;
  after: number;
  /**
   * Initial-order keys: the item's declaration order (a dummy uses its
   * source's, so a long edge starts where its source is), then — for
   * dummies — the target's order and the chain's sequence.
   */
  key: number;
  key2: number;
  seq: number;
  /** Neighbours in the previous / next layer. */
  up: Link[];
  down: Link[];
};

type CleanEdge = {
  from: number;
  to: number;
  weight: number;
  constraint: boolean;
  labelMain: number;
  labelCross: number;
  channel: 'before' | 'after' | null;
  roomBefore: number;
  roomAfter: number;
};

type Chain = Pick<CleanEdge, 'from' | 'to' | 'weight' | 'channel' | 'roomBefore' | 'roomAfter'>;

function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function hintDiagnostic(code: string, message: string, item: LayeredItem, key?: string): FigureDiagnostic {
  const diagnostic: FigureDiagnostic = { severity: 'warning', code, message };
  if (item.path) diagnostic.path = key ? `${item.path}.${key}` : item.path;
  if (item.range) diagnostic.range = item.range;
  return diagnostic;
}

/* ────────────────────────────────────────────────────────────────────────
 * 1–3. Ranks
 * ──────────────────────────────────────────────────────────────────────── */

type RankOutcome = {
  ranks: number[];
  /** Validated `beside` anchors (acyclic), by item index. */
  besideOf: Array<{ anchor: number; before: boolean } | null>;
};

/**
 * Longest-path layering with the author's hints.
 *
 * `beside` and `sameRank` join items into one layer class whose leader's
 * inputs decide the layer. The item carrying the hint is the follower and its
 * own inputs are ignored, so a side input never drags its anchor down; an item
 * without a hint is never a follower, so a named sibling keeps its inputs.
 * `first` pins a class to layer 0 and `last` puts it on the deepest layer,
 * after everything else.
 */
function assignRanks(items: LayeredItem[], index: Map<string, number>, edges: CleanEdge[], diagnostics: FigureDiagnostic[]): RankOutcome {
  const n = items.length;
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const follow = (follower: number, leader: number) => {
    const a = find(follower);
    const b = find(leader);
    if (a !== b) parent[a] = b;
  };

  const besideOf: RankOutcome['besideOf'] = items.map(() => null);
  items.forEach((item, i) => {
    if (item.beside) {
      const anchor = index.get(item.beside.id);
      if (anchor === undefined || anchor === i) {
        diagnostics.push(
          hintDiagnostic(
            'layout.hint-ignored',
            `\`${item.id}\` is placed beside \`${item.beside.id}\`, which is not another item of the same container, so the hint is ignored.`,
            item,
            'beside',
          ),
        );
      } else {
        follow(i, anchor);
        besideOf[i] = { anchor, before: item.beside.before };
      }
      if (item.sameRank !== null) {
        diagnostics.push(
          hintDiagnostic(
            'layout.hint-ignored',
            `\`${item.id}\` has both \`beside\` and \`sameRank\`; \`beside\` decides its layer.`,
            item,
            'sameRank',
          ),
        );
      }
    } else if (item.sameRank !== null) {
      const other = index.get(item.sameRank);
      if (other === undefined || other === i) {
        diagnostics.push(
          hintDiagnostic(
            'layout.hint-ignored',
            `\`${item.id}\` should share a layer with \`${item.sameRank}\`, which is not another item of the same container, so the hint is ignored.`,
            item,
            'sameRank',
          ),
        );
      } else {
        // The hinted item moves to the named sibling's layer, as with
        // `beside`: the sibling keeps its own inputs whatever the declaration
        // order (a model often declares `x_t` before the cell it feeds).
        follow(i, other);
      }
    }
  });

  // A `beside` chain that loops back cannot be pulled adjacent; the pair
  // still shares a layer, but the ordering treats them as ordinary items.
  for (let i = 0; i < n; i += 1) {
    let cursor = besideOf[i]?.anchor;
    for (let steps = 0; cursor !== undefined && steps <= n; steps += 1) {
      if (cursor === i) {
        besideOf[i] = null;
        break;
      }
      cursor = besideOf[cursor]?.anchor;
    }
  }

  const leaderOf = items.map((_, i) => find(i));
  const hintOf = (c: number) => items[c].rank;
  items.forEach((item, i) => {
    if (leaderOf[i] !== i && item.rank !== null) {
      diagnostics.push(
        hintDiagnostic(
          'layout.rank-conflict',
          `\`${item.id}\` takes its layer from \`${items[leaderOf[i]].id}\`, so its \`rank\` is ignored.`,
          item,
          'rank',
        ),
      );
    }
  });

  // Constraint edges between layer classes.
  const out: number[][] = items.map(() => []);
  const classEdges: Array<[number, number]> = [];
  const seen = new Set<string>();
  const firstWithInputs = new Set<number>();
  const lastWithOutputs = new Set<number>();
  for (const edge of edges) {
    if (!edge.constraint) continue;
    const a = leaderOf[edge.from];
    const b = leaderOf[edge.to];
    if (a === b) continue; // Same layer: drawn flat.
    if (b !== edge.to) continue; // Into a follower: its layer comes from its leader.
    if (hintOf(b) === 'first') {
      firstWithInputs.add(b);
      continue;
    }
    if (hintOf(a) === 'last') {
      if (hintOf(b) !== 'last') lastWithOutputs.add(a);
      continue;
    }
    const key = `${a}>${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out[a].push(classEdges.length);
    classEdges.push([a, b]);
  }
  for (const c of firstWithInputs) {
    diagnostics.push(
      hintDiagnostic(
        'layout.rank-conflict',
        `\`${items[c].id}\` has rank "first" but has inputs in its container; those edges run against the flow.`,
        items[c],
        'rank',
      ),
    );
  }
  for (const c of lastWithOutputs) {
    diagnostics.push(
      hintDiagnostic(
        'layout.rank-conflict',
        `\`${items[c].id}\` has rank "last" but feeds other items in its container; those edges run against the flow.`,
        items[c],
        'rank',
      ),
    );
  }

  // Cycle breaking: a depth-first search in declaration order reverses every
  // edge that closes a cycle. (The reversed edge is implied by the path that
  // closed the cycle, so it never changes a rank; it only removes the loop.)
  const reversed = new Array<boolean>(classEdges.length).fill(false);
  const state = new Uint8Array(n); // 0 new, 1 on the stack, 2 done
  for (let start = 0; start < n; start += 1) {
    if (leaderOf[start] !== start || state[start] !== 0) continue;
    const stack: Array<{ v: number; next: number }> = [{ v: start, next: 0 }];
    state[start] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.next < out[top.v].length) {
        const e = out[top.v][top.next];
        top.next += 1;
        const w = classEdges[e][1];
        if (state[w] === 1) reversed[e] = true;
        else if (state[w] === 0) {
          state[w] = 1;
          stack.push({ v: w, next: 0 });
        }
      } else {
        state[top.v] = 2;
        stack.pop();
      }
    }
  }

  // Longest path from the sources, in topological order.
  const succ: number[][] = items.map(() => []);
  const indegree = new Array<number>(n).fill(0);
  const dagSeen = new Set<string>();
  classEdges.forEach(([a, b], e) => {
    const [from, to] = reversed[e] ? [b, a] : [a, b];
    const key = `${from}>${to}`;
    if (dagSeen.has(key)) return;
    dagSeen.add(key);
    succ[from].push(to);
    indegree[to] += 1;
  });
  const lowerBound = (c: number): number => {
    const hint = hintOf(c);
    return typeof hint === 'number' && Number.isFinite(hint) ? Math.max(0, Math.floor(hint)) : 0;
  };
  const need = new Array<number>(n).fill(0);
  const classRank = new Array<number>(n).fill(0);
  const queue: number[] = [];
  for (let c = 0; c < n; c += 1) if (leaderOf[c] === c && indegree[c] === 0) queue.push(c);
  for (let head = 0; head < queue.length; head += 1) {
    const c = queue[head];
    const bound = lowerBound(c);
    classRank[c] = Math.max(bound, need[c]);
    const hint = hintOf(c);
    if (typeof hint === 'number' && need[c] > bound) {
      diagnostics.push(
        hintDiagnostic(
          'layout.rank-conflict',
          `\`${items[c].id}\` asks for rank ${hint}, but its inputs place it at rank ${need[c]} or later; the hint is ignored.`,
          items[c],
          'rank',
        ),
      );
    }
    for (const d of succ[c]) {
      need[d] = Math.max(need[d], classRank[c] + 1);
      indegree[d] -= 1;
      if (indegree[d] === 0) queue.push(d);
    }
  }

  // `last` goes on the deepest layer the others reach (or right after its inputs).
  let deepest = 0;
  for (let c = 0; c < n; c += 1) if (leaderOf[c] === c) deepest = Math.max(deepest, classRank[c]);
  for (let c = 0; c < n; c += 1) if (leaderOf[c] === c && hintOf(c) === 'last') classRank[c] = deepest;

  // Compact: layers nobody sits on are dropped, so the first layer is 0 and
  // a numeric hint never leaves an empty band.
  const raw = items.map((_, i) => classRank[leaderOf[i]]);
  const distinct = [...new Set(raw)].sort((a, b) => a - b);
  const dense = new Map(distinct.map((value, i) => [value, i]));
  return { ranks: raw.map((value) => dense.get(value) ?? 0), besideOf };
}

/* ────────────────────────────────────────────────────────────────────────
 * 5. Ordering
 * ──────────────────────────────────────────────────────────────────────── */

/** Weighted count of crossings between consecutive layers (Barth–Jünger–Mutzel with a Fenwick tree). */
function countCrossings(layers: number[][], vertices: Vertex[], pos: Int32Array): number {
  let total = 0;
  for (let r = 0; r + 1 < layers.length; r += 1) {
    const size = layers[r + 1].length;
    if (size < 2) continue;
    const segments: Array<[number, number, number]> = [];
    for (const v of layers[r]) {
      for (const link of vertices[v].down) segments.push([pos[v], pos[link.to], link.weight]);
    }
    if (segments.length < 2) continue;
    segments.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const tree = new Float64Array(size + 1);
    let inserted = 0;
    for (const [, lower, weight] of segments) {
      // Weight already inserted at lower positions ≤ `lower`.
      let atOrBelow = 0;
      for (let i = lower + 1; i > 0; i -= i & -i) atOrBelow += tree[i];
      total += weight * (inserted - atOrBelow);
      for (let i = lower + 1; i <= size; i += i & -i) tree[i] += weight;
      inserted += weight;
    }
  }
  return total;
}

function updatePositions(layer: number[], pos: Int32Array): void {
  layer.forEach((v, i) => {
    pos[v] = i;
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * 6. Cross positions
 * ──────────────────────────────────────────────────────────────────────── */

type Pull = { at: number; weight: number };

/** Weighted median; an even split lands halfway, so a node fed by two sources centres between them. */
function weightedMedian(pulls: Pull[]): number {
  if (pulls.length === 1) return pulls[0].at;
  const sorted = [...pulls].sort((a, b) => a.at - b.at);
  const total = sorted.reduce((sum, p) => sum + p.weight, 0);
  const half = total / 2;
  const eps = total * 1e-9;
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    cumulative += sorted[i].weight;
    if (Math.abs(cumulative - half) <= eps && i + 1 < sorted.length) return (sorted[i].at + sorted[i + 1].at) / 2;
    if (cumulative > half) return sorted[i].at;
  }
  return sorted[sorted.length - 1].at;
}

/**
 * Pool-adjacent-violators for a non-decreasing fit with two-tier weights:
 * a block's value is the mean of its primary targets when it has any, and
 * of its secondary targets otherwise. That is the limit of ordinary weighted
 * PAVA as the secondary weights shrink to nothing, so a real item's
 * alignment is never traded for a dummy's.
 */
function isotonic(targets: Float64Array, primary: Float64Array, secondary: Float64Array): Float64Array {
  const n = targets.length;
  const start: number[] = [];
  const pw: number[] = [];
  const pwt: number[] = [];
  const sw: number[] = [];
  const swt: number[] = [];
  const value = (b: number) => (pw[b] > 0 ? pwt[b] / pw[b] : swt[b] / sw[b]);
  for (let i = 0; i < n; i += 1) {
    start.push(i);
    pw.push(primary[i]);
    pwt.push(primary[i] * targets[i]);
    sw.push(secondary[i]);
    swt.push(secondary[i] * targets[i]);
    while (start.length > 1 && value(start.length - 2) > value(start.length - 1)) {
      const last = start.length - 1;
      pw[last - 1] += pw[last];
      pwt[last - 1] += pwt[last];
      sw[last - 1] += sw[last];
      swt[last - 1] += swt[last];
      start.pop();
      pw.pop();
      pwt.pop();
      sw.pop();
      swt.pop();
    }
  }
  const out = new Float64Array(n);
  for (let b = 0; b < start.length; b += 1) {
    const end = b + 1 < start.length ? start[b + 1] : n;
    const v = value(b);
    for (let i = start[b]; i < end; i += 1) out[i] = v;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────
 * The layout
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Lay out one container's children in layers along its flow.
 *
 * Items are real children; edges are the model's edges lifted to those
 * children. Edges that run against the final layering (feedback, broken
 * cycles) get no dummy slots: the router takes them around the outside.
 */
export function layeredLayout(items: LayeredItem[], edges: LayeredEdge[], options: LayeredOptions): LayeredResult {
  const diagnostics: FigureDiagnostic[] = [];
  const itemGap = nonNegative(options.itemGap);
  const rankGap = nonNegative(options.rankGap);
  const dummyGap = nonNegative(options.dummyGap);

  // Declaration order, first definition of an id wins.
  const list: LayeredItem[] = [];
  const index = new Map<string, number>();
  items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.order - b.item.order || a.i - b.i)
    .forEach(({ item }) => {
      if (index.has(item.id)) return;
      index.set(item.id, list.length);
      list.push(item);
    });

  const empty: LayeredResult = {
    cross: new Map(),
    main: new Map(),
    rank: new Map(),
    crossExtent: 0,
    mainExtent: 0,
    bands: [],
    diagnostics,
  };
  if (list.length === 0) return empty;

  const clean: CleanEdge[] = [];
  for (const edge of edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    clean.push({
      from,
      to,
      weight: Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1,
      constraint: edge.constraint,
      labelMain: nonNegative(edge.labelMain),
      labelCross: nonNegative(edge.labelCross ?? 0),
      channel: edge.channel ?? null,
      roomBefore: nonNegative(edge.channelRoom?.before ?? 0),
      roomAfter: nonNegative(edge.channelRoom?.after ?? 0),
    });
  }

  const { ranks, besideOf } = assignRanks(list, index, clean, diagnostics);
  const layerCount = Math.max(...ranks) + 1;

  /* 4. Vertices, long-edge chains and label room */
  const vertices: Vertex[] = list.map((item, i) => ({
    id: item.id,
    dummy: false,
    rank: ranks[i],
    main: nonNegative(item.main),
    before: nonNegative(item.before),
    after: nonNegative(item.after),
    key: item.order,
    key2: 0,
    seq: i,
    up: [],
    down: [],
  }));
  const gapNeed = new Array<number>(Math.max(0, layerCount - 1)).fill(0);
  const flatRoom = new Map<string, number>();
  const pairKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const chains = new Map<string, Chain>();
  for (const edge of clean) {
    const ra = ranks[edge.from];
    const rb = ranks[edge.to];
    if (ra === rb) {
      if (edge.labelCross > 0) {
        const key = pairKey(edge.from, edge.to);
        flatRoom.set(key, Math.max(flatRoom.get(key) ?? 0, edge.labelCross));
      }
      continue;
    }
    if (edge.labelMain > 0) {
      for (let g = Math.min(ra, rb); g < Math.max(ra, rb); g += 1) {
        gapNeed[g] = Math.max(gapNeed[g], edge.labelMain + LABEL_ROOM);
      }
    }
    if (ra > rb) continue; // Against the flow: routed around the outside.
    // Parallel edges share one channel; the router spreads them apart.
    const key = `${edge.from}>${edge.to}`;
    const chain = chains.get(key);
    if (chain) {
      chain.weight += edge.weight;
      chain.channel ??= edge.channel;
      chain.roomBefore = Math.max(chain.roomBefore, edge.roomBefore);
      chain.roomAfter = Math.max(chain.roomAfter, edge.roomAfter);
    } else {
      const { from, to, weight, channel, roomBefore, roomAfter } = edge;
      chains.set(key, { from, to, weight, channel, roomBefore, roomAfter });
    }
  }
  const link = (a: number, b: number, weight: number) => {
    vertices[a].down.push({ to: b, weight });
    vertices[b].up.push({ to: a, weight });
  };
  let chainSeq = 0;
  for (const chain of chains.values()) {
    let previous = chain.from;
    for (let r = ranks[chain.from] + 1; r < ranks[chain.to]; r += 1) {
      const dummy = vertices.length;
      vertices.push({
        id: '',
        dummy: true,
        rank: r,
        main: 0,
        before: dummyGap / 2 + chain.roomBefore,
        after: dummyGap / 2 + chain.roomAfter,
        // A pinned channel starts at its end of the layer; the sweeps only
        // move it inwards, next to the items it runs beside.
        key: chain.channel === 'before' ? -Infinity : chain.channel === 'after' ? Infinity : list[chain.from].order,
        key2: list[chain.to].order,
        seq: chainSeq,
        up: [],
        down: [],
      });
      link(previous, dummy, chain.weight);
      previous = dummy;
    }
    link(previous, chain.to, chain.weight);
    chainSeq += 1;
  }

  /* 5. Ordering */
  let layers: number[][] = Array.from({ length: layerCount }, () => []);
  vertices.forEach((vertex, v) => layers[vertex.rank].push(v));
  for (const layer of layers) {
    layer.sort((a, b) => {
      const va = vertices[a];
      const vb = vertices[b];
      return (
        compareNumbers(va.key, vb.key) ||
        Number(va.dummy) - Number(vb.dummy) ||
        compareNumbers(va.key2, vb.key2) ||
        va.seq - vb.seq ||
        a - b
      );
    });
  }

  const pullBeside = (layer: number[]): number[] => {
    const pulled = new Map<number, { before: number[]; after: number[] }>();
    const followers = new Set<number>();
    for (const v of layer) {
      const hint = v < list.length ? besideOf[v] : null;
      if (!hint) continue;
      followers.add(v);
      const entry = pulled.get(hint.anchor) ?? { before: [], after: [] };
      (hint.before ? entry.before : entry.after).push(v);
      pulled.set(hint.anchor, entry);
    }
    if (followers.size === 0) return layer;
    const result: number[] = [];
    const emit = (v: number) => {
      const entry = pulled.get(v);
      entry?.before.forEach(emit);
      result.push(v);
      entry?.after.forEach(emit);
    };
    for (const v of layer) if (!followers.has(v)) emit(v);
    return result;
  };

  const pos = new Int32Array(vertices.length);
  layers = layers.map((layer) => pullBeside(layer));
  layers.forEach((layer) => updatePositions(layer, pos));

  let best = layers.map((layer) => layer.slice());
  let bestCrossings = countCrossings(layers, vertices, pos);
  for (let sweep = 0; sweep < ORDER_SWEEPS && bestCrossings > 0 && layerCount > 1; sweep += 1) {
    const down = sweep % 2 === 0;
    for (let step = 1; step < layerCount; step += 1) {
      const r = down ? step : layerCount - 1 - step;
      const layer = layers[r];
      const sortable: Array<{ v: number; i: number; bc: number }> = [];
      const fixed: Array<{ v: number; i: number }> = [];
      layer.forEach((v, i) => {
        const links = down ? vertices[v].up : vertices[v].down;
        if (links.length === 0) {
          fixed.push({ v, i });
          return;
        }
        let sum = 0;
        let weight = 0;
        for (const l of links) {
          sum += pos[l.to] * l.weight;
          weight += l.weight;
        }
        sortable.push({ v, i, bc: sum / weight });
      });
      sortable.sort((a, b) => a.bc - b.bc || a.i - b.i);
      // Items without neighbours on this side keep their slot index.
      const next: number[] = [];
      let f = 0;
      for (const entry of sortable) {
        while (f < fixed.length && fixed[f].i <= next.length) next.push(fixed[f++].v);
        next.push(entry.v);
      }
      while (f < fixed.length) next.push(fixed[f++].v);
      layers[r] = pullBeside(next);
      updatePositions(layers[r], pos);
    }
    const crossings = countCrossings(layers, vertices, pos);
    // Strictly better only: when nothing beats it, the author's order stays.
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      best = layers.map((layer) => layer.slice());
    }
  }
  layers = best;
  layers.forEach((layer) => updatePositions(layer, pos));

  /* 6. Cross positions */
  const separation = (a: number, b: number): number => {
    const va = vertices[a];
    const vb = vertices[b];
    let gap = va.dummy || vb.dummy ? dummyGap : itemGap;
    if (!va.dummy && !vb.dummy) {
      const room = flatRoom.get(pairKey(a, b));
      if (room !== undefined) gap = Math.max(gap, room + LABEL_ROOM);
    }
    return va.after + gap + vb.before;
  };
  const offsets = layers.map((layer) => {
    const c = new Float64Array(layer.length);
    for (let k = 1; k < layer.length; k += 1) c[k] = c[k - 1] + separation(layer[k - 1], layer[k]);
    return c;
  });

  const x = new Float64Array(vertices.length);
  layers.forEach((layer, r) => {
    if (layer.length === 0) return;
    const c = offsets[r];
    const left = -vertices[layer[0]].before;
    const right = c[layer.length - 1] + vertices[layer[layer.length - 1]].after;
    const shift = -(left + right) / 2;
    layer.forEach((v, k) => {
      x[v] = c[k] + shift;
    });
  });

  const solveLayer = (r: number, down: boolean) => {
    const layer = layers[r];
    const n = layer.length;
    const targets = new Float64Array(n);
    const primary = new Float64Array(n);
    const secondary = new Float64Array(n);
    const c = offsets[r];
    layer.forEach((v, k) => {
      const vertex = vertices[v];
      const links = down ? vertex.up : vertex.down;
      // Real–real and dummy–dummy links align first; a long edge's ends
      // (real–dummy) only settle what those leave free.
      const strong: Pull[] = [];
      const weak: Pull[] = [];
      for (const l of links) {
        const other = vertices[l.to];
        if (other.dummy === vertex.dummy) {
          strong.push({ at: x[l.to], weight: l.weight * (vertex.dummy ? LONG_EDGE_STRAIGHTNESS : 1) });
        } else weak.push({ at: x[l.to], weight: l.weight });
      }
      let target = x[v];
      if (strong.length) {
        target = weightedMedian(strong);
        primary[k] = strong.reduce((sum, p) => sum + p.weight, 0);
      } else if (weak.length) {
        target = weightedMedian(weak);
        secondary[k] = weak.reduce((sum, p) => sum + p.weight, 0);
      } else secondary[k] = FREE_WEIGHT;
      targets[k] = target - c[k];
    });
    const solved = isotonic(targets, primary, secondary);
    layer.forEach((v, k) => {
      x[v] = solved[k] + c[k];
    });
  };
  for (let pass = 0; pass < POSITION_PASSES && layerCount > 1; pass += 1) {
    const down = pass % 2 === 0;
    for (let step = 1; step < layerCount; step += 1) solveLayer(down ? step : layerCount - 1 - step, down);
  }

  // Straighten near misses between real items. Items already in line with
  // a real neighbour never move, so a snap cannot break an alignment; the
  // snapped item may push a tight run of unaligned neighbours along with it.
  const aligned = (v: number) =>
    [...vertices[v].up, ...vertices[v].down].some((l) => !vertices[l.to].dummy && Math.abs(x[l.to] - x[v]) < 1e-6);
  const snap = (layer: number[], k: number, delta: number): void => {
    const step = delta > 0 ? 1 : -1;
    const moved: Array<[number, number]> = [[layer[k], x[layer[k]] + delta]];
    for (let j = k + step; j >= 0 && j < layer.length; j += step) {
      const [prev, prevAt] = moved[moved.length - 1];
      const cur = layer[j];
      const at = step > 0 ? Math.max(x[cur], prevAt + separation(prev, cur)) : Math.min(x[cur], prevAt - separation(cur, prev));
      if (at === x[cur]) break;
      if (!vertices[cur].dummy && aligned(cur)) return;
      moved.push([cur, at]);
    }
    for (const [v, at] of moved) x[v] = at;
  };
  for (const layer of layers) {
    layer.forEach((v, k) => {
      if (vertices[v].dummy || aligned(v)) return;
      let delta: number | null = null;
      for (const l of [...vertices[v].up, ...vertices[v].down]) {
        if (vertices[l.to].dummy) continue;
        const d = x[l.to] - x[v];
        if (Math.abs(d) <= SNAP_DISTANCE && (delta === null || Math.abs(d) < Math.abs(delta))) delta = d;
      }
      if (delta !== null) snap(layer, k, delta);
    });
  }

  let minCross = Infinity;
  let maxCross = -Infinity;
  vertices.forEach((vertex, v) => {
    minCross = Math.min(minCross, x[v] - vertex.before);
    maxCross = Math.max(maxCross, x[v] + vertex.after);
  });

  /* 7. Main positions */
  const thickness = layers.map((layer) => {
    let size = 0;
    let real = false;
    for (const v of layer) {
      if (vertices[v].dummy) continue;
      real = true;
      size = Math.max(size, vertices[v].main);
    }
    return real ? size : layer.length ? dummyGap : 0;
  });
  const bands: Array<[number, number]> = [];
  let cursor = 0;
  for (let r = 0; r < layerCount; r += 1) {
    if (r > 0) cursor += Math.max(rankGap, gapNeed[r - 1]);
    bands.push([cursor, cursor + thickness[r]]);
    cursor += thickness[r];
  }

  const result: LayeredResult = {
    cross: new Map(),
    main: new Map(),
    rank: new Map(),
    crossExtent: maxCross - minCross,
    mainExtent: cursor,
    bands,
    diagnostics,
  };
  list.forEach((item, i) => {
    const vertex = vertices[i];
    result.cross.set(item.id, x[i] - minCross);
    result.main.set(item.id, bands[vertex.rank][0] + (thickness[vertex.rank] - vertex.main) / 2);
    result.rank.set(item.id, vertex.rank);
  });
  return result;
}
