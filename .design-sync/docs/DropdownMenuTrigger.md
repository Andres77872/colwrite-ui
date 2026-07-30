---
category: Overlays
keywords: [dropdown, menu, trigger, overflow button, more actions, asChild]
---

# DropdownMenuTrigger

The control that opens a `DropdownMenu`. It renders a bare `<button>` with the
menu wiring on it — `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` and
`data-state="open" | "closed"` — and **no styling of its own**. Give it an
appearance either by wrapping a `Button` with `asChild`, or by passing the
classes yourself.

## Usage

```jsx
<DropdownMenu>
  {/* The normal case: asChild, so the Button is the trigger. */}
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon-sm" aria-label="Document actions">
      <MoreHorizontal />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" className="w-56">…</DropdownMenuContent>
</DropdownMenu>
```

Without `asChild` you own the surface:

```jsx
<DropdownMenuTrigger
  className={cn(
    'flex size-6 items-center justify-center rounded-sm text-muted-foreground',
    'transition-colors hover:bg-accent hover:text-foreground',
    isOpen && 'bg-accent text-foreground',
  )}
  aria-label="Insert a block after this paragraph"
>
  <Plus className="size-4" />
</DropdownMenuTrigger>
```

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `asChild` | `boolean` | Render the child element as the trigger instead of a `<button>`. The child must accept a ref and spread props. |
| `className` | `string` | Only useful without `asChild` — with it, style the child. |

Standard button attributes (`aria-label`, `title`, `disabled`, `draggable`,
`onMouseDown`, `data-*`) pass through to the rendered element; they are filtered
out of the emitted `.d.ts` but they work. Radix's own `onClick`, `onKeyDown` and
`onPointerDown` are composed with yours, so a handler you pass runs and the menu
still opens.

## Notes

- An icon-only trigger **must** carry `aria-label` — there is no text to
  announce. Every one in the app names its object: `Actions for ${collection.name}`,
  `Paragraph options — drag to reorder`.
- Style the open state from `isOpen` in your own state, or from
  `[data-state=open]` in a stylesheet. The gutter controls light up with
  `bg-accent text-foreground` while their menu is open, which is what stops the
  hover-revealed control from vanishing under the panel.
- `asChild` **replaces** the button element, so anything the child needs
  (`type="button"`, `draggable`, `onDragStart`) goes on the child. The block
  gutter's drag handle is a trigger and a drag source at once this way.
- Focus returns here when the menu closes, so a trigger that unmounts on select
  (a row that disappears) leaves focus on `document.body` — keep the trigger
  mounted, or move focus deliberately.
- The trigger stays in normal flow inside your layout; only the menu panel
  portals out.

## See also

`DropdownMenu` · `DropdownMenuContent` · `Button`
