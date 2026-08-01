# API: /document/aichat/{document_id}

> **Removed. Kept for history only — do not implement against this.**
>
> The backend no longer serves this route, and the `<EXTRAS_JSON>` protocol
> below no longer exists. All agent interaction goes through
> `POST /api/agent/chat`, which streams typed SSE events (`status`, `token`,
> `tool_call_start`, `tool_call_end`, `tool_action`, `error`, `done`) rather
> than prose with an embedded JSON envelope, and stages document operations for
> review instead of returning patches to apply. The client contract lives in
> `src/services/agentChat.ts` and `src/services/streamParser.ts`; how it reaches
> the document is described under "The assistant and the document" in the
> [README](../README.md).

This endpoint streams an AI assistant conversation tailored for scientific writing. It detects user intent (ask, edit, create) and answers in a clear academic tone, while simultaneously emitting a machine-usable JSON payload that instructs a document editor how to apply changes.

The server streams two parallel channels over SSE:

- content: user-visible prose to show in the chat UI
- extras: a JSON object (not shown to the user) that encodes document operations for the editor

This document is self-contained and specifies the streaming protocol, tags, schemas, and examples required to consume the endpoint.

## Request

- Method: POST
- Path: `/document/aichat/{document_id}`
- Body (OpenAI-style messages):
```json
{
  "messages": [
    {"role": "user", "content": "Please add a Methods section..."}
  ]
}
```

Notes:
- The server validates `{document_id}` and loads the current document from MongoDB.
- The server injects the current document JSON into the last user message to give the LLM full context.
- A system prompt instructs the model to detect intent and to repeatedly emit a minified JSON block enclosed in `<EXTRAS_JSON>` and `</EXTRAS_JSON>` while it generates text.

## Streaming response

- Content-Type: `text/event-stream`
- Each event is a JSON object framed as SSE lines:
```
data: {"content":"...", "extras": { ... }}

```
- `content` is the visible assistant text for the user.
- `extras` is the latest valid JSON parsed from the most recent `<EXTRAS_JSON>...</EXTRAS_JSON>` block found in the stream. It may be `null` until the first valid block is received. The latest parsed object is repeated on subsequent chunks to keep state consistent.

Error handling:
- On error, the server emits a final event with `content` containing the error message and `extras: null`, then closes the stream.

## LLM tag protocol

While generating text, the model must interleave user-visible prose with repeated, minified JSON blocks wrapped by the exact tags below:

- Open tag: `<EXTRAS_JSON>`
- Close tag: `</EXTRAS_JSON>`

Rules:
- Include a complete, self-contained JSON object between the tags; no comments or trailing commas.
- Repeat the JSON every 1–3 sentences and at the end of the answer.
- Do not wrap the JSON in code fences. Emit minified JSON (no whitespace).
- The server strips these tags and surfaces the parsed object as `extras` in each SSE event.

## Document and block schema (for extras JSON)

Document:
```
{
  "version": 1,
  "name": "<string>",
  "blocks": [ Block, ... ]
}
```

Block types (only these types are valid):
- heading: `{ id, type: "heading", level: 1|2|3, html: "<string>" }`
- paragraph: `{ id, type: "paragraph", html: "<string>", columns?: <number>, children?: Child[] }`
- divider: `{ id, type: "divider" }`

Paragraph children (allowed inline components):

**Table Child**: `{id, type: "table", rows, cols, data, header?}`
- `rows`/`cols`: positive integers
- `data`: string[][] array (rows × cols matrix)
- `header`: boolean (first row as header)

**Citation Child**: `{id, type: "citation", keys, style?, prefix?, suffix?, locator?}`
- `keys`: string[] of citation keys/DOIs/arXiv IDs
- `style`: "numeric"|"author-year"|"ieee"
- `prefix`/`suffix`/`locator`: optional formatting strings

**Equation Child**: `{id, type: "equation", latex, numbered?, labelId?}`
- `latex`: LaTeX math without $ delimiters
- `numbered`: boolean for equation numbering
- `labelId`: optional anchor for cross-references

**Graph Child**: `{id, type: "graph", kind, data, title?}`
- `kind`: "bar"|"line"|"pie"
- `data`: {values: number[], labels?: string[], colors?: string[]}
- `title`: optional graph title
- For pie charts: values ≥ 0, not all zero
- If labels/colors provided: same length as values

Inline child placeholders (required):
- Every paragraph child must have a corresponding placeholder span inside the `html` string:
  `<span data-child-id="<child-id>" contenteditable="false"></span>`
- For each placeholder in `html`, a matching child object with the same `id` must exist in `children`.
- All `id` values (blocks and children) must be unique across the entire document.

Placement rules (for inserts):
- Provide either `beforeOf` or `afterOf` to identify the position relative to other block ids.
- `beforeOf: null` ⇒ insert as the last block (append).
- `afterOf: null` ⇒ insert as the first block (prepend).

Update rules:
- When updating a paragraph’s `html`, preserve placeholders so they remain consistent with `children`.
- Only include fields that change inside `fields` for updates.

## Intents

