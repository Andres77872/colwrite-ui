import { GraphInline } from 'colwrite-ui';

// GraphInline is the chart widget embedded in a paragraph. It is a type-guard
// wrapper around ChartFigure plus the InlineFigureShell chrome — the shell
// supplies the border, caption slot and hover-revealed controls; ChartFigure
// draws the SVG.
//
// `kind` is the variant axis, so the cells sweep it. All four read the same
// series where that makes sense, which is the honest comparison.
//
// The shell's control header is opacity-0 until hover/focus, so these cards
// show the resting state — see the InlineFigureShell preview for the same note.

const refs = { current: {} as Record<string, HTMLDivElement | null> };
const noop = () => {};

const wiring = {
  blockId: 'block-1',
  updateParagraphChild: noop,
  removeParagraphChild: noop,
  updateHtml: noop,
  refs,
};

const LOSS = [3.41, 3.05, 2.84, 2.7, 2.61, 2.48, 2.39];
const LOSS_LABELS = ['1e19', '3e19', '1e20', '3e20', '1e21', '3e21', '1e22'];

export function LineChart() {
  return (
    <div className="max-w-[38rem]">
      <GraphInline
        {...wiring}
        child={{
          id: 'g1',
          type: 'graph',
          kind: 'line',
          data: { values: LOSS, labels: LOSS_LABELS },
          title: 'Loss vs. compute, schedule held fixed',
          xLabel: 'Budget (FLOPs)',
          yLabel: 'Loss',
          caption: 'Figure 3 — the exponent is stable once the schedule stops moving.',
        }}
      />
    </div>
  );
}

export function BarChart() {
  return (
    <div className="max-w-[38rem]">
      <GraphInline
        {...wiring}
        child={{
          id: 'g2',
          type: 'graph',
          kind: 'bar',
          data: { values: [2.84, 2.61, 2.39], labels: ['1e20', '3e20', '1e21'] },
          title: 'Final loss by compute budget',
          yLabel: 'Loss',
        }}
      />
    </div>
  );
}

export function AreaChart() {
  return (
    <div className="max-w-[38rem]">
      <GraphInline
        {...wiring}
        child={{
          id: 'g3',
          type: 'graph',
          kind: 'area',
          data: { values: LOSS, labels: LOSS_LABELS },
          title: 'Cumulative improvement over the 1e19 baseline',
        }}
      />
    </div>
  );
}

export function PieChart() {
  return (
    <div className="max-w-[38rem]">
      <GraphInline
        {...wiring}
        child={{
          id: 'g4',
          type: 'graph',
          kind: 'pie',
          data: { values: [46, 28, 17, 9], labels: ['Attention', 'MLP', 'Embedding', 'Other'] },
          title: 'Share of forward-pass FLOPs',
        }}
      />
    </div>
  );
}
