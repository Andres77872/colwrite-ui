# Editor deep review

> **Superseded by `docs/editor-review-2026-08.md` (2026-08).** This review was
> written against pre-`427f72d` code; several findings below are already fixed.
> Kept for history — refer to the newer review for current status.

Read in full: `src/components/editor/**` and `src/editor/**` (83 files, ~12k lines),
plus `common/Editable`, the editor tests, `services/streamParser.ts`,
`services/agentChat.ts`, `lib/diff.ts`, and `docs/inline-components/*`.

Findings marked **[verified]** were reproduced directly — by executing the logic
or by reading the exact lines — rather than taken on trust. Nothing in `src/` was
modified.

---

## Critical

### 1. `ChatMarkdown` locks the tab on ordinary model output **[verified]**
`ChatAssistant/ChatMarkdown/ChatMarkdown.tsx:115` vs `:162-171`

The fence detector is `/^```(\w*)\s*$/` — the info string must be a single word.
The paragraph loop excludes **any** line starting with ` ``` `. A fence the
detector rejects reaches the paragraph branch, is excluded by the `while`
condition, so `index` never advances: `blocks` grows without bound inside a
render function. No error boundary can catch a non-terminating render.

Reproduced by replaying the loop:

| Input | Result |
|---|---|
| ` ```python ` | ok |
| ` ```py extra ` | **hang** |
| ` ``` python ` (space before lang) | **hang** |
| ` ```js title="a.js" ` | **hang** |
| ` ```diff patch ` after prose | **hang** |
| ` ```py t ` (mid-stream partial) | **hang** |
| ` ```bash (run this) ` | **hang** |

Any reply containing ` ```bash (run this) ` or ` ```json schema ` is a
client-side DoS. **Fix:** use the same fence regex in both places, or advance
`index` when `paragraph.length === 0`.

### 2. `Ctrl+S` reports a save that never reaches the server **[verified]**
`EditorContext.tsx:710-714`, bound at `useAppShortcuts.ts:29,36`

```js
const save = () => { saveDoc(doc); saveDocumentId(documentId); setLastSavedAt(Date.now()); };
```

localStorage only — the real server save is a different function, `saveRemote`
(`:483`). But `lastSavedAt` is exactly what `DocumentHeader.tsx:137-147` renders
as `Saved 14:31`. The shortcut is labelled "Save now" and is deliberately exempt
from the modal guard. It also never sets `lastSaveSource`, so after any autosave
it reads **"Autosaved 14:31"** — a save that did not happen.

### 3. `docOverride` bypasses the cross-document write guard **[verified]**
`EditorContext.tsx:418-431`

The comment states the invariant — *"Never write the in-state body to a document
it did not come from"* — and the guard immediately below exempts it:

```js
if (!docOverride && loadedForIdRef.current !== targetId) return;
```

`targetId` is read *after* `await pendingSave`. Renaming the title (which passes
an override) while a save is in flight, then opening another document, resumes
with `targetId = B` and PUTs **document A's blocks to B**. Because `versionRef`
has already moved to B, the optimistic lock passes instead of catching it.

### 4. Every inline widget is destroyed on any focus change — and can vanish for good
`common/Editable/Editable.tsx:57-76` + `ParagraphBlock.tsx:48-61`

`Editable`'s layout effect has `activeId` in its deps, so it re-runs in every
block when the active block changes, and for inactive blocks does
`if (el.innerHTML !== next) el.innerHTML = next`. For a paragraph containing a
widget those two can *never* be equal — the live DOM holds React's rendered
widget, `block.html` holds the placeholder span emptied by
`clearChildPlaceholders`. So it always reassigns, detaching the node React has
portalled into.

`ParagraphBlock`'s recovery observer then tests `hasAttribute('data-child-id')`
on the mutated nodes themselves. `innerHTML =` reports only *top-level* changes,
so when the placeholder sits inside a `<div>` wrapper — what Chrome produces
after Enter — the added node is the `<div>`, the mutation is judged irrelevant,
and **the widget disappears until `block.children` changes identity**.

Lost on every remount: open popovers, citation search results, AI Beat's
streamed buffer and its `AbortController`, table caret, chart hover.

### 5. An unknown `child.type` crashes the whole canvas **[verified]**
`ParagraphBlock.tsx:85`

`INLINE_WIDGETS` is a `Record` over the five known types with no runtime guard.
For anything else `Widget` is `undefined` and React throws *"Element type is
invalid"*, unmounting `Canvas`. Reachable from `docOps.ts:137` (`replace_block`
splices `op.block` in with no `coerceBlock` at all), from `coerceBlock` itself
(which never validates `type`), and from `setFromJSON`. So an agent tool call, a
pasted document, or a stale draft carrying `{type:'footnote'}` takes the editor
down — and `docs/inline-components/footnote-inline.md` claims such children
"will not render", which is precisely what they fail to do safely.
**Fix:** `if (!Widget) return null;` plus a `type` check in `coerceBlock`.

---

## High

### 6. A literal `/` can never be typed in body text **[verified]**
`common/Editable/Editable.tsx:159-164`

`preventDefault()` is unconditional — no word-boundary check — and nothing
anywhere re-inserts the character (grep confirms no `insertText` in the slash
path). Dismissing the menu restores the caret but not the `/`.

For an arXiv writing tool this blocks DOIs (`10.1000/xyz`), URLs, `and/or`,
`m/s`, and dates. Paste is the only workaround. Headings are unaffected —
`slashEnabled` is passed only by `ParagraphBlock`.

### 7. Pasting prose with a comma shreds it across table cells **[verified]**
`Inlines/TableInline/tableGrid.ts:62,67`

```
"In this work, we show that"        -> [["In this work"," we show that"]]
"First, a claim.\nSecond, another." -> [["First"," a claim."],["Second"," another."]]
```

The delimiter heuristic accepts `,` whenever every line contains one, and the
`width < 2 && grid.length < 2` guard cannot fire because `width` is always ≥2
once a split happened. `onCellPaste` calls `preventDefault()`, so the sentence is
split and the neighbouring cell is clobbered. The existing test uses
`'just some prose'` — no comma — so it passes. Genuine CSV with quoted commas is
mis-split too.

### 8. Server/agent HTML reaches `innerHTML` unsanitized
`common/Editable/Editable.tsx:62,65,104`

`block.html` flows from `coerceBlock` and from `replace_block` (not even coerced)
straight to `innerHTML`. `<script>` will not run, but `<img src=x onerror=…>`,
`<svg onload=…>` and `<iframe src="javascript:…">` will.
`docs/inline-components/citation-inline.md:102` states "Model output is never
inserted as HTML" — true of the floating-toolbar path, not of the document
tool-op path.

### 9. An in-flight stream survives a document switch and edits the wrong document
`ChatAssistant.tsx:341-436`, `ProposalsContext.tsx:47,72-78`

`send()` creates an `AbortController` that nothing aborts on unmount. Switching
documents remounts the assistant but leaves the stream running with closures over
the old `proposals`. `receive` never checks `action.documentId`, so `tool_action`
frames for document A are staged against B — and `status:'applied'` frames are
applied directly. Two fixes needed: abort on unmount, and filter by document id.

### 10. `slashMenuOpen` latches true and permanently kills the floating toolbar
`slashMenuEvents.ts:23`, `SlashMenu.tsx:177-179,267-272`

`openSlashMenu` broadcasts visibility *before* the menu agrees to open, and only
`SlashMenu`'s `visible` effect resets it — which never runs if `openAtCaret` took
any of its five early returns. The flag then sticks for the session: the
format/AI toolbar never appears again, and the active-block highlight never
clears. Unmounting while visible latches it the same way.

### 11. Editing during an AI suggestion writes its raw markup into the document
`FloatingToolbar.tsx:264-296` vs `common/Editable/editableHtml.ts:5-17`

`persistPreSuggestion` strips `.ai-suggest` on the AI-side writes, but
`Editable`'s own `onInput` → `serializeEditableHtml` has no `.ai-suggest`
handling. Typing anywhere in the paragraph while a suggestion is pending stores
html containing `<span class="ai-suggest">` and three `<button>`s, and autosave
PUTs it. On reload the author gets dead ✓/✕ buttons and permanent strike-through.
Accepting one suggestion while a second is live bakes the second in the same way.

### 12. Rendered equations are invisible to assistive technology
`EquationInline.tsx:120-127`, `lib/katex.ts:86-91`

`renderLatex` passes `output: 'html'`, so KaTeX emits only
`<span class="katex-html" aria-hidden="true">` and omits the MathML it would
produce under `htmlAndMathml`. Injected via `dangerouslySetInnerHTML`, so **100%
of every equation's rendered content is `aria-hidden`**. The accessible name
falls back to `title` — "Edit equation" — for every equation in the paper. Tests
miss it because jsdom has no `window.katex`, so they assert the plain-text
fallback. **Fix:** `output: 'htmlAndMathml'` plus an `aria-label` from the source.

### 13. Dropping text anywhere on the canvas is silently swallowed
`Canvas.tsx:336-350`

The capture-phase drop handler falls back to `text/plain`, so *any* text drag
yields a non-empty `fromId`, `preventDefault()` cancels the native insertion, and
`findIndex` then returns `-1` — nothing happens, no feedback. The fallback is
unnecessary: `BlockControls.tsx:169-170` already sets both MIME types.

---

## Medium (selected)

- **Per-change accept ignores `ProposedChange.order`** (`ProposalsContext.tsx:131-139`)
  — the module's own comment says replaying out of order puts inserts in the
  wrong place. `order` and `producesBlockId` are dead fields.
- **No block-id uniqueness check on insert** (`docOps.ts:118-126`) — a re-delivered
  batch under a fresh `toolCallId` duplicates ids; every lookup is `findIndex` by
  id, so edits hit one copy and deletes remove both.
- **`applyPatch`'s return value is read from inside a `setState` updater**
  (`EditorContext.tsx:663-685`) — only valid on React's eager path; in a batch it
  returns the initialiser, silently swallowing desync reports.
- **`loadRemote` has no abort or sequencing** (`EditorContext.tsx:487-502`) —
  last *response* wins. `DocumentsMenu` does this correctly for a mere list fetch.
- **`addBlockAfter` inserts at the top when the anchor is gone**
  (`EditorContext.tsx:222-235`) — `idx === -1` → `splice(0,0,…)`.
- **Accept is offered for changes that cannot apply** (`ChangeCard.tsx:194-214`) —
  and marks them accepted anyway.
- **Negative/decimal chart values cannot be typed** (`GraphInline.tsx:134-142`) —
  `Number(e.target.value) || 0` writes `0` on the first `-` or `.`.
- **Non-finite values desync labels then delete them** (`GraphInline.tsx:33-36`) —
  `values` is filtered, `labels` is not; the next edit persists the mismatch.
- **Arrow-keys between table cells select the whole cell** (`TableInline.tsx:101-107`).
- **"Insert row above" on the header row blanks the headings** (`TableInline.tsx:306-312`).
- **Numeric citations number occurrences, not sources** (`CitationInline.tsx:199-210`)
  — citing one source three times gives `[1] [2] [3]`. `'ieee'` is a no-op option.
- **`streamParser`**: a bare `data:` line inherits the previous typed event
  (`:110-135`); CRLF streams never dispatch at all (`:89`); multiple `data:` lines
  in one block lose all but the last (`:101-107`).
- **AI Beat leaks its stream on unmount** (`AiBeatInline.tsx:38`) — with finding 4,
  that happens on every click elsewhere.
- **"Try again" replays a stale message** and deletes two unrelated transcript
  rows (`ChatAssistant.tsx:445-452`); `lastSent` is never cleared.
- **`useChatWindow`'s clamp effect never attaches** (`useChatWindow.ts:223-241`) —
  the panel is unmounted when it runs and its deps never change.

## Accessibility

- **Headings have no heading semantics** (`HeadingBlock.tsx:9-19`) — a
  contenteditable `<div>` with a font size. No `<h1>`/`<h2>`/`<h3>`, no
  `role="heading"`, no `aria-level` anywhere in the editor. The document outline
  — the primary navigation for screen-reader users in a long paper — does not exist.
- **The word diff is colour-only** (`ChangeCard.tsx:48-77`) — bare `<span>`s, so a
  screen reader reads old and new concatenated: *"In this paper, weWe show that…"*.
  Use `<del>`/`<ins>`.
- **"Next/Previous change" scrolls but never moves focus** (`ProposalsContext.tsx:192-199`).
- **Segmented controls are unreachable by keyboard** (`BlockControls.tsx:26-67`) —
  raw `<button>`s inside Radix menu content: Tab is `preventDefault`ed by the menu
  and arrows only visit registered `Menu.Item`s. Mouse only.
- **Hand-rolled buttons have no focus ring** — `FloatingToolbar.tsx:466-481`,
  `BlockControls.tsx:48-62,130-141,158-174`, `Canvas.tsx:458-472` all style only
  `hover:`. `buttonVariants` bakes the ring in; these opt out. WCAG 2.4.7.
- **Cartesian charts expose no data** (`ChartFigure.tsx:142-147`) — `aria-label` is
  "bar chart with 4 values"; hit targets are mouse-only. The pie legend is fine.
- **Streaming output announced token-by-token** (`AiBeatInline.tsx:219-232`) — an
  `aria-live` container replaced on every SSE token floods the speech queue.
- **Nothing announces agent progress** (`ChatAssistant.tsx:703-711`) — the status
  line is a plain `<p>`; the one real live region dumps the entire finished reply,
  and re-fires it when switching conversations.
- **Block reorder is drag-only** (`Canvas.tsx:336-350`) — `moveBlock` exists in the
  context and no menu item calls it; the `aria-label` advertises "drag to reorder"
  to users who cannot drag.

## Design-system consistency

Good: the blocks/inlines area has **no raw hex or `rgba()` in any of its twelve
files** — everything goes through `--color-series-*`, `--color-chart-*`,
`bg-card`, `text-muted-foreground`. The review flow uses the `--color-diff-*`
tokens correctly throughout. The Radix migrations in `Canvas`/`BlockControls` are
real.

Divergences worth fixing:
- Icon buttons hand-roll `h-7 w-7` / `h-6 w-6` where `size="icon-sm"` /
  `"icon-xs"` already exist — adopting `Button` also fixes the missing focus rings.
- Native `title=` instead of the `Tooltip` primitive, despite a `TooltipProvider`
  being mounted app-wide at `main.tsx:19` for exactly this.
- `AiBeatInline.tsx:129-166` re-implements `InlineFigureShell`; `ChatRefPicker`
  hand-rolls a popover rather than composing `ui/popover`.
- `DocumentsMenu.tsx:221-232` hand-rolls a `<select>` with a copied `input` class
  string, because `Select.tsx` was deleted in `dd7714f`. The one real primitive gap.
- The floating toolbar and the change card are each duplicated as static mocks in
  `landing/mocks.tsx`, which will drift.

## Things that are clean

- **`citationTags.ts`** — attribute allowlist, whole-transform rejection on any
  malformed tag, `http(s):` only, and model output never parsed as HTML
  (`createTextNode` + empty placeholders only). Tests cover the `javascript:` and
  `onclick` cases. No findings.
- **`ChatMarkdown`'s XSS posture** — no `dangerouslySetInnerHTML`, `^https?://`
  allowlist with non-matching hrefs degrading to text, `rel="noreferrer noopener"`,
  no ReDoS. The only defect in the file is the loop above.
- **`applyPatchToBlocks` index math**, `withoutOrphanChildren`, `lib/diff.ts`,
  `storage.ts` keying, `DocumentsMenu`'s abort+sequence fetching, `items/*.ts`
  range safety, `AIActionMenu`'s Radix composition, `useChatWindow`'s geometry,
  `toolMeta.ts`, and `parseRefParts`/`parseRefs` — all verified correct.
