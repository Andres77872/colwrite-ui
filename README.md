# ColWrite UI

React 19 editor and research workspace built with Vite 8, Tailwind CSS 4, and TypeScript.

## Requirements

- Node.js `^20.19.0 || ^22.13.0 || >=24.0.0`
- npm `11.13.0`

Install the committed dependency graph with:

```bash
npm ci
```

## Scripts

- `npm run dev` — start the Vite development server with HMR. It listens on every interface, so it
  opens on this machine (`http://localhost:5173`) and from other devices on the local network
  (the `Network:` URL Vite prints). Use `npm run dev -- --host 127.0.0.1` to keep it local-only.
- `npm run typecheck` — typecheck the application, Vite/Vitest configuration, and test setup.
- `npm run lint -- --max-warnings=0` — run ESLint 10 with zero warnings allowed.
- `npm test` — run the Vitest suite once.
- `npm run build` — typecheck and create the production bundle.
- `npm run preview` — serve the production bundle locally.

## Document export

Document export runs entirely in the browser. The editor snapshot is rendered
once with the shared static renderer: standalone HTML is downloaded as a local
file, while PDF opens the browser's native print dialog where the user chooses
Save as PDF. Unsaved local edits are included.

There is no document-export API route, Node renderer service, internal port,
shared token, or Playwright/Chromium deployment dependency.

## Vite 8

The project uses Vite 8’s default Rolldown/Oxc toolchain, Lightning CSS processing, and
`baseline-widely-available` browser target. No Babel, esbuild compatibility layer, React Compiler,
or legacy browser target is configured.

The development proxy keeps `/api/agent` unchanged and rewrites other `/api` requests by removing
the `/api` prefix. Signing in from another device over plain HTTP needs the API's `DEV_MODE=true`; browsers
only keep its `Secure` session cookies on HTTPS or `localhost`. Local agent engines (Claude Code,
Codex) stay available only from this machine. Environment variables supplied by the OS take precedence, while `.env` provides
local fallback values. Copy `.env.example` to `.env` when local overrides are needed; the supported
variables, defaults, and browser-exposure notes are documented in
[`.env.example`](./.env.example).

## TypeScript 7/6 bridge

TypeScript 7’s native compiler no longer provides the JavaScript compiler API that lint tooling
currently consumes. The project therefore follows the dual-version compatibility approach:

- `@typescript/native` aliases `typescript@^7.0.2` and supplies the `tsc` executable used by
  `typecheck` and `build`.
- `typescript` aliases `@typescript/typescript6@^6.0.2` and supplies the JavaScript API used by
  `typescript-eslint`, plus the `tsc6` compatibility executable.

Do not add npm peer overrides for this bridge.

Document model details are in [docs/document-json.md](./docs/document-json.md).

## The assistant and the document

Every agent interaction goes through one endpoint, `POST /api/agent/chat`, and
every one of them is addressed by document id. A conversation therefore belongs
to a document, not to the app: the server stores the chat against
`document_id`, refuses a `chat_id` that belongs to a different document, and
binds the agent's `doc_edit` tool to the document the request named. The client
holds up its half of that contract in three places.

**Attachment.** A draft that has only ever existed in this browser has no id to
address, so sending the first message — or creating the first chat from the
Chats panel — saves it and attaches the conversation to the document that
results. The selection toolbar's AI actions and the inline AI Beat widget take
the same path, through `ensureRemoteDocument()`, which several callers can await
concurrently without creating the document twice. Acquiring an id is *not*
navigation: `documentSessionId` is what changes when the author actually opens
another document, and it is what the assistant panel is keyed on, so saving a
draft mid-sentence no longer discards the conversation that asked for it.

**Freshness.** Local edits reach the server on a five-second autosave. Sending a
message flushes them first, because the agent reads the stored document and
would otherwise answer about a paragraph the author had already replaced.

**Scope.** A `tool_action` names the document it was produced against, and the
review layer scopes its two halves separately. Block operations are staged only
when that id is the open document. `doc_create` is the exception that used to
look like the assistant doing nothing at all: it names the document it has just
made, which is never the one on screen, so it contributes an invitation in the
review bar — "the assistant created a new document", open it or stay — and never
an edit to the document being read.

Nothing the agent proposes is written behind the author's back. Under the
server's default `apply_mode`, `doc_edit` stages operations rather than saving
them; they arrive as `status: "proposed"` and render as accept/reject cards on
the blocks they affect. Only an accept enters editor state and the autosave
path. A server running in `auto` mode sends `status: "applied"` instead, which
the client replays as an already-committed change and adopts the version from.

## Profile and usage dashboard

