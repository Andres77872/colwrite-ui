---
category: Overlays
keywords: [dialog trigger, open dialog, modal trigger, asChild, disclosure]
---

# DialogTrigger

The control that opens a `Dialog`. It is the only part of the compound that is
visible while the dialog is **closed** — once `DialogContent` mounts it portals
to the body and covers the page with its overlay.

Use it whenever the dialog is opened by a control that sits next to it in the
markup: a `Rename` button in a document header, a move icon on a library row, a
`New subfolder` action in a folder header. When the dialog is opened from
somewhere else entirely — a keyboard shortcut, a menu item, a failed request —
skip the trigger and drive the root's `open` / `onOpenChange` instead.

## Usage

```jsx
<Dialog>
  <DialogTrigger asChild>
    <Button variant="outline" size="sm">Rename</Button>
  </DialogTrigger>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>Rename document</DialogTitle>
      <DialogDescription>
        Shown in the documents menu and used for the export filename.
      </DialogDescription>
    </DialogHeader>
    <Input defaultValue={title} />
    <DialogFooter className="mt-6">
      <DialogClose asChild>
        <Button variant="outline">Cancel</Button>
      </DialogClose>
      <Button>Save title</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

## Always `asChild`

On its own `DialogTrigger` renders an unstyled `<button>`. Colwrite has no
hand-rolled buttons, so in practice it is **always** `asChild` around a
`Button`:

```jsx
<DialogTrigger asChild>
  <Button variant="icon" size="icon-sm" aria-label="Move vaswani-2017-attention.pdf to a folder">
    <FolderInput />
  </Button>
</DialogTrigger>
```

`asChild` merges the trigger's behaviour onto that element instead of wrapping
it: one focusable control, one focus ring, no nested `<button>`. An icon-only
trigger must carry `aria-label` — the dialog's title is not announced until it
opens.

## Props

| Prop | Meaning |
| --- | --- |
| `asChild` | Render the child element as the trigger instead of a `<button>`. |
| `disabled` | Passed through to the underlying button. Prefer disabling the `Button` you pass as the child. |

Standard button attributes pass through (`onClick`, `type`, `className`,
`aria-*`, `data-*`) — they are filtered out of the emitted `.d.ts` but they
reach the DOM. `DialogTrigger` supplies `aria-haspopup="dialog"`,
`aria-expanded`, `aria-controls` and `data-state="open" | "closed"` itself; do
not restate them. Your own `onClick` runs before the toggle, so it can
`preventDefault()`-style bail out only by not being wired at all — to block
opening conditionally, control the root instead.

## Focus return

Radix returns focus to the trigger when the dialog closes, which is why a
trigger is worth using at all. When there is no trigger — a row action that
unmounts, a dialog opened from a menu — restore focus yourself with
`DialogContent`'s `onCloseAutoFocus` and a ref, the way `CollectionPickerDialog`
and `CollectionEditorDialog` do.

## See also

`Dialog` (the root and the full part list) · `DialogContent` (the panel it
opens) · `DialogClose` (the matching dismissal control).
