---
category: Inline widgets
keywords: [inline settings, gear, widget settings, options, configure]
---

# InlineSettings

The gear button a block-level widget opens its settings from — an
`InlinePopover` with the icon trigger and the `w-80 p-3` panel already supplied,
so a widget passes only rows.

```ts
InlineSettings({ label, children, align, triggerClassName }: {
  label: string
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  triggerClassName?: string
})
```

`label` names the button for assistive tech and its tooltip — "Table settings",
"Figure settings".

Radix portals the panel out of the paragraph, which is what fixed the
long-standing clipping: the hand-rolled `absolute` panels were children of an
`overflow-x-auto` table wrapper and a scrolling canvas, so a panel near an edge
was simply cut off.

Pass it as `controls` to `InlineFigureShell`. Open state is internal.
