# Document JSON and block structure

> **Secondary copy** of `ColWrite-api/docs/document-json.md`, taken on
> 2026-11-16, with its links pointed at the API repository. The API's copy and
> the shared fixture corpus in `ColWrite-api/tests/fixtures/document_contract/`
> are authoritative: where this copy differs, the API's is right. In this
> repository the shape is `src/editor/types.ts`, and the one conversion between
> the wire content and the editor's `Doc` is `toEditorDoc` / `toWireContent`
> (`src/api/content.ts`).

This document is the self-contained contract for the editor document JSON used
by ColWrite clients and agent tools. It describes the persisted shape and API
behavior without depending on a particular frontend repository layout.

## Overview

- Canonical persisted content is a schema-versioned object with a name, tags,
  and an ordered block list. Concurrency metadata is outside that object.
- Blocks are one of: paragraph, heading, divider, code, image. All blocks can carry optional metadata flags.
- Paragraph blocks may contain inline children referenced via placeholders inside the block's HTML.
- The editor keeps HTML and child JSON in sync via placeholder elements with `data-child-id`.

### Validation boundaries

- Create and replace input is strict canonical `DocumentContent`. It requires
  `schema_version: 1`, rejects unknown fields, and validates every block and
  child before the application service writes. Name constraints are a known
  cross-layer exception described below.
- Agent `doc_create` and every `doc_edit` change set also pass through
  canonical validation. A change set is one atomic batch, in Auto mode too: an
  invalid operation rejects the whole call and stores nothing.
- The 12 MiB canonical JSON cap is not a safe Mongo persistence limit. Heads
  add derived query fields such as `content_plain`; semantic revisions store a
  snapshot plus operations. A much smaller domain-valid
  payload can exceed MongoDB's 16 MiB BSON document ceiling. No artifact-level
  BSON preflight exists yet (DA-032), so clients must not treat acceptance near
  the domain cap as a guarantee that the mutation can commit.
- New blocks created by agent tools omit `id`; the server generates one.
  Existing blocks are addressed by their immutable persisted ID. Inline child
  IDs remain part of the child object and its matching placeholder.

### Status (inline children)

- Supported child types are `aiBeat`, `table`, `citation`, `equation`, and
  `graph`.
- Other child types are not part of the current persisted contract.

## Canonical content

```ts
export type DocumentContentV1 = {
  schema_version: 1;
  name?: string;
  tags?: string[];
  blocks?: Block[];
  instructions?: string | null; // author's page steering, at most 4,000 characters
  documentType?: 'research-paper' | 'literature-review' | 'systematic-review' | 'technical-report' | 'white-paper' | null;
};
```

- `schema_version` identifies the content format. It is required and exactly
  integer `1` on input and in stored content; content without it is
  rejected.
- `name` defaults to `Untitled page` (`DEFAULT_DOCUMENT_NAME` in
  `src/documents/domain/models.py`). Validation, the page list and the LaTeX
  export all use that one name. Until DA-002
  is fixed, clients must send 1–255 characters with at least one non-whitespace
  character and no surrounding whitespace. The domain model incorrectly
  accepts blank/whitespace-only and up to 1,000 characters; blank normalized
  names fail the strict Mongo head validator, and values above 255 or differing
  only by trimming cannot project faithfully to MySQL.
- `tags` defaults to an empty list and must contain unique, trimmed strings.
- `blocks` defaults to an empty ordered list (see below).
- Concurrency is the page's strong ETag, outside the content; there is no
  integer version field.

The write envelope is:

```json
{
  "content": {
    "schema_version": 1,
    "name": "Draft",
    "tags": [],
    "blocks": []
  }
}
```

`DocumentWriteRequest` also exposes optional `summary`. On PUT it annotates the
revision. On POST create the route currently accepts but ignores it, so omit it
until DA-009 in the
document deployment-readiness audit (`ColWrite-api/docs/doc_architecture/14-canonical-architecture-and-gap-audit.md`)
is closed.

Stored MongoDB heads also carry server-managed head and revision identifiers
and derived query fields (`name`, `name_sort`, `tags`, `content_plain`). Those
persistence fields are not client content. See the versioned API (`ColWrite-api/docs/document-history-api.md#document-state`) for the
response envelope.

## Block types and metadata

Common optional metadata for any block:

