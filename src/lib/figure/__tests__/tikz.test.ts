import { describe, expect, it } from 'vitest';
import { FIGURE_METRICS, figureFont } from '../constants';
import { figureMathHtml } from '../math';
import { figurePalette } from '../palette';
import { figureToTikz } from '../tikz';
import {
  ROOT_ID,
  type EdgeModel,
  type FigureModel,
  type FigureScene,
  type FontSpec,
  type GroupModel,
  type Label,
  type LabelBox,
  type LabelSegment,
  type LegendItemModel,
  type NodeModel,
  type Point,
  type Rect,
  type SceneEdge,
  type SceneGroup,
  type SceneLegend,
  type SceneNode,
} from '../types';

/* ────────────────────────────────────────────────────────────────────────
 * Hand-built scenes (no parser, layout or router involved)
 * ──────────────────────────────────────────────────────────────────────── */

const text = (value: string): LabelSegment => ({ kind: 'text', value });
const math = (value: string): LabelSegment => ({ kind: 'math', value });

/** A label from explicit lines of segments. */
function lines(...rows: LabelSegment[][]): Label {
  const source = rows.map((row) => row.map((s) => (s.kind === 'math' ? `$${s.value}$` : s.value)).join('')).join('\n');
  return { lines: rows, source, hasMath: rows.some((row) => row.some((s) => s.kind === 'math')) };
}

/** A label from simple source: `\n` splits lines, `$…$` pairs are maths. */
function L(source: string): Label {
  return lines(
    ...source.split('\n').map((line) => {
      const parts = line.split('$');
      if (parts.length % 2 === 0) return [text(line)];
      return parts.map((part, i) => (i % 2 ? math(part) : text(part))).filter((s) => s.value !== '');
    }),
  );
}

const NODE_FONT = figureFont('sans', FIGURE_METRICS.font.node);

function box(label: Label, rect: Rect, font: FontSpec = NODE_FONT, align: LabelBox['align'] = 'center'): LabelBox {
  return {
    ...rect,
    label,
    font,
    align,
    lines: label.lines.map(() => ({ width: rect.width, height: rect.height / label.lines.length, segments: [] })),
    lineHeight: font.size * FIGURE_METRICS.lineHeight,
  };
}

/** A label box of the given size centred on a rect. */
function centredBox(label: Label, rect: Rect, width = rect.width - 24, height = 15, font = NODE_FONT): LabelBox {
  return box(label, { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height }, font);
}

let order = 0;

function nodeModel(id: string, overrides: Partial<NodeModel> = {}): NodeModel {
  return {
    kind: 'node',
    id,
    parent: ROOT_ID,
    order: order++,
    path: `nodes[${order}]`,
    label: L(id),
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

function sceneNode(model: NodeModel, rect: Rect, overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id: model.id,
    model,
    shape: rect,
    anchor: rect,
    bounds: rect,
    label: centredBox(model.label, rect, Math.max(4, rect.width - 24)),
    sublabel: null,
    repeat: null,
    badge: null,
    stackOffset: FIGURE_METRICS.node.stackOffset,
    direction: 'down',
    depth: 1,
    ...overrides,
  };
}

function node(id: string, rect: Rect, model: Partial<NodeModel> = {}, scene: Partial<SceneNode> = {}): SceneNode {
  return sceneNode(nodeModel(id, model), rect, scene);
}

function groupModel(id: string, overrides: Partial<GroupModel> = {}): GroupModel {
  return {
    kind: 'group',
    id,
    parent: ROOT_ID,
    order: order++,
    path: `nodes[${order}]`,
    label: L(id),
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

function group(id: string, rect: Rect, model: Partial<GroupModel> = {}, scene: Partial<SceneGroup> = {}): SceneGroup {
  const m = groupModel(id, model);
  const groupFont = figureFont('sans', FIGURE_METRICS.font.group, 600);
  return {
    id,
    model: m,
    box: rect,
    bounds: rect,
    label: m.label ? box(m.label, { x: rect.x + 12, y: rect.y + 6, width: 60, height: 14 }, groupFont, 'left') : null,
    repeat: null,
    panel: null,
    depth: 1,
    direction: 'down',
    ...scene,
  };
}

function edgeModel(from: string, to: string, overrides: Partial<EdgeModel> = {}): EdgeModel {
  return {
    id: `${from}->${to}#${order}`,
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
    order: order++,
    path: `edges[${order}]`,
    ...overrides,
  };
}

const TIP: SceneEdge['end'] = { tip: { x: 0, y: 0 }, polygon: [] };

function edge(
  from: string,
  to: string,
  points: Point[],
  model: Partial<EdgeModel> = {},
  scene: Partial<SceneEdge> = {},
): SceneEdge {
  const m = edgeModel(from, to, model);
  const arrow = m.arrow;
  return {
    id: m.id,
    model: m,
    points,
    d: '',
    start: arrow === 'start' || arrow === 'both' ? TIP : null,
    end: arrow === 'end' || arrow === 'both' ? TIP : null,
    label: null,
    ...scene,
  };
}

function figure(
  parts: { nodes?: SceneNode[]; groups?: SceneGroup[]; edges?: SceneEdge[]; legend?: SceneLegend | null },
  model: Partial<Omit<FigureModel, 'items' | 'root' | 'edges'>> = {},
  size: { width?: number; height?: number } = {},
): { scene: FigureScene; model: FigureModel } {
  const nodes = parts.nodes ?? [];
  const groups = parts.groups ?? [];
  const edges = parts.edges ?? [];
  const items = new Map<string, NodeModel | GroupModel>();
  for (const n of nodes) items.set(n.id, n.model);
  for (const g of groups) items.set(g.id, g.model);
  const figureModel: FigureModel = {
    title: null,
    caption: null,
    label: null,
    alt: null,
    size: 'auto',
    font: 'sans',
    palette: 'color',
    root: groupModel(ROOT_ID, { label: null, border: 'none', children: [...items.keys()] }),
    items,
    edges: edges.map((e) => e.model),
    legend: [],
    ...model,
  };
  const scene: FigureScene = {
    width: size.width ?? 400,
    height: size.height ?? 300,
    nodes,
    groups,
    legend: parts.legend ?? null,
    direction: 'down',
    diagnostics: [],
    edges,
    legibleScale: 0.7,
  };
  return { scene, model: figureModel };
}

function tikz(parts: Parameters<typeof figure>[0], model: Parameters<typeof figure>[1] = {}, options?: Parameters<typeof figureToTikz>[2]): string {
  const f = figure(parts, model);
  return figureToTikz(f.scene, f.model, options);
}

/* ────────────────────────────────────────────────────────────────────────
 * TeX well-formedness checks
 * ──────────────────────────────────────────────────────────────────────── */

/** Drop `%` comments (an unescaped `%` to the end of its line). */
function stripComments(tex: string): string {
  return tex
    .split('\n')
    .map((line) => {
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === '\\') i += 1;
        else if (line[i] === '%') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** Braces balance outside comments, never dipping below zero; `\{` and `\}` do not count. */
function bracesBalanced(tex: string): boolean {
  let depth = 0;
  const code = stripComments(tex);
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '\\') i += 1;
    else if (ch === '{') depth += 1;
    else if (ch === '}' && --depth < 0) return false;
  }
  return depth === 0;
}

function environmentsBalanced(tex: string): boolean {
  const stack: string[] = [];
  for (const match of stripComments(tex).matchAll(/\\(begin|end)\{([^}]*)\}/g)) {
    if (match[1] === 'begin') stack.push(match[2]);
    else if (stack.pop() !== match[2]) return false;
  }
  return stack.length === 0;
}

/** Every line toggles maths an even number of times (an unescaped `$`). */
function mathBalancedPerLine(tex: string): boolean {
  return stripComments(tex)
    .split('\n')
    .every((line) => {
      let dollars = 0;
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === '\\') i += 1;
        else if (line[i] === '$') dollars += 1;
      }
      return dollars % 2 === 0;
    });
}

/** Every TikZ statement sits on one line and ends with `;`. */
function statementsTerminated(tex: string): boolean {
  return stripComments(tex)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\\(node|draw|fill|path|useasboundingbox)\b/.test(line))
    .every((line) => line.endsWith(';'));
}

/** A `\node` whose text breaks lines with `\\` has `align=`; without it TikZ ignores the breaks. */
function breaksAligned(tex: string): boolean {
  return statements(stripComments(tex), '\\node[').every((line) => {
    const options = line.slice(0, line.indexOf(']'));
    return !line.includes(' \\\\ ') || options.includes('align=');
  });
}

/** Characters pdfLaTeX's utf8 input reads: ASCII, Latin-1 and Latin Extended-A. */
function pdfLatexReadable(tex: string): boolean {
  return Array.from(stripComments(tex)).every((ch) => (ch.codePointAt(0) ?? 0) <= 0x17f);
}

/** The control words of TeX code outside comments. */
function controlWords(tex: string): string[] {
  return [...stripComments(tex).matchAll(/\\([A-Za-z@]+)/g)].map((m) => m[1]);
}

function expectWellFormed(tex: string): void {
  expect(bracesBalanced(tex)).toBe(true);
  expect(environmentsBalanced(tex)).toBe(true);
  expect(mathBalancedPerLine(tex)).toBe(true);
  expect(statementsTerminated(tex)).toBe(true);
  expect(breaksAligned(tex)).toBe(true);
  expect(pdfLatexReadable(tex)).toBe(true);
  const code = stripComments(tex);
  expect(code.split('[').length).toBe(code.split(']').length);
  expect(tex).not.toMatch(/NaN|undefined|Infinity|\[object /);
}

function definedColors(tex: string): Map<string, string> {
  return new Map([...tex.matchAll(/\\definecolor\{(\w+)\}\{HTML\}\{([0-9A-F]{6})\}/g)].map((m) => [m[1], m[2]]));
}

function hex(css: string): string {
  return css.replace('#', '').toUpperCase();
}

/** The `\draw`/`\node` statement lines, without indentation. */
function statements(tex: string, prefix: string): string[] {
  return tex
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix));
}

