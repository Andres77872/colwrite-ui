import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist']),
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
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    rules: {
      // Semantic Scholar is a server-owned integration. A literal provider API
      // origin or browser-side credential name in production source is an
      // architectural boundary violation, even if the call is currently dead.
      'no-restricted-syntax': [
        'error',
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
      ],
    },
  },
])
