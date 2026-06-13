// /api/ical/[shop]/[file] — read-only iCal (.ics) feed of a provider's upcoming
// appointments, so a barber can subscribe in Apple/Google Calendar.
// Route: GET /api/ical/{shop}/{providerId}.ics
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const dt = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};
const fold = (line) => {
  if (line.length <= 73) return line;
  let out = line.slice(0, 73), rest = line.slice(73);
  while (rest.length > 72) { out += "\r\n " + rest.slice(0, 72); rest = rest.slice(72); }
  return out + "\r\n " + rest;
};

export default async function handler(req, res) {
  try {
    let { shop, file } = req.query || {};
    if (Array.isArray(shop)) shop = shop[0];
    if (Array.isArray(file)) file = file[0];
    const shopId = String(shop || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    const providerId = String(file || "").replace(/\.ics$/i, "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!shopId || !providerId) return res.status(400).send("bad request");
    if (!SERVICE_KEY) return res.status(500).send("server not configured");

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let provName = providerId;
    try {
      const { data: provs } = await supabase.from("providers").select("data").eq("shop_id", shopId);
      const hit = (provs || []).map((r) => r.data).find((p) => p && String(p.id) === providerId);
      if (hit && hit.name) provName = hit.name;
    } catch (e) {}

    let shopName = shopId;
    try {
      const { data: shopRow } = await supabase.from("shops").select("settings").eq("id", shopId).maybeSingle();
      if (shopRow && shopRow.settings && shopRow.settings.name) shopName = shopRow.settings.name;
    } catch (e) {}

    const { data: rows, error } = await supabase.from("appointments").select("data").eq("shop_id", shopId);
    if (error) return res.status(500).send("lookup failed");
    const cutoff = Date.now() - 14 * 86400000;
    const appts = (rows || [])
      .map((r) => r.data)
      .filter((a) => a && String(a.providerId) === providerId && a.status !== "cancelled" && a.status !== "block")
      .filter((a) => a.bookedFor && new Date(a.bookedFor).getTime() > cutoff);

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Vero//Booking//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      fold(`X-WR-CALNAME:${esc(provName)} - ${esc(shopName)}`),
      "X-PUBLISHED-TTL:PT1H",
    ];
    for (const a of appts) {
      const start = new Date(a.bookedFor);
      const durMin = (typeof a.end === "number" && typeof a.start === "number") ? Math.max(15, a.end - a.start) : 30;
      const end = new Date(start.getTime() + durMin * 60000);
      const summary = [a.name || "Appointment", a.title || a.serviceName].filter(Boolean).join(" - ");
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${esc(String(a.id || start.getTime()))}@vero.${shopId}`);
      lines.push(`DTSTAMP:${dt(new Date())}`);
      lines.push(`DTSTART:${dt(start)}`);
      lines.push(`DTEND:${dt(end)}`);
      lines.push(fold(`SUMMARY:${esc(summary)}`));
      if (a.note) lines.push(fold(`DESCRIPTION:${esc(a.note)}`));
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${providerId}.ics"`);
    res.setHeader("Cache-Control", "public, max-age=900");
    return res.status(200).send(lines.join("\r\n"));
  } catch (e) {
    return res.status(500).send("error");
  }
}