/* ────────────────────────────────────────────────────────────────────────
 * Tests
 * ──────────────────────────────────────────────────────────────────────── */

describe('figureToTikz — document frame', () => {
  it('opens with the preamble the snippet needs and draws in px with y down', () => {
    const out = tikz({ nodes: [node('a', { x: 20, y: 20, width: 80, height: 30 })] });
    expect(out).toContain('%   \\usepackage{tikz}');
    expect(out).toContain('%   \\usetikzlibrary{arrows.meta,shapes.geometric,patterns,calc}');
    expect(out).toContain('\\begin{tikzpicture}[x=0.75pt,y=-0.75pt, font=\\sffamily\\fontsize{9}{11}\\selectfont]');
    expect(out).toContain('\\useasboundingbox (0,0) rectangle (400,300);');
    // No maths anywhere: no AMS requirement.
    expect(out).not.toContain('amsmath');
    expectWellFormed(out);
  });

  it('switches the picture font to \\rmfamily for serif figures', () => {
    const a = nodeModel('a');
    const rect = { x: 20, y: 20, width: 80, height: 30 };
    const serif = figureFont('serif', FIGURE_METRICS.font.node);
    const out = tikz(
      { nodes: [sceneNode(a, rect, { label: centredBox(a.label, rect, 56, 15, serif) })] },
      { font: 'serif' },
    );
    expect(out).toContain('font=\\rmfamily\\fontsize{9}{11}\\selectfont]');
    expect(out).not.toContain('\\sffamily');
  });

  it('wraps the picture in a figure with the caption (maths kept, text escaped) and label', () => {
    const out = tikz(
      { nodes: [node('a', { x: 20, y: 20, width: 80, height: 30 })] },
      { caption: 'Only $\\mathbf{c}_t^{KV}$ is cached & 50% smaller.', label: 'fig:mla' },
    );
    expect(out).toMatch(/\\begin\{figure\}\[t\]\n {2}\\centering\n {2}\\begin\{tikzpicture\}/);
    expect(out).toContain('  \\caption{Only $\\mathbf{c}_t^{KV}$ is cached \\& 50\\% smaller.}\n  \\label{fig:mla}\n\\end{figure}\n');
    // Author maths may use AMS commands.
    expect(out).toContain('%   \\usepackage{amsmath,amssymb}');
    expect(out.indexOf('\\end{tikzpicture}')).toBeLessThan(out.indexOf('\\caption'));
    expectWellFormed(out);
  });

  it('joins a multi-line caption into one paragraph', () => {
    const out = tikz({ nodes: [node('a', { x: 0, y: 0, width: 50, height: 30 })] }, { caption: 'First line\nsecond line' });
    expect(out).toContain('\\caption{First line second line}');
  });

  it('leaves a commented caption placeholder when the spec has none, so \\label never binds to a section', () => {
    const out = tikz({ nodes: [node('a', { x: 0, y: 0, width: 50, height: 30 })] }, { label: 'fig:x' });
    expect(out).toContain('  % \\caption{…}');
    expect(out).toContain('  % \\label{fig:x}');
    expect(stripComments(out)).not.toContain('\\caption');
    expect(stripComments(out)).not.toContain('\\label');
  });

  it('sanitises the label key', () => {
    const out = tikz(
      { nodes: [node('a', { x: 0, y: 0, width: 50, height: 30 })] },
      { caption: 'C.', label: ' fig: my figure#1 ' },
    );
    expect(out).toContain('\\label{fig:-my-figure-1}');
    const none = tikz({ nodes: [node('a', { x: 0, y: 0, width: 50, height: 30 })] }, { caption: 'C.', label: '{}' });
    expect(none).not.toContain('\\label');
  });

  it('gives only the tikzpicture for environment "tikzpicture"', () => {
    const out = tikz(
      { nodes: [node('a', { x: 0, y: 0, width: 50, height: 30 })] },
      { caption: 'Hello', label: 'fig:a' },
      { environment: 'tikzpicture' },
    );
    expect(out).not.toContain('\\begin{figure');
    expect(out).not.toContain('\\caption');
    expect(out).not.toContain('\\label');
    expect(out.trimEnd().endsWith('\\end{tikzpicture}')).toBe(true);
    expectWellFormed(out);
  });

  it('uses figure* and a full-width \\resizebox for size "full"', () => {
    const out = tikz({ nodes: [node('a', { x: 0, y: 0, width: 50, height: 30 })] }, { size: 'full', caption: 'Wide.' });
    expect(out).toContain('\\begin{figure*}[t]');
    expect(out).toContain('\\end{figure*}');
    expect(out).toContain('  \\resizebox{\\linewidth}{!}{%\n  \\begin{tikzpicture}');
    expect(out).toContain('  \\end{tikzpicture}%\n  }\n');
    expectWellFormed(out);
  });

  it('prints an explicit size at its share of the column, as on screen', () => {
    for (const [size, share] of [['small', '0.5'], ['medium', '0.7'], ['large', '0.85']] as const) {
      const out = tikz({ nodes: [node('a', { x: 0, y: 0, width: 50, height: 30 })] }, { size });
      // Active, not commented out; the trailing `%` keeps a space out of the box.
      expect(stripComments(out)).toContain(`  \\resizebox{${share}\\linewidth}{!}{\n`);
      expect(out).toContain(`\\resizebox{${share}\\linewidth}{!}{%\n`);
      expect(out).toContain('\\begin{figure}[t]');
      expectWellFormed(out);
    }
  });

  it('only hints at \\resizebox (commented) when a natural-size figure is wider than the column', () => {
    const narrow = figure({ nodes: [node('a', { x: 0, y: 0, width: 50, height: 30 })] }, {}, { width: FIGURE_METRICS.printColumn });
    expect(figureToTikz(narrow.scene, narrow.model)).not.toContain('resizebox');

    const wide = figure({ nodes: [node('a', { x: 0, y: 0, width: 50, height: 30 })] }, {}, { width: 820 });
    const out = figureToTikz(wide.scene, wide.model);
    expect(out).toContain('  % \\resizebox{\\linewidth}{!}{%');
    expect(out).toContain('  % }');
    expect(out).toContain('820px (615pt) wide');
    expect(stripComments(out)).not.toContain('resizebox');
    expectWellFormed(out);
  });

  it('keeps an explicit size as a hint in a bare tikzpicture', () => {
    const out = tikz({ nodes: [node('a', { x: 0, y: 0, width: 50, height: 30 })] }, { size: 'small' }, { environment: 'tikzpicture' });
    expect(out).toContain('% \\resizebox{0.5\\linewidth}{!}{%');
    expect(stripComments(out)).not.toContain('resizebox');
  });

  it('puts the title in the leading comment on one line', () => {
    const out = tikz({ nodes: [node('a', { x: 0, y: 0, width: 50, height: 30 })] }, { title: 'The\nTransformer' });
    expect(out.split('\n')[0]).toBe('% The Transformer');
  });
});

