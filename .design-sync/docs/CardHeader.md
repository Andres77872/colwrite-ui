---
category: Content
keywords: [card header, card title area, header, card, heading region]
---

# CardHeader

The titling region of a [`Card`](./Card.md) — `flex flex-col space-y-1.5 p-4`.
It is the only subpart that carries padding on all four sides, which is what
makes the `pt-0` on `CardContent` and `CardFooter` correct: they sit under
something already padded.

It cannot stand alone; it is always the first child of a `Card`.

## Usage

```jsx
<Card>
  <CardHeader>
    <CardTitle className="text-md">Attention Is All You Need, Revisited</CardTitle>
    <CardDescription>Draft · 5 sections · saved 4 minutes ago</CardDescription>
  </CardHeader>
  <CardContent>…</CardContent>
</Card>
```

With a trailing action — override the column to a row and drop the stack gap,
then re-stack the text so the title/description spacing survives:

```jsx
<CardHeader className="flex-row items-start justify-between space-y-0">
  <div className="min-w-0 space-y-1.5">
    <CardTitle className="text-md">colpali-late-interaction.pdf</CardTitle>
    <CardDescription>18 pages · 4.1 MB</CardDescription>
  </div>
  <Button variant="icon" size="icon-sm" aria-label="Resource actions">
    <MoreHorizontal />
  </Button>
</CardHeader>
```

## Props

- `className` merges into the base classes. The three overrides that come up:
  `flex-row items-center justify-between space-y-0` for a header with a trailing
  action, `p-3` for a card in a 380px side panel, `pb-3` to tighten the gap
  before a row list.
- Standard `div` attributes (`id`, `style`, `onClick`, `aria-*`, `data-*`) pass
  through — they are filtered out of the emitted `.d.ts` but are supported.
- Forwards a ref to the `div`.
- Takes no `asChild`. It is a `div`; if you need a `<header>` element, write one
  and give it the same classes.

## Composition

- Children are normally `CardTitle` plus an optional `CardDescription`, in that
  order. `space-y-1.5` is tuned for exactly that pair — a bare `<p>` works too,
  but then use `CardDescription` so the muted colour and size match.
- Anything else in a header (badge, icon button, count) belongs in the
  `flex-row` form above. Do not add margins to the children to fake it.
- `CardHeader` is not required. A bare `<Card className="p-4">` with your own
  markup is the app's most common card, and correct when there is no
  title/description pair to align.
