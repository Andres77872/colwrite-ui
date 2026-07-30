---
category: Navigation
keywords: [collapsible, disclosure, trigger, expand button, section header, chevron]
---

# CollapsibleTrigger

The always-visible row that opens and closes a `Collapsible`. It only exists
inside `Collapsible` — it toggles that root's state through context and cannot
mount on its own.

It is a bare re-export of the Radix trigger: a real `<button>` with
`aria-expanded`, `aria-controls` and `data-state`, and **no styling at all**.
Everything you see in the app — the chevron, the row layout, the hover — is
composed on top.

## Usage

The panel-section row, as `panels/shared/Disclosure` writes it:

```jsx
<CollapsibleTrigger
  aria-label={label}
  className="flex w-full items-center gap-1 rounded-sm text-left text-xs font-medium transition-colors hover:text-foreground"
>
  <ChevronRight aria-hidden="true" className={cn('h-3 w-3 shrink-0 transition-transform duration-150', open && 'rotate-90')} />
  <span className="min-w-0 flex-1">Extracted text</span>
  <span className="tabular-nums text-muted-foreground">18 pages</span>
</CollapsibleTrigger>
```

As a `Button`, when the row deserves the DS button treatment:

```jsx
<CollapsibleTrigger asChild>
  <Button variant="ghost" size="sm" className="w-full justify-start">
    <Filter />
    Search filters
  </Button>
</CollapsibleTrigger>
```

## Props that matter

- `asChild` — renders your element instead of the button, forwarding the trigger
  role, `aria-expanded`, `aria-controls`, `data-state` and the click handler.
  This is the right way to make the trigger a `Button`; nesting a `Button`
  **inside** the trigger produces a button inside a button, which is invalid HTML
  and swallows the toggle.
- `className` — the entire look. There is no base class to merge with.
- `disabled` — usually set on the **root** instead, which disables the trigger
  and keeps root and trigger in agreement.
- Standard button attributes pass through (`aria-label`, `onClick`, `type`).

## The row recipe

`flex w-full items-center gap-1 rounded-sm text-left` is the shape every trigger
in the app uses. Reading it left to right:

- `w-full` + `text-left` — the whole row is the hit target, and the label starts
  at the chevron rather than centring.
- `gap-1` with a `h-3 w-3 shrink-0` chevron — the marker never squashes.
- `min-w-0 flex-1` on the label span — long summaries truncate instead of pushing
  a trailing count out of the row.
- `rounded-sm` — so the focus ring has a shape to follow.

The chevron points right when closed and `rotate-90` (down) when open; drive
that from the controlled `open` value, or from `data-state` in CSS. Add
`transition-transform duration-150` so the turn reads as a disclosure rather than
a swap.

## Accessibility

- The trigger's text is its accessible name. When the summary is not
  self-explanatory (a badge, an icon, a bare count), pass `aria-label` — that is
  exactly what `Disclosure`'s `label` prop forwards.
- Mark the chevron `aria-hidden="true"`; it duplicates `aria-expanded`.
- Do not add `role`, `tabIndex` or `aria-expanded` yourself — Radix owns them,
  and a hand-written `aria-expanded` will go stale.
- A disabled trigger still needs its own visual treatment
  (`cursor-not-allowed opacity-50`); nothing is applied for you.
