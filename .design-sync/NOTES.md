# design-sync notes — colwrite-ui

Repo-specific gotchas for syncing this design system to claude.ai/design.
Read this before re-running the sync.

## The export subsystem is deliberately cut out of the bundle

The second sync (editor surface, 70 → 102 components) hit this and it will
recur, because it comes from app code that is still moving. `build-ds-pkg.mjs`
now generates four kinds of path pin to deal with it; all are computed, not
enumerated, so new files of the same shape need no edit.

**1. `.ttf` has no loader.** `src/lib/katex.ts` imports
`katex/dist/katex.min.css`, whose every `@font-face` lists woff2 + woff + ttf.
The converter's loader map (`lib/bundle.mjs`) handles
`.svg/.png/.woff/.woff2` but not `.ttf` → 20 × `No loader is configured for
".ttf" files`, build exits 1. Fixed by pinning that specifier to a generated
copy with the ttf sources stripped; woff2 is kept, which every current browser
uses. Forking `lib/bundle.mjs` to add a loader would also work but the skill
says not to touch that file.

**2. `src/export/katexOfflineCss.ts` needs the RAW stylesheet.** It regex-matches
the woff2+woff+ttf triple and *throws* unless all 20 faces are rewritten. So the
`virtual:colwrite-katex-css` pin serves the unstripped text — pointing it at the
stripped copy breaks that module at import time, not just cosmetically.

**3. Vite `?inline` asset imports.** Vite strips the query; esbuild treats
`foo.woff2?inline` as a literal path that does not exist. All 28 are pinned to
the real files, where the `.woff2` dataurl loader produces the data URI the
importing code expects.

**4. `renderStandaloneHtml` is stubbed — this is the important one.**
Measured, the standalone-HTML exporter cost **1.55 MB of the bundle**:
`react-dom/server` (browser AND legacy, 780 KB) for `renderToString`, `parse5`
(195 KB) for sanitising, and 579 KB of base64 KaTeX/fontsource faces. Total was
3252 KB; stubbing it brings the bundle to **1457 KB**. A server renderer in the
artifact every rendered design loads is simply wrong, and none of it is
design-system surface.

It is reachable only because `DocumentHeader` renders `DocumentExportDialog`,
and **esbuild inlines dynamic `import()` for an IIFE build** — so the app being
lazy about it does not keep it out. The dialog's other two imports
(`@/export/download`, `@/export/types`) are small and stay real, so it still
mounts and renders; only producing an actual export file is unavailable.

**The seam matters:** only `@/`-prefixed specifiers can be redirected by
`tsconfig.paths`. Pinning `@/export/styles` does **not** work, because
`renderStandaloneHtml.tsx` imports it as a relative `./styles`. Pick a cut point
that is imported through the alias.

If the export work later moves behind a real lazy boundary, or stops embedding
fonts at module scope, revisit — the stub can then go.

**Fourth-sync amendment: `parse5` is back in the bundle, and it must stay.**
`src/export/` is no longer export-only. `ChangeCard` now renders
`ProposedBlockView`, which imports `sanitizeInlineFragment` from
`@/export/sanitize`, which imports `parse5` — so the sanitiser is genuine DS
surface reached through a synced component, not a leak. That is what moved the
bundle from 1426 KB to **1825 KB** (`parse5` + its `entities` dependency; the
`react-dom/server` half of the old stub is still successfully excluded).

**Do not stub `@/export/sanitize` to win the size back.** It is what scrubs
agent-authored HTML before a proposed change is painted into the document; a
stub would make `ChangeCard` render unsanitised markup and the card would be
showing a lie about a security-relevant behaviour. If the size ever has to come
down, the fix is upstream — move `sanitize.ts` out of `src/export/` (it is no
longer an export concern) and, if it matters, swap `parse5` for a smaller
fragment parser. Neither is a sync-side change.

**5. KaTeX's stylesheet must be appended to `ds.css`, not left to the bundler.**
esbuild *does* extract `import 'katex/dist/katex.min.css'` into a CSS output,
but the converter's `_ds_bundle.css` is a copy of `cfg.cssEntry` (`ds-pkg/ds.css`),
so that extracted CSS is discarded and never reaches a card or a design.

The symptom is not "unstyled maths" and is easy to misread: KaTeX emits **both**
a MathML span and an HTML span for every equation, and
`.katex-mathml{clip:rect(1px,1px,1px,1px)}` is what hides the MathML one.
Without the stylesheet the browser renders both, so **every equation appears
twice** — once typeset, once as mangled plain text. That is exactly what the
first 102-component build produced.

Fixed by appending the stripped stylesheet to `ds.css` in `build-ds-pkg.mjs`,
with `url(fonts/…)` repointed to `url(./fonts/…)`; the 20 woff2 faces are
delivered there by `cfg.extraFonts`. The same append is where the dark-surface
and fallback-card rules already live.

**`cfg.extraFonts` also carries Inter.** `--font-sans` now leads with `"Inter"`,
which tripped `[FONT_MISSING]` — the DS pane and every design would have fallen
back to a system stack. Four `@fontsource/inter` weights (400/500/600/700) are
wired alongside the katex faces.

Safe-by-construction note: `extraFonts` is **not** part of the grade key. Only
`provider`, `storyImports`, `extraEntries` and `.design-sync/overrides/*.mjs`
bytes are hashed into the global slice (`configSlicesFor`), and `cardMode` /
`primaryStory` are stripped per component — so the font wiring and the
`[GRID_OVERFLOW]` remedies below carried all 102 grades forward.

