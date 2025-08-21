# Inline Components: Development Plan and Requirements

This plan proposes new inline components for scientific writing (arXiv-style) and describes how to integrate them into the existing editor architecture.

Ground-truth code references:
- `src/components/editor/blocks/ParagraphBlock/ParagraphBlock.tsx`
- `src/components/common/Editable/Editable.tsx`
- `src/editor/types.ts`
- `src/components/editor/blocks/ParagraphBlock/Inlines/AiBeatInline/AiBeatInline.tsx`
- `src/components/editor/blocks/ParagraphBlock/Inlines/TableInline/TableInline.tsx`
- `src/components/editor/SlashMenu/items/*`

## Architectural principles (current)
- __Placeholders__: Paragraph `html` contains empty placeholders `<span data-child-id="ID" contenteditable="false"></span>`; actual state lives in `ParagraphBlock.children`.
- __Portals__: `ParagraphBlock.tsx` queries placeholders and mounts React inline components with `createPortal` into each matching span.
- __Serialization__: `serializeEditableHtml(...)` cleans rendered internals inside `data-child-id` elements and persists only sanitized HTML.
- __Insert/remove__: Slash menu items insert placeholders and call `addParagraphChild(...)`. Inline UIs remove themselves by deleting the placeholder, calling `removeParagraphChild(...)`, and persisting updated HTML.
- __Editing__: `Editable.tsx` intercepts `/` to open the slash menu unless the caret is inside an inline (via `contentEditable=false` and CSS class checks).

## Goals
- Provide core scientific authoring inlines: Citation, Equation (inline math), Footnote, Cross-reference, Variable token.
- Maintain current JSON model (children stored per paragraph, referenced by placeholders).
- Keep UI small, accessible, and keyboard-friendly; non-intrusive in text flow.

---

## Proposed new inline types
Below, for each component: purpose, JSON shape (TypeScript), UI/UX, insertion/removal, and example usage.

### 1) CitationInline
- __Purpose__: Insert one or more citations in numeric or author-year styles. Suitable for arXiv (numeric by default).
- __JSON shape (add to `src/editor/types.ts`)__:
```ts
export type CitationChild = {
  id: string;
  type: 'citation';
  keys: string[];           // citation keys/DOIs/arXiv IDs; e.g., ['smith2020','10.1145/...','arXiv:2101.12345']
  style?: 'numeric' | 'author-year' | 'ieee';
  prefix?: string;          // e.g., 'see', 'cf.'
  suffix?: string;          // e.g., 'ch. 2', 'pp. 21–24'
  locator?: string;         // page/section locator if needed
};
```
- __UI/UX__:
  - Renders as a small pill, e.g., `[1]` (numeric) or `(Smith, 2020)`.
  - Click/Enter opens a popover: search/add/remove keys; set style; edit prefix/suffix.
  - Keyboard: Enter to confirm, Esc to close; Tab cycles fields.
  - Class: `citation-inline`.
- __Slash menu__: `citation` (group: `insert`). On select: insert placeholder + add child with empty `keys: []`, default `style: 'numeric'`.
- __Removal__: Close button removes placeholder + child and persists HTML.
- __Example__:
```json
{
  "html": "We build on <span data-child-id=\"c1\" contenteditable=\"false\"></span>.",
  "children": [
    { "id": "c1", "type": "citation", "keys": ["smith2020"], "style": "numeric" }
  ]
}
```

### 2) EquationInline (inline math)
- __Purpose__: Inline LaTeX math (not block display). Suitable for `E=mc^2` within sentences.
- __JSON shape__:
```ts
export type EquationChild = {
  id: string;
  type: 'equation';
  latex: string;            // LaTeX math content without $ delimiters
  numbered?: boolean;       // seldom used for inline; reserved for future
  labelId?: string;         // optional anchor for cross-referencing
};
```
- __UI/UX__:
  - Renders LaTeX (KaTeX later; initial MVP can show plaintext until math renderer is integrated).
  - Click toggles an inline editor textbox; Enter confirms; Esc cancels.
  - Class: `equation-inline`.
- __Slash menu__: `equation` (alias `math`). Insert placeholder and add child `{ latex: '' }`.
- __Removal__: Close button; persist HTML via `serializeEditableHtml`.
- __Example__:
```json
{
  "html": "Einstein proposed <span data-child-id=\"e1\" contenteditable=\"false\"></span>.",
  "children": [
    { "id": "e1", "type": "equation", "latex": "E=mc^2" }
  ]
}
```

