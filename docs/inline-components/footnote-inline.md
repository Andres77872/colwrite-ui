# FootnoteInline — Development Plan

This document specifies how to implement the `FootnoteInline` component for authoring footnotes.

References:
- `src/components/editor/blocks/ParagraphBlock/ParagraphBlock.tsx`
- `src/components/common/Editable/Editable.tsx`
- `src/editor/types.ts`

## Purpose
- Provide inline footnotes with automatic numbering based on document order.

## Type additions (src/editor/types.ts)
```ts
export type FootnoteChild = {
  id: string;
  type: 'footnote';
  text: string;                // footnote content
};
```
Extend `ParagraphChild` union to include `FootnoteChild`.

## Numbering model
- Numbers are computed at render time by scanning blocks in order and counting `footnote` children.
- The numeric label is not persisted in JSON.
- Provide a small helper (optional): `useDocIndex()` that returns a map `{ childId -> footnoteNumber }`.

## Slash menu item (src/components/editor/SlashMenu/items/footnote.ts)
- `footnoteItem: SlashItem` with `id: 'footnote'`, `group: 'insert'`.
- onSelect:
  1) Insert placeholder span at caret + trailing space.
  2) `updateHtml(blockId, serializeEditableHtml(editable))`.
  3) `addParagraphChild(blockId, { id, type: 'footnote', text: '' })`.

## Inline component (src/components/editor/blocks/ParagraphBlock/Inlines/FootnoteInline/FootnoteInline.tsx)
- Props: `{ blockId, child, updateParagraphChild, removeParagraphChild, updateHtml, refs }`.
- Root: `<span className="footnote-inline" contentEditable={false} ...>`.
- UI:
  - Render superscript chip with computed number (e.g., ¹). Hover shows tooltip.
  - Click opens a small popover textarea to edit `text`. Enter saves; Esc closes.
  - Remove button (“×”).
- Behavior:
  - Debounced `updateParagraphChild` when `text` changes.
  - Remove: delete placeholder → `removeParagraphChild` → `updateHtml(serializeEditableHtml(...))`.

## ParagraphBlock integration
- Add portal case: `child.type === 'footnote'` → `<FootnoteInline ... />`.

## Example JSON usage
```json
{
  "id": "p1",
  "type": "paragraph",
  "html": "A claim<span data-child-id=\"f1\" contenteditable=\"false\"></span> with detail.",
  "children": [
    { "id": "f1", "type": "footnote", "text": "Further details here." }
  ]
}
```

## Styling & accessibility
- Wrapper class `.footnote-inline`; popover `.footnote-popover`.
- `role="group"`, `aria-label="Footnote"`.
