# CitationInline — Reference

How inline citations work in the editor, and how they link to the reference list.

References:
- `src/editor/citations.ts` (the model — numbering, labels, formatting, anchors)
- `src/editor/bibliographyContextState.ts` (`useBibliography`)
- `src/components/editor/blocks/ParagraphBlock/Inlines/CitationInline/CitationInline.tsx`
- `src/components/editor/References/*` (reference list + the two jump helpers)
- `src/components/editor/blocks/ParagraphBlock/Inlines/shared/*` (shared chrome)
- `src/components/editor/SlashMenu/items/citation.ts`
- `src/export/renderStandaloneHtml.tsx`
- `src/editor/types.ts`

## Status

- Implemented. UI on the shared inline chrome (pill + popover); numbering,
  labelling and reference formatting live in one shared module used by both the
  editor and the export.

## Purpose
- Inline citations in numeric, author–year or IEEE style.
- Multiple keys per citation, plus prefix / locator / suffix.
- Sources attachable from the account-enabled arXiv and/or Semantic Scholar
  search without leaving the document. Either selected provider may fail
  independently; Semantic Scholar defaults off.
- A citation resolves to a reference entry, and the entry resolves back to
  every place it is cited from — on screen and in the exported document.

## Data contract (src/editor/types.ts)
```ts
export type CitationSource = {
  key: string;
  title?: string;
  authors?: string;
  year?: string;
  venue?: string;
  url?: string;
  provider?: 'arxiv' | 'semantic_scholar' | 'manual';
  providerId?: string;
  doi?: string;
  externalIds?: Record<string, string>;
  pdfUrl?: string;
  citationCount?: number;
  influentialCitationCount?: number;
  referenceCount?: number;
  isOpenAccess?: boolean;
};

export type CitationChild = {
  id: string;
  type: 'citation';
  keys: string[];                    // citation keys/DOIs/arXiv IDs
  style?: 'numeric' | 'author-year' | 'ieee';
  prefix?: string;                   // e.g., 'see', 'cf.'
  suffix?: string;                   // e.g., 'ch. 2', 'pp. 21–24'
  locator?: string;                  // page/section locator
  /** Resolved bibliographic detail, keyed by entries in `keys`. */
  sources?: CitationSource[];
};
```

Nothing about numbering or ordering is stored. A stored number is a number that
is wrong the first time a paragraph moves.

## The bibliography

`buildBibliography(blocks)` walks the document once and returns the reference
list: one `BibliographyEntry` per **distinct key**, each with its number, its
merged source metadata, and every `CitationUsage` (`blockId`, `childId`,
`ordinal`) that points at it.

- **Numbering counts sources, not citations.** One paper cited in three
  paragraphs is `[1]` all three times. It previously numbered occurrences, so
  the same paper read `[1] [2] [3]` and a reader had no way to tell it was one
  paper — the single most visible thing a numeric style is responsible for.
- **Order** follows first citation for numeric/IEEE, and first-author surname
  for author–year (unattributed entries sort last).
- **Metadata merges across usages**, first non-empty value per field. A key
  typed by hand in one paragraph picks up the title attached in another.
- **`yearSuffix`** separates two sources sharing an author and year:
  `(Smith, 2020a)` / `(Smith, 2020b)`.
- **Document style** is the most-used `child.style`, ties broken by the first
  citation. It decides the order and format of the reference list.
- **`unresolved`** marks an entry that never got more than a bare key.

`EditorProvider` builds it once per block change and publishes it on
`BibliographyContext`; `useBibliography()` reads it. Each citation scanning the
document for itself is quadratic in the number of citations, and a long paper is
exactly where that bill arrives.

Rendered outside an editor (a design-system preview), `useBibliography()`
returns an empty bibliography and labels degrade to `[?]` rather than borrowing
a neighbouring number.

## Slash menu item
- `citationItem` (`group: 'insert'`) inserts via `insertInlineChild`, which writes the
  placeholder `<span data-child-id="ID" contenteditable="false">` and the child
  `{ id, type: 'citation', keys: [], style: 'numeric' }` in one pass.

