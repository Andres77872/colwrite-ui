# EquationInline — Development Plan

This document specifies how to implement the `EquationInline` component for inline LaTeX math.

References:
- `src/components/editor/blocks/ParagraphBlock/ParagraphBlock.tsx`
- `src/components/common/Editable/Editable.tsx`
- `src/editor/types.ts`
- `src/components/editor/SlashMenu/items/*`

## Status

- Implemented.
- UI component: `src/components/editor/blocks/ParagraphBlock/Inlines/EquationInline/EquationInline.tsx`
- Slash menu item: `src/components/editor/SlashMenu/items/equation.ts`
- Mounted via portals in: `src/components/editor/blocks/ParagraphBlock/ParagraphBlock.tsx`

## Purpose
- Add inline equations within sentences (e.g., `E=mc^2`).

## Type additions (src/editor/types.ts)
```ts
export type EquationChild = {
  id: string;
  type: 'equation';
  latex: string;               // LaTeX math without $ delimiters
  numbered?: boolean;          // reserved; false by default for inline
  labelId?: string;            // optional anchor for cross-references
};
```
Extend `ParagraphChild` union to include `EquationChild`.

## Slash menu item (src/components/editor/SlashMenu/items/equation.ts)
- `equationItem: SlashItem` with `id: 'equation'`, `label: 'Equation'`, `group: 'insert'`.
- onSelect:
  1) Insert placeholder span at caret and trailing space.
  2) `updateHtml(blockId, serializeEditableHtml(editable))`.
  3) `addParagraphChild(blockId, { id, type: 'equation', latex: '', numbered: false })`.

## Inline component (src/components/editor/blocks/ParagraphBlock/Inlines/EquationInline/EquationInline.tsx)
- Props: `{ blockId, child, updateParagraphChild, removeParagraphChild, updateHtml, refs }`.
- Root: `<span className="equation-inline" contentEditable={false} ...>`.
- UI:
  - Display rendered math via optional KaTeX if available (checks `window.katex`); otherwise fallback to plaintext `child.latex`.
  - To enable KaTeX preview, include KaTeX CSS and JS in `index.html` so `window.katex` is available:
    ```html
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js" crossorigin="anonymous"></script>
    ```
  - Clicking toggles an inline editor (single-line text input). Enter saves; Esc cancels.
  - Optional checkbox for `numbered` and text input for `labelId`.
  - Remove button (“×”).
- Behavior:
  - Debounced `updateParagraphChild` when `latex`, `numbered`, `labelId` change.
  - Remove: delete placeholder → `removeParagraphChild` → `updateHtml` with `serializeEditableHtml`.

## ParagraphBlock integration
- Add portal case: `child.type === 'equation'` → `<EquationInline ... />`.

## Example JSON usage
```json
{
  "id": "p1",
  "type": "paragraph",
  "html": "Einstein proposed <span data-child-id=\"e1\" contenteditable=\"false\"></span> in his work.",
  "children": [
    { "id": "e1", "type": "equation", "latex": "E=mc^2" }
  ]
}
```

## Styling & accessibility
- Wrapper class `.equation-inline`; popover/editor `.equation-editor`.
- `role="group"` and `aria-label="Equation"`.
