# CitationInline — Development Plan

This document specifies how to implement the `CitationInline` component for inserting citations into paragraph text.

References:
- `src/components/editor/blocks/ParagraphBlock/ParagraphBlock.tsx`
- `src/components/common/Editable/Editable.tsx`
- `src/editor/types.ts`
- `src/components/editor/SlashMenu/items/*`

## Purpose
- Enable inline citations in numeric or author–year styles.
- Support multiple keys, prefixes/suffixes, and locators.

## Type additions (src/editor/types.ts)
```ts
export type CitationChild = {
  id: string;
  type: 'citation';
  keys: string[];                    // ['smith2020', '10.1145/...', 'arXiv:2101.12345']
  style?: 'numeric' | 'author-year' | 'ieee';
  prefix?: string;                   // e.g., 'see', 'cf.'
  suffix?: string;                   // e.g., 'ch. 2', 'pp. 21–24'
  locator?: string;                  // page/section locator
};
```
Extend `ParagraphChild` union to include `CitationChild`.

## Slash menu item (src/components/editor/SlashMenu/items/citation.ts)
- Export `citationItem: SlashItem` with `id: 'citation'`, `group: 'insert'`.
- onSelect steps:
  1) Resolve `editable = refs.current[blockId]` and `range = document.getSelection().getRangeAt(0)`.
  2) Create placeholder: `<span data-child-id={id} contenteditable="false"></span>` and insert at caret. Add a trailing space node for caret stability.
  3) `updateHtml(blockId, serializeEditableHtml(editable))`.
  4) `addParagraphChild(blockId, { id, type: 'citation', keys: [], style: 'numeric', prefix: '', suffix: '', locator: '' })`.

## Inline component (src/components/editor/blocks/ParagraphBlock/Inlines/CitationInline/CitationInline.tsx)
- Props: `{ blockId, child, updateParagraphChild, removeParagraphChild, updateHtml, refs }`.
- Root: `<span className="citation-inline" contentEditable={false} onMouseDown={stopPropagation} onClick={stopPropagation}>`.
- UI:
  - Render pill: `[1]` (numeric) or `(Smith, 2020)` (author-year). If multiple keys, join with commas.
  - Click/Enter opens an inline popover with:
    - Keys list (add/remove input with autocomplete hook for later integration; for now simple text).
    - Style dropdown: numeric | author-year | ieee.
    - Optional prefix/suffix/locator inputs.
  - Provide small “×” button to remove the inline.
- Behavior:
  - Debounce calls to `updateParagraphChild(blockId, child.id, {...})` when fields change.
  - Remove: delete placeholder node from the editable DOM, call `removeParagraphChild`, then `updateHtml(blockId, serializeEditableHtml(editable))`.

## ParagraphBlock integration
- In `ParagraphBlock.tsx`, extend portal mapping:
  - `child.type === 'citation'` → `<CitationInline ... />`.
- Reuse the same props as `AiBeatInline/TableInline`.

## Rendering/labeling
- MVP: numeric labels use order within paragraph context or `keys.length` > 0 shows `[n]` placeholder; exact numbering can be refined later.
- Author–year: display first author last name + year for first key; if multiple: `(Smith 2020; Doe 2021)` (simplified placeholder rendering until metadata lookup is added).

## Example JSON usage
```json
{
  "id": "p1",
  "type": "paragraph",
  "html": "We build on <span data-child-id=\"c1\" contenteditable=\"false\"></span> and extend prior work.",
  "children": [
    { "id": "c1", "type": "citation", "keys": ["smith2020"], "style": "numeric" }
  ]
}
```

## Persistence and serialization
- All UI state (`keys`, `style`, `prefix`, `suffix`, `locator`) lives in `children`.
- Paragraph `html` must only contain placeholder spans; serialize with `serializeEditableHtml` before persisting.

## Styling & accessibility
- Class: `.citation-inline` for wrapper; popover uses `.citation-popover`.
- `role="group"` and `aria-label="Citation"`; buttons/inputs include `title` attributes.
