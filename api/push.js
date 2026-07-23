// api/push.js
// Sends an Apple Push Notification to all of a shop's signed-in staff devices.
// The app POSTs here when a new booking is created.
//
// POST body: { shopId, title, body, data? }
//
// Env vars required (add in Vercel):
//   APNS_KEY                  the FULL contents of your AuthKey_XXXX.p8 file
//   APNS_KEY_ID               the 10-char Key ID (the XXXX in the filename)
//   APNS_TEAM_ID              your 10-char Apple Team ID
//   APNS_BUNDLE_ID            optional, defaults to com.gotvero.app
//   SUPABASE_URL              (already set — used by reminders)
//   SUPABASE_SERVICE_ROLE_KEY (already set — server-only, bypasses RLS)

import crypto from "crypto";
import http2 from "http2";
import { createClient } from "@supabase/supabase-js";
import { allowRequest, clientIp } from "../lib/ratelimit.js";

const BUNDLE_ID = process.env.APNS_BUNDLE_ID || "com.gotvero.app";

// Light anti-abuse guard (see api/notify.js for the rationale). Booking — which
// fires the "new booking" push — runs on gotvero.com (web + native). Block only
// a foreign browser Origin; allow our origin and allow no-Origin callers.
const ALLOWED_ORIGINS = new Set(["https://gotvero.com", "https://www.gotvero.com"]);
function originAllowed(req) {
  const o = (req.headers.origin || req.headers.Origin || "").toString().toLowerCase();
  return !o || ALLOWED_ORIGINS.has(o);
}

// Build the short-lived ES256 JWT APNs wants, signed with the .p8 key.
// Uses Node's built-in crypto (ieee-p1363 gives the raw r||s signature APNs needs).
function makeProviderToken() {
  const header = { alg: "ES256", kid: process.env.APNS_KEY_ID };
  const payload = { iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const key = (process.env.APNS_KEY || "").replace(/\\n/g, "\n");
  const sig = crypto
    .sign("SHA256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  return `${signingInput}.${sig}`;
}

// Send one push to one device on one host. Resolves with { ok, status, reason }.
function sendOne(host, token, providerToken, payload) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let client;
    try { client = http2.connect(`https://${host}`); }
    catch (e) { return done({ ok: false, reason: "connect" }); }
    client.on("error", () => done({ ok: false, reason: "connect" }));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "authorization": `bearer ${providerToken}`,
      "apns-topic": BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0, raw = "";
    req.on("response", (h) => { status = h[":status"]; });
    req.setEncoding("utf8");
    req.on("data", (d) => { raw += d; });
    req.on("end", () => {
      try { client.close(); } catch (e) {}
      let reason = "";
      try { reason = raw ? (JSON.parse(raw).reason || "") : ""; } catch (e) {}
      done({ ok: status === 200, status, reason });
    });
    req.on("error", () => { try { client.close(); } catch (e) {} done({ ok: false, reason: "request" }); });
    req.end(JSON.stringify(payload));
  });
}

