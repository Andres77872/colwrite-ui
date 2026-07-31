import { ChartFigure } from 'colwrite-ui';

// ChartFigure is the chart renderer behind GraphInline — a dependency-free SVG
// in four kinds. It owns its own palette (the eight chart-series tokens, all
// validated against the dark surface), so a caller supplies data and labels and
// nothing else; `colors` exists for the rare case where a series must match a
// colour used elsewhere in the paper.
//
// `kind` is the variant axis and the four cells below sweep it on the same
// shape of data, which is the honest comparison: bar and line/area read the
// same series, pie reads it as parts of a whole.

const LOSS = [3.41, 3.05, 2.84, 2.7, 2.61, 2.48, 2.39];
const LOSS_LABELS = ['1e19', '3e19', '1e20', '3e20', '1e21', '3e21', '1e22'];

export function Bar() {
  return (
    <div className="max-w-[34rem] rounded-lg border border-border bg-card p-4">
      <ChartFigure
        kind="bar"
        values={[2.84, 2.61, 2.39]}
        labels={['1e20', '3e20', '1e21']}
        title="Final loss by compute budget"
        xLabel="Budget (FLOPs)"
        yLabel="Loss"
      />
    </div>
  );
}

export function Line() {
  return (
    <div className="max-w-[34rem] rounded-lg border border-border bg-card p-4">
      <ChartFigure
        kind="line"
        values={LOSS}
        labels={LOSS_LABELS}
        title="Loss vs. compute, schedule held fixed"
        xLabel="Budget (FLOPs)"
        yLabel="Loss"
      />
    </div>
  );
}

export function Area() {
  return (
    <div className="max-w-[34rem] rounded-lg border border-border bg-card p-4">
      <ChartFigure
        kind="area"
        values={LOSS}
        labels={LOSS_LABELS}
        title="Cumulative improvement over the 1e19 baseline"
        yLabel="Loss"
      />
    </div>
  );
}

export function Pie() {
  return (
    <div className="max-w-[34rem] rounded-lg border border-border bg-card p-4">
      <ChartFigure
        kind="pie"
        values={[46, 28, 17, 9]}
        labels={['Attention', 'MLP', 'Embedding', 'Other']}
        title="Share of forward-pass FLOPs"
      />
    </div>
  );
}

export function WithoutTitleOrAxes() {
  return (
    <div className="max-w-[34rem] rounded-lg border border-border bg-card p-4">
      <ChartFigure kind="line" values={LOSS} labels={LOSS_LABELS} />
    </div>
  );
}
