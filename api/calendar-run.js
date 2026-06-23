// Always-on calendar sync. Runs server-side (service-role key) so it keeps Vero in
// step with the source calendar 24/7 — even when the app is closed — instead of only
// while the dashboard is open. Driven by Vercel Cron (see vercel.json).
//
//   GET /api/calendar-run            -> sync every connected shop (cron uses this)
//   GET /api/calendar-run?shop=foo   -> sync just that shop (used for testing)
//
// It reproduces the CLIENT's reconcile exactly (same UID keying, same timezone math)
// so the background job and the in-app sync never disagree and never churn.
import { createClient } from "@supabase/supabase-js";
import { parseICS } from "./calendar-sync.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const DEFAULT_TZ = "America/Los_Angeles";

const hashStr = (str) => { let h = 0; const s = String(str || ""); for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return Math.abs(h); };
const isSynced = (a) => !!a && (a.source === "sync" || a._synced);

// ---- timezone-aware time helpers (must match the browser's local-tz computation) ----
function localMins(iso, tz) {
  if (/Z$/.test(iso)) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
    const h = (+f.find((p) => p.type === "hour").value) % 24;
    const mi = +f.find((p) => p.type === "minute").value;
    return h * 60 + mi;
  }
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : 540;
}
function floatingToUTC(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  const shown = new Date(guess).toLocaleString("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const m = shown.match(/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+):(\d+)/);
  const shownUTC = Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6]);
  return guess - (shownUTC - guess);
}
function bookedForISO(iso, tz) {
  if (/Z$/.test(iso)) return new Date(iso).toISOString();
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return new Date(iso).toISOString();
  return new Date(floatingToUTC(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], tz)).toISOString();
}
const splitSummary = (s) => {
  const raw = (s || "").trim();
  const parts = raw.split(/\s[-–—]\s/);
  if (parts.length >= 2) return { name: parts[0].trim(), service: parts.slice(1).join(" - ").trim() };
  return { name: raw || "Client", service: "" };
};

async function syncShop(supabase, shop) {
  const { data: shopRow } = await supabase.from("shops").select("settings,name").eq("id", shop).maybeSingle();
  const settings = (shopRow && shopRow.settings) || {};
  const cfg = settings.calSync || {};
  if (!cfg.url || cfg.paused) return { shop, skipped: true };
  const tz = cfg.tz || DEFAULT_TZ;
  const providers = (settings._providers || []).filter((p) => p && p.id !== "anyone"); // usually absent; matching falls back below
  const defaultProviderId = (providers[0] || {}).id || null;

  // Fetch + parse the feed.
  const url = cfg.url.replace(/^webcal:\/\//i, "https://");
  let events;
  try {
    const r = await fetch(url, { headers: { Accept: "text/calendar, */*" }, redirect: "follow" });
    if (!r.ok) throw new Error("status " + r.status);
    const text = await r.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("not a calendar");
    events = parseICS(text);
  } catch (e) {
    await writeCfg(supabase, shop, shopRow, { lastSyncAt: Date.now(), lastError: "Couldn't read the feed." });
    return { shop, error: "fetch", detail: String(e.message || e) };
  }

  // Existing synced appts.
  const { data: rows } = await supabase.from("appointments").select("id,data").eq("shop_id", shop);
  const existing = (rows || []).map((r) => r.data).filter(Boolean);
  const existingSynced = existing.filter(isSynced);
  const byUid = new Map();
  for (const a of existingSynced) if (a.syncUid) byUid.set(a.syncUid, a);

  const incoming = (events || []).filter((e) => e && e.uid && !e.cancelled && !e.allDay);
  const incomingUids = new Set(incoming.map((e) => e.uid));

  let added = 0, moved = 0;
  const keep = [];
  for (const ev of incoming) {
    const ex = byUid.get(ev.uid);
    const { name, service } = splitSummary(ev.summary);
    const start = localMins(ev.start, tz);
    let end = ev.end ? localMins(ev.end, tz) : null;
    if (end == null || end <= start) end = start + 30;
    const appt = {
      id: ex ? ex.id : ("sync_" + hashStr(ev.uid).toString(36)),
      source: "sync", _synced: true, syncUid: ev.uid,
      providerId: ex ? ex.providerId : defaultProviderId,
      clientId: null, serviceId: ex ? ex.serviceId : null,
      start, end, bookedFor: bookedForISO(ev.start, tz),
      status: "confirmed", name, title: service || "Appointment", serviceName: service || "",
      price: 0, phone: "", hasPhotos: false, photos: 0, hasNote: false, vip: false,
    };
    if (!ex) added++;
    else if (ex.start !== appt.start || ex.end !== appt.end || ex.bookedFor !== appt.bookedFor || ex.title !== appt.title) moved++;
    keep.push(appt);
  }
  const toDelete = existingSynced.filter((a) => a.syncUid && !incomingUids.has(a.syncUid)).map((a) => String(a.id));

  // Safety rail: empty/glitchy feed must never wipe the mirror.
  const emptyFeed = incoming.length === 0 && existingSynced.length > 0;
  const tooMany = toDelete.length > Math.max(5, Math.ceil(existingSynced.length * 0.34));
  if (emptyFeed || tooMany) {
    await writeCfg(supabase, shop, shopRow, { lastSyncAt: Date.now(), lastError: "Feed looked wrong — kept existing appointments.", lastBlockedCount: toDelete.length });
    return { shop, blocked: true, blockedCount: toDelete.length };
  }

  if (keep.length) {
    const upRows = keep.map((a) => ({ id: String(a.id), shop_id: shop, data: a }));
    const { error: upErr } = await supabase.from("appointments").upsert(upRows);
    if (upErr) return { shop, error: "upsert", detail: upErr.message };
  }
  let removed = 0;
  if (toDelete.length) {
    const { error: delErr } = await supabase.from("appointments").delete().eq("shop_id", shop).in("id", toDelete);
    if (delErr) return { shop, error: "delete", detail: delErr.message };
    removed = toDelete.length;
  }
  const changes = { added, moved, cancelled: removed };
  await writeCfg(supabase, shop, shopRow, { lastSyncAt: Date.now(), lastError: null, lastBlockedCount: 0, lastChanges: changes, connectedVia: cfg.connectedVia || "link" });
  return { shop, ok: true, total: keep.length, ...changes };
}

async function writeCfg(supabase, shop, shopRow, patch) {
  const settings = (shopRow && shopRow.settings) || {};
  settings.calSync = { ...(settings.calSync || {}), ...patch };
  await supabase.from("shops").upsert({ id: shop, name: (shopRow && shopRow.name) || shop, settings });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Optional shared-secret guard so randoms can't trigger syncs. Vercel Cron sends
  // this automatically when CRON_SECRET is set; matches api/send-reminders.js.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    const q = (req.query && req.query.key) || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}` && q !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }
  if (!SERVICE_KEY) return res.status(500).json({ error: "server not configured" });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const one = (req.query && req.query.shop) ? String(req.query.shop) : null;
    let shops;
    if (one) shops = [one];
    else {
      // every shop with a connected, non-paused calendar
      const { data } = await supabase.from("shops").select("id,settings");
      shops = (data || []).filter((s) => { const c = s.settings && s.settings.calSync; return c && c.url && !c.paused; }).map((s) => s.id);
    }
    const results = [];
    for (const shop of shops) results.push(await syncShop(supabase, shop));
    return res.status(200).json({ ran: results.length, results });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
