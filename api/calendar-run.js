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
import { selectAllRows } from "../lib/paginate.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const DEFAULT_TZ = "America/Los_Angeles";

const hashStr = (str) => { let h = 0; const s = String(str || ""); for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return Math.abs(h); };
const isSynced = (a) => !!a && (a.source === "sync" || a._synced);

// ---- timezone-aware time helpers (must match the browser's local-tz computation) ----
function localMins(iso, tz) {
  if (/Z$/.test(iso)) {
    try {
      const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
      const h = (+f.find((p) => p.type === "hour").value) % 24;
      const mi = +f.find((p) => p.type === "minute").value;
      return h * 60 + mi;
    } catch (e) {
      // Runtime without the IANA tz database — best-effort UTC instead of crashing the whole sync.
      const dt = new Date(iso);
      return dt.getUTCHours() * 60 + dt.getUTCMinutes();
    }
  }
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : 540;
}
function floatingToUTC(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  try {
    const shown = new Date(guess).toLocaleString("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const m = shown.match(/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+):(\d+)/);
    const shownUTC = Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6]);
    return guess - (shownUTC - guess);
  } catch (e) {
    // Runtime without the IANA tz database — treat the floating time as UTC (no crash).
    return guess;
  }
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

import { safeFetch } from "../lib/safeFetch.js";

