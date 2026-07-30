---
category: Navigation
keywords: [collapsible, disclosure, expand, collapse, accordion, details, show more]
---

# Collapsible

The root of a disclosure, on Radix Collapsible. One always-visible trigger, one
body that expands and collapses under it. This is the app's answer to
`<details>/<summary>`: it gives the trigger real button semantics and
`aria-expanded`, which `<summary>` only approximates, and it drops the browser's
default ▶ marker in favour of a lucide chevron.

Use it when a section is **secondary but still part of the same view** — search
filters, extracted text, raw metadata, a long list you do not want to lead with.

Reach for something else when:

- the sections are mutually exclusive views of one subject → `Tabs`.
- the content should overlay the page rather than push it → `Popover` / `Sheet`.
- it is a whole extra step → `Dialog`.

There is no `Accordion` in this DS. A group of sections that must be
single-open is a stack of `Collapsible`s with the open id in one piece of state.

## Usage

```jsx
<Collapsible defaultOpen className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5">
  <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-sm text-left text-xs font-medium">
    <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 rotate-90" />
    <span className="min-w-0 flex-1">Search filters</span>
    <Badge variant="secondary" className="ml-2 tabular-nums">2 active</Badge>
  </CollapsibleTrigger>
  <CollapsibleContent>
    <div className="mt-2 grid grid-cols-2 gap-2">…</div>
  </CollapsibleContent>
</Collapsible>
```

Controlled, which is what `panels/shared/Disclosure` does so it can rotate the
chevron:

```jsx
const [open, setOpen] = useState(false);

<Collapsible open={open} onOpenChange={setOpen}>
  <CollapsibleTrigger>
    <ChevronRight className={cn('h-3 w-3 transition-transform duration-150', open && 'rotate-90')} />
    …
```

## The parts

| Part | Role |
| --- | --- |
| `Collapsible` | Root. Owns open/closed. Renders a plain `div`, unstyled. |
| `CollapsibleTrigger` | The always-visible row. A real `button` with `aria-expanded`. |
| `CollapsibleContent` | The body. Clips and animates its own height. |

## Props that matter

- `defaultOpen` — uncontrolled initial state. Set it for the section a reader
  should land on already open.
- `open` + `onOpenChange` — controlled. Needed whenever something outside the
  content depends on the state (the chevron rotation, a count, "single open at a
  time" behaviour across a stack).
- `disabled` — disables the trigger. Style it yourself
  (`cursor-not-allowed opacity-50`); the root does not paint a disabled look.
- `className` on the root is where the section's surface goes — the app uses
  `rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5` for a boxed
  filter section, and nothing at all for a plain panel section.

## Accessibility

- The trigger is a button carrying `aria-expanded` and `aria-controls`; the
  content carries the matching `id`. Do not add `role="button"` or `tabIndex`.
- The chevron is decoration — give it `aria-hidden="true"`. The trigger's text is
  the accessible name; if the summary is a fragment ("2 active"), pass an explicit
  `aria-label` on the trigger.
- Space and Enter toggle. There is no arrow-key relationship between sibling
  disclosures, which is correct — they are independent, not a composite widget.

## Composition notes

- The chevron rotation is **yours to drive**. Either hold `open` in state (as
  `Disclosure` does) or key off the trigger's `data-state` in CSS. The component
  ships no marker.
- Content height animates against `--radix-collapsible-content-height`, so give
  the body real content rather than an absolutely-positioned child, and do not
  put `overflow-visible` decorations (a popover, a focus ring that bleeds) inside
  it — `CollapsibleContent` clips during the transition.
- The app's canonical composition is `panels/shared/Disclosure`
  (`summary`, `children`, `label`, `defaultOpen`) — three raw `<details>` pairs
  were replaced by it, so match that shape rather than re-deriving a trigger row.
