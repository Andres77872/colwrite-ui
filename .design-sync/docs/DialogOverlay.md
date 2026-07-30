---
category: Overlays
keywords: [dialog overlay, scrim, backdrop, modal background, backdrop-blur]
---

# DialogOverlay

The scrim behind the panel — and, in this design system, also the thing that
positions it. `DialogContent` **already renders one**, so in application code you
almost never write `DialogOverlay` yourself. It is exported for the rare case
where you need a different scrim or a different alignment.

Base class: `fixed inset-0 grid place-items-center overflow-y-auto bg-black/60 p-4
backdrop-blur-sm z-[var(--z-modal-backdrop)]`, fading in and out with the root's
state.

Two consequences of that class list worth knowing:

- **It centres the panel**, with `grid place-items-center`. The panel is a child
  of the overlay, not a sibling — which is why `DialogContent` needs no transform
  centring (its zoom keyframes would clobber one).
- **It is the scroll container.** A dialog taller than the viewport scrolls
  here, with the `p-4` inset keeping the panel off the edges.

## Usage

Normally: nothing to write. `DialogContent` supplies it.

```jsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>…</DialogContent>   {/* overlay + portal included */}
</Dialog>
```

Hand-composed, when the scrim itself has to change:

```jsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogPortal>
    <DialogOverlay className="bg-background/95 backdrop-blur-md">
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-xl">
        …
      </div>
    </DialogOverlay>
  </DialogPortal>
</Dialog>
```

`className` is merged with `tailwind-merge`, so `place-items-start pt-16`
top-aligns the panel and `bg-background/95 backdrop-blur-md` replaces the
translucent black with an opaque app-surface scrim for a reading view.

**What you lose by hand-composing:** everything `DialogContent` adds — the focus
trap, Escape and outside-click dismissal, `aria-labelledby` /
`aria-describedby` wiring, the corner close button and the zoom animation. If you
still need those, keep `DialogContent` and restyle it instead; the overlay is
only worth composing by hand for a non-interactive surface.

## Props

| Prop | Meaning |
| --- | --- |
| `className` | Scrim colour/blur, alignment, padding. |
| `children` | The panel. Passed straight through — the overlay centres whatever it gets. |
| `forceMount` | Keep it mounted while the root is closed, for external animation control. Unused in this app. |
| `ref` | Forwarded to the overlay element. |

Standard div attributes (`style`, `data-*`, `aria-hidden`) pass through even
though the emitted `.d.ts` filters native props out. `data-state="open" |
"closed"` is set for you; the enter/exit animations key off it.

## Notes

- Rendered only when the root is `modal` (the default). A non-modal dialog has no
  overlay at all.
- Do not put a second `DialogOverlay` around `DialogContent` — two scrims stack
  to a near-black page.
- The scrim tone (`black/60` + `backdrop-blur-sm`) is tuned against the app's
  `#0a0a0f` background. Going darker reads as a broken page; going lighter loses
  the dialog's separation from the document behind it.

## See also

`Dialog` (the root and the full part list) · `DialogContent` (includes this) ·
`DialogPortal` (the other half of the manual composition).
