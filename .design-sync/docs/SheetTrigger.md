---
category: Overlays
keywords: [sheet trigger, drawer trigger, asChild, hamburger, open drawer]
---

# SheetTrigger

The control that opens a `Sheet`. It supplies `aria-expanded`,
`aria-haspopup="dialog"`, `aria-controls` and `data-state`, and Radix restores
focus to it when the drawer closes — which is the whole reason to use it rather
than an `onClick` that flips your own state.

It is **optional**: a drawer driven from app context (`AppShell` opens its
mobile drawers from `usePanels()`) has no trigger at all and only passes `open`.

## Usage

```jsx
<SheetTrigger asChild>
  <Button variant="ghost" size="icon-sm" aria-label="Open navigation">
    <Menu />
  </Button>
</SheetTrigger>
```

Styled directly, rendering its own `<button>` — a count chip that opens the
references drawer:

```jsx
<SheetTrigger className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground hover:bg-accent">
  <BookMarked aria-hidden="true" className="h-3 w-3" />
  18 references
</SheetTrigger>
```

## Props

| Prop | Notes |
| --- | --- |
| `asChild` | Merge props onto the single child element instead of rendering a `<button>`. |
| `className`, `id`, `style`, `ref` | Applied to the rendered element. |

Standard button attributes (`type`, `disabled`, `onClick`, `aria-label`, …) pass
through; native DOM props are filtered out of the emitted
`SheetTriggerProps`.

## Notes

- `asChild` takes exactly one element child, and that child must forward its ref
  and spread unknown props. `Button` and `Badge` do; a local component that only
  destructures its own named props does not.
- An icon-only trigger needs `aria-label`. `aria-expanded` is added for you.
- Once open, the trigger sits **under** the scrim and the panel. That is
  correct — do not raise its `z-index` to keep it visible.
- Do not pair a trigger with an `onClick` that also sets your `open` state: the
  trigger already toggles, and the two cancel out.

## See also

`Sheet` (root, `open`/`onOpenChange`), `SheetContent` (the panel and `side`),
`SheetClose` (dismissal), `PopoverTrigger`, `DialogTrigger`.
