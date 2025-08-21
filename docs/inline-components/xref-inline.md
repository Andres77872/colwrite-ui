# XRefInline — Development Plan

This document specifies how to implement the `XRefInline` component for cross-references to headings, tables, equations, or figures.

References:
- `src/components/editor/blocks/ParagraphBlock/ParagraphBlock.tsx`
- `src/components/common/Editable/Editable.tsx`
- `src/editor/types.ts`

## Purpose
- Allow references like “as shown in Figure 2” or “see Section 3.1”.

## Type additions (src/editor/types.ts)
```ts
export type XRefChild = {
  id: string;
  type: 'xref';
  targetId: string;                 // block id or child id
  targetKind: 'heading' | 'table' | 'equation' | 'figure';
  textOverride?: string;            // optional custom label
};
```
Extend `ParagraphChild` union to include `XRefChild`.

## Target indexing and labels
- Build an index at render time by scanning `doc.blocks`:
  - Headings: order-based label (e.g., "Section 2" or with levels).
  - Tables/Equations: per-type counters across document ("Table 1", "Eq. 2").
  - Figures: reserved for future block/child type.
- Provide helper hook `useDocIndex()` returning label resolvers: `{ headingById, tableIndex, equationIndex, ... }`.

## Slash menu item (src/components/editor/SlashMenu/items/xref.ts)
- `xrefItem: SlashItem` with `id: 'xref'`, `group: 'insert'`.
- onSelect:
  1) Insert placeholder span at caret + trailing space.
  2) `updateHtml(blockId, serializeEditableHtml(editable))`.
  3) `addParagraphChild(blockId, { id, type: 'xref', targetId: '', targetKind: 'heading' })`.
  4) Open a picker listing eligible targets (headings, tables, equations) with live filter; set `targetId`+`targetKind` on confirm.

## Inline component (src/components/editor/blocks/ParagraphBlock/Inlines/XRefInline/XRefInline.tsx)
- Props: `{ blockId, child, updateParagraphChild, removeParagraphChild, updateHtml, refs }`.
- Root: `<span className="xref-inline" contentEditable={false} ...>`.
- UI:
  - Renders computed label based on `targetKind` and index (e.g., "Figure 2").
  - Hover tooltip with target preview; click to “Go to target” (scroll into view).
  - Edit button to change the target via picker; Remove button (“×”).
- Behavior:
  - `updateParagraphChild` when `targetId`/`targetKind` changes.
  - Remove: delete placeholder → `removeParagraphChild` → `updateHtml(serializeEditableHtml(...))`.

## ParagraphBlock integration
- Add portal case: `child.type === 'xref'` → `<XRefInline ... />`.

## Example JSON usage
```json
{
  "id": "p1",
  "type": "paragraph",
  "html": "As shown in <span data-child-id=\"x1\" contenteditable=\"false\"></span>.",
  "children": [
    { "id": "x1", "type": "xref", "targetId": "t1", "targetKind": "table" }
  ]
}
```

## Styling & accessibility
- Wrapper class `.xref-inline`; picker `.xref-picker`.
- `role="group"`, `aria-label="Cross reference"`.
