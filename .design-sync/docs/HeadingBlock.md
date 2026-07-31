---
category: Editor blocks
keywords: [heading, title, section, outline, h1, h2, h3]
---

# HeadingBlock

One heading block of the document.

```ts
HeadingBlock({ block }: { block: HeadingBlock })
```

`block.level` is `1 | 2 | 3` — the outline is deliberately three levels deep, and
each level is a distinct type scale rather than a browser default. `block.html`
carries the same inline markup a paragraph does.

**This is the one block component that reads no editor context**, so it can be
rendered standalone.