```ts
type BlockMeta = {
  aiHidden?: boolean;  // hide this block from AI assistant
  locked?: boolean;    // assistant should not modify this block
  collapsed?: boolean; // collapse this block in the editor UI
};
```

Block variants:

```ts
export type ParagraphBlock = {
  id: string; type: 'paragraph'; html?: string; children?: ParagraphChild[]; columns?: number;
  variant?: 'bullet' | 'numbered' | 'todo' | 'quote' | 'callout'; // absent = body text
  checked?: boolean;  // only with variant 'todo'
  indent?: number;    // 0..4, list nesting depth
} & BlockMeta;
export type HeadingBlock   = { id: string; type: 'heading'; level?: 1 | 2 | 3; html?: string; instructions?: string | null } & BlockMeta;
export type DividerBlock   = { id: string; type: 'divider' } & BlockMeta;
export type CodeBlock      = { id: string; type: 'code'; text?: string; language?: string } & BlockMeta;
export type ImageBlock = {
  id: string; type: 'image'; assetId: string; alt: string; caption?: string;
  width?: number; label?: string;
  origin: { kind: 'upload' } | { kind: 'generated'; generationId: string };
} & BlockMeta;
export type Block = ParagraphBlock | HeadingBlock | DividerBlock | CodeBlock | ImageBlock;
```

- `ParagraphBlock`:
  - `html` (optional, default `""`): serialized HTML string of the paragraph content. Inline children are represented by placeholders (see below).
  - `children` (optional, default `[]`): array of inline children used by placeholders in `html`.
  - `columns` (optional, default `1`): integer 1..6 to render the paragraph in multiple columns in the editor UI.
  - `variant` (optional): the paragraph's *role*. Absent is body text.
    `bullet` / `numbered` / `todo` are list items — **one block per item**,
    nested with `indent` (0–4); numbers are derived from runs of consecutive
    `numbered` items at one depth and never stored. `quote` is a block
    quotation and `callout` a highlighted note. Roles keep the paragraph's
    html/children machinery, so a list item or quote can hold citations and
    equations.
  - `checked` (optional): to-do state; rejected on any variant but `todo`.
  - `indent` (optional): list nesting depth, 0–4.
  - All three default to absent (`None`) and are omitted from canonical JSON,
    so documents written before them keep their content hashes.
- `HeadingBlock`:
  - `level` (optional, default `2`): 1 | 2 | 3.
  - `html` (optional, default `""`): serialized HTML for the heading text.
- `DividerBlock`: visual separator, no content fields.
- `CodeBlock`: preformatted text — code, pseudocode, program output.
  - `text` (optional, default `""`): plain text, never html; whitespace is
    significant and nothing in it is markup.
  - `language` (optional): a short identifier (`python`, `c++`, `latex`, …)
    matching `[A-Za-z0-9][A-Za-z0-9+#._-]{0,39}`.
  - A diagram is a code block with `language: "mermaid"` and Mermaid source
    as its `text`: no separate block type. The UI draws it (strict security
    level, themed from design tokens) and writes a `mermaid` fence in
    Markdown; the LaTeX export prints it as ordinary code.
  - A structured figure (an architecture, a mechanism, a multi-panel figure)
    is a code block with `language: "figure"` whose `text` is a JSON spec:
    nodes, groups, edges and a caption, with no coordinates. The UI lays it
    out and draws it and writes a `figure` fence in Markdown; the API stores
    the text unchanged and the LaTeX export prints it as ordinary code. The
    spec language is documented in colwrite-ui `docs/figures.md`. `text` is
    always a string, in agent tools too (see
    [llm-document-json.md](llm-document-json.md#block-rules)).
- `ImageBlock` names a validated `ast-{uuid4}` asset in this workspace, never a
  URL or embedded bytes. Required non-blank `alt` (up to 4,000 characters),
  optional plain-text `caption` (10,000), finite `width` from 0.2 to 1
  (default 1) and an export-safe `label`. The API derives `origin` from the
  asset row before hashing each content/operation write. Captioned images
  share the structured-figure numbering. See the API's `docs/assets.md`.
- Each block owns exactly its type's fields; any other field is refused. A
  block's type changes only by writing it whole (`write_blocks` with
  `position: "replace"`).

Export: consecutive list items become one `itemize`/`enumerate` (html
`<ul>`/`<ol>`) nested by `indent`, to-dos render ☐/☒ markers, quotes and
callouts render as quotations, and code as monospace with its indentation.

### Author assistant instructions

`instructions` is the author's standing page steering (4,000 characters at
most); a heading's `instructions` is limited to 2,000 characters and applies
through its subsections until the next same-or-higher-level heading. A hidden
heading's instructions are not sent. Inline runs receive only instructions
for their visible target and ancestor sections; chat runs can work across the
page and receive its section instructions. The prompt attributes these to the
author as private steering, never as extra permission.

