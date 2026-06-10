// lib/messaging.js
// Shared messaging core — used by both /api/send-reminders (cron) and /api/notify (event sends).
// No framework, minimal deps: plain fetch to Resend (email) and Vonage (SMS).

// Fill {client} {service} {provider} {business} {date} {time} from a context object.
export function renderMessage(tpl, ctx) {
  return String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (ctx && ctx[k] != null ? ctx[k] : m));
}

// Turn a human "timing" string into minutes-before-appointment.
// "2 days before" -> 2880, "24 hours before" -> 1440, "3 hours before" -> 180, "45 minutes before" -> 45.
// Returns null for event-driven messages ("Right after booking", "When canceled", etc.) — those are
// NOT scheduled by the cron; they're sent at their trigger by /api/notify.
export function parseOffsetMinutes(timing) {
  const t = String(timing || "");
  if (!/before/i.test(t)) return null;
  const m = /(\d+)\s*(day|hour|min)/i.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  return u.startsWith("day") ? n * 1440 : u.startsWith("hour") ? n * 60 : n;
}

// Derive local date + time for display WITHOUT a named timezone. Some serverless runtimes
// don't ship the timezone database and throw on "America/Los_Angeles". bookedFor is the
// absolute instant; `start` is the local minutes-from-midnight, so we use it directly.
// UTC is always available, so we shift to local-midnight and read its UTC calendar date.
export function formatApptDateTime(iso, startMin) {
  const apptMs = new Date(iso).getTime();
  const sm = Number(startMin) || 0;
  const localMidnight = new Date(apptMs - sm * 60000); // its UTC Y/M/D == the local date
  const date = localMidnight.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const h = Math.floor(sm / 60), m = sm % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  let hr = h % 12; if (hr === 0) hr = 12;
  const time = `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
  return { date, time };
}

// ---- Email via Resend (https://resend.com) ----
export async function sendEmail({ to, subject, text, from }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: from || process.env.EMAIL_FROM || "onboarding@resend.dev",
      to: [to],
      subject: subject || "Appointment reminder",
      text,
    }),
  });
  if (!r.ok) throw new Error("resend " + r.status + " " + (await r.text()));
  return r.json();
}

// ---- SMS via Vonage (https://developer.vonage.com) ----
// Will start succeeding once your 10DLC campaign is approved and the number is provisioned.
// Until then, callers gate this behind SMS_LIVE so nothing tries to send.
export async function sendSms({ to, text, from }) {
  const params = new URLSearchParams({
    api_key: process.env.VONAGE_API_KEY || "",
    api_secret: process.env.VONAGE_API_SECRET || "",
    from: from || process.env.VONAGE_FROM || "Vero",
    to,
    text,
  });
  const r = await fetch("https://rest.nexmo.com/sms/json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const j = await r.json();
  const m = j.messages && j.messages[0];
  if (!m || m.status !== "0") throw new Error("vonage " + (m ? m["error-text"] : "unknown"));
  return j;
}

// Decide which channels actually fire for a message, given config + recipient + opt-out.
// Key rule: while SMS is not live, a "text"-only message FALLS BACK to email so the client
// still hears from you. "both" sends email now and adds SMS automatically once SMS_LIVE flips.
export function resolveChannels({ channel, smsLive, email, phone, smsOptOut }) {
  const out = { email: false, sms: false };
  const wantsText = channel === "text" || channel === "both";
  const wantsEmail = channel === "email" || channel === "both";
  if (wantsText && smsLive && phone && !smsOptOut) out.sms = true;
  if (wantsEmail && email) out.email = true;
  // text-only but SMS not live yet -> bridge on email if we have one
  if (channel === "text" && !out.sms && email) out.email = true;
  return out;
}
