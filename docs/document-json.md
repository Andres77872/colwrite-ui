# Document JSON and Block Structure

This doc explains the document JSON format used by the editor, how blocks and inline children are represented, and how to create/edit/persist documents.

It references the following source files for ground truth:

- `src/editor/types.ts`
- `src/editor/EditorContext.tsx`
- `src/components/common/Editable/Editable.tsx`
- `src/components/editor/SlashMenu/items/aiBeat.ts`
- `src/components/editor/SlashMenu/items/table.ts`
- `src/components/editor/SlashMenu/items/citation.ts`
- `src/components/editor/SlashMenu/items/equation.ts`
- `src/components/editor/SlashMenu/items/graph.ts`
- `src/components/editor/SlashMenu/SlashMenu.tsx`
- `src/components/editor/FloatingToolbar/FloatingToolbar.tsx`
- `src/components/editor/blocks/ParagraphBlock/ParagraphBlock.tsx`
- `src/components/editor/blocks/ParagraphBlock/Inlines/AiBeatInline/AiBeatInline.tsx`
- `src/components/editor/blocks/ParagraphBlock/Inlines/TableInline/TableInline.tsx`
- `src/components/editor/blocks/ParagraphBlock/Inlines/CitationInline/CitationInline.tsx`
- `src/components/editor/blocks/ParagraphBlock/Inlines/EquationInline/EquationInline.tsx`
- `src/components/editor/blocks/ParagraphBlock/Inlines/GraphInline/GraphInline.tsx`
- `src/components/editor/BlockControls/BlockControls.tsx`
- `src/components/editor/DocumentChrome/DocumentHeader.tsx`
- `src/services/documents.ts`
- `src/components/panels/JsonPanel/JsonPanel.tsx`
- `src/editor/storage.ts`
- `src/components/editor/DocumentsMenu/DocumentsMenu.tsx`
- `src/components/editor/ChatAssistant/ChatAssistant.tsx`


## Overview

- A document (`Doc`) is a versioned object with an ordered list of blocks and an optional name.
- Blocks are one of: paragraph, heading, divider. All blocks can carry optional metadata flags.
- Paragraph blocks may contain inline children referenced via placeholders inside the block's HTML.
- The editor keeps HTML and child JSON in sync via placeholder elements with `data-child-id`.

### Status (inline children)

- Implemented UI and slash items: `aiBeat`, `table`, `citation`, `equation`, `graph`.
- Only implemented types are mounted in `src/components/editor/blocks/ParagraphBlock/ParagraphBlock.tsx`.


## Doc schema

Defined in `src/editor/types.ts`:

```ts
export type Doc = { version: number; blocks: Block[]; name?: string };
```

- `version`: integer. Current default is `1`.
- `blocks`: ordered array of blocks (see below).
- `name` (optional): document title. When using the backend API, this may also be mirrored as `title` (see services section).


## Block types and metadata

Common optional metadata for any block (in `src/editor/types.ts`):

```ts
type BlockMeta = {
  aiHidden?: boolean;  // hide this block from AI assistant
  locked?: boolean;    // assistant should not modify this block
  collapsed?: boolean; // collapse this block in the editor UI
};
```

Block variants:

```ts
export type ParagraphBlock = { id: string; type: 'paragraph'; html: string; children?: ParagraphChild[]; columns?: number } & BlockMeta;
export type HeadingBlock   = { id: string; type: 'heading'; level: 1 | 2 | 3; html: string } & BlockMeta;
export type DividerBlock   = { id: string; type: 'divider' } & BlockMeta;
export type Block          = ParagraphBlock | HeadingBlock | DividerBlock;
```

- `ParagraphBlock`:
  - `html`: serialized HTML string of the paragraph content. Inline children are represented by placeholders (see below).
  - `children` (optional): array of inline children used by placeholders in `html`.
  - `columns` (optional): integer 1..6 to render the paragraph in multiple columns in the editor UI.
