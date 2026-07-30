---
category: Actions
keywords: [button, action, cta, submit, icon button, link button]
---

# Button

The single action control. Every clickable action in Colwrite is a `Button` —
there are no hand-rolled `<button>` elements in the app, and adding one means
re-deriving focus rings, disabled styling and icon sizing that this already has.

## Usage

```jsx
<Button onClick={save}>Save draft</Button>

<Button variant="destructive" size="sm">
  <Trash2 />
  Discard
</Button>

<Button variant="icon" size="icon-sm" aria-label="Add block">
  <Plus />
</Button>
```

## Variants

| variant | Use for |
| --- | --- |
| `default` | The primary action in a view or dialog. Filled with `primary-strong`. |
| `secondary` | A second action of comparable weight. |
| `outline` | Actions on top of a card or panel surface. |
| `ghost` | Low-emphasis actions — cancel, dismiss, inline toolbar controls. |
| `destructive` | Deletes and discards. Filled with `destructive-strong`. |
| `link` | Navigation rendered as text; no padding box. |
| `icon` | A bordered square holding one icon, on the `card` surface. |

`default` and `destructive` fill with the `-strong` token, not the base hue:
`primary` (#6366f1) carries white at only 4.47:1, under the 4.5:1 an 11–13px
button label needs. Do not "fix" a filled button by swapping to the lighter hue.

## Sizes

`lg` · `default` · `sm` · `xs` for text buttons; `icon` (36px), `icon-sm` (28px),
`icon-xs` (24px) for square icon-only buttons. `xs` and `icon-xs` shrink their
glyph to 14px — every other size inherits the base 16px, so an icon never needs
a per-instance size override.

## Icons

Pass a `lucide-react` icon as a child, before or after the label; the base class
sizes and centres it (`[&_svg]:size-4`) and the 8px gap is built in. An icon-only
button **must** carry `aria-label` — there is no text to announce.

## Composition

- `asChild` renders the styled surface as the child element instead of a
  `<button>` — use it for links (`<Button asChild><a href="…">…</a></Button>`).
- Standard button attributes (`type`, `disabled`, `onClick`, `form`, `aria-*`)
  pass through to the underlying element.
- `disabled` drops opacity to 50% and removes pointer events; it does not need a
  separate variant.