import { withErrorReporting } from "../lib/observe.js";
export default withErrorReporting(handler, "push");
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!originAllowed(req)) return res.status(403).json({ error: "forbidden" });
  const { shopId, title, body, data, clientId, scope, providerId } = req.body || {};
  if (!shopId || !title) return res.status(400).json({ error: "missing shopId or title" });

  // Bound abuse: anyone reaching this URL could push arbitrary alerts to a shop's staff
  // iPhones. Cap per shop+IP so it can't be used as a push-spam/phishing cannon. Fails
  // open on limiter error so a real "new booking" push is never dropped.
  const rlOk = await allowRequest(`push:${shopId}:${clientIp(req)}`, 30, 10 * 60 * 1000);
  if (!rlOk) return res.status(429).json({ error: "Too many requests. Please try again shortly." });

  if (!process.env.APNS_KEY || !process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID ||
      !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "push not configured" });
  }

  const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: rows, error } = await supa.from("device_tokens").select("*").eq("shop_id", shopId);
  if (error) return res.status(500).json({ error: "token lookup: " + error.message });
  let tokenRows = (rows || []).filter((r) => r && r.token);

  // [per-person-push] When the caller passes a recipient scope, deliver the in-app pop-up to the SAME
  // staff the text/email side targets — matched by the auth identity each device registered under
  // (save_device_token stores the token against the signed-in staff user). This is READ-ONLY and
  // FAIL-OPEN at every branch: if we can't CONFIDENTLY identify a device's owner as a NON-recipient,
  // we keep it — so a staff alert is never silently dropped. Worst case = today's shop-wide behavior.
  if (scope) {
    try {
      const { data: prows } = await supa.from("providers").select("data").eq("shop_id", shopId);
      const provs = (prows || []).map((r) => r.data).filter((p) => p && p.id && p.id !== "anyone" && p.isProvider !== false && !p.archived);
      const owner = provs.find((p) => p.pulseRole === "owner");
      const assigned = providerId ? provs.find((p) => p.id === providerId) : null;
      let recip;
      if (scope === "all") recip = provs;
      else if (scope === "ownerPlus") recip = [assigned, owner];
      else recip = [assigned || owner];
      const norm = (e) => String(e || "").trim().toLowerCase();
      const recipEmails = new Set(recip.filter(Boolean).map((p) => norm(p.email)).filter(Boolean));
      const allEmails = new Set(provs.map((p) => norm(p.email)).filter(Boolean));
      // Map staff emails → the auth user ids their devices registered under.
      let users = [];
      try { const { data: ul } = await supa.auth.admin.listUsers({ page: 1, perPage: 200 }); users = (ul && ul.users) || []; } catch (e) { users = []; }
      const recipUserIds = new Set();
      const staffUserIds = new Set();
      for (const u of users) {
        const em = norm(u.email);
        if (!em) continue;
        if (recipEmails.has(em)) recipUserIds.add(String(u.id));
        if (allEmails.has(em)) staffUserIds.add(String(u.id));
      }
      // Schema-agnostic: match a token row to an owner by scanning its values for a known staff user id
      // (device_tokens stores the id under some column we don't hardcode).
      const rowVals = (r) => Object.values(r || {}).map((v) => (v == null ? "" : String(v)));
      // Only narrow if we could actually identify recipients AND at least one device as staff-owned —
      // otherwise the mapping isn't reliable here, so fall open to shop-wide.
      const anyIdentified = recipUserIds.size > 0 && tokenRows.some((r) => rowVals(r).some((v) => staffUserIds.has(v)));
      if (anyIdentified) {
        tokenRows = tokenRows.filter((r) => {
          const vals = rowVals(r);
          if (vals.some((v) => recipUserIds.has(v))) return true;  // a recipient's device
          if (vals.some((v) => staffUserIds.has(v))) return false; // a known non-recipient's device
          return true;                                             // unidentifiable → keep (fail open)
        });
      }
    } catch (e) { /* any failure → leave tokenRows shop-wide */ }
  }

  const tokens = [...new Set(tokenRows.map((r) => r.token).filter(Boolean))];
  if (!tokens.length) return res.status(200).json({ sent: 0, note: "no devices registered" });

  let providerToken;
  try { providerToken = makeProviderToken(); }
  catch (e) { return res.status(500).json({ error: "jwt: " + (e && e.message) }); }

  // Enrich with the client's permanent profile note — looked up here on the server (never sent
  // by a public booker) so the barber sees it next to the booking note.
  let finalBody = body || "";
  if (clientId && clientId !== "guest") {
    try {
      const { data: crow } = await supa.from("clients").select("data").eq("shop_id", shopId).eq("id", clientId).maybeSingle();
      const cnote = crow && crow.data ? String(crow.data.notes || "").trim() : "";
      if (cnote) finalBody = finalBody ? `${finalBody}\nNote on file: ${cnote}` : `Note on file: ${cnote}`;
    } catch (e) {}
  }

  const payload = {
    // badge:0 shows the alert but leaves no lingering dot on the app icon, and clears any
    // currently-stuck badge (the app has no unread-count model, so a persistent badge was noise).
    aps: { alert: { title, body: finalBody }, sound: "default", badge: 0 },
    // [push-deeplink-shape] Deep-link fields (t/id) go BOTH at the top level AND nested under `data`
    // so the app's tap handler finds them no matter how iOS/Capacitor delivers the custom payload
    // (flat keys, a nested object, or a JSON string). Nesting alone was unreliable — a tapped
    // "rescheduled" notification then failed to open the appointment's day.
    ...(data && typeof data === "object" ? data : {}),
    ...(data ? { data } : {}),
  };

  // App Store / TestFlight builds get PRODUCTION tokens; local Xcode dev builds get sandbox.
  // The app ships with aps-environment=production, so production is the common case — try it
  // FIRST, then fall back to sandbox on a token-environment error so a local dev build still works.
  let sent = 0;
  const results = [];
  for (const t of tokens) {
    let r = await sendOne("api.push.apple.com", t, providerToken, payload);
    if (!r.ok && (r.status === 400 || r.reason === "BadDeviceToken")) {
      r = await sendOne("api.sandbox.push.apple.com", t, providerToken, payload);
    }
    if (r.ok) sent++;
    // Don't echo any part of the device token back to the (public) caller.
    results.push({ status: r.status || 0, reason: r.reason || "" });
  }

  return res.status(200).json({ sent, total: tokens.length, results });
}