**`[GRID_OVERFLOW]` remedies applied:** `cardMode: "column"` for
`ChatTaggedInput`, `DocumentFooter`, `DocumentsMenu` and `ReviewBar` (all render
wider than a grid cell); `cardMode: "single"` + `primaryStory: "Saved"` for
`DocumentHeader`, whose toast positions outside its cell.

## Third sync: a new app context broke four components (and how it was caught)

This is the pattern to expect from now on, so read it before diagnosing a
similar failure.

Uncommitted app work added `src/components/preferences/AgentToolsContext`, and
four already-synced components started calling `useAgentTools()`:
`AIActionMenu`, `CitationInline`, and — transitively — `FloatingToolbar` (it
renders AIActionMenu) and `ParagraphBlock` (it renders CitationInline). The
hook throws without its provider, so the first three rendered **root empty**
and ParagraphBlock rendered but threw, silently dropping its citation.

**The anchor diff said all 102 were `unchanged`.** That is correct and worth
internalising: `gradeKey` follows *preview* sources, and no preview had moved.
Only `package-validate.mjs`'s render check caught this. **A re-sync verdict of
`unchanged` is never on its own evidence that a component still renders** —
the DS source can move underneath a preview that is byte-identical.

Fixed the way the editor surface already does it: the **raw context plus a
literal value**, never the real provider. `AgentToolsProvider` GETs
`/users/me/agent-tools` on mount and **fails closed** until the server answers,
so mounting it in a static capture would both fire a failing request and
photograph the degraded state — an empty AI menu and a CitationInline with its
arXiv / Semantic Scholar lookups hidden. `.design-sync/preview-providers.ts`
now exports `AgentToolsContext` and a shared `agentToolsAllEnabled` fixture;
the four previews wrap with it.

**Correction to an earlier note in this file:** `preview-providers.ts` is *not*
wired through `cfg.extraEntries` — the config has no such key. It is wired by
`BUNDLE_ONLY` in `build-ds-pkg.mjs`, which appends it to `ds-pkg/entry.ts`.
That distinction is load-bearing: `extraEntries` **is** part of the global
grade slice, `BUNDLE_ONLY` is not, so editing `preview-providers.ts` costs
nothing in carried-forward grades. Only the four edited previews re-graded.

## Fourth sync: a new context under a byte-identical preview (again)

Same shape as the third sync's `AgentToolsContext` break, and it will keep
recurring — this is the standing failure mode of syncing an app that is still
moving. Read this before diagnosing a "renders but looks slightly wrong" card.

The citation rework (`c97d583`, `427f72d`) introduced **`BibliographyContext`**:
a citation's printed label is now derived from the document's reference list via
`useBibliography()`, not from the child's own `sources` array. `CitationInline`'s
preview was updated for it; **`ParagraphBlock`'s was not**, and its
`WithACitation` cell silently rendered the raw bibtex key `(hoffmann2022)`
instead of `(Hoffmann, 2022)`.

**Nothing mechanical caught it.** The render check passed 103/103 — the widget
mounted, the root was non-empty, the PNG was not blank, no page errors. It was
only visible by *reading the cell against what the cell claims to be*. The
lesson from the third sync generalises: a clean render check is evidence the
card is not broken, never evidence it is right.

Fixed by giving `ParagraphBlock`'s `Frame` the same wiring `CitationInline`
already had — take the blocks it wraps, put them on the editor context, and
derive `BibliographyContext` from them with `buildBibliography`. The citation
block is declared once and handed to both the frame and the component, so the
bibliography is built from the same object the paragraph renders.

**Rule for any future preview that mounts an inline citation:** it needs
`EditorContext` + `AgentToolsContext` + `BibliographyContext`, and the
bibliography must be built from the blocks being rendered. Two of the three
throw loudly when missing; the bibliography one does not — it degrades to the
raw key.

## Re-sync risks — what can silently go stale

Read this first on the next sync; each item is something that will not announce
itself.

1. **The sync builds from the working tree** (see below). The first sync ran
   against uncommitted local work, so a fresh clone of `master` will produce a
   different bundle until that work lands.
2. **`cfg.dtsPropsFor` hand-writes six prop contracts.** They are copies, not
   references: if `Alert`, `EmptyState`, `ErrorBoundary`, `Sidebar`, `Topbar` or
   `ExtractionBadge` changes its props — especially the `ExtractionStatus` union
   in `src/services/resources.ts` — the config still ships the old shape and the
   design agent codes against a lie. Re-check these six against source.
   *Third sync: all six re-checked. Five held; `ExtractionBadge.error` had
   drifted (source `string | null`, config `string`) and was corrected. This
   check earns its keep — run it every time.*
   *Fourth sync: all six re-checked against source, all six held — including the
   `ExtractionStatus` union, still the same five members.*
9. **`agentToolsAllEnabled` in `preview-providers.ts` is an inlined fixture.**
   It claims every agent capability is on and casts away the rest of
   `AgentToolsContextValue`. If a component starts reading `settings`,
   `loaded`, `refresh` or `updateSettings`, the cast hides it and the card
   renders a lie rather than throwing. Same standing risk as the literal
   `EditorContext` values.
3. **`.design-sync/preview-providers.ts` reaches into app internals**
   (`components/panels`, `components/auth`, `components/layout`, `src/editor`).
   Moving or renaming any of those modules breaks the build with a resolve error
   — loud, not silent, but it is the one file coupling the sync to non-DS code.
4. **`conventions.md` names classes and tokens by hand.** A renamed token makes
   the design agent emit vocabulary that no longer resolves, and nothing
   downstream catches it. Re-run the grep validation described under
   "Conventions header" on every sync.
