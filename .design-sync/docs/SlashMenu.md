---
category: Editor
keywords: [slash menu, insert menu, block types, quick insert, command menu]
---

# SlashMenu

The "/" insert menu: block types first, then the inline widgets (citation,
equation, table, chart, AI passage), filtered as you type. Takes **no props**.

**It opens on a window CustomEvent**, not on a prop:

```js
window.dispatchEvent(
  new CustomEvent('colwrite:open-slash-menu', { detail: { blockId } }),
)
```

It then measures the caret inside that block's registered editable
(`refs.current[blockId]`) to position itself, and returns `null` if there is no
usable caret rect. It also emits `colwrite:slash-menu-visibility` so the
floating toolbar can get out of its way.

Mount it once, as a sibling of the canvas — not per block.
