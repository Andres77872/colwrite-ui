# LLM guide: document tool calls

> **Secondary copy** of `ColWrite-api/docs/llm-document-json.md`, taken on
> 2026-11-16, with its links pointed at the API repository. The API's copy is
> authoritative: where this copy differs, the API's is right. It describes
> what the agent's document tools (`doc_read`, `doc_edit`, `doc_create`,
> `cite_sources`) accept; the persisted shape is
> [document-json.md](document-json.md).

The current ColWrite agent works through structured document tools rather than
returning an entire document JSON object. By default, edits are proposals for
the client to approve; direct application is the author's Auto choice. The
persisted shape is documented in
[Document JSON and block structure](document-json.md); this guide covers the
additional rules for `doc_read`, `doc_edit`, and `doc_create`.

## Choose the document tool

- `doc_read()` reloads the current conversation document. The agent already
  receives a refreshed visible snapshot before each turn, so this is primarily
  for re-verification after an unexpected result.
- `doc_edit(ops)` stores one atomic change set for the current conversation
  document. Batch one user request's operations into one call.
- `doc_create(name, blocks?)` creates a different document. Use it only when the
  user asks for a new document.

The backend binds the current `document_id` and version. Never put either value
in tool arguments.

## Profiles and persistence

An agent run's request names its profile and its apply mode:

- `profile: "chat"` (default) exposes the document tools.
- `profile: "inline"` withholds `doc_read`, `doc_edit`, and `doc_create`;
  the caller owns applying or rejecting the returned text.
- Every `doc_edit` call validates and stores one owner-scoped
  `document_change_set` against the exact base head, whole or not at all. The
  document head is unchanged, and the change set is durable across a dropped
  stream or page reload. `tool_action` carries its `change_set_id`, its
  `apply_policy` and a bounded, content-free preview; the client fetches the
  change set and decides its operations through the v2 API.
- `apply_mode: "propose"` (default) leaves every change set for the author's
  review (`apply_policy: "review"`).