describe('figureToTikz — labels', () => {
  const rect = { x: 20, y: 20, width: 160, height: 30 };
  const labelled = (label: Label, model: Partial<NodeModel> = {}) => {
    const m = nodeModel('a', { label, ...model });
    return tikz({ nodes: [sceneNode(m, rect, { label: centredBox(label, rect) })] });
  };
  const nodeText = (out: string) => {
    const line = statements(out, '\\node[').find((l) => l.includes('(a) at'));
    return line ? line.slice(line.indexOf(' {') + 2, -2) : null;
  };

  it('escapes every LaTeX special in text', () => {
    const out = labelled(lines([text('100% of a_b & c#d {e} ~f^g \\h <i> |j| $5')]));
    expect(nodeText(out)).toBe(
      '100\\% of a\\_b \\& c\\#d \\{e\\} \\textasciitilde{}f\\textasciicircum{}g \\textbackslash{}h ' +
        '\\textless{}i\\textgreater{} \\textbar{}j\\textbar{} \\$5',
    );
    expectWellFormed(out);
  });

  it('breaks the dash and quote ligatures TeX would form', () => {
    expect(nodeText(labelled(lines([text("a--b ''c`")])))).toBe("a-{}-b '{}'c{`}");
  });

  it('passes maths through verbatim and asks for amsmath', () => {
    const out = labelled(lines([text('Proj '), math('\\mathbf{c}_t^{KV} = W^{DKV}\\mathbf{h}_t')]));
    expect(nodeText(out)).toBe('Proj $\\mathbf{c}_t^{KV} = W^{DKV}\\mathbf{h}_t$');
    expect(out).toContain('\\usepackage{amsmath,amssymb}');
  });

  it('keeps matrices and \\left…\\right pairs', () => {
    const matrix = '\\left(\\begin{matrix} a & b \\\\ c & d \\end{matrix}\\right)';
    expect(nodeText(labelled(lines([math(matrix)])))).toBe(`$${matrix}$`);
  });

  it('shows maths that would break the document as its source text, with a note', () => {
    for (const bad of ['\\frac{a', 'a}', 'x % y', '\\left( x', 'a & b', 'a \\\\ b', '\\begin{matrix} a', 'x\\']) {
      const out = labelled(lines([text('v='), math(bad)]));
      const tex = nodeText(out) ?? '';
      expect(tex.startsWith('v=\\texttt{\\$')).toBe(true);
      expect(tex.endsWith('\\$}')).toBe(true);
      expect(out).toMatch(/\n {4}% note: \$.*; printed as text\n/);
      expectWellFormed(out);
    }
  });

  it('prints maths KaTeX cannot parse as its source, in labels and the caption, never as live maths', () => {
    const label = lines([text('x '), math('\\notARealMacro{y}')]);
    const m = nodeModel('a', { label });
    const out = tikz(
      { nodes: [sceneNode(m, rect, { label: centredBox(label, rect) })] },
      { caption: 'Cap $\\notARealMacro{y}$' },
    );
    const source = '\\texttt{\\$\\textbackslash{}notARealMacro\\{y\\}\\$}';
    expect(nodeText(out)).toBe(`x ${source}`);
    expect(out).toContain(`\\caption{Cap ${source}}`);
    expect(stripComments(out)).not.toContain('\\notARealMacro');
    // The node's note follows it; the caption's sits just above the caption.
    expect(out).toContain('(a) at (100,35) {x \\texttt');
    expect(out).toMatch(/\{x \\texttt[^\n]*\n {4}% note: \$\\notARealMacro\{y\}\$ is not valid maths; printed as text\n/);
    expect(out).toMatch(/ {2}% note: \$\\notARealMacro\{y\}\$ is not valid maths; printed as text\n {2}\\caption\{/);
    expect(out).toContain('% Some labels print differently from the editor: see the "% note:" lines.');
    expectWellFormed(out);
  });

  it('never pastes a definition, file, shell or catcode command as live maths, even one KaTeX accepts', () => {
    const katexAccepts = [
      '\\def\\x{1}', '\\gdef\\section{x}', '\\global\\def\\x{1}', '\\let\\x=y', '\\newcommand{\\x}{1}',
      '\\renewcommand{\\alpha}{1}', '\\expandafter a b', '\\href{https://x.y}{z}', '\\url{https://x.y}',
      '\\includegraphics{/etc/passwd}', '\\verb|x|', '\\message{hi}', '\\htmlClass{a}{b}',
      '\\@ifnextchar a{b}{c}', '\\html@mathml{a}{b}', '\\newline', '\\text{a\\\\b}', '\\text{$x$}',
      '\\begin{darray}{c}a\\end{darray}', '\\blueA{x}',
    ];
    // The point of the export's own check: KaTeX draws every one of these.
    for (const payload of katexAccepts) expect(figureMathHtml(payload).ok).toBe(true);
    const payloads = [
      ...katexAccepts,
      '\\input{/etc/passwd}', '\\immediate\\write18{curl evil}', '\\catcode64=11',
      '\\openout1=foo.tex\\write1{x}\\closeout1', '\\makeatletter\\csname relax\\endcsname',
      // TeX reads `^^5c` as a backslash and `^^69` as an i, inside command names too.
      'x^^5cinput{x}', '\\^^69nput{x}', '\\end{document}', '\\begin{document}x\\end{document}',
    ];
    const printable = ['texttt', 'textbackslash', 'textasciicircum', 'textasciitilde', 'textbar', 'textless', 'textgreater'];
    for (const payload of payloads) {
      const out = labelled(lines([text('v='), math(payload)]));
      const tex = nodeText(out) ?? '';
      expect(tex.startsWith('v=\\texttt{\\$')).toBe(true);
      for (const word of controlWords(tex)) expect(printable).toContain(word);
      expect(out).toMatch(/% note: .*; printed as text\n/);
      expectWellFormed(out);

      const captioned = tikz({}, { caption: `Cap $${payload}$` });
      const caption = statements(stripComments(captioned), '\\caption{')[0] ?? '';
      for (const word of controlWords(caption)) expect([...printable, 'caption']).toContain(word);
      expectWellFormed(captioned);
    }
  });

  it('keeps valid maths live, spelling KaTeX-only commands the LaTeX way and naming the packages they need', () => {
    expect(nodeText(labelled(lines([math('a \\rarr b \\sube C, \\red{x}')])))).toBe(
      '$a \\rightarrow b \\subseteq C, \\textcolor{red}{x}$',
    );
    const out = labelled(lines([math('\\cancel{x} \\coloneqq \\begin{dcases} a \\end{dcases} \\bra{\\psi}')]));
    expect(nodeText(out)).toBe('$\\cancel{x} \\coloneqq \\begin{dcases} a \\end{dcases} \\bra{\\psi}$');
    expect(out).toContain('%   \\usepackage{braket,cancel,mathtools}  % for commands the maths in the labels uses');
    expect(out).not.toContain('% note:');
    expect(out).not.toContain('print differently');
  });

  it('keeps symbols inside a text argument of maths in text mode', () => {
    expect(nodeText(labelled(lines([math('\\text{naïve α ⋯ x²}')])))).toBe(
      '$\\text{naïve \\ensuremath{\\alpha} \\ensuremath{\\cdots} x\\ensuremath{^{2}}}$',
    );
    // An accented letter is a text command under pdfLaTeX, so maths sets it through \text.
    expect(nodeText(labelled(lines([math('x_é + \\colorbox{red}{é}')])))).toBe('$x_{\\text{é}} + \\colorbox{red}{é}$');
  });

  it('maps Unicode operators and Greek to maths commands pdfLaTeX can read', () => {
    expect(nodeText(labelled(lines([text('a ⊕ b × c · d ⊗ e ⊙ f')]))) ).toBe(
      'a $\\oplus$ b $\\times$ c $\\cdot$ d $\\otimes$ e $\\odot$ f',
    );
    expect(nodeText(labelled(lines([text('α·β → γ')])))).toBe('$\\alpha\\cdot\\beta$ $\\rightarrow$ $\\gamma$');
    expect(nodeText(labelled(lines([text('N×')])))).toBe('N$\\times$');
    expect(nodeText(labelled(lines([text('x ≤ y ≠ z')])))).toBe('x $\\leq$ y $\\neq$ z');
    expect(nodeText(labelled(lines([text('ε ϵ φ ϕ')])))).toBe('$\\varepsilon$ $\\epsilon$ $\\varphi$ $\\phi$');
  });

  it('merges Unicode scripts and gives a repeated script a fresh base', () => {
    expect(nodeText(labelled(lines([text('x²³')])))).toBe('x$^{23}$');
    expect(nodeText(labelled(lines([text('W₁ᵀ')])))).toBe('W$_{1}^{T}$');
    expect(nodeText(labelled(lines([text('a₁²₃')])))).toBe('a$_{1}^{2}{}_{3}$');
    expect(nodeText(labelled(lines([text('α²')])))).toBe('$\\alpha^{2}$');
  });

  it('spells typography in text mode and drops invisible characters', () => {
    expect(nodeText(labelled(lines([text('a — b – c… “q” x\u00a0y\u200b')])))).toBe("a --- b -- c\\ldots{} ``q'' x~y");
    expect(nodeText(labelled(lines([text('Α')])))).toBe('A');
  });

  it('flags blackboard letters as needing amssymb', () => {
    const out = labelled(lines([text('h ∈ ℝᵈ')]));
    expect(nodeText(out)).toBe('h $\\in$ $\\mathbb{R}^{d}$');
    expect(out).toContain('\\usepackage{amsmath,amssymb}');
  });

  it('spells the figure symbols pdfLaTeX cannot read, in text and in maths', () => {
    const cases: [Label, string, boolean][] = [
      [lines([text('h₁ ⋯ hₙ')]), 'h$_{1}$ $\\cdots$ h$_{n}$', false],
      [lines([math('\\mathbb{E}[x] ⟹ y ∖ z')]), '$\\mathbb{E}[x] \\Longrightarrow y \\setminus z$', true],
      [lines([text('𝔼 ⋮ ⋱ ✓ é')]), '$\\mathbb{E}$ $\\vdots$ $\\ddots$ $\\checkmark$ é', true],
      [lines([text('𝐱 𝐖 𝜃 𝛉 𝟙 ℋ ℍ')]), '$\\mathbf{x}$ $\\mathbf{W}$ $\\theta$ $\\boldsymbol{\\theta}$ $\\mathbf{1}$ $\\mathcal{H}$ $\\mathbb{H}$', true],
      [lines([text('A ⊊ B ≲ C ⟸ D ∎')]), 'A $\\subsetneq$ B $\\lesssim$ C $\\Longleftarrow$ D $\\blacksquare$', true],
    ];
    for (const [label, expected, ams] of cases) {
      const out = labelled(label);
      expect(nodeText(out)).toBe(expected);
      expect(out.includes('\\usepackage{amsmath,amssymb}')).toBe(ams);
      expect(out).not.toContain('% note:');
      expectWellFormed(out);
    }
  });

  it('prints what no table spells as ?, with a note naming the character', () => {
    const out = labelled(lines([text('中文 🙂 ok '), math('x + 中')]));
    expect(nodeText(out)).toBe('?? ? ok $x + {\\text{?}}$');
    expect(out).toContain('    % note: 中 (U+4E2D) has no pdfLaTeX spelling; printed as ?\n');
    expect(out).toContain('    % note: 文 (U+6587) has no pdfLaTeX spelling; printed as ?\n');
    expect(out).toContain('    % note: 🙂 (U+1F642) has no pdfLaTeX spelling; printed as ?\n');
    // One note per character, however often it appears.
    expect(out.split('中 (U+4E2D)').length).toBe(2);
    // A format character is named by its code point only.
    expect(labelled(lines([text('a\u202eb')]))).toContain('% note: U+202E has no pdfLaTeX spelling; printed as ?');
    expectWellFormed(out);
  });

  it('composes accents, drops variation selectors and blanks control characters', () => {
    expect(nodeText(labelled(lines([text('cafe\u0301 ✓\ufe0f a\u0085b')])))).toBe('café $\\checkmark$ a b');
    expect(nodeText(labelled(lines([math('x\u0085y')])))).toBe('$x y$');
  });

  it('keeps comments on one line, whatever the text in them', () => {
    const out = tikz({ nodes: [node('a', { x: 0, y: 0, width: 50, height: 30 })] }, { title: 'T\u2028\\input{x}\u2029y\u0085z' });
    expect(out.split('\n')[0]).toBe('% T \\input{x} y z');
  });

  it('converts Unicode inside author maths, spacing commands from letters', () => {
    expect(nodeText(labelled(lines([math('αx + β')])))).toBe('$\\alpha x + \\beta$');
    expect(nodeText(labelled(lines([math('x²')])))).toBe('$x^{2}$');
  });

  it('spells KaTeX-only macros the standard way', () => {
    expect(nodeText(labelled(lines([math('x \\in \\R^d, \\bold{W}, \\argmax_i')])))).toBe(
      '$x \\in \\mathbb{R}^d, \\mathbf{W}, \\operatorname*{arg\\,max}_i$',
    );
    // A line break before an R is not the \R macro; \Rightarrow is not \R either.
    expect(nodeText(labelled(lines([math('\\begin{matrix} a \\\\R \\end{matrix} \\Rightarrow')])))).toBe(
      '$\\begin{matrix} a \\\\R \\end{matrix} \\Rightarrow$',
    );
  });

  it('sets multi-line labels with \\\\ and guards what follows a break', () => {
    const out = labelled(lines([text('Multi-Head')], [text('Attention')]));
    expect(nodeText(out)).toBe('Multi-Head \\\\ Attention');
    expect(out).toMatch(/align=center/);
    expect(nodeText(labelled(lines([text('a')], [text('[CLS] *')])))).toBe('a \\\\ {}[CLS] *');
    expect(nodeText(labelled(lines([text('a')], [text('*x')])))).toBe('a \\\\ {}*x');
    expect(nodeText(labelled(lines([text('a')], [], [text('b')])))).toBe('a \\\\ \\mbox{} \\\\ b');
  });

  it('draws an empty label as an empty node', () => {
    expect(nodeText(labelled(lines([])))).toBe('');
    expect(nodeText(labelled(lines([text('   ')])))).toBe('');
  });

  it('uses the (possibly wrapped) lines of the label box, not the model label', () => {
    const m = nodeModel('a', { label: L('one two three') });
    const wrapped = lines([text('one two')], [text('three')]);
    const out = tikz({ nodes: [sceneNode(m, rect, { label: centredBox(wrapped, rect) })] });
    expect(nodeText(out)).toBe('one two \\\\ three');
  });

  it('sets bold and italic labels in their own font', () => {
    const m = nodeModel('a', { bold: true });
    const bold = figureFont('sans', 12, 600);
    const out = tikz({ nodes: [sceneNode(m, rect, { label: centredBox(m.label, rect, 40, 15, bold) })] });
    expect(out).toContain('font=\\sffamily\\bfseries\\fontsize{9}{11}\\selectfont] (a)');
    const italic = figureFont('sans', 12, 400, true);
    const out2 = tikz({ nodes: [sceneNode(m, rect, { label: centredBox(m.label, rect, 40, 15, italic) })] });
    expect(out2).toContain('font=\\sffamily\\itshape\\fontsize{9}{11}\\selectfont');
  });
});

describe('figureToTikz — colours', () => {
  const light = figurePalette('light', 'color');
  const mono = figurePalette('light', 'mono');

  const scene = () =>
    figure({
      nodes: [
        node('q', { x: 20, y: 20, width: 80, height: 30 }, { tone: 'blue' }),
        node('k', { x: 20, y: 100, width: 80, height: 30 }, { tone: 'orange' }),
      ],
      edges: [edge('q', 'k', [{ x: 60, y: 50 }, { x: 60, y: 100 }])],
    });

  it('defines exactly the colours the picture paints, from the light palette', () => {
    const { scene: s, model } = scene();
    const out = figureToTikz(s, model);
    const defined = definedColors(out);
    expect([...defined.keys()].sort()).toEqual(
      ['cwfBlueFill', 'cwfBlueStroke', 'cwfEdge', 'cwfInk', 'cwfOrangeFill', 'cwfOrangeStroke'].sort(),
    );
    expect(defined.get('cwfBlueFill')).toBe(hex(light.tones.blue.fill));
    expect(defined.get('cwfBlueStroke')).toBe(hex(light.tones.blue.stroke));
    expect(defined.get('cwfOrangeFill')).toBe(hex(light.tones.orange.fill));
    expect(defined.get('cwfEdge')).toBe(hex(light.edge));
    expect(defined.get('cwfInk')).toBe(hex(light.ink));
    expect(out).not.toMatch(/cwf(Green|Purple|Red|Teal|Yellow|Pink|Gray)/);
  });

  it('references only defined colours and defines only referenced ones', () => {
    const { scene: s, model } = kitchenSink();
    const out = figureToTikz(s, model);
    const defined = definedColors(out);
    const body = stripComments(out).replace(/\\definecolor\{\w+\}\{HTML\}\{\w+\}/g, '');
    const used = new Set([...body.matchAll(/cwf[A-Za-z]+/g)].map((m) => m[0]));
    expect([...used].sort()).toEqual([...defined.keys()].sort());
  });

  it('defines the colours inside the tikzpicture, so repeated pastes never clash', () => {
    const { scene: s, model } = scene();
    const out = figureToTikz(s, model);
    const begin = out.indexOf('\\begin{tikzpicture}');
    const firstDefinition = out.indexOf('\\definecolor');
    expect(firstDefinition).toBeGreaterThan(begin);
    expect(firstDefinition).toBeLessThan(out.indexOf('\\useasboundingbox'));
  });

  it('uses the grayscale palette for "mono", from the model or the option', () => {
    const { scene: s, model } = scene();
    expect(definedColors(figureToTikz(s, model, { palette: 'mono' })).get('cwfBlueFill')).toBe(hex(mono.tones.blue.fill));
    expect(definedColors(figureToTikz(s, { ...model, palette: 'mono' })).get('cwfBlueFill')).toBe(hex(mono.tones.blue.fill));
    expect(definedColors(figureToTikz(s, { ...model, palette: 'mono' }, { palette: 'color' })).get('cwfBlueFill')).toBe(
      hex(light.tones.blue.fill),
    );
  });

  it('colours a toned edge with its tone stroke and a neutral one with the edge colour', () => {
    const out = tikz({
      edges: [
        edge('a', 'b', [{ x: 0, y: 0 }, { x: 0, y: 40 }], { tone: 'red' }),
        edge('a', 'c', [{ x: 10, y: 0 }, { x: 10, y: 40 }], { tone: 'neutral' }),
      ],
    });
    const draws = statements(out, '\\draw[');
    expect(draws[0]).toContain('draw=cwfRedStroke');
    expect(draws[1]).toContain('draw=cwfEdge');
  });
});

describe('figureToTikz — edges', () => {
  const draw = (e: SceneEdge) => statements(tikz({ edges: [e] }), '\\draw[')[0];
  const straight = [{ x: 10, y: 10 }, { x: 10, y: 50 }];

  it('draws a solid arrow with the SVG arrowhead size and stroke', () => {
    expect(draw(edge('a', 'b', straight))).toBe(
      '\\draw[-{Stealth[length=5.25pt,width=4.5pt]}, draw=cwfEdge, line width=0.83pt, line join=round] (10,10) -- (10,50);',
    );
  });

  it('dashes and dots like the SVG, scaling dashes with the line', () => {
    expect(draw(edge('a', 'b', straight, { line: 'dashed' }))).toContain('dash pattern=on 3pt off 2.25pt');
    const dotted = draw(edge('a', 'b', straight, { line: 'dotted' }));
    expect(dotted).toContain('dash pattern=on 0.75pt off 1.88pt');
    expect(dotted).toContain('line cap=round');
    expect(draw(edge('a', 'b', straight, { line: 'dashed', weight: 'thick' }))).toContain('dash pattern=on 5.45pt off 4.09pt');
  });

  it('draws thick and thin weights, with thick arrowheads on thick edges', () => {
    const thick = draw(edge('a', 'b', straight, { weight: 'thick' }));
    expect(thick).toContain('line width=1.5pt');
    expect(thick).toContain('-{Stealth[length=6.75pt,width=6pt]}');
    const thin = draw(edge('a', 'b', straight, { weight: 'thin' }));
    expect(thin).toContain('line width=0.6pt');
    expect(thin).toContain('Stealth[length=5.25pt,width=4.5pt]');
  });

  it('puts arrowheads where the scene has them', () => {
    const tip = '{Stealth[length=5.25pt,width=4.5pt]}';
    expect(draw(edge('a', 'b', straight, { arrow: 'none' }))).not.toContain('Stealth');
    expect(draw(edge('a', 'b', straight, { arrow: 'start' }))).toContain(`\\draw[${tip}-, `);
    expect(draw(edge('a', 'b', straight, { arrow: 'both' }))).toContain(`\\draw[${tip}-${tip}, `);
    expect(draw(edge('a', 'b', straight, { arrow: 'end' }))).toContain(`\\draw[-${tip}, `);
  });

  it('draws curved routes as one cubic through the scene’s control points', () => {
    const line = draw(
      edge('a', 'b', [{ x: 0, y: 0 }, { x: 0, y: 24 }, { x: 40, y: 16 }, { x: 40, y: 40 }], { route: 'curved' }),
    );
    expect(line).toContain('(0,0) .. controls (0,24) and (40,16) .. (40,40);');
    expect(line).not.toContain('rounded corners');
  });

  it('chains several cubics when a curved route has more segments', () => {
    const points = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ x: i * 10, y: i % 2 ? 20 : 0 }));
    expect(draw(edge('a', 'b', points, { route: 'curved' }))).toContain(
      '(0,0) .. controls (10,20) and (20,0) .. (30,20) .. controls (40,0) and (50,20) .. (60,0);',
    );
  });

  it('draws straight routes point to point without rounding', () => {
    const line = draw(edge('a', 'b', [{ x: 0, y: 0 }, { x: 30, y: 45 }], { route: 'straight' }));
    expect(line).toContain('(0,0) -- (30,45);');
    expect(line).not.toContain('rounded');
  });

  it('rounds orthogonal corners by 3pt when every segment is long enough', () => {
    const line = draw(edge('a', 'b', [{ x: 10, y: 10 }, { x: 10, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 80 }]));
    expect(line).toContain('rounded corners=3pt] (10,10) -- (10,40) -- (60,40) -- (60,80);');
  });

  it('shrinks the radius on a short jog instead of letting PGF loop', () => {
    const line = draw(edge('a', 'b', [{ x: 10, y: 10 }, { x: 10, y: 40 }, { x: 15, y: 40 }, { x: 15, y: 80 }]));
    expect(line).toContain('rounded corners=1.88pt] (10,10) -- (10,40) -- (15,40) -- (15,80);');
  });

  it('switches the radius per corner, before the segment leaving it', () => {
    const line = draw(
      edge('a', 'b', [
        { x: 10, y: 10 },
        { x: 10, y: 40 },
        { x: 50, y: 40 },
        { x: 50, y: 43 },
        { x: 90, y: 43 },
        { x: 90, y: 80 },
      ]),
    );
    expect(line).toContain(
      'rounded corners=3pt] (10,10) -- (10,40) -- (50,40) [rounded corners=1.13pt] -- (50,43) -- (90,43) [rounded corners=3pt] -- (90,80);',
    );
  });

  it('sizes the corner next to an arrowhead on what the arrow leaves visible', () => {
    // Last segment 10px, 7px of it under the arrowhead: radius ≤ 1.5px.
    const line = draw(edge('a', 'b', [{ x: 10, y: 10 }, { x: 10, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 50 }]));
    // The (60,40) corner is the small one: its radius is set before the segment leaving it.
    expect(line).toContain('rounded corners=3pt] (10,10) -- (10,40) -- (60,40) [rounded corners=1.13pt] -- (60,50);');
    const noArrow = draw(edge('a', 'b', [{ x: 10, y: 10 }, { x: 10, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 50 }], { arrow: 'none' }));
    expect(noArrow).toContain('rounded corners=3pt] (10,10) -- (10,40) -- (60,40) -- (60,50);');
  });

  it('uses sharp corners where the arrowhead leaves no room for a radius', () => {
    // The last segment (6px) is shorter than the arrowhead (7px).
    const line = draw(edge('a', 'b', [{ x: 10, y: 10 }, { x: 10, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 46 }]));
    expect(line).toContain('rounded corners=3pt] (10,10) -- (10,40) -- (40,40) [sharp corners] -- (40,46);');
    const only = draw(edge('a', 'b', [{ x: 10, y: 10 }, { x: 10, y: 15 }, { x: 40, y: 15 }], { arrow: 'start' }));
    expect(only).not.toContain('corners');
    expect(only).toContain('(10,10) -- (10,15) -- (40,15);');
  });

  it('drops repeated and collinear points (after rounding to 0.1px)', () => {
    const line = draw(
      edge('a', 'b', [{ x: 10, y: 10 }, { x: 10.02, y: 10.01 }, { x: 10, y: 20 }, { x: 10, y: 40 }, { x: 40, y: 40 }]),
    );
    expect(line).toContain('(10,10) -- (10,40) -- (40,40);');
  });

  it('does not round a phantom corner left by sub-pixel jitter', () => {
    const line = draw(edge('a', 'b', [{ x: 10.04, y: 10 }, { x: 10.06, y: 20 }, { x: 10.06, y: 40 }, { x: 40, y: 40 }]));
    expect(line).toContain('(10,10) -- (10.1,40) -- (40,40);');
    // A real jog, however short, stays.
    expect(draw(edge('a', 'b', [{ x: 10, y: 10 }, { x: 10, y: 40 }, { x: 11, y: 40 }, { x: 11, y: 80 }]))).toContain(
      '(10,10) -- (10,40) -- (11,40) -- (11,80);',
    );
    // A 180° turn is a corner too.
    expect(draw(edge('a', 'b', [{ x: 10, y: 10 }, { x: 10, y: 40 }, { x: 10, y: 20 }], { arrow: 'none' }))).toContain(
      '(10,10) -- (10,40) -- (10,20);',
    );
  });

  it('skips an edge that has nothing left to draw, keeping a comment', () => {
    const out = tikz({ edges: [edge('a', 'b', [{ x: 5, y: 5 }, { x: 5.01, y: 5 }])] });
    expect(statements(out, '\\draw[')).toHaveLength(0);
    expect(out).toContain('% (no route to draw)');
    expectWellFormed(out);
  });

  it('labels edges on a white box, in the edge font', () => {
    const label = box(L('$W^{DKV}$'), { x: 70, y: 20, width: 30, height: 13 }, figureFont('sans', FIGURE_METRICS.font.edge));
    const out = tikz({ edges: [edge('a', 'b', straight, {}, { label })] });
    expect(out).toContain(
      '\\node[fill=white, inner sep=1pt, align=center, text=cwfInk, font=\\sffamily\\fontsize{7.5}{9}\\selectfont] at (85,26.5) {$W^{DKV}$};',
    );
    // Labels are painted after every node, so no shape covers them.
    expect(out.indexOf('% Edge labels')).toBeGreaterThan(out.indexOf('% Edges'));
  });

  it('colours a toned edge label with the edge', () => {
    const label = box(L('skip'), { x: 70, y: 20, width: 30, height: 13 }, figureFont('sans', FIGURE_METRICS.font.edge));
    expect(tikz({ edges: [edge('a', 'b', straight, { tone: 'teal' }, { label })] })).toContain('text=cwfTealStroke');
  });
});

