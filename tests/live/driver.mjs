// Live-testing browser driver for Vero.
//
// Launches the pre-installed Chromium (no download) and routes it through the
// session's agent proxy. Two accommodations that are ONLY about this test
// browser's hop to the proxy (they do NOT change the real app or real users):
//   * proxy: the sandbox has no direct egress; all HTTPS goes via $HTTPS_PROXY.
//   * --ssl-version-max=tls1.2: the proxy's TLS interception resets Chromium's
//     TLS 1.3 handshakes. Capping at 1.2 fixes it; certs still verify.
//
// Usage:  import { launch } from './driver.mjs'
//         const { browser, context, page } = await launch();
import { chromium } from 'playwright-core';

export const CHROMIUM = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
export const PROXY = process.env.HTTPS_PROXY || 'http://127.0.0.1:42367';

export const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-background-networking',
  '--disable-component-update',
  '--ssl-version-max=tls1.2',            // proxy can't intercept Chromium TLS 1.3 (resets); cap to 1.2
  '--disable-features=Translate,OptimizationHints',
];

// Hosts we must NEVER let the test browser reach — telemetry that would pollute
// Dan's production monitoring or email him. Sentry is the critical one: the live
// app reports errors to it (src/main.jsx), so a test-induced error would fire a
// real "New issue" alert to his inbox. Blocked at the network layer so it can't.
export function isTelemetryHost(hostname) {
  return /(^|\.)sentry\.io$/.test(hostname)
    || hostname.includes('.ingest.')
    || /(^|\.)(google-analytics|googletagmanager|segment\.(io|com)|amplitude|mixpanel|posthog|fullstory|datadoghq)\.com$/.test(hostname);
}

export async function launch({ device = 'iphone', headless = true, blockTelemetry = true, onConsoleError } = {}) {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless,
    args: LAUNCH_ARGS,
    proxy: { server: PROXY, bypass: 'localhost,127.0.0.1' },
  });
  const viewport = device === 'iphone' ? { width: 390, height: 844 } : { width: 1280, height: 900 };
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    // Match the shop's real timezone/locale — the sandbox defaults to UTC, which
    // skews every time-based flow (booking slots, calendar position, "today",
    // reminders) by the offset and reproduces the known off-tz-booker bug.
    timezoneId: process.env.TEST_TZ || 'America/Los_Angeles',
    locale: 'en-US',
    userAgent: device === 'iphone'
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const blockedTelemetry = [];
  if (blockTelemetry) {
    await context.route((url) => { try { return isTelemetryHost(new URL(url).hostname); } catch (e) { return false; } },
      (route) => { blockedTelemetry.push(route.request().url()); route.abort(); });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); onConsoleError && onConsoleError(m.text()); } });
  page.on('pageerror', (e) => { errors.push('[pageerror] ' + e.message); onConsoleError && onConsoleError(e.message); });
  return { browser, context, page, errors, blockedTelemetry };
}
