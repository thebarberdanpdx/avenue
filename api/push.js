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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!originAllowed(req)) return res.status(403).json({ error: "forbidden" });
  const { shopId, title, body, data } = req.body || {};
  if (!shopId || !title) return res.status(400).json({ error: "missing shopId or title" });

  if (!process.env.APNS_KEY || !process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID ||
      !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "push not configured" });
  }

  const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: rows, error } = await supa.from("device_tokens").select("token").eq("shop_id", shopId);
  if (error) return res.status(500).json({ error: "token lookup: " + error.message });
  const tokens = [...new Set((rows || []).map((r) => r.token).filter(Boolean))];
  if (!tokens.length) return res.status(200).json({ sent: 0, note: "no devices registered" });

  let providerToken;
  try { providerToken = makeProviderToken(); }
  catch (e) { return res.status(500).json({ error: "jwt: " + (e && e.message) }); }

  const payload = {
    aps: { alert: { title, body: body || "" }, sound: "default", badge: 1 },
    ...(data ? { data } : {}),
  };

  // Dev (Xcode) builds get sandbox tokens; App Store builds get production tokens.
  // Try sandbox first, then production on a token-environment error — so both just work.
  let sent = 0;
  const results = [];
  for (const t of tokens) {
    let r = await sendOne("api.sandbox.push.apple.com", t, providerToken, payload);
    if (!r.ok && (r.status === 400 || r.reason === "BadDeviceToken")) {
      r = await sendOne("api.push.apple.com", t, providerToken, payload);
    }
    if (r.ok) sent++;
    results.push({ token: t.slice(0, 10) + "…", status: r.status || 0, reason: r.reason || "" });
  }

  return res.status(200).json({ sent, total: tokens.length, results });
}
