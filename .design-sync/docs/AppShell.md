---
category: App shell
keywords: [app shell, layout, frame, sidebar, panels, responsive, drawer]
---

# AppShell

The application frame: header, left sidebar, canvas, right tools panel, and an
optional aside rail. It owns the responsive behaviour and the resize handles —
below `md` the sidebar and tools panel become overlay drawers (`Sheet`), because
as fixed columns they left a phone with no route to the document list or the
assistant at all.

## Usage

```jsx
<PanelsProvider>
  <AppShell
    header={<Topbar />}
    left={<Sidebar />}
    main={<Canvas />}
    right={<ToolsAside />}
    aside={<ToolsRail />}
  />
</PanelsProvider>
```

## Props

All five regions are `ReactNode`; only `main` is required.

| Prop | Region |
| --- | --- |
| `header` | Full-width chrome above everything, at `z-[var(--z-chrome)]`. |
| `main` | The canvas. Always rendered, and the only required prop. |
| `left` | Sidebar column on desktop (260px default, resizable 200–400, collapsible to 56px); a `Sheet` drawer below `md`. |
| `aside` | The **tools panel** — 380px default, resizable 280–640, on the right of the canvas. Renders only while the panel system reports something open (`isOpen`); below `md` it becomes a right-side `Sheet`. |
| `right` | The **tools rail** — a fixed **52px** icon strip at the far right, desktop only. Put icon buttons here and nothing else: text is clipped at that width. |

**`right` and `aside` are easy to swap by mistake.** `right` is the narrow rail;
`aside` is the wide panel it opens. Prose passed to `right` renders as a clipped
sliver.

## Requires PanelsProvider

`AppShell` calls `usePanels()` for panel widths, the collapse flag, the
breakpoint and the mobile-drawer state, and **throws without a
`PanelsProvider` ancestor**. The provider derives everything else itself.

## Layout contract

- The root is `h-dvh` with `gap-2` and `p-2` on `bg-background` — it is the whole
  viewport, not a block in a page. Do not nest it inside another scroll
  container.
- Every region that draws a surface uses the same treatment:
  `bg-card border border-border/60 rounded-xl overflow-hidden`. Match it when you
  add a region so all four read as one system.
- Every gutter — resize handles and plain spacers alike — is `w-3`.
- Widths come through as `--left-width`, `--right-width` and `--rail-width` CSS
  custom properties on the root, so children can align to them.
