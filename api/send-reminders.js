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
import { selectAllRows } from "../lib/paginate.js";

const DEAD_STATUSES = ["canceled", "cancelled", "done", "no-show", "noshow", "completed"];
// Public site origin for the self-service manage / arrival links baked into reminders.
const SITE = (process.env.SITE_URL || "https://gotvero.com").replace(/\/+$/, "");

import { withErrorReporting, reportServerError } from "../lib/observe.js";
export default withErrorReporting(handler, "send-reminders");
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
  const SMS_LIVE = process.env.SMS_LIVE === "true";
  const TZ = process.env.SHOP_TZ || "America/Los_Angeles";
  const now = Date.now();
  const HORIZON_MS = 3 * 24 * 60 * 60 * 1000; // look 3 days ahead — covers the 2-day reminder
  // A reminder only fires within this window AFTER its scheduled send time. If the send time is
  // staler than this, the appointment was booked (or moved) with less lead than the reminder's
  // offset — e.g. a same-day booking, or an appointment nudged to 30 min out — so firing a
  // "2 days before" / "1 day before" / "3 hours before" note now would be nonsensical. Skipping
  // stale sends keeps only reminders whose lead time still applies. 2h is small enough to drop a
  // "3 hours before" on a short-notice appointment, yet large enough to absorb the reminder cron's
  // real cadence/delays. The appt-in-past guard above still stops anything after the appointment.
  const CATCHUP_MS = 2 * 60 * 60 * 1000; // 2 hours

  let checked = 0, sent = 0, failed = 0;

  const { data: shops, error: shopErr } = await supa.from("shops").select("id, settings");
  if (shopErr) return res.status(500).json({ error: "shops " + shopErr.message });

  for (const shop of shops || []) {
    const settings = shop.settings || {};
    const reminders = (settings.messages || []).filter((m) => m.enabled && parseOffsetMinutes(m.timing) != null);
    // NOTE: no early `continue` when reminders is empty — the "time to book" pass further down
    // must still run for this shop even if every appointment reminder is switched off.
    const business = settings.name || "your barber";
    const shopPhone = (settings.phones && settings.phones[0] && settings.phones[0].number) || "";
    const shopEmail = settings.email || "";
    const shopAddr = [settings.address, settings.address2].filter(Boolean).join(", ");
    const shopLoc = (settings.multiLocation && settings.locations && settings.locations[0] && settings.locations[0].name) || settings.name || "";
    const shopPolicy = settings.policy || "";

    // Paginate appts + clients — an unranged .select() caps at 1000 rows, so reminders for any
    // appointment/client past the first 1,000 would silently never send. Providers/services are
    // tiny (never near 1,000) so they stay as plain reads.
    const [appts, clients, provs, svcs] = await Promise.all([
      selectAllRows(() => supa.from("appointments").select("id, data").eq("shop_id", shop.id).order("id")),
      selectAllRows(() => supa.from("clients").select("id, data").eq("shop_id", shop.id).order("id")),
      supa.from("providers").select("id, data").eq("shop_id", shop.id),
      supa.from("services").select("id, data").eq("shop_id", shop.id),
    ]);
    const clientById = Object.fromEntries((clients.data || []).map((r) => [r.id, r.data || {}]));
    const provById = Object.fromEntries((provs.data || []).map((r) => [r.id, r.data || {}]));
    const svcById = Object.fromEntries((svcs.data || []).map((r) => [r.id, r.data || {}]));

    for (const row of (reminders.length ? appts.data : []) || []) {
      const a = row.data || {};
      if (!a.bookedFor) continue;
      if (DEAD_STATUSES.includes(String(a.status || "").toLowerCase())) continue;
      // Service already under way → the client is in the chair, so don't send any remaining
      // reminders (notably the ~15-min "time to check in" nudge). Owner's rule: once the service
      // is started, no check-in. Triggered by the start timestamp or the "in-service" status.
      if (a.serviceStartedAt || String(a.status || "").toLowerCase() === "in-service") continue;
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
      // Reminders + the check-in link go to the person ATTENDING. For a booking made on behalf of a
      // family member, the appointment carries that member's own phone — prefer it over the account
      // holder's number so the right person is reminded and can check in.
      const phone = String((a.familyMemberId && a.phone ? a.phone : (client.phone || a.phone)) || "").replace(/\D/g, "");
      const smsOptOut = client.smsOptOut === true;

      for (const m of reminders) {
        const off = parseOffsetMinutes(m.timing);
        const sendAt = apptMs - off * 60000;
        if (now < sendAt) continue; // not due yet (appt still future, so it'll catch a later run)
        if (now - sendAt > CATCHUP_MS) continue; // window already lapsed when booked — don't send a stale, out-of-order reminder

        // Key the idempotency log by the appointment's scheduled time too, so RESCHEDULING an
        // appointment (bookedFor changes → apptMs changes) yields a fresh key and re-fires the
        // reminders that apply to the new time. An unchanged appointment keeps the same key, so a
        // reminder still never double-sends.
        const logId = `${shop.id}__${row.id}__${m.id}__${apptMs}`;

        const ch = resolveChannels({ channel: m.channel, smsLive: SMS_LIVE, email, phone, smsOptOut });
        if (!ch.email && !ch.sms) continue; // no reachable channel — nothing to claim or send

        // #30: ATOMIC dedupe. Claim the send by INSERTING the log row FIRST (message_log.id is the
        // primary key, so a concurrent cron run inserting the same id conflicts and errors). Only the
        // run that wins the insert goes on to send; an overlapping run sees the conflict and skips —
        // closing the old check-then-insert race that could double-send the same reminder.
        const claim = await supa.from("message_log").insert({ id: logId, shop_id: shop.id, appt_id: row.id, message_id: m.id, via: "pending", sent_at: new Date().toISOString() });
        if (claim.error) continue; // already claimed (or sent) by another run
        checked++;

        const textBody = renderPlainText(m.body, ctx);
        const htmlBody = renderEmailHtml(m.body, ctx);
        const via = [];
        try { if (ch.email) { await sendEmail({ to: email, subject: `${business}: ${m.label}`, text: textBody, html: htmlBody, fromName: business, replyTo: shopEmail }); via.push("email"); } } catch (e) { failed++; }
        try { if (ch.sms) { await sendSms({ to: phone, text: textBody }); via.push("sms"); } } catch (e) { failed++; }

        if (via.length) {
          await supa.from("message_log").update({ via: via.join("+"), sent_at: new Date().toISOString() }).eq("id", logId);
          sent++;
        } else {
          // Nothing actually sent (all channels errored) — release the claim so a later run can retry.
          await supa.from("message_log").delete().eq("id", logId);
        }
      }
    }

    // ---- "Time to book" reminders — set on the checkout rebook screen instead of booking now. ----
    // The client record carries { bookReminder: { at, label, serviceName, ... } }. When `at` comes due,
    // text them a nudge with the shop's booking link (email fallback), then mark the reminder sent.
    // Same atomic message_log claim as appointment reminders, so overlapping runs can't double-send.
    for (const row of clients.data || []) {
      const c = row.data || {};
      const br = c.bookReminder;
      if (!br || !br.at || br.sent) continue;
      const dueMs = new Date(br.at).getTime();
      if (isNaN(dueMs) || now < dueMs) continue;
      if (now - dueMs > 7 * 24 * 60 * 60 * 1000) continue; // over a week stale (cron was down) — don't send an ancient nudge

      const email = String(c.email || "").trim();
      const phone = String(c.phone || "").replace(/\D/g, "");
      const ch = resolveChannels({ channel: "text", smsLive: SMS_LIVE, email, phone, smsOptOut: c.smsOptOut === true });
      if (!ch.email && !ch.sms) continue;

      const logId = `${shop.id}__bookrem__${row.id}__${dueMs}`;
      const claim = await supa.from("message_log").insert({ id: logId, shop_id: shop.id, appt_id: `bookrem__${row.id}`, message_id: "book-reminder", via: "pending", sent_at: new Date().toISOString() });
      if (claim.error) continue; // already claimed by another run
      checked++;

      const first = String(c.name || "there").split(" ")[0];
      const bookUrl = `${SITE}/book?shop=${encodeURIComponent(shop.id)}`;
      // Keep the SMS to ONE segment (≤160 GSM chars): short greeting + link + opt-out, nothing else.
      const textBody = `Hi ${first}! Here is your reminder to book with ${business}! Book: ${bookUrl}`;
      const via = [];
      try { if (ch.sms) { await sendSms({ to: phone, text: textBody + "\nReply STOP to opt out." }); via.push("sms"); } } catch (e) { failed++; }
      try { if (ch.email && !via.length) { await sendEmail({ to: email, subject: `${business}: time to book your next visit`, text: textBody, html: renderEmailHtml(textBody, {}), fromName: business, replyTo: shopEmail }); via.push("email"); } } catch (e) { failed++; }

      if (via.length) {
        await supa.from("message_log").update({ via: via.join("+"), sent_at: new Date().toISOString() }).eq("id", logId);
        await supa.from("clients").update({ data: { ...c, bookReminder: { ...br, sent: true, sentAt: new Date().toISOString(), via: via.join("+") } } }).eq("shop_id", shop.id).eq("id", row.id);
        sent++;
      } else {
        await supa.from("message_log").delete().eq("id", logId); // release the claim so a later run retries
      }
    }
  }

  if (failed > 0) await reportServerError(new Error(`send-reminders: ${failed} message(s) failed to send`), { fn: "send-reminders", checked, sent, failed });
  return res.status(200).json({ ok: true, checked, sent, failed, smsLive: SMS_LIVE });
}
