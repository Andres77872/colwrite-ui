---
category: Overlays
keywords: [dialog description, modal subtitle, supporting text, aria-describedby]
---

# DialogDescription

The supporting line under `DialogTitle`: a `<p>` at `text-sm` (13px) in
`text-muted-foreground`. Radix wires it to the panel's `aria-describedby`, so it
is read out after the title — which makes it the right place for the
consequence of the action, and the wrong place for anything the user has to
interact with.

## Usage

```jsx
<DialogHeader>
  <DialogTitle>Delete Retrieval methods permanently?</DialogTitle>
  <DialogDescription>
    This deletes the folder and everything filed anywhere inside it.
  </DialogDescription>
</DialogHeader>
```

## Writing it

- One clause when the title already says everything: "Shown in the documents menu
  and used for the export filename."
- Two sentences for a destructive action: what happens, then that it cannot be
  undone. "Every pending suggestion will be discarded. This cannot be undone."
- Inline `<strong>` is fine for a filename or folder name the sentence turns on.
  Give it `font-semibold text-foreground` so it lifts out of the muted body.
- **Optional.** Omit it for a short question — `DialogHeader` handles a
  lone title, and Radix simply leaves `aria-describedby` unset. Do not ship an
  empty one to keep the spacing.
- Not for warnings that must be *seen*: a red consequence box is an
  `Alert variant="destructive"` in the body, not description text.

## Props

| Prop | Meaning |
| --- | --- |
| `className` | Rarely needed. `text-xs` if the panel is dense; never darken it to `text-foreground` — the title carries the contrast. |
| `asChild` | Render your own element as the description (e.g. a `<div>` when the copy needs two paragraphs). |
| `ref` | Forwarded to the paragraph element. |

Standard paragraph attributes (`id`, `style`, `aria-*`, `data-*`) pass through
even though the emitted `.d.ts` filters native props out. It renders a `<p>`, so
block-level children are invalid — use `asChild` with a `<div>` instead of
nesting a `<div>` inside it.

## See also

`Dialog` (the root and the full part list) · `DialogTitle` (the line above) ·
`Alert` for in-body warnings · `DialogHeader` (the wrapper).
