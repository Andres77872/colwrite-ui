# Document history (v2 revisions API)

The editor's History panel is backed by the versioned `/v2/documents` surface.
Every accepted write — create, save, agent edit, delete — appends one
immutable, independently restorable snapshot server-side. Restore is the
exception: it moves the document onto an existing snapshot instead of writing
a new one, which makes the history a **tree** rather than a straight line. The
endpoints below read that tree and move the document within it.

Client code: `src/services/documentHistory.ts` (service),
`src/components/panels/HistoryPanel/` (UI, registered as the `history` tool).

## Contract differences from the legacy `/document/*` endpoints

- **Strong ETag concurrency.** Reads return an `ETag` response header
  (`cw:{serializer}:{schema}:{head_seq}:{content_hash}`). Every v2 write must
  echo it back as `If-Match`; a mismatch is `412` with code `stale_head`.
  `src/services/api.ts` exposes `getWithHeaders`/`postWithHeaders` for this —
  the plain helpers discard headers.
- **Idempotency.** Every v2 write requires an `Idempotency-Key` header. The
  service generates a UUID per attempt.
- **Errors are `application/problem+json`**: `{ type, title, status, detail,
  instance, code, retryable, ... }`. `historyErrorCode(error)` reads `code`
  from an `ApiError`; `retryable: true` codes today are `history_not_ready`
  and `document_rate_limit_exceeded`. Validation failures (422, code
  `document_validation_failed`) also carry an `errors` array of
  `{ loc, msg, type }`.

## Endpoints consumed

| Call | Endpoint | Notes |
|---|---|---|
| `fetchDocumentHead(id)` | `GET /v2/documents/{id}` | Current state + `ETag`; `current_revision_id` names the tree node the head sits on. |
| `listRevisions(id, {limit, cursor})` | `GET .../revisions?limit=&cursor=` | Metadata only, newest first, opaque cursor, `limit` 1–100 (default 50, panel uses 30). |
| `getRevision(id, revId)` | `GET .../revisions/{revId}` | Metadata + full snapshot (`content`). |
| `diffRevision(id, revId, against)` | `GET .../revisions/{revId}/diff?against=` | `against` is another revision id or `current`. Structural changes keyed by stable block/child ids. |
| `restoreRevision(id, revId, {etag?, summary?})` | `POST .../revisions/{revId}/restore` | Moves the current-version pointer; returns the post-restore head state (with a new `ETag`). The optional body `{ "summary": "..." }` is recorded on the restore's audit event — restore writes no revision, so it never appears in the timeline. |

Not consumed yet: `GET .../revisions/export` (bulk snapshot export, rate
limited) and the `/change-sets` endpoints (the assistant's proposals reach the
client over the chat stream instead).

## Semantics the UI relies on

- **Snapshots, not deltas.** A revision's `content` is complete and immutable.
  No user action rewrites or removes a revision, so nothing is lost by moving
  the document between them.
- **Restore is a pointer move, not a write.** `POST .../restore` creates no
  revision. It points the head at the chosen revision and swaps the head's
  working content to that snapshot, so the timeline gains no row. The response
  body *is* the post-restore head — the caller must adopt its `content` and
  `head_seq` (`adoptRestoredDocument(content, headSeq)` — see `EditorContext`)
  rather than keep the pre-restore document.
- **`head_seq` still advances on a restore.** The concurrency position is
  strictly monotonic for every head mutation, restore included: `head_seq`
  goes up by one and the `ETag` changes. Anything still holding the old ETag
  gets `412` `stale_head` on its next write, which is the intended fence.
  Restoring the revision the head already sits on is a no-op — same state,
  same `head_seq`, same ETag.
- **The next save branches.** Every append writes a revision whose
  `parent_revision_id` is whatever the pointer currently names. After a
  restore that parent is the restored node, so the next save forks the tree —
  the restored node ends up with two or more children. With no restore in
  between, the parent is just the previous revision and history stays linear.
- **`current_revision_id` is "you are here".** Head responses (`GET
  /v2/documents/{id}` and every mutation response) carry it;
  `DocumentHead.currentRevisionId` normalizes the field and falls back to
  `revision_id` for heads written before the branching model. It is *not*
  necessarily the newest revision — after a restore it points backwards — so
  the "Current" marker must follow this field, never the top row of the list.
- **Version numbers are creation order, not tree position.** `revision_no` is
  the user-visible ordinal (`v3`), allocated when a revision is created and
  never renumbered; `listRevisions` returns newest-first by that ordinal.
  Lineage — and therefore the tree — comes only from `parent_revision_id`: a
  branch created after a restore still gets the next global ordinal even
  though its parent is an older one. `head_seq` equals the legacy
  `Doc.version` and is unrelated to `revision_no`.
- **Restore flow.** The panel saves pending local edits first (their own
  revision on the current branch), then restores; `restoreRevision` fetches a
  fresh `ETag` immediately before the POST, so a `412` means a genuine
  concurrent write. Work staged against the pre-restore version — in-flight
  agent streams and unsettled proposals — is no longer valid against the new
  head and is discarded client-side.
- **`kind`/`origin`.** `kind` ∈ `create | save | semantic_edit | restore |
  delete | migration | history_backfill`; `origin: "agent"` marks
  assistant-authored revisions (shown with an Assistant badge). Restores no
  longer produce a `kind: "restore"` revision, but documents restored under
  the old append-only model still carry those rows (with
  `restored_from_revision_id` set) and must keep rendering.
- **Deletes are revisions too.** Soft-deleting a document writes a
  `kind: "delete"` revision and keeps the history readable, so a trashed
  document can still be diffed and restored — restore un-deletes as part of
  the same pointer move.

## Legacy endpoints under the new backend

Two legacy-contract changes matter to this client (both handled in
`src/services/documents.ts`):

- The canonical content model rejects unknown fields (`extra="forbid"`).
  Payloads send only `{ version, blocks, name?, tags? }` — the old `title`
  alias and caller extras are stripped client-side (and the server's
  compatibility adapter tolerates `title` from older clients).
- `DELETE /document/delete/{id}` now requires a precondition: `?version=N`
  or an `If-Match` ETag. `deleteDocument` passes the caller's known version,
  or fetches the current ETag when it has none.
