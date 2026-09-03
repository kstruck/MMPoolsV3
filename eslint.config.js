import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Don't lint build output or operational scripts (node .mjs/.cjs one-offs that
  // carry TS-eslint disable comments this JS config doesn't define).
  //
  // `functions/src/shared/**` is a GENERATED MIRROR of repo-root `shared/`,
  // written by functions/scripts/copy-shared.mjs and gitignored. Linting it
  // double-reports every warning already reported against the real source, and
  // the duplicate is unfixable in place because any edit there is overwritten
  // on the next copy. It only appears once functions has been built or tested,
  // which is why the report length used to depend on what you had run before.
  globalIgnores([
    'dist',
    '**/*.cjs',
    '**/*.mjs',
    '.claude/**',
    'functions/lib/**',
    'functions/src/shared/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      // a11y audit 2026-08-23: nothing caught missing labels/alt/roles before
      // they shipped. Recommended set at WARN (CI lint blocks on ERRORS only; the point
      // is that new violations are VISIBLE in the report).
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // jsx-a11y recommended fires as errors; align with the backlog-at-warn
      // convention below so existing debt reports without alarming red.
      ...Object.fromEntries(
        Object.keys(jsxA11y.flatConfigs.recommended.rules).map((k) => [k, 'warn'])
      ),
      // Pre-existing backlog surfaced as warnings so lint still runs and reports
      // but doesn't fail CI on debt. The real correctness gate,
      // react-hooks/rules-of-hooks, stays an ERROR. Pay these down over time.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-useless-escape': 'warn',
      'no-constant-condition': 'warn',
      'no-empty': 'warn',
      'react-refresh/only-export-components': 'warn',
      // Experimental React Compiler hints (not correctness bugs like rules-of-hooks).
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
])
