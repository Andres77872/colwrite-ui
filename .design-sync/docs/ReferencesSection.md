---
category: Editor blocks
keywords: [references, bibliography, citation, sources, back-link, numbering]
---

# ReferencesSection

The document's reference list, rendered at the foot of the canvas. It is the
other half of a citation: `[1]` on its own is a promise, and this is where the
promise is kept.

```ts
ReferencesSection()
```

Takes no props. Everything it shows is derived from the document's blocks
through `useBibliography()` — which sources exist, what number each has, and
every place each one is cited from. Nothing is stored, because a reference list
kept in step by hand is a reference list that goes wrong the first time a
paragraph moves.

Renders `null` until something is cited.

## Rows

One row per **source**, not per citation: a paper cited in three paragraphs is
one entry with three back-links. Rows carry `id="ref-<n>"`, which is what a
citation links to.

- **Numeric / IEEE** — `[n]` marker, ordered by first citation.
- **Author–year** — no marker, sorted alphabetically by first-author surname.
  Two sources sharing an author and year are separated as `2020a` / `2020b`.

Each row shows the formatted entry, one outbound link (DOI first, then URL, then
a reconstructed arXiv link), and a back-link per usage that scrolls to the
citation, flashes it and moves focus there.

A key that never got metadata is printed as itself and counted in a
"without details" badge, rather than being dropped from the list.

## Related

`revealCitationUsage(childId)` and `revealReferenceEntry(entry)` are exported
alongside it — the two directions of the citation ↔ reference jump, shared with
`CitationInline`'s popover.