### 3) FootnoteInline
- __Purpose__: Add explanatory notes; numbered automatically in reading order.
- __JSON shape__:
```ts
export type FootnoteChild = {
  id: string;
  type: 'footnote';
  text: string;             // footnote content
};
```
- __UI/UX__:
  - Renders as a superscript chip (e.g., ¹) with a small popover to edit `text`.
  - Numbering computed at render-time by document order (no number stored in JSON).
  - Class: `footnote-inline`.
- __Slash menu__: `footnote` (group: `insert`).
- __Removal__: Close button removes child + placeholder.
- __Example__:
```json
{
  "html": "A claim<span data-child-id=\"f1\" contenteditable=\"false\"></span>.",
  "children": [
    { "id": "f1", "type": "footnote", "text": "Further details here." }
  ]
}
```

### 4) CrossRefInline
- __Purpose__: Refer to other items (Sections/Headings, Tables, Equations, Figures) and auto-label (e.g., “Figure 2”, “Section 3.1”).
- __JSON shape__:
```ts
export type XRefChild = {
  id: string;
  type: 'xref';
  targetId: string;         // block id (e.g., heading) or child id (e.g., table/equation)
  targetKind: 'heading' | 'table' | 'equation' | 'figure';
  textOverride?: string;    // optional override label
};
```
- __UI/UX__:
  - Renders computed label; hover shows a tooltip with target text; click “Go to target”.
  - Class: `xref-inline`.
- __Slash menu__: `xref` (group: `insert`), opens a picker listing eligible targets (scan blocks/children).
- __Numbering/labels__:
  - Headings: use their order + level for labels (e.g., “Section 2.3”).
  - Tables/Equations: count per type (Table 1, 2, …; Eq. 1, 2, …) across the document.
- __Example__:
```json
{
  "html": "As shown in <span data-child-id=\"x1\" contenteditable=\"false\"></span>.",
  "children": [
    { "id": "x1", "type": "xref", "targetId": "t1", "targetKind": "table" }
  ]
}
```

### 5) VariableInline (document variables)
- __Purpose__: Reusable tokens (e.g., dataset size N, learning rate). Editing one updates all occurrences.
- __JSON shape__:
```ts
export type VarChild = {
  id: string;
  type: 'var';
  name: string;             // key, e.g., 'N'
  value: string;            // e.g., '1000'
};
```
- __UI/UX__:
  - Renders as `N=1000` or as `N` with subtle chip; click opens small editor to change `value` (and optionally `name`).
  - Class: `var-inline`.
- __Propagation__ (proposal): maintain a document-level map `{ [name]: value }` in `Doc` meta for global updates; syncing strategy described below.
- __Slash menu__: `var` (group: `insert`).
- __Example__:
```json
{
  "html": "We used <span data-child-id=\"v1\" contenteditable=\"false\"></span> samples.",
  "children": [
    { "id": "v1", "type": "var", "name": "N", "value": "1000" }
  ]
}
```

---

## Integration details

### Type additions
- Extend `ParagraphChild` in `src/editor/types.ts`:
```ts
export type ParagraphChild =
  | AiBeatChild
  | TableChild
  | CitationChild
  | EquationChild
  | FootnoteChild
  | XRefChild
  | VarChild;
```

### Rendering in `ParagraphBlock.tsx`
- Add cases to the portal mapping:
  - `child.type === 'citation'` → `<CitationInline ... />`
  - `child.type === 'equation'` → `<EquationInline ... />`
  - `child.type === 'footnote'` → `<FootnoteInline ... />`
  - `child.type === 'xref'` → `<XRefInline ... />`
  - `child.type === 'var'` → `<VarInline ... />`
- Follow `AiBeatInline` and `TableInline` patterns:
  - Receive `blockId`, `child`, `updateParagraphChild`, `removeParagraphChild`, `updateHtml`, `refs`.
  - Set wrapper `contentEditable={false}` and stop propagation on mouse events.

### Slash menu items
- Add slash items in `src/components/editor/SlashMenu/items/`:
  - `citation.ts`, `equation.ts`, `footnote.ts`, `xref.ts`, `var.ts`.
