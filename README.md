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

HTML, PDF and Markdown export run entirely in the browser. The editor snapshot
is rendered once with the shared static renderer: standalone HTML is
downloaded as a local file, while PDF opens the browser's native print dialog
where the user chooses Save as PDF. Unsaved local edits are included.

There is no Node renderer service, internal port, shared token, or
Playwright/Chromium deployment dependency. LaTeX alone comes from the API
(`GET /workspaces/{workspace_id}/documents/{document_id}/export?format=tex`),
which renders the saved page, so the dialog saves pending edits first.

## Vite 8

The project uses Vite 8’s default Rolldown/Oxc toolchain, Lightning CSS processing, and
`baseline-widely-available` browser target. No Babel, esbuild compatibility layer, React Compiler,
or legacy browser target is configured.

The development proxy keeps `/api/agent` unchanged and rewrites other `/api` requests by removing
the `/api` prefix. It forwards them to `COLWRITE_API_URL`, which defaults to the production API
`https://colwrite-api.novus.chat`; set `COLWRITE_API_URL=http://127.0.0.1:5002` in `.env` to use a
backend on this machine. `npm run preview` uses the same proxy. A production deployment of the
bundle still needs its own same-origin `/api` route with these rules, or an absolute
`VITE_API_BASE` that the API allows through `CORS_ALLOWED_ORIGINS`.

Against a remote API the proxy sends the API's own host name, rewrites the refresh cookie's path to
`/api/auth`, and forwards the assistant WebSocket from this dev page with the session cookie as a
Bearer credential instead of the page's Origin, which the deployed API would refuse. Signing in from
another device over plain HTTP needs the API's `DEV_MODE=true`; browsers
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

Every agent interaction runs over the assistant WebSocket, and every one of
them is addressed by workspace and page id. A conversation therefore belongs
to a page, not to the app: the server stores the chat against the page,
refuses a `chat_id` that belongs to another page, and binds the agent's
`doc_edit` tool to the page the request named. The client holds up its half of that contract in three
places.

**Attachment.** A page that has only ever existed in this browser has no id to
address, so sending the first message saves it and attaches the conversation
to the page that results. The selection toolbar's AI actions and the inline AI
Beat widget take the same path, through `ensureRemoteDocument()`, which several
callers can await concurrently without creating the page twice. Acquiring an id
is *not* navigation: `documentSessionId` is what changes when the author opens
another page, and it is what the assistant panel is keyed on, so saving a page
mid-sentence keeps the conversation that asked for it.

**Freshness.** Local edits reach the server on a five-second autosave. Sending a
message flushes them first, because the agent reads the stored page and would
otherwise answer about a paragraph the author had already replaced.

**Scope.** A `tool_action` names the page it was produced against. Its change
set is staged only when that id is the open page. `doc_create` names the page
it has just made, which is never the one on screen, so it adds an invitation in
the review bar ("the assistant created a new page": open it or stay) and never
an edit to the page being read.

Nothing the agent proposes is written behind the author's back. `doc_edit`
always stores one change set; it arrives as `status: "proposed"` with its
`change_set_id` and renders as accept/reject cards on the blocks it affects.
Only an accept enters editor state and the autosave path. With **Auto** on in
the composer (off by default, behind a warning), the editor applies the sets
the server marks `apply_policy: "auto"` itself, one undo step each; see D18 in
`docs/workspace_collection/04-domain-model-and-decisions.md`.

## Settings

Settings opens from the sidebar as a dialog over the editor (`?view=settings`),
with six panes: Account, Preferences, AI & tools, Workspace, Members, and
Usage.
Workspace holds the workspace's name, icon and top-level order, its policy
(switching web search, outside research or Auto off for everyone in it), an
export of every page as a zip, and, for the owner of a shared workspace,
Delete (the name typed, restorable for 30 days); the deleted workspaces are
listed there with Restore. Members lists who is in a shared workspace and
their roles; admins change roles, remove people, and invite by link (the API
sends no email: the link is shown once, to copy and share), the owner can
hand the workspace to another member, who accepts it, and everyone but the
last owner can leave. Usage shows the lifetime counters, a 30-day
activity chart with a table twin, activity by page, the tools the assistant
ran, and storage, with a link that opens the Library; its scope switch shows
"This workspace" or "All workspaces". Account ends with Delete account.
Settings lists no pages and no PDFs: those live in the sidebar and the Library.

All of it comes from the ColWrite API rather than the auth service, which
owns only credentials and the canonical identity — so username, email, and
password are deliberately not editable there. Account reads and saves the
person (`GET` and `PATCH /users/me`); Workspace reads the workspace being
shown (`GET /workspaces/{workspace_id}`); Members reads its members and,
for an admin, its pending invitations; Usage reads that workspace
(`GET /workspaces/{workspace_id}/usage`) or every one (`GET /users/me/usage`).
One request backs each pane,
because every endpoint revalidates the session and a per-widget fetch would
pay that cost repeatedly to render a single view.