`documentType` preloads the corresponding eligible writing skill before the
first model call. These fields are part of canonical content, so versioning,
copy and JSON/workspace exports retain them. Prose exports do not print this
private steering. Assistant edits cannot replace a heading's instructions;
the author changes them through an ordinary whole-page save. The `instructions`
event and reply record identify their scopes, without copying instruction text.

### Document-level source library

```ts
type DocumentContent = {
  // …name, tags, blocks…
  sources?: CitationSource[];                          // the library
  citationStyle?: 'numeric' | 'author-year' | 'ieee';  // the document's style
};
```

`sources` holds every work the document cites or keeps for later, one entry
per key (duplicate keys are rejected). Citations still reference works by
`keys`; when a library entry exists for a key, its metadata takes precedence
over the copy a citation carries — in the editor, the HTML export and the
LaTeX export — so a correction is made once. `citationStyle`, when set,
overrides every citation's own `style`. Both are optional and omitted from
canonical JSON when absent; a read includes them only when present. See the citations guide (`ColWrite-api/docs/citations.md`).
- Metadata flags (`aiHidden`, `locked`, `collapsed`) are persisted in JSON and
  control editor and agent behavior.

## Paragraph inline children and placeholders

Children type union:

```ts
export type AssistantOutput = {
  text: string; // Markdown with durable [@key] citations
  sources: ReferenceRecord[]; // complete records, unique by key, at most 100
};

export type AiBeatChild = {
  id: string;
  type: 'aiBeat';
  message?: string; // default ''
  prompt?: string;  // default ''
  output?: AssistantOutput | null; // null is an empty draft
  collapsed?: boolean;
};

export type TableChild = {
  id: string;
  type: 'table';
  rows?: number; // inferred from data when omitted
  cols?: number; // inferred from data when omitted
  data: string[][]; // rows x cols
  header?: boolean; // first row as header
  align?: Array<'left' | 'center' | 'right'>; // per-column; missing means left
  caption?: string;
};

export type CitationSource = {
  key: string;                       // must match one of the citation's keys
  title?: string;
  authors?: string;
  year?: string | number;
  venue?: string;
  url?: string;
  // Where the metadata came from. `manual` is typed and unverified; every
  // other value names the record it was copied from.
  provider?: 'arxiv' | 'semantic_scholar' | 'crossref' | 'manual' | 'web' | 'resource';
  providerId?: string;
  doi?: string;
  externalIds?: Record<string, string>;
  pdfUrl?: string;
  citationCount?: number;
  influentialCitationCount?: number;
  referenceCount?: number;
  isOpenAccess?: boolean;
  kind?: 'article' | 'preprint' | 'conference' | 'book' | 'chapter' | 'thesis'
    | 'report' | 'web' | 'dataset' | 'software' | 'other';
  accessed?: string;                 // ISO date a web page was read
};

export type CitationChild = {
  id: string;
  type: 'citation';
  keys: string[];                    // citation keys/DOIs/arXiv IDs
  style?: 'numeric' | 'author-year' | 'ieee';
  prefix?: string;                   // e.g., 'see', 'cf.'
  suffix?: string;                   // e.g., 'ch. 2', 'pp. 21–24'
  locator?: string;                  // page/section locator
  sources?: CitationSource[];        // resolved metadata for entries in keys
};

export type EquationChild = {
  id: string;
  type: 'equation';
  latex: string;               // LaTeX math without $ delimiters
  display?: boolean;           // render on a centered line instead of inline
  numbered?: boolean;          // applies only to display equations
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
- A conforming editor resolves each placeholder by matching its
  `data-child-id` to an object in `children`, then renders the appropriate
  inline widget at that position.
- Table alignment/captions, resolved citation sources, display-equation state,
  and graph titles/axes/captions are canonical child data. They are not
  reconstructable from the empty placeholder and must survive every
  persistence and export transform.

Serialization of editable HTML:

- Before persistence, clone or otherwise normalize the editable DOM, remove
  rendered widget internals from elements with `data-child-id`, keep those
  placeholders non-editable, and serialize the resulting HTML.
- Persisted `html` must contain sanitized content and child placeholders, not
  the rendered widget DOM.

Insertion of inline children:

- Current insertion choices are AI Beat, table, citation, equation, and graph.
- `footnote`, `var`, and `xref` are planned but unsupported and must not be
  persisted as current child types.

For every inserted child:
- Insert a `<span data-child-id="..." contenteditable="false"></span>` at the caret.
- Persist the paragraph's normalized HTML.
- Append a child object with the same `id` to the paragraph's `children` array.

Removal of children:

- All inline components (AI Beat, Table, Citation, Equation, Graph) implement a remove button that:
  - Deletes the placeholder DOM node.
  - Removes the matching child object from JSON.
  - Persists the normalized HTML.

- AI Beat "Accept" replaces the widget placeholder with its generated text,
  removes the matching child object, and persists the paragraph. An AI Beat
  object that remains in `children` is therefore unaccepted draft state.

## Slash menu behavior

- Typing `/` inside an editable paragraph opens the insertion menu at the
  current caret for that paragraph.
- The editor should expose menu visibility to other UI so blur handlers and
  floating controls do not conflict with insertion.

- Keyboard/focus semantics:
  - Opening the menu consumes `/` rather than inserting it into the paragraph.
  - While open, keystrokes are handled globally: text filters the list, `Backspace` edits the query, `ArrowUp/Down` navigate, `Enter` selects, `Escape` closes.
  - The menu keeps focus on the editable so the caret remains stable.
  - Clicking outside, scrolling, or resizing closes the menu.

- Interop with other UI:
  - Blur handling must not clear the active block while the menu is visible.
  - Floating controls should hide while the menu is open.

## Creating and editing documents

Canonical creation flow:

- A typical default document contains:
  - `schema_version: 1` in canonical content;
  - blocks: a level-2 heading and one empty paragraph (`columns: 1`), with `children: []`.
- A client may initialize from its saved local state and fall back to this
  default shape.

Working with blocks:

- New blocks require a unique generated `id` and type-appropriate defaults.
- Blocks can be inserted, reordered, updated, and removed by ID.
- Paragraph columns must be clamped to 1..6.
- Heading level must be 1, 2, or 3.
- Metadata flags may be toggled independently.

Working with inline children:

- Add a child only when its ID is not already present in the paragraph.
- Update child state by matching its ID.
- Removing a child must remove both its object and HTML placeholder.

Editing in the canvas:

- On input, normalize editable HTML before updating the block.
- The slash menu opens on `/` unless focus is inside an inline widget.
  - `Ctrl+Enter` inserts a new paragraph after the current block.
  - Backspace on a truly empty block deletes the block.

AI suggestions vs. inline children:

- A client may wrap a selection with an ephemeral `ai-suggest` UI while
  streaming a suggestion. This is not a formal child type.
- Accept/Reject removes the wrapper and commits the chosen content back into the block HTML.
- Only placeholders with `data-child-id` and corresponding entries in a paragraph's `children` array are part of the formal JSON schema for inline widgets.

## Persistence

Every page route is under `/workspaces/{workspace_id}/documents` and needs a
session and the caller's membership (`ColWrite-api/docs/workspaces.md`):

- Create: `POST /workspaces/{workspace_id}/documents` with
  `{"content": …}` and an `Idempotency-Key`; 201 with the first `ETag`.
- Read: `GET /workspaces/{workspace_id}/documents/{document_id}`; the
  response carries the `ETag`.
- Replace: `PUT …/{document_id}` with `{"content": …}`, `If-Match` and
  `Idempotency-Key`. A stale ETag is 412 `stale_head`.
- Patch: `PATCH …/{document_id}` with an operation batch, `If-Match` and
  `Idempotency-Key`.
- Export: `GET …/{document_id}/export?format=tex|pdf` downloads the current
  head as an attachment (`ColWrite-api/docs/document.md#latex-and-pdf-document-export`).
