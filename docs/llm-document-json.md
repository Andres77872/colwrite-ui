# LLM Guide: Generate Editor Document JSON

Use this guide to produce a valid JSON document for the editor. Return only a single JSON object with the structure below. Do not include any explanations, comments, or markdown fences in your output.

## Output requirements

- Return exactly one JSON object.
- No comments, no trailing commas, no markdown code fences.
- All IDs must be strings and globally unique within the document.
- Keep HTML minimal and valid. Prefer plain text and simple inline tags.

## Top-level document object

- Required fields:
  - `version`: integer. Use `1`.
  - `blocks`: array of block objects in display order.
- Optional fields:
  - `name`: string (document title).

Example (shape only):
```json
{
  "version": 1,
  "name": "Optional title",
  "blocks": [ /* block objects */ ]
}
```

- Child object (citation):
  - `id`: string
  - `type`: "citation"
  - `keys`: string[] (citation keys/DOIs/arXiv IDs)
  - `style` (optional): `"numeric" | "author-year" | "ieee"`
  - `prefix` (optional): string (e.g., "see")
  - `suffix` (optional): string (e.g., "ch. 2")
  - `locator` (optional): string (page/section locator)

Example paragraph with a citation child:
```json
{
  "id": "p2",
  "type": "paragraph",
  "html": "See <span data-child-id=\"c1\" contenteditable=\"false\"></span> for details.",
  "children": [
    { "id": "c1", "type": "citation", "keys": ["doe2021"], "style": "numeric", "prefix": "see", "suffix": "ch. 2" }
  ]
}
```

- Child object (equation):
  - `id`: string
  - `type`: "equation"
  - `latex`: string (LaTeX math without `$` delimiters)
  - `numbered` (optional): boolean
  - `labelId` (optional): string

Example paragraph with an equation child:
```json
{
  "id": "p3",
  "type": "paragraph",
  "html": "Einstein proposed <span data-child-id=\"e1\" contenteditable=\"false\"></span> in his work.",
  "children": [
    { "id": "e1", "type": "equation", "latex": "E=mc^2", "numbered": false, "labelId": "" }
  ]
}
```

- Child object (graph):
  - `id`: string
  - `type`: "graph"
  - `kind`: `"bar" | "line" | "pie"`
  - `data`: object
    - `values`: number[]
    - `labels` (optional): string[]
    - `colors` (optional): string[]
  - `title` (optional): string

Example paragraph with a graph child:
```json
{
  "id": "p4",
  "type": "paragraph",
  "html": "Trend: <span data-child-id=\"g1\" contenteditable=\"false\"></span> shows improvement.",
  "children": [
    { "id": "g1", "type": "graph", "kind": "line", "data": { "values": [1, 3, 2, 5], "labels": ["Q1","Q2","Q3","Q4"] }, "title": "Quarterly" }
  ]
}
```

- Child object (aiBeat):
  - `id`: string
  - `type`: "aiBeat"
  - `message`: string
  - `prompt`: string
  - `output`: string
  - `collapsed` (optional): boolean

Example paragraph with an AI Beat child:
```json
{
  "id": "p5",
  "type": "paragraph",
  "html": "Ideas: <span data-child-id=\"a1\" contenteditable=\"false\"></span>",
  "children": [
    { "id": "a1", "type": "aiBeat", "message": "List product ideas for Q4", "prompt": "You are a helpful assistant", "output": "- Idea 1...", "collapsed": false }
  ]
}
```

## Block types

Each block has an `id: string` and `type` field. Supported types:

1) Paragraph block
- Shape:
  - `type`: "paragraph"
  - `html`: string (serialized HTML for the paragraph)
  - `children` (optional): array of inline child objects (table, citation, equation, graph, aiBeat; see below)
  - `columns` (optional): integer 1..6
  - Metadata (optional): `aiHidden?: boolean`, `locked?: boolean`, `collapsed?: boolean`

```json
{
  "id": "p1",
  "type": "paragraph",
  "html": "Some text",
  "columns": 1,
  "children": []
}
```

