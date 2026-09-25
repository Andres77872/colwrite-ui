import { describe, expect, it } from 'vitest';
import { compileFigure } from '@/lib/figure/compile';
import { createHeuristicMeasurer } from '@/lib/figure/measure';
import { FIGURE_SPEC_PROMPT, figureRepairInstruction } from '@/lib/figure/prompt';
import { ASK_AI_PRESETS, buildAskAiMessage, customPreset, figureProblems, presetsFor } from './presets';

describe('figure presets', () => {
  it('offers only figure actions on a figure block, and none of them elsewhere', () => {
    const onFigure = presetsFor('block', '', true);
    expect(onFigure.length).toBeGreaterThan(0);
    expect(onFigure.every((preset) => preset.forFigure)).toBe(true);
    expect(onFigure.map((preset) => preset.id)).toEqual(
      expect.arrayContaining(['figure-improve', 'figure-fix', 'figure-print']),
    );

    const onText = presetsFor('block', '', false);
    expect(onText.some((preset) => preset.forFigure)).toBe(false);
    // Rewriting JSON as prose would destroy the figure.
    expect(onFigure.some((preset) => preset.id === 'improve' || preset.id === 'translate')).toBe(false);
  });

  it('can draw any passage as a figure', () => {
    const draw = ASK_AI_PRESETS.find((preset) => preset.id === 'figure');
    expect(draw).toMatchObject({ drawsFigure: true, use: 'insert' });
    expect(presetsFor('selection', 'diagram', false).map((preset) => preset.id)).toContain('figure');
  });

  it('asks for exactly one figure fence and carries the spec language', () => {
    const draw = ASK_AI_PRESETS.find((preset) => preset.id === 'figure')!;
    const message = buildAskAiMessage({ preset: draw, target: 'block', markdown: 'MLA compresses keys and values.' });
    expect(message).toContain('exactly one ```figure fenced block');
    expect(message).toContain(FIGURE_SPEC_PROMPT);
    expect(message).not.toContain('pipe tables');
  });

  it('frames a figure target as a figure, and a free-form prompt on it returns a figure', () => {
    const custom = customPreset('add a legend', 'block', true);
    expect(custom).toMatchObject({ forFigure: true, drawsFigure: true, use: 'replace' });
    const message = buildAskAiMessage({ preset: custom, target: 'block', markdown: '```figure\n{}\n```' });
    expect(message).toContain('structured figure in the document');
    expect(message).toContain('Task: add a legend');

    const explain = ASK_AI_PRESETS.find((preset) => preset.id === 'figure-explain')!;
    const prose = buildAskAiMessage({ preset: explain, target: 'block', markdown: '```figure\n{}\n```' });
    expect(prose).not.toContain(FIGURE_SPEC_PROMPT);
    expect(prose).toContain('as Markdown');
  });

  it('keeps LaTeX backslashes doubled in the spec prompt, as valid JSON needs', () => {
    expect(FIGURE_SPEC_PROMPT).toContain('"$\\\\mathbf{c}_t^{KV}$"');
    expect(FIGURE_SPEC_PROMPT).toContain('```figure');
    expect(FIGURE_SPEC_PROMPT).not.toContain('\\`');
  });

  it('teaches the layouts models get wrong: panels in a row, short right-flowing chains, images', () => {
    // Unconnected panels stack across "direction", so side by side needs a row.
    expect(FIGURE_SPEC_PROMPT).toContain('"layout": "row" for side-by-side panels');
    // A long "right" chain prints below the minimum text size.
    expect(FIGURE_SPEC_PROMPT).toMatch(/"right" fits ~6 boxes/);
    expect(FIGURE_SPEC_PROMPT).toContain('print-size warning');
    // A model has no image to give: without a data URL, it draws a box.
    expect(FIGURE_SPEC_PROMPT).toContain('needs "src" as a data:image URL (remote URLs are not loaded)');
    // Every figure-drawing message carries the prompt; it has to stay compact.
    expect(FIGURE_SPEC_PROMPT.length).toBeLessThan(4700);
  });

  it('draws a figure even for a simple flow: the task has already chosen one', () => {
    expect(FIGURE_SPEC_PROMPT).toContain('The task asks for a figure, so draw one even for a simple flow.');
    expect(FIGURE_SPEC_PROMPT).not.toContain('stay Mermaid');
  });

  it('teaches what models get wrong: mask words, U shapes, the data role and numbered captions', () => {
    // Four mask words exist; any other pattern is spelled out cell by cell.
    expect(FIGURE_SPEC_PROMPT).toContain('"mask" is only full|causal|upper|diagonal');
    expect(FIGURE_SPEC_PROMPT).toContain('(sliding window, block-sparse) is a 0/1 "values" matrix, one list per row');
    // sameRank moves the node carrying it; a U-Net climbs back beside its encoder.
    expect(FIGURE_SPEC_PROMPT).toContain(`"sameRank": "<sibling id>" puts a node on that sibling's layer (only the node carrying it moves)`);
    expect(FIGURE_SPEC_PROMPT).toContain('"rank": "first"|"last" pins its layer');
    expect(FIGURE_SPEC_PROMPT).toContain(
      'A U shape (U-Net): give each decoder level "sameRank" naming its encoder level and make the decoder\'s upward edges "kind": "feedback".',
    );
    // "data" draws a database cylinder, so a vector is not data.
    // Cylinders are for stores; a cached vector is a hatched latent or tensor.
    expect(FIGURE_SPEC_PROMPT).toContain('"data" and "cache" draw as cylinders');
    expect(FIGURE_SPEC_PROMPT).toContain('a vector or activation, even a cached one, is "latent" or a tensor, hatched if cached');
    // The editor numbers captioned figures itself.
    expect(FIGURE_SPEC_PROMPT).toContain('the editor prints "Figure N." before it, so never start it with "Figure 1:"');
  });
});

