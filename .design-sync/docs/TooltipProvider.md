---
category: Overlays
keywords: [tooltip provider, delayDuration, skipDelayDuration, context, timing]
---

# TooltipProvider

The context every `Tooltip` needs, and the place tooltip **timing** lives.
Radix throws — "`Tooltip` must be used within `TooltipProvider`" — if a tooltip
mounts without one, so this is not optional plumbing.

The app mounts exactly **one**, in `main.tsx`, wrapping the whole tree at
`delayDuration={300}`. It used to be mounted separately in the tools rail and in
the sidebar, which meant the shared open delay and the skip-delay grace period
did not carry between them, and any tooltip outside those two subtrees had no
provider at all.

## Usage

```jsx
// main.tsx — one provider for the whole app
<TooltipProvider delayDuration={300}>
  <App />
</TooltipProvider>
```

A nested provider is a deliberate timing override for one surface, not a way to
"add tooltips" to a subtree:

```jsx
// Block controls only surface on hover; their hints must not wait again.
<TooltipProvider delayDuration={0}>
  <FigureShellControls />
</TooltipProvider>
```

## Props

| Prop | Default | Notes |
| --- | --- | --- |
| `children` | — | Required. |
| `delayDuration` | `700` (Radix) | ms from pointer-enter to open. The app sets `300`. A single `Tooltip` can override it for itself. |
| `skipDelayDuration` | `300` (Radix) | Grace period after a tooltip closes during which the next trigger opens **instantly** — this is what makes sweeping along a toolbar feel like one control instead of a dozen. Only a shared provider can give you it. |
| `disableHoverableContent` | `false` | Close as the pointer leaves the trigger rather than allowing a move into the content. Fine for label-only hints; turn it off if a hint could ever need to be read slowly. |

## Notes

- One provider per app. Nest another only to change timing for a subtree, and
  expect the skip-delay grace period to stop crossing that boundary.
- It renders no DOM — no wrapper element, no layout effect. Put it as high as
  you like.
- It carries no styling. Everything visual lives on `TooltipContent`.
- In tests, in Storybook, and in any isolated render of a component that
  contains a tooltip (a panel header, a toolbar, the tools rail), you must add
  the provider yourself or the render throws.
- `Popover`, `Dialog`, `Sheet` and `DropdownMenu` need no equivalent provider —
  tooltips are the only compound in this DS with a required ancestor.

## See also

`Tooltip`, `TooltipTrigger`, `TooltipContent`.
