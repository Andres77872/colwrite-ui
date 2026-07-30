---
category: Overlays
keywords: [dropdown, submenu, nested menu, sub, flyout, cascading menu]
---

# DropdownMenuSub

The nesting root for one submenu. It renders no DOM — like `DropdownMenu` it only
holds open state, but for a *branch* of the menu rather than the whole thing. Its
two children are always `DropdownMenuSubTrigger` (the row in the parent menu) and
`DropdownMenuSubContent` (the panel that flies out).

## Usage

```jsx
<DropdownMenuContent align="start" className="w-56">
  <DropdownMenuItem onSelect={rename}>
    <Pencil /> Rename
  </DropdownMenuItem>

  <DropdownMenuSub>
    <DropdownMenuSubTrigger>
      <Folder /> Move to collection
      <ChevronRight className="ml-auto" />
    </DropdownMenuSubTrigger>
    <DropdownMenuSubContent className="min-w-[12rem]">
      {collections.map((c) => (
        <DropdownMenuItem key={c.id} onSelect={() => move(c.id)}>
          <Folder /> {c.name}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={createCollection}>
        <FolderPlus /> New collection…
      </DropdownMenuItem>
    </DropdownMenuSubContent>
  </DropdownMenuSub>
</DropdownMenuContent>
```

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `open` | `boolean` | Controlled open state **for this branch only** — independent of the root menu's `open`. |
| `defaultOpen` | `boolean` | Uncontrolled initial state. |
| `onOpenChange` | `(open: boolean) => void` | Filtered out of the emitted `.d.ts` — it exists. |

Leave it uncontrolled in almost every case: Radix opens the branch on hover, on
ArrowRight and on Enter, closes it on ArrowLeft and on a pointer leave with the
usual safe-triangle grace, and closes the whole tree when an item fires. Control
it only to force a branch open (a preview or a walkthrough), or to reset it when
the parent menu's data changes underneath.

## Notes

- **Nothing inside a closed branch is mounted**, so a submenu that lists fetched
  data does not fetch until the row is hovered — which is the point of putting a
  long collection list behind a submenu instead of inline.
- Submenus nest: a `DropdownMenuSub` inside a `DropdownMenuSubContent` gives a
  second level, each level owning its own open state. Two levels is the practical
  ceiling — past that, a `Dialog` with a picker is easier to hit.
- Use one when a branch has **more than three or four choices** or its choices are
  data (collections, languages, export flavours). For two or three static actions,
  put them in the parent menu behind a separator; a submenu costs the user a hover
  and a horizontal move.
- The parent panel stays open and keeps its rows visible while a branch is open;
  the sub trigger row itself stays highlighted so the trail back is obvious.
- A submenu is not a place for input. Radix's typeahead consumes printable keys —
  see the note in `DropdownMenuContent`.

## See also

`DropdownMenuSubTrigger` · `DropdownMenuSubContent` · `DropdownMenuPortal` ·
`DropdownMenu` · `DropdownMenuContent`
