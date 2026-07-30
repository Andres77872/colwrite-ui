---
category: Layout
keywords: [resize, splitter, divider, gutter, drag handle, separator, panel width]
---

# ResizeHandle

The draggable — and keyboard-operable — divider between two panels. A 12px gutter
holding a small pill that grows on hover and turns `primary` while dragging.

Pointer-only resizing left the panel widths entirely unavailable to anyone not
using a mouse, so this is exposed as a focusable `role="separator"` that responds
to arrow keys.

## Usage

```jsx
const [width, setWidth] = useState(260);

<div className="flex items-stretch">
  <nav style={{ width }} className="shrink-0">…</nav>

  <ResizeHandle
    direction="horizontal"
    onResize={(delta) => setWidth((prev) => clamp(prev + delta, 200, 400))}
    label="Resize sidebar"
    value={width}
    min={200}
    max={400}
  />

  <main className="min-w-0 flex-1">…</main>
</div>
```

## Props

- `direction` (required) — `'horizontal'` for a vertical divider between
  side-by-side panels (drag left/right, `w-3`, `cursor-col-resize`);
  `'vertical'` for a horizontal one between stacked panels (drag up/down, `h-3`,
  `cursor-row-resize`). It names the **axis of movement**, not the bar's
  orientation.
- `onResize` (required) — `(delta: number) => void`, called with the pixels moved
  since the last event, positive right/down. The handle is **stateless**: it
  reports deltas and the caller owns the width. Always use a functional update
  (`setWidth((prev) => prev + delta)`) — drag events arrive faster than a render,
  and a stale closure loses movement.
- `label` (required) — the separator's accessible name: "Resize sidebar",
  "Resize tools panel".
- `value`, `min`, `max` — the current size and its bounds in pixels. Optional but
  **effectively required**: a focusable separator that responds to arrow keys but
  reports no value tells a screen-reader user that something moved without ever
  saying how far, or when a bound was hit. They become
  `aria-valuenow`/`aria-valuemin`/`aria-valuemax` plus an
  `aria-valuetext` of `"<n> pixels"`.
- `className` — merged onto the gutter.

## Clamping is the caller's job

The handle never bounds anything. Clamp inside `onResize`, and remember that a
panel on the **right** grows as the handle moves left, so its delta is inverted:

```jsx
onResize={(delta) => setRightWidth((prev) => clamp(prev - delta, 280, 640))}
```

The app's bounds live in `PANEL_CONFIG`: left `200–400`, right `280–640`.

## Keyboard

Arrow keys along the axis move **16px** per press; hold Shift for **64px**. The
handle is a tab stop (`tabIndex={0}`) and the pill turns solid `primary` on
`:focus-visible`, so the focused divider is obvious.

## Composition

- Put it **between** two flex children of an `items-stretch` row (or a flex
  column, for `vertical`). It is `flex-shrink-0` and stretches to the container's
  cross-axis, so it needs no height or width of its own.
- Every gutter in the shell is the same 12px, handle or not. When a panel is
  collapsed and there is nothing to resize, AppShell renders a plain
  `<div className="w-3" aria-hidden="true" />` in its place so the rhythm does
  not shift.
- Drag adds a `resizing` class to `document.body` — that is where a global
  `user-select: none` / cursor lock belongs, so a drag never selects text in the
  panels it passes over.
- Give the neighbouring panels `min-w-0` (or `min-h-0`); without it a long
  filename sets a flex minimum and the handle refuses to shrink past it.