- List and search: `GET /workspaces/{workspace_id}/documents` with optional
  `query`, all-of `tags`, `collection_id` (`any`, `root` or a collection),
  `sort_by` (`updated_at`, `created_at`, `name` or `custom`), `sort_order`
  (`asc` or `desc`), `limit` and `cursor`. The default is `updated_at desc`
  over the whole workspace.
- Delete: `DELETE …/{document_id}` with `If-Match` and `Idempotency-Key`.
  A missing `If-Match` is 428; a stale one is 412 and removes nothing.

The list answers `{items, next_cursor}`. A summary is `id`, `name`,
`collection_id`, `sort_key`, `placement_etag`, `tags`, `created_at` and
`updated_at`. Searches keep the
requested sort; relevance never silently replaces it. Paging is
deterministic because `_id` is a same-direction tie-breaker. Arbitrary
metadata filters are refused. See
the versioned API (`ColWrite-api/docs/document-history-api.md`) for ETags, idempotency, history
and change sets.

## LaTeX and PDF export behavior

Export parses canonical content directly; it is not a browser print or a dump
of the persisted HTML. The renderer escapes document text, converts supported
formatting to LaTeX, and defensively revalidates malformed or unsupported
render-affecting fields instead of silently dropping visible content. Fields
that are explicitly non-rendered editor, assistant, or MongoDB metadata are
ignored and need not satisfy a second export-only schema. Current HTTP writers
already apply canonical validation, but that is not currently sufficient for
export: canonical HTML accepts `code`, `del`, `kbd`, `mark`, `s`, `small`, and
`strike`, while the LaTeX renderer rejects those tags with a generic 422.
Export also caps the complete generated UTF-8 LaTeX source at 2 MiB, far below
the canonical JSON cap. Until DA-033 is fixed, clients needing export must avoid
those tags and cannot assume every valid/persisted large document is
exportable.

