# VarInline — Development Plan

This document specifies how to implement the `VarInline` component for document variables (tokens) like N, lr, etc.

References:
- `src/components/editor/blocks/ParagraphBlock/ParagraphBlock.tsx`
- `src/components/common/Editable/Editable.tsx`
- `src/editor/types.ts`

## Purpose
- Insert variables that can be reused throughout the document; updating one updates all with the same name.

## Type additions (src/editor/types.ts)
```ts
export type VarChild = {
  id: string;
  type: 'var';
  name: string;               // e.g., 'N'
  value: string;              // e.g., '1000'
};
```
Extend `ParagraphChild` union to include `VarChild`.

## Synchronization model
- Option A (doc meta map): maintain `doc.vars?: Record<string, string>`; `VarInline` updates both the child and the global map. On render/mount, reconcile children to the map value.
- Option B (inline-driven): on `value` change, scan all blocks and update children with the same `name` via `updateParagraphChild`.
- Choose one consistent approach; Option A preferred for single source of truth.

## Slash menu item (src/components/editor/SlashMenu/items/var.ts)
- `varItem: SlashItem` with `id: 'var'`, `group: 'insert'`.
- onSelect:
  1) Insert placeholder at caret + trailing space.
  2) `updateHtml(blockId, serializeEditableHtml(editable))`.
  3) `addParagraphChild(blockId, { id, type: 'var', name: 'N', value: '' })`.

## Inline component (src/components/editor/blocks/ParagraphBlock/Inlines/VarInline/VarInline.tsx)
- Props: `{ blockId, child, updateParagraphChild, removeParagraphChild, updateHtml, refs }` (and optionally access to global vars via context).
- Root: `<span className="var-inline" contentEditable={false} ...>`.
- UI:
  - Display `name` and `value` (e.g., `N=1000` or `N` with subtle chip).
  - Click opens small editor for `name` and `value`; Enter saves; Esc cancels.
  - Remove button (“×”).
- Behavior:
  - Debounced `updateParagraphChild` when `name`/`value` change.
  - If using Option A, also update global `vars` and trigger reconciliation.
  - Remove: delete placeholder → `removeParagraphChild` → `updateHtml(serializeEditableHtml(...))`.

## ParagraphBlock integration
- Add portal case: `child.type === 'var'` → `<VarInline ... />`.

## Example JSON usage
```json
{
  "id": "p1",
  "type": "paragraph",
  "html": "We used <span data-child-id=\"v1\" contenteditable=\"false\"></span> samples.",
  "children": [
    { "id": "v1", "type": "var", "name": "N", "value": "1000" }
  ]
}
```

## Styling & accessibility
- Wrapper class `.var-inline`; editor `.var-editor`.
- `role="group"`, `aria-label="Variable"`.
