---
category: Overlays
keywords: [dialog portal, portal, container, stacking context, clipping, z-index]
---

# DialogPortal

Moves the dialog out of the React tree it is written in and into `document.body`.
`DialogContent` **already wraps itself in one**, so application code virtually
never writes `DialogPortal` — it is exported for completeness and for the rare
hand-composed overlay.

## Why it exists

Dialogs in Colwrite are opened from places that clip: the library side panel
(`overflow-hidden` plus its own scroll region), a scrolling documents menu, a
resizable panel with its own stacking context. Rendered in place, the panel would
be cropped by that box and its `z-[var(--z-modal)]` would be judged against the
panel's local stacking context instead of the page's. The portal is what makes an
open dialog land on the whole viewport, on top of everything, wherever it was
triggered from.

## Usage

Normally: nothing to write.

```jsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="max-w-md">…</DialogContent>   {/* portal + overlay included */}
</Dialog>
```

Hand-composed — the only shape it takes, `DialogOverlay` as the single child:

```jsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogPortal>
    <DialogOverlay>
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
        …
      </div>
    </DialogOverlay>
  </DialogPortal>
</Dialog>
```

This costs you the focus trap, Escape handling, outside-click dismissal and the
`aria-labelledby` wiring that `DialogContent` brings. Prefer restyling
`DialogContent`.

## Props

| Prop | Meaning |
| --- | --- |
| `container` | The DOM element to portal into. Defaults to `document.body` — override only for a scoped root (an embedded editor iframe, a test harness). |
| `forceMount` | Keep children mounted while the root is closed, for external animation control. Propagates to `DialogOverlay` / `DialogContent` inside it. |
| `children` | Each child is wrapped in its own portal + presence, so the overlay and a sibling content both mount and unmount with the root. |

It renders no DOM of its own, so it takes no `className`, no `style` and no
`ref` — there is nothing to style.

## Notes

- **Do not nest.** `DialogPortal` around a `DialogContent` double-portals: two
  overlays, two scrims.
- Portaled content leaves the CSS ancestry of the trigger, so nothing inherits
  from the panel it was opened in. The dialog's styling comes from
  `DialogContent`'s own classes and the DS tokens on `html body`, which is why it
  looks the same from every surface.
- `Sheet`, `Popover`, `Tooltip` and `DropdownMenu` each have their own portal for
  the same reason; the pattern is consistent across the overlays.

## See also

`Dialog` (the root and the full part list) · `DialogContent` (includes this) ·
`DialogOverlay` (the scrim it carries).