5. **The SAFELIST is a guess about what a design agent will type.** Anything
   outside it renders as nothing. When a design comes back unstyled, the missing
   utility belongs in the SAFELIST in `build-ds-pkg.mjs`.
6. **Tailwind and playwright are version-pinned by hand** in `.ds-sync/`
   (4.3.3 / 1.61.1). Both drift the moment the repo or the browser cache moves.
7. **Two upstream fixes would let this config shrink**: exporting the four
   missing bindings from `src/components/ui/index.ts`, and the `@utility`
   change for the animation classes. Both are described below; if either lands,
   update this file rather than leaving the workaround undocumented.
8. **Only partially verified**: `Sidebar`'s document list renders its offline
   error state (the API is unreachable in a static capture), and hover, drag,
   focus-transition and enter/exit-animation states are not gradeable from
   screenshots anywhere in the set.
10. **Context degradation is the risk this repo keeps re-learning.** Three syncs
   running, the break has been "a component started reading a new context".
   `AgentToolsContext` and `EditorContext` throw when absent, so they announce
   themselves; **`BibliographyContext` does not** — it silently downgrades a
   citation to its raw key. Assume the next one is also silent. When a preview's
   cell name promises something ("MultipleKeys", "WithACitation"), check the
   pixels actually deliver it; the render check cannot.
11. **`src/export/` is now load-bearing for the DS bundle** via
   `ChangeCard → ProposedBlockView → @/export/sanitize`. The stub list in
   `build-ds-pkg.mjs` was written when `src/export/` was entirely out of scope;
   that assumption is dead. Before adding any new stub pin there, check whether
   a synced component reaches the module first.
12. **The bundle is 1825 KB and every rendered design loads it.** It grew ~370 KB
   this sync (`parse5` + `entities`). Nothing is wrong with it, but it is worth
   watching: another accidental bridge from a synced component into a heavy
   dependency would not announce itself either. The build log's
   `inlined npm packages: N` count is the cheap tripwire — it went 49 → 51 here.

## Shape: this is an app, not a library

- `colwrite-ui` is a **private Vite app**. It has no library entry, no `main`/
  `module`/`exports`, no `types`, and `noEmit: true`; `dist/` is an app bundle
  (`index.html` + hashed assets), not a component entry. The converter's package
  shape needs a dist entry plus a `.d.ts` tree, so neither auto-detection nor
  synth-entry mode gives usable results here.
- **`.design-sync/build-ds-pkg.mjs` supplies the missing library build**, into a
  gitignored `ds-pkg/`. It is registered as `cfg.buildCmd`, so re-syncs re-run it
  automatically. It writes: `package.json` (makes `ds-pkg` the converter's
  PKG_DIR), `entry.ts` (bundle entry), `types/**` + `types/index.d.ts` (prop
  contracts), `tokens/tokens.css`, `ds.css` (compiled CSS), `tsconfig.paths.json`.
  Nothing in the app's own tracked files was modified for the sync.
- Consequence: `cfg.srcDir` is `../src` and `cfg.tokensPkg` is `../ds-pkg`
  (resolved relative to `node_modules/`, i.e. back out to the repo root). Both
  look odd but are deliberate — PKG_DIR is `ds-pkg`, not the repo root.

## Converter quirks hit here (fixed in config/generator, no lib forks)

- **`cfg.tsconfig` must not point at `tsconfig.app.json`.** The converter strips
  tsconfig comments with a `/*…*/` regex. The alias key `"@/*"` contains `/*`,
  which opens a phantom comment that swallows everything through the next `*/`
  (`/* Linting */`) — the `paths` block disappears and every `@/lib/utils` import
  fails to resolve. `build-ds-pkg.mjs` emits a **comment-free**
  `ds-pkg/tsconfig.paths.json` instead; a file with no `*/` passes the regex
  untouched. Keep that file free of comments and of any literal `*/`.
- **Directory aliases need exact path entries.** The tsconfig-paths plugin tries
  the bare path before any extension and `existsSync` is true for a directory, so
  `@/editor` resolves to the directory and esbuild dies with
  `Cannot read file "src/editor": is a directory`. The generator scans `src/` for
  `@/…` specifiers, and pins every one that resolves to a directory to its
  `index.ts` as a non-wildcard `paths` entry (matched before `@/*`). Self-
  maintaining — a new directory-alias import needs no edit.
- Both quirks are in the bundled converter lib, not in this repo. If a future
  skill version fixes them, the generator's workarounds stay harmless.

## Styling: Tailwind v4, dark-only

- Tokens live in `src/styles/globals.css` under `@theme` (Tailwind v4 reads
  `--color-*`, `--text-*`, `--radius-*`, `--shadow-*`, `--font-*`, `--animate-*`)
  plus a plain `:root` block for non-namespace tokens (`--z-*`,
  `--transition-*`, `--doc-*`). **Edit tokens there, never in `ds-pkg/`.**
- `globals.css` is *uncompiled* Tailwind (`@import "tailwindcss"`, `@theme`,
  `@apply`) so it cannot ship as-is. `build-ds-pkg.mjs` compiles it with the
  pinned Tailwind CLI in `.ds-sync/` and ships the result as `cfg.cssEntry`.
- **`@theme` is tree-shaken by Tailwind** — only referenced vars reach the
  compiled CSS. The generator therefore also emits the full token set separately
  as `tokens/tokens.css` (`@theme {…}` re-emitted as `:root {…}`, the same
  transform `@theme static` performs). That file is what makes the complete
  vocabulary reachable to a design; do not drop it.
