---
category: Overlays
keywords: [dialog, modal, popup, confirm, overlay]
---

# Dialog

The modal container, on Radix Dialog. Use it for a decision or a short form that
must be resolved before continuing. For a "are you sure?" with no extra fields,
reach for `ConfirmProvider`/`useConfirm` instead — it is this component with the
copy and the two buttons already wired.

## Usage

```jsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogTrigger asChild>
    <Button variant="outline">Rename</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Rename document</DialogTitle>
      <DialogDescription>
        Shown in the documents menu and used for the export filename.
      </DialogDescription>
    </DialogHeader>
    <Input defaultValue={title} />
    <DialogFooter className="mt-6">
      <Button variant="ghost">Cancel</Button>
      <Button>Save title</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

## The parts

| Part | Role |
| --- | --- |
| `Dialog` | Root. Controlled via `open` / `onOpenChange`, or uncontrolled with a `DialogTrigger`. |
| `DialogTrigger` | The control that opens it. Use `asChild` to wrap a `Button`. |
| `DialogContent` | The panel. Renders its own portal **and** overlay — you do not compose those yourself. `max-w-lg` by default; override with `className`. |
| `DialogHeader` | Column wrapper for title + description, 6px gap. |
| `DialogTitle` | Required for accessibility — it names the dialog. 16px semibold. |
| `DialogDescription` | Supporting sentence, muted 13px. |
| `DialogFooter` | Actions. Stacks reversed on narrow widths, right-aligned row from `sm` up — so the primary action is last in source order. |
| `DialogClose` | Any control that dismisses. `asChild` to wrap a `Button`. |
| `DialogOverlay`, `DialogPortal` | Exported for completeness; `DialogContent` already includes both. |

## Notes

- `DialogContent` shows a corner close button by default. Pass
  `showCloseButton={false}` when the footer already offers a cancel path.
- The panel sits on the `card` surface with `shadow-xl` and a 12px radius, over a
  `black/60` backdrop-blurred overlay, at `z-[var(--z-modal)]`.
- Enter/exit animate opacity and scale (`zoom-in-95`). Centring is flow-based,
  not `translate(-50%,-50%)` — a transform-based centring would be clobbered
  mid-animation and the panel would fly in from the top-left.
- Put the primary action last in `DialogFooter`, and keep destructive confirms on
  the `destructive` variant.