- `HeadingBlock`:
  - `level`: 1 | 2 | 3.
  - `html`: serialized HTML for the heading text.
- `DividerBlock`: visual separator, no content fields.
- Metadata flags (`aiHidden`, `locked`, `collapsed`) can be toggled via UI (see `BlockControls`) and saved in JSON.


## Paragraph inline children and placeholders

Children type union (in `src/editor/types.ts`):

```ts
export type AiBeatChild = {
  id: string;
  type: 'aiBeat';
  message: string;
  prompt: string;
  output: string;
  collapsed?: boolean;
};

export type TableAlign = 'left' | 'center' | 'right';

export type TableChild = {
  id: string;
  type: 'table';
  rows: number;
  cols: number;
  data: string[][]; // rows x cols
  header?: boolean; // first row as header
  /** Per-column alignment; a missing entry means left. */
  align?: TableAlign[];
  /** Figure caption rendered under the table. */
  caption?: string;
};

/** Enough about a source to render a citation as something other than a key. */
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
  // …plus optional provider metrics (citationCount, isOpenAccess, …)
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

export type EquationChild = {
  id: string;
  type: 'equation';
  latex: string;               // LaTeX math without $ delimiters
  display?: boolean;           // render on its own centred line
  numbered?: boolean;          // display equations only
  labelId?: string;            // optional anchor for cross-references
};

export type GraphChild = {
  id: string;
  type: 'graph';
  kind: 'bar' | 'line' | 'area' | 'pie';
  data: {
    values: number[];
    labels?: string[];
    colors?: string[];
  };
  title?: string;
  caption?: string;
  xLabel?: string;
  yLabel?: string;
};

export type ParagraphChild = AiBeatChild | TableChild | CitationChild | EquationChild | GraphChild;
```

Representation in HTML (placeholders):

- Inline children are not inlined into the `html` string. Instead, `html` contains empty placeholders:
  - `<span data-child-id="<child-id>" contenteditable="false"></span>`
- The actual child state (e.g., AI Beat message/prompt/output, table grid data, citation metadata, equation fields) lives in the `children` array of the paragraph block.
- The renderer (`ParagraphBlock.tsx`) detects placeholders in the editable DOM and uses React portals to mount the corresponding inline component (`AiBeatInline`, `TableInline`, `CitationInline`, `EquationInline`, or `GraphInline`) in place.

Serialization of editable HTML:

- `serializeEditableHtml(root: HTMLDivElement): string` in `src/components/common/Editable/Editable.tsx` clones the DOM, clears any rendered child internals inside elements with `data-child-id`, marks them `contenteditable=false`, and returns `innerHTML`.
- This ensures JSON `html` only stores sanitized content and child placeholders (not rendered child DOM).

Insertion of children via slash menu:

- AI Beat: `src/components/editor/SlashMenu/items/aiBeat.ts`
- Table: `src/components/editor/SlashMenu/items/table.ts`
- Citation: `src/components/editor/SlashMenu/items/citation.ts`
- Equation: `src/components/editor/SlashMenu/items/equation.ts`
- Graph: `src/components/editor/SlashMenu/items/graph.ts`

Pending (planned, not yet implemented):
- Footnote: planned `src/components/editor/SlashMenu/items/footnote.ts`
- Var: planned `src/components/editor/SlashMenu/items/var.ts`
- XRef: planned `src/components/editor/SlashMenu/items/xref.ts`

All items:
- Insert a `<span data-child-id="..." contenteditable="false"></span>` at the caret.
- Call `updateHtml(blockId, serializeEditableHtml(editable))` to persist sanitized HTML.
- Append the child object to the paragraph block via `addParagraphChild(...)` with the same `id`.

Removal of children:

- All inline components (AI Beat, Table, Citation, Equation, Graph) implement a remove button that:
  - Deletes the placeholder DOM node.
  - Calls `removeParagraphChild(blockId, child.id)` to drop JSON state.
  - Persists updated HTML via `serializeEditableHtml`.

