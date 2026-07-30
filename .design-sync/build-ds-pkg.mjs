#!/usr/bin/env node
// Builds ./ds-pkg — the library-shaped view of this app's design system that
// design-sync's package-shape converter consumes. colwrite-ui is a private Vite
// app: it has no library entry, ships no .d.ts, and its dist/ is an app bundle,
// so the converter has nothing to read. Rather than bolt a library build onto
// the app's own package.json, everything the converter needs is generated here
// into one gitignored directory:
//
//   ds-pkg/package.json      name/version/types/module — makes ds-pkg the PKG_DIR
//   ds-pkg/entry.ts          bundle entry → re-exports src/components/ui
//   ds-pkg/types/**          .d.ts tree emitted from src/ (prop contracts)
//   ds-pkg/types/index.d.ts  types barrel → the converter's component list
//   ds-pkg/tokens/tokens.css full @theme + :root token set, untree-shaken
//   ds-pkg/ds.css            compiled Tailwind utilities (cfg.cssEntry)
//
// Run from the repo root: node .design-sync/build-ds-pkg.mjs
// Registered as cfg.buildCmd, so re-syncs re-run it before the converter.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function walkFiles(dir, rx, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, rx, out);
    else if (rx.test(e.name)) out.push(p);
  }
  return out;
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(REPO, 'ds-pkg');
const GLOBALS = join(REPO, 'src', 'styles', 'globals.css');
const say = (m) => console.error(`  ${m}`);

// The DS surface: which barrels the bundle entry re-exports, and which sources
// get declarations emitted. `ui/` is the design system proper; `common/` and
// `layout/` are opted in per .design-sync/NOTES.md. Declaration emit covers all
// of src/ because layout/ reaches into editor/, panels/ and services/.
const DS_BARRELS = [
  '../src/components/ui',
  '../src/components/common/Brand',
  '../src/components/common/ExtractionStatus',
  '../src/components/common/Editable',
  '../src/components/common/ErrorBoundary',
  '../src/components/layout/AppShell',
  '../src/components/layout/Sidebar',
  '../src/components/layout/Topbar',
  '../src/components/layout/Shortcuts',
];
const DS_GLOBS = ['../src/**/*'];

// Bundled into window.ColwriteUI but deliberately NOT in the types barrel, so
// the converter never discovers them as components (no card, no .d.ts, no doc).
// This is why they go through the entry rather than `cfg.extraEntries`:
// `extraEntries` is hashed into design-sync's GLOBAL config slice
// (lib/sync-hashes.mjs → configSlicesFor), so adding it there would clear every
// preview grade in the sync. The bundle's own contents are not part of the grade
// key, so routing the same exports through the entry carries all grades forward.
// The preview shim re-exports `window.ColwriteUI` as a CJS module with dynamic
// names, so anything on the global is importable from 'colwrite-ui' regardless
// of the types barrel.
const BUNDLE_ONLY = ['../.design-sync/preview-providers'];

// ── 1. scaffold ──────────────────────────────────────────────────────────
rmSync(PKG, { recursive: true, force: true });
mkdirSync(join(PKG, 'tokens'), { recursive: true });
// Tailwind errors on a missing @source path; previews/ is authored later.
mkdirSync(join(REPO, '.design-sync', 'previews'), { recursive: true });

const appPkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
writeFileSync(join(PKG, 'package.json'), JSON.stringify({
  name: 'colwrite-ui',
  version: appPkg.version && /^\d+\.\d+\.\d+/.test(appPkg.version) ? appPkg.version : '0.0.0',
  private: true,
  type: 'module',
  module: 'entry.ts',
  types: 'types/index.d.ts',
  // Mirrored so the converter's icon-sibling autodetect and version report see
  // the real dependency set.
  dependencies: appPkg.dependencies ?? {},
}, null, 2) + '\n');

// esbuild resolves each directory to its index.ts.
writeFileSync(join(PKG, 'entry.ts'),
  [...DS_BARRELS, ...BUNDLE_ONLY].map((b) => `export * from ${JSON.stringify(b)};`).join('\n') + '\n');

