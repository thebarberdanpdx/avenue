// api/notify.js
// On-demand send endpoint for EVENT-driven messages (booking confirmation, cancellation,
// reschedule, deposit receipt, waitlist, "we're ready"). The app POSTs here at the moment
// the event happens. Reminders do NOT use this — they're scheduled by /api/send-reminders.
//
// POST body:
//   { channel: "email"|"text"|"both",
//     to: { email, phone, smsOptOut },
//     subject?,                         // email subject (optional)
//     body?,                            // pre-rendered text, OR:
//     template?, context? }             // template + {client}/{service}/... context to render here
//
// Env: RESEND_API_KEY, EMAIL_FROM, SMS_LIVE, VONAGE_API_KEY, VONAGE_API_SECRET, VONAGE_FROM

import { renderMessage, renderEmailHtml, renderPlainText, sendEmail, sendSms, resolveChannels } from "../lib/messaging.js";
import { createClient } from "@supabase/supabase-js";
import { allowRequest, clientIp } from "../lib/ratelimit.js";

// Light anti-abuse guard. Booking runs on gotvero.com (web AND the native app,
// which loads from server.url = https://gotvero.com), so the only legitimate
// browser origin is ours. Server-to-server callers (e.g. api/client-code.js)
// send NO Origin header. So: block only a *foreign* browser Origin; allow our
// origin and allow no-Origin. This stops another website from scripting our
// send pipe; curl-level flooding still needs rate-limiting (deferred — needs a
// KV store). SMS remains gated by SMS_LIVE and email uses a fixed from-address.
const ALLOWED_ORIGINS = new Set(["https://gotvero.com", "https://www.gotvero.com"]);
function originAllowed(req) {
  const o = (req.headers.origin || req.headers.Origin || "").toString().toLowerCase();
  return !o || ALLOWED_ORIGINS.has(o);
}