- `apply_mode: "auto"` asks for the open editor to apply them without review.
  The server grants `apply_policy: "auto"` only to a `chat` run, for an
  editor or above, under a workspace policy that allows it; otherwise the
  set is `review` with an `auto_blocked_reason` (`role` or `policy`). Once the run
  has read untrusted content (a PDF, a paper's abstract or excerpts, a web
  page, a research worker's report), every later set is `review` with
  `untrusted_content`.

`doc_create` creates the requested separate document immediately when that
tool is available, beside the current page: in the same collection, right
after it. It is refused (`untrusted_content`) once the run has read untrusted
content, since a new page skips the author's review. The tool output is not
the review source of truth; use the returned `change_set_id` to load the
durable record.

## Block rules

`doc_edit` and `doc_create` take blocks in one dialect schema
(`BLOCK_SCHEMA` in `src/agent/tools/page/edit_input.py`), stated once. It is
the stored block shape with three differences, each on purpose:

- **No field the author owns.** `aiHidden`, `locked` and `collapsed` are not
  in it; a block has no `id` to write either. The first block of a
  `write_blocks` `replace` keeps the replaced block's id, and its `collapsed`.
- **A citation names its works by handle.** A citation widget is
  `{"id": "c1", "type": "citation", "sources": ["S3"], "locator": "p. 4"}`;
  the server fills `keys`, `style` and every reference from this run's
  source registry. A key, a record or anything but a handle (`S` and a
  number) is refused, and a handle the run did not return is
  `source_not_found`. A model-written reference cannot reach the page.
- **A graph's numbers are on the widget**: `values` and `labels`, stored as
  `data.values` and `data.labels`, so no schema is more than three objects
  deep.

The rest:

- Supported block types are `paragraph`, `heading`, `divider`, `code`, and `image`.
- An image names an existing workspace `assetId`, required descriptive `alt`,
  optional plain-text `caption`, `width` (0.2–1) and export-safe `label`.
  Never invent an asset id or use a URL/base64 payload. Edit it with a whole
  `write_blocks` replacement, not `replace_text`; the server owns its `origin`.
  `doc_read` shows the id and text, never the bytes.
- List items, to-dos, quotes, and callouts are paragraphs with a `variant`
  (`bullet`, `numbered`, `todo`, `quote`, `callout`). List items may carry
  `indent` 1–4 and to-dos carry `checked`. Numbering is computed; never type
  "1." into the HTML.
- A `code` block is `{"type": "code", "text": "…", "language": "python"}`.
  `text` is plain text, not HTML, and `language` is optional.
- A diagram is a `code` block with `"language": "mermaid"` and Mermaid source
  as its `text`. The UI draws it and its Markdown export writes a `mermaid`
  fence; the LaTeX export prints the source as monospace code.
- A structured figure is a `code` block with `"language": "figure"` whose
  `text` is a JSON spec (nodes, groups, edges, caption; no coordinates) that
  the UI lays out and draws. The spec language is documented in colwrite-ui
  `docs/figures.md`; the model reads it from the `editor` skill's
  `references/figures.md` (`src/skills/editor/`), which carries the same
  rules.
  - `text` is always a string: the spec as JSON text, inside which a LaTeX
    backslash is written twice (`"$\\mathbf{c}_t^{KV}$"` in the spec). The
    dialect has no string-or-object field, so the object form P0 accepted is
    gone, and so is the object view of the snapshot: the `CURRENT DOCUMENT`
    snapshot and `doc_read` show `text` as the block stores it, which is the
    form to send back. The author-focus preview shows a figure as `figure:`
    with its caption, or `nodes: …` with its first node labels.
  - To edit a figure, rewrite it with `write_blocks` `replace` and the whole
    edited spec. `replace_text` matches the stored text, where each LaTeX
    backslash is doubled and quotes are escaped, so use it on a figure only
    for a plain word with no backslash or quote (a label such as
    `Sublayer`).
  - A figure is still stored, with a `warning: …` line in the result's
    `notes`, when its `text` is not strict JSON, has no non-empty
    `nodes`/`groups` list, has a doubled backslash before a LaTeX command
    inside `$…$` (a label copied from an escaped string: LaTeX reads it as a
    line break and plain letters), or has a LaTeX command whose backslash
    JSON read as an escape (`\frac` as a form feed and `rac`). An odd run of
    backslashes (a row break, then a command) is not flagged. A figure gets
    one note, with its problems joined by `; `. The UI's reader is lenient,
    so none of these fail the operation.
- To change what a block is, rewrite it with `write_blocks` `replace`: the
  new block is written whole, with the new `type` or `variant` (none turns
  a list item back into body text).
- Use an existing block's `id` from the snapshot in `replace_text`,
  `write_blocks` (`before`, `after`, `replace`), `delete_blocks` and
  `move_block`.
- Heading levels are 1, 2, or 3. Paragraph columns are integers from 1 through
  6.
- Blocks marked `aiHidden` are absent from the model-visible document. Blocks
  marked `locked` are visible but cannot be modified by the agent.

Paragraphs may contain `table`, `citation`, `equation` and `graph` widgets
(an author's `aiBeat` is carried, never written). Every widget sits at a
placeholder in the paragraph's HTML:

```html
<span data-child-id="<child-id>"></span>
```

- A placeholder whose widget is already on the page needs nothing in
  `children`: the widget is **carried**, unchanged, from the block it is in.
  `children` lists only new or changed widgets.
- A widget is in one place. A placeholder for a widget another block still
  holds is refused; to move it, first rewrite that block without it.
- A placeholder with no widget anywhere, and a listed widget with no
  placeholder, are refused.

Keep HTML simple: `<strong>`, `<em>`, `<u>`, `<s>`, `<code>`, `<a>`, `<br>`,
and placeholder spans.

## Create example

Tool arguments for a new document:

```json
{
  "name": "Research notes",
  "blocks": [
    {"type": "heading", "level": 2, "html": "Introduction"},
    {"type": "paragraph", "html": "Start writing here."}
  ]
}
```

## Edit examples

`doc_edit` takes `ops`, each a flat object with an `op` and the fields of
that operation (06 §3); a field another operation reads is ignored. Every
operation says in `basis` what it rests on: the handles of the sources it
draws on, `["author"]` when it only rewords the author's text, or `null` when
it rests on nothing (stored as `[]`). A change
that adds facts, numbers or sources with no basis is flagged to the author as
new information (see
`ColWrite-api/docs/document-history-api.md#how-a-change-set-stores-its-operations`).

Change a word or a sentence without resending the block. `find` is copied
from the block's current visible text and must occur exactly once in it. It
cannot cross a citation, equation, or other inline widget, and it cannot cross
the edge of formatting:

```json
{"ops": [{"op": "replace_text", "block_id": "p1",
          "find": "the results was significant",
          "replace": "the results were significant", "basis": ["author"]}]}
```

Rewrite a paragraph, keeping its citation `c1` by its placeholder, and add a
sentence after it that cites a work a research tool returned as `S3`:

```json
{"ops": [
  {"op": "write_blocks", "position": "replace", "block_id": "p1", "basis": ["author"],
   "blocks": [{"type": "paragraph", "html": "Retrieval helps <span data-child-id=\"c1\"></span>."}]},
  {"op": "write_blocks", "position": "after", "block_id": "p1", "basis": ["S3"],
   "blocks": [{"type": "paragraph",
               "html": "It also scales <span data-child-id=\"c2\"></span>.",
               "children": [{"id": "c2", "type": "citation", "sources": ["S3"]}]}]}
]}
```

Delete, move, rename, and keep a work for later:

```json
{"ops": [
  {"op": "delete_blocks", "block_ids": ["p7", "p8"]},
  {"op": "move_block", "block_id": "p4", "position": "before", "target_block_id": "p2"},
  {"op": "set_meta", "name": "Revised research notes", "citation_style": "author-year"},
  {"op": "add_sources", "sources": ["S5"]},
  {"op": "remove_sources", "keys": ["10.1000/unused"]}
]}
```

| Before P1.API-4 | Now |
| --- | --- |
| `replace_text {block_id, find, replace}` | `replace_text`, the same fields (stored with `block`, no longer as a `replace_block`) |
| `replace_block {block_id, block}` (fields merged) | `write_blocks {position: "replace", block_id, blocks}` (written whole) |
| `insert_block_after` / `insert_block_before {reference_id, block}` | `write_blocks {position: "after" / "before", block_id, blocks}` |
| `insert_block_at_start {block}` | `write_blocks {position: "before", block_id: <first block>, blocks}` |
| `append_block {block}` | `write_blocks {position: "append", blocks}` |
| `delete_block {block_id}` | `delete_blocks {block_ids}` |
| `reorder_block {block_id, to_index}` | `move_block {block_id, position, target_block_id}` |
| `move_block {block_id, reference_id, position}` | `move_block {block_id, position, target_block_id}` |
| `update_meta {meta: {name}}` | `set_meta {name, citation_style}` |
| — | `add_sources {sources}`, `remove_sources {keys}` |

## Citing sources

A citation widget in `write_blocks` names its works by handle. To cite at a
quoted point of an existing paragraph, or to cite a DOI or arXiv id the author
gave, use `cite_sources`:

```json
{
  "block_id": "existing-paragraph-id",
  "sources": ["S3", "10.1145/3292500.3330701"],
  "after_text": "outperforms dense retrieval",
  "locator": "p. 4"
}
```

`sources` are handles (`cite_as`) from this turn's research results, or DOIs,
arXiv ids, or Semantic Scholar ids that the server resolves. Title, authors,
and year come from those records, and a source that cannot be resolved stops
the whole call. The citation is placed after the single occurrence of
`after_text`, or at the end of the block without it. The change is proposed
as a `write_blocks` `replace` of the paragraph, with the cited works as its
basis. See the citations guide (`ColWrite-api/docs/citations.md`).

## What comes back

Every `doc_edit` call, under either `apply_mode`, stores one change set and
returns only `proposed`, its `change_set_id` and the `generated_ids` of new
blocks, with any figure warnings in `notes`. The stored change set is the only
review source; the `tool_action` event reads its `apply_policy`,
`auto_blocked_reason`, base head and operation names from it. Use the
`generated_ids` in a later call, and build a follow-up edit on the snapshot,
which shows the change on the gateway engine, or on `doc_read`.
