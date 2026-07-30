---
category: Content
keywords: [card title, heading, h3, card heading, title]
---

# CardTitle

The name of a [`Card`](./Card.md). Renders an `<h3>` with `font-semibold
leading-none tracking-tight`.

**It sets no font size.** That is deliberate — a card title in a 380px side
panel and one on the main canvas are not the same size — so *you always add
one*: `text-sm` in a panel row, `text-md` for a card in a page-width column,
`text-lg` for a section heading. Left alone it inherits the surrounding size
and looks like bold body text.

`leading-none` also means a title that wraps to two lines has no line gap; add
`leading-tight` if wrapping is expected, or `truncate` if it is not.

## Usage

```jsx
<Card>
  <CardHeader>
    <CardTitle className="text-md">Retrieval-Augmented Generation at Scale</CardTitle>
    <CardDescription>arXiv:2402.10113 · 24 pages</CardDescription>
  </CardHeader>
</Card>
```

With a leading icon, and truncating in a narrow panel:

```jsx
<CardTitle className="flex items-center gap-2 text-sm">
  <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  <span className="truncate">Capacity-Aware Expert Routing for Sparse MoE Transformers</span>
</CardTitle>
```

The icon needs `shrink-0` and the text needs its own `<span className="truncate">`
— `truncate` on the flex parent clips the icon instead.

## Props

- `className` merges in. Always carries a size; commonly also `flex items-center
  gap-2` for an icon, `truncate`, or `text-primary` when the title is a link.
- Standard heading attributes (`id`, `style`, `title`, `aria-*`, `data-*`) pass
  through — filtered from the emitted `.d.ts`, but supported. `id` plus
  `aria-labelledby` on the card is how you name a card region.
- Forwards a ref to the `<h3>`.
- No `asChild` and no level prop: it is always `<h3>`. If the document outline
  needs a different level, write the heading element yourself with these classes.

## Composition

- Lives in `CardHeader`, above an optional `CardDescription`.
- To make the title a link, put the `<a>` inside it (`<CardTitle><a
  className="text-primary hover:underline" …>` ) rather than wrapping the title
  in an anchor.
- Do not add a bottom margin — `CardHeader`'s `space-y-1.5` owns the gap to the
  description.