describe('figureToTikz — nodes', () => {
  const rect = { x: 20, y: 20, width: 80, height: 30 };
  const one = (id: string, model: Partial<NodeModel> = {}, scene: Partial<SceneNode> = {}, r: Rect = rect) =>
    tikz({ nodes: [node(id, r, model, scene)] });

  it('draws a box as a named TikZ node with its label inside', () => {
    expect(one('a')).toContain(
      '\\node[fill=cwfNeutralFill, draw=cwfNeutralStroke, line width=0.75pt, rounded corners=2.25pt, ' +
        'minimum width=60pt, minimum height=22.5pt, inner sep=0pt, align=center, text=cwfInk] (a) at (60,35) {a};',
    );
  });

  it('draws round, circle, ellipse and bare-text nodes', () => {
    expect(one('r', { shape: 'round' })).toContain('rounded corners=11.25pt, minimum width=60pt, minimum height=22.5pt');
    const circle = one('c', { shape: 'circle', label: L('σ') }, { label: centredBox(L('σ'), { x: 20, y: 20, width: 30, height: 30 }, 8, 12) }, { x: 20, y: 20, width: 30, height: 30 });
    expect(circle).toContain('circle, minimum size=22.5pt, inner sep=0pt, align=center, text=cwfInk] (c) at (35,35) {$\\sigma$};');
    expect(one('e', { shape: 'circle' }, {}, { x: 0, y: 0, width: 60, height: 30 })).toContain('ellipse, minimum width=45pt, minimum height=22.5pt');
    const bare = one('t', { shape: 'text', border: 'none' });
    expect(bare).toContain('\\node[minimum width=60pt, minimum height=22.5pt, inner sep=0pt, align=center, text=cwfInk] (t) at (60,35) {t};');
    expect(bare).not.toContain('cwfNeutralFill');
  });

  it('keeps a long label outside a circle rather than letting TikZ grow it', () => {
    const circleRect = { x: 0, y: 0, width: 30, height: 30 };
    const out = one('c', { shape: 'circle', label: L('wide') }, { label: centredBox(L('wide'), circleRect, 26, 12) }, circleRect);
    expect(out).toContain('(c) at (15,15) {};');
    expect(out).toContain('\\node[inner sep=0pt, align=center, text=cwfInk] at (15,15) {wide};');
  });

  it('draws operator glyphs as lines sized to the circle, with no label text', () => {
    const r = { x: 40, y: 40, width: 20, height: 20 };
    const plus = one('add', { shape: 'op', op: 'plus', label: L('+') }, {}, r);
    expect(plus).toContain('(add) at (50,50) {};');
    expect(plus).toContain('\\draw[draw=cwfNeutralStroke, line width=0.75pt] (40,50) -- (60,50) (50,40) -- (50,60);');
    expect(plus).not.toContain('{+}');
    expect(one('m', { shape: 'op', op: 'minus' }, {}, r)).toContain('(40,50) -- (60,50);');
    expect(one('x', { shape: 'op', op: 'times' }, {}, r)).toContain('(42.9,42.9) -- (57.1,57.1) (57.1,42.9) -- (42.9,57.1);');
    expect(one('d', { shape: 'op', op: 'dot' }, {}, r)).toContain('\\fill[fill=cwfNeutralStroke] (50,50) circle [radius=1.65pt];');
    expect(one('cc', { shape: 'op', op: 'concat' }, {}, r)).toContain('(48,45) -- (48,55) (52,45) -- (52,55);');
    // A bold op draws its glyph as bold as its outline.
    expect(one('b', { shape: 'op', op: 'plus', border: 'bold' }, {}, r)).toContain('\\draw[draw=cwfNeutralStroke, line width=1.35pt] (40,50)');
  });

  it('draws polygons as explicit paths from the shared outlines, with a named node for the label', () => {
    const diamond = one('d', { shape: 'diamond' });
    expect(diamond).toContain('(60,20) -- (100,35) -- (60,50) -- (20,35) -- cycle;');
    expect(diamond).toContain('\\node[minimum width=60pt, minimum height=22.5pt, inner sep=0pt, align=center, text=cwfInk] (d) at (60,35) {d};');
    // A funnel narrows along a downward flow: the bottom edge is inset by min(0.45h, 0.3w).
    const funnel = one('f', { shape: 'funnel' });
    expect(funnel).toContain('(20,20) -- (100,20) -- (86.5,50) -- (33.5,50) -- cycle;');
    // …and widens as an expand.
    expect(one('x', { shape: 'expand' })).toContain('(33.5,20) -- (86.5,20) -- (100,50) -- (20,50) -- cycle;');
    expect(one('h', { shape: 'hexagon' })).toContain('(29,20) -- (91,20) -- (100,35) -- (91,50) -- (29,50) -- (20,35) -- cycle;');
    expect(one('p', { shape: 'parallelogram' })).toContain('(30.5,20) -- (100,20) -- (89.5,50) -- (20,50) -- cycle;');
  });

  it('draws a cylinder with Bézier caps and the front rim of its top', () => {
    const out = one('db', { shape: 'cylinder', tone: 'gray' }, {}, { x: 0, y: 0, width: 40, height: 40 });
    const body = statements(out, '\\draw[fill=cwfGrayFill')[0];
    expect(body).toMatch(/^\\draw\[fill=cwfGrayFill, draw=cwfGrayStroke, line width=0\.75pt, line join=round\] \(0,6\) \.\. controls/);
    expect(body).toContain('.. (20,0) ..');
    expect(body).toContain('.. (40,6) -- (40,34) .. controls');
    expect(body.endsWith('.. (0,34) -- cycle;')).toBe(true);
    const rim = statements(out, '\\draw[draw=cwfGrayStroke')[0];
    expect(rim).toMatch(/^\\draw\[draw=cwfGrayStroke, line width=0\.75pt\] \(0,6\) \.\. controls .* \.\. \(20,12\) \.\. controls .* \.\. \(40,6\);$/);
  });

  it('draws a document with a wavy bottom', () => {
    const out = one('doc', { shape: 'document' }, {}, { x: 0, y: 0, width: 40, height: 40 });
    expect(out).toContain('(0,0) -- (40,0) -- (40,36) .. controls (30,29.6) and (20,42.4) .. (10,36) .. controls (0,29.6) and (0,32) .. (0,36) -- cycle;');
  });

  it('draws border styles like the SVG', () => {
    expect(one('a', { border: 'bold' })).toContain('line width=1.35pt');
    expect(one('a', { border: 'dashed' })).toContain('dash pattern=on 3pt off 2.25pt');
    const dotted = one('a', { border: 'dotted' });
    expect(dotted).toContain('dash pattern=on 0.75pt off 1.88pt, line cap=round');
    const none = one('a', { border: 'none', tone: 'blue' });
    expect(none).toContain('\\node[fill=cwfBlueFill, rounded corners=2.25pt');
    expect(none).not.toContain('draw=');
    // An outline-less path shape is filled with \path, never stroked by \draw.
    expect(one('d', { shape: 'diamond', border: 'none', tone: 'blue' })).toContain('\\path[fill=cwfBlueFill, line join=round]');
  });

  it('hatches with north east lines and dots, over the fill', () => {
    const hatch = one('a', { tone: 'teal', pattern: 'hatch' });
    expect(hatch).toContain(
      'preaction={fill=cwfTealFill}, pattern=north east lines, pattern color=cwfTealStroke!55!cwfTealFill, draw=cwfTealStroke',
    );
    expect(one('a', { tone: 'teal', pattern: 'dots' })).toContain('pattern=dots, pattern color=cwfTealStroke!60!cwfTealFill');
    // Bare text has no fill of its own: the hatch mixes over the paper.
    expect(one('t', { shape: 'text', border: 'none', pattern: 'hatch' })).toContain(
      'pattern=north east lines, pattern color=cwfNeutralStroke!55!cwfPaper',
    );
  });

  it('draws stacked copies behind the node, up and to the right, back to front', () => {
    const out = one('head', { stack: 3, tone: 'orange' });
    const copies = statements(out, '\\draw[fill=cwfOrangeFill');
    expect(copies).toEqual([
      '\\draw[fill=cwfOrangeFill, draw=cwfOrangeStroke, line width=0.75pt, rounded corners=2.25pt, line join=round] (28,12) rectangle (108,42);',
      '\\draw[fill=cwfOrangeFill, draw=cwfOrangeStroke, line width=0.75pt, rounded corners=2.25pt, line join=round] (24,16) rectangle (104,46);',
    ]);
    expect(out.indexOf('(28,12) rectangle')).toBeLessThan(out.indexOf('(head) at'));
    // Copies of an outline-less node are still outlined, or the stack would merge.
    expect(one('h', { stack: 2, border: 'none' })).toContain('draw=cwfNeutralStroke, line width=0.75pt, rounded corners=2.25pt, line join=round] (24,16)');
    expect(statements(one('h', { stack: 20 }), '\\draw[fill=cwfNeutralFill')).toHaveLength(7);
  });

  it('draws the sublabel, badge and repeat marker as their own nodes', () => {
    const m = nodeModel('a', { tone: 'blue', badge: 'cached', sublabel: L('$B\\times T$') });
    const sub = box(m.sublabel as Label, { x: 45, y: 38, width: 30, height: 10 }, figureFont('sans', FIGURE_METRICS.font.sublabel));
    const badge = box(L('cached'), { x: 80, y: 14, width: 30, height: 12 }, figureFont('sans', FIGURE_METRICS.font.badge));
    const repeat = box(L('×8'), { x: 106, y: 26, width: 16, height: 16 }, figureFont('sans', FIGURE_METRICS.font.repeat, 600), 'left');
    const label = box(m.label, { x: 50, y: 22, width: 20, height: 14 });
    const out = tikz({ nodes: [sceneNode(m, rect, { label, sublabel: sub, badge, repeat })] });
    // The label sits above centre, so it is its own node too.
    expect(out).toContain('(a) at (60,35) {};');
    expect(out).toContain('\\node[inner sep=0pt, align=center, text=cwfInk] at (60,29) {a};');
    expect(out).toContain('\\node[inner sep=0pt, align=center, text=cwfMuted, font=\\sffamily\\fontsize{7.5}{9}\\selectfont] at (60,43) {$B\\times T$};');
    expect(out).toContain(
      '\\node[fill=cwfPaper, draw=cwfBlueStroke, line width=0.6pt, rounded corners=4.5pt, minimum width=22.5pt, minimum height=9pt, inner sep=0pt, align=center, text=cwfBlueStroke, font=\\sffamily\\fontsize{6.38}{8}\\selectfont] at (95,20) {cached};',
    );
    expect(out).toContain('\\node[anchor=west, inner sep=0pt, align=left, text=cwfInk, font=\\sffamily\\bfseries\\fontsize{9.75}{12}\\selectfont] at (106,34) {$\\times$8};');
  });

  it('sets a two-line badge, sublabel or legend entry with align=center, so TikZ breaks it like the SVG', () => {
    const m = nodeModel('a', { badge: 'cached\nKV', sublabel: L('B\nT') });
    const badge = box(L('cached\nKV'), { x: 80, y: 6, width: 38, height: 24 }, figureFont('sans', FIGURE_METRICS.font.badge));
    const sub = box(L('B\nT'), { x: 50, y: 38, width: 20, height: 20 }, figureFont('sans', FIGURE_METRICS.font.sublabel));
    const legendFont = figureFont('sans', FIGURE_METRICS.font.legend);
    const legend: SceneLegend = {
      box: { x: 4, y: 200, width: 120, height: 28 },
      items: [
        {
          sample: { kind: 'node', tone: 'teal', shape: 'box', pattern: 'none', border: 'solid' },
          swatch: { x: 4, y: 208, width: 18, height: 11 },
          label: box(L('Cached\nKV'), { x: 26, y: 200, width: 40, height: 28 }, legendFont, 'left'),
        },
      ],
    };
    const out = tikz({ nodes: [sceneNode(m, rect, { badge, sublabel: sub })], legend });
    const badgeLine = statements(out, '\\node[fill=cwfPaper').find((line) => line.endsWith('{cached \\\\ KV};'));
    expect(badgeLine).toContain('inner sep=0pt, align=center, text=cwfNeutralStroke');
    expect(out).toContain('align=center, text=cwfMuted, font=\\sffamily\\fontsize{7.5}{9}\\selectfont] at (60,48) {B \\\\ T};');
    expect(out).toContain('align=left, text=cwfInk, font=\\sffamily\\fontsize{7.88}{10}\\selectfont] at (26,214) {Cached \\\\ KV};');
    expectWellFormed(out);
  });

  it('draws a causal-mask tensor: base, filled lower triangle, thin grid, border', () => {
    const cells = { rows: 4, cols: 4, text: null, values: null, pattern: 'lower' as const };
    const r = { x: 0, y: 0, width: 44, height: 44 };
    const m = nodeModel('mask', { shape: 'tensor', tone: 'blue', cells, label: L('Mask') });
    const label = box(m.label, { x: 7, y: 48, width: 30, height: 14 });
    const out = tikz({ nodes: [sceneNode(m, r, { label, anchor: { x: 0, y: 0, width: 44, height: 62 } })] });
    expect(out).toContain('\\fill[fill=cwfBlueFill] (0,0) rectangle (44,44);');
    const filled = statements(out, '\\fill[fill=cwfBlueCell]').join(' ');
    expect(filled.match(/rectangle/g)).toHaveLength(10);
    expect(filled).toContain('(0,0) rectangle (11,11)');
    expect(filled).toContain('(33,33) rectangle (44,44)');
    expect(filled).not.toContain('(11,0) rectangle');
    const grid = statements(out, '\\draw[draw=cwfBlueStroke!45!cwfBlueFill')[0];
    expect(grid).toContain('line width=0.45pt');
    expect(grid.match(/--/g)).toHaveLength(6);
    expect(out).toContain('\\draw[draw=cwfBlueStroke, line width=0.75pt] (0,0) rectangle (44,44);');
    // The label is under the tensor, in ink, as its own node.
    expect(out).toContain('(mask) at (22,22) {};');
    expect(out).toContain('at (22,55) {Mask};');
    expectWellFormed(out);
  });

  it('shades a heat map by value, mixing the cell colour into the base', () => {
    const cells = { rows: 1, cols: 4, text: null, values: [[0, 0.25, 0.5, 1]], pattern: 'none' as const };
    const out = one('h', { shape: 'tensor', tone: 'purple', cells }, {}, { x: 0, y: 0, width: 44, height: 11 });
    expect(out).toContain('\\fill[fill=cwfPurpleCell!25!cwfPurpleFill] (11,0) rectangle (22,11);');
    expect(out).toContain('\\fill[fill=cwfPurpleCell!50!cwfPurpleFill] (22,0) rectangle (33,11);');
    expect(out).toContain('\\fill[fill=cwfPurpleCell] (33,0) rectangle (44,11);');
    expect(out).not.toContain('(0,0) rectangle (11,11)');
  });

  it('puts a neutral tensor on the paper and writes token text in cells', () => {
    const cells = { rows: 1, cols: 3, text: [['[CLS]', 'the_cat', '']], values: null, pattern: 'none' as const };
    const out = one('tok', { shape: 'tensor', cells }, {}, { x: 0, y: 0, width: 90, height: 20 });
    expect(out).toContain('\\fill[fill=cwfPaper] (0,0) rectangle (90,20);');
    expect(out).toContain(
      '\\node[inner sep=0pt, align=center, text=cwfInk, font=\\sffamily\\fontsize{7.5}{9}\\selectfont] at (15,10) {[CLS]};',
    );
    expect(out).toContain('at (45,10) {the\\_cat};');
    expect(statements(out, '\\node[inner sep=0pt, align=center, text=cwfInk, font=')).toHaveLength(2);
  });

  it('reads cell text as FigureSvg draws it: maths, line breaks and escapes', () => {
    const text = [['$x_p^1$', 'top\\nbot', '\\$5']];
    const cells = { rows: 1, cols: 3, text, values: null, pattern: 'none' as const };
    const out = one('x', { shape: 'tensor', cells }, {}, { x: 0, y: 0, width: 90, height: 30 });
    expect(out).toContain('at (15,15) {$x_p^1$};');
    expect(out).toContain('at (45,15) {top \\\\ bot};');
    expect(out).toContain('at (75,15) {\\$5};');
    expect(out).not.toContain('\\$x');
    expectWellFormed(out);
  });

  it('chunks a large grid into bounded statements', () => {
    const cells = { rows: 32, cols: 32, text: null, values: null, pattern: 'full' as const };
    const out = one('big', { shape: 'tensor', tone: 'green', cells }, {}, { x: 0, y: 0, width: 128, height: 128 });
    const fills = statements(out, '\\fill[fill=cwfGreenCell]');
    expect(fills).toHaveLength(1024 / 8);
    // Cells of 4px: the grid thins to 0.4px.
    expect(out).toContain('line width=0.3pt');
    expectWellFormed(out);
  });

  it('draws an image as a placeholder with the source and an \\includegraphics hint', () => {
    const src = 'https://example.org/figure.png';
    const out = one('img', { shape: 'image', src }, {}, { x: 0, y: 0, width: 120, height: 90 });
    expect(out).toContain(`% image source: ${src}`);
    expect(out).toContain('% to show it: \\node[inner sep=0pt] at (60,45) {\\includegraphics[width=90pt,height=67.5pt,keepaspectratio]{<image file>}};');
    expect(out).toContain('\\fill[fill=cwfPlaceholder] (0,0) rectangle (120,90);');
    expect(out).toContain('\\draw[draw=cwfMuted!50!cwfPlaceholder, line width=0.6pt] (0,0) -- (120,90) (120,0) -- (0,90);');
    expect(out).toContain('\\draw[draw=cwfNeutralStroke, line width=0.6pt] (0,0) rectangle (120,90);');
    const data = one('img', { shape: 'image', src: 'data:image/png;base64,AAAA' }, {}, { x: 0, y: 0, width: 120, height: 90 });
    expect(data).toContain('an embedded data URL');
    expect(data).not.toContain('AAAA');
  });

  it('names nodes with [A-Za-z0-9] only, never starting with a digit, and unique', () => {
    const r = (i: number) => ({ x: 0, y: i * 40, width: 40, height: 30 });
    const out = tikz({
      nodes: [node('q-proj', r(0)), node('q_proj', r(1)), node('1st', r(2)), node('α', r(3)), node('Q', r(4)), node('qproj2', r(5))],
    });
    const names = [...out.matchAll(/\] \((\w+)\) at \(/g)].map((m) => m[1]);
    expect(names).toEqual(['qproj', 'qproj2', 'n1st', 'n4', 'Q', 'qproj22']);
    // The original ids survive in the comments.
    expect(out).toContain('% node q-proj');
    expect(out).toContain('% node α');
  });
});

