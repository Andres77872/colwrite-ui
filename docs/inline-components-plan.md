# Inline Components: Development Plan and Requirements

This plan proposes new inline components for scientific writing (arXiv-style) and describes how to integrate them into the existing editor architecture.

Ground-truth code references:
- `src/components/editor/blocks/ParagraphBlock/ParagraphBlock.tsx`
- `src/components/common/Editable/Editable.tsx`
- `src/editor/types.ts`
- `src/components/editor/blocks/ParagraphBlock/Inlines/AiBeatInline/AiBeatInline.tsx`
- `src/components/editor/blocks/ParagraphBlock/Inlines/TableInline/TableInline.tsx`
- `src/components/editor/SlashMenu/items/*`

## Current implementation status

- Implemented: `AiBeatInline`, `TableInline`, `CitationInline`, `EquationInline`, `GraphInline`
- Pending (planned): `FootnoteInline`, `XRefInline`, `VarInline`

## Architectural principles (current)
- __Placeholders__: Paragraph `html` contains empty placeholders `<span data-child-id="ID" contenteditable="false"></span>`; actual state lives in `ParagraphBlock.children`.
- __Portals__: `ParagraphBlock.tsx` queries placeholders and mounts React inline components with `createPortal` into each matching span, dispatched through the `INLINE_WIDGETS` registry (one entry per child type).
- __Serialization__: `serializeEditableHtml(...)` cleans rendered internals inside `data-child-id` elements and persists only sanitized HTML.
- __Insert/remove__: Slash menu items insert placeholders and call `addParagraphChild(...)` (via `insertInlineChild`). Inline UIs remove themselves by deleting the placeholder, calling `removeParagraphChild(...)`, and persisting updated HTML (via the shared `useInlineChild` hook).
- __Editing__: `Editable.tsx` treats any `[data-child-id]` descendant as widget territory: `/`, Backspace and Enter there are the widget's business, not the paragraph's. Widget roots spread the shared `stopEditorEvents`.
- __Shared chrome__ (`Inlines/shared/InlineShell.tsx`): one visual language — `InlinePill` (in-flow triggers, primary tint, destructive for errors), `InlineFigureShell` (block widgets: table, figure), `InlinePopover` (all editing panels), `SettingsRow` / `SettingsCheck` / `SettingsFooter`, built on the app's `Input` / `Textarea` / `Checkbox` primitives.

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
  sources?: CitationSource[]; // resolved title/authors/year/venue/url per key
};
```
- __UI/UX__:
  - Renders as a small pill, e.g., `[1]` (numeric) or `(Smith, 2020)`. Numbering counts citations across the whole document, computed at render time.
  - Click opens a popover: arXiv search/attach/detach sources, paste-a-key, style control with apply-to-all, prefix/locator/suffix.
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

### 2) EquationInline (inline and display math)
- __Purpose__: LaTeX math, both inline within sentences and display on its own centred line (implemented as `display?: boolean`, with optional document-wide numbering).
- __JSON shape__:
```ts
export type EquationChild = {
  id: string;
  type: 'equation';
  latex: string;            // LaTeX math content without $ delimiters
  display?: boolean;        // own centred line rather than the run of text
  numbered?: boolean;       // display equations only
  labelId?: string;         // optional anchor for cross-referencing
};
```
- __UI/UX__:
  - Renders via KaTeX (CDN global wrapped by `src/lib/katex.ts`), with monospace source fallback while it loads and a destructive tone on render errors.
  - Click opens the editor popover; Enter finishes, Shift+Enter adds a line; Esc closes.
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
- The portal dispatch is a registry, `INLINE_WIDGETS: Record<ParagraphChild['type'], ComponentType<AiBeatWidgetProps>>` — adding a widget is one entry, not a new branch:
  - `aiBeat` → `AiBeatInline`, `table` → `TableInline`, `citation` → `CitationInline`, `equation` → `EquationInline`, `graph` → `GraphInline`
  - `footnote` → `FootnoteInline`, `xref` → `<XRefInline />`, `var` → `<VarInline />` (planned)
- Every widget receives the same six props (`blockId`, `child`, `updateParagraphChild`, `removeParagraphChild`, `updateHtml`, `refs`); AI Beat's two extras (`documentId`, `createRemote`) ride along in `AiBeatWidgetProps` and are ignored by the others.
- Widget roots set `contentEditable={false}`, spread `stopEditorEvents`, and carry `role="group"` + `aria-label`.

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
- In-flow widgets render as the shared `InlinePill` — one primary-tinted treatment for every text-level construct; the destructive tone is reserved for errors (e.g. a citation with no source, unrenderable LaTeX). Borrowing chart-series or block-state colours for pills was an explicit anti-pattern.
- Block widgets render in the shared `InlineFigureShell`: bordered card, controls that surface on hover/focus, optional caption strip.
- All editing happens in the shared `InlinePopover` (Radix — portals out of the paragraph, so panels are never clipped by scrolling wrappers) with `SettingsRow` / `SettingsCheck` fields and one `SettingsFooter` (Remove / Done).
- Fields use the app's `Input` / `Textarea` / `Checkbox` primitives; per-widget CSS files are gone — styling is Tailwind against the theme tokens.
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
- Registry entry in `INLINE_WIDGETS` (`ParagraphBlock.tsx`) + barrel export from `Inlines/index.ts`
- Shared chrome from `Inlines/shared/` (no per-widget CSS files — Tailwind + theme tokens)
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
- Global citation style: document-level option or per-citation override? Where to store (doc meta vs provider state)? (Mitigated for now by the "apply to all citations" affordance in the citation popover.)
- Cross-referencing headings: use hierarchical numbering (2.3) vs simple order?
- Variable synchronization source of truth: doc meta map or first occurrence?
- ~~Accessibility details for popovers (roving tabindex vs focus trap)?~~ Resolved: Radix Popover (non-modal, Esc to close, focus stays with the trigger region) via the shared `InlinePopover`.

## Non-goals (for now)
- Full bibliography management UI (library import, CSL processor).
- Export to LaTeX/PDF; this doc only covers editor-side JSON and UI.
