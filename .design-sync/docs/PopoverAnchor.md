---
category: Overlays
keywords: [popover anchor, positioning reference, virtual anchor, selection, radix]
---

# PopoverAnchor

Moves the popover's positioning reference off the trigger and onto something
else in the document. Use it when the thing the panel is *about* is not the
thing that opened it: a toolbar button opens the panel, but the panel belongs to
the inline citation, the highlighted sentence, or the figure block.

Without it, `PopoverContent` positions against `PopoverTrigger`.

## Usage

```jsx
<Popover open={open} onOpenChange={setOpen}>
  <div>
    <Toolbar>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Quote />
          Edit citation
        </Button>
      </PopoverTrigger>
    </Toolbar>

    <p>
      …replaces recurrence with scaled dot-product attention{' '}
      <PopoverAnchor asChild>
        <span className="rounded-sm bg-primary/10 px-1 py-0.5 text-sm text-primary">
          [Vaswani et al., 2017]
        </span>
      </PopoverAnchor>{' '}
      and remains the baseline.
    </p>
  </div>

  <PopoverContent align="start" className="w-80 p-3">…</PopoverContent>
</Popover>
```

## Props

| Prop | Notes |
| --- | --- |
| `asChild` | Merge onto the single child element rather than rendering a `<span>`. Almost always what you want — the anchor should be an element that already exists. |
| `virtualRef` | A `RefObject` to any object exposing `getBoundingClientRect()`. Use it to anchor to a text `Range`, a canvas hit box, or the pointer — anything with no DOM element of its own. |
| `className`, `id`, `style`, `ref` | Applied to the rendered element. |

Standard DOM attributes pass through; they are filtered out of the emitted
`PopoverAnchorProps`.

## Notes

- The anchor must live **inside** the `<Popover>` element, but it does not need
  to be near the trigger — put both wherever the layout wants them.
- Without `asChild` it renders a bare `<span>`, which is `display: inline`. If
  you anchor to a block, pass `asChild` and let the block be the anchor, or the
  measured box will be the wrong shape.
- One anchor per popover. A second one silently wins or loses depending on mount
  order.
- `align` and `side` on `PopoverContent` are now measured against the anchor, so
  re-check them after adding one: `align="start"` against a full-width paragraph
  is very different from `align="start"` against a 24px button.
- For a text selection, prefer `virtualRef` over wrapping the selection in a
  span — the DOM range moves as the user types and a wrapper does not.

## See also

`Popover`, `PopoverTrigger`, `PopoverContent`.