describe('figureToTikz — groups and legend', () => {
  it('draws group boxes, titles, repeat markers and panel captions before edges and nodes', () => {
    const repeatFont = figureFont('sans', FIGURE_METRICS.font.repeat, 600);
    const panelFont = figureFont('sans', FIGURE_METRICS.font.panel);
    const encoder = group(
      'enc',
      { x: 10, y: 10, width: 200, height: 120 },
      { label: L('Encoder'), repeat: 'N×', panel: '(a) Encoder' },
      {
        repeat: box(L('N×'), { x: 214, y: 60, width: 20, height: 16 }, repeatFont, 'left'),
        panel: box(L('(a) Encoder'), { x: 70, y: 138, width: 80, height: 14 }, panelFont),
      },
    );
    const block = group('blk', { x: 20, y: 30, width: 180, height: 90 }, { tone: 'blue', filled: true, border: 'solid' }, { depth: 2 });
    const panel = group('pan', { x: 230, y: 10, width: 100, height: 100 }, { tone: 'green', filled: true, border: 'none', label: null });
    const out = tikz({
      groups: [block, encoder, panel],
      nodes: [node('a', { x: 40, y: 50, width: 60, height: 26 })],
      edges: [edge('a', 'a', [{ x: 70, y: 76 }, { x: 70, y: 100 }])],
    });
    expect(out).toContain(
      '\\draw[draw=cwfNeutralGroupStroke, line width=0.75pt, dash pattern=on 3pt off 2.25pt, rounded corners=4.5pt] (10,10) rectangle (210,130);',
    );
    expect(out).toContain(
      '\\draw[fill=cwfBlueGroupFill, draw=cwfBlueGroupStroke, line width=0.75pt, rounded corners=4.5pt] (20,30) rectangle (200,120);',
    );
    expect(out).toContain('\\path[fill=cwfGreenGroupFill, rounded corners=4.5pt] (230,10) rectangle (330,110);');
    expect(out).toContain(
      '\\node[anchor=west, inner sep=0pt, align=left, text=cwfInk, font=\\sffamily\\bfseries\\fontsize{8.25}{10}\\selectfont] at (22,23) {Encoder};',
    );
    expect(out).toContain('font=\\sffamily\\bfseries\\fontsize{9.75}{12}\\selectfont] at (214,68) {N$\\times$};');
    expect(out).toContain('font=\\sffamily\\fontsize{8.63}{11}\\selectfont] at (110,145) {(a) Encoder};');
    // Outer groups first, then edges, then nodes.
    expect(out.indexOf('% group enc')).toBeLessThan(out.indexOf('% group blk'));
    expect(out.indexOf('% group pan')).toBeLessThan(out.indexOf('% group blk'));
    expect(out.indexOf('% group blk')).toBeLessThan(out.indexOf('% Edges'));
    expect(out.indexOf('% Edges')).toBeLessThan(out.indexOf('% Nodes'));
    expectWellFormed(out);
  });

  it('draws nothing for a group that is neither filled nor outlined, but keeps its title', () => {
    const g = group('bare', { x: 0, y: 0, width: 100, height: 60 }, { border: 'none' });
    const out = tikz({ groups: [g] });
    expect(out).not.toContain('rectangle (100,60)');
    expect(out).toContain('{bare};');
  });

  it('draws legend swatches and edge samples with their labels', () => {
    const legendFont = figureFont('sans', FIGURE_METRICS.font.legend);
    const nodeSample: LegendItemModel['sample'] = { kind: 'node', tone: 'teal', shape: 'box', pattern: 'hatch', border: 'solid' };
    const textSample: LegendItemModel['sample'] = { kind: 'node', tone: 'gray', shape: 'text', pattern: 'none', border: 'none' };
    const edgeSample: LegendItemModel['sample'] = { kind: 'edge', line: 'dashed', weight: 'normal', tone: null };
    const legend: SceneLegend = {
      box: { x: 4, y: 200, width: 300, height: 14 },
      items: [
        { sample: nodeSample, swatch: { x: 4, y: 201.5, width: 18, height: 11 }, label: box(L('Cached during inference'), { x: 26, y: 200, width: 110, height: 14 }, legendFont, 'left') },
        { sample: textSample, swatch: { x: 150, y: 201.5, width: 18, height: 11 }, label: box(L('Input'), { x: 172, y: 200, width: 30, height: 14 }, legendFont, 'left') },
        { sample: edgeSample, swatch: { x: 220, y: 201.5, width: 18, height: 11 }, label: box(L('Training only'), { x: 242, y: 200, width: 60, height: 14 }, legendFont, 'left') },
      ],
    };
    const out = tikz({ legend });
    expect(out).toContain('% Legend');
    expect(out).toContain(
      '\\draw[preaction={fill=cwfTealFill}, pattern=north east lines, pattern color=cwfTealStroke!55!cwfTealFill, draw=cwfTealStroke, line width=0.75pt, rounded corners=2.25pt, line join=round] (4,201.5) rectangle (22,212.5);',
    );
    // A bare-text swatch shows as a plain box in its tone.
    expect(out).toContain('\\path[fill=cwfGrayFill, rounded corners=2.25pt, line join=round] (150,201.5) rectangle (168,212.5);');
    expect(out).toContain('\\draw[draw=cwfEdge, line width=0.83pt, dash pattern=on 3pt off 2.25pt] (220,207) -- (238,207);');
    expect(out).toContain('\\node[anchor=west, inner sep=0pt, align=left, text=cwfInk, font=\\sffamily\\fontsize{7.88}{10}\\selectfont] at (26,207) {Cached during inference};');
    expectWellFormed(out);
  });
});

