# Editor deep review — August 2026

Supersedes `docs/editor-review.md` (written against pre-`427f72d` code). Six of the
prior review's thirteen findings have been fixed since; the seven still open are
folded into this document with their original numbers noted.

Method: four parallel deep-dives over `src/editor/**`, `src/components/editor/**` +
`src/components/common/Editable/**`, `src/services/**` + `src/export/**` +
`ChatAssistant`, and cross-cutting concerns (a11y, tests, config, docs). Headline
claims were verified by reading/executing the exact lines cited.

Each finding lists its remediation phase (see bottom). Status column is filled in as
fixes land.

---

## Critical

### C1. `ChatMarkdown` infinite loop on common code fences — tab-locking DoS [verified]
`src/components/editor/ChatAssistant/ChatMarkdown/ChatMarkdown.tsx:115` vs `:162-171`

The fence detector is `/^```(\w*)\s*$/` — the info string must be a single word —
but the paragraph loop excludes **any** line starting with ` ``` `. A fence like
` ```bash (run this) `, ` ``` python `, or a mid-stream partial matches neither
branch: `index` never advances and the render loops forever. No error boundary can
catch a non-terminating render. Reachable from ordinary model output.
**Fix (Phase 1):** unify the fence regex, or advance `index` when the paragraph
comes up empty. Regression test with the hang-inducing inputs.

### C2. Stored XSS: no HTML sanitization on any ingest path into editor state [verified]
`src/components/common/Editable/Editable.tsx:62`, `src/editor/docOps.ts:92-151`

`Editable` assigns `el.innerHTML = next` for every inactive block; upstream,
`coerceBlock`/`reconcileBlocks` keep `html` verbatim from server loads, restores,
`setFromJSON`, and agent ops. There is **no paste handler** on `Editable`, so
browser-default paste drops arbitrary clipboard HTML into the DOM, `onInput`
serializes it into state, and it round-trips to localStorage + server and is
re-injected on every later mount. The app already owns `sanitizeInlineFragment`
(`src/export/sanitize.ts:98`) but only applies it to export and the proposal
*preview* (`ProposedBlockView.tsx:63`) — so a prompt-injection payload in an agent
op is hidden by the sanitized preview, then executes in the app origin once
accepted (auto-applied batches skip even the click).
Secondary sink: detached-div `innerHTML` text extraction in
`ChatRefTags/ChatRefTags.tsx:13-15` and `ChatRefPicker/ChatRefPicker.tsx:162-164`.
**Fix (Phase 1):** sanitize at the model boundary (inside `coerceBlock`), add an
`onPaste` handler on `Editable`, replace detached-div extraction with the
string-based `blockText()` from `src/editor/proposals.ts:675`.

### C3. Ctrl+S reports a remote save that never happened [verified; prior #2]
`src/editor/EditorContext.tsx:1055-1060`, bound at
`src/components/layout/Shortcuts/useAppShortcuts.ts:29,36`

`save()` writes localStorage only, yet sets `lastSavedAt`, which
`DocumentHeader.tsx:139-146` renders as "Saved/Autosaved".
**Fix (Phase 1):** make `save()` perform the real remote save when a remote
document exists.

### C4. In-flight save response can regress `versionRef` past a restore → all later saves 409
`src/editor/EditorContext.tsx:353-366`

`applyServerVersion` assigns unconditionally. Autosave in flight at vM → user
restores to vN>M (`adoptRestoredDocument`, `:394`) → late PUT response sets
`versionRef = M` → every subsequent save fails the optimistic lock. Same hole via
late `applied` tool events (`src/editor/ProposalsContext.tsx:414`).
`persistedRevisionRef` already has a monotonic guard (`:683-686`); `versionRef`
does not.
**Fix (Phase 1):** ignore server versions ≤ current.

---

## Major

### M1. Proposal accept can half-apply against a stale plan
`src/editor/ProposalsContext.tsx:481-485,557`

`settle` plans against render-closure `blocks`; `applyPatch` applies against newer
`docRef.current`. On desync, ops that did apply stay in the doc while the change
is stuck pending; `acceptAll` discards apply-time desyncs entirely.
**Fix (Phase 2):** atomic base-revision check inside `applyPatch`; merge
apply-time desyncs into the `acceptAll` failure count.