Supported export mappings are:

- heading levels 1, 2, and 3 become section, subsection, and subsubsection;
- paragraphs preserve their order and support `columns` from 1 through 6;
  paragraphs containing tables, graphs, or display equations intentionally
  export at full page width so those components remain readable;
- dividers become horizontal rules;
- paragraph HTML supports `strong`/`b`, `em`/`i`, `u`, `sub`, `sup`, links,
  line breaks, paragraph/division boundaries, heading wrappers and neutral
  spans; only `http`, `https`, and `mailto` targets become active
  hyperlinks, while other schemes retain inert visible text;
- canonical tags `code`, `del`, `kbd`, `mark`, `s`, `small`, and `strike` are
  currently **not** exportable and cause the whole request to return 422;
- tables preserve their grid, header choice, alignment, and caption, wrap cell
  text, repeat headers across pages, and split tables wider than six columns
  into readable sections that repeat the first identifying column; tables
  without explicit `rows`/`cols` derive them from a non-empty rectangular
  `data` matrix;
- citations render an in-text marker plus authors, title, venue, year, DOI,
  and URL from resolved sources; unresolved keys receive a fallback entry,
  and integer provider years are normalized to text;
- equations preserve inline/display mode, optional numbering, and safe unique
  labels, but the `latex` field is restricted to math-safe commands; escaped
  math text specials such as `\%`, `\#`, and `\$` are accepted while their raw
  TeX-active forms are rejected;
- graphs support `bar`, `line`, `area`, and `pie`, including labels, colors,
  titles, and captions; Cartesian graphs render axis labels and their first
  supplied color as the single-series color, area fills close to the zero
  baseline, and pie values are proportional weights with colors per slice.
  Dense Cartesian graphs retain every point but show at most twelve evenly
  spaced x-axis labels. A pie with more than twelve slices exports as a bar
  chart, and extreme finite magnitudes are normalized with a visible note, to
  favor a legible artifact over browser-style fidelity.

An `aiBeat` child represents unaccepted draft state. Its `output` is one
self-contained value: Markdown `text` with durable `[@key]` citations and
complete reference `sources`. A string output is invalid. Before storing a
run's reply, the client resolves its known `[S#]` handles to those keys and
retains the cited records; unknown handles stay visible as unresolved text.
Reloading a draft needs no run, conversation or evidence store.

Export places the draft's text and citations at its placeholder and includes
the cited records in its references. It never includes `message` or `prompt`.
A missing or null `output` contributes no visible text. Accepting the draft
replaces the widget with ordinary blocks and citation children, and adds the
records to the page library, as one undoable action.

