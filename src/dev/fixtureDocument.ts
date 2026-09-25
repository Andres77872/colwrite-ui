/**
 * A representative paper for the dev preview: every block kind and inline
 * widget the editor draws, in the backend's document shape.
 */

const ph = (id: string) => `<span data-child-id="${id}" contenteditable="false"></span>`;

const vaswani = {
  key: '1706.03762',
  title: 'Attention Is All You Need',
  authors: 'Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit',
  year: '2017',
  venue: 'NeurIPS',
  url: 'https://arxiv.org/abs/1706.03762',
  provider: 'arxiv',
};
const fedus = {
  key: '2101.03961',
  title: 'Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity',
  authors: 'William Fedus, Barret Zoph, Noam Shazeer',
  year: '2021',
  venue: 'JMLR',
  url: 'https://arxiv.org/abs/2101.03961',
  provider: 'arxiv',
};
const lepikhin = {
  key: '2006.16668',
  title: 'GShard: Scaling Giant Models with Conditional Computation and Automatic Sharding',
  authors: 'Dmitry Lepikhin, HyoukJoong Lee, Yuanzhong Xu',
  year: '2020',
  venue: 'ICLR',
  url: 'https://arxiv.org/abs/2006.16668',
  provider: 'arxiv',
};

export const FIXTURE_DOCUMENT_ID = '66f0c0ffee0000000000d0c1';

