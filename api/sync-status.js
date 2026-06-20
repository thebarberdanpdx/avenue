// Read-only diagnostic for calendar-sync health. Uses the service-role key
// (server-only) to see the appointments table directly — the publishable key
// can't, so this is the only way to confirm what actually persisted.
//
// GET /api/sync-status?shop=sanctuary
// Returns COUNTS ONLY (no client names/phones) + the calSync metadata with the
// secret feed URL stripped out. Safe to call without auth.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    if (!SERVICE_KEY) return res.status(500).json({ error: "server not configured" });
    const shop = (req.query.shop || "sanctuary").toString();
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: shopRow } = await supabase.from("shops").select("settings").eq("id", shop).maybeSingle();
    const cs = (shopRow && shopRow.settings && shopRow.settings.calSync) || {};
    const calSync = {
      connected: !!cs.url, paused: !!cs.paused,
      lastSyncAt: cs.lastSyncAt || null,
      lastSyncAgoSec: cs.lastSyncAt ? Math.round((Date.now() - cs.lastSyncAt) / 1000) : null,
      lastChanges: cs.lastChanges || null,
      lastBlockedCount: cs.lastBlockedCount ?? null,
      lastError: cs.lastError || null,
    };

    const { data: appts, error } = await supabase.from("appointments").select("data").eq("shop_id", shop);
    if (error) return res.status(502).json({ error: error.message, calSync });
    const rows = (appts || []).map((r) => r.data).filter(Boolean);
    const synced = rows.filter((a) => a && (a.source === "sync" || a._synced));
    // Duplicate detector: same client name + same bookedFor day+time on the synced set.
    const seen = new Map();
    let dupes = 0;
    for (const a of synced) {
      const k = `${(a.name || "").toLowerCase()}|${a.bookedFor}|${a.start}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const v of seen.values()) if (v > 1) dupes += v - 1;

    return res.status(200).json({
      shop,
      totalAppts: rows.length,
      syncedAppts: synced.length,
      distinctSynced: seen.size,
      duplicateSynced: dupes,
      calSync,
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