### M2. External changes to the active block are silently reverted by the next keystroke
`src/components/common/Editable/Editable.tsx:61-75`

While a block is active, incoming `html` prop changes are ignored. An accepted
agent patch or restore to the block being typed in is invisible and gets
clobbered by the next `onInput`.
**Fix (Phase 2):** tag block html with an origin/revision; on external change
while active, rebase preserving the caret or surface a per-block notice.

### M3. No undo/redo anywhere
Destructive ops (`removeBlock`, block deletion on Backspace, proposal accepts,
agent `delete_block`) are unrecoverable. Native contentEditable undo covers only
typing in the focused block and is destroyed whenever React rewrites `innerHTML`.
**Fix (Phase 4):** journal inverse states at the `mutateDoc` boundary (mutations
are already pure `(prev) => next` updaters); bounded stack cleared on document
switch/restore; wire Ctrl+Z / Ctrl+Shift+Z.

### M4. EditorContext value never memoized — every keystroke re-renders every consumer [verified]
`src/editor/EditorContext.tsx:1177-1242`

A fresh value object with ~40 new function identities per render defeats `memo`
on every consumer, re-runs `buildBibliography(blocks)` per keystroke, rebuilds
Canvas projection maps, and cascades into `ProposalsContext`.
**Fix (Phase 3):** split state/actions contexts or `useMemo` + `useCallback`;
memoize Canvas projections and gate `buildBibliography` on a citation fingerprint.

### M5. No cross-block keyboard model
`src/components/common/Editable/Editable.tsx:148-177`

Backspace at caret position 0 doesn't merge into the previous block, Enter
doesn't split at the caret, arrows don't cross block edges, and a selection
spanning two editables lets the browser perform DOM surgery across two
React-tracked roots. Divider blocks have no keyboard removal path.
**Fix (Phase 3):** merge-back at caret-0, split-at-caret Enter, edge-crossing
arrows, cross-block selection collapse.

### M6. No IME composition guards in the editor
`src/components/common/Editable/Editable.tsx:148-177` (the guard pattern exists in
`src/components/chat/ChatTaggedInput.tsx:183` but was never applied here)

Backspace/Enter/`/` during CJK composition can delete a block or fire the slash
menu; `onInput` commits per `compositionupdate`, and a re-render mid-composition
can lose composed text.
**Fix (Phase 3):** early-return key handlers on `isComposing`; commit state once
on `compositionend`.

### M7. Unvalidated foreign blocks reach the canvas
`src/editor/docOps.ts:92-151`, `src/editor/EditorContext.tsx:985-990`

`reconcileBlocks` fixes children but never runs `coerceBlock` on blocks
themselves; a stored/restored block with an unknown `type` renders as an
undeletable empty row (documented at `docOps.ts:111-116`). `setFromJSON` casts
after checking only `Array.isArray(parsed.blocks)`.
**Fix (Phase 2):** `reconcileBlocks` maps through `coerceBlock` and drops/reports
failures; `setFromJSON` rejects invalid docs.

### M8. Young local draft silently abandoned on document switch
`src/editor/EditorContext.tsx:887-891`

`switchTo` flushes only when `documentId` exists; a draft <5s old (or with no
remote docs at all) is never flushed and no UI path reads the local cache back.
`DocumentsMenu` asks for no confirmation. Contrast `createAndSwitch` (`:915-920`)
which flushes.
**Fix (Phase 2):** mirror the `createAndSwitch` flush in `switchTo`.

### M9. `docOverride` bypasses the cross-document write guard [prior #3]
`src/editor/EditorContext.tsx:648`

Renaming a title (passes an override) while a save is in flight, then opening
another document, resumes with `targetId = B` and PUTs document A's blocks to B —
the version lock passes because `versionRef` already moved.
**Fix (Phase 1):** re-check the loaded-id guard regardless of override.

### M10. Unknown change-set ops silently dropped, then the server record is discarded
`src/services/documentHistory.ts:404-423`, `src/editor/ProposalsContext.tsx:227-252`

A durable change set with an unmappable op is staged as a partial batch;
`resolveDurableSet` then marks the whole server record decided. `acceptChangeSet`
(`documentHistory.ts:451`) is dead code, so no server-side safety net exists.
**Fix (Phase 2):** fail the whole set visibly when any op fails to normalize.

