import { describe, expect, it } from 'vitest';
import { compileFigure } from '@/lib/figure/compile';
import { createHeuristicMeasurer } from '@/lib/figure/measure';
import { askAiPresets, customPreset, figureProblems, presetsFor } from './presets';
import { askAiRequest, type AskAiTarget } from './target';
import { PERSONAL_WORKSPACE_ID, VIEWER_WORKSPACE_ID, catalogOf } from '@/dev/msw/fixtures';

/** Ask AI's menu from the mock API's catalog, as the app builds it. */
const CATALOG = catalogOf(PERSONAL_WORKSPACE_ID).presets;
const ASK_AI_PRESETS = askAiPresets(CATALOG);

/** A block target on block `b1`, as `useAskAiTarget` captures one. */
const BLOCK: AskAiTarget = {
  key: 't', kind: 'block', blockIds: ['b1'], anchorId: 'b1', text: '', locked: false, hidden: false, citations: new Map(),
};

describe('the server’s presets', () => {
  const leaves = ASK_AI_PRESETS.flatMap((preset) => preset.children ?? [preset]);

  it('asks for every action that is not a figure by its server preset id, with no words of its own', () => {
    for (const preset of leaves.filter((candidate) => !candidate.drawsFigure && !candidate.forFigure)) {
      expect(preset.ask, preset.id).toEqual({ preset: preset.id });
      // The server has the preset, in the profile Ask AI runs in.
      expect(CATALOG.find((row) => row.id === preset.id)?.profile, preset.id).toBe('inline');
    }
  });

  it('offers every inline preset of the catalog, with its label and group, and none of the chat ones', () => {
    const inline = CATALOG.filter((row) => row.profile === 'inline');
    expect(leaves.filter((preset) => preset.ask && 'preset' in preset.ask).map((preset) => [preset.id, preset.label, preset.group]))
      .toEqual(inline.map((row) => [row.id, row.label, row.group]));
    expect(leaves.some((preset) => preset.id === 'review-page' || preset.id === 'tighten-page')).toBe(false);
    // The tones and languages share their submenus, under the catalog's group.
    const tone = ASK_AI_PRESETS.find((preset) => preset.id === 'tone');
    expect(tone?.children?.map((child) => child.label)).toEqual(['Academic', 'Professional', 'Confident', 'Neutral', 'Friendly']);
  });

  it('offers a preset the server would not run here disabled, with its reason, and one this client has never heard of', () => {
    const presets = askAiPresets([
      { id: 'shorter', label: 'Make shorter', group: 'edit', profile: 'inline', state: 'blocked', reason: 'Needs the editor role.', skill: null, skill_reference: null },
      { id: 'cite-check', label: 'Check citations', group: 'research', profile: 'inline', state: 'on', reason: null, skill: null, skill_reference: null },
    ]);
    expect(presets.find((preset) => preset.id === 'shorter')).toMatchObject({ unavailable: 'Needs the editor role.', use: 'replace' });
    expect(presets.find((preset) => preset.id === 'cite-check')).toMatchObject({ label: 'Check citations', group: 'research', use: 'note', ask: { preset: 'cite-check' } });
    expect(catalogOf(VIEWER_WORKSPACE_ID).presets.find((row) => row.id === 'tighten-page')).toMatchObject({ state: 'blocked', reason: 'Needs the editor role.' });
  });

  it('keeps no server instruction text in any preset, including figures', () => {
    const worded = leaves.filter((preset) => preset.ask !== null && 'instruction' in preset.ask);
    expect(worded).toEqual([]);
  });

  it('sends a preset as its id, with an empty message: the server supplies the instruction', () => {
    const shorter = leaves.find((preset) => preset.id === 'shorter')!;
    expect(askAiRequest({ preset: shorter, target: BLOCK })).toMatchObject({ message: '', preset: 'shorter' });
    const spanish = leaves.find((preset) => preset.id === 'translate-es')!;
    expect(askAiRequest({ preset: spanish, target: BLOCK })).toMatchObject({ message: '', preset: 'translate-es' });
  });

  it('sends the author’s own prompt as the message, with no preset', () => {
    const request = askAiRequest({ preset: customPreset('make it punchier', 'block'), target: BLOCK });
    expect(request.preset).toBeUndefined();
    expect(request.message).toContain('Task: make it punchier');
  });

  it('runs nothing for a submenu', () => {
    const tone = ASK_AI_PRESETS.find((preset) => preset.id === 'tone')!;
    expect(() => askAiRequest({ preset: tone, target: BLOCK })).toThrow(/submenu/);
  });
});

describe('figure presets', () => {
  it('offers only figure actions on a figure block, and none of them elsewhere', () => {
    const onFigure = presetsFor(ASK_AI_PRESETS, 'block', '', true);
    expect(onFigure.length).toBeGreaterThan(0);
    expect(onFigure.every((preset) => preset.forFigure)).toBe(true);
    expect(onFigure.map((preset) => preset.id)).toEqual(
      expect.arrayContaining(['figure-improve', 'figure-fix', 'figure-print']),
    );

    const onText = presetsFor(ASK_AI_PRESETS, 'block', '', false);
    expect(onText.some((preset) => preset.forFigure)).toBe(false);
    // Rewriting JSON as prose would destroy the figure.
    expect(onFigure.some((preset) => preset.id === 'improve' || preset.id === 'translate')).toBe(false);
  });

  it('can draw any passage as a figure', () => {
    const draw = ASK_AI_PRESETS.find((preset) => preset.id === 'figure');
    expect(draw).toMatchObject({ drawsFigure: true, use: 'insert' });
    expect(presetsFor(ASK_AI_PRESETS, 'selection', 'diagram', false).map((preset) => preset.id)).toContain('figure');
  });

  it('asks for the server figure preset whose reference is preloaded before the model call', () => {
    const draw = ASK_AI_PRESETS.find((preset) => preset.id === 'figure')!;
    const message = askAiRequest({ preset: draw, target: BLOCK }).message;
    expect(message).toBe('');
    expect(CATALOG.find((preset) => preset.id === draw.id)).toMatchObject({
      skill: 'editor', skill_reference: 'references/figures.md',
    });
  });

  it('frames a figure target as a figure, and a free-form prompt on it returns a figure', () => {
    const custom = customPreset('add a legend', 'block', true);
    expect(custom).toMatchObject({ forFigure: true, drawsFigure: true, use: 'replace' });
    const message = askAiRequest({ preset: custom, target: { ...BLOCK, figure: true } }).message;
    expect(message).toBe('add a legend');
    expect(askAiRequest({ preset: custom, target: BLOCK }).preset).toBe('figure-custom');

    const explain = ASK_AI_PRESETS.find((preset) => preset.id === 'figure-explain')!;
    const prose = askAiRequest({ preset: explain, target: { ...BLOCK, figure: true } }).message;
    expect(prose).toBe('');
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
    const request = askAiRequest({ preset: fix, target: { ...BLOCK, figure: true }, problems });
    expect(request.context.figure_problems).toEqual(problems);
    expect(request.message).toBe('');

    const clean = askAiRequest({ preset: fix, target: { ...BLOCK, figure: true }, problems: [] }).message;
    expect(clean).not.toContain('Fix these problems');
  });
});
