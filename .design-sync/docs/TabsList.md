---
category: Navigation
keywords: [tabs, tablist, tab bar, segmented control, pill bar, underline tabs]
---

# TabsList

The bar that holds the tabs. It only exists inside `Tabs` — it reads the
selected value from that context and cannot mount on its own.

Default look: an `inline-flex` pill bar, 36px tall, `rounded-lg`, a `bg-muted`
trough with 4px inset padding and `text-muted-foreground` — the selected trigger
lifts out of the trough onto `bg-background`.

## Usage

```jsx
<TabsList aria-label="Tools">
  <TabsTrigger value="library">Library</TabsTrigger>
  <TabsTrigger value="chats">Chats</TabsTrigger>
</TabsList>
```

## The three treatments in the app

| Treatment | `className` on the list | Where |
| --- | --- | --- |
| Pill bar (default) | none | Tool panels, section switchers |
| Stretched | `grid w-full grid-cols-3` | A bar that should span its panel |
| Underline | `flex h-auto w-full justify-start rounded-none border-b border-border bg-transparent p-0` | The auth dialog |

The underline bar is the default bar with the trough removed; its triggers then
need the matching override (see `TabsTrigger`). Keep the pair together — an
underline list with default triggers renders a floating pill on a plain rule.

## Props that matter

`TabsList` takes the Radix list props plus `className`:

- `aria-label` (or `aria-labelledby`) — **required in practice**. The list is a
  `role="tablist"`; unnamed, a screen reader announces "tab list" with no
  subject. The app passes `aria-label="Authentication"`, `"Tools"`.
- `loop` — defaults to `true`; arrow keys wrap from the last tab to the first.
  Set `false` when the bar sits in a longer keyboard path and wrapping would
  feel like a trap.
- `className` — merged after the base classes, so a later utility wins.

## Layout notes

- The bar is `inline-flex`, so it is only as wide as its tabs. Add `w-full`
  (usually with `grid grid-cols-N`) when it should fill the panel.
- The fixed `h-9` is why the underline and wrapping variants both pass `h-auto`:
  without it a two-row bar is clipped to 36px.
- Triggers never wrap their own labels (`whitespace-nowrap`), so a bar with more
  labels than fit will push past a 320px panel. Wrap with
  `grid h-auto w-full grid-cols-3 gap-1`, or shorten the labels.
- It draws no border of its own. Inside a card or panel, the surrounding
  `rounded-lg border border-border bg-card` is the container's job.
