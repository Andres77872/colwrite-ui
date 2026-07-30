---
category: Feedback
keywords: [skeleton, placeholder, loading, shimmer, ghost, content loading, list loading]
---

# Skeleton

A shimmering placeholder block. One `Skeleton` is a single bar; a *skeleton* in
the UI sense is always several of them arranged in the shape of the row or card
that is about to arrive.

Preferable to a bare "Loading…" string wherever the shape of the result is known:
it preserves the layout, so nothing jumps when the real rows land. The research
panels used to show nothing at all during a first search — only the submit
button's label changed — which made the panel look idle while a request was in
flight.

## Skeleton vs Spinner

- **Skeleton** — a list, a set of cards, or a dashboard is loading and you know
  how many rows and roughly how wide they are. Reserves the space.
- **Spinner** — a single action is in flight (a button press, a session check),
  or the result's shape is unknown. Occupies almost no space.

Never both in the same block for the same wait. A short status line with a
`Spinner` *above* a skeleton list is fine, and is what the panels do.

## Usage

```jsx
// The real ResultsSkeleton, used by every research panel
<div aria-hidden="true" className="space-y-3">
  {Array.from({ length: 3 }).map((_, index) => (
    <div key={index} className="rounded-lg border border-border p-3">
      <Skeleton className="mb-2 h-4 w-4/6" />
      <Skeleton className="mb-2 h-3 w-2/3" />
      <Skeleton className="h-3 w-full" />
    </div>
  ))}
</div>

// A list of rows
<ul aria-busy={loading}>
  {Array.from({ length: 4 }).map((_, index) => (
    <li key={index} className="px-2 py-2">
      <Skeleton className="h-4 w-3/4" />
    </li>
  ))}
</ul>
```

## Props

`Skeleton` takes **`className` only** — it has no size, count or variant prop.
The class supplies the geometry:

- **Height** matches the line it stands in for: `h-3` for 11px meta text, `h-4`
  for a 13–14px title, `h-6`/`h-7` for a dashboard number.
- **Width** is a fraction, never a fixed pixel value: `w-3/4`, `w-2/3`, `w-5/6`,
  `w-1/2`. **Vary it between rows.** Four identical bars read as a rendering bug;
  ragged widths read as text.
- **Radius** defaults to `rounded-md`. Override for non-text shapes:
  `rounded-full` for a badge or avatar placeholder, and a square `h-9 w-9` for a
  file icon.

The fill is `bg-muted/60` with `animate-shimmer` (a 1.4s opacity pulse). It is a
deliberately quiet, very low-contrast fill: it is legible against
`bg-background`, and against `bg-card` it is only a few values lighter, so give
the skeleton group a border-only container rather than a filled one when it needs
to read clearly.

## Accessibility

The component is `aria-hidden="true"` — the bars are decorative and must not be
announced. Two consequences:

- Put `aria-busy="true"` on the list or region that is loading, so assistive tech
  knows the content is provisional.
- Do not rely on the skeleton alone to communicate "loading" to a screen reader.
  A short `role="status"` line ("Searching arXiv…") carries that.

## Composition

- **Match the real row.** Build the skeleton from the same wrapper as the loaded
  row — same padding, same `divide-y`, same gaps — and swap only the content for
  bars. If the two differ, the list visibly shifts when data arrives, which is
  the whole thing a skeleton exists to prevent.
- **Cap the count.** Three to five rows is enough; a full page of bars is worse
  than a spinner. The panels use 3, the documents menu 4.
- **Do not animate the container.** The bars already pulse; a second animation on
  the card reads as a glitch.