- Each item should:
  - Insert `<span data-child-id=ID contenteditable="false"></span>` at caret (+ a trailing space for caret stability).
  - Call `updateHtml(blockId, serializeEditableHtml(editable))`.
  - Call `addParagraphChild(blockId, { ... })` with default payload.

### Removing inlines
- Inline UIs include a remove button:
  - Delete the matching placeholder from the editable DOM.
  - Call `removeParagraphChild(blockId, child.id)`.
  - Re-serialize and `updateHtml`.

### Numbering and label resolution (xref/footnote)
- Compute numbering at render-time by scanning `doc.blocks`:
  - Headings: build an index with hierarchical numbers (e.g., 2.3 based on levels) or simple order for MVP.
  - Tables/Equations: count occurrences across all paragraphs’ `children`.
  - Footnotes: number in document order.
- Expose a helper selector (proposal) from a small hook under `src/components/editor/blocks/ParagraphBlock/Inlines/useDocIndex.ts`.

### Variable synchronization (proposal)
- Add optional doc meta map, e.g., `Doc & { vars?: Record<string, string> }` (or maintain in provider state).
- When a `VarInline` updates `value`, also update the global map and trigger a pass that updates all matching var children with the same `name`.
- MVP alternative: update identical-name var children opportunistically in the inline component via `updateParagraphChild` scans.

### Styling/UI consistency
- Use small chips/pills with subtle borders; follow button/toggle patterns from `AiBeatInline`/`TableInline`.
- Classes per component: `.citation-inline`, `.equation-inline`, `.footnote-inline`, `.xref-inline`, `.var-inline`.
- Respect paragraph column layout via the host `Editable` styles (no fixed widths).
- Ensure focus rings and keyboard navigation mirror existing components.

### Accessibility
- Each inline root: `role="group"` and `aria-label`.
- Interactive controls: proper `title` attributes; Esc closes popovers; Tab order is predictable.

### Persistence and serialization rules
- Never embed rendered inline internals in paragraph `html`; rely on placeholders and `serializeEditableHtml`.
- All state changes live in `children` via `updateParagraphChild`.

### LLM and backend notes
- Update `docs/llm-document-json.md` later to describe new child types so LLMs can emit valid JSON.
- For Citations, optional later integration with CSL/citeproc and external metadata (DOI/arXiv lookup).

---

## File scaffolding (per inline)
- Component: `src/components/editor/blocks/ParagraphBlock/Inlines/<Name>Inline/<Name>Inline.tsx`
- Styles: `src/components/editor/blocks/ParagraphBlock/Inlines/<Name>Inline/<Name>Inline.css`
- Index: export from `src/components/editor/blocks/ParagraphBlock/Inlines/index.ts`
- Slash item: `src/components/editor/SlashMenu/items/<name>.ts`

## QA checklist (per inline)
- __Insert__: via slash menu at different caret positions (start/middle/end; after punctuation).
- __Edit__: update state; verify JSON `children` updates and HTML stays sanitized.
- __Remove__: from middle of text and paragraph boundaries; ensure placeholder is deleted and JSON child removed.
- __Keyboard__: `/` opens menu outside inlines; Enter/Esc/Tabs behave; Backspace on empty block still deletes block.
- __Columns__: render correctly with `columns` 1–6.
- __Persistence__: reload from local storage; remote create/save unaffected.

## Milestones
- __M0__: Types and skeleton components + slash items (no external libs). [1–2 days]
- __M1__: EquationInline (plaintext render, toggle editor). [0.5–1 day]
- __M2__: CitationInline (basic numeric labels, manual keys). [1–2 days]
- __M3__: FootnoteInline (auto numbering, popover). [1 day]
- __M4__: CrossRefInline (target picker, basic labels). [1–2 days]
- __M5__: VariableInline (simple doc-wide sync). [1 day]
- Later: integrate KaTeX and CSL for polish.

## Open questions
- Global citation style: document-level option or per-citation override? Where to store (doc meta vs provider state)?
- Cross-referencing headings: use hierarchical numbering (2.3) vs simple order?
- Variable synchronization source of truth: doc meta map or first occurrence?
- Accessibility details for popovers (roving tabindex vs focus trap)?

## Non-goals (for now)
- Block-level display equations (separate component/out of scope here).
- Full bibliography management UI (library import, CSL processor).
- Export to LaTeX/PDF; this doc only covers editor-side JSON and UI.
