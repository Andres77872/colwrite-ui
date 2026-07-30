---
category: Navigation
keywords: [tabs, tab panel, tabpanel, tab content, panel body]
---

# TabsContent

One panel in a tab set. It only exists inside `Tabs` — it reads the selected
value from that context and cannot mount on its own.

It renders `role="tabpanel"` with `aria-labelledby` pointing at its trigger, adds
`mt-2` above itself, and takes a focus ring so keyboard users can Tab from the
bar straight into the body.

## Usage

```jsx
<Tabs defaultValue="library">
  <TabsList aria-label="Tools">
    <TabsTrigger value="library">Library</TabsTrigger>
    <TabsTrigger value="chats">Chats</TabsTrigger>
  </TabsList>

  <TabsContent value="library" className="space-y-2">
    <Input type="search" placeholder="Search inside your PDFs…" />
    <ul>…</ul>
  </TabsContent>

  <TabsContent value="chats">
    <EmptyState icon={MessageSquare} title="No chats yet" description="…" />
  </TabsContent>
</Tabs>
```

## Props that matter

- `value` (required) — must equal exactly one `TabsTrigger`'s `value`.
- `forceMount` — keeps the panel mounted while unselected (it stays `hidden`).
  Use it to preserve scroll position or an in-progress form; it does **not** make
  two panels visible at once.
- `className` — merged last. The built-in `mt-2` is the gap under the bar;
  override with `mt-0` when the panel sits beside a vertical list instead of
  under a horizontal one.
- `tabIndex` is already managed — do not set it.

## Mounting behaviour

Unselected panels are **removed from the DOM**, not hidden. Consequences worth
designing around:

- The panel remounts on every visit: effects re-run, requests re-fire, scroll
  position and uncontrolled input are lost. Lift anything that must survive above
  `Tabs`, or pass `forceMount`.
- Only one panel is ever visible, so a card or screenshot of a tab set can only
  show one body. Vary the root's `defaultValue` to show a different one.
- Panels of very different heights make the container jump on switch. Give the
  container a floor (`min-h-32`, `h-full` in a flex column) when that reads as a
  glitch.

## Composition

- The panel provides no padding, border or surface — it inherits the container's.
  The panel body is normal app content: a search `Input`, a list, a `Textarea`,
  an `EmptyState`.
- In the app the tool panels put a search row at the top of the body and the list
  below; keep that order so the search box does not move when results arrive.
- Use `space-y-2` (or a flex column) on the content rather than margins on each
  child, so an empty body collapses cleanly.
