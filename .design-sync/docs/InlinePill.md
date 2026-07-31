---
category: Inline widgets
keywords: [pill, chip, inline trigger, citation trigger, badge, in-flow]
---

# InlinePill

The in-flow trigger every text-level widget shares — a real `<button>` that sits
inside a sentence without breaking the line box. A citation or an inline equation
renders as one of these before you click it.

```ts
InlinePill(props: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'default' | 'error' })
```

**Only two tones exist, on purpose.** The app reserves `primary` for interactive
constructs and destructive for errors, so a widget must not tint itself with a
chart-series or block-locked colour to signal a category — that produced two
borrowed tokens and two meanings of "clickable".

Forwards a ref, so it works as a Radix `asChild` trigger.
