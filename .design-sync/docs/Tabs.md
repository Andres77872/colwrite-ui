---
category: Navigation
keywords: [tabs, tab, tablist, panel switcher, segmented control, section switcher]
---

# Tabs

The root of the tab set, on Radix Tabs. Use it when one region has to show
several **peer** views of the same subject and only one at a time — the tools
aside (Library / Chats / Document JSON), a document's Sections / References /
Figures, the auth dialog's Sign in / Create account.

Reach for something else when:

- the sections are all relevant at once and only need to be foldable →
  `Collapsible` (the panels' `Disclosure` pattern).
- the choice navigates to a different subject rather than a different view of the
  same one → that is app navigation, not tabs.
- there are more than about six peers, or the labels are long → a list or a
  `DropdownMenu` reads better than a bar that clips.

## Usage

```jsx
<Tabs defaultValue="library">
  <TabsList aria-label="Tools">
    <TabsTrigger value="library">Library</TabsTrigger>
    <TabsTrigger value="chats">Chats</TabsTrigger>
    <TabsTrigger value="json">JSON</TabsTrigger>
  </TabsList>
  <TabsContent value="library">…</TabsContent>
  <TabsContent value="chats">…</TabsContent>
</Tabs>
```

Controlled, when the selection lives in app state:

```jsx
<Tabs value={mode} onValueChange={(next) => setMode(next)}>…</Tabs>
```

## The parts

| Part | Role |
| --- | --- |
| `Tabs` | Root. Owns the selected value and the orientation. Renders a plain `div` with no styling of its own. |
| `TabsList` | The bar. 36px tall pill trough (`bg-muted` + 4px inset) by default. |
| `TabsTrigger` | One tab. `value` must match a `TabsContent`. |
| `TabsContent` | One panel. `value` selects it; it adds `mt-2` above itself. |

## Props that matter

- `defaultValue` — uncontrolled selection. **Always set it**: with no value no
  tab is selected and the card renders as an empty bar.
- `value` + `onValueChange` — controlled selection. `onValueChange` receives the
  string, so cast at the boundary (`setMode(next as Mode)`).
- `orientation` — `"horizontal"` (default) or `"vertical"`. Vertical only swaps
  the arrow keys and the `aria-orientation`; you still lay the list out yourself
  (`className="h-auto flex-col items-stretch"` on `TabsList`).
- `activationMode` — `"automatic"` (default: arrow keys select as they move) or
  `"manual"` (arrow keys move focus, Enter/Space selects). Use `manual` when
  switching a panel is expensive, e.g. it triggers a fetch.
- `dir` — `"ltr"` / `"rtl"`, for arrow-key direction.

## Accessibility

Radix supplies `role="tablist"`, `role="tab"`, `role="tabpanel"`,
`aria-selected`, `aria-controls`, the roving tabindex and Home/End/arrow
movement. Two things are still yours:

- **Name the bar**: `aria-label` on `TabsList` ("Tools", "Authentication"), or
  `aria-labelledby` pointing at a visible heading. Without it the tablist is
  announced unnamed.
- Keep the trigger label the same string a user would look for; do not put the
  only copy of a section's name inside the panel.

Do not hand-roll this with `<button aria-selected>` — that gets the attribute
and none of `aria-controls`, the tabpanel, the roving tabindex, or arrow-key
movement, which is exactly the half-pattern this component replaced.

## Composition

- Both the pill bar and the underline bar are this component; the underline
  version is the pill bar with the trough and shadow overridden on `TabsList`
  and `TabsTrigger` (see the `UnderlineTabs` cell).
- Content is unmounted while its tab is unselected, so a panel remounts on each
  visit — scroll position and uncommitted input are lost unless the state lives
  above `Tabs`. `forceMount` on `TabsContent` keeps it mounted but still hidden.
- Inside a 320px tool panel the bar has room for about three short labels. Give
  it `grid w-full grid-cols-N` to stretch, or `h-auto` plus a grid to wrap.
