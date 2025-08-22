# GraphInline — Development Plan

This document specifies how to implement the `GraphInline` component for small inline charts (bar, line, pie) inside paragraph text.

References:
- `src/components/editor/blocks/ParagraphBlock/ParagraphBlock.tsx`
- `src/components/common/Editable/Editable.tsx`
- `src/editor/types.ts`
- `src/components/editor/SlashMenu/items/*`

## Purpose
- Insert compact, non-intrusive charts in-flow with text for quick data cues (means, trends, proportions).
- Supported kinds (MVP): `bar`, `line`, `pie`.

## Type additions (src/editor/types.ts)
```ts
export type GraphChild = {
  id: string;
  type: 'graph';
  kind: 'bar' | 'line' | 'pie';
  data: {
    values: number[];       // length 1..12 typical; finite numbers only
    labels?: string[];      // optional; if present must match values.length
    colors?: string[];      // optional; if present must match values.length (used esp. for pie)
  };
  title?: string;           // optional short label
};
```
Extend `ParagraphChild` union to include `GraphChild`.

## Slash menu item (src/components/editor/SlashMenu/items/graph.ts)
- Export `graphItem: SlashItem` with `id: 'graph'`, `label: 'Graph'`, `group: 'insert'`.
- onSelect:
  1) Insert placeholder `<span data-child-id={id} contenteditable="false"></span>` at caret + trailing space.
  2) `updateHtml(blockId, serializeEditableHtml(editable))`.
  3) `addParagraphChild(blockId, { id, type: 'graph', kind: 'bar', data: { values: [1,2,3], labels: ['A','B','C'] } })`.

## Inline component (src/components/editor/blocks/ParagraphBlock/Inlines/GraphInline/GraphInline.tsx)
- Props: `{ blockId, child, updateParagraphChild, removeParagraphChild, updateHtml, refs }`.
- Root: `<span className="graph-inline" contentEditable={false} ...>`; stop event propagation on mouse/keys.
- UI:
  - Pill shows tiny icon + label, e.g., `Bar (3)` / `Line (5)` / `Pie (4)`.
  - Click toggles an inline editor popover `.graph-editor` with:
    - Kind switch: `bar | line | pie` (segmented control or select).
    - Values input: comma-separated numbers (e.g., `1, 2, 3`). Parse to `number[]` with validation.
    - Labels input (optional): comma-separated strings; must match `values.length` if present.
    - Colors input (optional): comma-separated CSS colors; for pie, one per slice.
    - Preview area:
      - Preferred: render using Chart.js on a `<canvas width=160 height=72>`.
      - Fallback: lightweight inline SVG preview for bar/line or textual summary where JS lib is unavailable.
    - Actions: `Remove` (×) and `Done`.
- Behavior:
  - Debounced `updateParagraphChild(blockId, child.id, { kind, data, title })` on field changes (≈60–150ms).
  - Remove flow: delete placeholder → `removeParagraphChild(blockId, child.id)` → `updateHtml(blockId, serializeEditableHtml(editable))`.
  - Keep rendered preview DOM out of persisted `html` (serialization cleans internals of `data-child-id`).

## Optional preview library (Chart.js)
- For richer preview inside the popover, optionally include Chart.js in `index.html` so `window.Chart` is available:
```html
<script defer src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" crossorigin="anonymous"></script>
```
- The component should detect availability: `const hasChart = !!(window as any)?.Chart;` and fallback if absent.

## ParagraphBlock integration
- Add portal case in `ParagraphBlock.tsx`:
  - `child.type === 'graph'` → `<GraphInline ... />`.
- Follow prop pattern used by `CitationInline` and `EquationInline`.

## Example JSON usage
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
      "data": { "values": [1, 3, 2, 5], "labels": ["Q1","Q2","Q3","Q4"] },
      "title": "Quarterly"
    }
  ]
}
```

## Styling & accessibility
- Wrapper class `.graph-inline`; popover/editor `.graph-editor`.
- Use small, unobtrusive chip styles consistent with other inlines; respect paragraph columns.
- `role="group"`, `aria-label="Graph"`; inputs/buttons have `title` attributes; Esc closes popover.

## Validation constraints (MVP)
- `values`: finite numbers; length 1..12 (soft limit for readability).
- If `labels` provided, `labels.length === values.length`.
- If `colors` provided, `colors.length === values.length`.
- Pie: all values ≥ 0 and not all zero.
- On parse errors, show inline validation and do not commit invalid state.

## Persistence and serialization
- All state (`kind`, `data`, `title`) lives in paragraph `children`.
- Persist paragraph `html` via `serializeEditableHtml(...)` so only placeholders remain in `html`.

## Future extensions (post-MVP)
- Multi-series bar/line support (`series: Array<{label, values, color}>`).
- Axis options (yMin/yMax, log scale), units/suffixes.
- Import from a selected table range or CSV paste.
- Export snapshot as SVG/PNG for figures.
