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

`child.keys` are reference keys (`doi:…`, `arxiv:…`, or a key the author
typed); `child.sources` carries each work's reference record (a CSL-JSON item
under `csl`, with `key`, `kind`, `provider`, `state` and `flags` beside it), so a
citation renders from the record, not the key. A citation with no key at all
renders `[?]` in the error tone. `child.passage` names the passage the claim
rests on; without one the popover says "Passage not recorded".

`style` is one of the API's eight CSL style ids, each its CSL file's name (`nlm-citation-sequence-brackets`, `apa`,
`ieee`, …); the page's `citationStyle` overrides it, and the whole page renders
in one style through citeproc-js. `prefix`, `suffix` and `locator` add "see",
"ch. 2", "p. 12"; in APA a signal phrase goes inside the parentheses —
`(see Smith, 2020, p. 12)`.

## Numbering

The printed number is the **source's** position in the document's reference
list, read from `useBibliography()`. One paper cited three times is `[1]` all
three times. Multiple keys print as the style prints them: `[1–3]` in
Vancouver (brackets), `[1], [2], [3]` in IEEE.

Because numbering is a document-wide property, the widget cannot compute it
alone: without a `BibliographyContext` above it — as in a preview supplying a
literal `EditorContext` — every pill falls back to `[?]`. Derive one with
`buildBibliography(blocks)`.

The pill's accessible name names the sources (`Citation [1]: Attention Is All
You Need`) rather than repeating its own text.

## Popover

Each attached source shows its reference label as a button that jumps to the
row in `ReferencesSection`, the entry as the CSL style prints it, and its state
(retracted, needs review, a published version). Re-attaching a key that is
already present replaces its record — that is how a key typed by hand acquires
its reference. The search field searches the paper routes (one `PaperRow` per
result, with the shared Cite and Add); a pasted DOI or arXiv id goes through the
resolver first. The page's style picker sits under More options, with the
citeproc-js and CSL credits.
