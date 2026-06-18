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
export async function sendEmail({ to, subject, text, html, from }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: from || process.env.EMAIL_FROM || "onboarding@resend.dev",
      to: [to],
      subject: subject || "Appointment reminder",
      text,
      ...(html ? { html } : {}),
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

// ---- Rich email rendering -------------------------------------------------
// The same template the owner edits in Settings → Messages. Small {fact} tags fill inline;
// {block} tags ({appointment} {location} {policy} {cancel link}) expand into formatted cards/button.
// Email clients ignore CSS variables and most web fonts, so this uses literal Vero hex colors
// and serif/sans fallbacks, in a table layout for broad client support.
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
const BLOCK_TAGS_RE = /(\{appointment\}|\{location\}|\{policy\}|\{cancel link\}|\{checkin link\})/g;

export function renderEmailHtml(template, ctx) {
  const c = ctx || {};
  const G = "#6E8B74", TEXT = "#232221", SUB = "#6F685D", FAINT = "#A39C8A",
        PANEL = "#ffffff", PANEL2 = "#F4EFE4", LINE = "#ECE4D5", BORDER = "#E0D8C7", BG = "#FAF8F3";
  const serif = "Georgia,'Times New Roman',serif";
  const sans = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
  const addonsStr = Array.isArray(c.addons) ? c.addons.join(" · ") : (c.addons || "");
  const card = (inner) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL2};border:1px solid ${LINE};border-radius:12px;margin:10px 0"><tr><td style="padding:14px 16px;font-size:15px;line-height:1.55;color:${TEXT};font-family:${sans}">${inner}</td></tr></table>`;
  const blocks = {
    "{appointment}": () => card(
      `<div style="color:${SUB}">On <b style="color:${TEXT}">${esc(c.date)}</b></div>` +
      `<div style="font-family:${serif};font-size:18px;color:${TEXT};margin-top:4px">${esc(c.service)}</div>` +
      (addonsStr ? `<div style="color:${SUB};font-size:13px;margin-top:2px">${esc(addonsStr)}</div>` : "") +
      `<div style="color:${SUB};margin-top:5px">with <b style="color:${TEXT}">${esc(c.provider)}</b> at <b style="color:${TEXT}">${esc(c.time)}</b></div>`
    ),
    "{location}": () => card(
      `<div style="font-family:${serif};font-size:16px;color:${G};margin-bottom:3px">${esc(c.locName || c.business)}</div>${esc(c.address || "")}`
    ),
    "{policy}": () => card(esc(c.policy || "")),
    "{cancel link}": () => {
      const href = c.cancelUrl || ("tel:" + String(c.phone || "").replace(/[^0-9+]/g, ""));
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:6px 0"><a href="${esc(href)}" style="display:inline-block;background:${G};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:11px;font-family:${sans}">Reschedule or cancel</a></td></tr></table>`;
    },
    "{checkin link}": () => {
      const href = c.arriveUrl || c.cancelUrl || ("tel:" + String(c.phone || "").replace(/[^0-9+]/g, ""));
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:6px 0"><a href="${esc(href)}" style="display:inline-block;background:${G};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:11px;font-family:${sans}">I'm here &mdash; let ${esc(c.provider || "us")} know</a></td></tr></table>`;
    },
  };
  const inline = (seg) => {
    let t = esc(seg);
    t = t.replace(/\{client\}/g, esc(c.client || "")).replace(/\{provider\}/g, esc(c.provider || ""))
         .replace(/\{service\}/g, esc(c.service || "")).replace(/\{date\}/g, esc(c.date || ""))
         .replace(/\{time\}/g, esc(c.time || "")).replace(/\{business\}/g, esc(c.business || ""))
         .replace(/\{address\}/g, esc(c.address || "")).replace(/\{phone\}/g, esc(c.phone || ""))
         .replace(/\{email\}/g, esc(c.email || ""));
    return t.replace(/\n/g, "<br>");
  };
  const inner = String(template || "").split(BLOCK_TAGS_RE).map((p) =>
    blocks[p] ? blocks[p]() : `<div style="font-size:15px;line-height:1.6;color:${TEXT};font-family:${sans};margin:2px 0">${inline(p)}</div>`
  ).join("");
  return `<!doctype html><html><body style="margin:0;background:${BG};padding:24px 12px;font-family:${sans}">` +
    `<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto"><tr><td style="background:${PANEL};border:1px solid ${BORDER};border-radius:16px;overflow:hidden">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 24px 16px;border-bottom:1px solid ${LINE}"><div style="font-family:${serif};font-size:22px;letter-spacing:1px;text-transform:uppercase;color:${TEXT}">${esc(c.business || "")}</div></td></tr></table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:18px 24px 6px">${inner}</td></tr></table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 24px;border-top:1px solid ${LINE}"><div style="font-size:12px;color:${FAINT};font-family:${sans}">Sent by ${esc(c.business || "")} &middot; Powered by Vero</div></td></tr></table>` +
    `</td></tr></table></body></html>`;
}

// Plain-text version (Text channel + email fallback text). Block tags flatten to simple lines.
export function renderPlainText(template, ctx) {
  const c = ctx || {};
  const addonsStr = Array.isArray(c.addons) ? c.addons.join(" · ") : (c.addons || "");
  let t = String(template || "");
  t = t.replace(/\{appointment\}/g, `${c.date || ""}\n${c.service || ""}${addonsStr ? "\n" + addonsStr : ""}\nwith ${c.provider || ""} at ${c.time || ""}`);
  t = t.replace(/\{location\}/g, `${c.locName || c.business || ""}\n${c.address || ""}`);
  t = t.replace(/\{policy\}/g, c.policy || "");
  t = t.replace(/\{cancel link\}/g, c.cancelUrl ? `Reschedule or cancel: ${c.cancelUrl}` : `To reschedule, call or text ${c.phone || ""}.`);
  t = t.replace(/\{checkin link\}/g, c.arriveUrl ? `Here? Let us know you've arrived: ${c.arriveUrl}` : (c.cancelUrl ? `Manage your visit: ${c.cancelUrl}` : `Give us a call when you arrive: ${c.phone || ""}.`));
  return renderMessage(t, c);
}
