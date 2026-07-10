import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'

// GUARD: native-viewport-boot — belt-and-suspenders after index.html inline script.
// Uses screen.width ONLY (never innerWidth — that locked ~980px and enlarged the whole UI).
function ensureNativeViewport() {
  if (typeof window === 'undefined') return
  const proto = window.location.protocol
  const ua = navigator.userAgent || ''
  const isNative =
    proto === 'capacitor:' || proto === 'ionic:' ||
    !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
    (/iPhone|iPod|iPad/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua)) ||
    (/Android/i.test(ua) && /; wv\)/.test(ua))
  if (!isNative) return
  const sw = Math.min(screen.width || 390, screen.height || 844)
  const want = `width=${sw}, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`
  let meta = document.querySelector('meta[name="viewport"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'viewport')
    document.head.appendChild(meta)
  }
  if (meta.getAttribute('content') !== want) meta.setAttribute('content', want)
}
ensureNativeViewport()

// Error monitoring — emails the owner when something actually breaks.
// Privacy-conscious by design: errors only (NO Session Replay / screen
// recording, NO performance tracing), and sendDefaultPii is off so we don't
// ship customer names / phones / IP addresses to Sentry. The DSN is a public,
// send-only key (safe to ship, like the Stripe & Supabase publishable keys) —
// it can submit error reports but can't read anything back.
const IS_PROD = typeof window !== 'undefined' && window.location.hostname === 'gotvero.com'
Sentry.init({
  dsn: 'https://88c506dd9ab94568407fda197adaba4d@o4511616466616320.ingest.us.sentry.io/4511616484835328',
  // Only report from the LIVE site (web + native, which both load from
  // gotvero.com) — never from local dev / preview builds, so the owner's inbox
  // only ever gets alerts about real, customer-facing breakages.
  enabled: IS_PROD,
  environment: IS_PROD ? 'production' : 'development',
  sendDefaultPii: false,
  tracesSampleRate: 0,
  // Drop noise we can't act on (browser quirks, extensions, dropped network).
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error promise rejection captured',
    'Load failed',
    'Failed to fetch',
  ],
})

// If the whole app ever crashes (white screen), show a friendly recovery card
// instead of a blank page — and the crash is reported automatically.
const Fallback = (
  <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
    <div style={{ maxWidth: 360 }}>
      <div style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>Something went wrong</div>
      <div style={{ color: '#666', fontSize: 15, lineHeight: 1.5, marginBottom: 18 }}>Please refresh the page to keep going. The team has been notified automatically.</div>
      <button onClick={() => window.location.reload()} style={{ padding: '11px 20px', borderRadius: 9, border: 'none', background: '#111', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Refresh</button>
    </div>
  </div>
)

const rootEl = document.getElementById('root')
// GUARD: root-shell-layout — index.html must not leave flex/center on #root; clear on boot.
if (rootEl) {
  rootEl.removeAttribute('style')
  rootEl.textContent = ''
}
createRoot(rootEl).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={Fallback}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
