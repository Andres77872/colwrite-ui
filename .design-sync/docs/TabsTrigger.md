---
category: Navigation
keywords: [tabs, tab, trigger, tab button, selected tab, disabled tab]
---

# TabsTrigger

One tab in a `TabsList`. It only exists inside `Tabs` — it reads and sets the
selected value through that context and cannot mount on its own.

It is already a real `<button>` with `role="tab"`, so never wrap it in one and
never add `onClick` to change the selection: `value` plus the root's
`onValueChange` is the whole mechanism.

## Usage

```jsx
<TabsTrigger value="library">Library</TabsTrigger>

<TabsTrigger value="json" disabled>JSON</TabsTrigger>

<TabsTrigger value="chats" className="gap-1.5">
  <MessageSquare className="h-3.5 w-3.5" />
  Chats
  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-2xs tabular-nums">3</Badge>
</TabsTrigger>
```

## States

| State | How it renders |
| --- | --- |
| Unselected | `text-muted-foreground` inherited from the list, transparent background |
| Selected (`data-[state=active]`) | `bg-background`, `text-foreground`, `shadow-sm` — it lifts out of the trough |
| Disabled | 50% opacity, `pointer-events-none`, and arrow-key movement skips it |
| Focus-visible | 2px `ring-ring` with a 2px offset |

There is no hover treatment in the base class. The underline variant adds one
(`hover:text-foreground`) because a flat bar gives no other affordance.

## Props that matter

- `value` (required) — must equal the `value` of exactly one `TabsContent`. A
  trigger whose value matches no panel selects nothing and looks broken.
- `disabled` — for a view that genuinely cannot be opened yet (the app disables
  Document JSON until the draft has been saved once). Prefer disabling to hiding
  when the tab will come back, so the bar does not reflow.
- `asChild` — renders your element instead of the button. Rarely needed; the
  base is already a button.
- `className` — merged last. Standard button attributes pass through.

## Accessibility

- The label is the accessible name. An icon-only trigger needs `aria-label`.
- Radix wires `aria-selected`, `aria-controls`, the roving tabindex and
  Home/End/arrow movement. Do not add `tabIndex`.
- A count in the label (`Chats 3`) is announced as part of the name, which is
  usually what you want; if the number is noisy, put it in the panel instead.

## Layout notes

- The base class sets **no gap**, so an icon or badge child sits flush against
  the label. Add `gap-1.5` when the trigger has more than text.
- Labels never wrap (`whitespace-nowrap`). For long labels in a narrow panel,
  either shorten them or give the trigger `min-w-0 truncate` inside a
  `grid grid-cols-N` list — those are the only two outcomes that do not push the
  bar past the panel edge.
- Padding is `px-3 py-1` at `text-sm` (13px) semibold-ish (`font-medium`); the
  underline variant restates it as `px-4 py-2` for a taller target.
