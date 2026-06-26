// api/send-birthdays.js
// Vercel Cron target. Runs once a day, finds clients whose birthday is TODAY (in the shop's
// timezone) and EMAILS them the shop's birthday message. Email only — never SMS, by design.
// Idempotent per client per year via the message_log table, so it can't double-send.
//
// Env vars required (same as send-reminders):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (service role — server-only, bypasses RLS)
//   RESEND_API_KEY, EMAIL_FROM
//   SHOP_TZ (default "America/Los_Angeles"), CRON_SECRET (optional, recommended)

import { createClient } from "@supabase/supabase-js";
import { renderEmailHtml, renderPlainText, sendEmail } from "../lib/messaging.js";

import { withErrorReporting, reportServerError } from "../lib/observe.js";
export default withErrorReporting(handler, "send-birthdays");
async function handler(req, res) {
  // Optional shared-secret guard so randoms can't trigger your sends.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    const q = (req.query && req.query.key) || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}` && q !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const TZ = process.env.SHOP_TZ || "America/Los_Angeles";
  const today = new Date();
  // Some serverless runtimes ship without the IANA timezone database and throw
  // "RangeError: Invalid time zone specified" on a named zone. Try the shop tz; if it
  // throws, fall back to UTC date parts (date-granular, so birthday matching is unaffected).
  let todayMD, year;
  try {
    todayMD = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "2-digit", day: "2-digit" }).format(today);
    year = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric" }).format(today);
  } catch (e) {
    todayMD = String(today.getUTCMonth() + 1).padStart(2, "0") + "/" + String(today.getUTCDate()).padStart(2, "0");
    year = String(today.getUTCFullYear());
  }

  let checked = 0, sent = 0, failed = 0;

  const { data: shops, error: shopErr } = await supa.from("shops").select("id, settings");
  if (shopErr) return res.status(500).json({ error: "shops " + shopErr.message });

  for (const shop of shops || []) {
    const settings = shop.settings || {};
    const msg = (settings.messages || []).find((m) => m.id === "birthday");
    if (!msg || !msg.enabled) continue; // owner hasn't turned the birthday message on
    const business = settings.name || "your barber";

    const { data: clients } = await supa.from("clients").select("id, data").eq("shop_id", shop.id);
    for (const row of clients || []) {
      const c = row.data || {};
      if (!c.birthday) continue;
      const email = String(c.email || "").trim();
      if (!email) continue;                      // email only — no email means nothing to send
      // Birthdays are stored as ISO timestamps (toISOString). A date-only value like
      // "1990-06-21" parses as UTC midnight, so formatting it in a west-of-UTC shop tz would
      // roll it back to the 20th — emailing a day early. The intended calendar day already
      // lives in the ISO date portion, so read MM/DD straight from the string; only fall back
      // to the tz formatter for free-text birthdays we couldn't normalise to ISO at import.
      const isoMD = String(c.birthday).match(/^\d{4}-(\d{2})-(\d{2})/);
      let bdMD;
      if (isoMD) {
        bdMD = `${isoMD[1]}/${isoMD[2]}`;
      } else {
        const bd = new Date(c.birthday);
        if (isNaN(bd.getTime())) continue;
        bdMD = mdFmt.format(bd);
      }
      if (bdMD !== todayMD) continue; // not their birthday today
      checked++;

      // Idempotent: one birthday email per client per calendar year.
      const logId = `${shop.id}__bday__${row.id}__${year}`;
      const { data: already } = await supa.from("message_log").select("id").eq("id", logId).maybeSingle();
      if (already) continue;

      const ctx = { client: String(c.name || "there").split(" ")[0], business };
      const subject = `${business}: ${msg.label || "Happy birthday!"}`;
      try {
        await sendEmail({ to: email, subject, text: renderPlainText(msg.body, ctx), html: renderEmailHtml(msg.body, ctx) });
        await supa.from("message_log").insert({ id: logId, shop_id: shop.id, appt_id: `bday__${row.id}`, message_id: "birthday", via: "email", sent_at: new Date().toISOString() });
        sent++;
      } catch (e) { failed++; }
    }
  }

  if (failed > 0) await reportServerError(new Error(`send-birthdays: ${failed} email(s) failed to send`), { fn: "send-birthdays", checked, sent, failed });
  return res.status(200).json({ ok: true, todayMD, checked, sent, failed });
}
