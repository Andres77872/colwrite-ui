# CitationInline — Reference

How inline citations work in the editor.

References:
- `src/components/editor/blocks/ParagraphBlock/Inlines/CitationInline/CitationInline.tsx`
- `src/components/editor/blocks/ParagraphBlock/Inlines/shared/*` (shared chrome)
- `src/components/editor/SlashMenu/items/citation.ts`
- `src/editor/types.ts`

## Status

- Implemented; UI reworked onto the shared inline chrome (pill + popover).

## Purpose
- Inline citations in numeric, author–year or IEEE style.
- Multiple keys per citation, plus prefix / locator / suffix.
- Sources attachable from arXiv search without leaving the document.

## Data contract (src/editor/types.ts)
```ts
export type CitationSource = {
  key: string;
  title?: string;
  authors?: string;
  year?: string;
  venue?: string;
  url?: string;
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

## Slash menu item
- `citationItem` (`group: 'insert'`) inserts via `insertInlineChild`, which writes the
  placeholder `<span data-child-id="ID" contenteditable="false">` and the child
  `{ id, type: 'citation', keys: [], style: 'numeric' }` in one pass.

## UI
- Trigger: shared `InlinePill` (primary tint). Label is `[n]` (numeric/IEEE) or
  `(Smith, 2020; Doe, 2021)` (author–year), with prefix/locator/suffix applied.
  A citation with no keys renders in the destructive tone.
- Popover: shared `InlinePopover` with
  - Sources list (title · authors · year · venue, external link, detach).
  - Find a source: arXiv search (`searchArxiv`), attach results; pasting a bare
    identifier (DOI / `arXiv:` / numeric id) + Enter adds it as a key directly.
  - Style segmented control; "Apply this style to all N citations" appears when
    other citations exist (style is a document-wide decision).
  - Prefix / Locator / Suffix fields.
  - Shared `SettingsFooter` (Remove / Done).
- Behavior:
  - All edits write straight through `updateParagraphChild` (no debounced shadow
    state; see `useInlineChild` for why).
  - Remove deletes the placeholder first, then the child, then re-serializes
    (that order keeps the paragraph's html/children invariant intact).

## Rendering rules
- Numbering counts citation children across the **whole document** in block
  order — numbering is a document-level property, computed at render time and
  never stored in JSON.
- Author–year renders first-author surname + year from `sources`; a key without
  resolved metadata falls back to the raw key (a wrong author is worse than a
  visible key).

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
- Sources tooltip on the pill lists attached titles.