- AI Beat "Accept" action: accepting generated output inserts plain text into the paragraph immediately after the widget's placeholder and persists HTML, but it does not remove the inline widget itself (see `src/components/editor/blocks/ParagraphBlock/Inlines/AiBeatInline/AiBeatInline.tsx`). Use the widget's Remove (×) button to delete it from JSON and the DOM.


## Slash menu behavior and events

- Entry points and exports (in `src/components/editor/SlashMenu/SlashMenu.tsx`):
  - `openSlashMenu(blockId: string)`: opens the menu at the current caret for the given paragraph `blockId`.
  - `isSlashMenuOpen(): boolean`: synchronous visibility flag other components can check (e.g., to suppress blur side effects).
  - `SLASH_MENU_EVENT` (`'colwrite:open-slash-menu'`): CustomEvent used internally by `openSlashMenu` to trigger the menu.
  - `SLASH_MENU_VISIBILITY_EVENT` (`'colwrite:slash-menu-visibility'`): broadcast when menu visibility changes so floating UI can react.

- Keyboard/focus semantics:
  - Typing `/` inside an editable paragraph opens the menu (`Editable` calls `openSlashMenu(id)` and prevents inserting `/`).
  - While open, keystrokes are handled globally: text filters the list, `Backspace` edits the query, `ArrowUp/Down` navigate, `Enter` selects, `Escape` closes.
  - The menu keeps focus on the editable (uses `onMouseDown(e.preventDefault())`), so the caret remains stable; document-level key handlers capture navigation.
  - Clicking outside, scrolling, or resizing closes the menu.

- Interop with other UI:
  - `Editable.onBlur` checks `isSlashMenuOpen()` to avoid clearing the active block when the menu is visible.
  - `FloatingToolbar` listens to `SLASH_MENU_VISIBILITY_EVENT` and hides while the slash menu is open to prevent flicker.


## Creating and editing documents

Creation flow (in `src/editor/EditorContext.tsx`):

- Default document (`makeDefaultDoc`):
  - version: 1
  - blocks: a level-2 heading and one empty paragraph (`columns: 1`), with `children: []`.
- On first run, state initializes from `loadDoc()` (localStorage) or falls back to `makeDefaultDoc()`.

Working with blocks (via `useEditor()` in `EditorContext`):

- `addBlockAtStart(type)` / `addBlockAfter(afterId, type)` create a new block with generated `id` and default fields.
- `moveBlock(id, dir)` and `reorderBlock(id, toIndex)` change order.
- `removeBlock(id)` deletes a block.
- `updateHtml(id, html)` replaces a block's HTML.
- `setParagraphColumns(id, columns)` clamps to 1..6.
- `setHeadingLevel(id, level)` for headings.
- Metadata toggles: `toggleAiHidden(id)`, `toggleLocked(id)`, `toggleCollapsed(id)`.

Working with inline children:

- `addParagraphChild(blockId, child)` appends to a paragraph's `children` if not already present.
- `updateParagraphChild(blockId, childId, next)` shallow-merges updates.
- `removeParagraphChild(blockId, childId)` removes by id.

Editing in the canvas:

- The editable block surface is `Editable` (`src/components/common/Editable/Editable.tsx`). Key behaviors:
  - On input, it calls `serializeEditableHtml` before persisting with `updateHtml`.
  - Slash menu opens on `/` (unless focus is inside an inline widget). `openSlashMenu(id)` inserts children.
  - `Ctrl+Enter` inserts a new paragraph after the current block.
  - Backspace on a truly empty block deletes the block.

AI suggestions vs. inline children:

- The floating toolbar (`src/components/editor/FloatingToolbar/FloatingToolbar.tsx`) can wrap a selection with an ephemeral `ai-suggest` UI for streaming suggestions. This is not a formal child type.
- Accept/Reject removes the wrapper and commits the chosen content back into the block HTML.
- Only placeholders with `data-child-id` and corresponding entries in a paragraph's `children` array are part of the formal JSON schema for inline widgets.

