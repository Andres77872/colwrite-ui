---
category: Overlays
keywords: [dropdown, menu, content, panel, popover surface, align, side, portal]
---

# DropdownMenuContent

The menu panel. It is the popover surface of the compound: `bg-popover` with a
`border-border` hairline, `rounded-md` (10px), 4px of inner padding, `shadow-md`,
and `z-[var(--z-dropdown)]`. **It renders its own portal to `document.body`**, so
you never wrap it in `DropdownMenuPortal` and it can never be clipped by a
panel's `overflow-hidden`.

## Usage

```jsx
<DropdownMenuContent align="end" className="w-56">
  <DropdownMenuLabel>Paragraph</DropdownMenuLabel>
  <DropdownMenuSeparator />
  <DropdownMenuItem onSelect={hideFromAssistant}>
    <EyeOff /> Hide from assistant
  </DropdownMenuItem>
  <DropdownMenuItem onSelect={lock}>
    <Lock /> Lock block
  </DropdownMenuItem>
</DropdownMenuContent>
```

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `side` | `'top' \| 'right' \| 'bottom' \| 'left'` | Default `'bottom'`. The gutter menus use `'right'` so the panel never covers the text column. |
| `sideOffset` | `number` | **Defaults to `4` in this DS**, not Radix's `0`. |
| `align` | `'start' \| 'center' \| 'end'` | Default `'center'`. Use `'end'` for a right-aligned overflow button, `'start'` for a left-aligned one. |
| `alignOffset` | `number` | Shift along the aligned axis. |
| `avoidCollisions` | `boolean` | Default `true` — flips side and clamps to the viewport near an edge. |
| `collisionPadding` | `number \| {top,right,bottom,left}` | Keep-out margin for that flipping. |
| `loop` | `boolean` | Arrow keys wrap from last item to first. |
| `forceMount` | `true` | Keep mounted while closed, for external animation. Rarely needed. |
| `asChild` | `boolean` | Replace the panel element. You then own every panel class. |

Standard div attributes and `data-*` pass through (filtered from the emitted
`.d.ts`), as do Radix's `onCloseAutoFocus`, `onEscapeKeyDown`,
`onPointerDownOutside` and `onInteractOutside` escape hatches.

## Width

The panel ships `min-w-[8rem]` and otherwise hugs its content, so **set a width
whenever the rows can be long** — otherwise the panel resizes as the copy
changes. The widths in use: `w-44`/`w-48` for a short list of block types,
`w-56` for document and block action menus, `min-w-[15rem]` for the AI actions
menu. `overflow-hidden` on the panel clips a child that exceeds it; long labels
need `truncate` on the item's text span, not a wider panel.

## Notes

- Content is only mounted while the menu is open, so `sideOffset`/`align` are
  measured fresh on each open — a trigger that has moved gets the right position.
- Radix sets `--radix-dropdown-menu-content-available-height` on the panel; use
  it with `overflow-y-auto` for a very long list rather than hard-coding a max
  height.
- The panel's animation is keyed to `data-state` and `data-side`, so a menu that
  collided and flipped slides in from the correct edge with no extra work.
- Do not put a focusable field inside a menu — Radix's typeahead steals printable
  keys. If you must (the translate submenu has a language input), stop
  propagation on the field's `onKeyDown` and handle Enter/Escape yourself; a
  `Popover` is usually the better answer.

## See also

`DropdownMenu` · `DropdownMenuTrigger` · `DropdownMenuItem` ·
`DropdownMenuSubContent` · `DropdownMenuPortal` · `Popover`
