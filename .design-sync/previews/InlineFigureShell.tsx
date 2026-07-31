import { ChartFigure, InlineFigureShell } from 'colwrite-ui';

// InlineFigureShell is the block-level frame for widgets that occupy their own
// line — tables and figures. It supplies the border, the surface, the caption
// slot and the control header, so TableInline and GraphInline only supply
// content.
//
// CAPTURE NOTE: the control header (grip, uppercase label, `controls`, the
// remove button) is `opacity-0` and only materialises on hover or focus-within.
// That is deliberate — a permanently visible strip of grey buttons above every
// table made a paper read as a form — but it means these cards show the RESTING
// state. The header is real, it is simply invisible until you point at the
// figure, and no static screenshot can show it.

const noop = () => {};

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <span className="block border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

function Grid() {
  return (
    <span className="block overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <tbody>
          <tr className="border-b border-border/60">
            <th className="px-3 py-1.5 text-left font-semibold">Budget</th>
            <th className="px-3 py-1.5 text-left font-semibold">Tokens</th>
            <th className="px-3 py-1.5 text-left font-semibold">Loss</th>
          </tr>
          <tr className="border-b border-border/40">
            <td className="px-3 py-1.5">1e20</td>
            <td className="px-3 py-1.5">3.1B</td>
            <td className="px-3 py-1.5">2.84</td>
          </tr>
          <tr className="border-b border-border/40">
            <td className="px-3 py-1.5">3e20</td>
            <td className="px-3 py-1.5">8.7B</td>
            <td className="px-3 py-1.5">2.61</td>
          </tr>
          <tr>
            <td className="px-3 py-1.5">1e21</td>
            <td className="px-3 py-1.5">26B</td>
            <td className="px-3 py-1.5">2.39</td>
          </tr>
        </tbody>
      </table>
    </span>
  );
}

export function AroundATable() {
  return (
    <div className="max-w-[38rem]">
      <InlineFigureShell
        label="Table"
        onRemove={noop}
        caption={<Caption>Table 2 — matched-budget results at three compute scales.</Caption>}
      >
        <Grid />
      </InlineFigureShell>
    </div>
  );
}

export function AroundAChart() {
  return (
    <div className="max-w-[38rem]">
      <InlineFigureShell
        label="Figure"
        onRemove={noop}
        caption={<Caption>Figure 3 — loss falls smoothly once the schedule is pinned.</Caption>}
      >
        <span className="block p-3">
          <ChartFigure
            kind="bar"
            values={[2.84, 2.61, 2.39]}
            labels={['1e20', '3e20', '1e21']}
            title="Final loss by compute budget"
          />
        </span>
      </InlineFigureShell>
    </div>
  );
}

// There is deliberately no cell demonstrating `controls`. Anything passed there
// lands in the hover-revealed header, so such a cell is pixel-identical to
// AroundATable in a static capture — it would read as a duplicated variant
// rather than as documentation. The InlineSettings card covers that control.

export function WithoutACaption() {
  return (
    <div className="max-w-[38rem]">
      <InlineFigureShell label="Figure" onRemove={noop}>
        <span className="block p-3">
          <ChartFigure
            kind="line"
            values={[3.4, 3.05, 2.84, 2.7, 2.61, 2.48, 2.39]}
            labels={['1', '2', '3', '4', '5', '6', '7']}
            xLabel="Compute (log FLOPs)"
            yLabel="Loss"
          />
        </span>
      </InlineFigureShell>
    </div>
  );
}
