// lib/observe.js — minimal, dependency-free server-side error reporting to Sentry.
//
// Why this exists: the browser app already reports crashes to Sentry (src/main.jsx),
// but the serverless api/* functions (payments, texts/emails, nightly jobs) reported
// NOTHING — so a failed charge, a broken reminder run, or a crashed cron was invisible
// to the (non-technical) owner. This wires those server failures into the SAME Sentry
// inbox, with the same privacy stance as the browser: errors only, production-only, no PII.
//
// Design rules:
//   1. It must NEVER throw into, or meaningfully slow, a request handler (fire-and-forget,
//      2s timeout, everything swallowed). A monitoring tool that can break the thing it
//      monitors is worse than no monitoring.
//   2. No new npm dependency — we POST a Sentry "envelope" directly with global fetch.
//   3. Same public send-only DSN as the browser (safe to ship; can submit errors, can't read).

import crypto from "crypto";

// Same public DSN as src/main.jsx (overridable via env if a separate server project is ever wanted).
const DSN = process.env.SENTRY_DSN ||
  "https://88c506dd9ab94568407fda197adaba4d@o4511616466616320.ingest.us.sentry.io/4511616484835328";

// Only report from real production deploys (Vercel sets VERCEL_ENV). Mirrors the browser's
// gotvero.com-only gate so preview/dev/local runs never spam the owner's inbox.
const ENABLED = process.env.VERCEL_ENV === "production";

// Parse the DSN once into its envelope endpoint + public key: https://<key>@<host>/<projectId>
function target() {
  try {
    const u = new URL(DSN);
    const key = u.username;
    const projectId = u.pathname.replace(/^\//, "");
    if (!key || !projectId) return null;
    return { url: `${u.protocol}//${u.host}/api/${projectId}/envelope/`, key };
  } catch (e) { return null; }
}

// Report one server-side error. Awaitable, but safe to ignore. Never throws.
export async function reportServerError(err, context) {
  try {
    if (!ENABLED) return;
    const t = target();
    if (!t) return;
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : (() => { try { return JSON.stringify(err); } catch (x) { return String(err); } })());
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      logger: "vero-server",
      environment: "production",
      tags: { fn: (context && context.fn) || "unknown" },
      extra: context || {},
      exception: { values: [{ type: e.name || "Error", value: String(e.message || e) }] },
    };
    const envelope =
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: DSN }) + "\n" +
      JSON.stringify({ type: "event" }) + "\n" +
      JSON.stringify(event) + "\n";
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch (x) {} }, 2000);
    await fetch(t.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${t.key}, sentry_client=vero-server/1.0`,
      },
      body: envelope,
      signal: ctrl.signal,
    }).catch(() => {});
    clearTimeout(timer);
  } catch (e) {
    // Reporting must never break or surface in the handler.
  }
}

// Wrap a serverless handler so any UNCAUGHT exception is reported (then a clean 500 is
// returned). Handlers that already catch + return their own error JSON are unaffected;
// this is the safety net for the ones that throw. Usage:
//   export default withErrorReporting(handler, "stripe")
export function withErrorReporting(handler, name) {
  return async function wrapped(req, res) {
    try {
      return await handler(req, res);
    } catch (err) {
      await reportServerError(err, { fn: name, url: req && req.url, method: req && req.method });
      try { if (res && !res.headersSent) res.status(500).json({ error: "server error" }); } catch (e) {}
    }
  };
}
