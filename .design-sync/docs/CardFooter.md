---
category: Content
keywords: [card footer, card actions, action row, footer, card buttons]
---

# CardFooter

The action row of a [`Card`](./Card.md) — `flex items-center p-4 pt-0`.

It is already a flex row with items centred, so it needs only an alignment class:
`justify-end gap-2` for the standard actions-right layout, `justify-between` when
a piece of metadata sits opposite the action. Like
[`CardContent`](./CardContent.md) its `pt-0` assumes padded content above it.

## Usage

```jsx
<Card>
  <CardHeader>…</CardHeader>
  <CardContent>…</CardContent>
  <CardFooter className="justify-end gap-2">
    <Button variant="ghost" size="sm"><X />Reject all</Button>
    <Button size="sm"><Check />Accept all</Button>
  </CardFooter>
</Card>

// metadata opposite a single action
<CardFooter className="justify-between">
  <span className="text-xs text-muted-foreground">Uploaded 12 Mar</span>
  <Button variant="outline" size="sm">Attach</Button>
</CardFooter>

// separated from the body by a rule — restore the top padding
<CardFooter className="mt-2 justify-end gap-2 border-t border-border pt-4">…</CardFooter>
```

## Props

- `className` merges in. Always carries an alignment (`justify-end gap-2` /
  `justify-between`); other real overrides are `border-t border-border pt-4` for
  a ruled footer and `flex-col items-stretch gap-2` for stacked full-width
  buttons in a narrow panel.
- Standard `div` attributes (`id`, `style`, `aria-*`, `data-*`) pass through —
  filtered from the emitted `.d.ts`, but supported.
- Forwards a ref to the `div`.

## Composition

- Order actions left-to-right by ascending emphasis: `ghost` cancel, then
  `outline`/`secondary`, then the `default` or `destructive` primary last. The
  primary action ends up nearest the card's corner.
- `size="sm"` buttons — a footer inside a card is not a page-level action bar.
- A ruled footer needs **both** `border-t` and `pt-4`: the base class removed the
  top padding, so a border alone sits tight against the text.
- Stacked (`flex-col items-stretch`) is for cards narrower than ~320px, where two
  side-by-side buttons would wrap; give each button `w-full`.
- Do not put a footer on a card whose only action is the card itself (a clickable
  search result) — that is two competing targets.