An omitted `blocks` field exports as an empty document body, but any supplied
value must be an array. Block IDs must be non-empty and unique. Placeholder
matching is strict. Each paragraph child must have one matching
`data-child-id` placeholder, each placeholder must resolve to one child, and
IDs must be unique. A canonical placeholder is empty; export ignores any
rendered widget DOM found inside its outer span and uses only the matching
child JSON. Missing/orphaned children, duplicate IDs, unknown block or
child types, invalid levels/columns/graph kinds, unsafe equations, unsupported
markup, and malformed or oversized render-affecting field values fail the
export as a whole. Non-rendered fields such as AI Beat `message`/`prompt` and
editor visibility state are deliberately ignored rather than validated.

Ordinary Unicode text is emitted through an engine-aware preamble. Latin,
Greek, punctuation, and CJK text use available Unicode system fonts; CJK falls
back to visible `U+XXXX` labels if no configured wide font exists. Emoji are
always exported as visible code-point labels so an engine cannot silently omit
them. PDF export therefore requires Tectonic, LuaLaTeX, or XeLaTeX; pdfTeX is
not an API compiler option.
The generated `.tex` source has a hard 2 MiB UTF-8 limit. Crossing it returns a
generic 422 rather than a partial download; the 25 MiB compiled-PDF cap is a
separate output safety limit.
See Document persistence and logging (`ColWrite-api/docs/document.md#latex-and-pdf-document-export`)
for endpoint, compiler, security, and controlled-error details.

## Examples

Minimal empty document:

```json
{
  "schema_version": 1,
  "name": "Untitled page",
  "tags": [],
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
    { "id": "e1", "type": "equation", "latex": "E=mc^2", "display": false, "numbered": false }
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
    {
      "id": "c1",
      "type": "citation",
      "keys": ["10.1000/example"],
      "style": "author-year",
      "prefix": "see",
      "suffix": "ch. 2",
      "sources": [
        {
          "key": "10.1000/example",
          "title": "Example paper",
          "authors": "Doe, Jane",
          "year": "2025",
          "doi": "10.1000/example",
          "provider": "manual"
        }
      ]
    }
  ]
}
```

Heading + paragraph with a table child (placeholders + children):

```json
{
  "schema_version": 1,
  "name": "Report",
  "tags": [],
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
          "header": true,
          "align": ["left", "center", "right"],
          "caption": "Table 1. Quarterly summary."
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
      "output": {"text": "- Idea 1...", "sources": []},
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
      "kind": "area",
      "data": { "values": [1, 3, 2, 5], "labels": ["Q1", "Q2", "Q3", "Q4"] },
      "title": "Quarterly",
      "xLabel": "Quarter",
      "yLabel": "Value",
      "caption": "Figure 1. Quarterly values."
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

- Normalize paragraph HTML before persistence to avoid embedding rendered
  child internals into `html`.
- When inserting inline children programmatically, ensure you:
  - Insert a `<span data-child-id="..." contenteditable="false"></span>` at the intended position in HTML.
  - Add a matching entry to the paragraph `children` array with the same `id` and correct type payload.
- Clamp paragraph `columns` between 1 and 6.
- Validate raw JSON before applying it to editor state.
- Treat the floating toolbar's `ai-suggest` wrapper as temporary UI; it is not part of the formal JSON schema. Accept or reject suggestions to commit clean HTML.
- Use metadata flags (`aiHidden`, `locked`, `collapsed`) to control AI and UI behavior. The backend should enforce AI-related flags.

## Creating canonical document JSON manually

- Minimal content you must provide: `{ "schema_version": 1 }`; name, tags,
  and blocks have canonical defaults. Supplying them explicitly is preferred
  for a portable editor fixture.
- A client can initialize a new document with a heading and paragraph:

```json
{
  "schema_version": 1,
  "name": "Untitled page",
  "tags": [],
  "blocks": [
    { "id": "<uid>", "type": "heading", "level": 2, "html": "Your document" },
    { "id": "<uid>", "type": "paragraph", "html": "Write something here. Select text to format. Use the + to insert blocks.", "columns": 1, "children": [] }
  ]
}
```

This object can be loaded directly into a conforming editor or sent in the
`content` field of `POST /workspaces/{workspace_id}/documents`.
