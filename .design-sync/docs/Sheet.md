---
category: Overlays
keywords: [sheet, drawer, side panel, mobile navigation, off-canvas, radix dialog]
---

# Sheet

A dialog anchored to an edge of the viewport rather than centred — the drawer.
Built on Radix **Dialog**, so it brings a real focus trap, initial focus, focus
restore, Escape handling and a scroll lock, none of which the hand-rolled drawer
it replaced had.

In Colwrite it is what `AppShell` swaps the docked sidebar and tools panel for
below the `md` breakpoint: on a phone the workspace navigation and the tools
panel become overlay drawers instead of vanishing.

## Usage

```jsx
<Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
  <SheetTrigger asChild>
    <Button variant="ghost" size="icon-sm" aria-label="Open navigation">
      <Menu />
    </Button>
  </SheetTrigger>
  <SheetContent side="left" title="Workspace navigation">
    <PanelHeader title="Documents" icon={<FileText className="h-4 w-4" />} />
    <DocumentList />
  </SheetContent>
</Sheet>
```

Driven entirely from app state, with no trigger at all — the shape `AppShell`
uses:

```jsx
<Sheet open={isOpen} onOpenChange={(next) => !next && close()}>
  <SheetContent side="right" title="Tools">{aside}</SheetContent>
</Sheet>
```

## Props

| Prop | Notes |
| --- | --- |
| `open` | Controlled open state. Nothing renders when false. |
| `defaultOpen` | Uncontrolled initial state. |
| `onOpenChange(open)` | Fires on trigger, `SheetClose`, Escape and scrim click. **Absent from the emitted `Sheet.d.ts`** (handler props are filtered from the generated contract) but required whenever you pass `open`. |
| `modal` | Defaults to `true` — focus trap, inert background, body scroll lock. Keep it. A non-modal drawer over a document canvas lets the user type behind the scrim. |

## The parts

| Part | Role |
| --- | --- |
| `Sheet` | Root. State + context; renders nothing. |
| `SheetTrigger` | The control that opens it. Optional — a drawer driven from app state needs none. |
| `SheetContent` | The panel **and** its scrim. Portals to `document.body`. Requires `title`. |
| `SheetClose` | Any control that dismisses it. |

There is no `SheetHeader`/`SheetFooter`/`SheetTitle`: `SheetContent` is a flex
column and you supply the rows. `PanelHeader` is the header the docked panels
already use — reuse it so the drawer and the docked panel look identical.

## Choosing an overlay

| Reach for | When |
| --- | --- |
| `Sheet` | A tall panel of navigation, tools or filters, anchored to an edge. The mobile form of a docked panel. |
| `Dialog` | A decision or a short form — centred, and the user must resolve it. |
| `Popover` | A small panel anchored to the control that opened it. |
| `DropdownMenu` | A list of commands. |
| `Tooltip` | A label for a control. |

## Notes

- It cannot reuse `ui/dialog.tsx`: `DialogContent` centres itself with a grid on
  the overlay, which fights an edge-anchored panel.
- Scrim is `black/60` at `z-[var(--z-modal-backdrop)]` (200), panel at
  `z-[var(--z-modal)]` (250) — under a `Popover` (300) and a `Tooltip` (400), so
  overlays opened *from inside* the drawer still land on top.
- Radix moves focus into the panel on open. Whatever renders first inside it
  will show a focus ring in a static screenshot; that is real behaviour.

See `SheetTrigger`, `SheetContent`, `SheetClose`.
