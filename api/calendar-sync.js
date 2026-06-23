// Calendar feed reader (the "paste a link" door of the migration sync).
//
// The browser can't fetch a third-party .ics feed directly (no CORS headers on
// most calendar feeds), so this serverless function does it: fetch the feed,
// parse the VEVENTs, and hand back a clean JSON list of appointments. The client
// then reconciles that list into Vero's calendar (add / move / cancel) — silently,
// with no client notifications. This endpoint is READ-ONLY: it never writes anything.
//
// POST { url }  ->  { events: [{ uid, summary, start, end, allDay, cancelled }] }
//   start/end are ISO-ish strings. UTC values keep their trailing "Z"; floating /
//   TZID values are returned as wall-clock "YYYY-MM-DDTHH:MM:SS" so the client's
//   new Date() reads them at the same clock time the owner sees in their calendar.

import { safeFetch } from "../lib/safeFetch.js";

// RFC 5545 line unfolding: a line beginning with a space or tab continues the previous one.
function unfold(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

// Turn an ICS date-time token into something `new Date()` reads correctly.
//   20260620T160000Z        -> 2026-06-20T16:00:00Z   (absolute UTC)
//   TZID=...:20260620T090000 -> 2026-06-20T09:00:00    (wall-clock / floating)
//   20260620                 -> 2026-06-20T00:00:00    (all-day)
function toISO(raw) {
  if (!raw) return null;
  const v = raw.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (!hh) return { iso: `${y}-${mo}-${d}T00:00:00`, allDay: true };
  return { iso: `${y}-${mo}-${d}T${hh}:${mm}:${ss}${z ? "Z" : ""}`, allDay: false };
}

// Pull the value off a "PROP;PARAMS:value" line for the first matching property.
function prop(block, name) {
  const re = new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, "mi");
  const hit = block.match(re);
  return hit ? hit[1].trim() : "";
}
function rawDate(block, name) {
  const re = new RegExp(`^${name}(;[^:\\n]*)?:(.*)$`, "mi");
  const hit = block.match(re);
  return hit ? hit[2].trim() : "";
}

function parseICS(text) {
  const t = unfold(text);
  const events = [];
  // Each appointment is a BEGIN:VEVENT ... END:VEVENT block.
  const blocks = t.split(/BEGIN:VEVENT/i).slice(1);
  for (const chunk of blocks) {
    const block = chunk.split(/END:VEVENT/i)[0];
    const uid = prop(block, "UID");
    if (!uid) continue;
    const start = toISO(rawDate(block, "DTSTART"));
    const end = toISO(rawDate(block, "DTEND"));
    if (!start) continue;
    // unescape ICS text escaping (\, \; \n) in the summary
    const summary = prop(block, "SUMMARY")
      .replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
    const status = prop(block, "STATUS").toUpperCase();
    events.push({
      uid,
      summary,
      start: start.iso,
      end: end ? end.iso : null,
      allDay: !!start.allDay,
      cancelled: status === "CANCELLED",
    });
  }
  return events;
}

export default async function handler(req, res) {
  // CORS for the web app + native app
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    let url = (body.url || "").trim();
    if (!url) return res.status(400).json({ error: "Missing calendar link." });
    // webcal:// is just http(s) for calendar subscriptions — normalize it.
    url = url.replace(/^webcal:\/\//i, "https://");
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "That doesn't look like a calendar link." });

    const r = await safeFetch(url, { headers: { Accept: "text/calendar, text/plain, */*" } });
    if (!r.ok) return res.status(502).json({ error: `Couldn't reach the calendar (status ${r.status}).` });
    const text = await r.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      return res.status(422).json({ error: "That link didn't return a calendar feed. Double-check it's the calendar/subscribe link." });
    }

    const events = parseICS(text);
    return res.status(200).json({ events, count: events.length });
  } catch (e) {
    return res.status(500).json({ error: "Couldn't read that calendar. Check the link and try again." });
  }
}

// Exported for local testing.
export { parseICS, toISO, unfold };
