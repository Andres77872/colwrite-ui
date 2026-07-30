---
category: Overlays
keywords: [sheet close, dismiss, drawer close, asChild, cancel, done]
---

# SheetClose

Any control that dismisses the `Sheet`. It calls `onOpenChange(false)` for you
and lets Radix restore focus to the trigger — so a close button written this way
needs no state of its own.

## Usage

As the drawer's corner control, inside `PanelHeader`'s `actions`:

```jsx
<PanelHeader
  title="Library"
  icon={<BookOpen className="h-4 w-4" />}
  actions={
    <SheetClose asChild>
      <Button variant="ghost" size="icon-sm" aria-label="Close tools">
        <X />
      </Button>
    </SheetClose>
  }
/>
```

As footer actions — both paths dismiss, so both are a `SheetClose`:

```jsx
<div className="flex gap-2 border-t border-border/50 p-2">
  <SheetClose asChild>
    <Button variant="ghost" size="sm" className="flex-1">Cancel</Button>
  </SheetClose>
  <SheetClose asChild>
    <Button size="sm" className="flex-1" onClick={attach}>Attach 2 files</Button>
  </SheetClose>
</div>
```

As the navigation row itself — the pattern that matters on a phone, where
picking a document should both navigate and close the drawer:

```jsx
<SheetClose asChild>
  <button type="button" onClick={() => open(doc.id)} className="w-full …">
    {doc.title}
  </button>
</SheetClose>
```

## Props

| Prop | Notes |
| --- | --- |
| `asChild` | Merge onto the single child element instead of rendering a `<button>`. |
| `className`, `id`, `style`, `ref` | Applied to the rendered element. |

Standard button attributes pass through — including `onClick`, which is filtered
out of the emitted `SheetCloseProps` but runs normally, **before** the close.

## Notes

- `onClick` on the wrapped child still fires; the close is additive. That is why
  the "Attach 2 files" example needs no extra state juggling.
- To *conditionally* keep the sheet open (an unsaved-changes guard), do not use
  `SheetClose` — call `onOpenChange` from the root yourself after your check.
- An icon-only close needs `aria-label`; there is no built-in close button on
  `SheetContent` the way `DialogContent` has one, so if you want a corner ✕ you
  must add it.
- Escape and a scrim click already dismiss. A `SheetClose` is for making the
  path visible and touch-reachable, not for making dismissal possible.

## See also

`Sheet`, `SheetContent`, `SheetTrigger`, `DialogClose`.
