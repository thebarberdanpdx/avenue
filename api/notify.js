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
  if (!originAllowed(req)) return res.status(403).json({ error: "forbidden" });
  const b = req.body || {};
  const to = b.to || {};
  const SMS_LIVE = process.env.SMS_LIVE === "true";

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
    const subject = `New booking — ${clientName}`;
    const textBody = [`${clientName} booked ${svc}.`, when, note ? `Note: ${note}` : ""].filter(Boolean).join("\n");

    const sent = [];
    for (const p of recip) {
      const pEmail = String(p.email || "").trim();
      const pPhone = String(p.phone || "").replace(/\D/g, "");
      const r = { id: p.id };
      try { if (pEmail) { await sendEmail({ to: pEmail, subject, text: textBody }); r.email = "sent"; } else r.email = "no-email"; }
      catch (e) { r.email = "error: " + e.message; }
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
  const ch = resolveChannels({ channel: b.channel || "email", smsLive: SMS_LIVE, email, phone, smsOptOut: to.smsOptOut === true });

  const results = {};
  try { if (ch.email) { await sendEmail({ to: email, subject: b.subject || "Your appointment", text, html }); results.email = "sent"; } }
  catch (e) { results.email = "error: " + e.message; }
  try { if (ch.sms) { await sendSms({ to: phone, text }); results.sms = "sent"; } }
  catch (e) { results.sms = "error: " + e.message; }

  return res.status(200).json({ ok: true, smsLive: SMS_LIVE, results });
}