describe('figures written the way the spec prompt teaches', () => {
  const measurer = createHeuristicMeasurer();

  it('draws a U-Net as a U: each decoder level shares its encoder level’s layer', () => {
    const levels = [1, 2, 3];
    const compiled = compileFigure(
      JSON.stringify({
        caption: 'A three-level U-Net.',
        nodes: [
          ...levels.map((l) => ({ id: `e${l}`, label: `Conv ${32 << l}`, role: 'conv' })),
          { id: 'b', label: 'Bottleneck', role: 'latent' },
          ...levels.map((l) => ({ id: `d${l}`, label: `Up-conv ${32 << l}`, role: 'conv', sameRank: `e${l}` })),
        ],
        edges: [
          'e1 -> e2 -> e3 -> b',
          { from: 'b', to: 'd3', kind: 'feedback' },
          { from: 'd3', to: 'd2', kind: 'feedback' },
          { from: 'd2', to: 'd1', kind: 'feedback' },
          ...levels.map((l) => `e${l} -> d${l}: copy`),
        ],
      }),
      measurer,
    );
    expect(compiled.ok).toBe(true);
    expect(compiled.diagnostics).toEqual([]);
    const box = (id: string) => compiled.scene!.nodes.find((node) => node.id === id)!.bounds;
    const middle = (id: string) => box(id).y + box(id).height / 2;
    for (const l of levels) expect(middle(`d${l}`)).toBeCloseTo(middle(`e${l}`), 0);
    // The encoder descends to the bottleneck at the bottom of the U…
    expect(middle('e1')).toBeLessThan(middle('e2'));
    expect(middle('e2')).toBeLessThan(middle('e3'));
    expect(middle('e3')).toBeLessThan(middle('b'));
    // …and the decoder climbs back up in a column of its own beside it.
    const encoderRight = Math.max(...levels.map((l) => box(`e${l}`).x + box(`e${l}`).width));
    const decoderLeft = Math.min(...levels.map((l) => box(`d${l}`).x));
    expect(decoderLeft).toBeGreaterThanOrEqual(encoderRight);
  });

  it('draws a sliding-window mask given as 0/1 values, with no diagnostics', () => {
    const band = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => (j <= i && i - j < 3 ? 1 : 0)));
    const compiled = compileFigure(
      JSON.stringify({
        caption: 'Causal sliding-window attention with window $w = 3$.',
        nodes: [{ id: 'swa', label: 'Sliding window', shape: 'tensor', cells: [8, 8], values: band }],
      }),
      measurer,
    );
    expect(compiled.ok).toBe(true);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.scene!.nodes.find((node) => node.id === 'swa')!.model.cells?.values).toEqual(band);

    // An invented mask word, which the prompt steers away from, draws nothing.
    const invented = compileFigure(JSON.stringify({ nodes: [{ id: 'swa', shape: 'tensor', cells: [8, 8], mask: 'sliding-window' }] }), measurer);
    expect(invented.diagnostics.map((diagnostic) => diagnostic.code)).toContain('tensor.invalid-value');
  });
});

describe('Fix problems on a figure', () => {
  const measurer = createHeuristicMeasurer();
  const fix = ASK_AI_PRESETS.find((preset) => preset.id === 'figure-fix')!;
  const chain = (direction: string) =>
    JSON.stringify({
      direction,
      nodes: ['User query', 'Query encoder', 'Dense retriever', 'Top-100 candidates', 'Cross-encoder reranker', 'Top-5 passages', 'LLM reader', 'Cited answer'].map(
        (label, i) => ({ id: `n${i}`, label, role: 'process' }),
      ),
      edges: ['n0 -> n1 -> n2 -> n3 -> n4 -> n5 -> n6 -> n7'],
    });

  it('lists the compiler’s findings with their line and column', () => {
    const source = '{\n  "nodes": [{"id": "a", "label": "A", "shap": "box"}, "b"],\n  "edges": ["a -> bb"]\n}';
    expect(figureProblems(source, measurer)).toEqual([
      'line 2:39 — Unknown key "shap" on node "a". Did you mean "shape"? It is ignored.',
      'line 3:19 — Edge "a -> bb": No node or group "bb". Did you mean "b"? The edge is dropped.',
    ]);
    expect(figureProblems('{"nodes": ["a"]}', measurer)).toEqual([]);
  });

  it('leaves the print-size warning for last: it is a relayout, not a repair', () => {
    const wide = figureProblems(chain('right'), measurer);
    expect(wide).toHaveLength(1);
    expect(wide[0]).toMatch(/prints|printed page/);

    const alsoBroken = chain('right').replace('"edges":[', '"edges":["n7 -> nx",');
    const problems = figureProblems(alsoBroken, measurer);
    expect(problems.some((problem) => problem.includes('"nx"'))).toBe(true);
    expect(problems.some((problem) => /printed page/.test(problem))).toBe(false);
  });

  it('hands the findings to the model as the repair list', () => {
    const problems = ['line 3:13 — Edge "a -> bb": No node or group "bb". Did you mean "b"? The edge is dropped.'];
    const message = buildAskAiMessage({ preset: fix, target: 'block', markdown: '```figure\n{}\n```', problems });
    expect(message).toContain(figureRepairInstruction(problems));
    expect(message.indexOf(figureRepairInstruction(problems))).toBeLessThan(message.indexOf('Passage:'));

    const clean = buildAskAiMessage({ preset: fix, target: 'block', markdown: '```figure\n{}\n```', problems: [] });
    expect(clean).not.toContain('Fix these problems');
  });
});
