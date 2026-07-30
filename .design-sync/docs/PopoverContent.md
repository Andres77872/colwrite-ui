---
category: Overlays
keywords: [popover content, panel, align, side, sideOffset, portal, placement]
---

# PopoverContent

The panel itself. It renders **its own portal to `document.body`** — you never
compose `PopoverPortal` yourself — positions against the trigger (or the
`PopoverAnchor`), traps Escape and outside-click dismissal, and animates in and
out.

## Usage

```jsx
<PopoverContent align="start" className="w-80 p-3">
  <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
    Export as
  </span>
  <ExportOptions />
</PopoverContent>
```

## Surface

`w-72` (288px) · `rounded-md` (10px) · `border-border` · `bg-popover` ·
`text-popover-foreground` · `p-4` · `shadow-md` · `z-[var(--z-popover)]` (300).

Override the width and padding through `className` — the app's inline-widget
settings panels use `className="w-80 p-3"`, and a picker list uses `p-2` so the
rows can carry their own hover padding. Widths merge correctly (`cn` runs
`tailwind-merge`), so `w-80` replaces `w-72` rather than fighting it.

## Placement props

| Prop | Default | Notes |
| --- | --- | --- |
| `side` | `"bottom"` | `top` / `right` / `bottom` / `left`. |
| `sideOffset` | `4` | Gap in px between trigger and panel. The DS default is 4, not Radix's 0. |
| `align` | `"center"` | `start` aligns the panel's leading edge with the trigger's; `end` aligns the trailing edges, so the panel opens inward — that is the one to use for a right-hand toolbar button. |
| `alignOffset` | `0` | Nudge along the alignment axis. |
| `avoidCollisions` | `true` | Flips `side` and shifts along `align` to stay in the viewport. A `side="top"` panel with no room above will silently render below. |
| `collisionPadding` | `0` | Keep-out inset from the boundary. |
| `collisionBoundary` | viewport | Constrain to a specific element. |
| `sticky`, `hideWhenDetached`, `updatePositionStrategy` | | For panels anchored inside scrolling containers. |
| `arrowPadding` | | Only relevant if you add a `PopoverArrow`; this DS ships no arrow. |
| `forceMount` | | Keep mounted while closed, for external animation control. |

## Handler props (not in the emitted `.d.ts`)

Native and handler props are filtered out of the generated contract but all work:

- `onOpenAutoFocus`, `onCloseAutoFocus` — `event.preventDefault()` in the first
  one keeps focus where it is. **Required** when the popover opens over a
  `contenteditable` block, or the first keystroke lands in the document.
- `onEscapeKeyDown`, `onPointerDownOutside`, `onFocusOutside`,
  `onInteractOutside` — dismissal hooks; `preventDefault()` to keep it open.
- Standard div attributes (`role`, `aria-*`, `data-*`, `onKeyDown`, …).

## Notes

- Because the content is portalled to `document.body`, it escapes any
  `overflow: hidden` ancestor — that is the point. It also means a
  `position: fixed` parent's transform does not clip it.
- `data-side` and `data-align` are set on the element, and the enter animation
  slides in from the resolved side. Do not hardcode a direction in `className`.
- Content is **focusable and interactive**. If all you need is a label, use
  `TooltipContent`; if it is a list of commands, use `DropdownMenuContent`.

## See also

`Popover`, `PopoverTrigger`, `PopoverAnchor`, `TooltipContent`, `SheetContent`.
