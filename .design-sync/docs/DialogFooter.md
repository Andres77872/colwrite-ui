---
category: Overlays
keywords: [dialog footer, modal actions, action row, confirm, cancel]
---

# DialogFooter

The action row at the bottom of a `DialogContent`. Below `sm` it is a
`flex-col-reverse` stack; from `sm` up it is a right-aligned row
(`sm:flex-row sm:justify-end`) with an 8px gap.

**Consequence: the primary action goes LAST in source order.** Reversed stacking
puts it at the top on a narrow width, and `justify-end` puts it rightmost on a
wide one. Writing the primary first gets both wrong.

It has no margin of its own — add `mt-5` or `mt-6` to separate it from the body.

## Usage

```jsx
<DialogFooter className="mt-6">
  <DialogClose asChild>
    <Button variant="outline">Cancel</Button>
  </DialogClose>
  <Button>Accept all</Button>
</DialogFooter>
```

## How many actions

| Shape | Pattern |
| --- | --- |
| One | Just the primary — an acknowledgement ("Sign in again"). Pair it with `showCloseButton` so there is still a way out. |
| Two | `outline` (or `ghost`) cancel, then the primary. The app's default. |
| Two, destructive | `outline` cancel, then `variant="destructive"` with a verb-first label: "Delete folder and contents". |
| Three | `ghost` for the escape, `outline` for the secondary choice, `default` for the commit. Beyond three, the dialog is really a form — move the extra choice into the body. |

## Pending state

Disable the primary and put a `Spinner` inside it rather than swapping the
footer out; keep the cancel button mounted but `disabled` so the row does not
reflow:

```jsx
<DialogFooter className="mt-5">
  <Button variant="outline" disabled={moving} onClick={() => onOpenChange(false)}>
    Cancel
  </Button>
  <Button disabled={!target || moving} onClick={move}>
    {moving && <Spinner />}
    Move here
  </Button>
</DialogFooter>
```

## Props

Plain `<div>`: `className` plus any standard div attribute passes through (native
props are filtered out of the emitted `.d.ts`, but they reach the DOM). No `ref`.

To pin one action to the left, override the justification —
`className="mt-6 sm:justify-between"` — rather than adding a spacer element.

## See also

`Dialog` (the root and the full part list) · `DialogClose` (wrap the cancel
button in it and the dialog closes with no state of your own) · `Button` (the
variants named above) · `ConfirmProvider` for the two-button confirm already
wired.
