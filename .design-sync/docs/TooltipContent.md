---
category: Overlays
keywords: [tooltip content, hint, side, sideOffset, align, placement, label]
---

# TooltipContent

The hint bubble. A filled `bg-primary` chip with 11px `primary-foreground`
text — deliberately not a card surface, so it never reads as a panel you can
interact with.

## Usage

```jsx
<TooltipContent side="right">Collapse sidebar</TooltipContent>
```

Longer copy needs a width cap, or it renders as one very long single line:

```jsx
<TooltipContent side="bottom" align="end" className="max-w-xs">
  Sends this section, its citations and the attached PDFs to the assistant. The
  current text is kept in the block history, so the rewrite can be reverted per
  block.
</TooltipContent>
```

## Surface

`bg-primary` · `text-primary-foreground` · `text-xs` (11px) · `px-3 py-1.5` ·
`rounded-md` (10px) · `overflow-hidden` · `z-[var(--z-tooltip)]` (400).

No shadow and no border — the fill carries it. Do not restyle it into a card;
that is `PopoverContent`'s job.

## Placement props

| Prop | Default | Notes |
| --- | --- | --- |
| `side` | `"top"` | `top` / `right` / `bottom` / `left`. Point it away from the nearest viewport edge: a control on the left rail hints `right`, one on the right rail hints `left`. |
| `sideOffset` | `4` | Gap in px. The DS default is 4, not Radix's 0. |
| `align` | `"center"` | `start`/`end` are useful when the hint is much wider than the trigger — a truncated title hints `align="start"` so it lines up with the text. |
| `alignOffset` | `0` | Nudge along the alignment axis. |
| `avoidCollisions` | `true` | Flips and shifts to stay in view. A `side="top"` hint on a control near the top of the viewport will silently render below it. |
| `collisionPadding`, `collisionBoundary` | | Keep-out inset / boundary element. |
| `sticky`, `hideWhenDetached`, `updatePositionStrategy` | | For triggers inside scrolling containers. |
| `forceMount` | | Keep mounted while closed, for external animation control. |

Standard div attributes (`role`, `aria-*`, `data-*`) pass through; they are
filtered out of the emitted `TooltipContentProps`.

## Notes

- **Not portalled** in this DS — the content renders inline in the trigger's
  subtree, positioned `fixed`. So it inherits nothing from the trigger's box but
  it *is* affected by a transformed ancestor, which becomes its containing
  block. That is normally invisible; it matters only inside a
  `transform`-animated wrapper.
- Text only. No links, no buttons, no fields — the surface is unreachable by
  touch and by keyboard.
- Keep hints to a phrase. If it takes three lines, it is documentation, not a
  hint: put it in a `Popover`, or in the panel's own body copy.
- The content is announced through `aria-describedby` on the trigger. Do not
  duplicate the trigger's `aria-label` verbatim *and* add extra sentences —
  screen readers will read both.

## See also

`Tooltip`, `TooltipTrigger`, `TooltipProvider`, `PopoverContent`.
