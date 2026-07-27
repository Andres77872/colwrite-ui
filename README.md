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

- `npm run dev` — start the Vite development server with HMR.
- `npm run typecheck` — typecheck the application, Vite/Vitest configuration, and test setup.
- `npm run lint -- --max-warnings=0` — run ESLint 10 with zero warnings allowed.
- `npm test` — run the Vitest suite once.
- `npm run build` — typecheck and create the production bundle.
- `npm run preview` — serve the production bundle locally.

## Vite 8

The project uses Vite 8’s default Rolldown/Oxc toolchain, Lightning CSS processing, and
`baseline-widely-available` browser target. No Babel, esbuild compatibility layer, React Compiler,
or legacy browser target is configured.

The development proxy keeps `/api/agent` unchanged and rewrites other `/api` requests by removing
the `/api` prefix. Environment variables supplied by the OS take precedence, while `.env` provides
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

## Research providers

The tools rail includes arXiv, ColPali, and Semantic Scholar. Semantic Scholar
requests leave the browser only through the authenticated ColWrite API at
`/api/research/semantic-scholar/*` (the development proxy maps that to the
backend's `/research/semantic-scholar/*` routes); no Semantic Scholar API
origin or credential is exposed in the Vite/browser environment. The provider
mark is bundled locally and its attribution backlink is ordinary user
navigation, not an API request. Search results can be explored through citation,
reference, and recommendation graphs, and the inline citation picker searches
arXiv and Semantic Scholar concurrently. The same panel can assess one precise
claim against retrieved excerpts while preserving the backend's calibrated
verdict, confidence, evidence, limitations, and disclaimer.
