---
category: Overlays
keywords: [tooltip, hint, label, hover, icon button, truncated text, radix]
---

# Tooltip

The root of a hover/focus hint. Use it to **name a control that has no visible
label** — every icon button in the sidebar, the tools rail and the editor
toolbars — or to reveal text that had to be truncated.

`Tooltip` renders no DOM of its own; it is state plus context for
`TooltipTrigger` and `TooltipContent`.

## Requires a provider

Every `Tooltip` must have a `TooltipProvider` ancestor — Radix throws without
one. The app mounts exactly one, in `main.tsx`, at `delayDuration={300}`. Do not
add a second provider around a subtree unless you deliberately want different
timing there: two providers means the shared open delay and the skip-delay grace
period stop carrying between them.

## Usage

```jsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="icon-sm" aria-label="Collapse sidebar">
      <PanelLeftClose />
    </Button>
  </TooltipTrigger>
  <TooltipContent side="right">Collapse sidebar</TooltipContent>
</Tooltip>
```

Truncated text — the tooltip carries the full string:

```jsx
<Tooltip>
  <TooltipTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent">
    <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary/70" />
    <span className="min-w-0 truncate text-sm">{doc.title}</span>
  </TooltipTrigger>
  <TooltipContent side="bottom" align="start">{doc.title}</TooltipContent>
</Tooltip>
```

## Props

| Prop | Notes |
| --- | --- |
| `open` | Controlled. Rarely needed — hover/focus is the point. Nothing renders when false. |
| `defaultOpen` | Uncontrolled initial state. |
| `onOpenChange(open)` | Absent from the emitted `Tooltip.d.ts` (handler props are filtered from the generated contract) but present and functional. |
| `delayDuration` | Overrides the provider's delay **for this tooltip only**. `0` for a hint that must appear instantly. |
| `disableHoverableContent` | Closes as the pointer leaves the trigger instead of allowing a move into the content. Overrides the provider. |

## Notes

- The hint is not a replacement for an accessible name. Keep `aria-label` on the
  icon button; the tooltip text should match it. Radix links the content with
  `aria-describedby`, so a mismatch is read out twice and differently.
- Tooltips are **text only**. Anything interactive — a link, a button, a field —
  belongs in a `Popover`; hover surfaces cannot be reached by touch or keyboard.
- `TooltipContent` in this DS is **not** portalled, so it renders inline in the
  trigger's subtree. It is `position: fixed` at `z-[var(--z-tooltip)]` (400), the
  highest layer in the app, so it still paints over dialogs and popovers.
- No tooltip on a `disabled` control: a disabled button fires no pointer events,
  so the hint never opens. Wrap it in an enabled span, or use different copy.

## Choosing an overlay

`Tooltip` names a control · `Popover` holds a small interactive panel ·
`DropdownMenu` holds commands · `Dialog` blocks on a decision · `Sheet` is an
edge drawer.

See `TooltipProvider`, `TooltipTrigger`, `TooltipContent`.