- ask: Answer the user directly in an academic tone; `patches` may be an empty array.
- edit: Modify existing document content using `update` and/or `delete` patches (target blocks by `blockId`).
- create: Add new content using `insert` patches (provide valid `Block` objects and placement hints).

## Examples

1) Ask (no document change)
```
# Raw model stream (simplified):
In randomized controlled trials, ...<EXTRAS_JSON>{"intent":"ask","patches":[],"nextDocument":null}</EXTRAS_JSON>

# SSE events seen by the client:
data: {"content":"In randomized controlled trials, ...", "extras": {"intent":"ask","patches":[],"nextDocument":null}}

```

2) Create: insert a new heading at the start
```
# Raw model stream (simplified):
I will add a Methods section.<EXTRAS_JSON>{"intent":"create","patches":[{"op":"insert","block":{"id":"h_methods","type":"heading","level":2,"html":"Methods"},"afterOf":null}],"nextDocument":null}</EXTRAS_JSON>

# SSE events:
data: {"content":"I will add a Methods section.", "extras": {"intent":"create","patches":[{"op":"insert","block":{"id":"h_methods","type":"heading","level":2,"html":"Methods"},"afterOf":null}],"nextDocument":null}}

```

3) Edit: update an existing paragraph
```
# Raw model stream (simplified):
Refining your results paragraph.<EXTRAS_JSON>{"intent":"edit","patches":[{"op":"update","blockId":"p_results","fields":{"html":"We observed a statistically significant ..."}}],"nextDocument":null}</EXTRAS_JSON>

# SSE events:
data: {"content":"Refining your results paragraph.", "extras": {"intent":"edit","patches":[{"op":"update","blockId":"p_results","fields":{"html":"We observed a statistically significant ..."}}],"nextDocument":null}}

```

4) Create: paragraph with a citation child (placeholder in html)
```
# Raw model stream (simplified):
Including a citation.<EXTRAS_JSON>{"intent":"create","patches":[{"op":"insert","block":{"id":"p_cite","type":"paragraph","html":"See <span data-child-id=\"c1\" contenteditable=\"false\"></span> for prior work.","children":[{"id":"c1","type":"citation","keys":["doe2021"],"style":"numeric"}]} ,"afterOf":"h_methods"}],"nextDocument":null}</EXTRAS_JSON>

# SSE events:
data: {"content":"Including a citation.", "extras": {"intent":"create","patches":[{"op":"insert","block":{"id":"p_cite","type":"paragraph","html":"See <span data-child-id=\"c1\" contenteditable=\"false\"></span> for prior work.","children":[{"id":"c1","type":"citation","keys":["doe2021"],"style":"numeric"}]} ,"afterOf":"h_methods"}],"nextDocument":null}}

```

5) Create: paragraph with table child
```
# Raw model stream:
Adding a results table.<EXTRAS_JSON>{"intent":"create","patches":[{"op":"insert","block":{"id":"p_table","type":"paragraph","html":"Results summary: <span data-child-id=\"t1\" contenteditable=\"false\"></span>","children":[{"id":"t1","type":"table","rows":3,"cols":2,"data":[["Metric","Value"],["Accuracy","95.2%"],["Precision","93.8%"]],"header":true}]},"afterOf":"p_cite"}],"nextDocument":null}</EXTRAS_JSON>

# SSE events:
data: {"content":"Adding a results table.", "extras": {"intent":"create","patches":[{"op":"insert","block":{"id":"p_table","type":"paragraph","html":"Results summary: <span data-child-id=\"t1\" contenteditable=\"false\"></span>","children":[{"id":"t1","type":"table","rows":3,"cols":2,"data":[["Metric","Value"],["Accuracy","95.2%"],["Precision","93.8%"]],"header":true}]},"afterOf":"p_cite"}],"nextDocument":null}}

```

6) Create: paragraph with equation child
```
# Raw model stream:
The fundamental equation is:<EXTRAS_JSON>{"intent":"create","patches":[{"op":"insert","block":{"id":"p_eq","type":"paragraph","html":"The relationship is defined as <span data-child-id=\"eq1\" contenteditable=\"false\"></span> where E is energy.","children":[{"id":"eq1","type":"equation","latex":"E = mc^2","numbered":true,"labelId":"eq:einstein"}]},"afterOf":"p_table"}],"nextDocument":null}</EXTRAS_JSON>

# SSE events:
data: {"content":"The fundamental equation is:", "extras": {"intent":"create","patches":[{"op":"insert","block":{"id":"p_eq","type":"paragraph","html":"The relationship is defined as <span data-child-id=\"eq1\" contenteditable=\"false\"></span> where E is energy.","children":[{"id":"eq1","type":"equation","latex":"E = mc^2","numbered":true,"labelId":"eq:einstein"}]},"afterOf":"p_table"}],"nextDocument":null}}

```

## Usage Guide

### Step 1: Make the Request

```javascript
const response = await fetch(`/document/aichat/${documentId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      { role: 'user', content: 'Please add a conclusion section with key findings' }
    ]
  })
});
```