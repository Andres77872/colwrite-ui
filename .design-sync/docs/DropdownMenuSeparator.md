---
category: Overlays
keywords: [dropdown, menu separator, divider, rule, section break]
---

# DropdownMenuSeparator

A 1px rule between sections of a menu: `-mx-1 my-1 h-px bg-border`. The negative
inline margin cancels the panel's 4px padding so the rule runs edge to edge,
which is what makes it read as a section break rather than as a thin item. Radix
renders it with `role="separator"` and no focus, so arrow keys pass straight over
it.

## Usage

```jsx
<DropdownMenuContent align="end" className="w-56">
  <DropdownMenuItem onSelect={rename}>
    <Pencil /> Rename
  </DropdownMenuItem>
  <DropdownMenuItem onSelect={duplicate}>
    <Copy /> Duplicate
  </DropdownMenuItem>
  <DropdownMenuSeparator />
  <DropdownMenuItem
    className="text-destructive focus:text-destructive"
    onSelect={remove}
  >
    <Trash2 /> Delete document
  </DropdownMenuItem>
</DropdownMenuContent>
```

## Props

Takes no props of its own. `className` (to change the spacing — `my-2` for a
heavier break), `asChild`, and standard div attributes pass through; those DOM
props are filtered from the emitted `.d.ts` but they work.

## Where the rules go

- **Before a destructive action, always.** Every delete row in the app sits alone
  behind a separator, so "Delete document" can never be the row your thumb lands
  on after "Move to collection".
- **Between an object caption and its actions** — `DropdownMenuLabel` then a rule
  then the items.
- **Between sections in a multi-section menu.** The AI actions menu puts the rule
  *before* each new eyebrow label rather than after it, so a section header is
  always attached to the items it heads.
- **Around a non-item control.** The block options menu brackets its column
  picker in rules, which is what separates a hand-rolled control from the rows
  Radix manages.
- **Not** after every item. Three rules in a five-row menu make a table, not a
  menu; group first and separate second.

## Notes

- Consecutive separators (or one at the very top or bottom of a panel) show up as
  stray hairlines — an empty section usually means an item was conditionally
  rendered and the rule around it was not. Render the rule with the same
  condition.
- Inside a `DropdownMenuSubContent` the same component and the same spacing apply;
  there is no separate sub variant.
- For a rule in ordinary page content use a `border-t border-border` div — this
  component's negative margins are tuned for the menu panel's padding.

## See also

`DropdownMenu` · `DropdownMenuContent` · `DropdownMenuGroup` ·
`DropdownMenuLabel` · `DropdownMenuItem`
