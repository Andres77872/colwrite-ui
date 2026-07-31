---
category: Inline widgets
keywords: [figure shell, block widget frame, table frame, figure, caption, controls]
---

# InlineFigureShell

The block-level frame for widgets that occupy their own line — tables and
figures. It supplies the border, the surface, the caption slot and the control
header, so `TableInline` and `GraphInline` supply only content.

```ts
InlineFigureShell({ label, children, caption, controls, onRemove, className }: {
  label: string
  children: ReactNode
  caption?: ReactNode
  controls?: ReactNode
  onRemove: () => void
  className?: string
})
```

**The control header only materialises on hover or focus-within.** It is
`opacity-0` at rest by design: a permanently visible strip of grey buttons above
every table made a document with three tables read as a form rather than a paper.
`label` is both the uppercase caption in that header and the group's accessible
name.

Everything renders as `<span>` elements with `contentEditable={false}`, because
the whole shell lives inside a contenteditable paragraph — do not swap them for
`<div>`s.