- **Rendered designs get no Tailwind compiler.** Any utility class the design
  agent writes that is not in the shipped CSS renders as nothing. Mitigations:
  `@source` covers all of `src/` (the app's real class vocabulary) plus
  `.design-sync/previews/`, and a curated `SAFELIST` in the generator force-emits
  the standard scales (spacing, sizing, flex/grid, type, the full token colour
  matrix with opacity steps, radius, shadow, transitions, and the common
  `hover:`/`focus:`/`sm:`–`xl:` variants). That is why `ds.css` is ~460 KB.
  **If a design renders unstyled, the missing utility belongs in that SAFELIST.**
- **The theme is single-mode dark** and there is deliberately no `@custom-variant
  dark` and no light token set (shadows, scrollbars, scrim and the 8 chart series
  are all validated against `#0a0a0f`). Two consequences the generator handles by
  appending rules to `ds.css`:
  - The app's surface comes from `@layer base { body { … } }`, and **layered
    rules lose to any unlayered `body` rule**. The generated preview cards
    hardcode `body{background:#fff}`, which rendered every card near-white on
    white. Fixed by restating the surface unlayered as `html body { … }`.
  - The converter's "preview not yet authored" placeholder styles its own text
    near-black inline, assuming a white page. Fixed with
    `[data-ds-fallback] { background-color: #fff }`.
  Both rules ship in `_ds_bundle.css` and are correct for real designs too.
- Fonts: the DS's own type is system stacks only (`--font-sans` /
  `--font-mono`), so no `@font-face` of its own and no `[FONT_MISSING]`;
  `fonts/` is legitimately empty. **KaTeX is the exception** — since it moved
  from a CDN `<script>` to the npm package, its stylesheet and woff2 faces are
  bundled, which is why `_ds_bundle.js` is ~1.4 MB rather than ~580 KB. The
  `@fontsource/inter` and `@fontsource/source-serif-4` deps are used only by
  `src/export/`, which is stubbed out of the bundle (see above), so they do not
  ship.

## Build ORDER matters: regenerate CSS after authoring previews

`build-ds-pkg.mjs` scans `.design-sync/previews/` as a Tailwind `@source`, so
utility classes used only by a preview do get emitted — **but only by a run of
that script.** `preview-rebuild.mjs` (the scoped inner loop parallel agents use)
recompiles the preview JS and never touches CSS, so a class first introduced by a
preview is missing from `ds.css` until the generator runs again.

Symptom: an *arbitrary*-value class (`w-[380px]`, `max-w-[52ch]`) silently does
nothing, so a card renders full-bleed. Named-scale classes are unaffected because
the SAFELIST force-emits them.

**Rule: run `cfg.buildCmd` (`node .design-sync/build-ds-pkg.mjs`) again after any
preview authoring, before the final `package-build.mjs`.** The driver
(`resync.mjs`) does not do this for you — it starts at `package-build.mjs`.

## Finding: the overlay enter/exit animations never apply (pre-existing, in the app)

`dialog.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `sheet.tsx` and `tooltip.tsx`
all style their open/close transitions as
`data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95`
(and the `closed`/`out` counterparts). **None of those variant classes generate
any CSS** — not in `ds.css`, and not in the app's own `dist/` build either
(verified: its only `[data-state=open]` selectors are `animate-accordion-down`,
`bg-accent` and `text-muted-foreground`).

Cause: `animate-in`, `animate-out`, `fade-in-0`, `zoom-in-95`, `slide-in-from-*`
are hand-written plain CSS classes inside `@layer utilities` in
`src/styles/globals.css` (added deliberately to avoid a `tailwindcss-animate`
dependency). Tailwind v4 can only build a variant such as `data-[state=open]:` on
a **registered utility**, and a class defined with plain CSS in `@layer utilities`
is not one — so the variant silently resolves to nothing. The bare classes
(`.animate-in`) do exist, which is why this has never looked obviously broken.

Fix, if the app wants those animations back: declare them with v4's `@utility`
directive instead of `@layer utilities` in `globals.css`, e.g.
`@utility animate-in { animation-name: enter; … }`. That is an app-side change
and was **not** made as part of the sync. Until then, overlays in Colwrite and in
claude.ai/design both appear without their enter animation — which is why no
preview card shows one.

## Editor previews: use literal context values, never the real providers

For anything under `src/components/editor` / `src/editor`, supply
`EditorContext.Provider` / `ProposalsContext.Provider` with a literal value
rather than mounting `EditorProvider`. Three reasons, in order of importance:

1. **Determinism.** `EditorProvider` seeds state with `Date.now()` and `uid()`.
   Non-deterministic render output churns design-sync's render hashes, so every
   future sync would see those components as changed and re-verify them.
2. `EditorProvider` fires `POST /api/document/list` on mount (fails offline,
   silently) and arms a 5-second autosave timer after any mutation — which can
   fire a failing PUT during a screenshot.
3. Proposal state has no entry point except `receive(action)` fed by a live
   `tool_action` stream, so `ReviewBar`/`ChangeCard` cannot be populated through
   the real provider at all.

`EditorContextValue` has ~50 required members and `ProposalsContextValue` 15, but
each component reads only a handful, so
`{...} as unknown as EditorContextValue` is the intended shape. Import
`EditorContext` from `@/editor/editorContextState` (the `src/editor` barrel does
**not** re-export it) and proposals types from `@/editor/proposals`.

`ProposalsProvider` itself is side-effect-free (no network, no storage, no
timers) but calls `useEditor()`, so it still requires an editor above it.

## HARNESS HAZARD: ChatMarkdown fixtures must use a one-word code-fence info string

`ChatMarkdown`'s `parseBlocks` (`src/components/editor/ChatAssistant/ChatMarkdown/ChatMarkdown.tsx`)
**infinite-loops** on any line starting with ` ``` ` whose info string is not a
single `\w*` run: the fence detector at :115 rejects it, and the paragraph
exclusion at :162-171 also skips it, so `index` never advances. Verified by
replaying the loop: ` ```py extra `, ` ``` python `, ` ```js title="a.js" `,
` ```bash (run this) ` and the mid-stream partial ` ```py t ` all hang.

Consequence for this sync: a `ChatMarkdown` preview fixture containing such a
fence **hangs headless chromium forever** — the capture never returns and the
run appears stuck rather than failing. Keep every fixture to a bare ` ``` ` or a
single-word language until the source is fixed. Re-check this note if
`ChatMarkdown` changes.

