---
category: Inline widgets
keywords: [chart, svg chart, bar chart, line chart, pie chart, plot, dataviz]
---

# ChartFigure

The chart renderer behind `GraphInline` — a dependency-free SVG in four kinds.

```ts
ChartFigure({ kind, values, labels, colors, title, xLabel, yLabel, className }: {
  kind: 'bar' | 'line' | 'area' | 'pie'
  values: number[]
  labels: string[]
  colors?: string[]
  title?: string
  xLabel?: string
  yLabel?: string
  className?: string
})
```

**It owns its palette.** The eight chart-series tokens are validated against the
dark surface, so pass data and labels and let it colour itself. `colors` exists
for the one case that justifies overriding: a series that must match a colour
used elsewhere in the same paper.

`labels` should be the same length as `values`. For `pie`, values are read as
parts of a whole; for the other three they are a series.

Use it directly for charts outside a document; inside one, use `GraphInline`.