/** Every feature at once, for the structural checks. */
function kitchenSink(): { scene: FigureScene; model: FigureModel } {
  const nodes = [
    node('input', { x: 20, y: 400, width: 60, height: 20 }, { shape: 'text', border: 'none', label: L('$h_t$ ∈ ℝᵈ') }),
    node('ckv', { x: 20, y: 330, width: 90, height: 30 }, { tone: 'teal', pattern: 'hatch', badge: 'cached', label: L('$\\mathbf{c}_t^{KV}$') }),
    node('attn', { x: 140, y: 250, width: 120, height: 40 }, { tone: 'orange', stack: 3, label: L('Multi-Head\nAttention {50%}') }),
    node('add', { x: 190, y: 200, width: 20, height: 20 }, { shape: 'op', op: 'plus', label: L('+') }),
    node('gate', { x: 20, y: 180, width: 60, height: 40 }, { shape: 'diamond', tone: 'yellow', border: 'dashed' }),
    node('db', { x: 300, y: 330, width: 60, height: 40 }, { shape: 'cylinder', tone: 'gray' }),
    node('doc', { x: 300, y: 250, width: 60, height: 40 }, { shape: 'document', border: 'dotted' }),
    node('enc', { x: 300, y: 180, width: 70, height: 30 }, { shape: 'funnel', tone: 'purple', pattern: 'dots' }),
    node('mask', { x: 140, y: 120, width: 44, height: 44 }, {
      shape: 'tensor',
      tone: 'blue',
      cells: { rows: 4, cols: 4, text: null, values: [[1, 0, 0, 0], [0.5, 0.5, 0, 0], [0.3, 0.3, 0.4, 0], [0.25, 0.25, 0.25, 0.25]], pattern: 'lower' },
    }),
    node('img', { x: 220, y: 110, width: 60, height: 45 }, { shape: 'image', src: null, label: L('Patches') }),
    node('out', { x: 20, y: 40, width: 60, height: 20 }, { shape: 'text', border: 'none', label: L('p(y | x) → ŷ') }),
  ];
  const groups = [
    group('block', { x: 130, y: 100, width: 250, height: 280 }, { tone: 'gray', filled: true, border: 'solid', repeat: 'N×', label: L('Decoder #1 & more') }),
  ];
  const edges = [
    edge('input', 'ckv', [{ x: 50, y: 400 }, { x: 50, y: 360 }], { label: L('$W^{DKV}$') }, { label: box(L('$W^{DKV}$'), { x: 54, y: 373, width: 30, height: 13 }) }),
    edge('ckv', 'attn', [{ x: 65, y: 330 }, { x: 65, y: 310 }, { x: 200, y: 310 }, { x: 200, y: 290 }], { line: 'dashed', weight: 'thick' }),
    edge('attn', 'add', [{ x: 200, y: 250 }, { x: 200, y: 220 }], { arrow: 'both' }),
    edge('add', 'out', [{ x: 200, y: 200 }, { x: 200, y: 60 }, { x: 50, y: 60 }], { route: 'straight', line: 'dotted', weight: 'thin' }),
    edge('gate', 'add', [{ x: 80, y: 200 }, { x: 110, y: 200 }, { x: 150, y: 150 }, { x: 190, y: 210 }], { route: 'curved', tone: 'red' }),
    edge('db', 'doc', [{ x: 330, y: 330 }, { x: 330, y: 290 }], { kind: 'feedback', arrow: 'none' }),
  ];
  const legendFont = figureFont('sans', FIGURE_METRICS.font.legend);
  const legend: SceneLegend = {
    box: { x: 4, y: 440, width: 300, height: 14 },
    items: [
      { sample: { kind: 'node', tone: 'teal', shape: 'round', pattern: 'hatch', border: 'solid' }, swatch: { x: 4, y: 441.5, width: 18, height: 11 }, label: box(L('Cached'), { x: 26, y: 440, width: 40, height: 14 }, legendFont, 'left') },
      { sample: { kind: 'edge', line: 'dotted', weight: 'thick', tone: 'pink' }, swatch: { x: 80, y: 441.5, width: 18, height: 11 }, label: box(L('Feedback'), { x: 102, y: 440, width: 50, height: 14 }, legendFont, 'left') },
    ],
  };
  return figure(
    { nodes, groups, edges, legend },
    { caption: 'Multi-head latent attention: only $\\mathbf{c}_t^{KV}$ is cached (~93% less memory).', label: 'fig:mla', title: 'MLA' },
    { width: 460, height: 470 },
  );
}