## Labels

`citationLabelParts(child, bibliography)` returns the printed label in linkable
fragments; `citationLabel` joins them. Splitting matters: `[1, 4]` is two links,
and rendering it as one link to entry 1 drops half of what the citation says.

| style | one key | run of three | run of two | gap |
|---|---|---|---|---|
| `numeric` | `[1]` | `[1–3]` | `[1, 2]` | `[1, 3]` |
| `ieee` | `[1]` | `[1]–[3]` | `[1], [2]` | `[1], [3]` |
| `author-year` | `(Smith, 2020)` | `(Smith, 2020; Doe, 2021; …)` | — | — |

- A run of two is never collapsed: `[1]–[2]` saves no space and reads as a range
  of more than the two things it covers.
- A key with no entry prints `?`; a citation with no keys at all prints `[?]` in
  the destructive tone.
- Author–year falls back to the raw key when the source has no author or year —
  a citation showing the wrong name is worse than one showing a key.
- Prefix, locator and suffix are plain text and never part of a link. An
  author–year signal phrase goes **inside** the parentheses:
  `(see Smith, 2020, p. 12)`.

`firstAuthorSurname` handles the shapes the three providers actually return.
The separator is genuinely ambiguous — the comma in `Smith, John` divides one
name, the comma in `J. Smith, A. Doe` divides two — so the rule is positional:
text before the first comma is a surname only when it is a single word.
Nobiliary particles stay attached (`van der Berg`).

## Reference entries

`formatReference(entry, style)` returns `{ text, href?, linkLabel? }`:

| style | shape |
|---|---|
| `numeric` | `A. Vaswani. Attention. NeurIPS. 2017.` |
| `ieee` | `A. Vaswani, “Attention”, NeurIPS, 2017.` |
| `author-year` | `A. Vaswani (2017). Attention. NeurIPS.` |

The stored author string is printed as supplied. Reordering `J. Smith` into
`Smith, J.` needs structured names, which no provider here returns, and guessing
at the split is how a bibliography ends up citing "A." as a surname.

`referenceLink` picks one destination, best identifier first: DOI →
`url`/`pdfUrl` → an arXiv link reconstructed from provider provenance.

## UI
- Trigger: shared `InlinePill` (primary tint), label as above. A citation with
  no keys renders in the destructive tone. The accessible name names the
  sources (`Citation [1]: Attention Is All You Need`) rather than repeating the
  pill's own text.
- Popover: shared `InlinePopover` with
  - Sources list. Each row shows its reference number as a button that closes
    the popover and jumps to the row in the reference list, and renders the
    entry through the same `formatReference` the list uses — so what is checked
    here is what gets published. A source cited more than once says so.
  - Find a source: searches only the paper sources enabled in Profile → Agent
    tools. When both are selected, arXiv (`searchArxiv`) and the authenticated
    Semantic Scholar proxy (`searchSemanticScholar`) run concurrently. A
    partial provider failure still returns the other provider's results.
  - While preferences load, provider search is disabled. With every source
    off, identifiers and arbitrary citation keys can still be attached
    manually; existing stored source provenance is never removed.
  - Selecting a result that is already attached **upgrades** its metadata rather
    than doing nothing — that is how a key typed by hand acquires a title.
    Adding a key by hand that the document already cites adopts the known
    source instead of adding a second, blank-looking copy.
  - DOI is the canonical key when present. Otherwise, Semantic Scholar records
    use a canonical, versionless external arXiv ID when available, then fall
    back to `S2:<paperId>`. This also deduplicates the same paper returned at
    different arXiv versions; attached sources retain provider provenance.
  - Pasting a bare identifier (DOI / `arXiv:` / `S2:` / numeric id) + Enter
    adds it as a key directly.
  - Style segmented control; "Apply this style to all N citations" appears when
    other citations exist (style is a document-wide decision).
  - Prefix / Locator / Suffix fields.
  - Shared `SettingsFooter` (Remove / Done).
