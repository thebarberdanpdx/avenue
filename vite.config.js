import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'

// Bake the deployment version into the bundle so the running app can tell whether it's
// stale vs. what's live (see the version check in App.jsx / api/version.js). Same source
// as api/version.js so they match for a given deployment. 'dev' locally.
const BUILD_VERSION = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_URL || 'dev'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), wasm()],
  worker: { format: 'es' },
  optimizeDeps: {
    // WASM + web workers — must not be pre-bundled (PowerSync / wa-sqlite).
    exclude: ['@journeyapps/wa-sqlite', '@powersync/web'],
  },
  define: {
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
})
