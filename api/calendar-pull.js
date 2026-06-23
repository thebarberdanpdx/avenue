// Server-side persistence for calendar sync.
//
// WHY: the client computes the reconcile correctly but its writes to Supabase can
// be silently blocked (the app's save-gate disables saving if any initial load
// errored). So instead of trusting the client to persist, the client sends the
// already-reconciled synced appointments here and THIS endpoint writes them with
// the service-role key — bypassing the client save path and RLS entirely.
//
// POST { shop, mode: "sync", syncedAppts: [...], calSync: {...} }
//   -> upserts those appts, removes source:"sync" appts no longer in the set, saves calSync.
// POST { shop, mode: "clear" }
//   -> removes ALL source:"sync" appts and clears the saved calendar URL.
//
// Times/timezone are computed on the CLIENT (which knows the user's local zone),
// so this endpoint does NO date math — it only persists what it's handed.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const isSynced = (a) => !!a && (a.source === "sync" || a._synced);

// Owner-only guard. This endpoint writes appointments with the service-role key
// (it can rewrite or wipe the synced calendar), and it is ONLY ever called from
// the signed-in dashboard — never from the public booking page. So we require a
// valid Supabase session token; anonymous callers are rejected. (The daily
// background sync uses /api/calendar-run, NOT this endpoint, so it's unaffected.)
// Same mechanism the Stripe endpoint uses for money-moving actions.
async function getUser(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !SERVICE_KEY) return null;
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) return null;
    return data.user;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!SERVICE_KEY) return res.status(500).json({ error: "server not configured" });

  // Require a signed-in user before touching the calendar.
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized — please sign in again." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const shop = (body.shop || "").toString();
    if (!shop) return res.status(400).json({ error: "missing shop" });
    const mode = ["clear", "config"].includes(body.mode) ? body.mode : "sync";
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Current synced appointment ids on the server.
    const { data: existingRows, error: exErr } = await supabase.from("appointments").select("id,data").eq("shop_id", shop);
    if (exErr) return res.status(502).json({ error: exErr.message });
    const existing = (existingRows || []).map((r) => ({ id: r.id, data: r.data }));
    const existingSyncedIds = existing.filter((r) => isSynced(r.data)).map((r) => r.id);

    // Update the saved calSync config (merge into shops.settings).
    const writeCalSync = async (patch) => {
      const { data: shopRow } = await supabase.from("shops").select("settings,name").eq("id", shop).maybeSingle();
      const settings = (shopRow && shopRow.settings) || {};
      settings.calSync = { ...(settings.calSync || {}), ...patch };
      await supabase.from("shops").upsert({ id: shop, name: (shopRow && shopRow.name) || shop, settings });
      return settings.calSync;
    };

    if (mode === "config") {
      // Only update the saved calSync config (pause/resume, keep-disconnect) — no appointment changes.
      const calSync = await writeCalSync({ ...(body.calSync || {}), lastSyncAt: Date.now() });
      return res.status(200).json({ ok: true, mode, calSync });
    }

    if (mode === "clear") {
      let removed = 0;
      if (existingSyncedIds.length) {
        const { error } = await supabase.from("appointments").delete().eq("shop_id", shop).in("id", existingSyncedIds);
        if (error) return res.status(502).json({ error: error.message });
        removed = existingSyncedIds.length;
      }
      const calSync = await writeCalSync({ url: "", connectedVia: null, paused: false, lastChanges: null, lastError: null, lastSyncAt: Date.now() });
      return res.status(200).json({ ok: true, mode, removed, calSync });
    }

    // mode === "sync"
    const incoming = Array.isArray(body.syncedAppts) ? body.syncedAppts.filter(isSynced) : [];
    // Safety rail: an empty set in sync mode means "the feed read nothing" — never let that wipe the mirror.
    if (incoming.length === 0 && existingSyncedIds.length > 0) {
      const calSync = await writeCalSync({ ...(body.calSync || {}), lastSyncAt: Date.now(), lastError: "Feed returned nothing — kept existing appointments." });
      return res.status(200).json({ ok: true, mode, blocked: true, kept: existingSyncedIds.length, calSync });
    }

    // Upsert the incoming synced appointments.
    if (incoming.length) {
      const rows = incoming.map((a) => ({ id: String(a.id), shop_id: shop, data: a }));
      const { error: upErr } = await supabase.from("appointments").upsert(rows);
      if (upErr) return res.status(502).json({ error: upErr.message });
    }
    // Remove synced appts the feed no longer contains (only previously-synced rows; never touches native bookings).
    const keep = new Set(incoming.map((a) => String(a.id)));
    const toDelete = existingSyncedIds.filter((id) => !keep.has(String(id)));
    let removed = 0;
    if (toDelete.length) {
      const { error: delErr } = await supabase.from("appointments").delete().eq("shop_id", shop).in("id", toDelete);
      if (delErr) return res.status(502).json({ error: delErr.message });
      removed = toDelete.length;
    }
    const calSync = await writeCalSync({ ...(body.calSync || {}), lastSyncAt: Date.now(), lastError: null });
    return res.status(200).json({ ok: true, mode, upserted: incoming.length, removed, syncedTotal: incoming.length, calSync });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
