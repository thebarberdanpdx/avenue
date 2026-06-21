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

export default async function handler(req, res) {
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
  const mdFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "2-digit", day: "2-digit" });
  const yrFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric" });
  const today = new Date();
  const todayMD = mdFmt.format(today);   // "MM/DD" in the shop's timezone
  const year = yrFmt.format(today);

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
      const bd = new Date(c.birthday);
      if (isNaN(bd.getTime())) continue;
      if (mdFmt.format(bd) !== todayMD) continue; // not their birthday today
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

  return res.status(200).json({ ok: true, todayMD, checked, sent, failed });
}