// A feed id is derived from its URL so it's stable across staff re-assignment.
// MUST match feedIdFor in src/App.jsx.
const feedIdFor = (url) => "f" + Math.abs(hashStr(String(url || "").trim().replace(/^webcal:\/\//i, "https://"))).toString(36);

// Reconcile ONE feed (one staff member's calendar) into the appt list. Mirrors
// reconcileFeed() in src/App.jsx: forces every event onto feed.providerId, tags syncFeed,
// claims legacy untagged rows by UID, and scopes its safety rail to its own appts only.
function reconcileFeedServer(currentAppts, events, opts) {
  const providerId = opts.providerId || null;
  const feedId = opts.feedId;
  const tz = opts.tz || DEFAULT_TZ;
  // [synced-appt-preserve] MUST match reconcileFeed() in src/App.jsx. A synced appt that has been
  // WORKED (client attached / non-"confirmed" status / checked in-out / paid / line items) is a REAL
  // appointment — a re-import must NEVER rebuild it back to a bare "confirmed" mirror. ROOT BUG this
  // fixes: the daily cron reset every synced appt's status to "confirmed" and dropped clientId/paid/
  // serviceStartedAt/serviceEndedAt, so a checked-out synced appt reverted + lost its checkout.
  const worked = (a) => !!(a && (a.clientId || (a.status && a.status !== "confirmed") || a.serviceStartedAt != null || a.serviceEndedAt != null || (a.paid && Number(a.paid.total) > 0) || (Array.isArray(a.lineItems) && a.lineItems.length > 0)));
  const toAppt = (ev, ex) => {
    const { name, service } = splitSummary(ev.summary);
    const start = localMins(ev.start, tz);
    let end = ev.end ? localMins(ev.end, tz) : null;
    if (end == null || end <= start) end = start + 30;
    if (ex && worked(ex)) return { ...ex, source: "sync", _synced: true, syncUid: ev.uid, syncFeed: feedId }; // real appt — preserve verbatim, only re-tag
    return {
      id: ex ? ex.id : ("sync_" + feedId + "_" + hashStr(ev.uid).toString(36)),
      source: "sync", _synced: true, syncUid: ev.uid, syncFeed: feedId,
      providerId,
      clientId: null, serviceId: ex ? ex.serviceId : null,
      start, end, bookedFor: bookedForISO(ev.start, tz),
      status: "confirmed", name, title: service || "Appointment", serviceName: service || "",
      price: 0, phone: "", hasPhotos: false, photos: 0, hasNote: false, vip: false,
    };
  };
  const incoming = (events || []).filter((e) => e && e.uid && !e.cancelled && !e.allDay);
  const incomingUids = new Set(incoming.map((e) => e.uid));
  const incomingByUid = new Map(); for (const e of incoming) incomingByUid.set(e.uid, e);
  const allSynced = (currentAppts || []).filter(isSynced);
  const mine = allSynced.filter((a) => a.syncFeed === feedId || (a.syncFeed == null && a.syncUid && incomingUids.has(a.syncUid)));
  const mineSet = new Set(mine);
  const rest = (currentAppts || []).filter((a) => !mineSet.has(a));
  const byUid = new Map(); for (const a of mine) if (a.syncUid) byUid.set(a.syncUid, a);
  let added = 0, moved = 0; const kept = [];
  for (const e of incoming) {
    const ex = byUid.get(e.uid);
    const appt = toAppt(e, ex);
    if (!ex) added++;
    else if (ex.start !== appt.start || ex.end !== appt.end || ex.bookedFor !== appt.bookedFor || ex.title !== appt.title || ex.providerId !== appt.providerId) moved++;
    kept.push(appt);
  }
  // [synced-appt-preserve] a WORKED appt whose outside event vanished is a real record — never delete
  // it; keep it (still tagged). Only bare, untouched mirror blocks are cancel/delete candidates.
  const vanished = mine.filter((a) => a.syncUid && !incomingUids.has(a.syncUid));
  const keptWorkedOrphans = vanished.filter(worked);
  const toCancel = vanished.filter((a) => !worked(a));
  const emptyFeed = incoming.length === 0 && mine.length > 0;
  const tooMany = toCancel.length > Math.max(5, Math.ceil(mine.length * 0.34));
  if (emptyFeed || tooMany) {
    const safe = mine.map((a) => { const e = incomingByUid.get(a.syncUid); return e ? toAppt(e, a) : a; });
    const brandNew = kept.filter((a) => !byUid.has(a.syncUid));
    return { next: [...rest, ...safe, ...brandNew], changes: { added, moved, cancelled: 0 }, blocked: true, blockedCount: toCancel.length };
  }
  return { next: [...rest, ...kept, ...keptWorkedOrphans], changes: { added, moved, cancelled: toCancel.length }, blocked: false, blockedCount: 0 };
}

async function syncShop(supabase, shop) {
  const { data: shopRow } = await supabase.from("shops").select("settings,name").eq("id", shop).maybeSingle();
  const settings = (shopRow && shopRow.settings) || {};
  const cfg = settings.calSync || {};
  const tz = cfg.tz || DEFAULT_TZ;
  // New shape: cfg.feeds [{id,providerId,url,paused}]. Legacy: a single cfg.url assigned to
  // the first staff member (best effort) until the owner migrates via the app.
  const legacyProvider = (((settings._providers || []).filter((p) => p && p.id !== "anyone")[0]) || {}).id || null;
  let feeds = Array.isArray(cfg.feeds)
    ? cfg.feeds
    : (cfg.url ? [{ id: feedIdFor(cfg.url), providerId: legacyProvider, url: cfg.url, paused: cfg.paused }] : []);
  const active = feeds.filter((f) => f && f.url && f.providerId && !f.paused);
  if (!active.length) return { shop, skipped: true };

  // Load all appts once; thread them through every feed's reconcile. Paginate — an unranged
  // .select() caps at 1000 rows, so reconcile would only see the first 1,000 existing appts and
  // could wrongly re-insert or mis-delete synced ones past that (data-integrity risk).
  const { data: rows } = await selectAllRows(() => supabase.from("appointments").select("id,data").eq("shop_id", shop).order("id"));
  let working = (rows || []).map((r) => r.data).filter(Boolean);
  const existingSyncedIds = (rows || []).filter((r) => isSynced(r.data)).map((r) => String(r.id));

  let totalAdded = 0, totalMoved = 0, blockedAny = 0;
  const perFeed = {};
  for (const f of active) {
    const url = f.url.replace(/^webcal:\/\//i, "https://");
    let events;
    try {
      const r = await safeFetch(url, { headers: { Accept: "text/calendar, */*" } });
      if (!r.ok) throw new Error("status " + r.status);
      const text = await r.text();
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("not a calendar");
      events = parseICS(text);
    } catch (e) {
      perFeed[f.id] = { error: "Couldn't read the feed." };
      continue; // leave this feed's existing appts untouched
    }
    const res = reconcileFeedServer(working, events, { providerId: f.providerId, feedId: f.id, tz });
    working = res.next;
    totalAdded += res.changes.added; totalMoved += res.changes.moved;
    if (res.blocked) blockedAny += res.blockedCount;
    perFeed[f.id] = { changes: res.changes, blocked: res.blocked, blockedCount: res.blockedCount };
  }

  // Persist: upsert every synced appt now in `working`; delete synced rows no longer present.
  const desiredSynced = working.filter(isSynced);
  const keepIds = new Set(desiredSynced.map((a) => String(a.id)));
  if (desiredSynced.length) {
    const upRows = desiredSynced.map((a) => ({ id: String(a.id), shop_id: shop, data: a }));
    const { error: upErr } = await supabase.from("appointments").upsert(upRows);
    if (upErr) return { shop, error: "upsert", detail: upErr.message };
  }
  const toDelete = existingSyncedIds.filter((id) => !keepIds.has(id));
  let removed = 0;
  if (toDelete.length) {
    const { error: delErr } = await supabase.from("appointments").delete().eq("shop_id", shop).in("id", toDelete);
    if (delErr) return { shop, error: "delete", detail: delErr.message };
    removed = toDelete.length;
  }
  const changes = { added: totalAdded, moved: totalMoved, cancelled: removed };
  // Stamp per-feed status back onto the config (migrates legacy url -> feeds, clears url).
  const nextFeeds = feeds.map((f) => {
    const rr = perFeed[f.id];
    if (!rr) return f;
    return { ...f, lastError: rr.error || null, lastChanges: rr.error ? f.lastChanges : rr.changes, lastBlockedCount: rr.blocked ? rr.blockedCount : 0, lastSyncAt: Date.now() };
  });
  await writeCfg(supabase, shop, shopRow, { feeds: nextFeeds, url: "", lastSyncAt: Date.now(), lastError: null, lastChanges: changes });
  if (blockedAny) return { shop, blocked: true, blockedCount: blockedAny, ...changes };
  return { shop, ok: true, total: desiredSynced.length, ...changes };
}
async function writeCfg(supabase, shop, shopRow, patch) {
  const settings = (shopRow && shopRow.settings) || {};
  settings.calSync = { ...(settings.calSync || {}), ...patch };
  await supabase.from("shops").upsert({ id: shop, name: (shopRow && shopRow.name) || shop, settings });
}

import { withErrorReporting } from "../lib/observe.js";
export default withErrorReporting(handler, "calendar-run");
async function handler(req, res) {
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
      shops = (data || []).filter((s) => { const c = s.settings && s.settings.calSync; if (!c) return false; if (Array.isArray(c.feeds)) return c.feeds.some((f) => f && f.url && f.providerId && !f.paused); return c.url && !c.paused; }).map((s) => s.id);
    }
    const results = [];
    for (const shop of shops) results.push(await syncShop(supabase, shop));
    return res.status(200).json({ ran: results.length, results });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