import { withErrorReporting } from "../lib/observe.js";
export default withErrorReporting(handler, "notify");
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const b = req.body || {};
  const to = b.to || {};
  const SMS_LIVE = process.env.SMS_LIVE === "true";

  // Trusted internal callers (api/client-code.js) present a shared secret and skip
  // the public gates. Everyone else (the public booking page, and any scripted caller)
  // must pass the Origin filter AND a per-shop/per-IP rate limit so this pipe can't be
  // flooded to spam/phish staff or burn the SMS budget. Fails open on limiter error.
  const internalKey = (req.headers["x-internal-key"] || "").toString();
  const isInternal = !!process.env.INTERNAL_API_KEY && internalKey === process.env.INTERNAL_API_KEY;
  if (!isInternal) {
    if (!originAllowed(req)) return res.status(403).json({ error: "forbidden" });
    const shopForLimit = String(b.shop || (b.staff && b.staff.shopId) || "none");
    const ok = await allowRequest(`notify:${shopForLimit}:${clientIp(req)}`, 30, 10 * 60 * 1000);
    if (!ok) return res.status(429).json({ error: "Too many requests. Please try again shortly." });
  }

  // ---- Staff booking alert: notify the barber an appointment is for, at the email/phone
  //      saved in their staff profile. Recipients are resolved SERVER-SIDE with the service
  //      role so a public (anonymous) booker never receives staff contact info. The owner
  //      picks the scope: "assigned" (default) | "ownerPlus" (owner + barber) | "all".
  if (b.staff && b.staff.shopId) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "staff alerts not configured" });
    }
    const { shopId, providerId, scope } = b.staff;
    const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: rows, error } = await supa.from("providers").select("data").eq("shop_id", shopId);
    if (error) return res.status(500).json({ error: "staff lookup: " + error.message });
    const provs = (rows || []).map((r) => r.data)
      .filter((p) => p && p.id && p.id !== "anyone" && p.isProvider !== false && !p.archived);
    const owner = provs.find((p) => p.pulseRole === "owner");
    const assigned = providerId ? provs.find((p) => p.id === providerId) : null;
    let recip;
    if (scope === "all") recip = provs;
    else if (scope === "ownerPlus") recip = [assigned, owner];
    else recip = [assigned || owner]; // "assigned" — fall back to owner for an "Anyone"/unassigned booking
    const seen = new Set();
    recip = recip.filter((p) => p && p.id && !seen.has(p.id) && seen.add(p.id));

    const c = b.context || {};
    const clientName = String(c.client || "A client").slice(0, 80);
    const svc = String(c.service || "an appointment").slice(0, 120);
    const when = String(c.when || "").slice(0, 60);
    const note = String(c.note || "").slice(0, 300);
    // The client's permanent profile note — resolved here on the server (never sent by a public
    // booker) so the barber gets both the booking note AND the note on file.
    let clientNote = "";
    if (b.staff.clientId && b.staff.clientId !== "guest") {
      try {
        const { data: crow } = await supa.from("clients").select("data").eq("shop_id", shopId).eq("id", b.staff.clientId).maybeSingle();
        clientNote = crow && crow.data ? String(crow.data.notes || "").trim().slice(0, 500) : "";
      } catch (e) {}
    }
    const subject = `New booking — ${clientName}`;
    const lines = [`${clientName} booked ${svc}.`, when];
    if (note) lines.push(`Booking note: "${note}"`);
    if (clientNote) lines.push(`Note on file: "${clientNote}"`);
    const textBody = lines.filter(Boolean).join("\n");

    const sent = [];
    for (const p of recip) {
      const pEmail = String(p.email || "").trim();
      const pPhone = String(p.phone || "").replace(/\D/g, "");
      const r = { id: p.id };
      try { if (pEmail) { await sendEmail({ to: pEmail, subject, text: textBody }); r.email = "sent"; } else r.email = "no-email"; }
      catch (e) { r.email = "error: " + e.message; }
      // SMS is GSM-7; non-GSM characters get delivered as "?". sendSms() sanitizes centrally
      // (see gsmSafe in lib/messaging.js), so every SMS — including the middot service separator —
      // reads clean without each call site handling it.
      try { if (SMS_LIVE && pPhone) { await sendSms({ to: pPhone, text: `${subject}\n${textBody}` }); r.sms = "sent"; } }
      catch (e) { r.sms = "error: " + e.message; }
      sent.push(r);
    }
    return res.status(200).json({ ok: true, staff: true, smsLive: SMS_LIVE, scope: scope || "assigned", sent });
  }

  const ctx = b.context || {};
  const text = b.template ? renderPlainText(b.template, ctx) : (b.body || "");
  const html = b.template ? renderEmailHtml(b.template, ctx) : undefined;
  if (!text) return res.status(400).json({ error: "nothing to send" });

  const email = String(to.email || "").trim();
  const phone = String(to.phone || "").replace(/\D/g, "");

  // ── Anti-relay: this endpoint has no login (the public booking page calls it),
  // so it was an open pipe to send email/SMS "as the shop" to ANY address with ANY
  // content — phishing the shop's own clients (DKIM-valid) or draining the SMS
  // budget to random numbers. Bind it: an unauthenticated send may only reach a
  // contact ALREADY ON FILE for the named shop (a client or staff member). Real
  // confirmations still pass — the person who just booked is on file. We fail OPEN
  // only if the lookup itself errors, so a DB hiccup never silently drops a real
  // booking confirmation; a clean "not on file" result is blocked.
  const shop = String(b.shop || "").trim();
  if (!shop) return res.status(400).json({ error: "missing shop" });
  let recipientOptedOut = false; // set true if the on-file client for this recipient opted out of SMS (#21)
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const emLc = email.toLowerCase();
    const onFile = (rows) => (rows || []).some((r) => {
      const d = (r && r.data) || {};
      return (emLc && String(d.email || "").trim().toLowerCase() === emLc) ||
             (phone && String(d.phone || "").replace(/\D/g, "") === phone);
    });
    let recognized = false, lookupOk = true;
    try {
      const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const { data: crows, error: cErr } = await supa.from("clients").select("data").eq("shop_id", shop);
      if (cErr) throw cErr;
      // #21: find the matching CLIENT and capture their real SMS opt-out here, on the server, so a
      // caller can never text someone who opted out by passing smsOptOut:false (the manage-link
      // reschedule did exactly that). Server-authoritative — protects every notify caller.
      const cmatch = (crows || []).find((r) => {
        const d = (r && r.data) || {};
        return (emLc && String(d.email || "").trim().toLowerCase() === emLc) ||
               (phone && String(d.phone || "").replace(/\D/g, "") === phone);
      });
      if (cmatch) { recognized = true; if (((cmatch.data || {}).smsOptOut) === true) recipientOptedOut = true; }
      if (!recognized) {
        const { data: prows, error: pErr } = await supa.from("providers").select("data").eq("shop_id", shop);
        if (pErr) throw pErr;
        recognized = onFile(prows);
      }
    } catch (e) { lookupOk = false; } // DB error → don't drop a real confirmation
    if (lookupOk && !recognized) {
      return res.status(403).json({ error: "recipient is not on file for this shop" });
    }
  }

  // SMS is suppressed if EITHER the caller flags opt-out OR the server found this recipient opted out.
  const ch = resolveChannels({ channel: b.channel || "email", smsLive: SMS_LIVE, email, phone, smsOptOut: (to.smsOptOut === true) || recipientOptedOut });

  const results = {};
  try { if (ch.email) { await sendEmail({ to: email, subject: b.subject || "Your appointment", text, html }); results.email = "sent"; } }
  catch (e) { results.email = "error: " + e.message; }
  try { if (ch.sms) { await sendSms({ to: phone, text }); results.sms = "sent"; } }
  catch (e) { results.sms = "error: " + e.message; }

  return res.status(200).json({ ok: true, smsLive: SMS_LIVE, results });
}
