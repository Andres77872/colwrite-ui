# EquationInline — Reference

How inline and display LaTeX math work in the editor.

References:
- `src/components/editor/blocks/ParagraphBlock/Inlines/EquationInline/EquationInline.tsx`
- `src/components/editor/blocks/ParagraphBlock/Inlines/shared/*` (shared chrome)
- `src/components/editor/SlashMenu/items/equation.ts`
- `src/lib/katex.ts`
- `src/editor/types.ts`

## Status

- Implemented; UI reworked onto the shared inline chrome (pill + popover).
- Display equations (own centred line, optional numbering) are implemented via
  `display?: boolean` — they are no longer a non-goal.

## Purpose
- Inline equations within sentences (e.g., `E=mc^2`).
- Display equations on their own line with optional document-wide numbering and
  a label for future cross-references.

## Data contract (src/editor/types.ts)
```ts
export type EquationChild = {
  id: string;
  type: 'equation';
  latex: string;               // LaTeX math without $ delimiters
  /** Render on its own centred line rather than in the run of text. */
  display?: boolean;
  numbered?: boolean;          // display equations only
  labelId?: string;            // optional anchor for cross-references
};
```

## Slash menu items
- `equationItem` — inline maths, child `{ id, type: 'equation', latex: '' }`.
- `displayEquationItem` — display maths, child `{ ..., display: true, numbered: true }`.

## UI
- One popover (`InlinePopover`), two triggers:
  - Inline: shared `InlinePill`. Shows KaTeX-rendered maths, the LaTeX source in
    monospace while KaTeX loads, and the destructive tone when rendering fails.
  - Display: a full-width centred row with a right-aligned `(n)` when numbered,
    with hover chrome matching the figure shell.
- Editor popover:
  - LaTeX textarea. **Enter finishes, Shift+Enter adds a line** (the same
    pattern as table cells); Esc closes via Radix.
  - Symbol palette (superscripts, fractions, roots, sums, Greek, …) inserting at
    the caret.
  - `Display on its own line` and `Numbered` checkboxes (`SettingsCheck`);
    Numbered is disabled for inline maths.
  - Label field (`labelId`) shown for numbered display equations.
  - Live preview, inline render errors, and an offline notice when the maths
    library cannot be reached.
  - Shared `SettingsFooter` (Remove / Done).

## Typesetting
- KaTeX ships as a CDN global (`window.katex` in `index.html`), wrapped by
  `src/lib/katex.ts` with `loading | ready | unavailable` status. The widget
  re-renders when the script lands; the LaTeX source is always persisted, so
  nothing is lost offline.

## Rendering rules
- Numbering counts **numbered display equations** across the whole document in
  block order, computed at render time and never stored in JSON.

## Example JSON
```json
{
  "id": "p1",
  "type": "paragraph",
  "html": "From <span data-child-id=\"e1\" contenteditable=\"false\"></span> it follows that <span data-child-id=\"e2\" contenteditable=\"false\"></span>.",
  "children": [
    { "id": "e1", "type": "equation", "latex": "E=mc^2" },
    { "id": "e2", "type": "equation", "latex": "\\frac{a}{b} = c", "display": true, "numbered": true, "labelId": "eq:ratio" }
  ]
}
```

## Styling & accessibility
- Wrapper class `.equation-inline`; `role="group"`, `aria-label="Equation"` or
  `"Display equation"`.
