---
category: Inline widgets
keywords: [settings checkbox, checkbox row, toggle, option, hint]
---

# SettingsCheck

The checkbox row inside an inline widget's settings popover: a `Checkbox` bound
to its label by `id`, with an optional hint underneath.

```ts
SettingsCheck({ id, label, checked, disabled, hint, onChange }: {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  hint?: string
  onChange: (checked: boolean) => void
})
```

Fully controlled — `checked` in, `onChange` out. `id` is required because it is
what binds the label to the control; give each row a unique one (the widgets use
`` `header-${child.id}` `` and similar).

**`hint` is a native tooltip, not visible text.** It is passed to the label's
`title` attribute, so it appears only on hover and never in a screenshot — and
touch users never see it at all. This differs from `SettingsRow`, whose `hint`
renders as a visible paragraph. If the explanation matters, put the row inside a
`SettingsRow` and use that component's `hint` instead.