The app has no router. The URL (`?ws=`, `?doc=`, `?view=`, and an invitation
link's `?invite=`, accepted before the workspace is chosen) is the navigation
state, kept by `NavigationProvider` (`components/layout/NavigationContext.tsx`),
which sits above every provider that holds workspace or page state.

## Workspaces

Everything the author writes lives in a workspace: pages, chats, PDFs and
collections. Every account has a personal one. `WorkspaceProvider`
(`components/workspace/`) chooses the workspace at sign-in — the one a `?doc=`
link's page is in, then `?ws=`, then the one the server remembers, then the
one this browser last showed, then the personal one — writes it as `?ws=` and
tells the server (`PUT /users/me/last-workspace`). Everything below
`WorkspaceScope` belongs to that workspace and remounts when it changes; a
switch saves the open page first and drops the old workspace's cached reads.
An empty workspace opens "Start your first page" from its page count, with no
page-list request.

The sidebar's header is the workspace switcher: the account's workspaces (the
one shown checked), "New workspace…" and "Workspace settings", then the
account's own menu; the palette (Mod+K) switches too. A switch is a history
entry, so Back returns. A page link into another of the author's workspaces
opens there ("Opened in ‹workspace›"); one they cannot open says "This page
isn't available". Inside a page or a chat, a link to a page of another
workspace says so, with Open. "Copy to workspace…" in a page's menu is the one
way a page crosses: its content and, if chosen, its PDFs; never its history,
chats or review notes. When the workspace list loads, what this browser kept
for workspaces the account no longer has is removed.

A shared workspace has members with roles (owner, admin, editor, viewer). The
switcher says "Shared" when someone else is in a workspace, and the account's
role where it is not the owner. A viewer reads every page, PDF and version
and can ask the assistant, but the page is read-only for them: nothing is
ever saved, the canvas and title cannot be edited, suggestions can be read
but not accepted or rejected, Auto is off ("Viewers can't use Auto"), and
the tree, Library, page menu and Trash leave out what writes; the topbar
says "View only". A role changed elsewhere arrives with the next read of the
workspace; a demotion while a page is open keeps its unsaved edits on this
device and says so.

## Pages and collections

The sidebar's **Pages** section is the workspace's tree
(`components/layout/Sidebar/PagesTree/`): collections and pages, each
collection opening to its own collections and then its pages, in the order
its home is in (by name, by hand, or pages by their last edit). Above it,
**Recent** lists the five pages edited last. Each open branch is two list
requests, read a page of 50 rows at a time with a "Show more" row; the open
page is revealed and marked, and the open collections are remembered per
workspace. Typing in the filter swaps the tree for workspace-wide results with
each page's path. The tree follows changes made elsewhere through the
workspace's `tree_version`, read on focus and every minute.

A page lives in one collection, or at the top level. Pages, collections and
PDFs move with **Move to…** (`components/collections/MoveToDialog.tsx`), with
Move up and Move down in a home ordered by hand, and by dragging, which is
never the only way. Every move goes through `useMoveTo`
(`src/actions/useMoveTo.ts`): the row moves at once, the move is locked on the
row's ETag, a move refused because someone moved it first (412) reads the tree
again and is not retried, and a toast says where it went with **Undo**. Moving
the open page never touches its content ETag, so it keeps saving. The page
topbar's breadcrumb (Workspace › … › collection › page) follows a move, and a
collection crumb shows that collection in the tree. "New page" creates the
page in the open page's collection; a collection's "+" creates it there.

## PDF library

The Library tab in the right sidebar is the workspace's PDFs, stored by the
API and read through `src/data/resources.ts`. Files live on the server, so
they are there on reload and on another device, and the assistant reads what
the server stored.

Every upload is converted to Markdown in the background, and that Markdown —
never the bytes — is what the assistant's `resource_ls`, `resource_read`, and
`resource_search` tools see. Storing a PDF and the assistant being able to
read it are therefore two different things: a scan with no text layer uploads
perfectly and is never readable. The extraction badge
(`components/common/ExtractionStatus`) is the one place that distinction is
visible, and it is deliberately worded as a consequence — "Ready", "No text" —
rather than as a pipeline stage.

The Library has two views:

- **Used by this page**: the PDFs the page's assistant can read, grouped by
  why: on this page, from a collection the page uses ("Use on this page"), or
  Unfiled.
- **Browse**: a breadcrumb and a list over the same collections as the
  sidebar tree, with Unfiled and All PDFs. Inside a collection it lists its
  pages, its sub-collections and its PDFs; a tree row's PDF count opens Browse
  there. A collection can be used on this page, renamed, moved, given
  sub-collections or moved to the Trash.

One search box switches between **Names** and **Inside PDFs**. Searching inside
goes through the server and is a literal substring match over the extracted
text, so a match carries a character offset the reader opens at; PDFs whose
text was not ready are reported rather than dropped. The upload control always
shows where a file goes ("Upload to: this page"). Every action that needs a
saved page saves it first.

A collection is a folder: a PDF has one place (a page, a collection or
Unfiled), and a page can use a collection's PDFs, which includes every
collection inside it. A page's home says where it is listed, not what its
assistant reads: a page in a collection with PDFs is offered them in the
composer ("Use this collection's PDFs on this page", once per page), and a
collection's "Pages here can use these PDFs" gives every page placed in it
that grant, shown as "Used via ‹collection›" and taken away when the page
leaves. Moving a collection or a PDF changes what a page's assistant can read
at once. Nothing is deleted at once: pages, collections and PDFs go to the
workspace's Trash, with an undo toast, and stay restorable for 30 days.
Moving a collection there first shows the server's counts of what goes with
it; the request sends those counts back, and when anything changed in
between the new counts are shown to confirm again. The Trash (the sidebar's
Trash row, or "Trash" in the palette) restores anything, and lets an admin
delete an item forever or empty it, after typing its name.

## Research providers and agent tools

Settings → AI & tools loads the server-owned capability catalog and lets the
account select every writing, research, Library and page tool. It also
controls paper-search sources used by the agent, citation picker, and research
rail. Until that request succeeds, all optional integrations fail closed.

arXiv is enabled by default. Semantic Scholar is explicit opt-in and off until
the account turns it on; its Research source is hidden and no new request is
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
