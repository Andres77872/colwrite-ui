# Document client and endpoints

This document describes `src/client/document_client.py`, the available document endpoints in the API, and how to stream AI chat responses for documents.

## Environment variables

- API_BASE_URL (optional, default: http://0.0.0.0:8005)
  - Base URL of the API serving document endpoints.

Example shell setup:
```bash
env | grep API_BASE_URL || true
export API_BASE_URL="http://0.0.0.0:8005"
```

## Endpoints

From `src/routes/document_actions.py`:
- POST `/document/create` → body: `{ "document": { ... } }` → returns `{ "document_id": "..." }`
- PUT `/document/save/{document_id}` → body: `{ "document": { ... } }`
- GET `/document/load/{document_id}`
- POST `/document/list` → body: `{ "page": 1, "limit": 10, "query": null }`
- DELETE `/document/delete/{document_id}?version=N` (or `If-Match` header — one of the two is required)
- GET `/document/exists/{document_id}`
- POST `/document/aichat/{document_id}` (SSE stream) → body: `{ "messages": [ {"role":"user","content":"..."} ] }`

Notes:
- `document_id` is a MongoDB ObjectId string.
- `list` supports an optional `query` that filters documents by `name` (case-insensitive).
- The document object accepts only `{ version, blocks, name?, tags? }`. Unknown
  fields are rejected by canonical validation; the legacy `title` alias is
  tolerated server-side as a `name` fallback but should no longer be sent.
- Every save/create/delete also writes a revision to the versioned history —
  see `docs/api/document-history.md` for the `/v2/documents` timeline API.

## Python client (async)

The async client lives at `src/client/document_client.py`.

```python
from src.client.document_client import (
    DocumentClient,
    create_document, update_document, load_document,
    list_documents, delete_document, document_exists,
    stream_document_aichat,
)

# Create
resp_c = await create_document({"name": "My Doc", "version": 1, "blocks": []})
new_id = resp_c["document_id"]

# Update
await update_document(new_id, {"name": "Updated Name"})

# Load
resp_l = await load_document(new_id)
print(resp_l["document"]["name"])

# List
resp_list = await list_documents(page=1, limit=10, query=None)
print(resp_list["count"], len(resp_list["documents"]))

# Exists
resp_e = await document_exists(new_id)
print(resp_e["exists"])  # True/False

# Delete
await delete_document(new_id)
```

## AI chat (SSE streaming)

```python
from src.client.document_client import stream_document_aichat

messages = [
    {"role": "user", "content": "Summarize the introduction"}
]

async for chunk in stream_document_aichat(document_id=new_id, messages=messages):
    # chunk is a string content piece as sent by the server
    print(chunk, end="")
```

For lower-level control, use `DocumentClient.aichat_stream(..., yield_content_only=False)` to receive full SSE payloads: `{ "content": "...", "extras": null }`.

## curl examples

Create:
```bash
curl -sS -X POST "$API_BASE_URL/document/create" \
  -H 'Content-Type: application/json' \
  -d '{"document": {"name": "My Doc", "version": 1, "blocks": []}}'
```

Update:
```bash
curl -sS -X PUT "$API_BASE_URL/document/save/<document_id>" \
  -H 'Content-Type: application/json' \
  -d '{"document": {"name": "Updated Name"}}'
```

Load:
```bash
curl -sS "$API_BASE_URL/document/load/<document_id>"
```

List:
```bash
curl -sS -X POST "$API_BASE_URL/document/list" \
  -H 'Content-Type: application/json' \
  -d '{"page": 1, "limit": 10, "query": null}'
```

Exists:
```bash
curl -sS "$API_BASE_URL/document/exists/<document_id>"
```

Delete:
```bash
curl -sS -X DELETE "$API_BASE_URL/document/delete/<document_id>"
```

SSE AI chat (prints streamed content):
```bash
curl -N -X POST "$API_BASE_URL/document/aichat/<document_id>" \
  -H 'accept: text/event-stream' \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Summarize"}]}'
```

## MySQL usage logs (schema additions)

See `docs/mysql/01_tables.sql`, `02_index_and_relations.sql`, and `03_functions.sql` for tables and procedures to log AI usage related to `ai_actions`, `aibeat`, and document AI chat. These are not yet wired into the API runtime; they provide the foundation for analytics and auditing.
