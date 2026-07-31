---
category: Inline widgets
keywords: [table, grid, rows, columns, data table, header row]
---

# TableInline

The table widget embedded in a paragraph — a type guard on
`child.type === 'table'` wrapping an editable grid in `InlineFigureShell`.

```ts
TableInline(props: InlineWidgetProps)
```

`child.data` is a `string[][]` of `rows` × `cols` and must match those two counts.
`child.header` promotes the first row to column headings. `child.align` is
per-column (`'left' | 'center' | 'right'`) and a missing entry means left.
`child.caption` renders under the grid.

The grid supports pasting a table from the clipboard, inserting and removing rows
and columns, and merging cells; all of it goes through `tableGrid.ts` rather than
being spread across the component.
