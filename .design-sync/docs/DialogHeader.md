---
category: Overlays
keywords: [dialog header, modal header, title block, heading]
---

# DialogHeader

The block at the top of a `DialogContent`: a `flex flex-col gap-1.5 text-left`
wrapper for `DialogTitle` and, when there is one, `DialogDescription`. It carries
no padding of its own — `DialogContent`'s `p-6` is the panel's gutter — and no
bottom margin, because the body block below it sets its own `mt-4`.

## Usage

```jsx
<DialogContent className="max-w-md">
  <DialogHeader>
    <DialogTitle>Rename document</DialogTitle>
    <DialogDescription>
      Shown in the documents menu and used for the export filename.
    </DialogDescription>
  </DialogHeader>
  <div className="mt-4">
    <Input defaultValue={title} />
  </div>
</DialogContent>
```

## What goes in it

- **Title only** is fine — a short question like "Start a new document?" needs no
  second line, and Radix simply leaves `aria-describedby` unset.
- **Title + description** is the common case.
- **Extra chrome** is allowed as long as the title and description stay inside:
  the auth dialog puts a `BrandMark` beside them in a `flex items-center gap-3`
  row, and a resource dialog can put an `ExtractionBadge` opposite the title with
  `flex items-start justify-between gap-3`.

Do not put actions in the header — the corner close button is
`DialogContent`'s (`showCloseButton`), and everything else belongs in
`DialogFooter`.

## Props

Plain `<div>`: `className` plus any standard div attribute (`id`, `style`,
`aria-*`, `data-*`) passes straight through, even though the emitted `.d.ts`
filters native props out. It is not a `forwardRef` component, so it takes no
`ref`.

`text-left` is explicit in the base class: dialog headers in this app are never
centred. Override `gap-1.5` only if the header holds more than the title pair.

## See also

`Dialog` (the root and the full part list) · `DialogTitle` / `DialogDescription`
(its children) · `DialogFooter` (the matching block at the bottom).
