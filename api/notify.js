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
