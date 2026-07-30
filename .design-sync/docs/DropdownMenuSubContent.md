---
category: Overlays
keywords: [dropdown, submenu content, flyout panel, nested panel, sub content]
---

# DropdownMenuSubContent

The submenu panel. Same popover surface as `DropdownMenuContent` — `bg-popover`,
`border-border`, `rounded-md`, 4px padding, `z-[var(--z-dropdown)]` — with
**`shadow-lg` instead of `shadow-md`**, so a branch reads as sitting above the
menu it came from. It anchors to its `DropdownMenuSubTrigger`, not to the root
trigger.

Unlike `DropdownMenuContent`, it does **not** portal itself: it renders inside the
parent panel's DOM unless you wrap it in `DropdownMenuPortal`.

## Usage

```jsx
<DropdownMenuSub>
  <DropdownMenuSubTrigger>
    <Folder /> Move to collection
    <ChevronRight className="ml-auto" />
  </DropdownMenuSubTrigger>
  <DropdownMenuSubContent className="min-w-[12rem]">
    <DropdownMenuItem onSelect={() => move(1)}>
      <Folder /> Transformer surveys
    </DropdownMenuItem>
    <DropdownMenuItem onSelect={() => move(2)}>
      <Folder /> Sparse attention
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={createCollection}>
      <FolderPlus /> New collection…
    </DropdownMenuItem>
  </DropdownMenuSubContent>
</DropdownMenuSub>
```

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `sideOffset` | `number` | Gap from the parent panel. Radix's default `0` applies — this DS does **not** re-default it the way `DropdownMenuContent` defaults to `4`. |
| `align` | `'start' \| 'end'` | Default `'start'` — the panel's top edge lines up with its trigger row. |
| `alignOffset` | `number` | Nudge along that axis. |
| `avoidCollisions` | `boolean` | Default `true`; a branch near the right edge flips to open leftwards. |
| `collisionPadding` | `number \| {top,right,bottom,left}` | Keep-out margin for that flip. |
| `loop` | `boolean` | Arrow keys wrap within the submenu. |
| `forceMount` | `true` | Keep mounted while closed, for external animation. |
| `asChild` | `boolean` | Replace the panel element — you then own every panel class. |

Side is not yours to choose: a submenu always opens to the inline-end side (and
flips on collision). Standard div attributes, `data-*` and Radix's
`onEscapeKeyDown` / `onPointerDownOutside` escape hatches pass through; DOM props
are filtered from the emitted `.d.ts`.

## Width

It ships `min-w-[8rem]` and otherwise hugs its content, exactly like
`DropdownMenuContent`. `min-w-[12rem]` is the app's default for a data list
(languages, collections); `w-64` suits two-line rows with a description under the
title. Give it a width whenever the rows come from data — a submenu that resizes
between openings is disorienting, and a wide branch off a narrow parent looks
accidental.

## Notes

- Wrap it in `DropdownMenuPortal` when the parent panel's stacking or
  `overflow` gets in the way, or when you need the branch on `document.body` for
  a `container` of your own. Positioning is correct either way — floating-ui
  measures through the parent's transform.
- Everything that composes inside `DropdownMenuContent` composes here:
  `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`,
  `DropdownMenuGroup`, `DropdownMenuRadioGroup`, and a further
  `DropdownMenuSub` for a second level.
- Animation is the same `data-state` / `data-side` pair as the root panel, so a
  branch that flipped slides in from the correct edge.
- Long lists want `overflow-y-auto` plus
  `max-h-[var(--radix-dropdown-menu-content-available-height)]` rather than a
  hard-coded height.

## See also

`DropdownMenuSub` · `DropdownMenuSubTrigger` · `DropdownMenuPortal` ·
`DropdownMenuContent` · `DropdownMenuItem`
