---
category: Overlays
keywords: [dialog close, dismiss, cancel button, asChild, close icon]
---

# DialogClose

Any control that dismisses the dialog. Clicking it sets the root's open state to
`false` — so a `Cancel` button wrapped in `DialogClose` needs no `onClick`, no
`setOpen(false)`, and works identically whether the `Dialog` is controlled or
not.

You already get one for free: `DialogContent` renders a `DialogClose` in its
top-right corner (the `X` at `right-4 top-4`, `text-muted-foreground` with a
`hover:bg-accent` square and an `sr-only` "Close" label). `showCloseButton={false}`
removes it.

## Usage

```jsx
<DialogFooter className="mt-5">
  <DialogClose asChild>
    <Button variant="outline">Cancel</Button>
  </DialogClose>
  <Button onClick={save}>Save changes</Button>
</DialogFooter>
```

## Which dismissal to use

| Situation | Pattern |
| --- | --- |
| A form or a decision | Footer `outline`/`ghost` cancel via `DialogClose asChild`, and `showCloseButton={false}` on the content so there is one obvious way out. |
| A panel with nothing to commit — a picker, an attachment drop zone, a reference list | Keep the default corner button and skip the footer entirely. |
| An acknowledgement | A single `DialogClose asChild` button in the body or footer ("Back to sign in", "Dismiss"). |
| Cancel must run cleanup, or is blocked mid-flight | Do **not** use `DialogClose` — drive `onOpenChange` yourself (`onOpenChange={(next) => !saving && onOpenChange(next)}`) and give the button its own handler. |

## Always `asChild`

Bare, `DialogClose` renders an unstyled `<button>`. Wrap a `Button` with
`asChild` so there is one element, one focus ring, and no nested buttons. An
icon-only close needs an `aria-label` (or an `sr-only` span, which is what the
built-in corner button uses).

## Props

| Prop | Meaning |
| --- | --- |
| `asChild` | Render the child as the close control. Effectively always on. |
| `disabled` | Passed through; prefer disabling the `Button` you pass in. |

Standard button attributes (`onClick`, `type`, `className`, `aria-*`, `data-*`)
pass through even though the emitted `.d.ts` filters native props out. Your
`onClick` runs *and* the dialog closes — fine for fire-and-forget telemetry,
wrong for anything that must be able to keep the dialog open.

`type` matters inside a `<form>`: a `DialogClose asChild` button in a form dialog
must be `type="button"`, or it submits on the way out.

## See also

`Dialog` (the root and the full part list) · `DialogContent` (`showCloseButton`)
· `DialogFooter` (where the cancel lives) · `DialogTrigger` (the matching
opening control, and where focus returns to).
