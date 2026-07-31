---
category: Editor blocks
keywords: [paragraph, prose, block, text, columns, inline widgets]
---

# ParagraphBlock

The workhorse block: contenteditable prose in `html`, plus an optional
`children` array of inline widgets rendered into placeholders in that html.

```ts
ParagraphBlock({ block }: { block: ParagraphBlock })
```

`block.children` accepts any `ParagraphChild` — `citation`, `equation`, `graph`,
`table` or `aiBeat` — and each is dispatched to its own widget component.
`block.columns` sets the prose in two columns; everything else about the
paragraph's width comes from the document measure.

Reads `refs`, `updateHtml`, `updateParagraphChild`, `removeParagraphChild`,
`documentId` and `createRemote` from the editor context.