## Version coupling

- The Tailwind CLI in `.ds-sync/` is pinned to **4.3.3** to match the repo's
  `tailwindcss` / `@tailwindcss/vite`. If the repo upgrades Tailwind, bump the
  `.ds-sync` install to match or the compiled CSS can drift from the app's.
- Declaration emit uses `node_modules/.bin/tsc6` (the repo aliases `typescript`
  to `@typescript/typescript6`). `.bin/tsc` is the TS7 native port, which does
  **not** implement declaration emit — do not switch to it.
- Playwright for the render check: `playwright@1.61.1` in `.ds-sync/`, matching
  the already-cached `chromium-1228` in `~/.cache/ms-playwright`. A different
  playwright version will fail with `Executable doesn't exist`.
- `katex@0.18.1` is now a real runtime dependency of the DS (not just of
  `src/export/`). If it is upgraded, re-check that the `@font-face` triple in
  `katex.min.css` still matches the strip regex in `build-ds-pkg.mjs` **and**
  the `sourceRule` regex in `src/export/katexOfflineCss.ts` — both parse that
  stylesheet's exact shape, and both fail loudly rather than silently.

## Scope

- Synced surface: `src/components/ui` (61 exports) + `src/components/common`
  (BrandMark, BrandLockup, Editable, ErrorBoundary, ExtractionBadge) +
  `src/components/layout` (AppShell, Sidebar, Topbar, ShortcutsDialog) +
  **the editor surface** (added in the second sync) = **103 components**. Set in
  `DS_BARRELS` in the generator.
- **`ReferencesSection` joined in the fourth sync** (`Editor blocks` group), via
  the `../src/components/editor/References` barrel. It takes no props — the list
  is derived from the document's blocks on every render — so its card is three
  cells over the same component: author-year, numbered, and one unresolved key.
- `ProposedBlockView` / `ProposedRewriteView` are deliberately **not** synced:
  `Review/index.ts` exports only `ChangeCard` and `ReviewBar`, and these two are
  internals of the change card. They are still *in* the bundle (ChangeCard
  renders them) — just without a card, doc or `.d.ts` of their own.
- The editor surface is 32 components across five new groups: `Editor`
  (Canvas, DocumentHeader, DocumentFooter, BlockControls, FloatingToolbar,
  SlashMenu, AIActionMenu, DocumentsMenu), `Editor blocks` (Paragraph, Heading,
  Divider), `Inline widgets` (Citation, Equation, Graph, Table, AiBeat,
  ChartFigure, plus the InlineShell atoms InlinePill, InlinePopover,
  InlineSettings, InlineFigureShell, SettingsRow, SettingsCheck,
  SettingsFooter), `Assistant` (ChatAssistant, ChatMarkdown, AgentActivity,
  ChatRefPicker, ChatRefTags, ChatTaggedInput) and `Review` (ReviewBar,
  ChangeCard).
- Still not synced: `panels/`, `profile/`, `landing/`, `chat/`, `auth/` — app
  views wired to app contexts and services. `src/export/` is also out of scope
  (that is where the `katex` and `parse5` npm deps are used, not in the DS).
- 38 of the 70 are compound subparts (`CardHeader`, `DialogTitle`,
  `DropdownMenuItem`, …). By explicit user decision all 70 get their own `.d.ts`,
  usage doc and card; subpart previews render the real parent composition, which
  is the only render that is true for a piece that cannot mount alone.
- Grouping comes entirely from `category:` frontmatter in
  `.design-sync/docs/<Name>.md`. The source layout gives the converter nothing to
  group by (`components/` and `ui/` are both on its generic-dir list), so without
  those docs all 70 land in one `general` group.

## App-shell components need context injected into previews

`AppShell`, `Sidebar` and `Topbar` read app context and **throw** without it
(`usePanels`/`useView`/`useAuth` all throw by design; `DocumentsMenu`, which
`Sidebar` renders, additionally needs the editor, toast and confirm contexts).

A preview cannot import those providers from `src/` directly: the preview bundler
would compile a SECOND copy of each context module, whose React context instance
is a different object from the one the components inside `_ds_bundle.js` read
from — the provider renders and the consumer still throws. **`.design-sync/preview-providers.ts`**
re-exports the providers *and* the raw contexts, and is wired in via
`cfg.extraEntries`, so they land on `window.ColwriteUI` and previews get the same
module instance. They are absent from the types barrel, so the converter never
treats them as components (no card, no `.d.ts`, no doc).

Two cases need the raw context rather than the real provider:
- `Topbar` returns `null` while `user` is null, and `AuthProvider` only sets a
  user after confirming a cached identity against the server — unreachable in an
  offline static capture. Its preview supplies a literal `AuthContext` value.