// cfg.tsconfig, used only to feed the bundler's `@/*` alias resolution. It
// cannot point at tsconfig.app.json directly: the converter strips tsconfig
// comments with a `/*…*/` regex, and the `/*` inside the alias key `"@/*"`
// opens a phantom comment that swallows the paths block through the next `*/`
// (`/* Linting */`), so the aliases silently vanish and every `@/lib/utils`
// import fails to resolve. A comment-free file has no `*/` for that regex to
// find, so it passes through untouched. Keep this file free of comments and of
// any literal `*/`.
//
// The plugin also tries the bare path before any extension, and existsSync is
// true for a directory, so a directory alias (`@/editor`) resolves to the
// directory and esbuild fails with "is a directory". Exact non-wildcard entries
// are matched before `@/*`, so every aliased directory gets pinned to its index
// file. Computed by scanning source rather than enumerated, so a new
// directory-alias import needs no edit here.
const dirAliases = {};
for (const f of walkFiles(join(REPO, 'src'), /\.(tsx?|jsx?)$/)) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/from\s+['"](@\/[^'"]+)['"]/g)) {
    const spec = m[1];
    if (dirAliases[spec]) continue;
    const target = join(REPO, 'src', spec.slice(2));
    if (!existsSync(target) || !statSync(target).isDirectory()) continue;
    const idx = ['index.ts', 'index.tsx'].find((n) => existsSync(join(target, n)));
    if (idx) dirAliases[spec] = [`./src/${spec.slice(2)}/${idx}`];
  }
}
writeFileSync(join(PKG, 'tsconfig.paths.json'), JSON.stringify({
  compilerOptions: { baseUrl: '..', paths: { ...dirAliases, '@/*': ['./src/*'] } },
}, null, 2) + '\n');
say(`aliases: ${Object.keys(dirAliases).length} directory alias(es) pinned to index files`);

// ── 2. .d.ts tree ────────────────────────────────────────────────────────
// The app is noEmit; emit declarations for the DS surface only. rootDir=../src
// mirrors src/ into types/, so types/components/ui/*.d.ts.
writeFileSync(join(PKG, 'tsconfig.dts.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    skipLibCheck: true,
    strict: true,
    verbatimModuleSyntax: true,
    declaration: true,
    emitDeclarationOnly: true,
    declarationDir: './types',
    rootDir: '../src',
    paths: { '@/*': ['../src/*'] },
  },
  include: DS_GLOBS,
  exclude: ['../src/**/__tests__/**', '../src/**/*.test.*'],
}, null, 2) + '\n');

// Declaration emit is best-effort: type errors in app source must not stop the
// sync (noEmitOnError defaults off), so a non-zero exit is reported, not fatal.
// tsc6 is the repo's `typescript` alias; .bin/tsc is the TS7 native port, which
// does not implement declaration emit.
try {
  execFileSync(join(REPO, 'node_modules', '.bin', 'tsc6'), ['-p', join(PKG, 'tsconfig.dts.json')], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
  say(`! tsc reported issues during declaration emit (non-fatal):\n${out.split('\n').slice(0, 8).join('\n')}`);
}
const barrel = join(PKG, 'types', 'components', 'ui', 'index.d.ts');
if (!existsSync(barrel)) {
  console.error(`[NO_DTS] declaration emit produced no ${barrel} — the converter cannot discover components.`);
  process.exit(1);
}
// findTypesRoot/projectFor read pkgJson.types as the entry; point it at a root
// barrel mirroring entry.ts so the component list and the bundle agree.
writeFileSync(join(PKG, 'types', 'index.d.ts'),
  DS_BARRELS.map((b) => `export * from ${JSON.stringify(b.replace('../src/', './'))};`).join('\n') + '\n');
say(`types: emitted from ${DS_GLOBS.join(', ')}`);

// ── 3. tokens ────────────────────────────────────────────────────────────
// Tailwind only emits the @theme vars its generated utilities reference, so the
// compiled CSS carries a tree-shaken subset. Ship the complete set separately:
// every value in this file is a literal, so `@theme {…}` → `:root {…}` is the
// same transform `@theme static` performs.
const css = readFileSync(GLOBALS, 'utf8');
function topLevelBlocks(text, selectors) {
  const out = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) {
        // The at-rule/selector sits between the previous statement boundary and
        // this brace. Comments are stripped first: globals.css carries long
        // explanatory blocks that would otherwise swallow the head.
        const head = text.slice(0, i)
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .match(/(?:^|[};])([^{};]*)$/)?.[1]?.trim() ?? '';
        if (selectors.some((s) => head === s || head.startsWith(`${s} `))) {
          // Bodies contain no nested braces (declarations only) — but match
          // depth anyway so a future nested rule can't silently truncate.
          let d = 1, j = i + 1;
          for (; j < text.length && d > 0; j++) {
            if (text[j] === '{') d++;
            else if (text[j] === '}') d--;
          }
          out.push({ head, body: text.slice(i + 1, j - 1) });
        }
      }
      depth++;
    } else if (ch === '}') depth--;
  }
  return out;
}
const themeBlocks = topLevelBlocks(css, ['@theme']);
const rootBlocks = topLevelBlocks(css, [':root']);
if (!themeBlocks.length) {
  console.error('[NO_TOKENS] no top-level @theme block in src/styles/globals.css — check the token source.');
  process.exit(1);
}
const tokenCount = [...themeBlocks, ...rootBlocks]
  .reduce((n, b) => n + (b.body.match(/^\s*--[\w-]+\s*:/gm)?.length ?? 0), 0);
