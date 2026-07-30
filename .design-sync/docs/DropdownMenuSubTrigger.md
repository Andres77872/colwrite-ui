---
category: Overlays
keywords: [dropdown, submenu trigger, nested menu row, chevron, inset, disabled]
---

# DropdownMenuSubTrigger

The row inside a parent menu that opens a submenu. It carries **exactly the same
row styling as `DropdownMenuItem`** — 13px, `rounded-sm`, `px-2 py-1.5`, 8px icon
gap, `bg-accent` on focus, 50% opacity when disabled — but selecting it opens the
branch instead of firing an action.

It does **not** add a chevron. Write the trailing `ChevronRight` yourself, or the
row is indistinguishable from an ordinary item.

## Usage

```jsx
<DropdownMenuSub>
  <DropdownMenuSubTrigger>
    <Languages /> Translate
    <ChevronRight className="ml-auto" />
  </DropdownMenuSubTrigger>
  <DropdownMenuSubContent className="min-w-[12rem]">…</DropdownMenuSubContent>
</DropdownMenuSub>
```

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `inset` | `boolean` | Adds `pl-8`, so the row sits on the same text column as `inset` items above it. |
| `disabled` | `boolean` | 50% opacity, no pointer events, skipped by arrow keys — and the branch can never open. |
| `textValue` | `string` | What typeahead matches, when the visible text is not it. |
| `asChild` | `boolean` | Render your own element as the row. |

Standard attributes pass through (`className`, `aria-*`, `data-*`) — filtered
from the emitted `.d.ts`, present at runtime. Radix adds
`aria-haspopup="menu"`, `aria-expanded` and `data-state`, so assistive tech
announces the row as a submenu without extra markup from you.

## Notes

- **`ChevronRight` with `ml-auto`** is the convention throughout the app. The row
  sizes it to 16px automatically (`[&_svg]:size-4`), so no size class is needed.
- There is no `onSelect` here. A row that both opens a branch and does something
  is a bug waiting to happen — put the action as the first item *inside* the
  submenu ("Plain .tex file" before the arXiv package branch).
- `disabled` is the right answer for an empty branch — an account with no
  collections gets a dimmed "Move to collection", not a submenu that opens onto
  nothing. Keep the reason in the copy where it fits.
- While its branch is open the row keeps the `bg-accent` highlight, which is what
  shows the path back through a nested menu; do not override that with your own
  hover style.
- `inset` matters when the parent menu mixes icon rows and check rows: without it
  a chevron row starts at the icon column and the text column visibly jogs.

## See also

`DropdownMenuSub` · `DropdownMenuSubContent` · `DropdownMenuItem` ·
`DropdownMenuContent`