2) Heading block
- Shape:
  - `type`: "heading"
  - `level`: 1 | 2 | 3
  - `html`: string (heading text as HTML)
  - Metadata (optional): `aiHidden?: boolean`, `locked?: boolean`, `collapsed?: boolean`

```json
{
  "id": "h1",
  "type": "heading",
  "level": 2,
  "html": "Section"
}
```

3) Divider block
- Shape:
  - `type`: "divider"
  - Metadata (optional): `aiHidden?: boolean`, `locked?: boolean`, `collapsed?: boolean`

```json
{
  "id": "d1",
  "type": "divider"
}
```

## Paragraph inline children

Paragraphs may embed inline widgets using placeholders inside `html` and a matching child object in `children`.

- Placeholder in `html`:
  - Insert an empty span for each child: `<span data-child-id="<child-id>" contenteditable="false"></span>`
  - `<child-id>` must exactly match the child object's `id`.
- Child object (table):
  - `id`: string (matches placeholder)
  - `type`: "table"
  - `rows`: number (> 0)
  - `cols`: number (> 0)
  - `data`: string[][] with `rows` arrays, each of length `cols`
  - `header` (optional): boolean (first row is a header)

Example paragraph with a table child:
```json
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
```

## Rules and constraints

- Version: `version` must be `1`.
- IDs: `id` values must be unique across all blocks and children.
- Blocks ordering: Use the order in the `blocks` array for display order.
- Paragraph columns: clamp to 1..6. If omitted, default behavior is 1 column.
- Heading levels: allowed values are 1, 2, or 3.
- Table integrity: `rows` × `cols` must match the `data` matrix dimensions.
- Placeholders: for each child in `children`, include exactly one matching placeholder in the `html` string.
- HTML content: avoid complex or unsafe markup; prefer plain text and simple inline tags like `<strong>`, `<em>`, `<u>`, `<a>`, and `<br>` where necessary.
- Graph integrity: `data.values` are finite numbers; if `labels` present then `labels.length === values.length`; if `colors` present then `colors.length === values.length`. For `kind: "pie"`, values must be ≥ 0 and not all zero.

## Minimal complete documents (ready to output)

1) Empty document
```json
{
  "version": 1,
  "name": "Untitled document",
  "blocks": []
}
```

2) Heading and paragraph
```json
{
  "version": 1,
  "name": "Your document",
  "blocks": [
    { "id": "h1", "type": "heading", "level": 2, "html": "Introduction" },
    { "id": "p1", "type": "paragraph", "html": "Write something here.", "columns": 1, "children": [] }
  ]
}
```

3) Paragraph with a table child
```json
{
  "version": 1,
  "name": "Report",
  "blocks": [
    {
      "id": "p1",
      "type": "paragraph",
      "html": "Table: <span data-child-id=\"t1\" contenteditable=\"false\"></span>",
      "columns": 1,
      "children": [
        { "id": "t1", "type": "table", "rows": 2, "cols": 2, "data": [["A","B"],["C","D"]], "header": true }
      ]
    }
  ]
}
```

4) Paragraph with a graph child
```json
{
  "version": 1,
  "name": "Report",
  "blocks": [
    {
      "id": "p2",
      "type": "paragraph",
      "html": "Trend: <span data-child-id=\"g1\" contenteditable=\"false\"></span> shows improvement.",
      "children": [
        { "id": "g1", "type": "graph", "kind": "bar", "data": { "values": [3, 5, 2], "labels": ["A","B","C"] }, "title": "" }
      ]
    }
  ]
}
```

## Validation checklist (apply before returning JSON)

- The output is valid JSON with no extra text.
- `version` is `1` and `blocks` is an array.
- Every object has a unique `id` string.
- All placeholders in paragraph `html` have a matching child in `children` with the same `id`.
- All table `data` dimensions match `rows` and `cols`.
- Paragraph `columns` are within 1..6.
- Heading `level` is 1, 2, or 3.
