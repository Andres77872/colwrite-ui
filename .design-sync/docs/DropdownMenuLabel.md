---
category: Overlays
keywords: [dropdown, menu label, section header, caption, eyebrow, group heading]
---

# DropdownMenuLabel

A non-interactive caption inside a menu. It names a section, or names the object
the menu acts on. It renders `px-2 py-1.5 text-sm font-semibold` — the same row
box as an item but semibold and unfocusable, so arrow keys skip it and it takes
no highlight.

## Usage

```jsx
{/* Names the object the menu acts on. */}
<DropdownMenuContent side="right" align="start" className="w-56">
  <DropdownMenuLabel>Heading 2</DropdownMenuLabel>
  <DropdownMenuSeparator />
  <DropdownMenuItem onSelect={lock}>
    <Lock /> Lock block
  </DropdownMenuItem>
</DropdownMenuContent>
```

```jsx
{/* Section eyebrow: the editor menus mute and shrink it so the label reads as
    structure rather than as a disabled row. */}
<DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
  Transform
</DropdownMenuLabel>
```

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `inset` | `boolean` | Adds `pl-8` so the caption lines up with `inset` items below it. |
| `asChild` | `boolean` | Render your own element as the label. |
| `className` | `string` | Where the eyebrow variant comes from. |

Standard div attributes and `data-*` pass through (they are filtered from the
emitted `.d.ts`). The label has no `htmlFor`-style association — it is a caption,
not a form label; Radix marks it `role="presentation"`-equivalent and it is not
announced as interactive.

## The two shapes in use

| Shape | Classes | Used for |
| --- | --- | --- |
| Caption (default) | none | The object a menu acts on — `Paragraph`, `Heading 2`, `Vaswani et al., 2017`. Usually followed by a `DropdownMenuSeparator`. |
| Eyebrow | `text-2xs font-semibold uppercase tracking-wide text-muted-foreground` | Section headers inside a long menu — `Edit` / `Reference` / `Transform`, `Insert below`, `Columns`. No separator after it; the rule goes *before* the next section. |

A multi-line label is fine — the topbar account menu puts a muted 11px "Signed
in as" over a 13px medium email inside one label, with `truncate` on the email so
a long address cannot widen the panel.

## Notes

- Reach for the eyebrow shape as soon as a menu has more than one section; the
  default semibold caption at 13px competes with the items and reads as an
  unavailable row.
- A label is not a substitute for `DropdownMenuGroup`: wrap the label and its
  items in a group when you want assistive tech to hear them as one section.
- Because the label is unfocusable, it never receives the `bg-accent` highlight —
  do not add a hover style to it.

## See also

`DropdownMenu` · `DropdownMenuContent` · `DropdownMenuGroup` ·
`DropdownMenuSeparator` · `DropdownMenuItem`