describe('figureToTikz — whole figures', () => {
  it('produces well-formed TeX for a figure with every feature', () => {
    const { scene, model } = kitchenSink();
    for (const environment of ['figure', 'tikzpicture'] as const) {
      for (const palette of ['color', 'mono'] as const) {
        expectWellFormed(figureToTikz(scene, model, { environment, palette }));
      }
    }
  });

  it('includes every node and every edge', () => {
    const { scene, model } = kitchenSink();
    const out = figureToTikz(scene, model);
    for (const n of scene.nodes) {
      expect(out).toContain(`% node ${n.id}\n`);
      expect(out).toMatch(new RegExp(`\\] \\(${n.id}\\) at \\(`));
    }
    for (const e of scene.edges) expect(out).toContain(`% edge ${e.model.from} -> ${e.model.to}\n`);
    // One \draw per edge in the Edges section.
    const edgesSection = out.slice(out.indexOf('% Edges'), out.indexOf('% Nodes'));
    expect(statements(edgesSection, '\\draw[')).toHaveLength(scene.edges.length);
  });

  it('writes every coordinate to at most 0.1px and every length to at most 0.01pt', () => {
    const { scene, model } = kitchenSink();
    const out = stripComments(figureToTikz(scene, model));
    const coordinates = [...out.matchAll(/\((-?[\d.]+),(-?[\d.]+)\)/g)];
    expect(coordinates.length).toBeGreaterThan(50);
    for (const [, x, y] of coordinates) {
      expect(x).toMatch(/^-?\d+(\.\d)?$/);
      expect(y).toMatch(/^-?\d+(\.\d)?$/);
    }
    for (const [, value] of out.matchAll(/=(-?[\d.]+)pt/g)) expect(value).toMatch(/^-?\d+(\.\d{1,2})?$/);
  });

  it('is deterministic: the same scene gives the same text', () => {
    const a = kitchenSink();
    const b = kitchenSink();
    expect(figureToTikz(a.scene, a.model)).toBe(figureToTikz(b.scene, b.model));
    expect(figureToTikz(a.scene, a.model)).toBe(figureToTikz(a.scene, a.model));
  });

  it('never prints NaN for a broken coordinate', () => {
    const out = tikz({
      nodes: [node('a', { x: Number.NaN, y: 10, width: 40, height: Number.POSITIVE_INFINITY })],
      edges: [edge('a', 'b', [{ x: Number.NaN, y: 0 }, { x: 10, y: 40 }])],
    });
    expect(out).not.toMatch(/NaN|Infinity/);
    expectWellFormed(out);
  });

  it('draws an empty scene as an empty, valid picture', () => {
    const out = tikz({});
    expect(out).toContain('\\useasboundingbox (0,0) rectangle (400,300);');
    expect(out).not.toContain('\\definecolor');
    expectWellFormed(out);
  });
});
