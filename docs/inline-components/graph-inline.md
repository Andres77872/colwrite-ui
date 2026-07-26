# GraphInline — Reference

How inline figures (small charts) work in the editor.

References:
- `src/components/editor/blocks/ParagraphBlock/Inlines/GraphInline/GraphInline.tsx`
- `src/components/editor/blocks/ParagraphBlock/Inlines/GraphInline/ChartFigure.tsx` (SVG renderer)
- `src/components/editor/blocks/ParagraphBlock/Inlines/GraphInline/chartScale.ts` (scale + palette)
- `src/components/editor/SlashMenu/items/graph.ts`
- `src/editor/types.ts`

## Status

- Implemented as a block-level figure widget (not a pill).
- Chart.js was dropped: `ChartFigure` renders plain SVG from theme tokens, so
  figures draw on the first frame and work offline.

## Purpose
- Compact charts in the document flow for quick data cues (means, trends,
  proportions).
- Kinds: `bar`, `line`, `area`, `pie`.

## Data contract (src/editor/types.ts)
```ts
export type GraphChild = {
  id: string;
  type: 'graph';
  kind: 'bar' | 'line' | 'area' | 'pie';
  data: {
    values: number[];       // finite numbers only
    labels?: string[];      // padded/trimmed to values.length by the editor
    colors?: string[];      // optional per-point overrides (esp. pie slices)
  };
  title?: string;
  caption?: string;         // rendered under the figure
  xLabel?: string;          // cartesian kinds only
  yLabel?: string;
};
```

## Slash menu item
- `graphItem` (label "Figure", `group: 'insert'`) seeds placeholder data
  (`values: [3, 5, 2]`, `labels: ['A', 'B', 'C']`) — a shaped chart shows what
  to do next; a blank axis does not.

## UI
- Shell: shared `InlineFigureShell` — bordered card whose header (kind switch,
  settings, remove) materialises on hover/focus, plus an optional caption strip.
- Header: kind toggle buttons (bar / line / area / pie) and a settings popover:
  - Title, and for cartesian kinds X/Y axis labels.
  - Data edited as **rows** (colour swatch + label + value + remove, "Add
    point") — labels are padded to the value count on every edit, so the two
    can never drift apart.
  - Caption.
  - A warning appears when a pie exceeds `MAX_PIE_SLICES` (6).
- Chart (`ChartFigure`):
  - Y axis snapped to round 1/2/5×10ⁿ ticks and always including zero
    (`linearScale`).
  - One direct value label, on the peak; the axis carries the rest.
  - Hover shows a tooltip (label + value); hit targets are the full band.
  - Pie: slices with a legend (label + percentage); identity never rests on
    colour alone.
  - Series colours come from `--color-series-*` tokens in fixed order; grid and
    axis from `--color-chart-grid` / `--color-chart-axis`.

## Behaviour
- All edits write straight through `updateParagraphChild` (no debounced shadow
  state).
- Remove flow: placeholder deleted first, then `removeParagraphChild`, then
  re-serialize via `serializeEditableHtml`.

## Example JSON
```json
{
  "id": "p1",
  "type": "paragraph",
  "html": "Trend: <span data-child-id=\"g1\" contenteditable=\"false\"></span> shows improvement.",
  "children": [
    {
      "id": "g1",
      "type": "graph",
      "kind": "line",
      "data": { "values": [1, 3, 2, 5], "labels": ["Q1", "Q2", "Q3", "Q4"] },
      "title": "Quarterly",
      "caption": "Figure 1. Score by quarter."
    }
  ]
}
```

## Validation constraints
- `values`: finite numbers (non-finite entries are filtered at render).
- `labels` are kept the same length as `values` by the row editor.
- Pie: non-positive values are dropped; all-zero shows an empty-state hint.
  Past `MAX_PIE_SLICES` the chart still renders but the settings popover warns.

## Styling & accessibility
- `role="group"`, `aria-label="Figure"`; SVG has `role="img"` with a summary
  label; hit targets cover full bands rather than 2px marks.

## Future extensions
- Multi-series bar/line (`series: Array<{ label, values, color }>`).
- Axis options (yMin/yMax, log scale), units/suffixes.
- Import from a selected table range or CSV paste.
