---
category: Overlays
keywords: [sheet content, drawer panel, side, left, right, scrim, overlay, title]
---

# SheetContent

The drawer panel — and its scrim. It renders the portal, the overlay and the
edge-anchored panel in one component; you never compose `DialogPortal` or
`DialogOverlay` around it.

## Usage

```jsx
<SheetContent side="left" title="Workspace navigation">
  <PanelHeader
    title="Documents"
    icon={<FileText className="h-4 w-4" />}
    actions={
      <SheetClose asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Close navigation">
          <X />
        </Button>
      </SheetClose>
    }
  />
  <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">{rows}</ul>
  <div className="border-t border-border/50 p-2">
    <Button variant="outline" size="sm" className="w-full">New document</Button>
  </div>
</SheetContent>
```

## Props

| Prop | Default | Notes |
| --- | --- | --- |
| `title` | — | **Required.** Names the sheet for assistive tech; rendered visually hidden (`sr-only`). Not a visible heading — put that in your own `PanelHeader`. |
| `side` | `"left"` | `"left"` or `"right"` only. There is no top/bottom sheet in this DS. |
| `className` | | Merged over the base classes; width and padding overrides go here. |
| `asChild`, `forceMount` | | As in Radix Dialog. |
| `id`, `style`, `ref` | | Applied to the panel element. |

Handler props are filtered out of the emitted `SheetContentProps` but all work:
`onOpenAutoFocus`, `onCloseAutoFocus`, `onEscapeKeyDown`,
`onPointerDownOutside`, `onInteractOutside`, plus standard div attributes.

## Layout

The panel is a **flex column**, full height (`inset-y-0`), `w-[min(20rem,85vw)]`
— 320px, or 85% of the viewport on a narrow phone. It is `bg-card` with a
`shadow-xl` and a single border on the inner edge (`border-r` for `left`,
`border-l` for `right`).

Because it is a flex column, the standard three-row composition is:

1. a fixed header — `PanelHeader` gives you the same 44px bar the docked panels use;
2. a scrolling body — `className="min-h-0 flex-1 overflow-y-auto p-2"`. **`min-h-0` is
   required**, or the body refuses to shrink and the footer is pushed off-screen;
3. a pinned footer — `className="border-t border-border/50 p-2"`.

Any of the three is optional; the body row is what makes a long list usable.

## Notes

- The scrim is `black/60` at `z-[var(--z-modal-backdrop)]` (200); the panel is at
  `z-[var(--z-modal)]` (250). Both fade; the panel additionally slides in from
  its own edge (`slide-in-from-left-2` / `slide-in-from-right-2`).
- Everything outside is inert while open (`modal` defaults to `true`), including
  the trigger — expect the chrome behind to be dimmed and unclickable.
- Radix focuses the first focusable child on open. If that lands somewhere odd,
  `onOpenAutoFocus={(e) => e.preventDefault()}` and focus what you want instead.
- For a centred panel use `DialogContent`; for a panel anchored to a control use
  `PopoverContent`.

## See also

`Sheet`, `SheetTrigger`, `SheetClose`, `PanelHeader`, `DialogContent`.
