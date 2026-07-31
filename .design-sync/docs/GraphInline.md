---
category: Inline widgets
keywords: [graph, chart, figure, plot, bar, line, area, pie]
---

# GraphInline

The chart widget embedded in a paragraph — a type guard on
`child.type === 'graph'` that wraps `ChartFigure` in `InlineFigureShell`.

```ts
GraphInline(props: InlineWidgetProps)
```

`child.kind` is `'bar' | 'line' | 'area' | 'pie'`; `child.data` carries `values`,
optional `labels` and optional `colors`; `title`, `caption`, `xLabel` and
`yLabel` are all optional.

Use this inside a document. To draw the same chart anywhere else — a panel, a
dashboard — use `ChartFigure` directly; it is the renderer without the document
chrome.