The account menu in the topbar opens a second full-page surface: the profile
and usage dashboard. It renders the profile record, lifetime usage counters, a
30-day activity chart with a table twin, every document with its chat and
assistant-run counts, the tools the assistant runs, and the server-side PDF
library (upload, download, delete) — each file carrying the extraction badge
described under [PDF library](#pdf-library).

All of it comes from the ColWrite API's own `/users/me` routes rather than the
auth service, which owns only credentials and the canonical identity — so
username, email, and password are deliberately not editable there. One
`/users/me/overview` request backs the page, because every endpoint
revalidates the session and a per-widget fetch would pay that cost repeatedly
to render a single view.

The app has no router; the two surfaces are switched through
`components/layout/viewContextState.ts`, which sits inside the editor
providers so the workspace survives a round trip to the dashboard and back.

## PDF library

The Library panel in the tools rail is the author's own PDFs, served by the
API's `/users/me/resources` routes through `services/resources.ts`. It used to
keep files in the browser tab with `URL.createObjectURL` — they were gone on
reload, invisible from a second device, and invisible to the assistant, which
reads only what the server stored.

Every upload is converted to Markdown in the background, and that Markdown —
never the bytes — is what the assistant's `resource_ls`, `resource_read`, and
`resource_search` tools see. Storing a PDF and the assistant being able to
read it are therefore two different things: a scan with no text layer uploads
perfectly and is never readable. The extraction badge
(`components/common/ExtractionStatus`) is the one place that distinction is
visible, and it is deliberately worded as a consequence — "Ready", "No text" —
rather than as a pipeline stage.

The panel scopes to what the agent can actually reach:

| Scope | Shows |
| --- | --- |
| Available (default) | The saved document's recursive context: files attached directly to it, files in every active descendant of a directly attached folder, and all strict Unfiled resources. |
| Attached | Files attached directly to the document plus files inherited through directly attached folder subtrees; excludes Unfiled. |
| All | Every live PDF on the account, regardless of location. |

### Collection folders

A collection is a folder in a hierarchy. Every folder has a nullable parent;
`null` means it is top level, and the server limits root-to-leaf paths to 32
folders. The Library panel renders the hierarchy as an ARIA tree with lazy
immediate-child pages, expansion/collapse keyboard behavior, scroll-contained
breadcrumbs, and an explicit Unfiled location. Unfiled and top-level folders are
ARIA siblings; Unfiled is not exposed as the parent of the folder tree.

A saved document attaches directly to an exact folder. That one edge
dynamically grants the document every resource filed in the folder and all of
its active descendants. The UI distinguishes direct attachment from inherited
availability and names the nearest direct ancestor when the server provides it.
Parent/child overlapping direct attachments do not duplicate PDFs: recursive
context is a set of resource rows, not one copy per path. Strict Unfiled
resources remain available to every saved document's context. An unsaved
document cannot attach files or folders and has no assistant resource context;
uploads go to Unfiled until it is saved.

Folder and resource moves are live. Moving a subtree under or out of an attached
folder immediately changes inherited availability, and moving a PDF between the
current document, a folder, and Unfiled immediately changes where it appears.
Every move is available through the accessible destination picker; pointer users
can also drag folders and PDFs onto tree rows or child-folder cards. The picker
uses radio semantics, keyboard-operable folder navigation, and focus restoration,
so drag/drop is never the only way to complete a move.

Folder deletion is recursive and destructive. Opening confirmation first fetches
`GET /users/me/collections/{id}/delete-preview` and displays the server's exact
folder, PDF, document-membership, and byte counts. The user must type the folder
name before the UI calls `DELETE /users/me/collections/{id}/recursive` with all
four preview counts as optimistic preconditions. If anything moved into the
subtree after preview, the server returns 409 without deleting; the dialog shows
the refreshed counts and requires the name again. The operation permanently
deletes the selected folder, every descendant folder, PDF payload, and
extracted-text record; it does not move those PDFs to Unfiled. A non-zero
`cleanup_pending_count` is shown as a warning rather than as completed cleanup.

Searching goes through the server and is a literal substring match over the
extracted text, so a match carries a character offset the panel opens the
reader at. Files whose text was not ready are reported rather than dropped:
zero matches over a library that is still converting is a different answer
from zero matches over one that was fully readable. Search follows the server's
25-resource pages through `next_offset`, and mutation paths clear scoped results
that can no longer be authoritative. Folder-view searches use the
folder's recursive subtree, while assistant `resource_ls`, `resource_read`, and
`resource_search` calls are fail-closed to the current saved document's recursive
context. Optional folder/resource filters can narrow that context but cannot
switch the assistant to the account-wide library. If the document has no active
server reference, the tools return no resource data.

### Backend compatibility and rollout

The nested Library UI requires the backend collection endpoints for tree pages,
child creation, details/paths, parent moves, delete previews, recursive deletes,
and direct document attachments:

- `GET /users/me/collections/tree`
- `POST /users/me/collections/{id}/children`
- `GET /users/me/collections/{id}/detail` and `/{id}/path`
- `PUT /users/me/collections/{id}/parent`
- `GET /users/me/collections/{id}/delete-preview`
- `DELETE /users/me/collections/{id}/recursive`
- `PUT` / `DELETE /users/me/collections/{id}/documents/{document_id}`

Deploy the migrated MySQL schema and backend before this UI. The database rollout
adds `parent_id`, owner-safe unique/foreign-key relations, recursive procedures,
and legacy stale-link repairs. No new `VITE_*` variable or frontend feature flag
is required; the existing `VITE_API_BASE` must simply route these endpoints to a
compatible backend.

## Research providers and agent tools

Profile → Agent tools loads the server-owned capability catalog and lets the
account select every writing, research, PDF-library, and document tool. It also
controls paper-search sources used by the agent, citation picker, and research
rail. Until that request succeeds, all optional integrations fail closed.

arXiv is enabled by default. Semantic Scholar is explicit opt-in and remains
off for new and legacy accounts; its rail panel is hidden and no new request is
made until enabled. Existing Semantic Scholar citation metadata remains
renderable and removable. When selected, requests leave the browser only
through the authenticated ColWrite API at
`/api/research/semantic-scholar/*` (the development proxy maps that to the
backend's `/research/semantic-scholar/*` routes); no Semantic Scholar API
origin or credential is exposed in the Vite/browser environment.

The provider mark is bundled locally and its attribution backlink is ordinary
user navigation, not an API request. Enabled results can be explored through
citation, reference, and recommendation graphs. The same panel can assess one
precise claim against retrieved excerpts while preserving the backend's
calibrated verdict, confidence, evidence, limitations, and disclaimer.
