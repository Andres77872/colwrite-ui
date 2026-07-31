---
category: Inline widgets
keywords: [citation, reference, bibliography, cite, source, key]
---

# CitationInline

The citation widget embedded in a paragraph. Renders as an `InlinePill` in the
run of text and opens an editor popover on click.

```ts
CitationInline(props: InlineWidgetProps)
```

`InlineWidgetProps` is the contract every inline widget shares: `blockId`,
`child`, `updateParagraphChild`, `removeParagraphChild`, `updateHtml` and `refs`.

It is a **type guard**: it returns `null` unless `child.type === 'citation'`. The
guard sits at the wrapper level and declares no hooks, so a child whose type
changes in place cannot make React render a different number of hooks than the
previous pass.

`child.keys` are the citation keys; `child.sources` carries resolved
bibliographic detail so a citation can render as something other than a raw key.
A key with no matching source renders in the error tone.

`style` is `'numeric' | 'author-year' | 'ieee'`; `prefix`, `suffix` and `locator`
add "see", "cf.", "ch. 2" and similar.