### M11. Failed autosave never retries; no offline handling
`src/editor/EditorContext.tsx:837-873`

On failure the autosave sets `saveError` and stops until the next keystroke; a
transient blip leaves the server stale indefinitely. No `online`/`offline`
listeners anywhere.
**Fix (Phase 2):** reschedule with capped backoff on failure.

### M12. Text drag-and-drop swallowed on the whole canvas [prior #13]
`src/components/editor/Canvas/Canvas.tsx:348-352`

The drop handler falls back to `text/plain` and unconditionally
`preventDefault()`s any non-empty payload, killing native drag-to-move-text.
**Fix (Phase 2):** return early unless the payload is a block drag.

---

## Minor

### Editing UX
- **Literal `/` untypable** [prior #6] — `Editable.tsx:159-164` `preventDefault()`
  is unconditional and nothing re-inserts the character. Blocks DOIs, URLs,
  `and/or`, dates. Fix: word-boundary check + re-insert on dismiss.
- **Comma paste shreds prose** [prior #7] — `tableGrid.ts:62,67` accepts `,` as a
  delimiter whenever every line contains one; the `width < 2` guard can't fire
  once a split happened. Fix: require ≥2 columns *and* ≥2 rows (or tab-delimited).
- **Slash-menu visibility latch** [prior #10] — `slashMenuEvents.ts:19-24` emits
  `visible=true` before the menu agrees to open; an `openAtCaret` early return
  latches it for the session and kills the floating toolbar.
- **`.ai-suggest` markup baked into documents** [prior #11] —
  `editableHtml.ts:13-17` has no `.ai-suggest` handling; typing mid-suggestion
  persists toolbar buttons into saved html.
- **Widget teardown on focus change** [prior #4] — `Editable.tsx:57-76` +
  `ParagraphBlock.tsx:48-62`: inactive-block `innerHTML` reassignment detaches
  portalled widgets; the recovery observer misses placeholder-inside-`<div>`
  mutations, so the widget can vanish until `block.children` changes identity.
- **Duplicate block ids not defended** — `docOps.ts:178-186` inserts never check
  id collisions; duplicates produce duplicate React keys and split-brain updates.
- **`addBlockAfter` inserts at top when the anchor is gone** [prior] —
  `EditorContext.tsx:416-426` (`idx === -1` → `splice(0,0,…)`).
- **Negative/decimal chart values untypable** [prior] —
  `GraphInline.tsx:134-142` `Number(e.target.value) || 0` writes `0` on the first
  `-` or `.`; non-finite values desync labels (`GraphInline.tsx:33-36`).
- **Placeholder CSS broken by `<br>` residue** — `:empty` rarely matches emptied
  editables (`src/styles/globals.css:424`).
- **Focus always lands at block end; `queueMicrotask` focus races** —
  `Editable.tsx:112-116`, `Canvas.tsx:220,322`, `insertChild.ts:60`.
- **Ghost widget placeholders on cross-block paste** — stray `data-child-id`
  spans persist forever.
- **Streams not aborted on unmount/switch** — `FloatingToolbar.tsx:79-84`,
  `AiBeatInline.tsx:39`.

### SSE / streaming
- Event type persists across blocks; multiple `data:` lines not concatenated —
  `streamParser.ts:257-272` (deliberate/commented; robustness only).
- `parseSSEStream` abort docstring vs reality — `streamParser.ts:218-222,375`.
- `reorder_block` with non-numeric `toIndex` moves the block to index 0 —
  `docOps.ts:251` (validate `Number.isFinite` before splicing).
- Retry replay window wider than intended — `agentChat.ts:179-196`.

### Accessibility
- Headings have no heading semantics [prior] — `HeadingBlock.tsx`, no
  `role="heading"`/`aria-level` anywhere.
- Word diff is colour-only [prior] — `ChangeCard.tsx`, use `<del>`/`<ins>`.
- Review next/previous scrolls but never moves focus [prior] —
  `ProposalsContext.tsx:622-632`; `ChangeCard` container has no `tabIndex`.
- Widget popovers effectively mouse-only — `InlineShell.tsx:95` prevents
  `onOpenAutoFocus` while Radix portals the content to `document.body`, so Tab
  never reaches the panel.
- FloatingToolbar: no Escape, hardcoded `TOOLBAR_HEIGHT`/`ESTIMATED_WIDTH`
  (`FloatingToolbar.tsx:19-22`), detaches when focus is inside.
- Segmented controls unreachable by keyboard [prior] — `BlockControls.tsx:26-67`.
- Hand-rolled icon buttons lack focus rings [prior] — `FloatingToolbar.tsx`,
  `BlockControls.tsx`, `Canvas.tsx`; adopt `Button` sizes.
- Cartesian charts expose no data [prior] — `ChartFigure.tsx:142-147`.
- Streaming output announced token-by-token [prior] — `AiBeatInline.tsx:219-232`.
- Block reorder is drag-only [prior] — `moveBlock` exists with no caller.

### State / persistence
- Dead keys accumulate in `refs.current` (`EditorContext.tsx:140-142`) — delete
  on unmount.
- `seenBatchesRef` grows unbounded per session (`ProposalsContext.tsx:89`) — cap.
- Durable sets order by fetch-completion, not stream-arrival
  (`ProposalsContext.tsx:148-152`).
- `isReady` is O(sets²) per card per render (`proposals.ts:231-241`) — memoize.
- `JSON.stringify` equality in `updateParagraphChild` (`EditorContext.tsx:529`).
- Concurrent tabs on the same document fight (409-only resolution) — surface an
  "open in another tab" notice; no `storage`-event reconciliation.
- Local-cache write cancelled on unmount frame (`EditorContext.tsx:302-308`) —
  tiny window; write-through on final commit.

### Type safety / config
- Shallow child coercion — `docOps.ts:48,59` validates only `id`/`type`; per-type
  field validation needed.
- Non-null assertions (`proposals.ts:288,459`, `citations.ts:308,337`); deprecated
  `MutableRefObject` (`editorContextState.ts:1,13`).
- `toLocaleLowerCase()` used for identity canonicalization — Turkish-locale DOI
  divergence (`citations.ts:87,136,179,240,376`). Use `toLowerCase()` for identity.
- Raw NUL bytes in `citations.ts:240,376` — replace with `\u0000` escapes.
- `tsconfig.app.json` lacks `noUncheckedIndexedAccess`; no a11y lint plugin.
- `document.execCommand` deprecated with no replacement strategy
  (`EditorContext.tsx:553`, `FloatingToolbar.tsx:134-140,194`).

### Structure / docs
- `ChatAssistant.tsx` is a 1,678-line god-component — natural seams:
  `useAgentTurn` (send/stop/retry + stream handlers), `useConversationLoader`,
  chrome/rows module. Preserve the existing ref/abort discipline verbatim.
- Docs drift — `docs/document-json.md`/`docs/llm-document-json.md` omit `area`
  charts, table `align`/`caption`, graph labels, citation `sources`.
- Export omits `ai_beat` by default while the dialog copy overpromises "the exact
  document currently visible".
- Numeric citations number occurrences, not sources [prior] —
  `CitationInline.tsx:199-210`; `'ieee'` is a no-op option.
- `acceptChangeSet` is dead code (`documentHistory.ts:451`).
- `ShortcutsDialog` reachable only via Mod+/ — no menu/button entry point.
- No i18n layer; all UI strings hardcoded English (fine for now; flag for later).

### Testing gaps
63 test files vs ~245 source files. Zero tests for: `Editable`/`editableHtml`
(the riskiest DOM-sync code), `Canvas`, `ChatMarkdown` (would have caught C1),
slash-menu latch, restore-vs-in-flight-save race (C4), `setFromJSON` validation,
autosave retry, durable multi-batch ordering. Services and `src/editor` core are
otherwise well covered.

---

## What's solid (don't regress)

- Document-transition token/abort/`loadedForIdRef` system
  (`EditorContext.tsx:215-258`) plus document-scoped provider resets — stale
  async completions are structurally impossible.
- Dirty-revision tracking with version kept out of state; save serialization via
  `saveInFlightRef` chaining; the never-write-the-wrong-body guard.
- Proposals ordering math (`resolveAcceptOp`/`resolveAcceptPlan`) — preview ≡
  outcome, with property-style tests.
- Keyed draft storage with id-in-record verification and legacy migration.
- SSE parser whitelist mapping, malformed-JSON tolerance, CRLF/chunk handling.
- Retry discipline (`retry.ts`, `Retry-After`, replay gated on the problem
  codes the server calls transient rather than on the status).
- Auth: HttpOnly cookie session, single-flight refresh, no tokens in JS reach.
- Export sanitizer with private-use placeholder markers, `safeHttpUrl`, KaTeX
  `strict:'error', trust:false`, CSP `default-src 'none'` artifact.
- ChatMarkdown XSS posture (no `dangerouslySetInnerHTML`, scheme-checked links) —
  the only defect is the loop.
- Table widget keyboard model (best editing interaction in the codebase).
- DocumentLoading: `inert` + `aria-busy` + live regions + snapshot/restore.
- Derived (never stored) bibliography numbering.

---

## Remediation phases

- **Phase 1 — criticals:** C1, C2, C3, C4, M9.
- **Phase 2 — data integrity:** M1, M7, M8, M10, M11, M2, M12.
- **Phase 3 — editing fundamentals:** M6, M5, quick UX wins (literal `/`, comma
  paste, slash-menu latch, `.ai-suggest`, duplicate ids), M4.
- **Phase 4 — structural:** M3 (undo/redo), a11y batch, `ChatAssistant`
  extraction, docs re-sync.

Each fix ships with a targeted test where the harness allows; `npm run typecheck`,
`npm run lint`, `npm test` after each phase.

## Status

All four phases are implemented and verified: `npm run typecheck` clean,
`npm test` 947/947, `eslint src/` clean except one pre-existing warning in
`CitationInline.tsx:196`.

- [x] Phase 1 — criticals: fence regex unified + loop guard (`ChatMarkdown.tsx`
  + regression tests); ingest sanitizer (`sanitizeEditableHtml` in
  `src/export/sanitize.ts`) wired into `coerceBlock`/`reconcileBlocks`, paste
  handler on `Editable`, detached-div sinks replaced with `blockText`;
  `save()` performs the real remote save; `applyServerVersion` is monotonic
  and stale responses no longer mark revisions persisted; override saves
  verify the workspace did not move.
- [x] Phase 2 — data integrity: `applyPatch` base check + recompute-retry in
  settle/acceptAll; type/id filtering in `reconcileBlocks`, strict
  `setFromJSON`; `switchTo` flushes id-less drafts remotely; fail-closed
  `unmappableOperations` in change-set staging; autosave retry 15s→60s;
  active-block rebase with caret preservation; canvas drop only for block
  drags.
- [x] Phase 3 — editing fundamentals: IME composition guards (commit on
  compositionend, no commands mid-composition); cross-block keyboard (Enter
  splits at caret, Backspace at start merges, arrows cross block edges,
  cross-block selections collapse); quick wins (literal `/` at word
  boundaries + menu latch fix, comma-paste heuristic, `.ai-suggest` stripped
  on serialize, duplicate-id/reorder guards, refs dead-key cleanup,
  CSS.escape on widget selectors, locale-independent citation identity, NUL
  bytes → escapes); context split into actions/state/active-block with
  memoized values, citation-fingerprinted bibliography, Canvas projections
  memoized — actions-only subscribers no longer re-render per keystroke
  (proven by `editorActionsStability.test.tsx`).
- [x] Phase 4 — structural: undo/redo journal at `mutateDoc` (typing bursts
  coalesce, cleared on switch/restore) with Mod+Z / Mod+Shift+Z / Mod+Y;
  a11y batch (heading roles, `<del>/<ins>` diffs, focus-moving review nav,
  popover keyboard access, toolbar Escape + measured geometry, Radix radio
  segmented controls, focus rings, sr-only chart data, Move up/down menu
  items, Topbar shortcuts entry point); `ChatAssistant.tsx` 1,678 → 694
  lines + `useAgentTurn`/`useConversationLoader`/`chatUtils`/presentational
  modules (byte-verbatim verified, tests unchanged); docs re-synced with
  `types.ts` (area charts, table align/caption, citation sources, equation
  display).

### Deliberately left as follow-ups

- Concurrent-tab reconciliation (BroadcastChannel lock; today a 409 is the
  only signal), offline queueing, block multi-select, find & replace,
  print stylesheet for the app itself, `execCommand` replacement strategy,
  i18n, numeric-citation occurrence-vs-source numbering, `noUncheckedIndexedAccess`.
- Remaining minor perf items: `seenBatchesRef` cap, `isReady` memoization,
  durable-set arrival ordering.
