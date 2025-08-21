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

## Block types

Each block has an `id: string` and `type` field. Supported types:

1) Paragraph block
- Shape:
  - `type`: "paragraph"
  - `html`: string (serialized HTML for the paragraph)
  - `children` (optional): array of inline child objects (table only; see below)
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

## Paragraph inline children (table only)

Paragraphs may embed table widgets using placeholders inside `html` and a matching child object in `children`.

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
- Placeholders: for each table child in `children`, include exactly one matching placeholder in the `html` string.
- HTML content: avoid complex or unsafe markup; prefer plain text and simple inline tags like `<strong>`, `<em>`, `<u>`, `<a>`, and `<br>` where necessary.

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

## Validation checklist (apply before returning JSON)

- The output is valid JSON with no extra text.
- `version` is `1` and `blocks` is an array.
- Every object has a unique `id` string.
- All placeholders in paragraph `html` have a matching child in `children` with the same `id`.
- All table `data` dimensions match `rows` and `cols`.
- Paragraph `columns` are within 1..6.
- Heading `level` is 1, 2, or 3.
