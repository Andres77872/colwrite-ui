# API: /document/aichat/{document_id}

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

### Chat session headers

Only these request headers are supported (case-insensitive key match, shown in lowercase for clarity):
- `x-chat-id`: Continue an existing chat session.
- `x-thread-id`: Continue from a specific thread id (branch). If omitted, the chat’s `last_thread_id` is used.

Behavior:
- If `x-chat-id` is not provided, the server creates a new chat session and returns the new id via response header `x-chat-id` on the SSE response.
- When provided, the server validates the chat and loads prior messages along the specified branch into the prompt before streaming.

Example request (new chat created automatically):
```bash
curl -N -X POST 'http://localhost:8000/document/aichat/66b6e0cd2f3e3d2f9a3b1234' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Summarize the document"}]}'
```

Example request (continue existing chat and branch):
```bash
curl -N -X POST 'http://localhost:8000/document/aichat/66b6e0cd2f3e3d2f9a3b1234' \
  -H 'Content-Type: application/json' \
  -H 'x-chat-id: 8a3fb2c1-3b6d-4e6e-9e1a-123456789abc' \
  -H 'x-thread-id: 42' \
  -d '{"messages":[{"role":"user","content":"Add a heading before Results"}]}'
```

## Streaming response

- Content-Type: `text/event-stream`
- Each event is a JSON object framed as SSE lines:
```
data: {"content":"...", "extras": { ... }}

```
- `content` is the visible assistant text for the user.
- `extras` is the latest valid JSON parsed from the most recent `<EXTRAS_JSON>...</EXTRAS_JSON>` block found in the stream. It may be `null` until the first valid block is received. The latest parsed object is repeated on subsequent chunks to keep state consistent.

Response headers:
- `x-chat-id`: Present when the server created a new chat session for this request. Cache this id on the client and send it on subsequent calls.

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
- If both are omitted or undefined, defaults to appending at the end.

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

### Step 2: Handle SSE Stream

```javascript
const reader = response.body.getReader();
const decoder = new TextDecoder();
let chatContent = '';
let latestExtras = null;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value, { stream: true });
  const lines = chunk.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const event = JSON.parse(line.slice(6));
        
        // Update chat UI with content
        if (event.content) {
          chatContent += event.content;
          updateChatUI(chatContent);
        }
        
        // Track latest extras for document operations
        if (event.extras !== null) {
          latestExtras = event.extras;
        }
      } catch (e) {
        console.warn('Failed to parse SSE event:', line);
      }
    }
  }
}

// Apply document changes after stream completes
if (latestExtras && latestExtras.patches.length > 0) {
  applyDocumentPatches(latestExtras);
}
```

### Step 3: Apply Document Patches

```javascript
function applyDocumentPatches(extras) {
  const { intent, patches } = extras;
  
  for (const patch of patches) {
    switch (patch.op) {
      case 'insert':
        insertBlock(patch.block, patch.beforeOf, patch.afterOf);
        break;
      case 'update':
        updateBlock(patch.blockId, patch.fields);
        break;
      case 'delete':
        deleteBlock(patch.blockId);
        break;
    }
  }
  
  // Validate and save document
  validateDocument();
  saveDocument();
}

function insertBlock(block, beforeOf, afterOf) {
  const blocks = getCurrentDocumentBlocks();
  let insertIndex;
  
  if (beforeOf === null) {
    // Insert at start - nothing comes before it
    insertIndex = 0;
  } else if (afterOf === null) {
    // Insert at end - nothing comes after it
    insertIndex = blocks.length;
  } else if (beforeOf) {
    insertIndex = blocks.findIndex(b => b.id === beforeOf);
  } else if (afterOf) {
    insertIndex = blocks.findIndex(b => b.id === afterOf) + 1;
  } else {
    // Default: append at end if both are undefined
    insertIndex = blocks.length;
  }
  
  // Validate block before inserting
  if (validateBlock(block)) {
    blocks.splice(insertIndex, 0, block);
  }
}

function updateBlock(blockId, fields) {
  const blocks = getCurrentDocumentBlocks();
  const blockIndex = blocks.findIndex(b => b.id === blockId);
  
  if (blockIndex !== -1) {
    // Merge fields while preserving existing properties
    Object.assign(blocks[blockIndex], fields);
    
    // Special handling for paragraph children/html consistency
    if (blocks[blockIndex].type === 'paragraph' && fields.html) {
      validateParagraphChildren(blocks[blockIndex]);
    }
  }
}
```

## Frontend Consumption Patterns

### Real-time Content Updates