- `Sidebar`'s collapsed state is persisted user state with no prop to force it,
  so that cell overrides `PanelsContext` with `leftCollapsed: true`.

`Sidebar`'s document list is fetched from the API, so in an offline capture the
list area shows its own load/error state. That is a truthful render — the card is
about the sidebar chrome.

## Conventions header

`.design-sync/conventions.md` is prepended to the generated README via
`cfg.readmeHeader` and is inlined into the design agent's system prompt. Every
class and token name in it was grepped against the compiled `ds-pkg/ds.css`
before commit — **re-run that check on every sync** (a name that stops resolving
makes the agent ship silently unstyled output).

The check is scripted: **`node .design-sync/validate-conventions.mjs`**, run
after the build so `ds-pkg/ds.css` and `ds-bundle/` are fresh. It exits non-zero
and names anything that no longer resolves. *(It lived in the gitignored
`.cache/` until the fourth sync, which meant a fresh clone silently lost it —
it is now part of the committed durable set. If you add vocabulary to
`conventions.md`, add it to the corresponding list in that script too, or the
new names go unchecked.)*
*Fourth sync: PASS — all 16 class families, 13 custom properties, 14 component
folders and 5 bundle-only exports still verify.*

Two families are only reachable as Tailwind *arbitrary* values, because `--z-*`
and `--transition-*` are not v4 namespaces and generate no utilities:
`z-[var(--z-modal)]`, `duration-[var(--transition-base)]`, etc. Tailwind emits an
arbitrary utility only where it literally appears in a scanned source, so the
generator's SAFELIST force-emits the full documented scale — otherwise only the
subset the app itself happens to use would exist, and the documented rest would
render as nothing.

## The sync builds from the WORKING TREE

At the time of the first sync the repo had substantial **unstaged** work in the
worktree — including `src/styles/globals.css` (shadow/motion token
reorganisation), `buttonVariants.ts`, `badgeVariants.ts`, `collapsible.tsx`,
`Sidebar.tsx`, `Topbar.tsx` and `ViewContext.tsx` — differing from both the index
and `HEAD`. `build-ds-pkg.mjs` reads the worktree, so **the uploaded design system
reflects uncommitted local work**, not the committed state.

That is usually what you want while iterating, but it means a colleague syncing
from a fresh clone of `master` would produce a different bundle. If the DS should
track a committed state, commit the DS surface first (`src/components/ui`,
`src/components/common`, `src/components/layout`, `src/styles/globals.css`) and
re-run the sync.

## Four things `src/components/ui/index.ts` does not re-export

The barrel exports `./alertVariants` but not `./badgeVariants`, `./buttonVariants`,
`./toastContext` or `./confirmContext`. Consequences:

- **`ToastProvider` and `ConfirmProvider` are unusable without `useToast` /
  `useConfirm`** — the hook is the only way to raise a toast or ask for
  confirmation, so shipping the providers without them ships two dead components.
- `badgeVariants` / `buttonVariants` are the class recipes the app itself uses to
  render a badge-looking `<span>` in flow content (`ExtractionBadge`,
  `LibraryPanel/CollectionAttachmentLabel`) — needed because `Badge` is a `<div>`
  and cannot sit inside a `<p>`.

`.design-sync/preview-providers.ts` re-exports all four so the uploaded bundle is
usable. That ships the repo's own code and adds nothing new, but the cleaner fix
is four lines in `src/components/ui/index.ts`:

```ts
export * from "./badgeVariants"
export * from "./buttonVariants"
export * from "./toastContext"
export * from "./confirmContext"
```

If those are added upstream, drop the corresponding lines from
`preview-providers.ts` (duplicate star exports of the same binding are fine, but
the indirection stops being needed).

## Preview authoring: what six parallel batches learned

**Card mode.** Every component whose preview mounts a portalled or fixed overlay
needs `cfg.overrides.<Name>.cardMode = "single"`, because the product's default
card is a grid that mounts all exports at once and the portals all land on
`document.body` — they paint over each other instead of sitting in their cells.
That is the whole Dialog / DropdownMenu / Popover / Sheet / Tooltip surface plus
`ToastProvider`, `ConfirmProvider` and `ShortcutsDialog`. Graded captures are
unaffected either way (`package-capture.mjs` drives `?story=<Export>`, always
full-bleed single) — the override exists purely to fix the product's card.

**Never add `viewport` to an already-graded component.** `configSlicesFor()` in
`lib/sync-hashes.mjs` strips `cardMode` and `primaryStory` before hashing but
keys **every other** override field. So `cardMode`/`primaryStory` carry grades
forward, while adding any `viewport` — even `900x700`, identical to the default —
changes the gradeKey and deletes the verdicts. `AppShell` is the one component
here with a `viewport` (`1600x900`), set before it was ever graded: a three-column
app frame with an 800px canvas plus a 280px sidebar and a 320px tools panel needs
~1440px, and at the 900px default its right panel is clipped.

**Forcing the open state**, verified per compound rather than assumed:
- `Popover` — `<Popover open>` only. Radix Popover's `modal` already defaults to
  false, so there is no scroll lock or `pointer-events:none` to blank a capture.
- `Sheet` — `<Sheet open>` only. It is Radix Dialog underneath (`modal` defaults
  true) and still captures cleanly. Forcing `modal={false}` would misrepresent
  the shipped default.
- `DropdownMenu` — `open` plus `modal={false}`; the default modal mode puts
  `pointer-events:none` on `<body>`. Submenus force open per branch
  (`<DropdownMenuSub open>`); two nested levels render fine.
