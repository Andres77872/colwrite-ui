import { TableInline } from 'colwrite-ui';

// TableInline is the table widget embedded in a paragraph — a type-guard
// wrapper around the grid plus InlineFigureShell's chrome.
//
// `data` is rows × cols and must match `rows`/`cols`; `header` promotes the
// first row to column headings, and `align` is per-column with a missing entry
// meaning left. The shell's control header is hover-revealed, so these cards
// show the resting state.

const refs = { current: {} as Record<string, HTMLDivElement | null> };
const noop = () => {};

const wiring = {
  blockId: 'block-1',
  updateParagraphChild: noop,
  removeParagraphChild: noop,
  updateHtml: noop,
  refs,
};

export function WithHeaderRow() {
  return (
    <div className="max-w-[38rem]">
      <TableInline
        {...wiring}
        child={{
          id: 't1',
          type: 'table',
          rows: 4,
          cols: 3,
          header: true,
          align: ['left', 'right', 'right'],
          data: [
            ['Budget', 'Tokens', 'Loss'],
            ['1e20', '3.1B', '2.84'],
            ['3e20', '8.7B', '2.61'],
            ['1e21', '26B', '2.39'],
          ],
          caption: 'Table 2 — matched-budget results at three compute scales.',
        }}
      />
    </div>
  );
}

export function WithoutHeaderRow() {
  return (
    <div className="max-w-[38rem]">
      <TableInline
        {...wiring}
        child={{
          id: 't2',
          type: 'table',
          rows: 3,
          cols: 2,
          data: [
            ['Warmup steps', '2,000'],
            ['Schedule', 'cosine'],
            ['Batch size', '1,024 sequences'],
          ],
        }}
      />
    </div>
  );
}

export function CentredColumns() {
  return (
    <div className="max-w-[38rem]">
      <TableInline
        {...wiring}
        child={{
          id: 't3',
          type: 'table',
          rows: 3,
          cols: 4,
          header: true,
          align: ['left', 'center', 'center', 'center'],
          data: [
            ['Model', 'Params', 'Layers', 'Heads'],
            ['Base', '110M', '12', '12'],
            ['Large', '340M', '24', '16'],
          ],
          caption: 'Table 1 — architecture of the two baselines.',
        }}
      />
    </div>
  );
}
