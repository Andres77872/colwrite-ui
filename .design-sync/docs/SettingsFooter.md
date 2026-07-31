---
category: Inline widgets
keywords: [settings footer, remove, done, popover footer, destructive action]
---

# SettingsFooter

The one footer every inline-widget settings popover ends with: the destructive
action on the left, the safe close on the right, above a hairline rule.

```ts
SettingsFooter({ onRemove, onDone, removeLabel }: {
  onRemove: () => void
  onDone: () => void
  removeLabel?: string
})
```

Having exactly one of these is what keeps "Remove" in the same place in every
widget. `onDone` is normally the `close` that `InlinePopover` hands its children.

`removeLabel` exists so the destructive verb can name what it deletes — "Remove
table", "Remove figure" — rather than saying "Remove" next to three other things
that could also be removed.
