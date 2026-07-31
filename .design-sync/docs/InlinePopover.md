---
category: Inline widgets
keywords: [inline popover, widget editor, popover, edit panel, settings]
---

# InlinePopover

The popover every inline widget edits through.

```ts
InlinePopover({ align, trigger, contentClassName, children }: {
  align?: 'start' | 'center' | 'end'
  trigger: ReactNode
  contentClassName?: string
  children: (close: () => void) => ReactNode
})
```

**`children` is a function, not a node** — it receives `close`, which is what a
`SettingsFooter`'s Done button calls.

It wires the three things each widget used to do by hand and occasionally forgot:
stops the surrounding contenteditable from seeing popover events, prevents Radix
from moving focus into the panel (the caret belongs to the document), and hands
children that `close`.

Open state is internal; there is no `open` prop.
