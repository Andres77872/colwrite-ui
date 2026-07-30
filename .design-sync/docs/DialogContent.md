---
category: Overlays
keywords: [dialog content, modal panel, overlay, showCloseButton, portal, max-width]
---

# DialogContent

The panel. Everything a dialog shows lives inside it, and it is the part that
brings the rest of the machinery with it: **its own `DialogPortal` and its own
`DialogOverlay`**. Never compose those by hand around it — you would get two
scrims.

Defaults: `max-w-lg`, full width below that, `bg-card`, `border-border`,
`rounded-xl`, `p-6`, `shadow-xl`, at `z-[var(--z-modal)]` over the overlay's
`z-[var(--z-modal-backdrop)]`. A corner close button is included.

## Usage

```jsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="max-w-md" showCloseButton={false}>
    <DialogHeader>
      <DialogTitle>Create folder</DialogTitle>
      <DialogDescription>Add a folder inside Retrieval methods.</DialogDescription>
    </DialogHeader>
    <div className="mt-4 space-y-3">
      <Input value={name} onChange={(e) => setName(e.target.value)} />
    </div>
    <DialogFooter className="mt-5">
      <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
      <Button type="submit">Create folder</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

## Props

| Prop | Meaning |
| --- | --- |
| `showCloseButton` | `true` by default. Pass `false` when the footer already offers a cancel path, or while a submit is in flight (`showCloseButton={!saving}`). |
| `className` | Width override, and nothing else, in practice. `max-w-md` is the app's standard; `max-w-lg` is the default; go wider only for two-column content. |
| `onOpenAutoFocus` | `preventDefault()` then focus your own element. Used to keep a destructive confirm off the primary button, and to focus the name field in a form dialog. |
| `onCloseAutoFocus` | `preventDefault()` then focus a ref — for restoring focus when the trigger has unmounted. |
| `onPointerDownOutside` / `onEscapeKeyDown` / `onInteractOutside` | `preventDefault()` to keep the dialog open. The auth dialog blocks outside pointer-downs so a stray click cannot discard a half-typed password. |
| `forceMount` | Radix escape hatch for animation control. Not used in this app. |

Standard div attributes (`id`, `style`, `aria-*`, `data-*`) pass through to the
panel element even though the emitted `.d.ts` filters them out.

## Sizing and overflow

The panel does not scroll — the **overlay** does (`overflow-y-auto`, and it
centres the panel with `grid place-items-center`), so a tall dialog scrolls the
whole panel into view rather than trapping content in an inner box. When one
*region* is unbounded — a folder tree, a long result list — bound that region
instead:

```jsx
<div className="max-h-48 overflow-y-auto rounded-lg border border-border p-1.5">
  <CollectionTree … />
</div>
```

Keep `p-6` and let `DialogHeader` / `DialogFooter` own the vertical rhythm: the
body block gets `mt-4`, the footer `mt-5` or `mt-6`.

## Notes

- Centring is flow-based, not `translate(-50%, -50%)`. The open/close keyframes
  animate `transform` (`zoom-in-95` / `zoom-out-95`), so transform-based centring
  would be clobbered mid-animation and the panel would fly in from the top-left.
- Wrap the body in a `<form>` *inside* `DialogContent` when there is a submit, so
  Enter commits — `CollectionEditorDialog` does exactly this.
- A `DialogTitle` is required somewhere inside; Radix labels the panel with it.

## See also

`Dialog` (the root) · `DialogHeader` / `DialogFooter` (the blocks that go inside)
· `DialogOverlay` and `DialogPortal` (already included here) · `ConfirmProvider`
for a plain "are you sure?" that needs no panel of its own.