- `Tooltip` — `<Tooltip open>` **and** a `TooltipProvider` ancestor in every
  cell, or Radix throws. Same trap bit `Sidebar`, whose collapse control is
  tooltip-wrapped.
- `DialogTrigger` is the one deliberate exception to "force open": an open
  `DialogContent` portals over the whole viewport and buries the trigger, so its
  cells render the **closed** state. The two can never share a shot.
- Providers with nothing visible until a hook fires (`ToastProvider`,
  `ConfirmProvider`) are driven from a child on mount.

**Capture geometry.** One cell per page at 900×700 with 24px body padding, and
`fullPage: false` — a cell taller than ~650px is cut off. Keep cells short.

## Component facts worth keeping (found while authoring)

- **`Skeleton` is invisible on `bg-card`.** `bg-muted/60` over `bg-card` measures
  `(20,20,29)` on `(18,18,26)` — a 4/255 step. Skeletons must sit on
  `bg-background` (or a border-only container) to read at all. A genuine
  token-contrast finding, not a preview bug.
- **`Badge` is a `<div>`**, so it cannot sit inside a `<p>`, `CardDescription` or
  any phrasing-only element — the parser closes the paragraph early. That is why
  `ExtractionBadge` and `CollectionAttachmentLabel` render a `<span>` with
  `badgeVariants()` instead.
- **`CardTitle` sets no font size** — only `font-semibold leading-none
  tracking-tight` — so every usage must add `text-sm`/`text-md`/`text-lg` or it
  reads as bold body text. `CardContent`/`CardFooter` are `p-4 pt-0` and assume a
  padded `CardHeader` above.
- **`Checkbox` has no indeterminate glyph**: the indicator draws the same `Check`
  for `checked` and `"indeterminate"`, and the `bg-primary` fill is keyed to
  `data-[state=checked]` only, so indeterminate is a check on an unfilled box.
  `rounded-sm` on a 16px box also reads nearly circular.
- **`TabsTrigger` has no `gap` and no `[&_svg]` sizing** (unlike `Button`), so an
  icon or count badge sits flush unless the caller adds them. `TabsList` is `h-9
  inline-flex` — underline or multi-row bars need `h-auto`.
- **`Collapsible`/`CollapsibleTrigger` are bare Radix re-exports** with zero
  styling; only `CollapsibleContent` is wrapped. The chevron rotation is the
  consumer's job. `panels/shared/Disclosure` is the canonical composition.
- **Anything right-aligned in a `DialogHeader` collides with the corner close
  button** (`absolute right-4 top-4`) — it needs `pr-8`.
- **Not exported by `dropdown-menu.tsx`**: `DropdownMenuRadioItem`,
  `DropdownMenuCheckboxItem`, `DropdownMenuShortcut`. Docs use the honest
  fallback (`DropdownMenuItem inset` + a positioned `Check`; `Kbd` + `ml-auto`).
