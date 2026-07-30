---
category: Overlays
keywords: [popover trigger, asChild, toggle, anchor, radix]
---

# PopoverTrigger

The control that opens a `Popover`, and — unless a `PopoverAnchor` overrides it
— the element the panel is positioned against. It also owns the wiring you
would otherwise write by hand: `aria-expanded`, `aria-haspopup="dialog"`,
`aria-controls`, and `data-state="open" | "closed"` for styling.

## Usage

Wrap an existing control with `asChild` — this is the normal form:

```jsx
<PopoverTrigger asChild>
  <Button variant="outline" size="sm">
    <Quote />
    Insert citation
  </Button>
</PopoverTrigger>
```

Or let it render its own `<button>` and style it directly — how an inline
citation pill in the prose becomes a trigger:

```jsx
<PopoverTrigger className="rounded-sm bg-primary/10 px-1 py-0.5 text-sm text-primary hover:bg-primary/20">
  [Izacard &amp; Grave, 2021]
</PopoverTrigger>
```

## Props

| Prop | Notes |
| --- | --- |
| `asChild` | Merge props onto the single child element instead of rendering a `<button>`. The child must accept a `ref` and spread the props it is given. |
| `className`, `id`, `style` | Applied to whichever element ends up rendered. |
| `ref` | Forwarded to the DOM node. |

Standard button attributes (`type`, `disabled`, `onClick`, `aria-label`, …) pass
through even though the emitted `PopoverTriggerProps` does not list them —
native DOM props are filtered out of the generated `.d.ts`.

## Notes

- `asChild` needs **exactly one** element child. Two children, or a bare string,
  will throw.
- The child must forward its ref and spread unknown props. Every DS control does
  (`Button`, `Badge`, `Input`); a local component that destructures only its own
  named props does not — wrap that in a plain element instead, or render the
  trigger's own `<button>` around it.
- With `asChild` over a `Button`, keep the `Button`'s own `variant`/`size`; the
  trigger contributes no styling of its own.
- An icon-only trigger still needs `aria-label`. `aria-expanded` is supplied for
  you; do not add it yourself.
- Toggling is built in — clicking an open trigger closes the popover. Do not add
  an `onClick` that also flips your `open` state, or the two cancel out.

## See also

`Popover` (root, `open`/`onOpenChange`), `PopoverContent` (placement and
sizing), `PopoverAnchor` (position against something other than this trigger).
