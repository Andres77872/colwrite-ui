# API: Chat Sessions and Threads

This document specifies the REST endpoints for chat session management and thread storage, including request/response formats and example curl usage.

All endpoints are additive to `/document/aichat/{document_id}`, which streams model output and automatically persists the user/assistant turns when chat headers are provided (or a new chat is created).

## Models

- Chat item:
```json
{
  "chat_id": "<uuid>",
  "document_id": "<mongo-id>",
  "user_id": "<string|null>",
  "title": "<string|null>",
  "last_thread_id": 123,
  "created_at": "2025-01-01T12:00:00",
  "updated_at": "2025-01-01T12:01:00"
}
```

- Thread item:
```json
{
  "id": 12,
  "message_uuid": "<uuid>",
  "role": "user|assistant",
  "parent_thread_id": 11,
  "content": "<string|null>",
  "extras": {"any": "json"},
  "metadata": {"any": "json"},
  "created_at": "2025-01-01T12:00:00"
}
```

## Create Chat

- Method: POST
- Path: `/document/{document_id}/chats`
- Headers: optional user headers (`X-User-Id`, etc.).
- Body: none
- Response 200:
```json
{ "chat_id": "c4a6d2ef-1b2a-3c4d-5e6f-7890abcdef12", "status": "success", "message": "Chat created" }
```

Example:
```bash
curl -X POST 'http://localhost:8000/document/66b6e0cd2f3e3d2f9a3b1234/chats'
```

## List Chats for a Document

- Method: GET
- Path: `/document/{document_id}/chats?limit=10&offset=0`
- Response 200:
```json
{
  "chats": [
    {
      "chat_id": "c4a6d2ef-1b2a-3c4d-5e6f-7890abcdef12",
      "document_id": "66b6e0cd2f3e3d2f9a3b1234",
      "user_id": null,
      "title": null,
      "last_thread_id": 11,
      "created_at": null,
      "updated_at": null
    }
  ],
  "count": 1,
  "status": "success",
  "message": "OK"
}
```

Example:
```bash
curl -X GET 'http://localhost:8000/document/66b6e0cd2f3e3d2f9a3b1234/chats?limit=10&offset=0'
```

## Delete Chat

- Method: DELETE
- Path: `/document/{document_id}/chats/{chat_id}`
- Response 200:
```json
{ "status": "success", "message": "Chat deleted" }
```
- Response 404 when not found.

Example:
```bash
curl -X DELETE 'http://localhost:8000/document/66b6e0cd2f3e3d2f9a3b1234/chats/c4a6d2ef-1b2a-3c4d-5e6f-7890abcdef12'
```

## Update Chat Title

- Method: PUT
- Path: `/document/{document_id}/chats/{chat_id}`
- Body:
```json
{ "title": "My research session" }
```
- Response 200:
```json
{ "status": "success", "message": "Chat title updated" }
```

Example:
```bash
curl -X PUT 'http://localhost:8000/document/66b6e0cd2f3e3d2f9a3b1234/chats/c4a6d2ef-1b2a-3c4d-5e6f-7890abcdef12' \
  -H 'Content-Type: application/json' \
  -d '{"title":"My research session"}'
```

## List Threads for a Chat

- Method: GET
- Path: `/document/{document_id}/chats/{chat_id}/threads?limit=100&offset=0`
- Response 200:
```json
{
  "threads": [
    {
      "id": 10,
      "message_uuid": "4df...",
      "role": "user",
      "parent_thread_id": null,
      "content": "Hi",
      "extras": null,
      "metadata": null,
      "created_at": null
    },
    {
      "id": 11,
      "message_uuid": "9ab...",
      "role": "assistant",
      "parent_thread_id": 10,
      "content": "Hello!",
      "extras": null,
      "metadata": null,
      "created_at": null
    }
  ],
  "count": 2,
  "status": "success",
  "message": "OK"
}
```

Example:
```bash
curl -X GET 'http://localhost:8000/document/66b6e0cd2f3e3d2f9a3b1234/chats/c4a6d2ef-1b2a-3c4d-5e6f-7890abcdef12/threads?limit=100'
```

## Append Thread

- Method: POST
- Path: `/document/{document_id}/chats/{chat_id}/threads`
- Body:
```json
{ "role": "user", "parentThreadId": 11, "content": "Next question", "extras": null, "metadata": {"source":"ui"} }
```
- Response 200:
```json
{ "thread_id": 12, "message_uuid": "e11...", "status": "success", "message": "Thread appended" }
```

Example:
```bash
curl -X POST 'http://localhost:8000/document/66b6e0cd2f3e3d2f9a3b1234/chats/c4a6d2ef-1b2a-3c4d-5e6f-7890abcdef12/threads' \
  -H 'Content-Type: application/json' \
  -d '{"role":"user","parentThreadId":11,"content":"Next question","extras":null,"metadata":{"source":"ui"}}'
```

## List Messages Along a Branch

- Method: GET
- Path: `/document/{document_id}/chats/{chat_id}/messages?threadId=<id>`
- Response 200:
```json
{
  "messages": [
    {"role": "user", "content": "Hi"},
    {"role": "assistant", "content": "Hello!"}
  ],
  "pivotThreadId": 11,
  "status": "success",
  "message": "OK"
}
```

Example:
```bash
curl -X GET 'http://localhost:8000/document/66b6e0cd2f3e3d2f9a3b1234/chats/c4a6d2ef-1b2a-3c4d-5e6f-7890abcdef12/messages?threadId=11'
```

## Relationship to /document/aichat

- When calling `/document/aichat/{document_id}` without `x-chat-id`, the server creates a new chat and sets `x-chat-id` response header.
- If `x-chat-id` is provided, the server loads the prior branch (controlled by `x-thread-id` or chat’s `last_thread_id`).
- The incoming user message is stored as a new `user` thread with `parent_thread_id = pivot` and after streaming the model response is stored as an `assistant` thread with `parent_thread_id = <user thread id>`.

## Headers

- Chat session: `x-chat-id`
- Thread pivot: `x-thread-id`
