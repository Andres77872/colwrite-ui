---
category: Overlays
keywords: [dialog title, modal heading, accessible name, aria-labelledby]
---

# DialogTitle

The dialog's name. **Required** — Radix wires it to the panel's
`aria-labelledby`, and a `DialogContent` without one logs a warning and announces
as an unnamed dialog. It renders an `<h2>` at `text-lg` (16px) semibold, with
`leading-none tracking-tight`.

## Usage

```jsx
<DialogHeader>
  <DialogTitle>Delete “{doc.name}”?</DialogTitle>
  <DialogDescription>
    This permanently removes the document and its chats. It cannot be undone.
  </DialogDescription>
</DialogHeader>
```

## Writing the title

- Ask the question, or name the task: "Discard this draft?", "Rename document",
  "Move vaswani-2017-attention.pdf". Never "Are you sure?" on its own — the
  consequence belongs in the title or the description, not in the button.
- Interpolate the subject, in curly quotes when it is a document title:
  `Delete “Attention Is All You Need, Revisited”?`. Bare names (filenames, folder
  names) go unquoted.
- Keep the consequence sentence in `DialogDescription`; the title stays one line
  of intent.

## Long titles need `break-words`

User-supplied names are unbounded — folder names in this app run to 191
characters — and `leading-none` plus a long unbroken token will otherwise push
the panel apart:

```jsx
<DialogTitle className="break-words">
  Delete {collection.name} permanently?
</DialogTitle>
```

Add `min-w-0` too when the title sits in a flex row beside a badge, so it can
actually shrink.

## Props

| Prop | Meaning |
| --- | --- |
| `className` | Wrapping (`break-words`), shrinking (`min-w-0`); leave the type scale alone. |
| `asChild` | Render your own element as the title — use it if the heading level must change. Rare here. |
| `ref` | Forwarded to the heading element. |

Standard heading attributes (`id`, `style`, `aria-*`, `data-*`) pass through even
though the emitted `.d.ts` filters native props out. Do **not** set your own `id`
unless you also rewire `aria-labelledby` — Radix generates and links one.

## See also

`Dialog` (the root and the full part list) · `DialogDescription` (the line under
it) · `DialogHeader` (the wrapper that gives the pair its 6px gap).
