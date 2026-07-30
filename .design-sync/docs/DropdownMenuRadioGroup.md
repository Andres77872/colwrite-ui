---
category: Overlays
keywords: [dropdown, radio group, single choice, selected value, check mark, setting]
---

# DropdownMenuRadioGroup

A `role="group"` wrapper that carries the **currently selected value** for a
single-choice section of a menu — citation style, default export format, heading
level. It renders no box and no spacing of its own; it is `DropdownMenuGroup`
plus a `value`.

> **Radix's `RadioItem` is not re-exported by this DS.** Draw the rows with
> `DropdownMenuItem inset` and put a `Check` in the gutter that `inset` reserves.
> The group still gives the section its semantics and holds the value; the
> selected row is yours to mark. Same for `CheckboxItem` — there is none.

## Usage

```jsx
<DropdownMenuContent align="start" className="w-56">
  <DropdownMenuLabel inset>Citation style</DropdownMenuLabel>
  <DropdownMenuSeparator />

  <DropdownMenuRadioGroup value={style}>
    {CITATION_STYLES.map((s) => (
      <DropdownMenuItem key={s.id} inset onSelect={() => setStyle(s.id)}>
        {s.id === style && (
          <span className="absolute left-2 flex items-center justify-center">
            <Check aria-hidden="true" />
          </span>
        )}
        {s.label}
      </DropdownMenuItem>
    ))}
  </DropdownMenuRadioGroup>
</DropdownMenuContent>
```

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `value` | `string` | The selected value. Set it even though the rows are plain items — it is what assistive tech and any future `RadioItem` read. |
| `onValueChange` | `(value: string) => void` | Filtered out of the emitted `.d.ts`. It only fires for Radix `RadioItem` children, so with plain items put your handler on each item's `onSelect`. |
| `asChild` | `boolean` | Render your own element with the group semantics. |

Standard div attributes pass through, `aria-label` included — worth setting when
the section has no visible `DropdownMenuLabel`.

## The marker

The item row is already `relative`, and `inset` adds `pl-8`, so the marker is an
absolutely positioned span at `left-2`:

```jsx
<span className="absolute left-2 flex items-center justify-center">
  <Check aria-hidden="true" />
</span>
```

The row's `[&_svg]:size-4` rule sizes the glyph, so do not add a size class — it
loses to that descendant selector anyway. Use `Check` for a chosen option in a
list, and reserve the gutter on **every** row in the group with `inset` so the
labels do not shift when the selection moves.

## Notes

- Give the group a heading — `DropdownMenuLabel inset` above it, so the caption
  sits on the same text column as the rows.
- Add a trailing hint with `ml-auto text-2xs text-muted-foreground` (a file
  extension, a shortcut) rather than widening the label.
- A radio group works inside `DropdownMenuSubContent` too, which is the tidy way
  to offer a setting from a menu that is mostly actions — one "Level" branch
  holding the three heading levels.
- More than about six options, or options that need descriptions, belong in a
  `Dialog` or a `Popover` with a real list; a menu that scrolls is a poor picker.
- Selecting a row closes the whole menu. To let the user try several values in a
  row, `event.preventDefault()` in the item's `onSelect` — see
  `DropdownMenuItem`.

## See also

`DropdownMenuGroup` · `DropdownMenuItem` · `DropdownMenuLabel` ·
`DropdownMenuSubContent` · `DropdownMenu`
