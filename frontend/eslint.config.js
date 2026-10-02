import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),

  // Application code: React + Vite, ES modules in the browser.
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'], // new JSX transform: no `import React` needed
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      // This project is plain JavaScript and does not use PropTypes (component
      // props are documented by their usage). The rule would flag every
      // component, so it is off rather than satisfied with boilerplate.
      'react/prop-types': 'off',
    },
  },

  // Node-side files: config files and scripts.
  {
    files: ['*.config.js', 'scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },
])