```javascript
class ChatStreamHandler {
  constructor(documentId) {
    this.documentId = documentId;
    this.chatContent = '';
    this.latestExtras = null;
  }
  
  async startStream(messages) {
    const response = await this.makeRequest(messages);
    const reader = response.body.getReader();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        await this.processChunk(value);
      }
    } finally {
      await this.finishStream();
    }
  }
  
  async processChunk(value) {
    const chunk = new TextDecoder().decode(value);
    const events = this.parseSSEChunk(chunk);
    
    for (const event of events) {
      // Update chat UI immediately
      this.updateChatContent(event.content);
      
      // Track document operations
      if (event.extras) {
        this.latestExtras = event.extras;
        this.previewDocumentChanges(event.extras);
      }
    }
  }
  
  previewDocumentChanges(extras) {
    // Optional: show preview of document changes in UI
    if (extras.intent === 'create') {
      this.showCreatePreview(extras.patches);
    } else if (extras.intent === 'edit') {
      this.showEditPreview(extras.patches);
    }
  }
  
  async finishStream() {
    if (this.latestExtras?.patches?.length > 0) {
      await this.applyFinalPatches();
    }
  }
}
```

### Error Handling Best Practices

```javascript
function handleStreamErrors(error, chatContent, latestExtras) {
  console.error('Stream error:', error);
  
  // Still show partial content to user
  if (chatContent) {
    updateChatUI(chatContent + '\n\n[Stream interrupted]');
  }
  
  // Apply any valid patches received before error
  if (latestExtras?.patches?.length > 0) {
    try {
      applyDocumentPatches(latestExtras);
    } catch (patchError) {
      console.error('Failed to apply patches:', patchError);
      showUserError('Some document changes may not have been applied.');
    }
  }
}

// Validation before applying patches
function validateBlock(block) {
  if (!block.id || !block.type) return false;
  
  switch (block.type) {
    case 'heading':
      return [1, 2, 3].includes(block.level) && typeof block.html === 'string';
    case 'paragraph':
      return typeof block.html === 'string' && 
             validateParagraphChildren(block);
    case 'divider':
      return true;
    default:
      return false;
  }
}

function validateParagraphChildren(block) {
  if (!block.children) return true;
  
  for (const child of block.children) {
    // Check placeholder exists in HTML
    const placeholder = `<span data-child-id="${child.id}" contenteditable="false"></span>`;
    if (!block.html.includes(placeholder)) {
      console.warn(`Missing placeholder for child ${child.id}`);
      return false;
    }
    
    // Validate child schema
    if (!validateChildSchema(child)) {
      return false;
    }
  }
  
  return true;
}
```

## Common Patterns and Best Practices

### Intent-Based UI Updates

```javascript
function handleExtrasUpdate(extras) {
  switch (extras.intent) {
    case 'ask':
      // No document changes, just show response
      showResponseOnly();
      break;
      
    case 'create':
      // Preview new content being added
      highlightInsertionPoints(extras.patches);
      showCreateAnimation();
      break;
      
    case 'edit':
      // Highlight blocks being modified
      highlightModifiedBlocks(extras.patches);
      showEditAnimation();
      break;
  }
}
```

### Batch vs Progressive Application

```javascript
// Option 1: Apply patches progressively (real-time preview)
function applyPatchesProgressive(extras) {
  if (extras?.patches) {
    extras.patches.forEach(patch => {
      applyPatchWithAnimation(patch);
    });
  }
}

// Option 2: Apply patches at stream end (atomic update)
class DocumentPatcher {
  constructor() {
    this.pendingPatches = [];
  }
  
  onStreamChunk(extras) {
    if (extras?.patches) {
      this.pendingPatches = extras.patches; // Replace with latest
    }
  }
  
  onStreamEnd() {
    this.applyAllPatches();
    this.pendingPatches = [];
  }
}
```

### Error Recovery Strategies

```javascript
class RobustStreamHandler {
  async handleStream() {
    let lastValidState = this.getDocumentState();
    
    try {
      await this.processStream();
    } catch (error) {
      // Rollback to last valid state
      this.restoreDocumentState(lastValidState);
      this.showErrorMessage('Changes could not be applied');
    }
  }
  
  validateBeforeApply(patches) {
    // Create temporary document copy
    const testDoc = this.cloneDocument();
    
    try {
      this.applyPatches(testDoc, patches);
      return this.validateDocument(testDoc);
    } catch {
      return false;
    }
  }
}
```

## Implementation Notes

### Server-Side Processing
- The server removes `<EXTRAS_JSON>...</EXTRAS_JSON>` blocks from the model text and parses the enclosed JSON
- Parse errors are ignored until a well‑formed block arrives; the previous valid `extras` remains available
- The handler uses a streaming LLM (`@01/gpt-5-chat-latest`). Configure `MAGIC_LLM_API` and `MAGIC_LLM_API_KEY` environment variables
- The current document JSON is provided to the model as context to enable accurate edits/insertions

### Client-Side Recommendations
- Buffer SSE events and parse line-by-line to handle chunked JSON
- Maintain document state consistency by validating before applying patches
- Implement progressive enhancement: show content immediately, apply document changes after validation
- Use debouncing for rapid successive patches to avoid UI flicker
- Keep a document history for undo/redo functionality
- Validate inline children placeholders match their corresponding child objects

### Performance Considerations
- Stream processing should be non-blocking to maintain UI responsiveness
- Consider using Web Workers for heavy document validation/processing
- Cache parsed extras objects to avoid repeated JSON parsing
- Implement patch batching for multiple rapid operations
- Use virtual scrolling for documents with many blocks