- Behavior:
  - All edits write straight through `updateParagraphChild` (no debounced shadow
    state; see `useInlineChild` for why).
  - Remove deletes the placeholder first, then the child, then re-serializes
    (that order keeps the paragraph's html/children invariant intact).

## The reference list

`ReferencesSection` renders below the last block, or nothing when nothing is
cited. See `.design-sync/docs/ReferencesSection.md`.

Navigation runs both ways through `lib/reveal.ts`, which scrolls, flashes
(`.reveal-flash`) **and moves focus** — scrolling alone is a sighted-only
affordance, and a keyboard user who follows a citation would otherwise land with
focus still back in the paragraph.

- `revealReferenceEntry(entry)` — citation → its row (`id="ref-<n>"`).
- `revealCitationUsage(childId)` — row → the citation, found through the
  paragraph's `data-child-id` placeholder, which is the one node that survives
  the contenteditable being reserialized.

## Export

`renderStandaloneHtml` uses the same module, so the editor and the PDF cannot
disagree — they previously carried two different `firstAuthorSurname`
implementations, and the same document showed `(John, 2020)` on screen and
`(Doe, 2020)` in the export.

- Each number becomes `<a href="#ref-n">`, inside a `<span class="citation"
  id="cite-<childId>">`.
- `include_references` (default on) appends `<section class="references">`: one
  `<li id="ref-n">` per entry with the formatted text, its outbound link, and a
  `↑` back-link per usage to `#cite-<childId>`.
- The citation used to link to the publisher instead — the one destination a
  reader can reach unaided, and the one that is unreachable offline or on paper.
  The entry now carries the outbound link, which is the direction every
  published paper uses.
- With `include_references` off, citations render as plain `<span>`s: `[1]`
  linking into a section that was not exported is worse than `[1]` linking to
  nothing.

## Agent citation suggestions

- The Floating Toolbar's **Search references** action accepts the backend's
  strict self-closing `<citation ... />` format.
- On accept, well-formed tags are converted into empty `data-child-id`
  placeholders and normal `CitationChild` records. Surrounding response text
  is preserved as text nodes.
- A DOI supplied in the backend's portable `key` attribute is canonicalized
  (through the shared `canonicalDoi`) and takes identity precedence over an
  inferred Semantic Scholar paper ID. The Semantic Scholar URL still determines
  the source's provider provenance.
- Model output is never inserted as HTML. A malformed, unknown, or unsafe
  citation tag disables the structured transform and the complete response
  follows the existing plain-text acceptance path.
- Other AI actions never run the citation-tag transform.

## Example JSON
```json
{
  "id": "p1",
  "type": "paragraph",
  "html": "We build on <span data-child-id=\"c1\" contenteditable=\"false\"></span> and extend prior work.",
  "children": [
    {
      "id": "c1",
      "type": "citation",
      "keys": ["smith2020"],
      "style": "numeric",
      "sources": [{ "key": "smith2020", "title": "…", "authors": "J. Smith", "year": "2020", "venue": "arXiv" }]
    }
  ]
}
```

## Styling & accessibility
- Wrapper class `.citation-inline`; `role="group"`, `aria-label="Citation"`.
- The pill's `aria-label` lists the attached titles.
- Reference rows are `tabIndex={-1}` so a jump can leave focus on the row it
  landed on; back-links name their target (`Go to citation 2 of 3 for …`).
- `.reveal-flash` is two beats rather than one long fade: a single decay is easy
  to miss when the jump lands mid-scroll.

## Tests
- `src/editor/__tests__/citations.test.ts` — the model.
- `src/components/editor/References/ReferencesSection.test.tsx` — the list.
- `src/components/editor/blocks/ParagraphBlock/Inlines/__tests__/InlineWidgets.test.tsx`
  — the widget, against the real provider.
- `src/export/renderStandaloneHtml.test.tsx` — the exported anchors both ways.
