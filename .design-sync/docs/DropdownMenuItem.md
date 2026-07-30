---
category: Overlays
keywords: [dropdown, menu item, action, onSelect, disabled, destructive, inset, shortcut]
---

# DropdownMenuItem

One action row in a menu — the only interactive part of the compound. 13px text
on a `rounded-sm` row, `px-2 py-1.5`, an 8px gap to its leading icon, and a
`bg-accent` highlight on focus. Radix gives it roving focus, so hover and
keyboard highlight are the same state; there is no separate hover style.

## Usage

```jsx
<DropdownMenuItem onSelect={rename}>
  <Pencil /> Rename
  <Kbd className="ml-auto">F2</Kbd>
</DropdownMenuItem>

<DropdownMenuItem disabled onSelect={move}>
  <FolderInput /> Move to collection
</DropdownMenuItem>

<DropdownMenuItem
  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
  onSelect={remove}
>
  <Trash2 /> Delete document
</DropdownMenuItem>
```

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `onSelect` | `(event: Event) => void` | Fires for click **and** for Enter/Space. Call `event.preventDefault()` to keep the menu open. Filtered out of the emitted `.d.ts` — it exists. |
| `disabled` | `boolean` | 50% opacity, no pointer events, skipped by arrow keys, still announced as disabled. |
| `inset` | `boolean` | Adds `pl-8`, reserving the icon gutter so a row with no icon lines up with rows that have one. |
| `textValue` | `string` | What typeahead matches, when the visible text is not it. |
| `asChild` | `boolean` | Render your own element as the row. Needed for a real `<a>`. |

Standard attributes pass through (`className`, `aria-*`, `data-*`, `onClick`,
`title`) even though the emitted `.d.ts` filters them. `onClick` fires on
keyboard activation too, because Radix activates the row by dispatching a click —
the topbar menu uses `onClick`, the editor menus use `onSelect`. Prefer
`onSelect`: it is the documented hook and the only one that can keep the menu
open.

## Icons

Pass a `lucide-react` icon as the first child. The row sizes every descendant
`svg` to 16px and makes it non-interactive (`[&_svg]:size-4
[&_svg]:pointer-events-none`), so no per-icon size class is needed — and a size
class you add loses to that rule anyway. Icons in secondary menus are usually
muted (`className="text-muted-foreground"`); action menus leave them at the row's
own colour.

## Patterns

- **Destructive row** — `text-destructive focus:bg-destructive/10
  focus:text-destructive`, always last, always behind a `DropdownMenuSeparator`.
  The `focus:` half matters: without it the row turns `accent-foreground` on
  highlight and the warning colour disappears exactly when the row is about to
  fire.
- **Shortcut hint** — a `Kbd` with `ml-auto` after the label. There is no
  `DropdownMenuShortcut` export in this DS.
- **Two-line row** — add `items-start` to the row, `mt-0.5` to the icon, and put
  a `flex min-w-0 flex-col` span around a 13px title and an `text-xs
  text-muted-foreground` description.
- **Selected row** — `inset` plus an absolutely positioned `Check` at `left-2`;
  the row is already `relative`. See `DropdownMenuRadioGroup`.
- **Keep the menu open** — `onSelect={(e) => { e.preventDefault(); … }}`, the way
  the translate submenu swaps in its custom-language field.

## Notes

- A row that is unavailable should be `disabled` with the reason in the copy
  ("Select some text first"), not hidden — a menu whose contents move between
  openings is hard to learn.
- Do not nest a `<button>` inside an item; the row is already the button. For a
  row that navigates, use `asChild` with an `<a>`.

## See also

`DropdownMenu` · `DropdownMenuContent` · `DropdownMenuLabel` ·
`DropdownMenuSeparator` · `DropdownMenuSubTrigger` · `DropdownMenuRadioGroup` ·
`Kbd`
