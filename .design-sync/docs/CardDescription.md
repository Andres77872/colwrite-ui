---
category: Content
keywords: [card description, subtitle, card subtitle, metadata line, secondary text]
---

# CardDescription

The line under a [`CardTitle`](./CardTitle.md): a `<p>` with `text-sm
text-muted-foreground`. Two jobs in this app —

1. **A metadata line.** Facts about the object, joined with ` · ` the way the
   rest of Colwrite joins them: `Duarte, Wei · arXiv:2311.08872 · v2, Nov 2023`.
   Drop to `text-xs` for this in a side panel.
2. **A sentence of explanation.** What the card is for, in one or two lines. Add
   `leading-relaxed` once it wraps.

Unlike `CardTitle` it *does* set a size (`text-sm`), so it needs no size class
unless you are overriding it.

## Usage

```jsx
<CardHeader>
  <CardTitle className="text-md">Sparse Routing Without Load Imbalance</CardTitle>
  <CardDescription>
    Added to the library from arXiv. Cited once, in Related Work.
  </CardDescription>
</CardHeader>

// metadata line, panel density
<CardDescription className="text-xs">
  {['Duarte, Wei', 'arXiv:2311.08872', 'v2, Nov 2023'].join(' · ')}
</CardDescription>
```

## Props

- `className` merges in. The overrides that matter: `text-xs` (panel density),
  `leading-relaxed` (multi-line prose), `truncate` (single-line metadata in a
  narrow card).
- Standard paragraph attributes (`id`, `style`, `title`, `aria-*`, `data-*`) pass
  through — filtered from the emitted `.d.ts`, but supported. Pair `id` with
  `aria-describedby` to attach it to a control.
- Forwards a ref to the `<p>`.

## Composition

- It renders a `<p>`, so **only phrasing content may go inside** — text, `<a>`,
  `<span>`, `<code>`, `<strong>`. A `Badge` is a `<div>`; nesting one here makes
  the parser close the paragraph early and the header falls apart. Put badges in
  the header's flex row or in `CardContent`, or use `ExtractionBadge`, which is a
  `<span>` for exactly this reason.
- Keep it to one or two lines. Longer body copy belongs in `CardContent`, where
  it is not styled as secondary text.
- Do not use it as the card's only text — a description with no title has nothing
  to describe; use `CardContent` (or `EmptyState` for an empty region).
