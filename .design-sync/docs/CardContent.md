---
category: Content
keywords: [card content, card body, body region, card padding, content]
---

# CardContent

The body of a [`Card`](./Card.md) — `p-4 pt-0`.

The `pt-0` is the whole design: it assumes a [`CardHeader`](./CardHeader.md)
directly above it has already paid for the top padding. **If `CardContent` is
the first child of the card, add `pt-4` back**, otherwise the content sits flush
against the border.

## Usage

```jsx
<Card>
  <CardHeader>
    <CardTitle className="text-md">Method</CardTitle>
    <CardDescription>Section 3 · 6 blocks</CardDescription>
  </CardHeader>
  <CardContent>
    <p className="text-sm leading-relaxed text-muted-foreground">
      We train the router with a capacity-aware auxiliary loss…
    </p>
  </CardContent>
</Card>

// no header above it
<Card>
  <CardContent className="grid grid-cols-3 gap-3 pt-4">…</CardContent>
</Card>

// edge-to-edge rows: drop the padding here and pad the rows
<CardContent className="p-0">
  <ul className="divide-y divide-border/50 border-t border-border/50">
    <li className="px-4 py-2">…</li>
  </ul>
</CardContent>
```

## Props

- `className` merges in. The four overrides in practice: `pt-4` (no header
  above), `p-0` (full-bleed rows, tables, images), `p-3 pt-0` (panel density),
  and a layout class (`grid`, `space-y-2`, `flex`) since the base sets none.
- Standard `div` attributes (`id`, `style`, `onClick`, `aria-*`, `data-*`) pass
  through — filtered from the emitted `.d.ts`, but supported.
- Forwards a ref to the `div`.

## Composition

- It is a plain padded `div` with **no layout of its own** — no flex, no grid, no
  vertical rhythm. Bring your own (`space-y-*`, `grid`, `divide-y`).
- Body text is `text-sm`; use `text-muted-foreground` for supporting prose and
  plain `text-foreground` for the card's real payload. `text-xs` at panel density.
- Unlike `CardDescription` this is a `div`, so block content is fine: badges,
  lists, buttons, images, nested `bg-muted` / `bg-background/60` regions.
- Multiple `CardContent` blocks in one card are legal but usually a sign the card
  wants a `divide-y` list or two separate cards.
- If the card body is empty, render `EmptyState` inside a bare `Card` rather than
  an empty `CardContent`.
