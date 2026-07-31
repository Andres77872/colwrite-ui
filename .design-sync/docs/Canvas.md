---
category: Editor
keywords: [canvas, document, blocks, editor surface, page, writing area]
---

# Canvas

The document surface. It renders every block in order, puts `BlockControls` in
the gutter beside each one, and drops any proposed change in place so the author
judges a rewrite against the paragraph it would replace rather than against a
chat summary.

`Canvas` takes **no props** — it reads eighteen fields from the editor context
plus `sets` from the proposals context. Mount it inside the app's providers; it
is the `main` region of `AppShell`.

## Usage

```jsx
<AppShell header={<DocumentHeader />} main={<Canvas />} left={<DocumentsMenu />} />
```

## Composition

- Pair it with `DocumentHeader` above and `DocumentFooter` below — together they
  are the document chrome.
- `ReviewBar` sits over it while the assistant has changes pending.
- The canvas constrains its own measure with `--doc-measure`; do not wrap it in
  another width constraint.