Migration note:

- On mount, the provider runs a one-time migration that converts legacy inline `.ai-beat-widget` markup embedded directly in paragraph HTML into proper placeholders with a matching `children` entry (see the migration `useEffect` in `EditorContext.tsx`).


## Persistence: local and remote

Local storage (`src/editor/storage.ts`):

- `saveDoc(doc)` and `loadDoc()` persist/load from `localStorage` under key `colwrite:doc`.
- Current document ID is stored under `colwrite:docId`.
- The provider auto-saves to `localStorage` on any doc change (via `requestAnimationFrame`) and persists the current `documentId` using `saveDocumentId(...)`.

Remote API (`src/services/documents.ts`):

- `createDocument(docOrBlocks)`: POST `/document/create` with `{ document: <object> }` and returns `{ document_id }`.
- `saveDocument(id, docOrBlocks)`: PUT `/document/save/:id` with `{ document: <object> }`.
- `loadDocument(id)`: GET `/document/load/:id` -> returns `{ document: unknown }` which is normalized into a `Doc`.
- `listDocuments(page, limit, query?)`: POST `/document/list`.
- `deleteDocument(id)`: DELETE `/document/delete/:id`.

Backend payload mapping helpers:

- `toBackendDocument(input)` accepts a `Doc`, a `Block[]`, or a partial doc. It ensures a shape like `{ version, blocks, ...rest }` and mirrors `name` to `title` when available.
- `toEditorDoc(payload)` accepts either an object with `blocks` or a bare array of blocks, normalizes to a `Doc`, and maps `title` (or `name`) onto `name`.

UI integrations:

- `DocumentHeader` (`src/components/editor/DocumentChrome/DocumentHeader.tsx`):
  - Rename: on blur/Enter it normalizes the title and immediately calls `saveRemote(override)` so the latest name is persisted. Shows the current `documentId`.
  - Save: `Save` button calls `saveRemote()` which creates the remote document if needed and updates `lastSavedAt`.
  - Delete: calls `deleteRemote(documentId)` and then `newLocal()` to reset to a fresh local doc; `New` also calls `newLocal()`.
  - Displays last save time using `lastSavedAt`.
- `DocumentsMenu` (`src/components/editor/DocumentsMenu/DocumentsMenu.tsx`):
  - Lists documents via `listRemote(page, limit, query)` with a 350ms debounced search and paging controls.
  - `New` creates an empty remote document with `createRemote({ name: 'New document', blocks: [] })` and refreshes the list.
  - Clicking an item loads it via `loadRemote(id)`; Delete confirms and calls `deleteRemote(id)` then refreshes/paginates.
- `ChatAssistant` (`src/components/editor/ChatAssistant/ChatAssistant.tsx`): ensures a `documentId` exists by calling `createRemote()` when missing before starting a streaming chat; it does not save editor content.
- `FloatingToolbar` (`src/components/editor/FloatingToolbar/FloatingToolbar.tsx`): does not call remote persistence; it listens to `SLASH_MENU_VISIBILITY_EVENT` to hide while the slash menu is open and provides ephemeral AI suggestions not encoded in JSON.
- `JsonPanel` (`src/components/panels/JsonPanel/JsonPanel.tsx`): inspect/apply raw JSON via `getJSON()` and `setFromJSON()`, and invoke API methods for testing.


## Examples

Minimal empty document:

```json
{
  "version": 1,
  "name": "Untitled document",
  "blocks": []
}
```

Paragraph with an Equation child:

```json
{
  "id": "p4",
  "type": "paragraph",
  "html": "Einstein proposed <span data-child-id=\"e1\" contenteditable=\"false\"></span> in his work.",
  "children": [
    { "id": "e1", "type": "equation", "latex": "E=mc^2", "numbered": false, "labelId": "" }
  ]
}
```

