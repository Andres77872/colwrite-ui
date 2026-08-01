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
A citation with no key at all renders `[?]` in the error tone.

`style` is `'numeric' | 'author-year' | 'ieee'`; `prefix`, `suffix` and `locator`
add "see", "cf.", "ch. 2" and similar. An author–year signal phrase goes inside
the parentheses — `(see Smith, 2020, p. 12)`.

## Numbering

The printed number is the **source's** position in the document's reference
list, read from `useBibliography()`. One paper cited three times is `[1]` all
three times. Multiple keys collapse into a range: `[1–3]` in numeric,
`[1]–[3]` in IEEE, and a run of two stays as two.

Because numbering is a document-wide property, the widget cannot compute it
alone: without a `BibliographyContext` above it — as in a preview supplying a
literal `EditorContext` — every pill falls back to `[?]`. Derive one with
`buildBibliography(blocks)`.

The pill's accessible name names the sources (`Citation [1]: Attention Is All
You Need`) rather than repeating its own text.

## Popover

Each attached source shows its reference number as a button that jumps to the
row in `ReferencesSection`, and the entry as `formatReference` will publish it,
so what is checked here is what is printed. Re-attaching a key that is already
present upgrades its metadata instead of doing nothing — that is how a key typed
by hand acquires a title.
