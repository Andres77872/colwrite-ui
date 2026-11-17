import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

const TEST_FILES = ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**']

const STORAGE_MESSAGE = 'Use the helpers and keys in src/lib/storageKeys.ts.'
const STORAGE_GLOBALS = [
  { name: 'localStorage', message: STORAGE_MESSAGE },
  { name: 'sessionStorage', message: STORAGE_MESSAGE },
]
const STORAGE_PROPERTIES = [
  { object: 'window', property: 'localStorage', message: STORAGE_MESSAGE },
  { object: 'window', property: 'sessionStorage', message: STORAGE_MESSAGE },
]

const FETCH_MESSAGE = 'Call ColWrite-api through the typed client in src/api/client.ts; the browser calls no other service.'
const FETCH_GLOBALS = [{ name: 'fetch', message: FETCH_MESSAGE }]
const FETCH_PROPERTIES = ['window', 'globalThis', 'self'].map((object) => ({ object, property: 'fetch', message: FETCH_MESSAGE }))
const OPENAPI_FETCH_PATH = { name: 'openapi-fetch', message: 'Only src/api/ creates clients; use `api` from src/api/client.ts.' }
const OPENAPI_FETCH_IMPORT = { paths: [OPENAPI_FETCH_PATH] }

// Semantic Scholar is a server-owned integration. A literal provider API
// origin or browser-side credential name in production source is an
// architectural boundary violation, even if the call is currently dead.
const SEMANTIC_SCHOLAR_SYNTAX = [
  {
    selector: 'Literal[value=/api\\.semanticscholar\\.org/i]',
    message: 'Call Semantic Scholar only through the authenticated ColWrite API.',
  },
  {
    selector: 'TemplateElement[value.raw=/api\\.semanticscholar\\.org/i]',
    message: 'Call Semantic Scholar only through the authenticated ColWrite API.',
  },
  {
    selector: 'Literal[value=/^(VITE_)?(SEMANTIC_SCHOLAR|S2)_(API_KEY|API_BASE)$/i]',
    message: 'Semantic Scholar configuration and credentials are server-only.',
  },
  {
    selector: 'TemplateElement[value.raw=/(VITE_)?(SEMANTIC_SCHOLAR|S2)_(API_KEY|API_BASE)/i]',
    message: 'Semantic Scholar configuration and credentials are server-only.',
  },
  {
    selector: 'Identifier[name=/^(VITE_)?(?:SEMANTIC_SCHOLAR|S2)_(API_KEY|API_BASE)$/]',
    message: 'Semantic Scholar configuration and credentials are server-only.',
  },
]

// A test answers requests through the mock API's handlers
// (src/__tests__/server.ts, `server.use`), never by replacing `fetch`.
const MOCK_MESSAGE = 'Answer requests with the mock API: server.use(http.get(…)) from src/__tests__/server.ts.'
const FETCH_MOCK_SYNTAX = [
  { selector: "CallExpression[callee.property.name='spyOn'][arguments.1.value='fetch']", message: MOCK_MESSAGE },
  { selector: "CallExpression[callee.property.name='stubGlobal'][arguments.0.value='fetch']", message: MOCK_MESSAGE },
]

// UI code reads and writes server data through the query layer
// (docs/workspace_collection/15-contract-and-codegen.md §8): the request
// functions and hooks in src/data/*, the actions in src/actions/*, and `$api`
// (src/api/query.ts). The assistant's run streams over its WebSocket instead,
// through the transport in src/api/assistant/*. The raw client and the
// session's own fetch are for src/data/* and src/api/* only.
const UI_FILES = ['src/components/**/*.{ts,tsx}', 'src/editor/**/*.{ts,tsx}', 'src/actions/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}']
const UI_IMPORTS = {
  paths: [OPENAPI_FETCH_PATH],
  patterns: [{
    regex: '^(?:@/|(?:\\.\\.?/)+)api/(?:client|session)$',
    message: 'Read and write server data through src/data/*, src/actions/*, `$api` (src/api/query.ts) or the assistant transport (src/api/assistant/*); the raw client is for src/data/* and src/api/*.',
  }],
}

export default tseslint.config([
  // Build output: `dist` from Vite, and the git-ignored design-sync bundle,
  // package and cache, which are generated from src/ and never hand-edited.
  // MSW's service worker is generated too (`npx msw init public/`).
  globalIgnores(['dist', 'ds-bundle', 'ds-pkg', '.ds-sync', '.design-sync/.cache', '.design-sync/node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite(),
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // A leading underscore is the conventional marker for "intentionally
      // unused" — required positional callback params, discarded destructured
      // fields, and caught errors that are deliberately swallowed.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
  // Every stored key is declared, with its scope, in src/lib/storageKeys.ts,
  // which is the only module that touches browser storage. Sign-out clears
  // the account's keys by prefix, so a key written elsewhere would survive it.
  //
  // ColWrite-api is reached only through the typed client in src/api/
  // (docs/workspace_collection/15-contract-and-codegen.md §8): nothing else
  // imports openapi-fetch or calls fetch. The dev preview and the tests
  // answer requests with the mock API's MSW handlers (src/dev/msw), so they
  // need no exemption.
  //
  // A rule set in a later block replaces the earlier one for the files both
  // match, so each block lists every restriction its files carry.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [...TEST_FILES, 'src/lib/storageKeys.ts', 'src/api/**'],
    rules: {
      'no-restricted-globals': ['error', ...STORAGE_GLOBALS, ...FETCH_GLOBALS],
      'no-restricted-properties': ['error', ...STORAGE_PROPERTIES, ...FETCH_PROPERTIES],
      'no-restricted-imports': ['error', OPENAPI_FETCH_IMPORT],
    },
  },
  {
    files: UI_FILES,
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': ['error', UI_IMPORTS],
    },
  },
  {
    files: ['src/api/**/*.{ts,tsx}'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-globals': ['error', ...STORAGE_GLOBALS],
      'no-restricted-properties': ['error', ...STORAGE_PROPERTIES],
    },
  },
  {
    files: ['src/lib/storageKeys.ts'],
    rules: {
      'no-restricted-globals': ['error', ...FETCH_GLOBALS],
      'no-restricted-properties': ['error', ...FETCH_PROPERTIES],
      'no-restricted-imports': ['error', OPENAPI_FETCH_IMPORT],
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...SEMANTIC_SCHOLAR_SYNTAX],
    },
  },
  // Tests may use browser storage directly to set up and read state, but the
  // network is the mock API's: no `fetch`, and no replacing it.
  {
    files: TEST_FILES,
    rules: {
      'no-restricted-globals': ['error', ...FETCH_GLOBALS],
      'no-restricted-properties': ['error', ...FETCH_PROPERTIES],
      'no-restricted-syntax': ['error', ...SEMANTIC_SCHOLAR_SYNTAX, ...FETCH_MOCK_SYNTAX],
    },
  },
])
