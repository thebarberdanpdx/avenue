import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // App.backup*.jsx are dead pre-refactor snapshots (never built/shipped) — don't lint them,
  // or their stale no-undefs would block the gate on code that doesn't ship.
  globalIgnores(['dist', 'src/App.backup.jsx', 'src/App.backup2.jsx']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      // __BUILD_VERSION__ is a Vite compile-time define (see vite.config.js), not a real global.
      globals: { ...globals.browser, __BUILD_VERSION__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Server + tooling files run in Node, so give them Node globals (process, Buffer, …).
    // Without this, no-undef false-positives here would mask the real out-of-scope bugs the
    // ship-check no-undef gate is meant to catch.
    files: ['api/**/*.js', 'lib/**/*.js', 'scripts/**/*.{js,mjs}', '*.config.js', '*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
])
