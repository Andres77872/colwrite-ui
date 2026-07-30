---
category: Content
keywords: [card, surface, panel, container, tile, search result, paper card]
---

# Card

The one raised surface in Colwrite: `rounded-lg border border-border bg-card
text-card-foreground shadow-sm`. Everything that reads as a discrete object —
a search result, an uploaded PDF, a feature tile, a stat group — sits on a
`Card`. Reach for it instead of hand-writing that class string; hand-written
surfaces are how the app ended up with three near-identical result rows.

**Card ships no padding.** Either add it yourself (`p-3` in a side panel, `p-4`
on the main canvas — both are used in the app) or compose the subparts, which
bring their own `p-4`. Never both.

## Usage

```jsx
// Composed: header / content / footer bring their own padding
<Card>
  <CardHeader>
    <CardTitle className="text-md">vaswani-2017-attention.pdf</CardTitle>
    <CardDescription>Uploaded 12 Mar · 2.4 MB · 15 pages</CardDescription>
  </CardHeader>
  <CardContent>…</CardContent>
  <CardFooter className="justify-end gap-2">
    <Button size="sm">Attach to document</Button>
  </CardFooter>
</Card>

// Bare surface: you own the padding
<Card className="p-4">…</Card>

// asChild: keep the semantic element, take the surface
<Card asChild className="p-3">
  <article>…</article>
</Card>
```

## When to use which

| Surface | Use for |
| --- | --- |
| `Card` (`bg-card`) | A discrete object on the app background: result, resource, tile. |
| `bg-popover` + `shadow-lg` | Floating layers — use `PopoverContent` / `DropdownMenuContent`, not a Card. |
| `bg-muted` / `bg-background/60` | A *nested* region **inside** a Card. Do not nest a Card in a Card. |

Cards are not interactive by themselves. A clickable card is a `<button>` or
`<a>` under `asChild`, and the app's hover treatment is a border change
(`hover:border-border/80`), never a background swap.

## Props

- `asChild?: boolean` — render the surface onto the single child element instead
  of a `<div>`. The child keeps its tag and semantics (`<article>`, `<li>`,
  `<a>`, `<button>`) and receives the card classes. Exactly one child element.
- `className` merges into the base classes, so `p-3`, `w-*`, `overflow-hidden`
  and hover overrides all work.
- Standard `div` attributes (`id`, `style`, `onClick`, `role`, `aria-*`,
  `data-*`) pass through to the rendered element — they are filtered out of the
  emitted `.d.ts` but are fully supported.
- Forwards a ref to the rendered element.

## Composition

- Subparts: `CardHeader` → (`CardTitle`, `CardDescription`), `CardContent`,
  `CardFooter`. Each is documented separately. They are plain `div`s with
  padding conventions — order is yours to choose, and any of them can be
  omitted.
- The vertical rhythm assumes header-then-content-then-footer: `CardContent` and
  `CardFooter` are `p-4 pt-0` because something padded sits above them. Using
  `CardContent` as the *first* child needs `pt-4` back.
- To bound a card's width, set it on the `Card` (`w-full max-w-sm` for a panel
  card, `max-w-md`/`max-w-lg` on the canvas), not on the subparts. Prefer these
  named steps over arbitrary values like `w-[380px]` — arbitrary utilities are
  not in the shipped stylesheet and render as nothing.
- Rows inside a card divide with `divide-y divide-border/50` — put them in a
  `CardContent className="p-0"` and pad the rows instead.
