---
category: Overlays
keywords: [tooltip trigger, asChild, hover target, icon button, abbreviation]
---

# TooltipTrigger

The element the hint is attached to and positioned against. It wires the
pointer and focus listeners, `aria-describedby`, and `data-state` — and it opens
the tooltip on **keyboard focus** as well as hover, which is why a hand-rolled
`onMouseEnter` is not an acceptable substitute.

## Usage

`asChild` over a control that already exists — the normal form, and what the
sidebar and tools rail use:

```jsx
<TooltipTrigger asChild>
  <Button variant="ghost" size="icon-sm" aria-label="Insert equation">
    <Sigma />
  </Button>
</TooltipTrigger>
```

Over a non-button element, when the hint explains a value rather than an action:

```jsx
<TooltipTrigger asChild>
  <Badge variant="warning">3 unresolved</Badge>
</TooltipTrigger>
```

Rendering its own `<button>`, styled through `className` — how an abbreviation
in the prose gets an expansion:

```jsx
<TooltipTrigger className="rounded-sm border-b border-dashed border-primary/50 px-0.5 text-primary">
  FiD
</TooltipTrigger>
```

## Props

| Prop | Notes |
| --- | --- |
| `asChild` | Merge props onto the single child element instead of rendering a `<button>`. |
| `className`, `id`, `style`, `ref` | Applied to the rendered element. |

Standard button attributes (`type`, `onClick`, `aria-label`, …) pass through;
native DOM props are filtered out of the emitted `TooltipTriggerProps`.

## Notes

- `asChild` needs exactly one element child, and that child must forward its ref
  and spread unknown props. `Button`, `Badge` and `Input` do. `ExtractionBadge`
  does **not** — it accepts only its four named props — so wrap it in the
  trigger's own button rather than using `asChild` on it.
- Whatever ends up rendered is a real `<button>` unless you `asChild` onto
  something else, so it is in the tab order. That is deliberate: a
  keyboard-only user has no other way to read the hint.
- Keep the control's `aria-label`. The tooltip is `aria-describedby`, an
  *addition* to the name, not the name itself.
- A `disabled` button dispatches no pointer events and the tooltip will never
  open. If you need to explain why a control is disabled, do not disable it —
  keep it enabled and explain on activation.
- The trigger is the positioning reference; there is no tooltip equivalent of
  `PopoverAnchor`.

## See also

`Tooltip`, `TooltipContent`, `TooltipProvider`, `PopoverTrigger`.