writeFileSync(join(PKG, 'tokens', 'tokens.css'),
  '/* Colwrite design tokens — generated from src/styles/globals.css by\n' +
  '   .design-sync/build-ds-pkg.mjs. The @theme block is emitted as :root so the\n' +
  '   full token set ships regardless of which utilities Tailwind tree-shakes.\n' +
  '   Edit src/styles/globals.css, never this file. */\n\n' +
  `:root {${themeBlocks.map((b) => b.body).join('\n')}\n}\n\n` +
  rootBlocks.map((b) => `:root {${b.body}\n}\n`).join('\n'));
say(`tokens: ${tokenCount} custom properties → ds-pkg/tokens/tokens.css`);

// ── 4. compiled CSS ──────────────────────────────────────────────────────
// globals.css is uncompiled Tailwind v4 (@import "tailwindcss" + @theme +
// @apply), so it cannot ship as-is. Compile it with explicit sources.
//
// Coverage matters here beyond the components themselves: a design built in
// claude.ai/design gets only the uploaded CSS — there is no Tailwind compiler
// at render time — so any utility the design agent writes that isn't in this
// file renders as nothing. Sources therefore cover all of src/ (the app's real
// class vocabulary) plus the authored previews, and SAFELIST below force-emits
// the standard scales the agent reaches for when composing its own layout.
const SAFELIST = [
  // spacing
  '{p,px,py,pt,pr,pb,pl,m,mx,my,mt,mr,mb,ml,gap,gap-x,gap-y,space-x,space-y}-{0,0.5,1,1.5,2,2.5,3,3.5,4,5,6,7,8,10,12,14,16,20,24,px}',
  '{m,mx,my,mt,mr,mb,ml}-auto',
  '-{mt,mr,mb,ml,mx,my}-{1,2,3,4,6,8}',
  // sizing
  '{w,h,min-w,min-h,max-w,max-h,size}-{0,1,2,3,4,5,6,7,8,9,10,11,12,14,16,20,24,28,32,36,40,44,48,52,56,60,64,72,80,96,px,auto,full,fit,min,max,screen,dvh,svh}',
  'columns-{1,2,3,4}',
  '{w,h}-{1/2,1/3,2/3,1/4,3/4,1/5,4/5}',
  'max-w-{xs,sm,md,lg,xl,2xl,3xl,4xl,5xl,6xl,7xl,none,prose}',
  // layout
  '{block,inline-block,inline,flex,inline-flex,grid,inline-grid,contents,hidden,table,table-cell,table-row}',
  'flex-{row,row-reverse,col,col-reverse,wrap,wrap-reverse,nowrap,1,auto,initial,none,grow,shrink}',
  '{grow,shrink,basis}-{0,1}',
  'items-{start,center,end,baseline,stretch}',
  'justify-{start,center,end,between,around,evenly,stretch}',
  '{self,justify-self}-{auto,start,center,end,stretch}',
  'content-{start,center,end,between,around,evenly}',
  'place-{items,content}-{start,center,end,stretch,between}',
  'grid-cols-{1,2,3,4,5,6,7,8,9,10,11,12,none,subgrid}',
  'grid-rows-{1,2,3,4,5,6,none,subgrid}',
  '{col,row}-span-{1,2,3,4,5,6,7,8,9,10,11,12,full}',
  '{col,row}-{auto,start-1,start-2,end-1,end-2}',
  'grid-flow-{row,col,dense,row-dense,col-dense}',
  // position
  '{static,relative,absolute,fixed,sticky}',
  '{inset,inset-x,inset-y,top,right,bottom,left}-{0,1,2,3,4,6,8,auto,full,1/2,px}',
  '-{top,right,bottom,left}-{1,2,3,4,px}',
  'z-{0,10,20,30,40,50,auto}',
  // overflow / display detail
  'overflow{,-x,-y}-{auto,hidden,clip,visible,scroll}',
  'shrink-0',
  'flex-none',
  'isolate',
  // typography
  'text-{2xs,xs,sm,base,md,lg,xl,2xl,3xl,4xl}',
  'font-{sans,mono}',
  'font-{normal,medium,semibold,bold}',
  'text-{left,center,right,justify,start,end}',
  'leading-{none,tight,snug,normal,relaxed,loose}',
  'tracking-{tighter,tight,normal,wide,wider}',
  '{uppercase,lowercase,capitalize,normal-case}',
  '{underline,line-through,no-underline,overline}',
  'underline-offset-{1,2,4}',
  'align-{top,middle,bottom,baseline}',
  '{truncate,text-wrap,text-nowrap,text-balance,text-pretty,break-words,break-all}',
  'whitespace-{normal,nowrap,pre,pre-wrap,pre-line}',
  'line-clamp-{1,2,3,4,5,6,none}',
  'tabular-nums',
  'antialiased',
  // colors — every token family the theme defines, on every property that takes one
  '{bg,text,border,ring,outline,fill,stroke,decoration,divide,shadow,caret,accent}-{background,foreground,card,card-foreground,popover,popover-foreground,primary,primary-strong,primary-foreground,accent-dark,secondary,secondary-foreground,muted,muted-foreground,accent,accent-foreground,destructive,destructive-strong,destructive-foreground,success,success-foreground,warning,warning-foreground,info,info-foreground,border,input,ring,block-hidden,block-locked,chart-grid,chart-axis,series-1,series-2,series-3,series-4,series-5,series-6,series-7,series-8,transparent,current,inherit,white,black}',
  // the same families at the opacity steps the components themselves use
  '{bg,text,border,ring}-{primary,primary-strong,secondary,muted,accent,destructive,success,warning,info,foreground,background,border,white,black}/{5,10,15,20,25,30,40,50,60,70,75,80,90,95}',
  'bg-{diff-add,diff-add-border,diff-remove,diff-remove-border}',
  'text-{diff-add-fg,diff-remove-fg}',
  'bg-gradient-to-{t,tr,r,br,b,bl,l,tl}',
  'from-{transparent,background,card,primary,muted}',
  'to-{transparent,background,card,primary,muted}',
  // borders / radius / shadow
  'rounded{,-t,-r,-b,-l,-tl,-tr,-br,-bl}-{none,sm,md,lg,xl,2xl,full}',
  'border{,-t,-r,-b,-l,-x,-y}-{0,1,2,4,8}',
  'border{,-t,-r,-b,-l,-x,-y}',
  'border-{solid,dashed,dotted,none}',
  'divide-{x,y}',
  'shadow-{sm,md,lg,xl,none,inner}',
  'ring{,-0,-1,-2,-4}',
  'ring-{inset,offset-0,offset-1,offset-2,offset-4}',
  'outline{,-none,-0,-1,-2,-4,-offset-1,-offset-2,-offset-4}',
  // effects / interaction
  'opacity-{0,5,10,20,25,30,40,50,60,70,75,80,90,95,100}',
  'transition{,-all,-colors,-opacity,-transform,-shadow,-none}',
  'duration-{75,100,120,150,200,300,500,700,1000}',
  'ease-{linear,in,out,in-out}',
  'delay-{75,100,150,200,300}',
  'animate-{spin,shimmer,slide-in-up,accordion-down,accordion-up,none,pulse}',
  'cursor-{pointer,default,not-allowed,text,grab,grabbing,move,wait}',
  'select-{none,text,all,auto}',
  'pointer-events-{none,auto}',
  'resize{,-none,-x,-y}',
  'appearance-none',
  'sr-only',
  'not-sr-only',
  '{scale,rotate}-{0,50,75,90,95,100,105,110}',
  'translate-{x,y}-{0,1,2,4,full,1/2}',
  'origin-{center,top,bottom,left,right,top-left,top-right,bottom-left,bottom-right}',
  'object-{contain,cover,fill,none,scale-down}',
  'aspect-{auto,square,video}',
  'list-{none,disc,decimal,inside,outside}',
  'backdrop-blur{,-sm,-md,-lg}',
  'blur{,-sm,-md,-lg}',
  // the interaction/responsive variants the DS itself uses, on the families
  // where they carry meaning
  '{hover:,focus:,focus-visible:,active:,disabled:,group-hover:,peer-focus:}{bg,text,border,ring,outline}-{primary,primary-strong,secondary,muted,accent,accent-foreground,destructive,destructive-strong,foreground,muted-foreground,background,card,border,input,ring,transparent}',
  '{hover:,focus:,focus-visible:,active:,disabled:}{underline,no-underline,opacity-0,opacity-50,opacity-70,opacity-100,shadow-sm,shadow-md,shadow-lg,shadow-none}',
  '{focus:,focus-visible:}{outline-none,ring-0,ring-1,ring-2,ring-offset-0,ring-offset-2}',
  'disabled:{pointer-events-none,cursor-not-allowed}',
  '{sm:,md:,lg:,xl:}{block,inline-block,flex,inline-flex,grid,hidden,flex-row,flex-col}',
  '{sm:,md:,lg:,xl:}grid-cols-{1,2,3,4,5,6,12}',
  '{sm:,md:,lg:,xl:}{p,px,py,gap,m,mx,my}-{0,1,2,3,4,6,8,10,12,16}',
  '{sm:,md:,lg:,xl:}text-{xs,sm,base,md,lg,xl,2xl,3xl,4xl}',
  '{sm:,md:,lg:,xl:}{w,max-w}-{full,auto,1/2,1/3,2/3}',
  'data-[state=open]:{bg-accent,text-accent-foreground,rotate-90,rotate-180}',
  'group-data-[state=open]:{rotate-90,rotate-180}',
  // Stacking and motion live outside Tailwind's namespaces, so they are only
  // ever reachable as arbitrary values. Tailwind emits an arbitrary utility only
  // where it literally appears in a scanned source, so the handful the app does
  // not itself use would otherwise be missing for a design that reaches for the
  // documented scale.
  'z-[var(--z-{base,sticky,chrome,dropdown,floating,modal-backdrop,modal,popover,toast,tooltip})]',
  'duration-[var(--transition-{fast,base,slow})]',
];
const twEntry = join(PKG, '.tw-entry.css');
if (!/^\s*@import\s+["']tailwindcss["']\s*;/.test(css)) {
  console.error('[NO_TW_IMPORT] src/styles/globals.css no longer starts with @import "tailwindcss" — update this script.');
  process.exit(1);
}
writeFileSync(twEntry, css.replace(
  /^\s*@import\s+["']tailwindcss["']\s*;/,
  [
    '/* generated by .design-sync/build-ds-pkg.mjs — do not edit */',
    // source(none) turns off automatic detection; every source is explicit.
    '@import "tailwindcss" source(none);',
    '@source "../src";',
    '@source "../.design-sync/previews";',
    ...SAFELIST.map((p) => `@source inline("${p}");`),
  ].join('\n'),
));
execFileSync(join(REPO, '.ds-sync', 'node_modules', '.bin', 'tailwindcss'),
  ['-i', twEntry, '-o', join(PKG, 'ds.css')], { cwd: PKG, stdio: ['ignore', 'pipe', 'inherit'] });

// The theme is single-mode dark (`color-scheme: dark`, near-white foreground,
// shadows and chart series all tuned against #0a0a0f — see globals.css). The
// app's own surface comes from `@layer base { body { … } }`, but layered rules
// lose to any unlayered `body` declaration: the generated preview cards hardcode
// `body{background:#fff}`, which would render every card near-white-on-white.
// Restate the surface unlayered at a specificity that holds, so the DS looks the
// same wherever its stylesheet is loaded.
appendFileSync(join(PKG, 'ds.css'), [
  '',
  '/* Dark-only surface, restated unlayered so a host page cannot leave this',
  '   design system light-on-white. Mirrors @layer base body in globals.css. */',
  'html body {',
  '  background-color: var(--color-background);',
  '  color: var(--color-foreground);',
  '  font-family: var(--font-sans);',
  '}',
  '',
  '/* The converter\'s "preview not yet authored" placeholder card styles its own',
  '   text near-black inline, assuming a white page. On this dark surface that is',
  '   unreadable, so give the placeholder the light background it expects. Inert',
  '   anywhere else — nothing but that placeholder carries the attribute. */',
  '[data-ds-fallback] {',
  '  background-color: #ffffff;',
  '}',
  '',
].join('\n'));
say(`css: ds-pkg/ds.css (${(statSync(join(PKG, 'ds.css')).size / 1024).toFixed(0)} KB)`);
say('ds-pkg ready');
