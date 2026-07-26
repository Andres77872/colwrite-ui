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
the `/api` prefix. The following optional Vite environment variables override service bases:

- `VITE_API_BASE`
- `VITE_ARZ_API`
- `VITE_COLPALI_BASE`

## TypeScript 7/6 bridge

TypeScript 7’s native compiler no longer provides the JavaScript compiler API that lint tooling
currently consumes. The project therefore follows the dual-version compatibility approach:

- `@typescript/native` aliases `typescript@^7.0.2` and supplies the `tsc` executable used by
  `typecheck` and `build`.
- `typescript` aliases `@typescript/typescript6@^6.0.2` and supplies the JavaScript API used by
  `typescript-eslint`, plus the `tsc6` compatibility executable.

Do not add npm peer overrides for this bridge.

Document model details are in [docs/document-json.md](./docs/document-json.md).
