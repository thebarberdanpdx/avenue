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

// Carriers encode SMS in the GSM-7 alphabet; any character outside it (em/en dashes, curly
// quotes, ellipsis, middots/bullets, non-breaking spaces) is delivered as "?". The app's copy
// uses a middot separator (e.g. "Haircut · Standard Cut") and em dashes, so swap the common
// offenders for plain GSM-safe equivalents. Applied inside sendSms below so EVERY SMS path
// (staff alerts, client confirmations, reminders) is covered — no call site has to remember.
export function gsmSafe(s) {
  return String(s == null ? "" : s)
    .replace(/[–—]/g, "-")              // – — en/em dash
    .replace(/[‘’‚′]/g, "'")   // ' ' ‚ ′ curly / prime single quotes
    .replace(/[“”„″]/g, '"')   // " " „ ″ curly / prime double quotes
    .replace(/…/g, "...")                     // … ellipsis
    .replace(/[·•∙‧・]/g, "-") // · • ∙ ‧ ・ middots / bullets
    .replace(/ /g, " ");                      // non-breaking space
}

// ---- SMS via Vonage (https://developer.vonage.com) ----
// Will start succeeding once your 10DLC campaign is approved and the number is provisioned.
// Until then, callers gate this behind SMS_LIVE so nothing tries to send.
export async function sendSms({ to, text, from }) {
  // Vonage needs E.164 digits (with country code). A bare 10-digit US number gets
  // rejected, so default a 10-digit number to US (+1). Numbers that already carry a
  // country code (11+ digits) pass through untouched.
  let dest = String(to || "").replace(/\D/g, "");
  if (dest.length === 10) dest = "1" + dest;
  const params = new URLSearchParams({
    api_key: process.env.VONAGE_API_KEY || "",
    api_secret: process.env.VONAGE_API_SECRET || "",
    from: from || process.env.VONAGE_FROM || "Vero",
    to: dest,
    text: gsmSafe(text),
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
const BLOCK_TAGS_RE = /(\{appointment\}|\{waitlist request\}|\{location\}|\{policy\}|\{cancel link\}|\{checkin link\}|\{review link\})/g;

export function renderEmailHtml(template, ctx) {
  const c = ctx || {};
  // [email-brand-bw] Black-&-white brand to match the shop's real logo (was Vero green/cream). Literal
  // hex + table layout + inline styles — email clients ignore CSS vars/webfonts. Dark logo header band,
  // white body, one black button. Logo is a hosted image (data-URI logos get blocked by Gmail), so we
  // reference c.logoUrl, defaulting to the shop's hosted asset; alt text degrades to the name if blocked.
  const INK = "#141414", HEAD = "#ffffff", TEXT = "#242424", SUB = "#6b6b6b", FAINT = "#9a9a9a",
        PANEL = "#ffffff", PANEL2 = "#f6f6f6", LINE = "#ececec", BORDER = "#e4e4e4", BG = "#f4f4f4";
  const serif = "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,'Times New Roman',serif";
  const sans = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
  const LOGO = c.logoUrl || "https://gotvero.com/email-logo.png"; // single-tenant default; pass c.logoUrl per-shop
  const telHref = "tel:" + String(c.phone || "").replace(/[^0-9+]/g, "");
  const addonsStr = Array.isArray(c.addons) ? c.addons.join(", ") : (c.addons || "");
  const card = (inner) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL2};border:1px solid ${LINE};border-radius:12px;margin:12px 0"><tr><td style="padding:15px 17px;font-size:15px;line-height:1.55;color:${TEXT};font-family:${sans}">${inner}</td></tr></table>`;
  const btn = (href, label) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0"><a href="${esc(href)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 30px;border-radius:12px;font-family:${sans}">${label}</a></td></tr></table>`;
  const blocks = {
    "{appointment}": () => card(
      `<div style="color:${SUB};font-size:14px">On <b style="color:${INK}">${esc(c.date)}</b></div>` +
      `<div style="font-family:${serif};font-size:19px;color:${INK};font-weight:600;margin-top:6px">${esc(c.service)}</div>` +
      (addonsStr ? `<div style="color:${SUB};font-size:14px;margin-top:2px">(${esc(addonsStr)})</div>` : "") +
      `<div style="color:${SUB};margin-top:6px;font-size:14.5px">with <b style="color:${INK}">${esc(c.provider)}</b> at <b style="color:${INK}">${esc(c.time)}</b></div>`
    ),
    // waitlist-JOINED confirmation: service + add-ons + barber, then the requested day/time windows (c.waitDates)
    "{waitlist request}": () => card(
      `<div style="font-family:${serif};font-size:19px;color:${INK};font-weight:600">${esc(c.service)}</div>` +
      (addonsStr ? `<div style="color:${SUB};font-size:14px;margin-top:2px">(${esc(addonsStr)})</div>` : "") +
      `<div style="color:${SUB};margin-top:6px;font-size:14.5px">with <b style="color:${INK}">${esc(c.provider)}</b></div>` +
      (c.waitDates ? `<div style="color:${INK};font-weight:600;font-size:14px;margin-top:13px">Requested date(s):</div><div style="color:${SUB};font-size:14.5px;margin-top:3px;line-height:1.6">${esc(c.waitDates).replace(/\n/g, "<br>")}</div>` : "")
    ),
    "{location}": () => card(
      `<div style="font-family:${serif};font-size:16px;color:${INK};margin-bottom:4px;font-weight:600">${esc(c.locName || c.business)}</div><div style="color:${SUB}">${esc(c.address || "")}</div>`
    ),
    "{policy}": () => card(`<div style="color:${SUB}">${esc(c.policy || "")}</div>`),
    "{cancel link}": () => btn(c.cancelUrl || telHref, "Reschedule or cancel"),
    "{checkin link}": () => btn(c.arriveUrl || c.cancelUrl || telHref, "I'm here &mdash; let " + esc(c.provider || "us") + " know"),
    "{review link}": () => btn(c.reviewUrl || "#", "Leave a review"),
  };
  const inline = (seg) => {
    let t = esc(seg);
    t = t.replace(/\{client\}/g, esc(c.client || "")).replace(/\{provider\}/g, esc(c.provider || ""))
         .replace(/\{service\}/g, esc(c.service || "")).replace(/\{date\}/g, esc(c.date || ""))
         .replace(/\{time\}/g, esc(c.time || "")).replace(/\{business\}/g, esc(c.business || ""))
         .replace(/\{address\}/g, esc(c.address || "")).replace(/\{phone\}/g, esc(c.phone || ""))
         .replace(/\{email\}/g, esc(c.email || ""))
         .replace(/\{amount\}/g, esc(c.amount || ""))
         .replace(/\{book link\}/g, c.bookUrl ? `<a href="${esc(c.bookUrl)}" style="color:${INK};text-decoration:underline;font-weight:600">link</a>` : "link");
    return t.replace(/\n/g, "<br>");
  };
  const inner = String(template || "").split(BLOCK_TAGS_RE).map((p) =>
    blocks[p] ? blocks[p]() : `<div style="font-size:15px;line-height:1.6;color:${TEXT};font-family:${sans};margin:2px 0">${inline(p)}</div>`
  ).join("");
  const contactBits = [
    c.email ? `email <a href="mailto:${esc(c.email)}" style="color:${INK};text-decoration:none;font-weight:600">${esc(c.email)}</a>` : "",
    c.phone ? `call <a href="${esc(telHref)}" style="color:${INK};text-decoration:none;font-weight:600">${esc(c.phone)}</a>` : "",
  ].filter(Boolean).join(" or ");
  return `<!doctype html><html><body style="margin:0;background:${BG};padding:24px 12px;font-family:${sans}">` +
    `<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto"><tr><td style="background:${PANEL};border:1px solid ${BORDER};border-radius:16px;overflow:hidden">` +
    // logo header — clean white box with the logo sized modestly (letterhead style)
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${HEAD}"><tr><td align="center" style="padding:26px 24px 22px;background:${HEAD};border-bottom:1px solid ${LINE}"><img src="${esc(LOGO)}" alt="${esc(c.business || "")}" width="188" style="width:188px;max-width:56%;height:auto;display:block;margin:0 auto;border:0"></td></tr></table>` +
    // body
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px 26px 8px">${inner}</td></tr></table>` +
    // footer
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:8px 26px 24px">` +
      (contactBits ? `<div style="font-size:13.5px;color:${SUB};font-family:${sans};line-height:1.6">If you have any questions, ${contactBits}.</div>` : "") +
      `<div style="font-size:13.5px;color:${SUB};font-family:${sans};margin-top:14px;line-height:1.5">Thanks,<br><b style="color:${INK}">${esc(c.business || "")}</b></div>` +
      `<div style="border-top:1px solid ${LINE};margin-top:18px;padding-top:13px;font-size:11px;color:${FAINT};font-family:${sans}">Powered by Vero</div>` +
    `</td></tr></table>` +
    `</td></tr></table></body></html>`;
}

// Plain-text version (Text channel + email fallback text). Block tags flatten to simple lines.
export function renderPlainText(template, ctx) {
  const c = ctx || {};
  const addonsStr = Array.isArray(c.addons) ? c.addons.join(" · ") : (c.addons || "");
  let t = String(template || "");
  t = t.replace(/\{appointment\}/g, `On ${c.date || ""}\n${c.service || ""}${addonsStr ? ` (${addonsStr})` : ""}\nwith ${c.provider || ""} at ${c.time || ""}`);
  t = t.replace(/\{waitlist request\}/g, `${c.service || ""}${addonsStr ? ` (${addonsStr})` : ""}\nwith ${c.provider || ""}${c.waitDates ? `\n\nRequested date(s):\n${c.waitDates}` : ""}`);
  t = t.replace(/\{location\}/g, `${c.locName || c.business || ""}\n${c.address || ""}`);
  t = t.replace(/\{policy\}/g, c.policy || "");
  t = t.replace(/\{cancel link\}/g, c.cancelUrl ? `Reschedule or cancel: ${c.cancelUrl}` : `To reschedule, call or text ${c.phone || ""}.`);
  t = t.replace(/\{checkin link\}/g, c.arriveUrl ? `Here already? Tap to check in: ${c.arriveUrl}` : (c.cancelUrl ? `Manage your visit: ${c.cancelUrl}` : `Give us a call when you arrive: ${c.phone || ""}.`));
  t = t.replace(/\{review link\}/g, c.reviewUrl ? `Leave a review: ${c.reviewUrl}` : "");
  t = t.replace(/\{book link\}/g, c.bookUrl || "");
  return renderMessage(t, c);
}