- ~~**`CitationInline` numeric style shows one bracket, whatever the key
  count.**~~ **Fixed upstream in the fourth sync** (commit `c97d583`, "update
  numbering logic"). `citationLabel` now renders multi-key numeric labels and
  collapses runs into ranges: `[1, 2]`, `[1–3]`, `[1, 3]`, plus a new `ieee`
  style that repeats the brackets (`[1], [3]`). The contract is pinned by
  `src/editor/__tests__/citations.test.ts` — read that file rather than the
  component when you need to know what a label will look like. The
  `MultipleKeys` cell now genuinely shows `[1, 2]` and needs no rework.
- **Handler props are stripped from every emitted `.d.ts`** alongside native DOM
  props: `onOpenChange`, `onSelect`, `onValueChange`, `onEscapeKeyDown`,
  `onInteractOutside` are all absent from `<Name>Props` but do exist. Every
  affected doc says so explicitly.
- The Card subparts, `DropdownMenuGroup`, `DropdownMenuPortal` and
  `DropdownMenuRadioGroup` have **no call sites in `src/`** — their previews are
  composed from the DS's own vocabulary rather than ported, and their docs say so.

## Editor-surface previews: what the second sync learned

Every one of these cost a debugging cycle. The pattern throughout: components
that look prop-driven actually reach into context, and overlays that look
forceable actually are not.

**Context is deeper than the destructure suggests.** Grepping a component for
`useEditor()` is not enough — the `Editable` it renders calls it too.
`HeadingBlock` declares no context use and still throws without an
`EditorContext`. `CitationInline` and `EquationInline` take full props *and*
call `useEditor()`. `Canvas` needs `ConfirmProvider` not for itself but for the
`BlockControls` it renders per block; without it the whole canvas paints as an
empty surface with no error visible in the card.

**`registerEditable` must really register.** A no-op passes the crash check and
still breaks rendering: the effect that mounts inline widgets looks its host up
as `refs.current[block.id]`, so with a no-op every `[data-child-id]` placeholder
stays empty and no widget appears. Make it `(id, el) => { refs.current[id] = el }`.

**Inline children need a placeholder in the html.** `block.children` alone does
nothing — the paragraph html must contain `<span data-child-id="…"></span>`
where each widget goes.

**Citation authors must be `"Surname, Initials"`.** `firstAuthorSurname` splits
on `,` `;` and ` and `, so `"Hoffmann et al."` renders as `(al., 2022)`. Use
`"Hoffmann, J., Borgeaud, S."`.

**What can and cannot be forced open**, verified per component:
- `BlockControls` — YES. Open state is in the editor context
  (`openMenuBlockId` + `openMenuType`), so both menus render open.
- `SlashMenu` — YES, via its real trigger: register a contenteditable in
  `refs`, put a caret in it, then
  `window.dispatchEvent(new CustomEvent('colwrite:open-slash-menu', {detail:{blockId}}))`.
  It measures the caret rect, so the caret must be real and the rect non-zero.
- `FloatingToolbar` — YES, by making a real non-collapsed selection inside an
  element carrying the **`editable` class** (that class is how it finds the
  field).
- `ChatRefPicker` — YES, via the `openAt()` ref handle. But its list is
  `absolute bottom-full`, so it needs a **`relative` wrapper** or it resolves
  against the root and lands at a negative top, off the card.
- `ChatAssistant` — YES, `assistantOpen` comes from `PanelsContext`.
- `InlinePopover`, `InlineSettings`, `AIActionMenu` — **NO.** All hold `open` in
  internal state with no prop. Cards show the closed trigger.
- `InlineFigureShell`'s control header — **NO.** `opacity-0` until hover.

**Cells deliberately removed rather than shipped** (each rendered identically to
a sibling, or rendered nothing). The reason is written into the preview file at
the point of removal, so it does not get re-added:
`SlashMenu.Filtering` (query lives in the menu's own search field, not the block
text) · `ReviewBar.SteppingThroughABatch` (`focusedChangeId` highlights document
cards, not the bar) · `BlockControls.Resting` (affordances are hover-revealed →
empty card) · `DocumentFooter.LocalDraftNotYetSaved` (`documentId` only gates the
null-return) · `InlineFigureShell.WithSettingsControl` (`controls` lands in the
hidden header) · `SettingsCheck.WithHint` (see below) · `DividerBlock.OnItsOwn`
and `InlineSettings.OnItsOwn` (single hairline / 14px icon on an empty card —
this is what tripped `[RENDER_BLANK]`) · two of three `ChatRefPicker` cells (its
root menu is two fixed options, so document count changes nothing).

**`SettingsCheck`'s `hint` is a `title` attribute, not visible text** — unlike
`SettingsRow`'s, which renders as a paragraph. It never appears in a screenshot
and touch users never see it. Documented in `docs/SettingsCheck.md`.

## SAFELIST gap: `pt-*` stops at 24, `h-*` goes to 96

Beyond the arbitrary-value trap already documented above, the *named* scale is
not uniformly emitted either. `pt-80` is absent from `ds.css` (the padding scale
stops around `pt-24`) while `h-80` and `h-96` are present. A preview needing
large vertical offset should use **spacer divs** (`<div className="h-96" />`)
rather than padding. `SlashMenu` and `ChatRefPicker` both depend on this.

Corollary worth restating because it bit twice in one run: `preview-rebuild.mjs`
does not recompile CSS, so a class first used by a preview does nothing until
`build-ds-pkg.mjs` runs again — and `package-build.mjs` is what copies
`ds-pkg/ds.css` to `ds-bundle/_ds_bundle.css`. During a scoped iteration loop,
`cp ds-pkg/ds.css ds-bundle/_ds_bundle.css` after `build-ds-pkg.mjs` is enough
to see new utilities without a full rebuild.

## Known render warns

**First sync (70 components):** none. Validate reported 70/70 clean — no
`[RENDER]`, `[RENDER_BLANK]`, `[RENDER_THIN]`, `[GRID_OVERFLOW]`,
`[FONT_MISSING]` or `[CSS_*]` lines.

**Second sync (102 components):** the last complete validate — run before the
32 editor previews were authored, when they were all still floor cards —
reported 102/102 rendering, `bad` on only `DividerBlock` and `InlineSettings`,
both floor-card artefacts now fixed by real previews. Authoring also cleared the
`[RENDER_THIN]` on `InlineFigureShell` and `SettingsRow`.

**Third sync.** After the `AgentToolsContext` fix above, validate reported
**102/102 rendering, `bad` 0, `thin` 0, `variantsIdentical` 0, `fallbackCard`
0** — no `[RENDER]`, `[RENDER_BLANK]`, `[RENDER_THIN]`, `[GRID_OVERFLOW]`,
`[FONT_MISSING]` or `[CSS_*]` lines, and every one of the seven contact sheets
eyeballed clean.

**Fourth sync — this is the baseline.** Same clean result at the new size:
**103/103 rendering, `bad` 0, `thin` 0, `variantsIdentical` 0, `fallbackCard`
0**, zero page errors across the whole set, no warn lines of any kind, and all
seven contact sheets eyeballed clean. Treat this as the reference: any warn on
a later run is new. Note this run needed **no `[GRID_OVERFLOW]` remedies** —
`ReferencesSection` fits a grid cell at the default card mode, so it carries no
`cfg.overrides` entry.

One informational line is expected and fine: `tokens: 251 defined, 165
referenced (1 missing, below threshold)`. (It read 248/163 through the second
sync; the app's own token additions move these counts, so compare the *shape*
of the line — still 1 missing, still below threshold — not the numbers.)

## Prop contracts

- `cfg.dtsPropsFor` overrides six components:
  - `Alert`, `EmptyState` — `icon?: React.ElementType` was expanded by the
    extractor into a 180-member string union of every HTML tag name.
  - `ErrorBoundary`, `Sidebar`, `Topbar` — extraction produced
    `[key: string]: unknown`; the first takes `children`+`label`, the other two
    take no props at all (they read app context).
  - `ExtractionBadge` — `status` resolved to `any`; the real type is the
    `ExtractionStatus` union from `src/services/resources.ts`. **If that union
    changes, update the override.**
- Native DOM props are filtered from the emitted `<Name>Props` by design, so
  `Input`/`Textarea` show only `className`/`id`/`style`. Their docs state
  explicitly that standard input attributes pass through.
