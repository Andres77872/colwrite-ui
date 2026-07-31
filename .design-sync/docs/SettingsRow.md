---
category: Inline widgets
keywords: [settings row, label, form row, field, popover row]
---

# SettingsRow

One labelled row inside an inline widget's settings popover: an uppercase
caption, the control, and an optional hint under it.

```ts
SettingsRow({ label, htmlFor, hint, children }: {
  label: string
  htmlFor?: string
  hint?: string
  children: ReactNode
})
```

**The `htmlFor` distinction is the point of the component, not decoration.**

- **With `htmlFor`** the caption is a real `<label>` bound to one control.
- **Without it** the row groups several controls, or none, and becomes
  `role="group"` + `aria-labelledby` instead.

It previously rendered `<label htmlFor={undefined}>` as a *sibling* of the
children either way, which associates with nothing — so most rows had a caption
assistive tech never tied to anything. Pass `htmlFor` whenever there is exactly
one control.
