---
category: App shell
keywords: [sidebar, documents, navigation, collapse, drawer]
---

# Sidebar

The document workspace column: a "Documents" heading, a collapse control, and the
`DocumentsMenu` list. Designed to sit in `AppShell`'s `left` slot.

It deliberately does **not** repeat the topbar's brand lockup, and there is no
Dashboard/Editor/Settings nav — an earlier version had both, and every nav item
was inert. The sidebar shows the one thing it actually drives: the document list.

## Usage

```jsx
<AppShell header={<Topbar />} left={<Sidebar />} main={<Canvas />} />
```

It takes **no props** — everything comes from context.

## Requires context

Calls `usePanels()` for the collapse flag and the breakpoint, and renders
`DocumentsMenu`, which additionally reads the editor, toast and confirm contexts
and fetches the document list from the API. In the app the stack is
`ToastProvider > EditorProvider > ConfirmProvider > PanelsProvider`.

## Collapsed state

`leftCollapsed` is persisted user state read from the panel context, and it only
applies on desktop: the mobile drawer is already narrow and dismissible, so it
always shows the full list. When collapsed the column centres its content, drops
the heading, and the toggle swaps `PanelLeftClose` for `PanelLeft`.

On desktop the toggle is wrapped in a `Tooltip` (`side="right"`); below `md` it is
a bare `Button` that closes the drawer instead, since a tooltip on a touch target
never shows.

## Layout

`flex h-full flex-col` — it fills the height its container gives it. The header
strip is `h-11` with `border-b border-border/50`, matching the other panel
headers. Put it inside the `AppShell` region surface rather than drawing its own
border.