export function fixtureDocument() {
  return {
    _id: FIXTURE_DOCUMENT_ID,
    name: 'Sparse Routing for Long-Context Pretraining',
    version: 3,
    citationStyle: 'numeric',
    sources: [vaswani, fedus, lepikhin],
    blocks: [
      { id: 'h-intro', type: 'heading', level: 1, html: 'Introduction' },
      {
        id: 'p-1',
        type: 'paragraph',
        html: `Mixture-of-experts layers route each token to a small subset of feed-forward networks, decoupling parameter count from per-token compute${ph('c-1')}. Dense attention remains the bottleneck at long context lengths${ph('c-2')}.`,
        children: [
          { id: 'c-1', type: 'citation', keys: ['2101.03961', '2006.16668'], style: 'numeric', sources: [fedus, lepikhin] },
          { id: 'c-2', type: 'citation', keys: ['1706.03762'], style: 'numeric', sources: [vaswani] },
        ],
      },
      {
        id: 'p-2',
        type: 'paragraph',
        html: `In this paper, we show that sparse routing lets models scale <strong>sublinearly</strong> in compute. The router assigns token ${ph('e-1')} to expert ${ph('e-2')} with a learned gate.`,
        children: [
          { id: 'e-1', type: 'equation', latex: 'x_t' },
          { id: 'e-2', type: 'equation', latex: 'i = \\arg\\max_j \\; g_j(x_t)' },
        ],
      },
      { id: 'h-contrib', type: 'heading', level: 2, html: 'Contributions' },
      { id: 'li-1', type: 'paragraph', variant: 'bullet', html: 'A load-balanced router that keeps expert utilisation within 5% of uniform.', children: [] },
      { id: 'li-2', type: 'paragraph', variant: 'bullet', html: 'A long-context curriculum that extends training to 128k tokens.', children: [] },
      { id: 'li-3', type: 'paragraph', variant: 'bullet', indent: 1, html: 'Ablations on sequence length and expert count.', children: [] },
      { id: 'li-4', type: 'paragraph', variant: 'bullet', html: 'An open implementation and training logs.', children: [] },
      {
        id: 'q-1',
        type: 'paragraph',
        variant: 'quote',
        html: 'Conditional computation is the most promising path to models that are both larger and cheaper to run.',
        children: [],
      },
      { id: 'h-method', type: 'heading', level: 2, html: 'Method' },
      {
        id: 'p-3',
        type: 'paragraph',
        html: `The gating objective combines the task loss with an auxiliary balance term: ${ph('e-3')}`,
        children: [
          { id: 'e-3', type: 'equation', latex: '\\mathcal{L} = \\mathcal{L}_{task} + \\alpha \\sum_{i=1}^{N} f_i \\cdot P_i', display: true, numbered: true },
        ],
      },
      { id: 'n-1', type: 'paragraph', variant: 'numbered', html: 'Compute router logits for every token.', children: [] },
      { id: 'n-2', type: 'paragraph', variant: 'numbered', html: 'Select the top-1 expert and dispatch.', children: [] },
      { id: 'n-3', type: 'paragraph', variant: 'numbered', html: 'Combine expert outputs weighted by the gate.', children: [] },
      {
        id: 'code-1',
        type: 'code',
        language: 'python',
        text: 'def route(x, router):\n    logits = router(x)            # [tokens, experts]\n    expert = logits.argmax(-1)\n    return dispatch(x, expert)',
      },
      {
        id: 'diagram-1',
        type: 'code',
        language: 'mermaid',
        text: [
          'flowchart TD',
          '  X[Token] --> R{Router}',
          '  R -- top-1 --> E[Expert]',
          '  R -. over capacity .-> D[Dropped]',
          '  E --> Y([Gated output])',
        ].join('\n'),
      },
      {
        id: 'figure-1',
        type: 'code',
        language: 'figure',
        text: JSON.stringify(
          {
            caption:
              'A mixture-of-experts layer. The router sends each token to its top-$k$ routed experts; the shared expert sees every token, and the expert outputs are added to the residual stream.',
            label: 'fig:moe',
            direction: 'up',
            nodes: [
              { id: 'u', label: 'Input hidden $\\mathbf{u}_t$', role: 'input' },
              { id: 'router', label: 'Router', role: 'router' },
              {
                id: 'experts',
                label: 'MoE layer',
                layout: 'row',
                children: [
                  { id: 'shared', label: 'Shared expert', role: 'expert', tone: 'teal', stack: 2 },
                  { id: 'routed', label: 'Routed experts', role: 'expert', stack: 4, repeat: '$N_r$' },
                ],
              },
              { id: 'sum', label: '+', role: 'op' },
              { id: 'h', label: "Output hidden $\\mathbf{h}'_t$", role: 'output' },
            ],
            edges: [
              'u -> router',
              'u -> shared',
              { from: 'router', to: 'routed', label: 'top-$k$ gates' },
              'shared, routed -> sum',
              { from: 'u', to: 'sum', kind: 'residual' },
              'sum -> h',
            ],
            legend: [
              { label: 'Shared: always active', tone: 'teal' },
              { label: 'Routed: top-$k$ per token', tone: 'blue' },
            ],
          },
          null,
          2,
        ),
      },
      {
        id: 'call-1',
        type: 'paragraph',
        variant: 'callout',
        html: 'Results below use the 1.3B-parameter configuration unless stated otherwise.',
        children: [],
      },
      { id: 'h-results', type: 'heading', level: 2, html: 'Results' },
      {
        id: 'p-4',
        type: 'paragraph',
        html: 'Table 1 compares perplexity at matched compute: routing closes most of the gap to a model eight times larger.',
        children: [],
      },
      {
        id: 'p-4t',
        type: 'paragraph',
        html: ph('t-1'),
        children: [
          {
            id: 't-1',
            type: 'table',
            rows: 4,
            cols: 3,
            header: true,
            data: [
              ['Model', 'Params', 'PPL @ 32k'],
              ['Dense', '1.3B', '11.8'],
              ['Switch', '8 × 1.3B', '10.9'],
              ['Ours', '8 × 1.3B', '10.1'],
            ],
            caption: 'Perplexity at 32k context, matched FLOPs.',
          },
        ],
      },
      { id: 'd-1', type: 'divider' },
      { id: 'h-todo', type: 'heading', level: 3, html: 'Before submission' },
      { id: 'todo-1', type: 'paragraph', variant: 'todo', checked: true, html: 'Run the 128k ablation.', children: [] },
      { id: 'todo-2', type: 'paragraph', variant: 'todo', checked: false, html: 'Tighten the related-work section.', children: [] },
      { id: 'p-5', type: 'paragraph', html: '', children: [] },
    ],
  };
}
