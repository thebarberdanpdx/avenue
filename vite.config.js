import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Bake the deployment version into the bundle so the running app can tell whether it's
// stale vs. what's live (see the version check in App.jsx / api/version.js). Same source
// as api/version.js so they match for a given deployment. 'dev' locally.
const BUILD_VERSION = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_URL || 'dev'

// Capacitor loads dist/ from capacitor://localhost — asset paths must be relative (./assets/…),
// not absolute (/assets/…), or the bundled iOS app can ship with broken CSS/JS and look unstyled.
const CAPACITOR_BUILD = !!process.env.CAPACITOR_BUILD

// https://vite.dev/config/
export default defineConfig({
  base: CAPACITOR_BUILD ? './' : '/',
  plugins: [react()],
  define: {
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
})