Paragraph with a Citation child:

```json
{
  "id": "p5",
  "type": "paragraph",
  "html": "See <span data-child-id=\"c1\" contenteditable=\"false\"></span> for details.",
  "children": [
    { "id": "c1", "type": "citation", "keys": ["doe2021"], "style": "numeric", "prefix": "see", "suffix": "ch. 2" }
  ]
}
```

Heading + paragraph with a table child (placeholders + children):

```json
{
  "version": 1,
  "name": "Report",
  "blocks": [
    { "id": "h1", "type": "heading", "level": 2, "html": "Quarterly Report" },
    {
      "id": "p1",
      "type": "paragraph",
      "html": "Summary: <span data-child-id=\"t1\" contenteditable=\"false\"></span>",
      "columns": 1,
      "children": [
        {
          "id": "t1",
          "type": "table",
          "rows": 2,
          "cols": 3,
          "data": [["H1","H2","H3"],["A","B","C"]],
          "header": true
        }
      ]
    }
  ]
}
```

Paragraph with an AI Beat child:

```json
{
  "id": "p2",
  "type": "paragraph",
  "html": "Ideas: <span data-child-id=\"a1\" contenteditable=\"false\"></span>",
  "children": [
    {
      "id": "a1",
      "type": "aiBeat",
      "message": "List product ideas for Q4",
      "prompt": "You are a helpful assistant",
      "output": "- Idea 1...",
      "collapsed": false
    }
  ]
}
```

Paragraph with a Graph child:

```json
{
  "id": "p6",
  "type": "paragraph",
  "html": "Trend: <span data-child-id=\"g1\" contenteditable=\"false\"></span> shows improvement.",
  "children": [
    {
      "id": "g1",
      "type": "graph",
      "kind": "line",
      "data": { "values": [1, 3, 2, 5], "labels": ["Q1", "Q2", "Q3", "Q4"] },
      "title": "Quarterly"
    }
  ]
}
```

Block metadata usage:

```json
{
  "id": "p3",
  "type": "paragraph",
  "html": "Locked content",
  "aiHidden": false,
  "locked": true,
  "collapsed": false
}
```


## Best practices

- Always persist paragraph HTML using `serializeEditableHtml(...)` to avoid embedding rendered child internals into `html`.
- When inserting inline children programmatically, ensure you:
  - Insert a `<span data-child-id="..." contenteditable="false"></span>` at the intended position in HTML.
  - Add a matching entry to the paragraph `children` array with the same `id` and correct type payload.
- Clamp paragraph `columns` between 1 and 6 (`setParagraphColumns` already enforces this).
- Use `getJSON()` / `setFromJSON()` to inspect/apply document JSON in the editor safely.
- Treat the floating toolbar's `ai-suggest` wrapper as temporary UI; it is not part of the formal JSON schema. Accept or reject suggestions to commit clean HTML.
- Use metadata flags (`aiHidden`, `locked`, `collapsed`) to control AI and UI behavior. The backend should enforce AI-related flags.
- If migrating legacy documents that embedded `.ai-beat-widget` markup inside paragraph HTML, the provider will convert them into placeholders and child entries automatically on first load.


## Creating a new document JSON manually

- Minimal shape you must provide: `{ version: 1, blocks: [] }` (name optional).
- A new document created in UI uses `makeDefaultDoc()` (see `EditorContext.tsx`) which initializes a heading and a paragraph:

```json
{
  "version": 1,
  "name": "Untitled document",
  "blocks": [
    { "id": "<uid>", "type": "heading", "level": 2, "html": "Your document" },
    { "id": "<uid>", "type": "paragraph", "html": "Write something here. Select text to format. Use the + to insert blocks.", "columns": 1, "children": [] }
  ]
}
```

You can paste this JSON into the `JsonPanel` to load it via `setFromJSON()` and start editing.
