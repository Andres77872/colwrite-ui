---
category: Content
keywords: [badge, chip, pill, tag, status, label, count, score]
---

# Badge

A small pill for a fact about the thing next to it: a match score, a citation
count, a source provider, an extraction state, an evidence stance. Always
`rounded-full border px-2.5 py-0.5 text-xs font-semibold`.

A badge is **read-only metadata, not a control**. It has no hover state and no
`onClick` in this app; if it can be clicked or dismissed it should be a `Button`.

## Usage

```jsx
<Badge variant="secondary" className="tabular-nums">91% match</Badge>
<Badge variant="success">Ready</Badge>
<Badge variant="destructive">Contradicted</Badge>
```

## Variants

| variant | Use for |
| --- | --- |
| `default` | The rare badge that is the point of the row. Filled `primary`. |
| `secondary` | The workhorse — neutral facts: counts, scores, page numbers, source names, plan tier. |
| `outline` | A quiet qualifier where even `secondary` is too much fill. |
| `success` | Confirmed / finished: `Ready`, `Supports`, `Supported`. |
| `warning` | Recoverable trouble or an unsettled answer: `Failed` (retry works), `Mixed evidence`. |
| `info` | In-progress, no action needed: `Converting`. |
| `destructive` | A dead end or a contradiction: `No text`, `Contradicted`. |

Pick the variant from what the state *means for the reader*, not from severity in
the abstract — the app deliberately renders extraction `failed` as `warning`
(retrying usually works) and `unsupported` as `destructive` (retrying never will).

Most badges in Colwrite are `secondary`. A screen where every row carries a
coloured badge has no signal left; reserve the status colours for state that
changes.

## Props

- `variant?: "default" | "secondary" | "outline" | "success" | "warning" | "info" | "destructive"` — defaults to `default`.
- `className` merges in. The established overrides:
  - `tabular-nums` on **any** numeric badge, so a list of scores or counts does
    not jitter column to column.
  - `shrink-0` when the badge is the fixed-width side of a flex row.
  - Density: `px-1.5 text-2xs` for an inline status pill, `h-4 px-1 text-2xs` for
    a badge inside a picker row, `gap-1` when it holds an icon.
- Standard `div` attributes (`id`, `style`, `title`, `aria-*`, `data-*`) pass
  through — filtered from the emitted `.d.ts`, but supported.

## Composition

- **It renders a `<div>`.** It therefore cannot go inside a `<p>`, a
  `CardDescription`, or any other phrasing-only element: the parser closes the
  paragraph early and the row collapses. For flow positions use
  `ExtractionBadge` (a `<span>`) or a `<span>` you style yourself.
- Icons: pass a `lucide-react` glyph as the first child with `aria-hidden="true"`
  and `className="h-3 w-3"`, and add `gap-1` to the badge. A spinning
  `Loader2` (`animate-spin`) is the app's in-progress badge.
- In a card header, badges go in a right-aligned `flex flex-wrap justify-end
  gap-1` so a second badge wraps under the first instead of squeezing the title.
- Keep the label to two words. These sit in 380px panels, and a wrapping pill
  loses its pill shape.
- For a fixed extraction state, prefer `ExtractionBadge` over hand-mapping
  statuses to variants — it owns the label/colour/icon vocabulary for that.
