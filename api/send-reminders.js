// api/send-reminders.js
// Vercel Cron target. Runs every ~15 min, scans upcoming appointments across all shops,
// and sends any reminder that is due and not already sent. Idempotent via the message_log table,
// so a reminder can never double-fire even if two cron runs overlap.
//
// Env vars required (see SETUP.md):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (service role — server-only, bypasses RLS)
//   RESEND_API_KEY, EMAIL_FROM
//   SMS_LIVE ("true" only after your 10DLC is approved), VONAGE_API_KEY, VONAGE_API_SECRET, VONAGE_FROM
//   SHOP_TZ (default "America/Los_Angeles"), CRON_SECRET (optional, recommended)

import { createClient } from "@supabase/supabase-js";
import { renderMessage, renderEmailHtml, renderPlainText, parseOffsetMinutes, formatApptDateTime, sendEmail, sendSms, resolveChannels } from "../lib/messaging.js";

const DEAD_STATUSES = ["canceled", "cancelled", "done", "no-show", "noshow", "completed"];
// Public site origin for the self-service manage / arrival links baked into reminders.
const SITE = (process.env.SITE_URL || "https://gotvero.com").replace(/\/+$/, "");

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
  const SMS_LIVE = process.env.SMS_LIVE === "true";
  const TZ = process.env.SHOP_TZ || "America/Los_Angeles";
  const now = Date.now();
  const HORIZON_MS = 3 * 24 * 60 * 60 * 1000; // look 3 days ahead — covers the 2-day reminder

  let checked = 0, sent = 0, failed = 0;

  const { data: shops, error: shopErr } = await supa.from("shops").select("id, settings");
  if (shopErr) return res.status(500).json({ error: "shops " + shopErr.message });

  for (const shop of shops || []) {
    const settings = shop.settings || {};
    const reminders = (settings.messages || []).filter((m) => m.enabled && parseOffsetMinutes(m.timing) != null);
    if (!reminders.length) continue;
    const business = settings.name || "your barber";
    const shopPhone = (settings.phones && settings.phones[0] && settings.phones[0].number) || "";
    const shopEmail = settings.email || "";
    const shopAddr = [settings.address, settings.address2].filter(Boolean).join(", ");
    const shopLoc = (settings.multiLocation && settings.locations && settings.locations[0] && settings.locations[0].name) || settings.name || "";
    const shopPolicy = settings.policy || "";

    const [appts, clients, provs, svcs] = await Promise.all([
      supa.from("appointments").select("id, data").eq("shop_id", shop.id),
      supa.from("clients").select("id, data").eq("shop_id", shop.id),
      supa.from("providers").select("id, data").eq("shop_id", shop.id),
      supa.from("services").select("id, data").eq("shop_id", shop.id),
    ]);
    const clientById = Object.fromEntries((clients.data || []).map((r) => [r.id, r.data || {}]));
    const provById = Object.fromEntries((provs.data || []).map((r) => [r.id, r.data || {}]));
    const svcById = Object.fromEntries((svcs.data || []).map((r) => [r.id, r.data || {}]));

    for (const row of appts.data || []) {
      const a = row.data || {};
      if (!a.bookedFor) continue;
      if (DEAD_STATUSES.includes(String(a.status || "").toLowerCase())) continue;
      const apptMs = new Date(a.bookedFor).getTime();
      if (isNaN(apptMs) || apptMs <= now || apptMs - now > HORIZON_MS) continue;

      const client = clientById[a.clientId] || {};
      const when = formatApptDateTime(a.bookedFor, a.start);
      const addons = Array.isArray(a.addonLabels) ? a.addonLabels.filter(Boolean)
                   : Array.isArray(a.addOns) ? a.addOns.map((x) => x && (x.name || x.label || x)).filter(Boolean)
                   : Array.isArray(a.addons) ? a.addons.map((x) => x && (x.name || x.label || x)).filter(Boolean) : [];
      const ctx = {
        client: String(a.name || client.name || "there").split(" ")[0],
        service: a.serviceName || (svcById[a.serviceId] && svcById[a.serviceId].name) || a.title || "your appointment",
        provider: (provById[a.providerId] && provById[a.providerId].name) || "your barber",
        business,
        date: when.date,
        time: when.time,
        address: shopAddr,
        phone: shopPhone,
        email: shopEmail,
        locName: shopLoc,
        policy: shopPolicy,
        addons,
        cancelUrl: a.manageToken ? `${SITE}/manage?t=${a.manageToken}` : "",
        arriveUrl: a.manageToken ? `${SITE}/manage?t=${a.manageToken}&a=1` : "",
      };
      const email = String(client.email || "").trim();
      const phone = String(client.phone || a.phone || "").replace(/\D/g, "");
      const smsOptOut = client.smsOptOut === true;

      for (const m of reminders) {
        const off = parseOffsetMinutes(m.timing);
        const sendAt = apptMs - off * 60000;
        if (now < sendAt) continue; // not due yet (appt still future, so it'll catch a later run)

        const logId = `${shop.id}__${row.id}__${m.id}`;
        const { data: already } = await supa.from("message_log").select("id").eq("id", logId).maybeSingle();
        if (already) continue;
        checked++;

        const ch = resolveChannels({ channel: m.channel, smsLive: SMS_LIVE, email, phone, smsOptOut });
        if (!ch.email && !ch.sms) continue; // no reachable channel

        const textBody = renderPlainText(m.body, ctx);
        const htmlBody = renderEmailHtml(m.body, ctx);
        const via = [];
        try { if (ch.email) { await sendEmail({ to: email, subject: `${business}: ${m.label}`, text: textBody, html: htmlBody }); via.push("email"); } } catch (e) { failed++; }
        try { if (ch.sms) { await sendSms({ to: phone, text: textBody }); via.push("sms"); } } catch (e) { failed++; }

        if (via.length) {
          await supa.from("message_log").insert({ id: logId, shop_id: shop.id, appt_id: row.id, message_id: m.id, via: via.join("+"), sent_at: new Date().toISOString() });
          sent++;
        }
      }
    }
  }

  return res.status(200).json({ ok: true, checked, sent, failed, smsLive: SMS_LIVE });
}
