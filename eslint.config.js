import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Co-locating a context's Provider with its `use*` hook is the standard
      // React pattern, and shadcn components export their `cva` variants next
      // to the component. Neither is a defect — only a Fast Refresh
      // granularity hint — so this warns rather than fails the build.
      'react-refresh/only-export-components': 'warn',

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
])
