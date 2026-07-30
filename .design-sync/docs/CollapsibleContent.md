---
category: Navigation
keywords: [collapsible, disclosure, content, expand, collapse, accordion animation]
---

# CollapsibleContent

The body of a `Collapsible`. It only exists inside `Collapsible` — it reads the
open state from that context and cannot mount on its own.

This is the one part of `Collapsible` that is **not** a bare Radix re-export.
The wrapper adds `overflow-hidden` plus the `accordion-down` / `accordion-up`
animations, which interpolate against the `--radix-collapsible-content-height`
Radix measures on the element. Without them the body appeared and vanished
instantly, which read as a layout jump rather than a disclosure — so do not
replace it with the raw primitive, and do not remove `overflow-hidden` via
`className` (the content would spill during the transition).

## Usage

```jsx
<CollapsibleContent>
  <div className="mt-2 grid grid-cols-2 gap-2">
    <label className="space-y-1 text-2xs font-medium text-muted-foreground">
      <span>Year or range</span>
      <Input className="h-8 text-xs" defaultValue="2020-2026" />
    </label>
    …
  </div>
</CollapsibleContent>
```

## Props that matter

- `forceMount` — keeps the body in the DOM while closed (still `hidden`). Use it
  when the content must not remount — an in-progress form, a mounted chart, a
  video — and pair it with `data-[state=closed]:hidden` if you also style it.
- `className` — merged after `overflow-hidden` and the two animations. Safe to
  add padding, text colour, spacing. Not safe to add `overflow-visible`.
- `asChild` — available, but the wrapper's classes are the reason this component
  exists; if you take them off you have the raw primitive again.

## Mounting behaviour

Closed content is **removed from the DOM** (unless `forceMount`). So:

- The body remounts on every open: effects re-run, requests re-fire, uncommitted
  input and scroll position are lost. Lift that state above `Collapsible`.
- A static render can only ever show a section that is open. To picture both
  states, put an open section beside a closed one — which is also how the app
  looks in practice.
- Screen readers reach the content only while it is open, so nothing inside may
  be the only copy of information a user needs to decide whether to open it. Put
  the count or status in the trigger row.

## Layout notes

- The content has no padding of its own. The app indents it to clear the chevron
  (`pl-4`) and adds `mt-2` when the section is a boxed filter panel.
- Because the element clips, an inner focus ring or shadow at the very edge is
  cut off during the animation; give inner controls a little inset.
- Keep the body's own height stable while open — content that grows on its own
  (a live list) is fine, but an inner element with a percentage height has
  nothing to resolve against mid-animation.
